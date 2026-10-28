import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { db, transaction } from "../database.js";
import { buildWorkflow } from "../workflow.js";
import { stableId, writeRecord } from "../brain.js";
import { AppError, requireValue } from "../errors.js";
import {
  classificationSchema,
  draftSchema,
  mapSchema,
  responseSchema,
  type WaitDescriptor,
  type PlanningMap,
} from "../../../contracts/src/index.js";
import { validateQuestions } from "../governance.js";
export const checkpointer = PostgresSaver.fromConnString(
  process.env.DATABASE_URL!,
);
export const graph = buildWorkflow(checkpointer);
export async function startRun(
  workspaceId: string,
  userId: string,
  kind: "adr" | "feature",
  title: string,
  body: string,
  key: string,
) {
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
    const existing = await c.query(
      "SELECT * FROM workflow_runs WHERE id=$1 AND workspace_id=$2",
      [key, workspaceId],
    );
    if (existing.rowCount) {
      const r = existing.rows[0];
      if (
        r.owner_id !== userId ||
        r.input.kind !== kind ||
        r.input.title !== title ||
        r.input.body !== body
      )
        throw new AppError(409, "Request key already used");
      return r;
    }
    return (
      await c.query(
        "INSERT INTO workflow_runs(id,workspace_id,kind,stage,record_id,owner_id,input) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          key,
          workspaceId,
          kind,
          "queued",
          stableId(key, "record"),
          userId,
          { kind, title, body, round: 1 },
        ],
      )
    ).rows[0];
  });
}
async function job(
  run: any,
  stepId: string,
  action: string,
  prompt: string,
  questionId?: string,
) {
  await db.query(
    `INSERT INTO agent_jobs(id,workspace_id,run_id,owner_id,instruction,step_id,question_id,action) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
    [
      randomUUID(),
      run.workspace_id,
      run.id,
      run.owner_id,
      prompt,
      stepId,
      questionId ?? null,
      action,
    ],
  );
}
async function task(
  run: any,
  stepId: string,
  userId: string,
  role: string,
  kind: string,
  title: string,
  round: number,
  questionId?: string,
) {
  await transaction(async (c) => {
    const result = await c.query(
      `INSERT INTO tasks(id,workspace_id,run_id,assignee_id,revision,kind,step_id,title,question_id,role_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING id`,
      [
        randomUUID(),
        run.workspace_id,
        run.id,
        userId,
        round,
        kind,
        stepId,
        title,
        questionId ?? null,
        role,
      ],
    );
    if (result.rowCount)
      await c.query(
        "INSERT INTO events(workspace_id,kind,payload,user_id) VALUES($1,$2,$3,$4)",
        [
          run.workspace_id,
          "task.ready",
          { taskId: result.rows[0].id, runId: run.id, title },
          userId,
        ],
      );
  });
}
async function resolveStep(
  run: any,
  id: string,
  d: WaitDescriptor,
): Promise<unknown | undefined> {
  const old = await db.query(
    "SELECT response,routing FROM workflow_steps WHERE id=$1",
    [id],
  );
  if (old.rows[0]?.response != null) return old.rows[0].response;
  if (d.type === "agent") {
    const rules = (
      await db.query("SELECT * FROM workflow_rules WHERE run_id=$1", [run.id])
    ).rows;
    if (d.action === "classify" && !rules.length)
      throw new AppError(
        409,
        "Add review rules to this workflow before classification",
      );
    await job(
      run,
      id,
      d.action,
      `${d.prompt}\nConfigured routing rules: ${JSON.stringify(rules)}`,
    );
    const result = (
      await db.query(
        "SELECT result FROM agent_jobs WHERE step_id=$1 AND status='completed'",
        [id],
      )
    ).rows[0];
    return result?.result;
  }
  if (d.type === "exploration") {
    const map = structuredClone(d.map!);
    validateQuestions(map.questions);
    let ready = true;
    const jobs = (
      await db.query("SELECT * FROM agent_jobs WHERE step_id=$1", [id])
    ).rows;
    const tasks = (await db.query("SELECT * FROM tasks WHERE step_id=$1", [id]))
      .rows;
    for (const q of map.questions) {
      const j = jobs.find(
          (j) => j.question_id === q.id && j.status === "completed",
        ),
        t = tasks.find(
          (t) => t.question_id === q.id && t.status === "completed",
        );
      if (j) q.result = j.result.text;
      if (t) q.result = t.response.text;
    }
    for (const q of map.questions) {
      if (q.result !== undefined) continue;
      ready = false;
      if (
        q.blockedBy.some(
          (dep) =>
            map.questions.find((x) => x.id === dep)?.result === undefined,
        )
      )
        continue;
      if (q.kind === "research" || q.kind === "prototype")
        await job(
          run,
          id,
          q.kind,
          `${q.title}\nContext: ${JSON.stringify(map)}\nReturn JSON {"text":"findings or prototype HTML with explanation"}. Cite sources. For prototypes use self-contained HTML without remote scripts.`,
          q.id,
        );
      else
        await task(
          run,
          id,
          run.owner_id,
          "requester",
          `question:${q.id}`,
          q.title,
          d.round,
          q.id,
        );
    }
    for (const q of map.questions) {
      await writeRecord({
        id: stableId(run.id, q.id),
        workspaceId: run.workspace_id,
        revision: q.result === undefined ? 1 : 2,
        title: q.title,
        body: q.result ?? "",
        area: "temporal",
        kind: "question",
        sources: [run.record_id],
        approvals: [],
        data: { ...q },
      });
    }
    return ready ? map : undefined;
  }
  let people: { user_id: string; role: string }[] = [];
  let kinds: string[] = [];
  let policy: unknown = null;
  if (old.rows[0]?.routing) {
    people = old.rows[0].routing.people;
    kinds = old.rows[0].routing.kinds;
    policy = old.rows[0].routing.policy;
  } else if (d.action === "product_interview") {
    people = [{ user_id: run.owner_id, role: "requester" }];
    kinds = ["answer"];
  } else if (d.action === "engineer_interview" || d.action === "peer_review") {
    people = (
      await db.query(
        "SELECT user_id,role FROM memberships WHERE workspace_id=$1 AND role='engineer' ORDER BY user_id",
        [run.workspace_id],
      )
    ).rows;
    if (d.action === "peer_review") {
      const author = (
        await db.query(
          "SELECT assignee_id FROM tasks WHERE run_id=$1 AND kind='engineer_interview' AND status='completed' ORDER BY revision DESC LIMIT 1",
          [run.id],
        )
      ).rows[0]?.assignee_id;
      people = people.filter((p) => p.user_id !== author);
    }
    people = people.slice(0, 1);
    kinds = [d.action];
  } else {
    const rule = (
      await db.query(
        "SELECT * FROM workflow_rules WHERE run_id=$1 AND domain=$2",
        [run.id, d.domain],
      )
    ).rows[0];
    if (!rule)
      throw new AppError(409, `No routing rule for domain ${d.domain}`);
    policy = rule;
    people = (
      await db.query(
        "SELECT user_id,role FROM memberships WHERE workspace_id=$1 AND role=ANY($2::text[]) ORDER BY user_id",
        [run.workspace_id, [rule.approver_role, ...rule.acknowledgment_roles]],
      )
    ).rows;
    if (!people.some((p) => p.role === rule.approver_role))
      throw new AppError(
        409,
        `Assign a member with role ${rule.approver_role}`,
      );
    for (const role of rule.acknowledgment_roles)
      if (!people.some((person) => person.role === role))
        throw new AppError(
          409,
          `Assign a member with acknowledgment role ${role}`,
        );
    kinds = people.map((p) =>
      p.role === rule.approver_role ? "approval" : "acknowledgment",
    );
  }
  if (!people.length)
    throw new AppError(
      409,
      "Assign an eligible engineer; peer review requires a different engineer",
    );
  // Persist the complete assignment plan before creating individual tasks. Retrying a partially materialized step must create the remaining tasks.
  if (!old.rows[0]?.routing)
    await db.query("UPDATE workflow_steps SET routing=$2 WHERE id=$1", [
      id,
      { people, kinds, policy },
    ]);
  for (let i = 0; i < people.length; i++)
    await task(
      run,
      id,
      people[i].user_id,
      people[i].role,
      kinds[i] ?? kinds[0],
      `${d.action.replaceAll("_", " ")}: ${run.input.title}`,
      d.round,
    );
  const tasks = (await db.query("SELECT * FROM tasks WHERE step_id=$1", [id]))
    .rows;
  if (tasks.some((t) => t.response?.decision === "changes_requested")) {
    await db.query(
      "UPDATE tasks SET status='superseded' WHERE step_id=$1 AND status='ready'",
      [id],
    );
    return {
      decision: "changes_requested",
      text: tasks
        .map((t) => t.response?.text ?? "")
        .filter(Boolean)
        .join("\n"),
    };
  }
  if (tasks.some((t) => t.status !== "completed")) return undefined;
  return {
    decision: d.action.includes("interview") ? "answered" : "approved",
    text: tasks.map((t) => t.response.text).join("\n"),
  };
}
export async function tickRun(runId: string) {
  const lock = await db.connect();
  try {
    const acquired = await lock.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [runId],
    );
    if (!acquired.rows[0].acquired) return;
    const run = requireValue(
      (await db.query("SELECT * FROM workflow_runs WHERE id=$1", [runId]))
        .rows[0],
    );
    if (run.stage === "completed") return;
    const config = { configurable: { thread_id: run.id }, recursionLimit: 200 };
    let snapshot = await graph.getState(config);
    if (!snapshot.values || !Object.keys(snapshot.values).length) {
      await graph.invoke(run.input, config);
      snapshot = await graph.getState(config);
    }
    const pauses = snapshot.tasks.flatMap((t) => t.interrupts ?? []);
    for (const pause of pauses) {
      const id = `${run.id}:${pause.id}`;
      const descriptor = pause.value as WaitDescriptor;
      await db.query(
        "INSERT INTO workflow_steps(id,run_id,descriptor) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [id, run.id, descriptor],
      );
      const response = await resolveStep(run, id, descriptor);
      if (response !== undefined) {
        await db.query("UPDATE workflow_steps SET response=$2 WHERE id=$1", [
          id,
          response,
        ]);
        await graph.invoke(new Command({ resume: response }), config);
        snapshot = await graph.getState(config);
      }
    }
    const state = snapshot.values as any;
    const complete = snapshot.next.length === 0;
    const round = state.round ?? 1;
    const approvals = (
      await db.query(
        "SELECT assignee_id,id,revision,role_snapshot FROM tasks WHERE run_id=$1 AND revision=$2 AND status='completed' AND response->>'decision'='approved'",
        [run.id, round],
      )
    ).rows.map((t) => ({
      userId: t.assignee_id,
      taskId: t.id,
      revision: t.revision,
      role: t.role_snapshot,
    }));
    if (complete && !approvals.length)
      throw new Error(
        "Completed workflow has no approvals for its current revision",
      );
    // Graph checkpoints own execution, while each materialized revision is independently reconstructible from S3.
    const revision = Math.max(1, (snapshot.metadata?.step ?? 0) + 2);
    await writeRecord({
      id: run.record_id,
      workspaceId: run.workspace_id,
      revision,
      title: state.title,
      body: state.body,
      area: complete ? "canonical" : "temporal",
      kind: run.kind === "adr" ? "adr" : "map",
      sources: [],
      approvals: complete ? approvals : [],
      data: {
        policies: complete
          ? (
              await db.query(
                "SELECT routing FROM workflow_steps WHERE run_id=$1 AND routing IS NOT NULL",
                [run.id],
              )
            ).rows.map((row) => row.routing)
          : [],
        map: state.map ?? null,
        domain: state.domain ?? null,
        stage: snapshot.next[0] ?? "completed",
      },
    });
    const stage = complete ? "completed" : (snapshot.next[0] ?? "queued");
    await transaction(async (c) => {
      await c.query(
        "UPDATE workflow_runs SET stage=$2,revision=$3,snapshot=$4,error=NULL,next_tick=now()+interval '2 seconds' WHERE id=$1",
        [run.id, stage, round, state],
      );
      if (stage !== run.stage) {
        await c.query(
          "INSERT INTO events(workspace_id,kind,payload) VALUES($1,$2,$3)",
          [run.workspace_id, "workflow.changed", { runId: run.id, stage }],
        );
        if (complete) {
          const members = (
            await c.query(
              "SELECT user_id FROM memberships WHERE workspace_id=$1",
              [run.workspace_id],
            )
          ).rows;
          for (const member of members)
            await c.query(
              "INSERT INTO events(workspace_id,kind,payload,user_id) VALUES($1,$2,$3,$4)",
              [
                run.workspace_id,
                "workflow.approved",
                { runId: run.id, recordId: run.record_id },
                member.user_id,
              ],
            );
        }
      }
    });
  } catch (error) {
    await db.query(
      "UPDATE workflow_runs SET error=$2,next_tick=now()+interval '10 seconds' WHERE id=$1",
      [runId, error instanceof Error ? error.message : String(error)],
    );
  } finally {
    await lock.query("SELECT pg_advisory_unlock(hashtext($1))", [runId]);
    lock.release();
  }
}
export async function respondTask(
  workspaceId: string,
  userId: string,
  taskId: string,
  revision: number,
  response: unknown,
  responseId: string,
) {
  const parsed = responseSchema.parse(response);
  return transaction(async (c) => {
    const task = requireValue(
      (
        await c.query(
          "SELECT t.*,m.role AS current_role FROM tasks t JOIN memberships m ON m.workspace_id=t.workspace_id AND m.user_id=t.assignee_id WHERE t.id=$1 AND t.workspace_id=$2 AND t.assignee_id=$3 FOR UPDATE OF t",
          [taskId, workspaceId, userId],
        )
      ).rows[0],
    );
    if (task.response_id === responseId) {
      if (
        task.response.decision !== parsed.decision ||
        task.response.text !== parsed.text
      )
        throw new AppError(409, "Response key already used");
      return task;
    }
    if (task.status !== "ready" || task.revision !== revision)
      throw new AppError(
        409,
        "This task has changed; refresh before responding",
      );
    if (
      task.role_snapshot !== "requester" &&
      task.current_role !== task.role_snapshot
    )
      throw new AppError(403, "Your role no longer permits this response");
    const approval = ["approval", "peer_review"].includes(task.kind);
    if (
      approval &&
      !["approved", "changes_requested"].includes(parsed.decision)
    )
      throw new AppError(400, "An approval decision is required");
    if (task.kind === "acknowledgment" && parsed.decision !== "acknowledged")
      throw new AppError(400, "Acknowledgment required");
    if (
      !approval &&
      task.kind !== "acknowledgment" &&
      parsed.decision !== "answered"
    )
      throw new AppError(400, "Answer required");
    await c.query(
      "UPDATE tasks SET status='completed',response=$2,response_id=$3 WHERE id=$1",
      [taskId, parsed, responseId],
    );
    await c.query("UPDATE workflow_runs SET next_tick=now() WHERE id=$1", [
      task.run_id,
    ]);
    return { ...task, status: "completed", response: parsed };
  });
}
export function validateJobResult(action: string, result: unknown) {
  if (action === "classify") return classificationSchema.parse(result);
  if (action === "draft") return draftSchema.parse(result);
  if (action === "map") {
    const map = mapSchema.parse(result);
    validateQuestions(map.questions);
    return map;
  }
  const text = (result as { text?: unknown })?.text;
  if (typeof text !== "string" || !text.trim())
    throw new AppError(400, "Agent result requires text");
  return { text };
}
