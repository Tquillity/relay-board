// Quiet-chat detection (PROTOCOL.md, streams): active chats go quiet after 90 minutes and "may have
// stopped" after 4 hours; waiting chats go quiet after 6 hours unless they wait on the user.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, stream, NOW, MINUTE, HOUR, before } from "./helpers.mjs";

const core = loadCore();
const quiet = (fields) => core.quietness(stream(fields), NOW);

test("the thresholds match the protocol", () => {
  assert.equal(core.QUIET_AFTER, 90 * MINUTE);
  assert.equal(core.STOPPED_AFTER, 4 * HOUR);
  assert.equal(core.WAITING_QUIET_AFTER, 6 * HOUR);
});

test("an active chat is fine up to exactly 90 minutes of silence", () => {
  assert.equal(quiet({ updatedAt: before(90 * MINUTE) }), null);
});

test("an active chat is quiet just after 90 minutes", () => {
  assert.deepEqual(quiet({ updatedAt: before(90 * MINUTE + 1) }), { cls: "quiet", label: "Quiet 1h" });
});

test("an active chat is still only quiet at exactly 4 hours", () => {
  assert.deepEqual(quiet({ updatedAt: before(4 * HOUR) }), { cls: "quiet", label: "Quiet 4h" });
});

test("an active chat may have stopped just after 4 hours", () => {
  assert.deepEqual(quiet({ updatedAt: before(4 * HOUR + 1) }), { cls: "stopped", label: "Silent 4h · may have stopped" });
  assert.deepEqual(quiet({ updatedAt: before(50 * HOUR) }), { cls: "stopped", label: "Silent 2d · may have stopped" });
});

test("a chat waiting on something else is quiet only after 6 hours", () => {
  assert.equal(quiet({ status: "waiting", waitingOn: "CI to finish", updatedAt: before(6 * HOUR) }), null);
  assert.deepEqual(quiet({ status: "waiting", waitingOn: "CI to finish", updatedAt: before(6 * HOUR + 1) }),
    { cls: "quiet", label: "Still waiting after 6h" });
});

test("a chat waiting on the user never goes quiet", () => {
  const words = ["you", "your", "user", "approval", "approve", "decide", "decision", "merge"];
  for (const w of words) {
    assert.equal(quiet({ status: "waiting", waitingOn: `Waiting on ${w} here`, updatedAt: before(3 * 24 * HOUR) }), null, w);
  }
  assert.equal(quiet({ status: "waiting", waitingOn: "YOUR APPROVAL", updatedAt: before(10 * HOUR) }), null);
});

test("user words only count as whole words", () => {
  for (const waitingOn of ["yours truly", "the users table", "an emerged build", "youth league"]) {
    assert.equal(quiet({ status: "waiting", waitingOn, updatedAt: before(7 * HOUR) })?.cls, "quiet", waitingOn);
  }
});

test("a missing or non-string waitingOn doesn't count as waiting on the user", () => {
  assert.equal(quiet({ status: "waiting", waitingOn: null, updatedAt: before(7 * HOUR) })?.cls, "quiet");
  assert.equal(quiet({ status: "waiting", waitingOn: 42, updatedAt: before(7 * HOUR) })?.cls, "quiet");
});

test("blocked, idle, todo and done chats are never flagged", () => {
  for (const status of ["blocked", "idle", "todo", "done", "unknown"]) assert.equal(quiet({ status, updatedAt: before(30 * HOUR) }), null, status);
});

test("a chat without a valid updatedAt is never flagged", () => {
  for (const updatedAt of [undefined, null, "", "yesterday"]) assert.equal(quiet({ updatedAt }), null);
});
