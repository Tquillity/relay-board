// Finds the third-party services a repo is connected to, without reading any secret:
//  - dependency names from package.json, requirements*.txt, pyproject.toml, Cargo.toml and go.mod,
//  - environment variable NAMES from example env files and from references in source code,
//  - provider config files (vercel.json, wrangler.toml, .github/workflows/*, ...).
// Real env files (.env, .env.local, ...) are never opened, and no variable value is ever read or printed.
// Usage: node scripts/scan-services.mjs <repo-path>   (prints { "items": { <provider-id>: {...} } } as JSON)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CATALOG } from "./services-catalog.mjs";

const SKIPPED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".turbo", "coverage", "vendor", "target", ".venv",
  "venv", "__pycache__", "worktrees", ".worktrees", ".claude",
]);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 5000;
const MAX_EVIDENCE = 12;

const CODE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx", ".vue", ".svelte", ".astro", ".py", ".rs", ".go",
]);
const ENV_REFERENCES = [
  /(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]*)/g,
  /(?:process\.env|import\.meta\.env)\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g,
  /Deno\.env\.get\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
  /os\.environ(?:\.get)?[[(]\s*["']([A-Z][A-Z0-9_]*)["']/g,
  /os\.getenv\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
  /env::var(?:_os)?\(\s*"([A-Z][A-Z0-9_]*)"/g,
  /os\.Getenv\(\s*"([A-Z][A-Z0-9_]*)"/g,
];

const isExampleEnvFile = (name) => /^(?:\.env(?:\.[\w-]+)?|[\w.-]+\.env)\.(?:example|sample|template)$/.test(name);
// Anything env-like that is not an example file may hold real values: never opened.
const isRealEnvFile = (name) => /^\.env(?:\.|$)/.test(name) || /\.env(?:\.|$)/.test(name);

const globToRegExp = (glob) =>
  new RegExp("^" + glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "$");

// Compile the catalog once: package matchers, env regexes and file matchers per provider.
const PROVIDERS = CATALOG.map((entry) => ({
  ...entry,
  exactPackages: new Set((entry.packages ?? []).filter((p) => !p.endsWith("*"))),
  packagePrefixes: (entry.packages ?? []).filter((p) => p.endsWith("*")).map((p) => p.slice(0, -1)),
  fileMatchers: (entry.files ?? []).map((glob) => ({ byName: !glob.includes("/"), re: globToRegExp(glob) })),
}));

// Dependency names are compared lowercase with "_" folded to "-" (PyPI treats them as the same name).
const normalizePackage = (name) => name.toLowerCase().replace(/_/g, "-");

function listFiles(root) {
  const files = [];
  const pending = [""];
  while (pending.length && files.length < MAX_FILES) {
    const rel = pending.shift();
    let entries;
    try {
      entries = readdirSync(join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    // A nested ".git" file (not folder) marks a git worktree copy of some branch: not part of this repo.
    if (rel && entries.some((e) => e.name === ".git" && e.isFile())) continue;
    for (const entry of entries) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) pending.push(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  }
  return files.slice(0, MAX_FILES);
}

function readText(root, path) {
  const full = join(root, path);
  try {
    if (statSync(full).size > MAX_FILE_BYTES) return null;
    return readFileSync(full, "utf8");
  } catch {
    return null;
  }
}

function dependencyNames(basename, text) {
  const names = new Set();
  if (basename === "package.json") {
    try {
      const pkg = JSON.parse(text);
      for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        for (const name of Object.keys(pkg[field] ?? {})) names.add(name);
      }
    } catch {
      // A broken package.json simply yields no dependencies.
    }
  } else if (/^requirements.*\.txt$/.test(basename)) {
    for (const line of text.split("\n")) {
      const match = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line);
      if (match) names.add(match[1]);
    }
  } else if (basename === "pyproject.toml" || basename === "Cargo.toml") {
    for (const line of text.split("\n")) {
      const key = /^\s*([A-Za-z0-9_.-]+)\s*=/.exec(line) ?? /^\s*\[(?:[\w.-]*dependencies)\.([A-Za-z0-9_.-]+)\]/.exec(line);
      if (key) names.add(key[1]);
      for (const quoted of line.matchAll(/"([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(?:[<>=!~;@ ,]|")/g)) names.add(quoted[1]);
    }
  } else if (basename === "go.mod") {
    for (const line of text.split("\n")) {
      const match = /^\s*(?:require\s+)?([\w.-]+\.[\w.-]+\/[^\s]+)\s+v\d/.exec(line);
      if (match) names.add(match[1]);
    }
  }
  return [...names];
}

function envNamesFromExample(text) {
  const names = new Set();
  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (match) names.add(match[1]);
  }
  return [...names];
}

function envNamesFromCode(text) {
  const names = new Set();
  for (const pattern of ENV_REFERENCES) {
    for (const match of text.matchAll(pattern)) names.add(match[1]);
  }
  return [...names];
}

// Scans a repo folder and returns { items } keyed by provider id. Costs are not part of the scan.
export function scanRepo(dir) {
  const root = resolve(dir);
  const found = new Map(); // provider id -> { provider, evidence: Set, envVars: Set }
  const record = (provider, evidence, envVar) => {
    if (!found.has(provider.id)) found.set(provider.id, { provider, evidence: new Set(), envVars: new Set() });
    const hit = found.get(provider.id);
    hit.evidence.add(evidence);
    if (envVar) hit.envVars.add(envVar);
  };
  const recordEnvName = (path, name) => {
    for (const provider of PROVIDERS) {
      if ((provider.env ?? []).some((re) => re.test(name))) record(provider, `${path}: ${name}`, name);
    }
  };

  for (const path of listFiles(root)) {
    const basename = path.slice(path.lastIndexOf("/") + 1);
    const extension = basename.includes(".") ? basename.slice(basename.lastIndexOf(".")) : "";

    for (const provider of PROVIDERS) {
      if (provider.fileMatchers.some((m) => m.re.test(m.byName ? basename : path))) record(provider, path);
    }

    if (isRealEnvFile(basename) && !isExampleEnvFile(basename)) continue;

    if (isExampleEnvFile(basename)) {
      const text = readText(root, path);
      if (text !== null) for (const name of envNamesFromExample(text)) recordEnvName(path, name);
    } else if (/^(?:package\.json|requirements.*\.txt|pyproject\.toml|Cargo\.toml|go\.mod)$/.test(basename)) {
      const text = readText(root, path);
      if (text === null) continue;
      for (const name of dependencyNames(basename, text)) {
        const normalized = normalizePackage(name);
        for (const provider of PROVIDERS) {
          const matches = provider.exactPackages.has(name) || provider.exactPackages.has(normalized) ||
            provider.packagePrefixes.some((prefix) => normalized.startsWith(prefix));
          if (matches) record(provider, `${path}: ${name}`);
        }
      }
    } else if (CODE_EXTENSIONS.has(extension)) {
      const text = readText(root, path);
      if (text !== null) for (const name of envNamesFromCode(text)) recordEnvName(path, name);
    }
  }

  const items = {};
  for (const id of [...found.keys()].sort()) {
    const { provider, evidence, envVars } = found.get(id);
    items[id] = {
      name: provider.name,
      category: provider.category,
      purpose: provider.purpose,
      evidence: [...evidence].sort().slice(0, MAX_EVIDENCE),
      envVars: [...envVars].sort(),
      dashboardUrl: provider.dashboardUrl,
    };
  }
  return { items };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dir = process.argv[2];
  if (!dir || !existsSync(dir)) {
    console.error("Usage: node scripts/scan-services.mjs <repo-path>");
    process.exit(1);
  }
  console.log(JSON.stringify(scanRepo(dir), null, 2));
}
