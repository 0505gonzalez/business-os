import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { db, transaction } from "../database.js";
import { AppError, requireValue } from "../errors.js";
import { validateJobResult } from "./workflows.js";
export async function claimJob(workspaceId: string, userId: string) {
  return transaction(async (c) => {
    await c.query(
      "INSERT INTO device_presence(workspace_id,user_id) VALUES($1,$2) ON CONFLICT(workspace_id,user_id) DO UPDATE SET seen_at=now()",
      [workspaceId, userId],
    );
    const row = (
      await c.query(
        "SELECT * FROM agent_jobs WHERE workspace_id=$1 AND owner_id=$2 AND (status='queued' OR (status='running' AND lease_until<now())) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1",
        [workspaceId, userId],
      )
    ).rows[0];
    if (!row) return null;
    const agent = (
      await c.query(
        "INSERT INTO agents(id,workspace_id,owner_id,provider) VALUES($1,$2,$3,'claude') ON CONFLICT(workspace_id,owner_id) DO UPDATE SET provider=excluded.provider RETURNING id",
        [randomUUID(), workspaceId, userId],
      )
    ).rows[0];
    return (
      await c.query(
        "UPDATE agent_jobs SET status='running',lease_token=$2,lease_until=now()+interval '60 seconds',error=NULL,agent_id=$3 WHERE id=$1 RETURNING *",
        [row.id, randomUUID(), agent.id],
      )
    ).rows[0];
  });
}
export async function heartbeatJob(
  workspaceId: string,
  userId: string,
  id: string,
  lease: string,
) {
  const result = await db.query(
    "UPDATE agent_jobs SET lease_until=now()+interval '60 seconds' WHERE id=$1 AND workspace_id=$2 AND owner_id=$3 AND lease_token=$4 AND status='running' AND lease_until>now() RETURNING id",
    [id, workspaceId, userId, lease],
  );
  if (!result.rowCount) throw new AppError(409, "Execution lease expired");
  return { ok: true };
}
export async function completeJob(
  workspaceId: string,
  userId: string,
  id: string,
  lease: string,
  result: unknown,
) {
  return transaction(async (c) => {
    const job = requireValue(
      (
        await c.query(
          "SELECT * FROM agent_jobs WHERE id=$1 AND workspace_id=$2 AND owner_id=$3 FOR UPDATE",
          [id, workspaceId, userId],
        )
      ).rows[0],
    );
    const parsed = validateJobResult(job.action, result);
    if (job.lease_token !== lease)
      throw new AppError(409, "Execution lease was replaced");
    if (job.status === "completed") {
      if (!isDeepStrictEqual(job.result, parsed))
        throw new AppError(409, "Job already completed with another result");
      return { ok: true };
    }
    if (
      job.status !== "running" ||
      new Date(job.lease_until).getTime() < Date.now()
    )
      throw new AppError(409, "Execution lease expired");
    if (
      job.action === "classify" &&
      !(
        await c.query(
          "SELECT 1 FROM workflow_rules WHERE run_id=$1 AND domain=$2",
          [job.run_id, (parsed as { domain: string }).domain],
        )
      ).rowCount
    )
      throw new AppError(400, "Choose one configured domain");
    await c.query(
      "UPDATE agent_jobs SET status='completed',result=$2 WHERE id=$1",
      [id, parsed],
    );
    await c.query("UPDATE workflow_runs SET next_tick=now() WHERE id=$1", [
      job.run_id,
    ]);
    return { ok: true };
  });
}
export async function failJob(
  workspaceId: string,
  userId: string,
  id: string,
  lease: string,
  message: string,
) {
  await db.query(
    "UPDATE agent_jobs SET status='failed',error=$5 WHERE id=$1 AND workspace_id=$2 AND owner_id=$3 AND lease_token=$4 AND status='running'",
    [id, workspaceId, userId, lease, message.slice(0, 1000)],
  );
  return { ok: true };
}
