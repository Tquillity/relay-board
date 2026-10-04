// What a collapsed workstream panel summarises: step counts and blockers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, stream, step } from "./helpers.mjs";

const core = loadCore();
const counts = (fields) => core.streamCounts(stream(fields));

test("a stream without steps or blockers has all-zero counts", () => {
  const zero = { done: 0, left: 0, total: 0, you: 0, blockers: 0, highBlockers: 0 };
  assert.deepEqual(counts({ steps: [] }), zero);
  assert.deepEqual(counts({ steps: undefined }), zero);
  assert.deepEqual(core.streamCounts(null), zero);
});

test("counts done and remaining steps", () => {
  const c = counts({ steps: [step("done"), step("done"), step("active"), step("todo"), step("blocked"), step("waiting"), step("todo")] });
  assert.equal(c.done, 2);
  assert.equal(c.left, 5);
  assert.equal(c.total, 7);
});

test("counts open steps for the user, not the finished ones", () => {
  const c = counts({ steps: [step("todo", "S", { by: "you" }), step("waiting", "M", { by: "you" }), step("done", "S", { by: "you" }), step("todo", "S", { by: "claude" })] });
  assert.equal(c.you, 2);
  assert.equal(c.left, 3);
});

test("counts blockers and the high-severity ones", () => {
  const c = counts({ blockers: [{ text: "a", severity: "high" }, { text: "b", severity: "normal" }, { text: "c" }] });
  assert.equal(c.blockers, 3);
  assert.equal(c.highBlockers, 1);
});

test("malformed steps and blockers are ignored", () => {
  const c = counts({ steps: [null, "text", 5, step("done"), step("todo")], blockers: [null, "x", { text: "real", severity: "high" }] });
  assert.deepEqual(c, { done: 1, left: 1, total: 2, you: 0, blockers: 1, highBlockers: 1 });
  assert.deepEqual(counts({ steps: { weird: true }, blockers: "none" }), { done: 0, left: 0, total: 0, you: 0, blockers: 0, highBlockers: 0 });
});
