// The Services view's core: cleaning incoming docs, the effective cost, warnings, and the summary
// per project, per currency and per provider (PROTOCOL.md, "services/<slug>").
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, board, project, DAY, NOW, before } from "./helpers.mjs";

const core = loadCore();
const cost = (monthly, ageMs = DAY, currency = "USD", extra = {}) => ({ monthly, currency, at: before(ageMs), ...extra });
const item = (fields = {}) => ({ name: "Svc", category: "hosting", ...fields });
const doc = (id, items, fields = {}) => ({ id, project: id, scannedAt: before(DAY), updatedAt: before(DAY), items, ...fields });
const summary = (services, projects = []) => core.servicesSummary(board({ projects, services }), NOW);

// ---- normalize ----

test("a services doc keeps only object items, text lists and usable costs, and the store id wins", () => {
  const d = core.normalize("services", "shop", {
    id: "other",
    items: {
      a: item({ envVars: ["A_KEY", 5, null, {}], evidence: "not a list", autoCost: cost(12), manualCost: { monthly: -1, currency: "USD" } }),
      b: "not an item",
      c: null,
      d: item({ autoCost: { monthly: "12", currency: "USD" }, manualCost: { monthly: 3, currency: "" } }),
      e: item({ autoCost: { monthly: NaN, currency: "USD" }, manualCost: [] }),
    },
  });
  assert.equal(d.id, "shop");
  assert.deepEqual(Object.keys(d.items), ["a", "d", "e"]);
  assert.deepEqual(d.items.a.envVars, ["A_KEY", "5"]);
  assert.deepEqual(d.items.a.evidence, []);
  assert.equal(d.items.a.autoCost.monthly, 12);
  assert.equal("manualCost" in d.items.a, false);
  for (const k of ["autoCost", "manualCost"]) assert.equal(k in d.items.d, false, k);
  for (const k of ["autoCost", "manualCost"]) assert.equal(k in d.items.e, false, k);
});

test("a services doc without a usable items map gets an empty one; a non-object doc is dropped", () => {
  assert.deepEqual(core.normalize("services", "shop", { items: [1, 2] }).items, {});
  assert.deepEqual(core.normalize("services", "shop", {}).items, {});
  assert.equal(core.normalize("services", "shop", "text"), null);
});

test("a cost of zero is valid: it means free", () => {
  const d = core.normalize("services", "shop", { items: { a: item({ manualCost: cost(0) }) } });
  assert.equal(d.items.a.manualCost.monthly, 0);
});

// ---- effectiveCost ----

test("the newer of the billing figure and the typed one counts", () => {
  const auto = cost(20, 2 * DAY), manual = cost(5, DAY);
  assert.deepEqual(core.effectiveCost({ autoCost: auto, manualCost: manual }), { monthly: 5, currency: "USD", at: manual.at, source: "manual" });
  const newerAuto = cost(20, DAY), olderManual = cost(5, 3 * DAY);
  assert.equal(core.effectiveCost({ autoCost: newerAuto, manualCost: olderManual }).source, "auto");
});

test("a tie goes to the figure the viewer typed", () => {
  const at = before(DAY);
  assert.equal(core.effectiveCost({ autoCost: { monthly: 1, currency: "USD", at }, manualCost: { monthly: 2, currency: "USD", at } }).monthly, 2);
});

test("one usable cost is enough, and none gives null", () => {
  assert.equal(core.effectiveCost({ autoCost: cost(9) }).source, "auto");
  assert.equal(core.effectiveCost({ manualCost: cost(0) }).monthly, 0);
  assert.equal(core.effectiveCost({}), null);
  assert.equal(core.effectiveCost({ autoCost: { monthly: -2, currency: "USD" } }), null);
  assert.equal(core.effectiveCost(null), null);
});

// ---- warnings ----

const kinds = (it) => core.serviceWarnings(it, NOW).map((w) => w.kind);

test("a removed service that still costs money is a warning, a free one is not", () => {
  const [w] = core.serviceWarnings(item({ removed: true, manualCost: cost(29) }), NOW);
  assert.equal(w.kind, "removed-paid");
  assert.match(w.text, /No longer found in the code but still costs \$29/);
  assert.deepEqual(kinds(item({ removed: true, manualCost: cost(0) })), []);
  assert.deepEqual(kinds(item({ removed: true })), []);
});

test("a cost that rose by more than 25% and at least 5 is flagged", () => {
  assert.deepEqual(kinds(item({ autoCost: cost(58, DAY, "USD", { lastMonth: 25 }) })), ["increase"]);
  assert.match(core.serviceWarnings(item({ autoCost: cost(58, DAY, "USD", { lastMonth: 25 }) }), NOW)[0].text, /Up from \$25 to \$58/);
});

test("the cost increase thresholds are exact", () => {
  // 25% up exactly is not enough; neither is a big percentage of a tiny amount.
  assert.deepEqual(kinds(item({ autoCost: cost(25, DAY, "USD", { lastMonth: 20 }) })), []);
  assert.deepEqual(kinds(item({ autoCost: cost(25.1, DAY, "USD", { lastMonth: 20 }) })), ["increase"]);
  assert.deepEqual(kinds(item({ autoCost: cost(4, DAY, "USD", { lastMonth: 1 }) })), []);
  assert.deepEqual(kinds(item({ autoCost: cost(5, DAY, "USD", { lastMonth: 0 }) })), ["increase"]);
  assert.deepEqual(kinds(item({ autoCost: cost(30, DAY, "USD", { lastMonth: 30 }) })), []);
});

test("a typed cost newer than the billing figure hides the increase", () => {
  assert.deepEqual(kinds(item({ autoCost: cost(58, 5 * DAY, "USD", { lastMonth: 25 }), manualCost: cost(30, DAY) })), []);
});

test("a cost older than 45 days is stale", () => {
  assert.deepEqual(kinds(item({ manualCost: cost(9, 45 * DAY) })), []);
  assert.deepEqual(kinds(item({ manualCost: cost(9, 45 * DAY + 1) })), ["stale"]);
  assert.match(core.serviceWarnings(item({ manualCost: cost(9, 60 * DAY) }), NOW)[0].text, /60 days/);
});

test("an active service without any cost is soft: shown, but not a warning", () => {
  const [w] = core.serviceWarnings(item(), NOW);
  assert.deepEqual({ kind: w.kind, soft: w.soft, text: w.text }, { kind: "unknown", soft: true, text: "Cost not set" });
  const s = summary([doc("shop", { a: item() })]);
  assert.equal(s.warnings.length, 0);
  assert.equal(s.unknown, 1);
  assert.equal(s.projects[0].unknown, 1);
});

// ---- money ----

test("money is formatted per currency and never converted", () => {
  assert.equal(core.formatMoney(32, "USD", "en-US"), "$32");
  assert.equal(core.formatMoney(12.5, "USD", "en-US"), "$12.50");
  assert.equal(core.formatMoney(199, "SEK", "sv-SE").replace(/\s/g, " "), "199 kr");
  assert.equal(core.formatTotals([{ currency: "USD", monthly: 32 }, { currency: "SEK", monthly: 199 }], "en-US").replace(/\s/g, " "), "$32 + SEK 199");
  assert.equal(core.formatTotals([], "en-US"), "");
  assert.equal(core.formatMoney(5, "not a code", "en-US"), "5 not a code");
});

// ---- summary ----

const demo = [
  doc("shop", {
    free: item({ name: "Free", manualCost: cost(0) }),
    unset: item({ name: "Unset" }),
    gone: item({ name: "Gone", removed: true, manualCost: cost(29) }),
    big: item({ name: "Big", autoCost: cost(40) }),
    small: item({ name: "Small", manualCost: cost(7) }),
    sek: item({ name: "Sek", manualCost: cost(199, DAY, "SEK") }),
  }),
  doc("api", { big: item({ name: "Big", autoCost: cost(10.25) }), eur: item({ name: "Eur", manualCost: cost(9, DAY, "EUR") }) }),
];

test("a project's items are sorted: paid by cost, then free, then unknown, removed last", () => {
  const ids = summary(demo).projects.find((p) => p.slug === "shop").items.map((s) => s.id);
  assert.deepEqual(ids, ["sek", "big", "small", "free", "unset", "gone"]);
});

test("totals add up per currency, include a removed service that still costs, and are never converted", () => {
  const s = summary(demo);
  assert.deepEqual(s.projects.find((p) => p.slug === "shop").totals, [{ currency: "SEK", monthly: 199 }, { currency: "USD", monthly: 76 }]);
  assert.deepEqual(s.totals, [{ currency: "EUR", monthly: 9 }, { currency: "SEK", monthly: 199 }, { currency: "USD", monthly: 86.25 }]);
});

test("totals don't pick up floating point dust", () => {
  const s = summary([doc("shop", { a: item({ manualCost: cost(0.1) }), b: item({ manualCost: cost(0.2) }) })]);
  assert.deepEqual(s.totals, [{ currency: "USD", monthly: 0.3 }]);
});

test("warnings are collected per project and overall, with the project and service named", () => {
  const s = summary(demo, [project({ id: "shop", name: "Shop" })]);
  assert.deepEqual(s.warnings.map((w) => [w.project, w.projectName, w.service, w.kind]), [["shop", "Shop", "gone", "removed-paid"]]);
  assert.equal(s.projects.find((p) => p.slug === "shop").warnings.length, 1);
  assert.equal(s.projects.find((p) => p.slug === "api").warnings.length, 0);
  assert.equal(s.unknown, 1);
});

test("projects follow the board's tab order, and unknown projects come last", () => {
  const projects = [project({ id: "b", name: "B", order: 1 }), project({ id: "a", name: "A", order: 2 })];
  const slugs = (s) => s.projects.map((p) => p.slug);
  assert.deepEqual(slugs(summary([doc("zzz", {}), doc("a", {}), doc("b", {})], projects)), ["b", "a", "zzz"]);
});

test("the by-provider list says which projects use each provider and what it costs together", () => {
  const s = summary(demo);
  const big = s.providers.find((p) => p.id === "big");
  assert.deepEqual(big.projects.map((p) => p.slug), ["api", "shop"]);
  assert.deepEqual(big.totals, [{ currency: "USD", monthly: 50.25 }]);
  assert.equal(big.removed, false);
  assert.equal(s.providers.find((p) => p.id === "gone").removed, true);
  assert.equal(s.providers[0].id, "sek", "the dearest provider comes first");
});

test("a project without a scan time or items still summarises", () => {
  const s = summary([{ id: "shop", items: {} }]);
  assert.deepEqual(s.projects[0], { slug: "shop", name: "shop", items: [], totals: [], warnings: [], unknown: 0, scannedAt: null, updatedAt: null });
});

test("unsafe dashboard links are dropped and unknown categories become 'other'", () => {
  const s = summary([doc("shop", { a: item({ category: "bogus", dashboardUrl: "javascript:alert(1)" }), b: item({ dashboardUrl: "https://example.com" }) })]);
  const [a, b] = ["a", "b"].map((id) => s.projects[0].items.find((x) => x.id === id));
  assert.equal(a.category, "other");
  assert.equal(a.dashboardUrl, null);
  assert.equal(b.dashboardUrl, "https://example.com");
});

test("no services data at all gives an empty summary", () => {
  assert.deepEqual(core.servicesSummary({}, NOW), { projects: [], totals: [], warnings: [], unknown: 0, providers: [] });
});
