// Work / Private scope: which projects a filter shows, and what is filtered with them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, board, stream, need, project, reading, NOW, HOUR } from "./helpers.mjs";

const core = loadCore();
const ids = (rows) => rows.map((r) => r.id);

// Work: "job". Private: "home" (explicit) and "bare" (no scope). "ghost" has streams but no project doc.
const data = () => board({
  projects: [project({ id: "job", scope: "work" }), project({ id: "home", scope: "private" }), project({ id: "bare" })],
  streams: [
    stream({ id: "job--a", project: "job" }), stream({ id: "home--a", project: "home" }),
    stream({ id: "bare--a", project: "bare" }), stream({ id: "ghost--a", project: "ghost" }), stream({ id: "orphan", project: undefined }),
  ],
  needs: [need({ id: "n-job", project: "job" }), need({ id: "n-home", project: "home" }), need({ id: "n-ghost", project: "ghost" })],
  archive: [{ id: "job--2026-08", project: "job", items: {} }, { id: "home--2026-08", project: "home", items: {} }],
  services: [{ id: "job", items: {} }, { id: "home", items: {} }, { id: "ghost", items: {} }],
  usage: [reading(NOW - HOUR, 40, NOW + HOUR)],
});

test("a project is private unless it is marked work", () => {
  const d = data();
  assert.equal(core.projectScope(d, "job"), "work");
  assert.equal(core.projectScope(d, "home"), "private");
  assert.equal(core.projectScope(d, "bare"), "private");
  assert.equal(core.projectScope(d, "ghost"), "private", "no project doc");
  assert.equal(core.projectScope(d, undefined), "private");
  assert.equal(core.projectScope({}, "job"), "private");
});

test("any other scope value counts as private", () => {
  for (const scope of ["Work", "WORK", "personal", "", null, 1, true, ["work"]]) {
    assert.equal(core.projectScope(board({ projects: [project({ id: "x", scope })] }), "x"), "private", String(scope));
  }
});

test("the work scope keeps only work projects and what belongs to them", () => {
  const out = core.scopeData(data(), "work");
  assert.deepEqual(ids(out.projects), ["job"]);
  assert.deepEqual(ids(out.streams), ["job--a"]);
  assert.deepEqual(ids(out.needs), ["n-job"]);
  assert.deepEqual(ids(out.archive), ["job--2026-08"]);
  assert.deepEqual(ids(out.services), ["job"]);
});

test("the private scope keeps the rest, including items of projects without a doc", () => {
  const out = core.scopeData(data(), "private");
  assert.deepEqual(ids(out.projects), ["home", "bare"]);
  assert.deepEqual(ids(out.streams), ["home--a", "bare--a", "ghost--a", "orphan"]);
  assert.deepEqual(ids(out.needs), ["n-home", "n-ghost"]);
  assert.deepEqual(ids(out.archive), ["home--2026-08"]);
  assert.deepEqual(ids(out.services), ["home", "ghost"]);
});

test("the two scopes split every item exactly once", () => {
  const d = data();
  const [w, p] = [core.scopeData(d, "work"), core.scopeData(d, "private")];
  for (const name of ["projects", "streams", "needs", "archive", "services"]) {
    assert.deepEqual([...ids(w[name]), ...ids(p[name])].sort(), ids(d[name]).sort(), name);
  }
});

test("all, or an unknown scope, returns the data unchanged", () => {
  const d = data();
  assert.deepEqual(core.scopeData(d, "all"), d);
  assert.deepEqual(core.scopeData(d, undefined), d);
  assert.deepEqual(core.scopeData(d, "nonsense"), d);
});

test("plan usage is account-wide and never filtered", () => {
  const d = data();
  assert.deepEqual(core.scopeData(d, "work").usage, d.usage);
  assert.deepEqual(core.scopeData(d, "private").usage, d.usage);
});

test("a filtered board gives tabs, needs and services for that scope only", () => {
  const d = board({
    projects: [project({ id: "job", scope: "work" }), project({ id: "home" })],
    streams: [stream({ id: "job--a", project: "job" }), stream({ id: "home--a", project: "home" })],
    needs: [need({ id: "n-job", project: "job" }), need({ id: "n-home", project: "home" })],
    services: [{ id: "job", items: { x: { name: "X", category: "other", manualCost: { monthly: 5, currency: "USD", at: new Date(NOW).toISOString() } } } },
      { id: "home", items: { y: { name: "Y", category: "other", manualCost: { monthly: 7, currency: "USD", at: new Date(NOW).toISOString() } } } }],
  });
  const work = core.scopeData(d, "work");
  assert.deepEqual(core.orderedProjects(work, NOW).map((p) => p.id), ["job"]);
  assert.deepEqual(ids(core.actionable(work, null, NOW)), ["n-job"]);
  assert.deepEqual(core.servicesSummary(work, NOW).totals, [{ currency: "USD", monthly: 5 }]);
  assert.deepEqual(core.servicesSummary(core.scopeData(d, "private"), NOW).totals, [{ currency: "USD", monthly: 7 }]);
});

test("it copes with missing or malformed collections", () => {
  assert.deepEqual(core.scopeData({}, "work").projects, []);
  const out = core.scopeData({ projects: "nope", streams: [null, 5, { project: "a" }] }, "private");
  assert.deepEqual(out.projects, []);
  assert.deepEqual(out.streams, [{ project: "a" }], "non-objects are dropped");
});
