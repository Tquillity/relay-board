// The archive planner: which done items over 30 days old get summarised into
// archive/<slug>--<YYYY-MM>, and which full docs are deleted afterwards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, board, stream, need, project, NOW, DAY } from "./helpers.mjs";

const core = loadCore();
const plan = (data) => core.planArchive(board(data), NOW);

test("nothing to archive on an empty board", () => {
  assert.deepEqual(plan({}), []);
  assert.deepEqual(core.planArchive({}, NOW), []);
});

test("done streams and needs over 30 days old are grouped per project and month", () => {
  const s = stream({ id: "demo--login", status: "done", updatedAt: "2026-08-10T09:00:00Z", title: "Login" });
  const n = need({ id: "demo-domain", done: true, doneAt: "2026-08-20T09:00:00Z", title: "Domain" });
  const groups = plan({ streams: [s], needs: [n] });
  assert.equal(groups.length, 1);
  const [g] = groups;
  assert.equal(g.id, "demo--2026-08");
  assert.equal(g.slug, "demo");
  assert.equal(g.month, "2026-08");
  assert.deepEqual(g.paths, ["streams/demo--login", "needs/demo-domain"]);
  assert.deepEqual(g.items, {
    [core.itemKey("stream", "demo--login")]: core.streamEntry(s),
    [core.itemKey("need", "demo-domain")]: core.needEntry(n),
  });
});

test("items from different months or projects land in different archive docs", () => {
  const streams = [
    stream({ id: "demo--a", status: "done", updatedAt: "2026-07-05T00:00:00Z" }),
    stream({ id: "demo--b", status: "done", updatedAt: "2026-08-05T00:00:00Z" }),
    stream({ id: "shop--c", project: "shop", status: "done", updatedAt: "2026-08-06T00:00:00Z" }),
  ];
  assert.deepEqual(plan({ streams }).map((g) => g.id), ["demo--2026-07", "demo--2026-08", "shop--2026-08"]);
});

test("the month is the UTC month, whatever the viewer's time zone", () => {
  const streams = [
    stream({ id: "demo--late", status: "done", updatedAt: "2026-07-31T23:30:00Z" }),
    stream({ id: "demo--early", status: "done", updatedAt: "2026-08-01T00:30:00+02:00" }), // 2026-07-31T22:30Z
  ];
  assert.deepEqual(plan({ streams }).map((g) => g.id), ["demo--2026-07"]);
});

test("exactly 30 days old is kept; just over 30 days is archived", () => {
  const edge = new Date(NOW - 30 * DAY).toISOString();
  const over = new Date(NOW - 30 * DAY - 1).toISOString();
  assert.deepEqual(plan({ streams: [stream({ status: "done", updatedAt: edge })] }), []);
  assert.equal(plan({ streams: [stream({ status: "done", updatedAt: over })] }).length, 1);
  assert.deepEqual(plan({ needs: [need({ done: true, doneAt: edge })] }), []);
  assert.equal(plan({ needs: [need({ done: true, doneAt: over })] }).length, 1);
});

test("unfinished work is never archived, however old", () => {
  const old = new Date(NOW - 90 * DAY).toISOString();
  const streams = ["active", "waiting", "blocked", "idle", "todo", "weird"].map((status) => stream({ id: `demo--${status}`, status, updatedAt: old }));
  assert.deepEqual(plan({ streams, needs: [need({ createdAt: old }), need({ id: "answered", answer: { choice: "x" }, createdAt: old })] }), []);
});

test("done items without any valid date are never archived", () => {
  assert.deepEqual(plan({ streams: [stream({ status: "done", updatedAt: "bad" })], needs: [need({ done: true, createdAt: null })] }), []);
});

test("a legacy Main stream on a project doc is never archived", () => {
  const old = new Date(NOW - 90 * DAY).toISOString();
  assert.deepEqual(plan({ projects: [project({ status: "done", updatedAt: old })] }), []);
});

test("items with a missing or unsafe project slug are skipped", () => {
  const old = new Date(NOW - 90 * DAY).toISOString();
  const streams = [undefined, null, "", "../etc", "a b", "a/b", "<x>"].map((slug, i) => stream({ id: `s${i}`, project: slug, status: "done", updatedAt: old }));
  assert.deepEqual(plan({ streams }), []);
  assert.equal(plan({ streams: [stream({ project: "my.repo_1-x", status: "done", updatedAt: old })] })[0].slug, "my.repo_1-x");
});

test("ids that differ only in punctuation stay separate items", () => {
  const old = new Date(NOW - 90 * DAY).toISOString();
  const streams = [stream({ id: "demo--a.b", status: "done", updatedAt: old }), stream({ id: "demo--a_b", status: "done", updatedAt: old })];
  const [g] = plan({ streams });
  assert.equal(Object.keys(g.items).length, 2);
  assert.deepEqual(g.paths, ["streams/demo--a.b", "streams/demo--a_b"]);
});
