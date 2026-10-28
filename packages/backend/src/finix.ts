import { createHmac, timingSafeEqual } from "node:crypto";
import { db, transaction } from "./database.js";
import { AppError } from "./errors.js";
const origin = "https://finix.sandbox-payments-api.com";
async function connectedWorkspace(): Promise<string | undefined> {
  const result = await db.query(
    "SELECT workspace_id FROM integration_connections WHERE credential_slot='finix_sandbox'",
  );
  return result.rows[0]?.workspace_id;
}
async function request(path: string) {
  const username = process.env.FINIX_USERNAME,
    password = process.env.FINIX_PASSWORD;
  if (!username || !password)
    throw new AppError(503, "Finix sandbox connection is not configured");
  const url = new URL(path, origin);
  if (url.origin !== origin)
    throw new Error("Finix pagination left the configured endpoint");
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      "Finix-Version": "2022-02-01",
      Accept: "application/hal+json",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new AppError(502, `Finix returned ${response.status}`);
  return response.json();
}
export async function listFinixPayments() {
  let path: string | undefined = "/transfers?limit=100";
  const result: Record<string, unknown>[] = [];
  const visited = new Set<string>();
  while (path) {
    if (visited.has(path)) throw new Error("Repeated Finix page");
    visited.add(path);
    const body = await request(path);
    result.push(...(body._embedded?.transfers ?? []));
    path = body._links?.next?.href;
  }
  return result;
}
export async function syncPayments(workspaceId: string) {
  if (workspaceId !== (await connectedWorkspace()))
    throw new AppError(409, "Finix is not configured for this workspace");
  const transfers = await listFinixPayments();
  await transaction(async (c) => {
    for (const p of transfers)
      await c.query(
        "INSERT INTO payments VALUES($1,$2,$3) ON CONFLICT(workspace_id,external_id) DO UPDATE SET data=excluded.data",
        [workspaceId, p.id, p],
      );
  });
  return { imported: transfers.length };
}
export function verifySignature(
  raw: Buffer,
  header: string,
  secret: string,
  now = Date.now(),
) {
  const timestamp = header.match(/timestamp=(\d+)/)?.[1];
  if (!timestamp || Math.abs(now / 1000 - Number(timestamp)) > 300)
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}:`)
    .update(raw)
    .digest();
  return [...header.matchAll(/sig=([a-fA-F0-9]{64})(?:,|$)/g)].some((match) =>
    timingSafeEqual(expected, Buffer.from(match[1], "hex")),
  );
}
export async function processWebhook(
  raw: Buffer,
  signature: string,
  authorization: string,
) {
  const secret = process.env.FINIX_WEBHOOK_SECRET,
    token = process.env.FINIX_WEBHOOK_TOKEN;
  if (!secret || !token)
    throw new AppError(503, "Finix webhook is not configured");
  const actual = Buffer.from(authorization),
    expected = Buffer.from(`Bearer ${token}`);
  if (
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected) ||
    !verifySignature(raw, signature, secret)
  )
    throw new AppError(401, "Invalid webhook signature");
  const workspaceId = await connectedWorkspace();
  if (!workspaceId)
    throw new AppError(503, "Finix webhook is not connected to a workspace");
  const event = JSON.parse(raw.toString());
  if (typeof event.id !== "string") throw new AppError(400, "Missing event ID");
  if (
    (await db.query("SELECT 1 FROM webhook_receipts WHERE id=$1", [event.id]))
      .rowCount
  )
    return { ok: true };
  // Read current Finix state so delayed events cannot roll the local projection backwards.
  const transfers: Record<string, unknown>[] = [];
  for (const transfer of event._embedded?.transfers ?? []) {
    if (typeof transfer.id === "string")
      transfers.push(
        await request(`/transfers/${encodeURIComponent(transfer.id)}`),
      );
  }
  await transaction(async (c) => {
    const inserted = await c.query(
      "INSERT INTO webhook_receipts(id,workspace_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id",
      [event.id, workspaceId],
    );
    if (!inserted.rowCount) return;
    for (const transfer of transfers)
      await c.query(
        "INSERT INTO payments VALUES($1,$2,$3) ON CONFLICT(workspace_id,external_id) DO UPDATE SET data=excluded.data",
        [workspaceId, transfer.id, transfer],
      );
    await c.query(
      "INSERT INTO events(workspace_id,kind,payload) VALUES($1,$2,$3)",
      [workspaceId, "payments.updated", { count: transfers.length }],
    );
  });
  return { ok: true };
}
