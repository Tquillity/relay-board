// The header's "done / 100% − you" progress for a project's live work (PROTOCOL.md, "Progress %").
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, board, stream, need, project, step, prng, DAY, before, after } from "./helpers.mjs";

const core = loadCore();
const progress = (data, slug = "demo") => core.progressFor(board(data), slug);

test("no live stream means no progress indicator", () => {
  assert.equal(progress({}), null);
  assert.equal(progress({ streams: [stream({ status: "done", steps: [step("done", "M")] })] }), null);
  assert.equal(progress({ streams: [stream({ status: "idle", steps: [step("todo", "M")] })] }), null);
  assert.equal(progress({ streams: [stream({ status: "todo", steps: [step("todo", "M")] })] }), null);
});

test("live streams without steps or open needs show no indicator", () => {
  assert.equal(progress({ streams: [stream({ steps: [] })] }), null);
  assert.equal(progress({ streams: [stream({ steps: undefined })] }), null);
});

test("active, waiting and blocked streams all count as live work", () => {
  for (const status of ["active", "waiting", "blocked"]) {
    assert.deepEqual(progress({ streams: [stream({ status, steps: [step("done", "S"), step("todo", "S")] })] }), { donePct: 50, youPct: 0 });
  }
});

test("steps weigh S=1, M=2 and L=4, and M is the default size", () => {
  // total 1 + 2 + 4 = 7; done 1 → 14%; you 4 → 58% (rounded up)
  const steps = [step("done", "S"), step("todo"), step("todo", "L", { by: "you" })];
  assert.deepEqual(progress({ streams: [stream({ steps })] }), { donePct: 14, youPct: 58 });
});

test("sizes are case-insensitive and unknown sizes weigh like M", () => {
  const lower = [step("done", "l"), step("todo", "s")];     // 4 of 5 done
  assert.deepEqual(progress({ streams: [stream({ steps: lower })] }), { donePct: 80, youPct: 0 });
  const odd = [step("done", "XL"), step("todo", 3)];        // 2 of 4 done
  assert.deepEqual(progress({ streams: [stream({ steps: odd })] }), { donePct: 50, youPct: 0 });
});

test("malformed steps are skipped instead of breaking the sum", () => {
  const steps = [null, undefined, 3, "step", step("done", "S"), step("todo", "S")];
  assert.deepEqual(progress({ streams: [stream({ steps })] }), { donePct: 50, youPct: 0 });
  assert.equal(progress({ streams: [stream({ steps: "not an array" })] }), null);
});

test("a done step counts as done even when it was marked by: you", () => {
  const steps = [step("done", "S", { by: "you" }), step("todo", "S")];
  assert.deepEqual(progress({ streams: [stream({ steps })] }), { donePct: 50, youPct: 0 });
});

test("steps of every live stream in the project are summed", () => {
  const streams = [
    stream({ id: "demo--a", steps: [step("done", "M")] }),
    stream({ id: "demo--b", status: "waiting", steps: [step("todo", "M", { by: "you" })] }),
    stream({ id: "demo--c", status: "done", steps: [step("todo", "L")] }),     // not live: ignored
    stream({ id: "other--x", project: "other", steps: [step("todo", "L")] }), // other project
  ];
  assert.deepEqual(progress({ streams }), { donePct: 50, youPct: 50 });
});

test("an open need weighs 1 and counts as the user's share", () => {
  const streams = [stream({ steps: [step("done", "S")] })];
  assert.deepEqual(progress({ streams, needs: [need({ stream: "demo--work" })] }), { donePct: 50, youPct: 50 });
});

test("snoozed needs still count as the user's share", () => {
  const streams = [stream({ steps: [step("done", "S")] })];
  const needs = [need({ snoozedUntil: after(DAY) })];
  assert.deepEqual(progress({ streams, needs }), { donePct: 50, youPct: 50 });
});

test("an answered need counts as done, whatever its relay state", () => {
  const streams = [stream({ steps: [step("todo", "S")] })];
  for (const answerState of [undefined, "answered", "relayed", "handled"]) {
    const needs = [need({ answer: { choice: "Yes", at: before(0) }, answerState })];
    assert.deepEqual(progress({ streams, needs }), { donePct: 50, youPct: 0 });
  }
});

test("done needs, other projects' needs and needs of finished streams are left out", () => {
  const streams = [stream({ steps: [step("todo", "S")] }), stream({ id: "demo--old", status: "done" })];
  const needs = [
    need({ id: "a", done: true }),
    need({ id: "b", project: "other" }),
    need({ id: "c", stream: "demo--old" }),
    need({ id: "d", stream: "demo--missing" }),
  ];
  assert.deepEqual(progress({ streams, needs }), { donePct: 0, youPct: 0 });
});

test("needs without a stream count toward the project", () => {
  const streams = [stream({ steps: [step("done", "S")] })];
  assert.deepEqual(progress({ streams, needs: [need({ stream: undefined })] }), { donePct: 50, youPct: 50 });
});

test("a need's stream may be written with or without the streams/ prefix", () => {
  const streams = [stream({ steps: [step("done", "S")] })];
  for (const id of ["demo--work", "streams/demo--work"]) {
    assert.deepEqual(progress({ streams, needs: [need({ stream: id })] }), { donePct: 50, youPct: 50 });
  }
});

test("open needs alone are enough to show progress on a live stream", () => {
  assert.deepEqual(progress({ streams: [stream({ steps: [] })], needs: [need()] }), { donePct: 0, youPct: 100 });
});

test("the legacy Main stream on a project doc counts as live work", () => {
  const projects = [project({ status: "active", steps: [step("done", "S"), step("todo", "S")] })];
  assert.deepEqual(progress({ projects }), { donePct: 50, youPct: 0 });
});

test("a tiny share waiting on the user still shows as at least 1%", () => {
  const steps = [...Array.from({ length: 300 }, () => step("done", "S")), step("todo", "S", { by: "you" })];
  assert.deepEqual(progress({ streams: [stream({ steps })] }), { donePct: 99, youPct: 1 });
});

test("done is rounded down, so work is never shown as finished early", () => {
  const steps = [...Array.from({ length: 199 }, () => step("done", "S")), step("todo", "S")];
  assert.deepEqual(progress({ streams: [stream({ steps })] }), { donePct: 99, youPct: 0 });
});

test("rounding invariants hold for many random step sets", () => {
  const rand = prng(20260928);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  for (let i = 0; i < 2000; i++) {
    const steps = Array.from({ length: 1 + Math.floor(rand() * 40) }, () =>
      step(pick(["done", "todo", "active", "blocked", "waiting"]), pick(["S", "M", "L", undefined]), rand() < 0.25 ? { by: "you" } : {}));
    const needs = Array.from({ length: Math.floor(rand() * 4) }, (_, k) =>
      need({ id: `n${k}`, ...(rand() < 0.4 ? { answer: { choice: "Ok" } } : {}) }));
    const p = progress({ streams: [stream({ steps })], needs });
    const youWeight = steps.some((x) => x.state !== "done" && x.by === "you") || needs.some((n) => !n.answer);
    const allDone = steps.every((x) => x.state === "done") && needs.every((n) => n.answer);
    const msg = JSON.stringify({ steps, needs, p });
    assert.ok(Number.isInteger(p.donePct) && Number.isInteger(p.youPct), msg);
    assert.ok(p.donePct >= 0 && p.youPct >= 0, msg);
    assert.ok(p.donePct + p.youPct <= 100, msg);
    assert.equal(p.youPct > 0, youWeight, msg);
    assert.equal(p.donePct === 100, allDone, msg);
  }
});
