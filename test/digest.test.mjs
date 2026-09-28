// "Since you last looked": what changed since the viewer's last visit, and the activity feed behind it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, board, stream, need, project, NOW, MINUTE, HOUR, DAY, before } from "./helpers.mjs";

const core = loadCore();
const SINCE = NOW - 6 * HOUR;
const digest = (data) => core.digestData(board(data), SINCE, NOW);

test("an empty board has nothing to report", () => {
  const d = digest({});
  assert.deepEqual(d.updates, []);
  assert.equal(d.byProject.size, 0);
  assert.deepEqual(d.finished, []);
  assert.deepEqual(d.newNeeds, []);
  assert.deepEqual(d.closed, []);
  assert.deepEqual(d.quiet, []);
});

test("new for you: open, unanswered needs created since the last visit, newest first", () => {
  const needs = [
    need({ id: "a", createdAt: before(2 * HOUR) }),
    need({ id: "b", createdAt: before(HOUR) }),
    need({ id: "before", createdAt: before(7 * HOUR) }),
    need({ id: "answered", createdAt: before(HOUR), answer: { choice: "Yes" } }),
    need({ id: "done", createdAt: before(HOUR), done: true }),
  ];
  assert.deepEqual(digest({ needs }).newNeeds.map((n) => n.id), ["b", "a"]);
});

test("closed by Claude: needs an agent marked done since the last visit", () => {
  const needs = [
    need({ id: "claude", done: true, doneBy: "claude", doneAt: before(HOUR) }),
    need({ id: "you", done: true, doneBy: "you", doneAt: before(HOUR) }),
    need({ id: "nobody", done: true, doneAt: before(HOUR) }),
    need({ id: "earlier", done: true, doneBy: "claude", doneAt: before(8 * HOUR) }),
  ];
  assert.deepEqual(digest({ needs }).closed.map((n) => n.id), ["claude"]);
});

test("shipped: a ship since the last visit counts even while the chat is still working", () => {
  const streams = [stream({ title: "Checkout", lastShipped: { text: "v2 live", url: "https://example.com/pr/2", at: before(HOUR) } })];
  assert.deepEqual(digest({ streams }).finished, [
    { project: "demo", title: "Checkout", done: false, text: "v2 live", url: "https://example.com/pr/2", at: before(HOUR) },
  ]);
});

test("finished: a stream that turned done since the last visit, falling back to its task and PR", () => {
  const streams = [stream({ status: "done", currentTask: "All wrapped up", updatedAt: before(2 * HOUR), pr: { url: "https://example.com/pr/9" } })];
  assert.deepEqual(digest({ streams }).finished, [
    { project: "demo", title: "Work", done: true, text: "All wrapped up", url: "https://example.com/pr/9", at: before(2 * HOUR) },
  ]);
});

test("streams finished or shipped before the last visit are not repeated", () => {
  const streams = [
    stream({ id: "demo--a", status: "done", updatedAt: before(DAY) }),
    stream({ id: "demo--b", lastShipped: { text: "old", at: before(DAY) } }),
  ];
  assert.deepEqual(digest({ streams }).finished, []);
});

test("finished items drop unsafe links and are newest first", () => {
  const streams = [
    stream({ id: "demo--a", title: "A", lastShipped: { text: "a", url: "javascript:alert(1)", at: before(3 * HOUR) } }),
    stream({ id: "demo--b", title: "B", lastShipped: { text: "b", at: before(HOUR) } }),
  ];
  const f = digest({ streams }).finished;
  assert.deepEqual(f.map((x) => x.title), ["B", "A"]);
  assert.equal(f[1].url, null);
});

test("updates are recent rows since the last visit, grouped by project", () => {
  const streams = [
    stream({ recent: [{ text: "one", at: before(HOUR) }, { text: "old", at: before(DAY) }, { text: "undated" }] }),
    stream({ id: "shop--x", project: "shop", title: "Shop work", recent: [{ text: "two", at: before(2 * HOUR) }] }),
  ];
  const d = digest({ projects: [project({ updatedAt: before(MINUTE) })], streams });
  assert.deepEqual(d.updates.map((r) => r.text), ["one", "two"]);
  assert.deepEqual([...d.byProject.keys()], ["demo", "shop"]);
  assert.equal(d.byProject.get("shop")[0].stream, "Shop work");
  assert.equal(d.byProject.get("demo")[0].projectName, "Demo");
});

test("a ship also logged in recent is shown once, matched by link or by text", () => {
  const streams = [stream({
    lastShipped: { text: "v2 live", url: "https://example.com/pr/2", at: before(HOUR) },
    recent: [
      { text: "Merged PR 2", url: "https://example.com/pr/2", at: before(HOUR) },
      { text: "v2 live", at: before(HOUR) },
      { text: "Something else", at: before(HOUR) },
    ],
  })];
  assert.deepEqual(digest({ streams }).updates.map((r) => r.text), ["Something else"]);
});

test("the same text in another project is not treated as the same ship", () => {
  const streams = [
    stream({ lastShipped: { text: "Released", at: before(HOUR) } }),
    stream({ id: "shop--x", project: "shop", recent: [{ text: "Released", at: before(HOUR) }] }),
  ];
  assert.deepEqual(digest({ streams }).updates.map((r) => r.project), ["shop"]);
});

test("gone quiet: only chats that went quiet after the last visit", () => {
  const streams = [
    stream({ id: "demo--newly", updatedAt: before(3 * HOUR) }),         // quiet from 1.5 h ago
    stream({ id: "demo--long", updatedAt: before(10 * HOUR) }),         // was already quiet 6 h ago
    stream({ id: "demo--wait", status: "waiting", waitingOn: "CI", updatedAt: before(7 * HOUR) }), // quiet from 1 h ago
    stream({ id: "demo--fine", updatedAt: before(MINUTE) }),
  ];
  const q = digest({ streams }).quiet;
  assert.deepEqual(q.map((r) => r.x.id).sort(), ["demo--newly", "demo--wait"]);
  assert.equal(q.find((r) => r.x.id === "demo--newly").q.cls, "quiet");
});

test("a legacy Main stream is reported under the project's name", () => {
  const projects = [project({ name: "Old App", status: "active", recent: [{ text: "hi", at: before(HOUR) }] })];
  const d = digest({ projects });
  assert.equal(d.updates[0].stream, "Main");
  const shipped = digest({ projects: [project({ name: "Old App", status: "done", updatedAt: before(HOUR) })] }).finished;
  assert.equal(shipped[0].title, "Old App");
});

test("the activity feed lists every stream's recent rows, newest first, and skips undated ones", () => {
  const streams = [
    stream({ recent: [{ text: "b", at: before(2 * HOUR) }, { text: "x", at: "bad" }] }),
    stream({ id: "demo--2", recent: [{ text: "a", at: before(HOUR) }, { text: "c", at: before(3 * DAY) }] }),
    stream({ id: "demo--3", recent: "not a list" }),
  ];
  assert.deepEqual(core.allActivity(board({ streams }), NOW).map((r) => r.text), ["a", "b", "c"]);
});
