// History (PROTOCOL.md, archive): when done items finished, how they are summarised, and which
// ones a project's History section lists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, board, stream, need, NOW, HOUR, DAY, before } from "./helpers.mjs";

const core = loadCore();

test("isOld is strictly more than 7 days by default, or the given number of days", () => {
  assert.equal(core.isOld(before(7 * DAY), NOW), false);
  assert.equal(core.isOld(before(7 * DAY + 1), NOW), true);
  assert.equal(core.isOld(before(30 * DAY), NOW, 30), false);
  assert.equal(core.isOld(before(30 * DAY + 1), NOW, 30), true);
});

test("isOld is false for missing or invalid dates", () => {
  for (const v of [undefined, null, "", "long ago"]) assert.equal(core.isOld(v, NOW), false);
});

test("a stream finished at its updatedAt, else at its last ship", () => {
  assert.equal(core.streamDoneAt(stream({ updatedAt: before(DAY) })), before(DAY));
  assert.equal(core.streamDoneAt(stream({ updatedAt: "bad", lastShipped: { at: before(2 * DAY) } })), before(2 * DAY));
  assert.equal(core.streamDoneAt(stream({ updatedAt: undefined })), null);
});

test("a need finished at doneAt, else updatedAt, else createdAt", () => {
  assert.equal(core.needDoneAt(need({ doneAt: before(HOUR), updatedAt: before(DAY) })), before(HOUR));
  assert.equal(core.needDoneAt(need({ doneAt: "bad", updatedAt: before(DAY) })), before(DAY));
  assert.equal(core.needDoneAt(need({ createdAt: before(2 * DAY) })), before(2 * DAY));
  assert.equal(core.needDoneAt(need({ createdAt: null })), null);
});

test("hash is deterministic and base-36", () => {
  assert.equal(core.hash("demo--work"), core.hash("demo--work"));
  assert.notEqual(core.hash("a.b"), core.hash("a_b"));
  assert.match(core.hash("anything"), /^[0-9a-z]+$/);
  assert.equal(core.hash(""), (5381).toString(36));
});

test("item keys are readable, safe as map keys, and never collide on punctuation", () => {
  const ids = ["a.b", "a_b", "a-b", "a b", "a/b", "a:b", "å.b"];
  const keys = ids.map((id) => core.itemKey("stream", id));
  assert.equal(new Set(keys).size, ids.length);
  for (const k of keys) assert.match(k, /^stream_[A-Za-z0-9_-]+_[0-9a-z]+$/);
  assert.ok(core.itemKey("need", "demo-keys").startsWith("need_demo-keys_"));
});

test("item keys stay short for long ids but still tell them apart", () => {
  const a = core.itemKey("stream", `${"x".repeat(200)}a`);
  const b = core.itemKey("stream", `${"x".repeat(200)}b`);
  assert.notEqual(a, b);
  assert.ok(a.length < 170);
});

test("item keys accept non-string ids", () => {
  assert.match(core.itemKey("need", 42), /^need_42_[0-9a-z]+$/);
});

test("a stream's archive entry keeps the essentials", () => {
  const s = stream({
    title: "Checkout", agent: "Claude", updatedAt: before(40 * DAY), currentTask: "Done.",
    lastShipped: { text: "Checkout v2", url: "https://example.com/pr/1", at: before(40 * DAY) },
    pr: { number: 1, url: "https://example.com/pr/1", state: "merged", ci: "pass" },
    recent: [{ text: "later", at: before(41 * DAY) }, { text: "first", at: before(45 * DAY) }, null, { text: "undated" }],
  });
  assert.deepEqual(core.streamEntry(s), {
    kind: "stream", title: "Checkout", summary: "Checkout v2", url: "https://example.com/pr/1",
    pr: { number: 1, url: "https://example.com/pr/1", state: "merged" },
    agent: "Claude", startedAt: before(45 * DAY), finishedAt: before(40 * DAY),
  });
});

test("a stream's archive entry drops unsafe links and malformed fields", () => {
  const e = core.streamEntry(stream({
    title: 7, agent: { name: "x" }, currentTask: "Fallback summary",
    lastShipped: { url: "javascript:alert(1)" }, pr: { url: "javascript:alert(1)", state: "merged" }, recent: "nope",
  }));
  assert.equal(e.title, "Workstream");
  assert.equal(e.summary, "Fallback summary");
  assert.equal(e.url, null);
  assert.deepEqual(e.pr, { number: null, url: null, state: "merged" });
  assert.equal(e.agent, null);
  assert.equal(e.startedAt, null);
  assert.equal(core.streamEntry(stream({ pr: { state: "open" } })).pr, null);
  assert.equal(core.streamEntry(stream({ title: "x".repeat(500) })).title.length, 120);
});

test("a need's archive entry summarises the answer", () => {
  const n = need({ kind: "decision", title: "Limit", link: "https://example.com/n", doneBy: "you", doneAt: before(40 * DAY), answer: { choice: "60 / min", note: "for now" } });
  assert.deepEqual(core.needEntry(n), {
    kind: "need", title: "Limit", needKind: "decision", summary: "60 / min · for now", url: "https://example.com/n",
    doneBy: "you", startedAt: n.createdAt, finishedAt: before(40 * DAY),
  });
});

test("a need's archive entry copes with no answer, no title and unsafe links", () => {
  const e = core.needEntry(need({ title: undefined, link: "javascript:alert(1)", kind: undefined, createdAt: undefined }));
  assert.equal(e.title, "Untitled");
  assert.equal(e.summary, null);
  assert.equal(e.url, null);
  assert.equal(e.needKind, null);
  assert.equal(e.startedAt, null);
});

// ---- A project's History section ----

test("History lists done streams and needs older than 7 days, plus archived items, newest first", () => {
  const data = board({
    streams: [
      stream({ id: "demo--old", title: "Old", status: "done", updatedAt: before(10 * DAY) }),
      stream({ id: "demo--recent", status: "done", updatedAt: before(2 * DAY) }),     // still in the normal view
      stream({ id: "demo--live", status: "active", updatedAt: before(20 * DAY) }),    // not done
      stream({ id: "other--old", project: "other", status: "done", updatedAt: before(10 * DAY) }),
    ],
    needs: [
      need({ id: "old", title: "Old need", done: true, doneAt: before(8 * DAY) }),
      need({ id: "recent", done: true, doneAt: before(DAY) }),
      need({ id: "open", createdAt: before(20 * DAY) }),
    ],
    archive: [
      { id: "demo--2026-08", project: "demo", items: { a: { kind: "stream", title: "Archived", finishedAt: before(40 * DAY) } } },
      { id: "other--2026-08", project: "other", items: { b: { kind: "stream", title: "Elsewhere", finishedAt: before(40 * DAY) } } },
    ],
  });
  assert.deepEqual(core.historyFor(data, "demo", NOW).map((e) => e.title), ["Old need", "Old", "Archived"]);
});

test("History skips malformed archive docs and entries", () => {
  const archive = [
    { project: "demo", items: null },
    { project: "demo", items: "nope" },
    { project: "demo", items: { a: null, b: "text", c: { kind: "need", title: "Kept" } } },
  ];
  assert.deepEqual(core.historyFor(board({ archive }), "demo", NOW).map((e) => e.title), ["Kept"]);
});

test("History of an empty board is empty", () => {
  assert.deepEqual(core.historyFor(board(), "demo", NOW), []);
  assert.deepEqual(core.historyFor({}, "demo", NOW), []);
});
