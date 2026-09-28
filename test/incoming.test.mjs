// Cleaning incoming docs: one malformed doc must never break the page, and the store's doc id wins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, board, NOW } from "./helpers.mjs";

const core = loadCore();

test("a doc that isn't an object is dropped", () => {
  for (const raw of [null, undefined, "text", 42, true, [1, 2]]) assert.equal(core.normalize("streams", "x", raw), null);
});

test("the store's doc id wins over an id field in the data", () => {
  assert.equal(core.normalize("needs", "real-id", { id: "fake-id", title: "T" }).id, "real-id");
  assert.equal(core.normalize("streams", "p--a", { id: "p--b" }).id, "p--a");
});

test("stream and project lists keep only object entries", () => {
  const d = core.normalize("streams", "p--a", {
    project: "p",
    steps: [null, { title: "ok", state: "done" }, "text", 3, [1]],
    recent: [null, 5, { text: "shipped", at: "2026-09-28T10:00:00Z" }],
    blockers: [null, { text: "stuck" }],
    links: ["https://example.com", { label: "L", url: "https://example.com" }],
  });
  assert.deepEqual(d.steps, [{ title: "ok", state: "done" }]);
  assert.deepEqual(d.recent, [{ text: "shipped", at: "2026-09-28T10:00:00Z" }]);
  assert.deepEqual(d.blockers, [{ text: "stuck" }]);
  assert.deepEqual(d.links, [{ label: "L", url: "https://example.com" }]);
  assert.deepEqual(core.normalize("streams", "p--b", { steps: "not a list" }).steps, []);
  assert.deepEqual(core.normalize("projects", "p", { steps: [null] }).steps, []);
});

test("missing lists stay missing", () => {
  const d = core.normalize("streams", "p--a", { project: "p" });
  assert.deepEqual(Object.keys(d).sort(), ["id", "project"]);
});

test("need steps and options keep only text, a bare answer becomes a choice, and an empty one is no answer", () => {
  const d = core.normalize("needs", "n", { steps: ["one", null, { x: 1 }, 2], options: ["A", {}, "B"], answer: "Yes" });
  assert.deepEqual(d.steps, ["one", "2"]);
  assert.deepEqual(d.options, ["A", "B"]);
  assert.deepEqual(d.answer, { choice: "Yes" });
  assert.equal(core.normalize("needs", "n", { answer: null }).answer, null);
  for (const empty of [false, "", "  ", true, [1]]) assert.equal(core.normalize("needs", "n", { answer: empty }).answer, null, JSON.stringify(empty));
  assert.deepEqual(core.normalize("needs", "n", { answer: 2 }).answer, { choice: "2" });
  assert.equal(core.answerState(core.normalize("needs", "n", { answer: false, answerState: "answered" })), null);
  assert.deepEqual(core.normalize("needs", "n", { answer: { choice: "No" } }).answer, { choice: "No" });
});

test("cleaned malformed docs go through every calculation without throwing", () => {
  const streams = [
    core.normalize("streams", "p--a", { project: "p", status: "active", steps: [null, { state: "done" }], recent: [null, 1] }),
    core.normalize("streams", "p--b", { project: "p", status: "done", updatedAt: "2026-07-01T00:00:00Z", recent: "nope" }),
  ];
  const needs = [core.normalize("needs", "n", { project: "p", steps: [null], options: [{}], answer: 7, answerState: "relayed" })];
  const data = board({ streams, needs });
  assert.doesNotThrow(() => {
    core.orderedProjects(data, NOW);
    core.progressFor(data, "p");
    core.historyFor(data, "p", NOW);
    core.planArchive(data, NOW);
    core.digestData(data, 0, NOW);
    core.needsGroups(data, null, NOW);
  });
});
