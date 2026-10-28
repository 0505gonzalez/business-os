import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canApprove,
  validateQuestions,
} from "../packages/backend/src/governance.js";
test("rejects approval from another person and stale revisions", () => {
  const task = { assignee_id: "ceo", revision: 2, status: "ready" };
  assert.equal(canApprove(task, "engineer", 2), false);
  assert.equal(canApprove(task, "ceo", 1), false);
  assert.equal(canApprove(task, "ceo", 2), true);
});
test("rejects cycles and dangling question dependencies", () => {
  assert.throws(() =>
    validateQuestions([
      { id: "a", kind: "research", blockedBy: ["b"] },
      { id: "b", kind: "conversation", blockedBy: ["a"] },
    ]),
  );
  assert.throws(() =>
    validateQuestions([{ id: "a", kind: "research", blockedBy: ["missing"] }]),
  );
  validateQuestions([
    { id: "a", kind: "research", blockedBy: [] },
    { id: "b", kind: "prototype", blockedBy: ["a"] },
  ]);
});
