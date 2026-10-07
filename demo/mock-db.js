// Demo data for the Relay Board. Everything here is made up (projects, repos, links, answers);
// none of it is real board data.
// Stands in for the claude.ai `db` capability so the page runs from a plain file.
(() => {
  const now = Date.now(), M = 60e3, H = 60 * M, D = 24 * H;
  const at = (ms) => new Date(now - ms).toISOString();
  const weekEnd = new Date(now + 4 * D + 5 * H).toISOString();

  const DATA = {
    projects: {
      "acme-storefront": { name: "Acme Storefront", repo: "example/acme-storefront", repoUrl: "https://github.com/example/acme-storefront", path: "~/code/acme-storefront", updatedAt: at(4 * M), pinned: true, scope: "private" },
      "weather-cli": { name: "Weather CLI", repo: "example/weather-cli", repoUrl: "https://github.com/example/weather-cli", path: "~/code/weather-cli", updatedAt: at(40 * M), scope: "private" },
      "recipe-api": { name: "Recipe API", repo: "example/recipe-api", repoUrl: "https://github.com/example/recipe-api", path: "~/code/recipe-api", updatedAt: at(3 * H), scope: "work" },
      "garden-planner": { name: "Garden Planner", path: "~/code/garden-planner", updatedAt: at(9 * D) },
    },
    streams: {
      "acme-storefront--checkout-v2": {
        project: "acme-storefront", title: "Checkout v2", tool: "Claude Code", agent: "Claude Opus",
        session: { title: "Rebuild the checkout flow" },
        status: "active", currentTask: "Wiring the new payment step to the order service.", waitingOn: null, updatedAt: at(4 * M),
        steps: [
          { title: "Map the current checkout flow", state: "done", size: "S" },
          { title: "New cart summary component", state: "done", size: "M" },
          { title: "Payment step with test-mode provider", state: "active", size: "L", note: "Card form done, webhooks next" },
          { title: "Add the payment provider's live keys", state: "todo", size: "S", by: "you" },
          { title: "End-to-end tests for guest checkout", state: "todo", size: "M" },
          { title: "Review and merge", state: "todo", size: "S" },
        ],
        blockers: [{ text: "Tax rates for two regions are missing from the fixtures.", severity: "normal" }],
        links: [{ label: "Design notes", url: "https://example.com/acme/checkout" }],
        pr: { number: 142, url: "https://github.com/example/acme-storefront/pull/142", ci: "running", state: "open" },
        recent: [
          { text: "Card form validates and tokenises in test mode", at: at(25 * M) },
          { text: "Cart summary merged behind a feature flag", url: "https://github.com/example/acme-storefront/pull/139", at: at(3 * H) },
          { text: "Mapped the old checkout into 6 steps", at: at(5 * H) },
        ],
      },
      "acme-storefront--search": {
        project: "acme-storefront", title: "Search speed-up", tool: "Claude Code", agent: "Claude Sonnet",
        status: "waiting", currentTask: "Index change is ready; waiting on your approval before touching production.", waitingOn: "Your approval to reindex production", updatedAt: at(50 * M),
        steps: [
          { title: "Profile slow queries", state: "done", size: "S" },
          { title: "Add trigram index", state: "done", size: "M" },
          { title: "Approve production reindex", state: "waiting", size: "S", by: "you" },
        ],
        recent: [{ text: "Search p95 down from 820 ms to 140 ms on staging", at: at(55 * M) }],
      },
      "acme-storefront--footer": {
        project: "acme-storefront", title: "Footer links", status: "done", currentTask: "Done.", updatedAt: at(2 * D),
        lastShipped: { text: "New footer with legal links", at: at(2 * D) },
        recent: [{ text: "New footer with legal links", at: at(2 * D) }],
      },
      "acme-storefront--old-banner": {
        project: "acme-storefront", title: "Promo banner", status: "done", updatedAt: at(12 * D),
        lastShipped: { text: "Seasonal promo banner", url: "https://github.com/example/acme-storefront/pull/120", at: at(12 * D) },
        pr: { number: 120, url: "https://github.com/example/acme-storefront/pull/120", state: "merged" },
      },
      "weather-cli--offline": {
        project: "weather-cli", title: "Offline mode", tool: "Claude Code", agent: "Claude Opus",
        status: "active", currentTask: "Caching the last forecast so the CLI works without a network.", updatedAt: at(40 * M),
        lastShipped: { text: "v1.4 released with faster startup", url: "https://github.com/example/weather-cli/releases", at: at(2 * H) },
        steps: [
          { title: "Cache layer", state: "done", size: "M" },
          { title: "Stale-data warning", state: "active", size: "S" },
          { title: "Docs and release notes", state: "todo", size: "S" },
        ],
        recent: [{ text: "Forecasts cached for 6 hours", at: at(45 * M) }],
      },
      "recipe-api--rate-limits": {
        project: "recipe-api", title: "Rate limits", tool: "Claude Code", agent: "Claude Sonnet",
        status: "blocked", currentTask: "Needs a decision on the free-tier limit before shipping.", waitingOn: "Your decision on the free-tier limit", updatedAt: at(3 * H),
        steps: [
          { title: "Token-bucket middleware", state: "done", size: "M" },
          { title: "Pick free-tier limit", state: "blocked", size: "S", by: "you" },
          { title: "Load test", state: "todo", size: "M" },
        ],
        blockers: [{ text: "Can't ship without a free-tier limit.", severity: "high" }],
        recent: [{ text: "Middleware passes unit tests", at: at(3 * H) }],
      },
      "garden-planner--ideas": {
        project: "garden-planner", title: "Ideas for later", status: "idle", currentTask: "Parked: frost alerts, seed swap list.", updatedAt: at(9 * D),
        steps: [{ title: "Frost alerts", state: "todo" }, { title: "Seed swap list", state: "todo" }],
      },
      "garden-planner--main": {
        project: "garden-planner", title: "Planting calendar", status: "done", currentTask: "Shipped.", updatedAt: at(9 * D),
        lastShipped: { text: "Planting calendar v1", at: at(9 * D) },
        recent: [{ text: "Planting calendar v1", at: at(9 * D) }],
      },
    },
    needs: {
      "acme-storefront-keys": {
        project: "acme-storefront", stream: "acme-storefront--checkout-v2", kind: "task", priority: "high",
        title: "Add the payment provider's live keys", why: "Checkout can only take real payments once the live keys are in the deploy settings.",
        steps: ["Open the hosting dashboard", "Add PAYMENT_LIVE_KEY and PAYMENT_WEBHOOK_SECRET", "Mark this done"], done: false, createdAt: at(30 * M),
      },
      "acme-storefront-reindex": {
        project: "acme-storefront", stream: "acme-storefront--search", kind: "approval", priority: "normal",
        title: "Reindex production search", why: "Takes about 4 minutes; search stays up but may be slower meanwhile.", done: false, createdAt: at(50 * M),
      },
      "recipe-api-limit": {
        project: "recipe-api", stream: "recipe-api--rate-limits", kind: "decision", priority: "normal",
        title: "Free-tier rate limit", why: "Sets how many requests per minute free users get.", options: ["30 / min", "60 / min", "120 / min"], done: false, createdAt: at(3 * H),
      },
      "weather-cli-name": {
        project: "weather-cli", stream: "weather-cli--offline", kind: "decision", title: "Name of the offline flag",
        options: ["--offline", "--cached"], answer: { choice: "--offline", note: null, at: at(20 * M) }, answerState: "relayed", relayedAt: at(18 * M), done: false, createdAt: at(1 * H),
      },
    },
    archive: {
      "acme-storefront--2026-08": {
        project: "acme-storefront", month: "2026-08",
        items: {
          stream_login: { kind: "stream", title: "Passwordless login", summary: "Magic-link sign-in shipped", pr: { number: 98 }, finishedAt: at(40 * D) },
          need_domain: { kind: "need", needKind: "approval", title: "Point shop domain at new host", summary: "Approve", finishedAt: at(42 * D) },
        },
      },
    },
    // Third-party services per project: costs from billing (autoCost) or typed in by the viewer (manualCost).
    services: {
      "acme-storefront": {
        project: "acme-storefront", scannedAt: at(1 * D), updatedAt: at(1 * D),
        items: {
          stripe: {
            name: "Stripe", category: "payments", purpose: "Card payments at checkout", dashboardUrl: "https://dashboard.stripe.com",
            evidence: ["package.json: stripe", ".env.example: PAYMENT_SECRET_KEY", "src/checkout/pay.ts: process.env.PAYMENT_WEBHOOK_SECRET"],
            envVars: ["PAYMENT_SECRET_KEY", "PAYMENT_WEBHOOK_SECRET"], manualCost: { monthly: 0, currency: "USD", at: at(6 * D) },
          },
          vercel: {
            name: "Vercel", category: "hosting", purpose: "Hosts the storefront", plan: "Pro", dashboardUrl: "https://vercel.com/dashboard",
            evidence: ["vercel.json", "package.json: @vercel/analytics"], envVars: ["VERCEL_URL"],
            autoCost: { monthly: 20, currency: "USD", at: at(1 * D), lastMonth: 20, note: "from the hosting invoice" },
          },
          supabase: {
            name: "Supabase", category: "database", purpose: "Orders and catalogue", plan: "Pro", dashboardUrl: "https://supabase.com/dashboard",
            evidence: ["package.json: @supabase/supabase-js", "supabase/config.toml", ".env.example: SUPABASE_URL"], envVars: ["SUPABASE_ANON_KEY", "SUPABASE_URL"],
            autoCost: { monthly: 58, currency: "USD", at: at(1 * D), lastMonth: 25, note: "includes a compute add-on" },
          },
          resend: {
            name: "Resend", category: "email", purpose: "Order confirmation emails", dashboardUrl: "https://resend.com",
            evidence: ["package.json: resend"], envVars: ["MAIL_API_KEY"], manualCost: { monthly: 20, currency: "USD", at: at(3 * D) },
          },
          sentry: {
            name: "Sentry", category: "monitoring", purpose: "Error reports", dashboardUrl: "https://sentry.io",
            evidence: ["package.json: @sentry/nextjs", ".env.example: SENTRY_DSN"], envVars: ["SENTRY_DSN"],
          },
          algolia: {
            name: "Algolia", category: "search", purpose: "Product search before the in-house index", dashboardUrl: "https://dashboard.algolia.com",
            evidence: ["package.json: algoliasearch (removed)"], envVars: ["SEARCH_APP_ID"], removed: true,
            manualCost: { monthly: 29, currency: "USD", at: at(10 * D) },
          },
        },
      },
      "weather-cli": {
        project: "weather-cli", scannedAt: at(2 * D), updatedAt: at(2 * D),
        items: {
          "github-actions": {
            name: "GitHub Actions", category: "ci", purpose: "Tests and releases", dashboardUrl: "https://github.com/features/actions",
            evidence: [".github/workflows/release.yml"], envVars: [], manualCost: { monthly: 0, currency: "USD", at: at(14 * D) },
          },
          upstash: {
            name: "Upstash", category: "database", purpose: "Shared forecast cache", dashboardUrl: "https://console.upstash.com",
            evidence: ["package.json: @upstash/redis", ".env.example: CACHE_REST_URL"], envVars: ["CACHE_REST_URL", "CACHE_REST_TOKEN"],
            manualCost: { monthly: 0, currency: "EUR", at: at(14 * D) },
          },
        },
      },
      "recipe-api": {
        project: "recipe-api", scannedAt: at(5 * D), updatedAt: at(5 * D),
        items: {
          render: {
            name: "Render", category: "hosting", purpose: "Runs the API", plan: "Starter", dashboardUrl: "https://dashboard.render.com",
            evidence: ["render.yaml"], envVars: ["PORT"], autoCost: { monthly: 7, currency: "USD", at: at(2 * D), lastMonth: 7 },
          },
          neon: {
            name: "Neon", category: "database", purpose: "Recipes and users", plan: "Launch", dashboardUrl: "https://console.neon.tech",
            evidence: ["package.json: @neondatabase/serverless", ".env.example: DATABASE_URL"], envVars: ["DATABASE_URL"],
            manualCost: { monthly: 199, currency: "SEK", at: at(12 * D) },
          },
          anthropic: {
            name: "Anthropic", category: "ai", purpose: "Recipe suggestions", dashboardUrl: "https://console.anthropic.com",
            evidence: ["package.json: @anthropic-ai/sdk", ".env.example: LLM_API_KEY"], envVars: ["LLM_API_KEY"],
            autoCost: { monthly: 12.4, currency: "USD", at: at(1 * D), lastMonth: 11, note: "usage this month so far" },
          },
          cloudflare: {
            name: "Cloudflare", category: "domain", purpose: "DNS for the API domain", dashboardUrl: "https://dash.cloudflare.com",
            evidence: ["wrangler.toml"], envVars: [], manualCost: { monthly: 9, currency: "EUR", at: at(60 * D) },
          },
        },
      },
      "garden-planner": {
        project: "garden-planner", scannedAt: at(9 * D), updatedAt: at(9 * D),
        items: {
          netlify: {
            name: "Netlify", category: "hosting", purpose: "Static site", dashboardUrl: "https://app.netlify.com",
            evidence: ["netlify.toml"], envVars: [], manualCost: { monthly: 0, currency: "USD", at: at(9 * D) },
          },
        },
      },
    },
    usage: {},
  };
  // A week of plan-usage readings, so the bars and week curve have something to show.
  for (let h = 70; h >= 0; h -= 6) {
    const id = `u-demo-${h}`;
    DATA.usage[id] = {
      at: at(h * H), project: "acme-storefront",
      weekAll: { pct: Math.round(38 - h * 0.35), resetsAt: weekEnd },
      weekFable: { pct: Math.round(22 - h * 0.2), resetsAt: weekEnd },
      fiveHour: { pct: 34, resetsAt: new Date(now + 2 * H).toISOString() },
    };
  }

  const subs = {};
  const snap = (c) => ({ docs: Object.entries(DATA[c] || {}).map(([id, r]) => ({ id, exists: true, data: () => r })), metadata: { fromCache: false } });
  const fire = (c) => (subs[c] || []).forEach((cb) => setTimeout(() => cb(snap(c)), 0));
  const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" ? merge({ ...a[k] }, v) : v; return a; };
  const db = {
    collection: (c) => ({ onSnapshot: (cb) => { (subs[c] ||= []).push(cb); setTimeout(() => cb(snap(c)), 0); return () => {}; } }),
    doc: (path) => {
      const [c, id] = path.split("/");
      DATA[c] ||= {};
      return {
        get: async () => ({ exists: !!DATA[c][id], data: () => DATA[c][id] }),
        set: async (d) => { DATA[c][id] = d; fire(c); },
        update: async (d) => { if (!DATA[c][id]) throw { code: "invalid_argument" }; DATA[c][id] = merge({ ...DATA[c][id] }, d); fire(c); },
        delete: async () => { delete DATA[c][id]; fire(c); },
        acquire: async () => ({ acquired: true }),
      };
    },
  };
  window.claude = { use: async (name) => (name === "db" ? db : null) };
  // Pretend the viewer last looked 6 hours ago, so "Since you last looked" has something to show.
  try { if (!localStorage.getItem("relay-last-seen")) localStorage.setItem("relay-last-seen", String(now - 6 * H)); } catch {}
})();
