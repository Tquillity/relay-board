// Model usage: prices, ranges (today / 30 days / all), project and scope filters, and shares.
// "Today" is the viewer's local date, so these tests build their clock from local calendar parts and
// don't depend on the machine's time zone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, board, project } from "./helpers.mjs";

const core = loadCore();
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = at(2026, 9, 28);

const entry = (fields = {}) => ({ in: 0, out: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, msgs: 1, ...fields });
const doc = (date, projects) => ({ id: `d-${date}`, date, updatedAt: "2026-09-28T10:00:00Z", projects });
const near = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 1e-9, `${msg || ""} expected ${expected}, got ${actual}`);

test("prices are USD per million tokens, and unknown models are priced like Sonnet", () => {
  assert.deepEqual(core.PRICES.opus, { in: 4, out: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 });
  assert.deepEqual(core.PRICES.sonnet, { in: 2, out: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4 });
  assert.deepEqual(core.PRICES.haiku, { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite5m: 0.125, cacheWrite1h: 0.2 });
  assert.deepEqual(core.PRICES.fable, { in: 10, out: 50, cacheRead: 0.25, cacheWrite5m: 12.5, cacheWrite1h: 20 });
  assert.deepEqual(core.PRICES.other, core.PRICES.sonnet);
});

test("the cost of an entry adds each token kind at its own price", () => {
  const million = entry({ in: 1e6, out: 1e6, cacheRead: 1e6, cacheWrite5m: 1e6, cacheWrite1h: 1e6 });
  near(core.modelCost("opus", million), 4 + 20 + 0.2 + 5 + 8);
  near(core.modelCost("sonnet", million), 2 + 10 + 0.2 + 2.5 + 4);
  near(core.modelCost("haiku", million), 0.1 + 0.5 + 0.01 + 0.125 + 0.2);
  near(core.modelCost("fable", million), 10 + 50 + 0.25 + 12.5 + 20);
  near(core.modelCost("other", million), core.modelCost("sonnet", million));
  assert.equal(core.modelCost("opus", {}), 0);
});

test("a day's totals count tokens, tokens without cache reads, cost and messages", () => {
  const d = board({ models: [doc("2026-09-28", { a: { opus: entry({ in: 100, out: 200, cacheRead: 5000, cacheWrite5m: 10, cacheWrite1h: 20, msgs: 3 }) } })] });
  const u = core.modelUsage(d, { range: "today", now: NOW });
  assert.equal(u.hasData, true);
  assert.equal(u.total.tokens, 5330);
  assert.equal(u.total.billable, 330);
  assert.equal(u.total.msgs, 3);
  near(u.total.cost, (100 * 4 + 200 * 20 + 5000 * 0.2 + 10 * 5 + 20 * 8) / 1e6);
  assert.deepEqual(u.families.map((f) => f.family), ["opus", "sonnet", "haiku", "fable", "other"]);
  assert.equal(u.families[0].share, 100);
  assert.equal(u.families[1].share, 0);
});

test("shares are by estimated cost; token shares are exposed too", () => {
  // Same tokens, but Opus costs twice as much as Sonnet on input.
  const d = board({ models: [doc("2026-09-28", { a: { opus: entry({ in: 1e6 }), sonnet: entry({ in: 1e6 }) } })] });
  const u = core.modelUsage(d, { range: "today", now: NOW });
  const by = Object.fromEntries(u.families.map((f) => [f.family, f]));
  near(by.opus.share, (4 / 6) * 100);
  near(by.sonnet.share, (2 / 6) * 100);
  assert.equal(by.opus.tokenShare, 50);
  assert.equal(by.sonnet.tokenShare, 50);
  near(u.opusShare, (4 / 6) * 100);
  near(u.families.reduce((n, f) => n + f.share, 0), 100);
});

test("today is the viewer's local date, also just after midnight", () => {
  const d = board({ models: [
    doc("2026-09-28", { a: { sonnet: entry({ out: 1000 }) } }),
    doc("2026-09-27", { a: { sonnet: entry({ out: 5000 }) } }),
    doc("2026-09-29", { a: { sonnet: entry({ out: 9000 }) } }),
  ] });
  for (const now of [at(2026, 9, 28, 0, 5), at(2026, 9, 28, 12), at(2026, 9, 28, 23, 55)]) {
    assert.equal(core.modelUsage(d, { range: "today", now }).total.tokens, 1000, new Date(now).toString());
  }
  assert.equal(core.modelUsage(d, { range: "today", now: at(2026, 9, 29, 0, 5) }).total.tokens, 9000);
});

test("30 days is today and the 29 days before it, filled with empty days", () => {
  const d = board({ models: [
    doc("2026-08-30", { a: { sonnet: entry({ out: 1 }) } }), // 29 days back: in
    doc("2026-08-29", { a: { sonnet: entry({ out: 10 }) } }), // 30 days back: out
    doc("2026-09-28", { a: { sonnet: entry({ out: 100 }) } }),
  ] });
  const u = core.modelUsage(d, { range: "30d", now: NOW });
  assert.equal(u.total.tokens, 101);
  assert.equal(u.days.length, 30);
  assert.equal(u.days[0].date, "2026-08-30");
  assert.equal(u.days[29].date, "2026-09-28");
  assert.equal(u.days[1].cost, 0);
  assert.ok(u.days[0].cost > 0 && u.days[29].cost > u.days[0].cost);
  assert.deepEqual(u.days.map((x) => x.date), [...u.days.map((x) => x.date)].sort(), "oldest first");
});

test("all time lists every day that has usage, oldest first, and ignores days after today", () => {
  const d = board({ models: [
    doc("2026-09-28", { a: { sonnet: entry({ out: 100 }) } }),
    doc("2025-01-02", { a: { sonnet: entry({ out: 1 }) } }),
    doc("2026-10-05", { a: { sonnet: entry({ out: 7 }) } }),
    doc("2026-03-04", { b: { sonnet: entry({ out: 10 }) } }),
  ] });
  const u = core.modelUsage(d, { range: "all", now: NOW });
  assert.equal(u.total.tokens, 111);
  assert.deepEqual(u.days.map((x) => x.date), ["2025-01-02", "2026-03-04", "2026-09-28"]);
});

test("the date comes from the doc id, falling back to its date field", () => {
  const d = board({ models: [
    { id: "d-2026-09-28", date: "1999-01-01", projects: { a: { sonnet: entry({ out: 1 }) } } },
    { id: "x", date: "2026-09-28", projects: { a: { sonnet: entry({ out: 2 }) } } },
    { id: "y", projects: { a: { sonnet: entry({ out: 4 }) } } },
  ] });
  assert.equal(core.modelUsage(d, { range: "today", now: NOW }).total.tokens, 3);
});

test("a project filter keeps one project; project rows are ordered by cost with per-family shares", () => {
  const d = board({ models: [doc("2026-09-28", {
    a: { opus: entry({ in: 1e6 }), sonnet: entry({ in: 1e6 }) },
    b: { sonnet: entry({ in: 4e6 }) },
    c: { haiku: entry({ in: 1e6 }) },
  })] });
  const all = core.modelUsage(d, { range: "today", now: NOW });
  assert.deepEqual(all.projects.map((p) => p.slug), ["b", "a", "c"]);
  near(all.projects[1].share.opus, (4 / 6) * 100);
  near(all.projects[0].total.cost, 8);
  const one = core.modelUsage(d, { range: "today", project: "a", now: NOW });
  assert.equal(one.project, "a");
  assert.deepEqual(one.projects.map((p) => p.slug), ["a"]);
  near(one.total.cost, 6);
  assert.equal(one.families.find((f) => f.family === "haiku").cost, 0);
  const none = core.modelUsage(d, { range: "today", project: "ghost", now: NOW });
  assert.equal(none.total.cost, 0);
  assert.deepEqual(none.projects, []);
  assert.deepEqual(none.days, [], "no days with usage for that project");
});

test("the per-day series splits each day's cost by family", () => {
  const d = board({ models: [doc("2026-09-28", { a: { opus: entry({ in: 1e6 }) }, b: { sonnet: entry({ in: 1e6 }) } })] });
  const [day] = core.modelUsage(d, { range: "all", now: NOW }).days;
  assert.equal(day.date, "2026-09-28");
  near(day.cost, 6);
  assert.deepEqual(day.byFamily, { opus: 4, sonnet: 2, haiku: 0, fable: 0, other: 0 });
  assert.equal(day.tokens, 2e6);
});

test("no models docs: nothing to show, and no division by zero", () => {
  for (const data of [board(), {}, { models: "x" }]) {
    const u = core.modelUsage(data, { range: "today", now: NOW });
    assert.equal(u.hasData, false);
    assert.equal(u.total.cost, 0);
    assert.ok(u.families.every((f) => f.share === 0 && f.tokenShare === 0));
    assert.equal(u.opusShare, 0);
  }
});

test("malformed docs and numbers are ignored", () => {
  const d = board({ models: [
    null, "text", 5,
    { id: "d-2026-09-28" },
    { id: "d-2026-09-28", projects: [] },
    doc("2026-09-28", {
      a: { sonnet: entry({ in: "7", out: -5, cacheRead: NaN, cacheWrite5m: null, cacheWrite1h: Infinity, msgs: 2 }), opus: "x", mystery: entry({ out: 99 }) },
      b: "nope",
    }),
  ] });
  const u = core.modelUsage(d, { range: "today", now: NOW });
  assert.equal(u.total.tokens, 0);
  assert.equal(u.total.msgs, 2);
  assert.deepEqual(u.projects.map((p) => p.slug), ["a"]);
});

test("scopeData filters the projects inside each models doc; unknown slugs count as private", () => {
  const data = board({
    projects: [project({ id: "job", scope: "work" }), project({ id: "home", scope: "private" })],
    models: [doc("2026-09-28", { job: { sonnet: entry({ out: 1 }) }, home: { sonnet: entry({ out: 10 }) }, general: { sonnet: entry({ out: 100 }) } })],
  });
  const keys = (scope) => Object.keys(core.scopeData(data, scope).models[0].projects);
  assert.deepEqual(keys("work"), ["job"]);
  assert.deepEqual(keys("private"), ["home", "general"]);
  assert.deepEqual(keys("all"), ["job", "home", "general"]);
  assert.equal(core.scopeData(data, "work").models[0].id, "d-2026-09-28");
  assert.equal(core.modelUsage(core.scopeData(data, "work"), { range: "today", now: NOW }).total.tokens, 1);
  assert.equal(core.modelUsage(core.scopeData(data, "private"), { range: "today", now: NOW }).total.tokens, 110);
  // Without models docs, scopeData adds nothing.
  assert.equal("models" in core.scopeData({ projects: [] }, "work"), false);
});

test("local dates roll over months and years, and fall back to a day count of zero", () => {
  assert.equal(core.localDate(at(2026, 3, 1), 1), "2026-02-28");
  assert.equal(core.localDate(at(2026, 1, 1), 1), "2025-12-31");
  assert.equal(core.localDate(at(2026, 9, 28)), "2026-09-28");
  assert.equal(core.localDate(at(2026, 9, 28, 0, 1)), "2026-09-28");
  assert.equal(core.localDate(at(2026, 9, 28, 23, 59)), "2026-09-28");
});

test("token counts are shortened", () => {
  const cases = [[0, "0"], [999, "999"], [1000, "1k"], [1234, "1.2k"], [12345, "12k"], [999999, "1M"], [1.5e6, "1.5M"], [5.6e7, "56M"], [2.4e9, "2.4B"], [-4, "0"], [NaN, "0"], ["x", "0"]];
  for (const [n, out] of cases) assert.equal(core.formatTokens(n), out, String(n));
});

test("the Opus warning threshold is 60%", () => {
  assert.equal(core.OPUS_WARN, 60);
  assert.deepEqual(core.MODEL_RANGES, ["today", "30d", "all"]);
});
