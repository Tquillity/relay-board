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
  const inner = b.slice(b.indexOf(">") + 1).replace(/<span class="count"[\s\S]*?<\/span>/, "");
  return {
    label: text(inner).trim(),
    cls: open.match(/class="([^"]*)"/)?.[1] || "",
    selected: /aria-selected="true"/.test(open),
    count: count ? Number(count[1]) : 0,
  };
});
/** The overview cards: [{ name, cls, text }]. */
const cards = (html) => [...html.matchAll(/<article class="([^"]*)">([\s\S]*?)<\/article>/g)].map((m) => ({
  cls: m[1], text: text(m[2]), name: text(m[2].match(/<h3>([\s\S]*?)<\/h3>/)?.[1] || ""),
}));
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
});
