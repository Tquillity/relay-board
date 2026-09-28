// Basic helpers: status names, timestamps, URL sanitising and relative-time labels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, NOW, MINUTE, HOUR, DAY, before, after } from "./helpers.mjs";

const core = loadCore();

test("the tuning constants match PROTOCOL.md", () => {
  assert.deepEqual(core.SIZE_WEIGHT, { S: 1, M: 2, L: 4 });
  assert.equal(core.SHOW_DAYS, 7);
  assert.equal(core.ARCHIVE_DAYS, 30);
  assert.equal(core.USAGE_KEEP_DAYS, 15);
  assert.equal(core.RATE_WINDOW, 36 * HOUR);
  assert.equal(core.MIN_ELAPSED, 12 * HOUR);
  assert.equal(core.DAY, DAY);
});

test("st keeps the known statuses and shows anything else as idle", () => {
  for (const s of ["active", "waiting", "blocked", "done", "idle", "todo"]) assert.equal(core.st(s), s);
  for (const s of ["paused", "ACTIVE", "", null, undefined, 3, {}]) assert.equal(core.st(s), "idle");
});

test("every status has a label", () => {
  for (const s of core.STATES) assert.equal(typeof core.STATE_LABEL[s], "string");
});

test("ts parses ISO strings and returns 0 for anything invalid", () => {
  assert.equal(core.ts("2026-09-28T12:00:00Z"), NOW);
  for (const v of [undefined, null, "", "not a date", "2026-13-45T99:00:00Z", {}]) assert.equal(core.ts(v), 0);
});

test("safeUrl only lets http(s) links through", () => {
  for (const u of ["https://example.com/x", "http://example.com", "HTTPS://EXAMPLE.COM"]) assert.equal(core.safeUrl(u), u);
  const unsafe = [
    "javascript:alert(1)", "JavaScript:alert(1)", " https://example.com", "data:text/html,hi", "vbscript:x",
    "//evil.example", "/relative", "claude://chat/1", "ftp://example.com", "", null, undefined, 42, { href: "https://x" },
  ];
  for (const u of unsafe) assert.equal(core.safeUrl(u), null, `should reject ${String(u)}`);
});

test("appUrl only accepts claude:// links", () => {
  assert.equal(core.appUrl("claude://resume?session=1"), "claude://resume?session=1");
  for (const u of ["https://claude.ai", "javascript:alert(1)", null, 7]) assert.equal(core.appUrl(u), null);
});

test("num accepts finite numbers only", () => {
  assert.equal(core.num(0), 0);
  assert.equal(core.num(42.5), 42.5);
  for (const v of [NaN, Infinity, "42", null, undefined, {}]) assert.equal(core.num(v), null);
});

test("clip trims strings and drops non-strings", () => {
  assert.equal(core.clip("abcdef", 3), "abc");
  assert.equal(core.clip("x".repeat(400)).length, 300);
  assert.equal(core.clip(12), null);
  assert.equal(core.clip(null), null);
});

test("ago reads as just now, minutes, hours, then days", () => {
  assert.equal(core.ago(before(0), NOW), "just now");
  assert.equal(core.ago(before(59e3), NOW), "just now");
  assert.equal(core.ago(before(MINUTE), NOW), "1m ago");
  assert.equal(core.ago(before(59 * MINUTE), NOW), "59m ago");
  assert.equal(core.ago(before(HOUR), NOW), "1h ago");
  assert.equal(core.ago(before(23 * HOUR + 59 * MINUTE), NOW), "23h ago");
  assert.equal(core.ago(before(DAY), NOW), "1d ago");
  assert.equal(core.ago(before(40 * DAY), NOW), "40d ago");
});

test("ago treats future times as just now and invalid times as blank", () => {
  assert.equal(core.ago(after(HOUR), NOW), "just now");
  assert.equal(core.ago("garbage", NOW), "");
  assert.equal(core.ago(undefined, NOW), "");
});

test("span shows minutes under an hour, hours under two days, then days", () => {
  assert.equal(core.span(0), "0m");
  assert.equal(core.span(59 * MINUTE + 59e3), "59m");
  assert.equal(core.span(HOUR), "1h");
  assert.equal(core.span(47 * HOUR + 59 * MINUTE), "47h");
  assert.equal(core.span(48 * HOUR), "2d");
  assert.equal(core.span(10 * DAY + 5 * HOUR), "10d");
});

test("progressColor runs from red at 0% to green at 100%", () => {
  assert.equal(core.progressColor(0), "hsl(4 72% 62%)");
  assert.equal(core.progressColor(50), "hsl(69 72% 62%)");
  assert.equal(core.progressColor(100), "hsl(134 72% 62%)");
});
