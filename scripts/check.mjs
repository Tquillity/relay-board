// Checks the repo without any dependencies:
//  1. index.html has exactly two inline scripts, the pure core first and then the UI, and both parse,
//  2. the demo's scripts parse,
//  3. the committed demo page is up to date with index.html and the mock.
// Usage: npm run check
import { readFileSync } from "node:fs";
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

for (const file of ["demo/mock-db.js", "demo/screenshot-hooks.js"]) parses(file, read(file));

if (read("docs/demo/index.html") === buildDemo(root)) {
  console.log("ok    docs/demo/index.html is up to date");
} else {
  fail("docs/demo/index.html is out of date: run `npm run demo` and commit the result");
}

process.exit(failed ? 1 : 0);
