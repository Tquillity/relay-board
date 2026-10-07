// End-to-end: build the demo page in memory, load it in headless Chrome, and check what it renders.
// Skipped when Chrome can't be found; set CHROME=/path/to/chrome to point at one.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildDemo } from "../demo/build.mjs";
import { findChrome, dumpDom, decode } from "./chrome.mjs";
import { root } from "./helpers.mjs";

const chrome = findChrome();

// ---- Reading the dumped DOM without a parser ----
/** The visible text of an HTML fragment, whitespace collapsed. */
const text = (html) => decode(html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
/** The HTML between the first `from` and the next `to`. */
const between = (html, from, to) => {
  const a = html.indexOf(from);
  assert.ok(a >= 0, `expected ${from} in the page`);
  const b = html.indexOf(to, a);
  return html.slice(a, b < 0 ? undefined : b);
};
/** The project tabs: [{ label, cls, selected, count }]. */
const tabs = (html) => between(html, 'id="tabs"', "</nav>").split("<button").slice(1).map((b) => {
  const open = b.slice(0, b.indexOf(">"));
  const count = b.match(/class="count"[^>]*>(\d+)</);
  // The label is the button's text without its count badge.
  const inner = b.slice(b.indexOf(">") + 1).replace(/<span class="count"[\s\S]*?<\/span>/, "").replace(/<span class="scope-tag"[\s\S]*?<\/span>/, "");
  return {
    label: text(inner).trim(),
    work: /class="scope-tag"/.test(b),
    cls: open.match(/class="([^"]*)"/)?.[1] || "",
    selected: /aria-selected="true"/.test(open),
    count: count ? Number(count[1]) : 0,
  };
});
/** The overview cards: [{ name, cls, text }]. */
const cards = (html) => [...html.matchAll(/<article class="([^"]*)">([\s\S]*?)<\/article>/g)].map((m) => ({
  cls: m[1], text: text(m[2]), name: text(m[2].match(/<h3>([\s\S]*?)<\/h3>/)?.[1] || ""),
}));
/** The Work | Services switch: [{ label, pressed }] with the count badge left out. */
const viewSwitch = (html) => between(html, 'id="view-switch"', "</div>").split("<button").slice(1).map((b) => ({
  label: text(b.slice(b.indexOf(">") + 1).replace(/<span class="count"[\s\S]*?<\/span>/, "")),
  pressed: /aria-pressed="true"/.test(b.slice(0, b.indexOf(">"))),
  count: Number(b.match(/class="count"[^>]*>(\d+)</)?.[1] || 0),
}));
/** The All | Work | Private filter: the labels of its buttons, and which one is pressed. */
const scopeSwitch = (html) => {
  const buttons = between(html, 'id="scope-switch"', "</div>").split("<button").slice(1).map((b) => ({ text: text(b.slice(b.indexOf(">") + 1)), pressed: /aria-pressed="true"/.test(b.slice(0, b.indexOf(">"))) }));
  return { labels: buttons.map((b) => b.text), pressed: buttons.filter((b) => b.pressed).map((b) => b.text) };
};
/** Asserts that every part appears in `haystack`, in the given order. */
const inOrder = (haystack, parts) => {
  let at = 0;
  for (const part of parts) {
    const i = haystack.indexOf(part, at);
    assert.ok(i >= 0, `expected "${part}" after position ${at} in: ${haystack.slice(at, at + 400)}`);
    at = i + part.length;
  }
};
const header = (html) => text(between(html, 'id="progress"', "</header>").replace(/^[^>]*>/, ""));

if (!chrome) {
  test("the demo in headless Chrome", { skip: "Chrome not found; set CHROME=/path/to/chrome to run the end-to-end tests" }, () => {});
} else describe("the demo in headless Chrome", () => {
  const views = {
    overview: "",
    acme: "#p=acme-storefront",
    garden: "#p=garden-planner",
    since: "?open=since",
    history: "?open=history#p=acme-storefront",
    services: "#v=services",
    servicesAcme: "#v=services&p=acme-storefront",
    work: "#s=work",
    privateServices: "#s=private&v=services",
  };
  const dom = {};
  let dir;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "relay-board-e2e-"));
    const page = join(dir, "demo.html");
    writeFileSync(page, buildDemo(root));
    const url = pathToFileURL(page).href;
    const run = async (name, suffix) => [name, await dumpDom(chrome, url + suffix, join(dir, `profile-${name}`))];
    for (const [name, html] of await Promise.all(Object.entries(views).map(([name, suffix]) => run(name, suffix)))) dom[name] = html;
  });

  after(() => {
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  test("the page connects to the demo data", () => {
    assert.match(dom.overview, /class="pulse live"/);
    assert.match(text(between(dom.overview, 'id="sub"', "</span>")), /Last update/);
  });

  test("tabs list every project: pinned first, the finished one last", () => {
    assert.deepEqual(tabs(dom.overview).map((t) => t.label), ["Overview", "Acme Storefront", "Weather CLI", "Recipe API", "Garden Planner"]);
  });

  test("in All, only the work project's tab carries a marker", () => {
    assert.deepEqual(tabs(dom.overview).filter((t) => t.work).map((t) => t.label), ["Recipe API"]);
    assert.deepEqual(scopeSwitch(dom.overview), { labels: ["All", "Work", "Private"], pressed: ["All"] });
  });

  test("#s=work shows only the work project: its tab, needs, card and the rest of the overview", () => {
    assert.deepEqual(scopeSwitch(dom.work), { labels: ["All", "Work", "Private"], pressed: ["Work"] });
    assert.deepEqual(tabs(dom.work).map((t) => [t.label, t.count, t.work]), [["Overview", 1, false], ["Recipe API", 1, false]]);
    assert.deepEqual(cards(dom.work).map((c) => c.name), ["Recipe API"]);
    const needs = text(between(dom.work, 'id="needs-h-all"', "</section>"));
    assert.match(needs, /Needs you .*1 open/);
    assert.ok(needs.includes("Free-tier rate limit"));
    assert.ok(!needs.includes("Reindex production search"));
    assert.match(text(between(dom.work, 'id="proj-h"', "</section>")), /Projects 1/);
    assert.deepEqual(viewSwitch(dom.work), [{ label: "Work", pressed: true, count: 0 }, { label: "Services", pressed: false, count: 1 }]);
  });

  test("#s=private&v=services keeps the Services view to the private projects", () => {
    assert.deepEqual(scopeSwitch(dom.privateServices), { labels: ["All", "Work", "Private"], pressed: ["Private"] });
    assert.deepEqual(tabs(dom.privateServices).map((t) => t.label), ["Overview", "Acme Storefront", "Weather CLI", "Garden Planner"]);
    assert.deepEqual(viewSwitch(dom.privateServices).map((v) => [v.label, v.pressed, v.count]), [["Work", false, 0], ["Services", true, 2]]);
    const main = text(between(dom.privateServices, 'id="main"', "</main>"));
    assert.match(main, /Check these 2/);
    assert.ok(!main.includes("Recipe API") && !main.includes("Neon"));
    assert.match(text(between(dom.privateServices, 'id="cost"', "</header>").replace(/^[^>]*>/, "")), /^€0 \+ \$127 \/ month$/);
  });

  test("tab badges count only what is waiting on the user", () => {
    const counts = Object.fromEntries(tabs(dom.overview).map((t) => [t.label, t.count]));
    // The answered, relayed decision in Weather CLI is not counted.
    assert.deepEqual(counts, { "Overview": 3, "Acme Storefront": 2, "Weather CLI": 0, "Recipe API": 1, "Garden Planner": 0 });
  });

  test("the overview's Needs you section lists the open items and the answered one apart", () => {
    const needs = text(between(dom.overview, 'id="needs-h-all"', "</section>"));
    assert.match(needs, /Needs you .*3 open/);
    for (const title of ["Add the payment provider's live keys", "Reindex production search", "Free-tier rate limit"]) assert.ok(needs.includes(title), title);
    assert.match(needs, /Answered, waiting on the chat 1/);
    assert.match(needs, /Name of the offline flag/);
  });

  test("the finished project gets the foil treatment on its card and tab", () => {
    const foilCards = cards(dom.overview).filter((c) => /\bfoil\b/.test(c.cls));
    assert.deepEqual(foilCards.map((c) => c.name), ["Garden Planner"]);
    assert.match(foilCards[0].text, /All done/);
    const foilTabs = tabs(dom.overview).filter((t) => /\bfoil\b/.test(t.cls));
    assert.deepEqual(foilTabs.map((t) => t.label), ["Garden Planner"]);
  });

  test("no card is dimmed: the idle one is finished, the rest are busy", () => {
    assert.equal(cards(dom.overview).filter((c) => /\bdim\b/.test(c.cls)).length, 0);
    assert.equal(cards(dom.overview).length, 4);
  });

  test("the digest folds into one sentence of what happened", () => {
    const digest = text(between(dom.overview, 'aria-label="Since you last looked"', "</section>").replace(/^[^>]*>/, ""));
    assert.match(digest, /3 new for you/);
    assert.match(digest, /1 shipped/);
    assert.match(digest, /6 updates in Acme Storefront, Weather CLI \+1/);
    assert.doesNotMatch(digest, /Shipped & finished/);
  });

  test("the opened digest lists the items", () => {
    const digest = text(between(dom.since, 'aria-label="Since you last looked"', "</section>").replace(/^[^>]*>/, ""));
    assert.match(digest, /New for you 3/);
    assert.match(digest, /Shipped & finished 1/);
    assert.match(digest, /Offline mode · v1\.4 released with faster startup/);
    assert.match(digest, /Updates by project 6/);
  });

  test("a project tab shows its progress in the header", () => {
    // Acme's live steps weigh 15 in total (Checkout v2: 1+2+4+1+2+1, Search: 1+2+1) plus 2 open
    // needs at 1 each = 17. Done: 1+2+1+2 = 6 -> floor(35.3) = 35%. Waiting on you: the "you"
    // steps 1+1 plus 2 needs = 4 -> ceil(23.5) = 24%.
    assert.equal(header(dom.acme), "35% / 100% − 24%");
    assert.ok(tabs(dom.acme).find((t) => t.label === "Acme Storefront").selected);
  });

  test("a project tab lists its live workstreams and folds the recently finished one", () => {
    const main = text(between(dom.acme, 'id="main"', "</main>"));
    assert.match(main, /Workstreams .*2 open/);
    assert.ok(main.includes("Checkout v2") && main.includes("Search speed-up"));
    // The 2-day-old footer stream is folded; the 12-day-old banner has moved to History.
    assert.match(main, /Show 1 finished workstream(?!s)/);
    // Each workstream's header shows when its chat last wrote, so it stays visible when folded.
    const updated = [...dom.acme.matchAll(/<span class="stream-updated">Updated <time[^>]*>([^<]*)<\/time><\/span>/g)].map((m) => `Updated ${m[1]}`);
    assert.deepEqual(updated, ["Updated 4m ago", "Updated 50m ago"]);
  });

  test("a finished project shows a full green bar", () => {
    assert.equal(header(dom.garden), "100% / 100% − 0%");
    assert.match(dom.garden, /<span class="progress foil" id="progress"/);
    assert.match(text(between(dom.garden, 'id="main"', "</main>")), /Workstreams .*1 open/);
  });

  test("History lists items older than a week, including archived ones", () => {
    const hist = text(between(dom.history, 'id="hist-h-acme-storefront"', "</section>"));
    assert.match(hist, /History .*3/);
    for (const title of ["Promo banner", "Passwordless login", "Point shop domain at new host"]) assert.ok(hist.includes(title), title);
    assert.match(hist, /PR #98/);
  });

  test("the Work view is the default and the Services switch shows the warning count", () => {
    assert.deepEqual(viewSwitch(dom.overview), [{ label: "Work", pressed: true, count: 0 }, { label: "Services", pressed: false, count: 3 }]);
    assert.equal(header(dom.acme), "35% / 100% − 24%");
    assert.match(dom.overview, /<span class="progress" id="cost" hidden/);
  });

  test("the Services overview lists what to check, then every project with its services and cost", () => {
    assert.deepEqual(viewSwitch(dom.services), [{ label: "Work", pressed: false, count: 0 }, { label: "Services", pressed: true, count: 3 }]);
    const main = text(between(dom.services, 'id="main"', "</main>"));
    assert.match(main, /Check these 3/);
    for (const w of ["Up from $25 to $58 a month", "No longer found in the code but still costs $29 a month", "Cost not updated for 60 days"]) assert.ok(main.includes(w), w);
    const projects = text(between(dom.services, 'id="svc-proj-h"', "</section>"));
    assert.match(projects, /Projects 4/);
    inOrder(projects, ["Acme Storefront", "Supabase $58", "Sentry", "Algolia", "$127", "2 to check · 1 without a cost"]);
    inOrder(projects, ["Recipe API", "Neon SEK 199", "€9 + SEK 199 + $19.40", "1 to check"]);
    assert.ok(projects.includes("All projects 12 active €9 + SEK 199 + $146.40 3 to check"));
    const providers = text(between(dom.services, 'id="svc-prov-h"', "</section>"));
    assert.match(providers, /By provider 13/);
    assert.match(providers, /Algolia .*no longer used/);
  });

  test("the Services header shows the monthly total per currency, and the tabs show warning counts", () => {
    assert.equal(text(between(dom.services, 'id="cost"', "</header>").replace(/^[^>]*>/, "")), "€9 + SEK 199 + $146.40 / month");
    const counts = Object.fromEntries(tabs(dom.services).map((t) => [t.label, t.count]));
    assert.deepEqual(counts, { "Overview": 3, "Acme Storefront": 2, "Weather CLI": 0, "Recipe API": 1, "Garden Planner": 0 });
  });

  test("a project's Services tab groups its services by category with their costs and warnings", () => {
    assert.ok(tabs(dom.servicesAcme).find((t) => t.label === "Acme Storefront").selected);
    assert.equal(text(between(dom.servicesAcme, 'id="cost"', "</header>").replace(/^[^>]*>/, "")), "$127 / month");
    const main = text(between(dom.servicesAcme, 'id="main"', "</main>"));
    assert.match(main, /Services .*5/);
    for (const category of ["Payments", "Databases", "Hosting", "Email", "Monitoring"]) assert.ok(main.includes(category), category);
    inOrder(main, ["Stripe", "Card payments at checkout", "PAYMENT_SECRET_KEY", "Found in 3 places", "$0/mo", "entered by you 6d ago"]);
    inOrder(main, ["Supabase", "Up from $25 to $58 a month", "$58/mo", "from billing 1d ago · last month $25 · includes a compute add-on"]);
    assert.match(main, /Sentry .*Cost not set .*Set cost/);
    // The removed service still costs money, so its fold is open.
    assert.match(main, /Hide 1 no longer found in the code/);
    inOrder(main, ["Algolia", "No longer found in the code but still costs $29 a month", "$29/mo", "entered by you 10d ago"]);
  });
});
