// Checks the repo without any dependencies:
//  1. index.html has exactly two inline scripts, the pure core first and then the UI, and both parse,
//  2. the demo's and the test harness's scripts parse,
//  3. the committed demo page is up to date with index.html and the mock,
//  4. no tracked file contains a private link, a credential or a personal address.
// Usage: npm run check
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { buildDemo } from "../demo/build.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n");
const CORE_MARKER = "// ---- Core: pure logic, no DOM ----";
let failed = false;

function fail(msg) {
  failed = true;
  console.error(`FAIL  ${msg}`);
}

function parses(label, code) {
  try {
    new Script(code, { filename: label });
    console.log(`ok    ${label} parses`);
  } catch (err) {
    fail(`${label}: ${err.message}`);
  }
}

const page = read("index.html");
const scripts = [...page.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]);
if (scripts.length !== 2) {
  fail(`index.html should have exactly two inline <script>s (core, then UI), found ${scripts.length}`);
} else if (!scripts[0].startsWith(CORE_MARKER)) {
  fail(`index.html: the first <script> should be the core, starting with "${CORE_MARKER}"`);
} else {
  parses("index.html core <script>", scripts[0]);
  parses("index.html UI <script>", scripts[1]);
}

for (const file of ["demo/mock-db.js", "demo/screenshot-hooks.js", "test/harness.js"]) parses(file, read(file));

if (read("docs/demo/index.html") === buildDemo(root)) {
  console.log("ok    docs/demo/index.html is up to date");
} else {
  fail("docs/demo/index.html is out of date: run `npm run demo` and commit the result");
}

// The repo is public, and a real board is private: its link, the chats' session ids and any
// credential must never be committed. This runs here (and so in CI) as well as in any local hook.
const PRIVATE = [
  ["a claude.ai artifact link", /claude\.ai\/(?:code\/|public\/)?artifacts?\/[\w-]{6,}/],
  ["a Claude app session id", /\blocal_[0-9a-f]{8}-[0-9a-f]{4}-/],
  ["a personal email address", /[\w.+-]+@(?:gmail|googlemail|hotmail|outlook|live|msn|yahoo|icloud|me|mac|proton|protonmail|pm)\.[a-z]+/i],
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub[_]pat[_][A-Za-z0-9_]{30,}/],
  ["an API key", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|\bAKIA[0-9A-Z]{16}\b|\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["a connection string with a password", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"'`]+:[^\s@/"'`]+@[^\s"'`]+/i],
];
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
let leaks = 0;
for (const file of tracked) {
  if (!existsSync(join(root, file))) continue; // deleted, not yet committed
  const buf = readFileSync(join(root, file));
  if (buf.includes(0)) continue; // binary (the screenshots)
  const lines = buf.toString("utf8").split("\n");
  lines.forEach((line, i) => {
    for (const [what, re] of PRIVATE) if (re.test(line)) { leaks++; fail(`${file}:${i + 1} looks like ${what}`); }
  });
}
if (!leaks) console.log(`ok    no private links, credentials or personal addresses in ${tracked.length} tracked files`);

process.exit(failed ? 1 : 0);
