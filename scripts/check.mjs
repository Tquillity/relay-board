// Checks the repo without any dependencies:
//  1. the page's inline <script> parses,
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
let failed = false;

function parses(label, code) {
  try {
    new Script(code, { filename: label });
    console.log(`ok    ${label} parses`);
  } catch (err) {
    failed = true;
    console.error(`FAIL  ${label}: ${err.message}`);
  }
}

const page = read("index.html");
const scripts = [...page.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)];
if (scripts.length !== 1) {
  failed = true;
  console.error(`FAIL  index.html should have exactly one inline <script>, found ${scripts.length}`);
} else {
  parses("index.html <script>", scripts[0][1]);
}

for (const file of ["demo/mock-db.js", "demo/screenshot-hooks.js"]) parses(file, read(file));

if (read("docs/demo/index.html") === buildDemo(root)) {
  console.log("ok    docs/demo/index.html is up to date");
} else {
  failed = true;
  console.error("FAIL  docs/demo/index.html is out of date: run `npm run demo` and commit the result");
}

process.exit(failed ? 1 : 0);
