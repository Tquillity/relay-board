// Plan usage (PROTOCOL.md, usage): readings, interpolation, and the projection to the weekly reset.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, reading, weekOfReadings, NOW, MINUTE, HOUR, DAY, WEEK } from "./helpers.mjs";

const core = loadCore();
const project = (usage, now = NOW) => core.projectWeek(usage, "weekAll", now);

// This week resets in 3 days, so it started 4 days ago.
const RESET = NOW + 3 * DAY;
const START = RESET - WEEK;

// ---- Readings ----

test("readings keep valid values for one limit, oldest first", () => {
  const usage = [
    reading(NOW, 40, RESET),
    reading(NOW - HOUR, 30, RESET),
    { at: "bad", weekAll: { pct: 1, resetsAt: new Date(RESET).toISOString() } },
    { at: new Date(NOW).toISOString(), weekAll: { pct: "50", resetsAt: new Date(RESET).toISOString() } },
    { at: new Date(NOW).toISOString(), weekAll: { pct: NaN, resetsAt: new Date(RESET).toISOString() } },
    { at: new Date(NOW).toISOString(), weekAll: { pct: 5 } },
    { at: new Date(NOW).toISOString() },
    { at: new Date(NOW).toISOString(), weekAll: null },
  ];
  assert.deepEqual(core.readings(usage, "weekAll"), [
    { at: NOW - HOUR, pct: 30, resetsAt: RESET },
    { at: NOW, pct: 40, resetsAt: RESET },
  ]);
  assert.deepEqual(core.readings(usage, "weekFable"), []);
  assert.deepEqual(core.readings(undefined, "weekAll"), []);
});

test("valueAt interpolates between readings from 0 at the week start", () => {
  const week = [{ at: START + DAY, pct: 10 }, { at: START + 3 * DAY, pct: 30 }];
  assert.equal(core.valueAt(week, START, 0), 0);
  assert.equal(core.valueAt(week, START, -HOUR), 0);
  assert.equal(core.valueAt(week, START, DAY / 2), 5);
  assert.equal(core.valueAt(week, START, DAY), 10);
  assert.equal(core.valueAt(week, START, 2 * DAY), 20);
  assert.equal(core.valueAt(week, START, 3 * DAY), 30);
});

test("valueAt has no value beyond the last reading", () => {
  assert.equal(core.valueAt([{ at: START + DAY, pct: 10 }], START, 2 * DAY), null);
  assert.equal(core.valueAt([], START, HOUR), null);
});

test("readings older than 15 days are stale", () => {
  const usage = [reading(NOW - 15 * DAY, 1, RESET), reading(NOW - 15 * DAY - 1, 1, RESET), reading(NOW, 1, RESET), { at: "bad" }];
  assert.deepEqual(core.staleReadings(usage, NOW).map((r) => r.at), [new Date(NOW - 15 * DAY - 1).toISOString()]);
  assert.deepEqual(core.staleReadings(undefined, NOW), []);
});

// ---- Projection ----

test("no readings, no projection", () => {
  assert.equal(project([]), null);
});

test("once the reset time has passed, the week shows as reset", () => {
  const p = project([reading(NOW - 2 * DAY, 90, NOW - MINUTE)]);
  assert.equal(p.kind, "reset");
  assert.equal(p.pct, 90);
  assert.equal(project([reading(NOW - DAY, 50, NOW)]).kind, "reset");
});

test("it is too early to project in the first 12 hours of a week", () => {
  const reset = NOW + WEEK - 6 * HOUR; // the week started 6 hours ago
  const p = project([reading(NOW, 5, reset)]);
  assert.equal(p.kind, "early");
  assert.equal(p.projected, undefined);
});

test("exactly 12 hours in is no longer too early", () => {
  const reset = NOW + WEEK - 12 * HOUR;
  assert.notEqual(project([reading(NOW, 5, reset)]).kind, "early");
});

test("without last week's data it projects the week so far", () => {
  // 40% in 4 days is 10%/day; 3 days left → 70%
  const p = project([reading(NOW - DAY, 20, RESET), reading(NOW, 40, RESET)]);
  assert.equal(p.basis, "this week so far");
  assert.equal(p.kind, "ok");
  assert.ok(Math.abs(p.projected - 70) < 1e-9);
  assert.equal(p.runOut, null);
});

test("with a reading 36 hours back it projects the trailing rate", () => {
  // 30% → 40% over 2 days is 5%/day; 3 days left → 55% (the week so far would say 70%)
  const p = project([reading(NOW - 2 * DAY, 30, RESET), reading(NOW - DAY, 35, RESET), reading(NOW, 40, RESET)]);
  assert.equal(p.basis, "the last 36 hours");
  assert.ok(Math.abs(p.projected - 55) < 1e-9);
});

test("the trailing window needs a reading at least 36 hours old", () => {
  const p = project([reading(NOW - 36 * HOUR + 1, 30, RESET), reading(NOW, 40, RESET)]);
  assert.equal(p.basis, "this week so far");
  assert.equal(project([reading(NOW - 36 * HOUR, 30, RESET), reading(NOW, 40, RESET)]).basis, "the last 36 hours");
});

test("a projection between 90% and 100% is a warning", () => {
  // 70% → 80% over 2 days: 5%/day → 95%
  const p = project([reading(NOW - 2 * DAY, 70, RESET), reading(NOW, 80, RESET)]);
  assert.equal(p.kind, "warn");
  assert.equal(p.runOut, null);
});

test("a projection over 100% is bad and says when it runs out", () => {
  // 40% → 80% over 2 days: 20%/day → 140%; the last 20% goes in one day
  const p = project([reading(NOW - 2 * DAY, 40, RESET), reading(NOW, 80, RESET)]);
  assert.equal(p.kind, "bad");
  assert.ok(Math.abs(p.projected - 140) < 1e-9);
  assert.ok(Math.abs(p.runOut - (NOW + DAY)) < 1);
});

test("falling usage never projects below the current value", () => {
  const p = project([reading(NOW - 2 * DAY, 50, RESET), reading(NOW, 40, RESET)]);
  assert.equal(p.projected, 40);
  assert.equal(p.runOut, null);
});

test("readings a few seconds apart in resetsAt still count as the same week", () => {
  const p = project([reading(NOW - 2 * DAY, 30, RESET + 30e3), reading(NOW, 40, RESET)]);
  assert.equal(p.week.length, 2);
  assert.equal(p.basis, "the last 36 hours");
});

// Last week: 10% a day, one reading per day, the last one at its reset.
const lastWeek = (days = [1, 2, 3, 4, 5, 6, 7]) => weekOfReadings(RESET - WEEK, days, (d) => 10 * d);

test("with a full last week it follows last week's rhythm", () => {
  // Last week was at 40% by this point and ended at 70%. This week is at half that pace (20%),
  // so the rest adds half of last week's remaining 30%: 35%.
  const p = project([...lastWeek(), reading(NOW, 20, RESET)]);
  assert.equal(p.basis, "last week's rhythm");
  assert.equal(p.kind, "ok");
  assert.equal(p.projected, 35);
  assert.equal(p.lastWeek.length, 7);
  assert.equal(p.week.length, 1);
});

test("last week's rhythm can run out before the reset", () => {
  // Twice last week's pace: 80% now, +2 × 30% → 140%. It reaches 100% when last week reached 50%, on day 5.
  const p = project([...lastWeek(), reading(NOW, 80, RESET)]);
  assert.equal(p.kind, "bad");
  assert.equal(p.projected, 140);
  assert.equal(p.runOut, START + 5 * DAY);
});

test("last week's rhythm needs at least 4 readings", () => {
  const p = project([...lastWeek([1, 4, 7]), reading(NOW - 2 * DAY, 10, RESET), reading(NOW, 20, RESET)]);
  assert.equal(p.basis, "the last 36 hours");
});

test("last week's rhythm needs readings into its final 12 hours", () => {
  const p = project([...lastWeek([1, 2, 3, 4, 5, 6]), reading(NOW - 2 * DAY, 10, RESET), reading(NOW, 20, RESET)]);
  assert.equal(p.basis, "the last 36 hours");
  const edge = [...lastWeek([1, 2, 3, 4, 5]), reading(START - 12 * HOUR, 65, START)];
  assert.equal(project([...edge, reading(NOW, 20, RESET)]).basis, "last week's rhythm");
});

test("last week's rhythm is skipped when either week has barely started using the plan", () => {
  // This week under 2%
  assert.notEqual(project([...lastWeek(), reading(NOW, 1, RESET)]).basis, "last week's rhythm");
  // Last week under 3% at this point
  const quiet = weekOfReadings(RESET - WEEK, [1, 2, 3, 4, 5, 6, 7], (d) => (d <= 4 ? 0.5 * d : 50));
  assert.notEqual(project([...quiet, reading(NOW, 20, RESET)]).basis, "last week's rhythm");
});

test("pace marks where even use would be by now, and perDay the budget left per day", () => {
  const p = project([reading(NOW, 40, RESET)]);
  assert.ok(Math.abs(p.pace - (4 / 7) * 100) < 1e-9);
  assert.ok(Math.abs(p.perDay - 20) < 1e-9); // 60% left over 3 days
  assert.equal(p.start, START);
  assert.equal(p.resetsAt, RESET);
  assert.equal(p.at, NOW);
});

test("perDay is left out in the last hour or so of the week", () => {
  assert.equal(project([reading(NOW - DAY, 80, NOW + HOUR)]).perDay, null);
});

test("pace never goes past 100%, even long after the reset", () => {
  assert.equal(project([reading(NOW - 3 * WEEK, 80, NOW - 2 * WEEK)]).pace, 100);
});
