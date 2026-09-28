// Projects and their streams: legacy "Main" streams, status, "finished for now", dimming and tab order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, board, stream, need, project, NOW, MINUTE, HOUR, DAY, WEEK, before, after } from "./helpers.mjs";

const core = loadCore();
const info = (data, slug = "demo") => core.projectInfo(board(data), slug, NOW);
const order = (data) => core.orderedProjects(board(data), NOW).map((p) => p.id);

test("a project exists when it has a meta doc or any stream", () => {
  const data = board({ projects: [project({ id: "a" })], streams: [stream({ project: "b" }), stream({ project: undefined })] });
  assert.deepEqual(core.allProjectSlugs(data).sort(), ["a", "b"]);
  assert.deepEqual(core.allProjectSlugs(board()), []);
  assert.deepEqual(core.allProjectSlugs({}), []);
});

test("streams are ordered blocked, active, waiting, todo, idle, done, then newest first", () => {
  const statuses = ["done", "idle", "todo", "waiting", "active", "blocked"];
  const streams = statuses.map((status) => stream({ id: `demo--${status}`, status }));
  assert.deepEqual(core.streamsFor(board({ streams }), "demo").map((s) => s.status), [...statuses].reverse());
  const ties = [stream({ id: "demo--old", updatedAt: before(DAY) }), stream({ id: "demo--new", updatedAt: before(MINUTE) })];
  assert.deepEqual(core.streamsFor(board({ streams: ties }), "demo").map((s) => s.id), ["demo--new", "demo--old"]);
});

test("unknown stream statuses rank and count as idle", () => {
  const p = info({ streams: [stream({ status: "paused" })] });
  assert.equal(p.status, "idle");
  assert.equal(p.complete, false);
});

test("status fields on a legacy project doc show up as a stream called Main", () => {
  const projects = [project({ status: "waiting", currentTask: "Old style", waitingOn: "CI", steps: [{ title: "x", state: "done" }] })];
  const [main] = core.streamsFor(board({ projects }), "demo");
  assert.equal(main.id, "demo--legacy");
  assert.equal(main.title, "Main");
  assert.equal(main.legacy, true);
  assert.equal(main.status, "waiting");
  assert.equal(main.currentTask, "Old style");
  assert.equal(core.streamsFor(board({ projects: [project()] }), "demo").length, 0);
});

test("project status is its most urgent stream's status", () => {
  const streams = [stream({ id: "demo--a", status: "waiting" }), stream({ id: "demo--b", status: "blocked" })];
  assert.equal(info({ streams }).status, "blocked");
  assert.equal(info({}).status, "idle");
});

test("name falls back to the slug and updatedAt is the newest of the project and its streams", () => {
  const p = info({ projects: [project({ name: undefined, updatedAt: before(DAY) })], streams: [stream({ updatedAt: before(HOUR) })] });
  assert.equal(p.name, "demo");
  assert.equal(p.updatedAt, before(HOUR));
  assert.equal(info({ streams: [stream()] }, "demo").name, "demo");
});

test("liveStreams are all streams that aren't done", () => {
  const streams = [stream({ id: "demo--a", status: "idle" }), stream({ id: "demo--b", status: "done" }), stream({ id: "demo--c" })];
  assert.deepEqual(info({ streams }).liveStreams.map((s) => s.id).sort(), ["demo--a", "demo--c"]);
});

// ---- Finished for now ----

test("a project with a done stream, nothing in progress and no open needs is complete", () => {
  const p = info({ streams: [stream({ status: "done" }), stream({ id: "demo--ideas", status: "idle" })] });
  assert.equal(p.complete, true);
  assert.equal(p.status, "done");
});

test("archived work counts as done work for completion", () => {
  const archive = [{ id: "demo--2026-08", project: "demo", items: {} }];
  assert.equal(info({ streams: [stream({ status: "idle" })], archive }).complete, true);
  assert.equal(info({ archive }).complete, true);
});

test("a project with only idle streams is not complete", () => {
  const p = info({ streams: [stream({ status: "idle" })] });
  assert.equal(p.complete, false);
  assert.equal(p.status, "idle");
});

test("any stream in progress keeps a project from being complete", () => {
  for (const status of ["active", "waiting", "blocked", "todo"]) {
    assert.equal(info({ streams: [stream({ id: "demo--done", status: "done" }), stream({ status })] }).complete, false, status);
  }
});

test("open needs keep a project from being complete, including snoozed and answered-but-unhandled ones", () => {
  const streams = [stream({ status: "done" })];
  const open = [
    need(),
    need({ snoozedUntil: after(DAY) }),
    need({ answer: { choice: "Yes" }, answerState: "answered" }),
    need({ answer: { choice: "Yes" }, answerState: "relayed" }),
    need({ answer: { choice: "Yes" }, answerState: "handled" }),
  ];
  for (const n of open) assert.equal(info({ streams, needs: [n] }).complete, false, JSON.stringify(n));
  assert.equal(info({ streams, needs: [need({ done: true }), need({ project: "other" })] }).complete, true);
});

// ---- Dimming ----

test("a project with nothing in progress and no writes for over a week is dimmed", () => {
  assert.equal(info({ projects: [project({ updatedAt: before(WEEK + 1) })], streams: [stream({ status: "idle", updatedAt: before(WEEK + 1) })] }).dim, true);
  assert.equal(info({ projects: [project({ updatedAt: before(WEEK) })], streams: [stream({ status: "idle", updatedAt: before(WEEK) })] }).dim, false);
});

test("busy projects are never dimmed, however old their last write", () => {
  assert.equal(info({ projects: [project({ updatedAt: before(30 * DAY) })], streams: [stream({ updatedAt: before(30 * DAY) })] }).dim, false);
});

test("complete projects are never dimmed", () => {
  const p = info({ projects: [project({ updatedAt: before(60 * DAY) })], streams: [stream({ status: "done", updatedAt: before(60 * DAY) })] });
  assert.equal(p.complete, true);
  assert.equal(p.dim, false);
});

test("a project with no timestamps at all is dimmed", () => {
  assert.equal(info({ projects: [project({ updatedAt: undefined })] }).dim, true);
});

// ---- Tab order ----

test("tabs order pinned first, then recent before dimmed, then order, then newest", () => {
  const projects = [
    project({ id: "old", updatedAt: before(30 * DAY) }),                    // dimmed
    project({ id: "late", updatedAt: before(2 * HOUR) }),
    project({ id: "early", updatedAt: before(3 * HOUR), order: 1 }),
    project({ id: "fresh", updatedAt: before(MINUTE) }),
    project({ id: "pinned-old", updatedAt: before(30 * DAY), pinned: true }),
  ];
  assert.deepEqual(order({ projects }), ["pinned-old", "early", "fresh", "late", "old"]);
});

test("only pinned: true pins a project", () => {
  const projects = [project({ id: "a", updatedAt: before(HOUR) }), project({ id: "b", updatedAt: before(2 * HOUR), pinned: "yes" })];
  assert.deepEqual(order({ projects }), ["a", "b"]);
});

test("an empty board has no projects", () => {
  assert.deepEqual(order({}), []);
});
