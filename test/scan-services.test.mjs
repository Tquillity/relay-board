// Tests for the services scanner (scripts/scan-services.mjs) against a throwaway fixture repo.
// The fixture uses made-up names and obviously fake values; the point is what the scanner reads and reports.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { scanRepo } from "../scripts/scan-services.mjs";
import { CATALOG } from "../scripts/services-catalog.mjs";

const FAKE_VALUE = "not-a-real-value-for-tests";
let repo;
let result;

// Fixture code is written with a "~" inside each env reference and env assignment, removed on write,
// so that scanning this repo (or a secret scanner) doesn't mistake the test's own strings for real ones.
function write(path, content) {
  content = content.replaceAll("~", "");
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

before(() => {
  repo = mkdtempSync(join(tmpdir(), "scan-services-"));
  write("package.json", JSON.stringify({
    name: "acme-fixture",
    dependencies: { stripe: "^1.0.0", "@sentry/node": "^1.0.0", react: "^18.0.0" },
    devDependencies: { wrangler: "^3.0.0" },
  }));
  // A second workspace with its own manifest.
  write("apps/web/package.json", JSON.stringify({ name: "web", dependencies: { "@supabase/supabase-js": "^2.0.0" } }));
  write("requirements.txt", "# comment\nOpenAI==1.0.0\nflask>=2.0\n");
  write("pyproject.toml", '[project]\nname = "fixture"\ndependencies = [\n  "twilio>=8",\n]\n');
  write("Cargo.toml", '[package]\nname = "fixture"\n[dependencies]\nasync-stripe = "0.1"\n');
  write("go.mod", "module example.test/fixture\n\nrequire (\n\tgithub.com/algolia/algoliasearch-client-go/v3 v3.0.0\n)\n");
  write(".env.example", `STRIPE_SECRET_KEY~=${FAKE_VALUE}\nSTRIPE_WEBHOOK_SECRET~=\nexport RESEND_API_KEY~=\nDATABASE_URL~=\n`);
  write("src/server.ts", [
    "const a = process~.env.POSTHOG_KEY;",
    'const b = process~.env["CLERK_SECRET_KEY"];',
    'const c = Deno~.env.get("MAPBOX_TOKEN");',
    "const d = import~.meta.env.VITE_SENTRY_DSN;",
    "const e = process~.env.DATABASE_URL;",
  ].join("\n"));
  write("worker.py", 'import os\nkey = os~.environ["MAILGUN_API_KEY"]\nother = os~.getenv("SENDGRID_API_KEY")\n');
  write("src/main.rs", 'fn main() { let _ = std::env~::var("PUSHER_SECRET"); }\n');
  write("vercel.json", "{}");
  write("apps/web/netlify.toml", "");
  write(".github/workflows/ci.yml", "name: ci\n");
  // Real env files: must never be read. Their variables exist nowhere else.
  write(".env", `TWILIO_AUTH_TOKEN~=${FAKE_VALUE}\nADYEN_API_KEY~=${FAKE_VALUE}\n`);
  write(".env.local", `ABLY_API_KEY~=${FAKE_VALUE}\n`);
  write("apps/web/.env.production", `PAYPAL_CLIENT_SECRET~=${FAKE_VALUE}\n`);
  // Skipped places.
  write("node_modules/openai/package.json", JSON.stringify({ name: "openai", dependencies: { algoliasearch: "1" } }));
  write("node_modules/some-lib/index.js", "process~.env.KLARNA_TOKEN;");
  write("dist/bundle.js", "process~.env.MIXPANEL_TOKEN;");
  write(".git/config", "[core]\n");
  write("copy/.git", "gitdir: somewhere\n");
  write("copy/package.json", JSON.stringify({ dependencies: { contentful: "1" } }));
  write("big.ts", `process~.env.SANITY_TOKEN;\n${"// padding\n".repeat(60000)}`);
  result = scanRepo(repo);
});

after(() => rmSync(repo, { recursive: true, force: true }));

describe("scanRepo", () => {
  test("finds providers from dependencies in every manifest", () => {
    const { items } = result;
    assert.deepEqual(items.stripe.evidence.filter((e) => e.includes(":") && !e.startsWith(".env")), [
      "Cargo.toml: async-stripe",
      "package.json: stripe",
    ]);
    assert.ok(items.sentry.evidence.includes("package.json: @sentry/node"));
    assert.ok(items.cloudflare.evidence.includes("package.json: wrangler"));
    assert.ok(items.supabase.evidence.includes("apps/web/package.json: @supabase/supabase-js"));
    assert.ok(items.openai.evidence.includes("requirements.txt: OpenAI"));
    assert.ok(items.twilio.evidence.includes("pyproject.toml: twilio"));
    assert.ok(items.algolia.evidence.includes("go.mod: github.com/algolia/algoliasearch-client-go/v3"));
  });

  test("reads variable names from example env files only", () => {
    const { items } = result;
    assert.deepEqual(items.stripe.envVars, ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);
    assert.ok(items.stripe.evidence.includes(".env.example: STRIPE_SECRET_KEY"));
    assert.deepEqual(items.resend.envVars, ["RESEND_API_KEY"]);
  });

  test("finds variable names referenced in code", () => {
    const { items } = result;
    assert.deepEqual(items.posthog.envVars, ["POSTHOG_KEY"]);
    assert.deepEqual(items.clerk.envVars, ["CLERK_SECRET_KEY"]);
    assert.deepEqual(items.mapbox.envVars, ["MAPBOX_TOKEN"]);
    assert.deepEqual(items.sentry.envVars, ["VITE_SENTRY_DSN"]);
    assert.deepEqual(items.mailgun.envVars, ["MAILGUN_API_KEY"]);
    assert.deepEqual(items.sendgrid.envVars, ["SENDGRID_API_KEY"]);
    assert.deepEqual(items.pusher.envVars, ["PUSHER_SECRET"]);
    assert.ok(items.posthog.evidence.includes("src/server.ts: POSTHOG_KEY"));
  });

  test("finds provider config files, at any depth for bare file names", () => {
    const { items } = result;
    assert.ok(items.vercel.evidence.includes("vercel.json"));
    assert.ok(items.netlify.evidence.includes("apps/web/netlify.toml"));
    assert.deepEqual(items["github-actions"].evidence, [".github/workflows/ci.yml"]);
  });

  test("does not turn generic signals into items", () => {
    const names = Object.values(result.items).map((item) => item.name);
    assert.ok(!names.some((name) => /database/i.test(name)));
    assert.ok(!Object.values(result.items).some((item) => item.envVars.includes("DATABASE_URL")));
  });

  test("never reads real .env files and never outputs values", () => {
    const output = JSON.stringify(result);
    assert.ok(!output.includes(FAKE_VALUE));
    for (const id of ["twilio", "adyen", "ably", "paypal"]) {
      const item = result.items[id];
      assert.ok(!item || item.envVars.length === 0, `${id} should not get env vars from a real env file`);
    }
    assert.equal(result.items.adyen, undefined);
    assert.equal(result.items.ably, undefined);
    assert.equal(result.items.paypal, undefined);
    assert.ok(!output.includes('"TWILIO_AUTH_TOKEN"'));
    const evidence = Object.values(result.items).flatMap((item) => item.evidence);
    assert.ok(!evidence.some((e) => /(^|\/)\.env(\.local|\.production)?(:|$)/.test(e)));
  });

  test("skips node_modules, build output, .git and nested worktree copies", () => {
    const output = JSON.stringify(result);
    assert.ok(!output.includes("node_modules"));
    assert.ok(!output.includes("dist/"));
    assert.equal(result.items.klarna, undefined);
    assert.equal(result.items.mixpanel, undefined);
    assert.equal(result.items.contentful, undefined);
    assert.ok(!result.items.algolia.evidence.some((e) => e.includes("node_modules")));
  });

  test("skips files over the size cap", () => {
    assert.equal(result.items.sanity, undefined);
  });

  test("describes each item with a name, category, dashboard link and relative forward-slash evidence", () => {
    for (const item of Object.values(result.items)) {
      assert.equal(typeof item.name, "string");
      assert.equal(typeof item.category, "string");
      assert.match(item.dashboardUrl, /^https:\/\//);
      assert.ok(item.evidence.length > 0);
      for (const entry of item.evidence) assert.ok(!entry.includes("\\") && !/^[A-Za-z]:/.test(entry) && !entry.startsWith("/"));
    }
  });

  test("is deterministic and sorted", () => {
    const again = scanRepo(repo);
    assert.equal(JSON.stringify(again), JSON.stringify(result));
    const ids = Object.keys(result.items);
    assert.deepEqual(ids, [...ids].sort());
    for (const item of Object.values(result.items)) {
      assert.deepEqual(item.evidence, [...item.evidence].sort());
      assert.deepEqual(item.envVars, [...item.envVars].sort());
    }
  });

  test("returns no items for an empty repo", () => {
    const empty = mkdtempSync(join(tmpdir(), "scan-services-empty-"));
    try {
      assert.deepEqual(scanRepo(empty), { items: {} });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("catalog", () => {
  test("has unique ids and complete entries", () => {
    const ids = CATALOG.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const entry of CATALOG) {
      assert.match(entry.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
      assert.ok(entry.name && entry.category && entry.dashboardUrl.startsWith("https://"), entry.id);
      assert.ok(entry.packages?.length || entry.env?.length || entry.files?.length, `${entry.id} has no signals`);
    }
  });
});
