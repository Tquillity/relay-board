// Tests for the model usage counter (scripts/model-usage.mjs) against synthetic transcripts in a temp dir.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { collect, familyOf, slugFor, summarize } from "../scripts/model-usage.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "model-usage.mjs");
const NOW = Date.parse("2026-10-08T12:00:00Z");

const msg = ({ id, model = "claude-sonnet-5-5", ts = "2026-10-08T10:00:00Z", cwd = "C:\\DEV\\acme-storefront",
  usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100 }, type = "assistant", requestId }) => ({
  type, timestamp: ts, cwd, requestId, message: { id, model, usage, content: [{ type: "text", text: "synthetic" }] },
});

let dir;
const write = (path, lines) => {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
};

before(() => {
  dir = mkdtempSync(join(tmpdir(), "model-usage-"));
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe("familyOf", () => {
  test("maps model ids to families", () => {
    assert.equal(familyOf("claude-opus-5"), "opus");
    assert.equal(familyOf("claude-sonnet-5-5"), "sonnet");
    assert.equal(familyOf("claude-haiku-5-5"), "haiku");
    assert.equal(familyOf("claude-fable-1"), "fable");
    assert.equal(familyOf("claude-mythos-preview"), "fable");
    assert.equal(familyOf("<synthetic>"), "other");
    assert.equal(familyOf(undefined), "other");
  });
});

describe("slugFor", () => {
  test("takes the last folder, lowercased", () => {
    assert.equal(slugFor("C:\\DEV\\Acme-Storefront"), "acme-storefront");
    assert.equal(slugFor("/home/dev/projects/Weather-CLI/"), "weather-cli");
  });
  test("folds worktrees into their repo", () => {
    assert.equal(slugFor("C:\\DEV\\recipe-api\\.claude\\worktrees\\fix-login"), "recipe-api");
    assert.equal(slugFor("/work/recipe-api/.claude/worktrees/fix-login"), "recipe-api");
    assert.equal(slugFor("C:\\DEV\\Recipe-API-wt-feature-x"), "recipe-api");
  });
  test("roots, home folders, scratch folders and missing cwd are general", () => {
    for (const cwd of ["C:\\", "C:\\DEV", "/", "/tmp", "/home/dev", "C:\\Users\\dev", undefined, "",
      "C:\\Users\\dev\\AppData\\Roaming\\Claude\\scratch-workspaces\\abc123"]) {
      assert.equal(slugFor(cwd), "general", String(cwd));
    }
  });
});

describe("slugFor with a file system and project roots", () => {
  const fs = (...paths) => ({ exists: (p) => paths.includes(p) });

  test("uses the git root of an existing folder", () => {
    const opts = fs("/w/Acme-Storefront/.git", "/w/Acme-Storefront/src/ui", "/w/Acme-Storefront/src");
    assert.equal(slugFor("/w/Acme-Storefront/src/ui", opts), "acme-storefront");
    assert.equal(slugFor("C:\\w\\Acme-Storefront\\src", { exists: (p) => p === "C:/w/Acme-Storefront/.git" || p === "C:/w/Acme-Storefront/src" }), "acme-storefront");
  });
  test("a .git file (worktree) folds into the repo it hangs under", () => {
    const wt = "/w/weather-cli/.claude/worktrees/fix";
    assert.equal(slugFor(`${wt}/src`, fs(`${wt}/.git`, `${wt}/src`)), "weather-cli");
    assert.equal(slugFor("/w/Recipe-API-wt-x", fs("/w/Recipe-API-wt-x/.git", "/w/Recipe-API-wt-x")), "recipe-api");
  });
  test("a missing folder falls back to the first folder below a root", () => {
    const opts = { exists: () => false, roots: ["C:\\DEV", "D:\\Work/"] };
    assert.equal(slugFor("C:\\DEV\\Garden-Planner\\client\\src", opts), "garden-planner");
    assert.equal(slugFor("c:\\dev\\Recipe-API-wt-x\\server", opts), "recipe-api");
    assert.equal(slugFor("D:\\Work\\acme\\out", opts), "acme");
    assert.equal(slugFor("D:\\Work", opts), "general");
  });
  test("a folder with no git root uses the roots, then the old rules", () => {
    assert.equal(slugFor("/w/acme/src", { exists: (p) => p === "/w/acme/src", roots: ["/w"] }), "acme");
    assert.equal(slugFor("/elsewhere/Acme/src", { exists: () => false, roots: ["/w"] }), "src");
  });
  test("never climbs into a home folder, and caches lookups per cwd", () => {
    assert.equal(slugFor("/home/dev/notes", fs("/home/dev/.git", "/home/dev/notes")), "notes");
    let calls = 0;
    const cache = new Map();
    const exists = (p) => (calls++, p === "/w/acme/.git" || p === "/w/acme/src");
    slugFor("/w/acme/src", { exists, cache });
    const before = calls;
    assert.equal(slugFor("/w/acme/src", { exists, cache }), "acme");
    assert.equal(calls, before);
  });
});

describe("summarize", () => {
  const rec = (o) => ({ id: "m", model: "claude-opus-5", ts: NOW, cwd: "/w/acme", in: 1, out: 2, cacheRead: 3,
    cacheWrite5m: 4, cacheWrite1h: 5, ...o });

  test("sums fields per day, project and family", () => {
    const { days } = summarize([rec({ id: "a" }), rec({ id: "b" }), rec({ id: "c", model: "claude-haiku-5-5" })],
      { days: 1, now: NOW, tz: 0 });
    assert.deepEqual(days["2026-10-08"].projects.acme.opus,
      { in: 2, out: 4, cacheRead: 6, cacheWrite5m: 8, cacheWrite1h: 10, msgs: 2 });
    assert.equal(days["2026-10-08"].projects.acme.haiku.msgs, 1);
    assert.equal(days["2026-10-08"].projects.acme.sonnet, undefined);
  });

  test("counts each message id once, keeping the entry with most output", () => {
    const { days } = summarize([rec({ id: "a", out: 5 }), rec({ id: "a", out: 50 }), rec({ id: "a", out: 7 })],
      { days: 1, now: NOW, tz: 0 });
    assert.equal(days["2026-10-08"].projects.acme.opus.out, 50);
    assert.equal(days["2026-10-08"].projects.acme.opus.msgs, 1);
  });

  test("buckets by local day across midnight using the given offset", () => {
    const late = Date.parse("2026-10-07T23:30:00Z");
    const utc = summarize([rec({ id: "a", ts: late })], { days: "all", now: NOW, tz: 0 });
    assert.deepEqual(Object.keys(utc.days), ["2026-10-07"]);
    const plus2 = summarize([rec({ id: "a", ts: late })], { days: "all", now: NOW, tz: 120 });
    assert.deepEqual(Object.keys(plus2.days), ["2026-10-08"]);
  });

  test("limits to the last N local days including today, or all", () => {
    const records = [0, 1, 2, 5].map((back) => rec({ id: `m${back}`, ts: NOW - back * 86400000 }));
    assert.deepEqual(Object.keys(summarize(records, { days: 1, now: NOW, tz: 0 }).days), ["2026-10-08"]);
    assert.deepEqual(Object.keys(summarize(records, { days: 2, now: NOW, tz: 0 }).days), ["2026-10-07", "2026-10-08"]);
    assert.equal(Object.keys(summarize(records, { days: "all", now: NOW, tz: 0 }).days).length, 4);
  });
});

describe("collect and CLI", () => {
  before(() => {
    write("proj-a/s1.jsonl", [
      msg({ id: "m1", model: "claude-opus-5", usage: { input_tokens: 5, output_tokens: 6, cache_read_input_tokens: 7,
        cache_creation: { ephemeral_5m_input_tokens: 8, ephemeral_1h_input_tokens: 9 }, cache_creation_input_tokens: 17 } }),
      msg({ id: "m2", model: "claude-haiku-5-5", usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 40 } }),
      msg({ id: "m3", type: "user" }),
      "not json at all {{{",
      msg({ id: "m4", usage: null }),
      msg({ id: "m5", cwd: "C:\\DEV\\acme-storefront\\.claude\\worktrees\\try-it" }),
      msg({ id: "m6", cwd: "C:\\DEV", ts: "2026-10-07T23:00:00Z" }),
    ]);
    // A resumed transcript repeats m1, m2; a subagent file adds a new one and repeats m5 via requestId-less id.
    const early = { input_tokens: 1, output_tokens: 1 };
    write("proj-a/s2.jsonl", [msg({ id: "m1", model: "claude-opus-5", usage: early }), msg({ id: "m2", model: "claude-haiku-5-5", usage: early })]);
    write("proj-a/s1/subagents/agent-1.jsonl", [msg({ id: "m5", cwd: "C:\\DEV\\acme-storefront" }),
      msg({ id: "s1", model: "<synthetic>" }), msg({ id: undefined, requestId: "req-9" }), msg({ id: undefined, requestId: "req-9" })]);
  });

  test("dedupes across files, includes subagents, folds slugs, reads cache fields", async () => {
    const { days } = await collect({ root: dir, days: "all", now: NOW, tz: 0 });
    const today = days["2026-10-08"].projects;
    assert.deepEqual(Object.keys(today).sort(), ["acme-storefront"]);
    const acme = today["acme-storefront"];
    assert.deepEqual(acme.opus, { in: 5, out: 6, cacheRead: 7, cacheWrite5m: 8, cacheWrite1h: 9, msgs: 1 });
    assert.equal(acme.haiku.cacheWrite5m, 40); // no breakdown: whole cache_creation_input_tokens
    assert.equal(acme.haiku.cacheWrite1h, 0);
    assert.equal(acme.haiku.msgs, 1);
    assert.equal(acme.other.msgs, 1); // <synthetic>
    assert.equal(acme.sonnet.msgs, 2); // m5 once (two files) + the requestId-keyed message once
    assert.equal(days["2026-10-07"].projects.general.sonnet.msgs, 1);
  });

  test("CLI prints JSON and writes one doc per day with --out", () => {
    const out = join(dir, "out");
    // A day file left by an earlier run is replaced by this run's set.
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "d-2000-01-01.json"), "{}");
    const stdout = execFileSync(process.execPath, [SCRIPT, "--root", dir, "--all", "--out", out], { encoding: "utf8" });
    const printed = JSON.parse(stdout);
    assert.deepEqual(Object.keys(printed.days).length, readdirSync(out).length);
    const file = readdirSync(out).sort()[0];
    const doc = JSON.parse(readFileSync(join(out, file), "utf8"));
    assert.equal(`d-${doc.date}.json`, file);
    assert.match(doc.updatedAt, /^\d{4}-\d\d-\d\dT.*Z$/);
    assert.deepEqual(doc.projects, printed.days[doc.date].projects);
    assert.ok(!stdout.includes("synthetic\""), "message content must not be printed");
  });
});
