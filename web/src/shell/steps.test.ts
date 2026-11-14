import test from "node:test";
import assert from "node:assert/strict";
import { stepStates } from "./steps.ts";

test("stepStates: nothing found means still watching on step 1", () => {
  assert.deepEqual(stepStates(undefined, 0), ["now", "idle", "idle"]);
});

test("stepStates: a candidate is being tracked, an active tower is being warned about", () => {
  assert.deepEqual(stepStates("candidate", 0), ["done", "now", "idle"]);
  assert.deepEqual(stepStates("active", 0), ["done", "done", "now"]);
  assert.deepEqual(stepStates("active", 34), ["done", "done", "now"]);
});

test("stepStates: a tower that went quiet only counts Warn as done if phones were warned", () => {
  assert.deepEqual(stepStates("dormant", 34), ["done", "done", "done"]);
  assert.deepEqual(stepStates("dormant", 0), ["done", "done", "idle"]);
});
