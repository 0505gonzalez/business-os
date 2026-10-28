import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  verifySignature,
  listFinixPayments,
} from "../packages/backend/src/finix.js";
test("webhook signatures bind raw bytes and reject replay", () => {
  const raw = Buffer.from('{"id":"event"}'),
    now = Date.now(),
    timestamp = Math.floor(now / 1000),
    secret = "test-secret";
  const sig = createHmac("sha256", secret)
    .update(`${timestamp}:`)
    .update(raw)
    .digest("hex");
  assert.equal(
    verifySignature(raw, `timestamp=${timestamp}, sig=${sig}`, secret, now),
    true,
  );
  assert.equal(
    verifySignature(
      Buffer.from('{"id":"changed"}'),
      `timestamp=${timestamp}, sig=${sig}`,
      secret,
      now,
    ),
    false,
  );
  assert.equal(
    verifySignature(
      raw,
      `timestamp=${timestamp}, sig=${sig}`,
      secret,
      now + 301000,
    ),
    false,
  );
  assert.equal(verifySignature(raw, "malformed", secret, now), false);
});
test("Finix import follows pagination and cannot send credentials to another origin", async (t) => {
  process.env.FINIX_USERNAME = "test";
  process.env.FINIX_PASSWORD = "test";
  let count = 0;
  t.mock.method(globalThis, "fetch", async () => {
    count++;
    return Response.json(
      count === 1
        ? {
            _embedded: { transfers: [{ id: "one" }] },
            _links: { next: { href: "/transfers?page=2" } },
          }
        : { _embedded: { transfers: [{ id: "two" }] } },
    );
  });
  assert.deepEqual(
    (await listFinixPayments()).map((p) => p.id),
    ["one", "two"],
  );
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      _links: { next: { href: "https://attacker.example/transfers" } },
    }),
  );
  await assert.rejects(listFinixPayments, /pagination left/);
});
