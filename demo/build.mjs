// Builds demo/board-demo.html: the real page with made-up data in place of the claude.ai db.
// Usage: node demo/build.mjs   then open demo/board-demo.html in a browser.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "..", "index.html"), "utf8");
const mock = readFileSync(join(here, "mock-db.js"), "utf8");
const head = '<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n';
writeFileSync(join(here, "board-demo.html"), `${head}<script>\n${mock}</script>\n${page}`);
console.log("Wrote demo/board-demo.html");
