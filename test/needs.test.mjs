// "Needs you" items: answer state, snoozing, what counts as open and actionable, and panel groups.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, board, need, NOW, MINUTE, HOUR, DAY, before, after } from "./helpers.mjs";

const core = loadCore();
const ids = (list) => list.map((n) => n.id);

test("answerState is null without an answer and defaults to answered", () => {
  assert.equal(core.answerState(need()), null);
  assert.equal(core.answerState(need({ answerState: "relayed" })), null);
  assert.equal(core.answerState(need({ answer: { choice: "Yes" } })), "answered");
  assert.equal(core.answerState(need({ answer: { choice: "Yes" }, answerState: "handled" })), "handled");
});

test("a need is snoozed only while snoozedUntil is in the future", () => {
  assert.equal(core.isSnoozed(need({ snoozedUntil: after(1) }), NOW), true);
  assert.equal(core.isSnoozed(need({ snoozedUntil: before(0) }), NOW), false);
  assert.equal(core.isSnoozed(need({ snoozedUntil: before(MINUTE) }), NOW), false);
  assert.equal(core.isSnoozed(need({ snoozedUntil: null }), NOW), false);
  assert.equal(core.isSnoozed(need({ snoozedUntil: "soon" }), NOW), false);
});

test("open needs are the ones not done, for one project or all", () => {
  const data = board({ needs: [need({ id: "a" }), need({ id: "b", done: true }), need({ id: "c", project: "other" })] });
  assert.deepEqual(ids(core.openNeeds(data, "demo")), ["a"]);
  assert.deepEqual(ids(core.openNeeds(data, null)), ["a", "c"]);
  assert.deepEqual(core.openNeeds(board(), null), []);
});

test("actionable needs leave out snoozed, answered, relayed and handled items", () => {
  const needs = [
    need({ id: "open" }),
    need({ id: "snoozed", snoozedUntil: after(HOUR) }),
    need({ id: "snooze-over", snoozedUntil: before(HOUR) }),
    need({ id: "answered", answer: { choice: "Yes" } }),
    need({ id: "relayed", answer: { choice: "Yes" }, answerState: "relayed" }),
    need({ id: "handled", answer: { choice: "Yes" }, answerState: "handled" }),
    need({ id: "done", done: true }),
  ];
  assert.deepEqual(ids(core.actionable(board({ needs }), "demo", NOW)), ["open", "snooze-over"]);
});

test("the panel lists unanswered items high priority first, then oldest first", () => {
  const needs = [
    need({ id: "new", createdAt: before(MINUTE) }),
    need({ id: "old", createdAt: before(DAY) }),
    need({ id: "urgent", priority: "high", createdAt: before(MINUTE) }),
  ];
  assert.deepEqual(ids(core.needsGroups(board({ needs }), "demo", NOW).act), ["urgent", "old", "new"]);
});

test("the panel puts answered items in their own group, newest answer first", () => {
  const needs = [
    need({ id: "first", answer: { choice: "A", at: before(HOUR) } }),
    need({ id: "second", answer: { choice: "B", at: before(MINUTE) }, answerState: "relayed" }),
    need({ id: "handled", answer: { choice: "C", at: before(DAY) }, answerState: "handled" }),
  ];
  const g = core.needsGroups(board({ needs }), "demo", NOW);
  assert.deepEqual(ids(g.answered), ["second", "first", "handled"]);
  assert.deepEqual(g.act, []);
});

test("the panel folds snoozed items away, soonest back first", () => {
  const needs = [need({ id: "week", snoozedUntil: after(7 * DAY) }), need({ id: "hour", snoozedUntil: after(HOUR) })];
  const g = core.needsGroups(board({ needs }), "demo", NOW);
  assert.deepEqual(ids(g.snoozed), ["hour", "week"]);
  assert.deepEqual(g.act, []);
});

test("the panel's done list keeps the last 7 days and undated items, newest first", () => {
  const needs = [
    need({ id: "today", done: true, doneAt: before(HOUR) }),
    need({ id: "week", done: true, doneAt: before(7 * DAY) }),
    need({ id: "older", done: true, doneAt: before(7 * DAY + 1) }),
    need({ id: "undated", done: true, doneAt: null, createdAt: null }),
  ];
  assert.deepEqual(ids(core.needsGroups(board({ needs }), "demo", NOW).done), ["today", "week", "undated"]);
});

test("the overview panel covers every project; a project panel only its own", () => {
  const needs = [need({ id: "a" }), need({ id: "b", project: "other" })];
  assert.deepEqual(ids(core.needsGroups(board({ needs }), null, NOW).act), ["a", "b"]);
  assert.deepEqual(ids(core.needsGroups(board({ needs }), "other", NOW).act), ["b"]);
});
