// Counts how Claude Code token use splits across model families, per project and per local day,
// from the chat transcripts on this computer. It only reads message.model, message.usage numbers,
// message.id, requestId, timestamp, cwd and type: message content is never read into the output.
// Usage: node scripts/model-usage.mjs [--root <dir>] [--days N | --all] [--roots <dir,dir>] [--out <dir>]
//   prints { "days": { "<date>": { "projects": { <slug>: { <family>: {in, out, cacheRead, cacheWrite5m,
//   cacheWrite1h, msgs} } } } } }; with --out, also writes <dir>/d-<date>.json per day (a full models doc),
//   replacing any day files an earlier run left there.
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const DAY_MS = 86400000;
const FAMILIES = ["opus", "sonnet", "haiku", "fable", "other"];

export function familyOf(model) {
  const id = String(model ?? "").toLowerCase();
  if (id.includes("opus")) return "opus";
  if (id.includes("sonnet")) return "sonnet";
  if (id.includes("haiku")) return "haiku";
  if (id.includes("fable") || id.includes("mythos")) return "fable";
  return "other";
}

const normalizePath = (cwd) => cwd.trim().replace(/\\/g, "/").replace(/\/+$/, "");
const nameOf = (path) => path.split("/").filter(Boolean).pop()?.replace(/-wt-.*$/i, "").toLowerCase() || "general";
const segmentsOf = (path) => path.replace(/^[A-Za-z]:/, "").split("/").filter(Boolean);
const isHome = (segs) => segs.length === 2 && /^(users|home)$/i.test(segs[0]);
const WORKTREE = /^(.*)\/\.claude\/worktrees\/[^/]+$/i;

// Nearest ancestor (or the folder itself) holding a ".git" folder or file. A git worktree folder
// folds into the repo it hangs under.
function gitRootOf(path, exists) {
  for (let dir = path; segmentsOf(dir).length > 1 && !isHome(segmentsOf(dir)); dir = dir.slice(0, dir.lastIndexOf("/"))) {
    if (exists(`${dir}/.git`)) return WORKTREE.exec(dir)?.[1] ?? dir;
  }
  return null;
}

// Folds a working directory into a project slug. In order:
//  1. exists(path) given and the folder exists: the folder name of its git root (worktrees fold into their repo);
//  2. cwd under one of roots (project parent folders): the first folder below the root (the root itself: "general");
//  3. otherwise the last folder of the path, with worktree and "-wt-" suffixes stripped.
// Roots, home folders, scratch folders and a missing cwd are "general".
// options: { exists, roots, cache (a Map, to remember lookups per cwd) }.
export function slugFor(cwd, { exists, roots = [], cache } = {}) {
  if (typeof cwd !== "string" || !cwd.trim()) return "general";
  if (cache?.has(cwd)) return cache.get(cwd);
  const slug = resolveSlug(normalizePath(cwd), exists, roots);
  cache?.set(cwd, slug);
  return slug;
}

function resolveSlug(path, exists, roots) {
  if (/\/AppData\/Roaming\/Claude\/scratch-workspaces(\/|$)/i.test(path)) return "general";
  const segs = segmentsOf(path);
  if (segs.length <= 1 || isHome(segs)) return "general"; // "/", "C:", "C:/DEV", "/tmp", a home folder
  if (exists && exists(path)) {
    const root = gitRootOf(path, exists);
    if (root) return nameOf(root);
  }
  const lower = path.toLowerCase();
  for (const raw of roots) {
    const root = normalizePath(String(raw)).toLowerCase();
    if (!root) continue;
    if (lower === root) return "general";
    if (lower.startsWith(`${root}/`)) return nameOf(`/${path.slice(root.length + 1).split("/")[0]}`);
  }
  return nameOf(WORKTREE.exec(path)?.[1] ?? path);
}

const pad = (n) => String(n).padStart(2, "0");

// tz: minutes east of UTC (a fixed offset), or undefined for this machine's own time zone.
export function localDate(ms, tz) {
  if (typeof tz === "number") return new Date(ms + tz * 60000).toISOString().slice(0, 10);
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const shiftDate = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

// Turns one parsed transcript line into a compact record, or null when it is not a counted message.
export function recordFrom(line) {
  if (!line || line.type !== "assistant") return null;
  const message = line.message;
  const usage = message?.usage;
  if (!usage || typeof usage !== "object") return null;
  const ts = Date.parse(line.timestamp);
  if (!Number.isFinite(ts)) return null;
  const breakdown = usage.cache_creation;
  const has = breakdown && typeof breakdown === "object";
  return {
    id: message.id ?? line.requestId ?? null,
    model: message.model,
    ts,
    cwd: line.cwd,
    in: num(usage.input_tokens),
    out: num(usage.output_tokens),
    cacheRead: num(usage.cache_read_input_tokens),
    cacheWrite5m: has ? num(breakdown.ephemeral_5m_input_tokens) : num(usage.cache_creation_input_tokens),
    cacheWrite1h: has ? num(breakdown.ephemeral_1h_input_tokens) : 0,
  };
}

// records: [{id, model, ts (ms), cwd, in, out, cacheRead, cacheWrite5m, cacheWrite1h}]
// days: a number (last N local days including today) or "all". Each id is counted once; when a
// message was logged more than once (streaming), the entry with the most output tokens wins.
export function summarize(records, { days = 2, now = Date.now(), tz, exists, roots } = {}) {
  const slugCache = new Map();
  const byId = new Map();
  const anonymous = [];
  for (const r of records) {
    if (r.id == null) anonymous.push(r);
    else {
      const prev = byId.get(r.id);
      if (!prev || r.out > prev.out) byId.set(r.id, r);
    }
  }
  const earliest = days === "all" ? null : shiftDate(localDate(now, tz), -(Math.max(1, days) - 1));
  const result = {};
  for (const r of [...byId.values(), ...anonymous]) {
    const date = localDate(r.ts, tz);
    if (earliest && date < earliest) continue;
    const projects = (result[date] ??= { projects: {} }).projects;
    const family = ((projects[slugFor(r.cwd, { exists, roots, cache: slugCache })] ??= {})[familyOf(r.model)] ??=
      { in: 0, out: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, msgs: 0 });
    family.in += r.in;
    family.out += r.out;
    family.cacheRead += r.cacheRead;
    family.cacheWrite5m += r.cacheWrite5m;
    family.cacheWrite1h += r.cacheWrite1h;
    family.msgs += 1;
  }
  const sorted = {};
  for (const date of Object.keys(result).sort()) sorted[date] = result[date];
  return { days: sorted };
}

function findTranscripts(root, minMtime) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const dir = pending.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          // A file last written before the window starts cannot hold lines inside it.
          if (minMtime == null || statSync(path).mtimeMs >= minMtime) files.push(path);
        } catch {
          // unreadable file: skip
        }
      }
    }
  }
  return files;
}

async function readRecords(file, out) {
  try {
    const lines = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const text of lines) {
      if (!text.includes('"usage"') || !text.includes('"assistant"')) continue;
      let line;
      try {
        line = JSON.parse(text);
      } catch {
        continue;
      }
      const record = recordFrom(line);
      if (record) out.push(record);
    }
  } catch {
    // one bad file never stops the run
  }
}

export async function collect({ root, days = 2, now = Date.now(), tz, roots, exists = existsSync } = {}) {
  const minMtime = days === "all" ? null : now - (Math.max(1, days) + 1) * DAY_MS;
  const records = [];
  for (const file of findTranscripts(root, minMtime)) await readRecords(file, records);
  return summarize(records, { days, now, tz, exists, roots });
}

export function toDocs(summary, now = Date.now()) {
  const updatedAt = new Date(now).toISOString();
  return Object.entries(summary.days).map(([date, day]) => ({ date, doc: { date, updatedAt, projects: day.projects } }));
}

function parseArgs(argv) {
  const opts = { root: join(homedir(), ".claude", "projects"), days: 2, out: null, roots: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root") opts.root = resolve(argv[++i]);
    else if (arg === "--out") opts.out = resolve(argv[++i]);
    else if (arg === "--roots") opts.roots = String(argv[++i] ?? "").split(",").map((r) => r.trim()).filter(Boolean);
    else if (arg === "--all") opts.days = "all";
    else if (arg === "--days") opts.days = Number.parseInt(argv[++i], 10);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (opts.days !== "all" && !(opts.days >= 1)) throw new Error("--days needs a whole number of at least 1");
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const now = Date.now();
  const summary = await collect({ root: opts.root, days: opts.days, now, roots: opts.roots });
  if (opts.out) {
    // The folder holds exactly this run's docs: day files from earlier runs are removed first.
    mkdirSync(opts.out, { recursive: true });
    for (const f of readdirSync(opts.out)) if (/^d-\d{4}-\d\d-\d\d\.json$/.test(f)) unlinkSync(join(opts.out, f));
    for (const { date, doc } of toDocs(summary, now)) {
      writeFileSync(join(opts.out, `d-${date}.json`), JSON.stringify(doc, null, 2) + "\n");
    }
  }
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

export { FAMILIES };
