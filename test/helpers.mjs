// Shared test helpers: load the page's pure core into a sandbox, plus small fixture builders.
// Everything is relative to a fixed NOW, so no test depends on the real clock or time zone.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CORE_MARKER = "// ---- Core: pure logic, no DOM ----";

export const MINUTE = 60e3, HOUR = 60 * MINUTE, DAY = 24 * HOUR, WEEK = 7 * DAY;
export const NOW = Date.parse("2026-09-28T12:00:00Z");

/** An ISO timestamp `ms` before NOW. */
export const before = (ms) => new Date(NOW - ms).toISOString();
/** An ISO timestamp `ms` after NOW. */
export const after = (ms) => new Date(NOW + ms).toISOString();

/** The source of the core <script> in index.html (the one that starts with the core marker). */
export function coreSource() {
  const page = readFileSync(join(root, "index.html"), "utf8").replace(/\r\n/g, "\n");
  const scripts = [...page.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]);
  const core = scripts.find((s) => s.startsWith(CORE_MARKER));
  if (!core) throw new Error(`index.html has no <script> starting with "${CORE_MARKER}"`);
  return core;
}

/**
 * Runs the core in a fresh, empty VM context (no DOM, no window, no localStorage) and returns
 * RelayCore. Results are structured-cloned into this realm, so assert.deepStrictEqual can compare
 * them with plain object literals.
 */
export function loadCore() {
  const context = vm.createContext({});
  vm.runInContext(coreSource(), context, { filename: "index.html (core)" });
  const core = context.RelayCore;
  const wrapped = {};
  for (const [name, value] of Object.entries(core)) {
    wrapped[name] = typeof value === "function" ? (...args) => structuredClone(value(...args)) : structuredClone(value);
  }
  return wrapped;
}

// ---- Fixtures ---------------------------------------------------------

/** A workstream doc. Defaults to an active stream in project "demo", updated 5 minutes ago. */
export const stream = (fields = {}) => ({
  id: "demo--work", project: "demo", title: "Work", status: "active", updatedAt: before(5 * MINUTE), steps: [],
  ...fields,
});

/** A "Needs you" doc. Defaults to an open task in project "demo", created an hour ago. */
export const need = (fields = {}) => ({
  id: "demo-n1", project: "demo", kind: "task", priority: "normal", title: "Do a thing", done: false, createdAt: before(HOUR),
  ...fields,
});

/** A project meta doc. */
export const project = (fields = {}) => ({ id: "demo", name: "Demo", updatedAt: before(5 * MINUTE), ...fields });

/** Board data with every collection present. */
export const board = ({ projects = [], streams = [], needs = [], archive = [], usage = [] } = {}) =>
  ({ projects, streams, needs, archive, usage });

/** A step with a state and an optional size. */
export const step = (state, size, fields = {}) => ({ title: `${state} ${size || "-"}`, state, ...(size ? { size } : {}), ...fields });

/** One plan-usage reading doc with a weekAll value. */
export const reading = (atMs, pct, resetsAtMs, fields = {}) => ({
  at: new Date(atMs).toISOString(), project: "demo",
  weekAll: { pct, resetsAt: new Date(resetsAtMs).toISOString() },
  ...fields,
});

/** Readings for the week that resets at `resetsAt`, one per offset in `days` from its start. */
export const weekOfReadings = (resetsAt, days, pctAt) =>
  days.map((d) => reading(resetsAt - WEEK + d * DAY, pctAt(d), resetsAt));

/** A small seeded PRNG (mulberry32), for repeatable property-style tests. */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
