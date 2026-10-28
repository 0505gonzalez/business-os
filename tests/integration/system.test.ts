import { test, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { CreateBucketCommand } from "@aws-sdk/client-s3";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
Object.assign(process.env, {
  LOG_LEVEL: "error",
  DATABASE_URL:
    "postgres://postgres:business_os_test@127.0.0.1:55432/business_os_test",
  S3_ENDPOINT: "http://127.0.0.1:59000",
  S3_REGION: "us-east-1",
  S3_FORCE_PATH_STYLE: "true",
  S3_BUCKET: "business-os-integration",
  S3_ACCESS_KEY_ID: "business_os_test",
  S3_SECRET_ACCESS_KEY: "business_os_test_secret",
  CLERK_JWT_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
  CLERK_AUTHORIZED_PARTIES: "business-os://renderer",
});
const { db } = await import("../../packages/backend/src/database.js");
const { migrate } = await import("../../packages/backend/src/migrate.js");
const { storage, readRecord, rebuildIndex, writeRecord } =
  await import("../../packages/backend/src/brain.js");
const { createApi } = await import("../../packages/backend/src/api.js");
const { checkpointer, tickRun } =
  await import("../../packages/backend/src/modules/workflows.js");
await migrate();
await checkpointer.setup();
try {
  await storage.send(
    new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }),
  );
} catch (e) {
  if (
    !["BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(
      (e as Error).name,
    )
  )
    throw e;
}
const app = createApi();
await app.ready();
function token(user: string) {
  const now = Math.floor(Date.now() / 1000),
    header = Buffer.from(
      JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test" }),
    ).toString("base64url"),
    body = Buffer.from(
      JSON.stringify({
        sub: user,
        sid: "sess_test",
        iss: "https://test.clerk.accounts.dev",
        azp: "business-os://renderer",
        iat: now,
        nbf: now - 1,
        exp: now + 300,
      }),
    ).toString("base64url");
  const data = `${header}.${body}`;
  return `${data}.${sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url")}`;
}
async function request(
  user: string,
  path: string,
  method: any = "GET",
  body?: unknown,
  key?: string,
) {
  return app.inject({
    method,
    url: `/v1${path}`,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      authorization: `Bearer ${token(user)}`,
      ...(key ? { "idempotency-key": key } : {}),
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function ok(
  user: string,
  path: string,
  method: any = "GET",
  body?: unknown,
  key?: string,
) {
  const response = await request(user, path, method, body, key);
  assert.equal(response.statusCode, 200, response.body);
  const result = response.json();
  if (method === "POST" && /^\/[^/]+\/workflows$/.test(path)) {
    await ok(user, `${path}/${result.id}/rules/pricing`, "PUT", {
      approverRole: "owner",
    });
  }
  return result;
}
async function company() {
  const user = `user_${randomUUID()}`;
  const w = await ok(user, "/workspaces", "POST", {
    name: "Integration company",
  });
  return { user, w };
}
async function pump(id: string) {
  await tickRun(id);
  const run = (await db.query("SELECT * FROM workflow_runs WHERE id=$1", [id]))
    .rows[0];
  assert.equal(run.error, null, run.error);
  return run;
}
after(async () => {
  await app.close();
  await db.end();
  await checkpointer.end();
});
test("real authenticated API denies another company and unsigned requests", async () => {
  const { user, w } = await company();
  assert.equal((await request("outsider", `/${w.id}/memory`)).statusCode, 403);
  assert.equal(
    (await app.inject({ url: `/v1/${w.id}/memory` })).statusCode,
    401,
  );
  assert.equal((await request(user, `/${w.id}/tasks`)).statusCode, 200);
});
test("bucket revisions remain authoritative and conditional writes reject conflicts", async () => {
  const { w } = await company();
  const record = {
    id: randomUUID(),
    workspaceId: w.id,
    revision: 1,
    title: "Evidence",
    body: "Original",
    area: "temporal" as const,
    kind: "research" as const,
    sources: [],
    approvals: [],
  };
  await writeRecord(record);
  await writeRecord(record);
  await assert.rejects(() => writeRecord({ ...record, body: "Conflicting" }));
  await db.query("DELETE FROM brain_index WHERE workspace_id=$1", [w.id]);
  await rebuildIndex(w.id);
  assert.equal(
    (
      await db.query("SELECT body FROM brain_index WHERE workspace_id=$1", [
        w.id,
      ])
    ).rows[0].body,
    "Original",
  );
});
test("ADR survives revision, lease replacement and checkpoints; promotion preserves approvals", async () => {
  const { user, w } = await company();
  const run = await ok(
    user,
    `/${w.id}/workflows`,
    "POST",
    { kind: "adr", title: "Pricing", body: "Initial proposal" },
    randomUUID(),
  );
  await pump(run.id);
  let job = await ok(user, `/${w.id}/jobs/claim`, "POST", {});
  const stale = job.lease_token;
  await db.query(
    "UPDATE agent_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
    [job.id],
  );
  job = await ok(user, `/${w.id}/jobs/claim`, "POST", {});
  assert.notEqual(stale, job.lease_token);
  assert.equal(
    (
      await request(user, `/${w.id}/jobs/${job.id}/complete`, "POST", {
        lease: stale,
        result: { domain: "pricing", reason: "Price" },
      })
    ).statusCode,
    409,
  );
  await ok(user, `/${w.id}/jobs/${job.id}/complete`, "POST", {
    lease: job.lease_token,
    result: { domain: "pricing", reason: "Price" },
  });
  await pump(run.id);
  await pump(run.id);
  let task = (await ok(user, `/${w.id}/tasks`))[0];
  assert.equal(task.kind, "approval");
  assert.equal(
    (
      await request(
        user,
        `/${w.id}/tasks/${task.id}/responses`,
        "POST",
        { revision: 999, response: { decision: "approved" } },
        randomUUID(),
      )
    ).statusCode,
    409,
  );
  await ok(
    user,
    `/${w.id}/tasks/${task.id}/responses`,
    "POST",
    {
      revision: task.revision,
      response: { decision: "changes_requested", text: "Lower price" },
    },
    randomUUID(),
  );
  await pump(run.id);
  await pump(run.id);
  job = await ok(user, `/${w.id}/jobs/claim`, "POST", {});
  assert.equal(job.action, "draft");
  await ok(user, `/${w.id}/jobs/${job.id}/complete`, "POST", {
    lease: job.lease_token,
    result: { title: "Pricing", body: "Revised price" },
  });
  await pump(run.id);
  await pump(run.id);
  job = await ok(user, `/${w.id}/jobs/claim`, "POST", {});
  await ok(user, `/${w.id}/jobs/${job.id}/complete`, "POST", {
    lease: job.lease_token,
    result: { domain: "pricing", reason: "Price" },
  });
  await pump(run.id);
  await pump(run.id);
  task = (await ok(user, `/${w.id}/tasks`))[0];
  assert.equal(task.revision, 2);
  const key = randomUUID();
  const response = {
    revision: task.revision,
    response: { decision: "approved", text: "Agreed" },
  };
  await ok(user, `/${w.id}/tasks/${task.id}/responses`, "POST", response, key);
  await ok(user, `/${w.id}/tasks/${task.id}/responses`, "POST", response, key);
  const finished = await pump(run.id);
  assert.equal(finished.stage, "completed");
  const record = await readRecord(w.id, run.record_id);
  assert.equal(record.area, "canonical");
  assert.equal(record.body, "Revised price");
  assert.equal(record.approvals[0].taskId, task.id);
  await db.query("DELETE FROM brain_index WHERE workspace_id=$1", [w.id]);
  await rebuildIndex(w.id);
  assert.equal(
    (
      await db.query(
        "SELECT area FROM brain_index WHERE workspace_id=$1 AND record_id=$2",
        [w.id, run.record_id],
      )
    ).rows[0].area,
    "canonical",
  );
});
test("feature exploration runs independent research and enforces separate engineer review", async () => {
  const { user, w } = await company();
  for (const engineer of ["engineer_a", "engineer_b"])
    await db.query("INSERT INTO memberships VALUES($1,$2,$3)", [
      w.id,
      engineer,
      "engineer",
    ]);
  const run = await ok(
    user,
    `/${w.id}/workflows`,
    "POST",
    {
      kind: "feature",
      title: "Build pricing page",
      body: "Make prices understandable",
    },
    randomUUID(),
  );
  let complete = false;
  let engineeringAuthor = "";
  for (let iteration = 0; iteration < 45; iteration++) {
    const state = await pump(run.id);
    if (state.stage === "completed") {
      complete = true;
      break;
    }
    for (const person of [user, "engineer_a", "engineer_b"])
      for (const task of await ok(person, `/${w.id}/tasks`)) {
        if (task.kind === "engineer_interview") engineeringAuthor = person;
        if (task.kind === "peer_review")
          assert.notEqual(person, engineeringAuthor);
        await ok(
          person,
          `/${w.id}/tasks/${task.id}/responses`,
          "POST",
          {
            revision: task.revision,
            response: {
              decision: ["approval", "peer_review"].includes(task.kind)
                ? "approved"
                : "answered",
              text: "Requirements and feedback",
            },
          },
          randomUUID(),
        );
      }
    for (let n = 0; n < 3; n++) {
      const job = await ok(user, `/${w.id}/jobs/claim`, "POST", {});
      if (!job) break;
      const result =
        job.action === "classify"
          ? { domain: "pricing", reason: "Pricing" }
          : job.action === "map"
            ? {
                destination: "Clear pricing",
                acceptanceCriteria: ["Readable"],
                notes: [],
                decisions: [],
                suspectedDecisions: ["Future scale"],
                ruledOut: [],
                questions: [
                  {
                    id: "research-a",
                    title: "Research A",
                    kind: "research",
                    blockedBy: [],
                  },
                  {
                    id: "research-b",
                    title: "Research B",
                    kind: "research",
                    blockedBy: [],
                  },
                  {
                    id: "react",
                    title: "React to findings",
                    kind: "conversation",
                    blockedBy: ["research-a", "research-b"],
                  },
                  {
                    id: "prototype",
                    title: "Rough UI",
                    kind: "prototype",
                    blockedBy: ["react"],
                  },
                ],
              }
            : job.action === "draft"
              ? {
                  title: "Approved plan",
                  body: "Technical design and acceptance checks",
                }
              : {
                  text:
                    job.action === "prototype"
                      ? "<h1>Pricing prototype</h1>"
                      : "Research findings",
                };
      await ok(user, `/${w.id}/jobs/${job.id}/complete`, "POST", {
        lease: job.lease_token,
        result,
      });
    }
  }
  assert.equal(complete, true);
  assert.equal((await readRecord(w.id, run.record_id)).area, "canonical");
  const questions = (
    await db.query(
      "SELECT * FROM brain_index WHERE workspace_id=$1 AND record_id<>$2",
      [w.id, run.record_id],
    )
  ).rows;
  assert.equal(questions.length, 4);
});

test("review assignments recover partially created tasks and preserve routing policy", async () => {
  const { user, w } = await company();
  const engineer = "engineer_ack";
  await db.query("INSERT INTO memberships VALUES($1,$2,$3)", [
    w.id,
    engineer,
    "engineer",
  ]);
  const run = await ok(
    user,
    `/${w.id}/workflows`,
    "POST",
    { kind: "adr", title: "Routed ADR", body: "Proposal" },
    randomUUID(),
  );
  await ok(user, `/${w.id}/workflows/${run.id}/rules/pricing`, "PUT", {
    approverRole: "owner",
    acknowledgmentRoles: ["engineer"],
  });
  await pump(run.id);
  const job = await ok(user, `/${w.id}/jobs/claim`, "POST", {});
  await ok(user, `/${w.id}/jobs/${job.id}/complete`, "POST", {
    lease: job.lease_token,
    result: { domain: "pricing", reason: "Price" },
  });
  await pump(run.id);
  await pump(run.id);
  const original = (await ok(engineer, `/${w.id}/tasks`))[0];
  assert.equal(original.kind, "acknowledgment");
  await db.query("DELETE FROM tasks WHERE id=$1", [original.id]);
  await ok(user, `/${w.id}/workflows/${run.id}/rules/pricing`, "PUT", {
    approverRole: "engineer",
  });
  await pump(run.id);
  const recovered = (await ok(engineer, `/${w.id}/tasks`))[0];
  assert.equal(recovered.kind, "acknowledgment");
  const approval = (await ok(user, `/${w.id}/tasks`))[0];
  await ok(
    user,
    `/${w.id}/tasks/${approval.id}/responses`,
    "POST",
    {
      revision: approval.revision,
      response: { decision: "approved", text: "Approved" },
    },
    randomUUID(),
  );
  assert.notEqual((await pump(run.id)).stage, "completed");
  await db.query(
    "UPDATE memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
    [w.id, engineer],
  );
  assert.equal(
    (
      await request(
        engineer,
        `/${w.id}/tasks/${recovered.id}/responses`,
        "POST",
        {
          revision: recovered.revision,
          response: { decision: "acknowledged" },
        },
        randomUUID(),
      )
    ).statusCode,
    403,
  );
  await db.query(
    "UPDATE memberships SET role='engineer' WHERE workspace_id=$1 AND user_id=$2",
    [w.id, engineer],
  );
  await ok(
    engineer,
    `/${w.id}/tasks/${recovered.id}/responses`,
    "POST",
    { revision: recovered.revision, response: { decision: "acknowledged" } },
    randomUUID(),
  );
  assert.equal((await pump(run.id)).stage, "completed");
  const record = await readRecord(w.id, run.record_id);
  assert.equal(
    (record.data!.policies as any[]).find((p) => p.policy)?.policy
      .approver_role,
    "owner",
  );
});

test("Finix webhook authenticates raw payloads, rejects replay, and deduplicates receipts", async () => {
  const { createHmac } = await import("node:crypto");
  const { w, user } = await company();
  assert.equal(
    (await request(user, `/${w.id}/payments/sync`, "POST")).statusCode,
    409,
  );
  await db.query(
    "INSERT INTO integration_connections(credential_slot,workspace_id) VALUES('finix_sandbox',$1)",
    [w.id],
  );
  const other = await company();
  assert.equal(
    (await request(other.user, `/${other.w.id}/payments/sync`, "POST"))
      .statusCode,
    409,
  );
  await assert.rejects(
    db.query(
      "INSERT INTO integration_connections(credential_slot,workspace_id) VALUES('finix_sandbox',$1)",
      [other.w.id],
    ),
    { code: "23505" },
  );
  const originalFetch = globalThis.fetch;
  const originalUsername = process.env.FINIX_USERNAME;
  const originalPassword = process.env.FINIX_PASSWORD;
  process.env.FINIX_USERNAME = "integration-user";
  process.env.FINIX_PASSWORD = "integration-password";
  globalThis.fetch = async () =>
    Response.json({ _embedded: { transfers: [] } });
  try {
    assert.deepEqual(await ok(user, `/${w.id}/payments/sync`, "POST"), {
      imported: 0,
    });
    const reader = `user_${randomUUID()}`;
    await db.query(
      "INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'member')",
      [w.id, reader],
    );
    assert.deepEqual(await ok(reader, `/${w.id}/payments?refresh=true`), []);
    assert.equal(
      (await request(other.user, `/${other.w.id}/payments?refresh=true`))
        .statusCode,
      409,
    );
    assert.equal(
      (await request(other.user, `/${w.id}/payments?refresh=true`)).statusCode,
      403,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUsername === undefined) delete process.env.FINIX_USERNAME;
    else process.env.FINIX_USERNAME = originalUsername;
    if (originalPassword === undefined) delete process.env.FINIX_PASSWORD;
    else process.env.FINIX_PASSWORD = originalPassword;
  }
  process.env.FINIX_WEBHOOK_SECRET = "webhook-test";
  process.env.FINIX_WEBHOOK_TOKEN = "bearer-test";
  const timestamp = Math.floor(Date.now() / 1000);
  const raw = JSON.stringify({
    id: `event_${randomUUID()}`,
    _embedded: { transfers: [] },
  });
  const sig = createHmac("sha256", "webhook-test")
    .update(`${timestamp}:${raw}`)
    .digest("hex");
  const headers = {
    "content-type": "application/json",
    "finix-signature": `timestamp=${timestamp}, sig=${sig}`,
    authorization: "Bearer bearer-test",
  };
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/webhooks/finix",
        headers,
        payload: raw + " ",
      })
    ).statusCode,
    401,
  );
  for (let n = 0; n < 2; n++)
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/webhooks/finix",
          headers,
          payload: raw,
        })
      ).statusCode,
      200,
    );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS count FROM webhook_receipts WHERE workspace_id=$1",
        [w.id],
      )
    ).rows[0].count,
    1,
  );
  await db.query("DELETE FROM integration_connections WHERE workspace_id=$1", [
    w.id,
  ]);
});

test("team invitations expire, revoke, accept once, and enforce membership administration", async () => {
  const { user: owner, w } = await company();
  const outsider = `user_${randomUUID()}`;
  const invitee = `user_${randomUUID()}`;
  await ok(owner, "/profile", "PUT", { displayName: "Workspace owner" });
  assert.equal(
    (await ok(owner, `/${w.id}/members`))[0].display_name,
    "Workspace owner",
  );
  assert.equal(
    (await request(outsider, `/${w.id}/invitations`, "POST", { role: "owner" }))
      .statusCode,
    403,
  );
  const invite = await ok(owner, `/${w.id}/invitations`, "POST", {
    role: "engineer",
    label: "Engineering",
    expiresInDays: 7,
  });
  const listed = await ok(owner, `/${w.id}/invitations`);
  assert.equal(listed[0].status, "pending");
  assert.equal(listed[0].token, undefined);
  assert.equal(listed[0].token_hash, undefined);
  const attempts = await Promise.all([
    request(invitee, "/invitations/accept", "POST", { token: invite.token }),
    request(outsider, "/invitations/accept", "POST", { token: invite.token }),
  ]);
  assert.deepEqual(attempts.map((r) => r.statusCode).sort(), [200, 409]);
  const member = attempts[0].statusCode === 200 ? invitee : outsider;
  assert.equal(
    (await ok(member, "/invitations/accept", "POST", { token: invite.token }))
      .workspaceId,
    w.id,
  );
  assert.equal((await request(member, `/${w.id}/invitations`)).statusCode, 403);
  assert.equal(
    (
      await request(member, `/${w.id}/members/${owner}`, "PUT", {
        role: "member",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await request(member, `/${w.id}/members/${owner}`, "DELETE")).statusCode,
    403,
  );
  assert.equal(
    (await request(owner, `/${w.id}/members/${owner}`, "DELETE")).statusCode,
    409,
  );
  assert.equal(
    (
      await request(owner, `/${w.id}/members/${owner}`, "PUT", {
        role: "member",
      })
    ).statusCode,
    409,
  );
  await ok(owner, `/${w.id}/members/${member}`, "PUT", { role: "product" });
  assert.equal(
    (await ok(member, "/workspaces")).find((row: any) => row.id === w.id).role,
    "product",
  );
  const second = await company();
  assert.equal(
    (
      await request(
        second.user,
        `/${second.w.id}/invitations/${invite.id}`,
        "DELETE",
      )
    ).statusCode,
    404,
  );
  const revoked = await ok(owner, `/${w.id}/invitations`, "POST", {
    role: "member",
  });
  await ok(owner, `/${w.id}/invitations/${revoked.id}`, "DELETE");
  assert.equal(
    (
      await request(invitee, "/invitations/accept", "POST", {
        token: revoked.token,
      })
    ).statusCode,
    410,
  );
  const expired = await ok(owner, `/${w.id}/invitations`, "POST", {
    role: "member",
  });
  await db.query(
    "UPDATE invitations SET expires_at=now()-interval '1 day' WHERE id=$1",
    [expired.id],
  );
  assert.equal(
    (
      await request(invitee, "/invitations/accept", "POST", {
        token: expired.token,
      })
    ).statusCode,
    410,
  );
  await ok(owner, `/${w.id}/members/${member}`, "DELETE");
  assert.equal((await request(member, `/${w.id}/members`)).statusCode, 403);
  assert.equal(
    (
      await request(member, "/invitations/accept", "POST", {
        token: invite.token,
      })
    ).statusCode,
    410,
  );
  const next = await ok(owner, `/${w.id}/invitations`, "POST", {
    role: "engineer",
  });
  await ok(member, "/invitations/accept", "POST", { token: next.token });
  await ok(
    member,
    `/${w.id}/workflows`,
    "POST",
    {
      kind: "adr",
      title: "Active ownership",
      body: "Do not abandon this work",
    },
    randomUUID(),
  );
  assert.equal(
    (await request(owner, `/${w.id}/members/${member}`, "DELETE")).statusCode,
    409,
  );
});

test("review rules belong to individual workflows, with scoped authorization", async () => {
  const { user, w } = await company();
  const a = await ok(
    user,
    `/${w.id}/workflows`,
    "POST",
    { kind: "adr", title: "First", body: "First proposal" },
    randomUUID(),
  );
  const b = await ok(
    user,
    `/${w.id}/workflows`,
    "POST",
    { kind: "adr", title: "Second", body: "Second proposal" },
    randomUUID(),
  );
  await ok(user, `/${w.id}/workflows/${a.id}/rules/pricing`, "PUT", {
    approverRole: "engineer",
  });
  assert.equal(
    (await ok(user, `/${w.id}/workflows/${b.id}/rules`))[0].approver_role,
    "owner",
  );
  assert.equal(
    (await ok(user, `/${w.id}/workflows/${a.id}/rules`))[0].approver_role,
    "engineer",
  );
  assert.equal((await request(user, `/${w.id}/rules`)).statusCode, 404);
  const other = await company();
  assert.equal(
    (await request(other.user, `/${other.w.id}/workflows/${a.id}/rules`))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await request(
        other.user,
        `/${other.w.id}/workflows/${a.id}/rules/pricing`,
        "PUT",
        { approverRole: "owner" },
      )
    ).statusCode,
    404,
  );
  const member = `user_${randomUUID()}`;
  await db.query(
    "INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'engineer')",
    [w.id, member],
  );
  assert.equal(
    (
      await request(member, `/${w.id}/workflows/${a.id}/rules/pricing`, "PUT", {
        approverRole: "engineer",
      })
    ).statusCode,
    403,
  );
  await db.query("UPDATE workflow_runs SET stage='completed' WHERE id=$1", [
    a.id,
  ]);
  assert.equal(
    (
      await request(user, `/${w.id}/workflows/${a.id}/rules/pricing`, "PUT", {
        approverRole: "owner",
      })
    ).statusCode,
    409,
  );
});
