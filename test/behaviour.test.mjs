// Behaviour: the real page against a scriptable fake store (test/harness.js), in headless Chrome.
// Covers what the pure-core tests can't: races with other chats, failed and slow saves, broken
// live updates, load order, malformed docs and keyboard use.
// Skipped when Chrome can't be found; set CHROME=/path/to/chrome to point at one.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { findChrome, dumpDom, decode } from "./chrome.mjs";
import { root } from "./helpers.mjs";

const chrome = findChrome();

const SCENARIOS = {
  "archive-race": "",
  reopen: "",
  malformed: "#p=p",
  "connection-lost": "",
  "late-project": "#p=late",
  "missing-project": "#p=ghost",
  saving: "",
  "stuck-relay": "",
  keyboard: "",
  "services-cost": "#v=services&p=p",
  "stream-fold": "#p=p",
  scope: "",
  "scope-route": "#p=home&s=work",
  models: "",
};

function buildPage() {
  const read = (file) => readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n");
  return `<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<script>\n${read("test/harness.js")}</script>\n${read("index.html")}`;
}

if (!chrome) {
  test("the page's behaviour in headless Chrome", { skip: "Chrome not found; set CHROME=/path/to/chrome to run the browser tests" }, () => {});
} else describe("the page's behaviour in headless Chrome", () => {
  const results = {};
  let dir, url;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "relay-board-behaviour-"));
    const page = join(dir, "harness.html");
    writeFileSync(page, buildPage());
    url = pathToFileURL(page).href;
    // A few Chromes at a time, so slow machines don't hit the timeout.
    const queue = Object.entries(SCENARIOS);
    await Promise.all(Array.from({ length: 3 }, async () => {
      for (let next; (next = queue.shift());) await runScenario(...next);
    }));
  });

  async function runScenario(name, hash) {
    const html = await dumpDom(chrome, `${url}?scenario=${name}${hash}`, join(dir, `profile-${name}`));
    // The last match: the harness's own source is in the page too.
    const m = [...html.matchAll(/<pre id="results">([\s\S]*?)<\/pre>/g)].pop();
    results[name] = m ? JSON.parse(decode(m[1])) : { error: "the scenario reported nothing" };
  }

  after(() => {
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  const result = (name) => {
    const r = results[name];
    assert.ok(r && !r.error, `scenario ${name} failed: ${r?.error}`);
    return r;
  };

  test("archiving never deletes a card that another chat resumed meanwhile", () => {
    const r = result("archive-race");
    assert.equal(r.resumed, "active");
    assert.deepEqual(r.deleted, ["streams/p--old"]);
    assert.equal(r.oldExists, false);
    // The resumed stream's summary is taken out of History again; the other one stays archived.
    assert.deepEqual(r.archived, ["Old work"]);
  });

  test("reopening a request clears its old answer and offers fresh answer buttons", () => {
    const r = result("reopen");
    assert.equal(r.doc.done, false);
    assert.equal(r.doc.answer, null);
    assert.equal(r.doc.answerState, null);
    assert.equal(r.doc.relayedAt, null);
    assert.deepEqual(r.doc.previousAnswer, { choice: "Approve", note: null, at: r.doc.previousAnswer.at });
    assert.ok(r.buttons.includes("Approve") && r.buttons.includes("Decline"), r.buttons.join(", "));
    assert.match(r.text, /Earlier answer, before you reopened it: Approve/);
    assert.doesNotMatch(r.text, /You answered/);
  });

  test("malformed docs don't break the page, and the store's doc ids are used", () => {
    const r = result("malformed");
    assert.deepEqual(r.tabs, ["Overview", "Proj"]);
    for (const s of ["Alpha", "Beta", "Real step", "Did a thing", "Real need", "Step one"]) assert.ok(r.main.includes(s), s);
    assert.equal(r.placeholders, 0);
    assert.deepEqual(r.writePaths, ["needs/p-real"]);
  });

  test("a lost live connection stays visible after later updates", () => {
    const r = result("connection-lost");
    assert.equal(r.sub, "Live updates paused. Reload to reconnect.");
    assert.equal(r.live, false);
  });

  test("a project link waits for its data instead of falling back to the overview", () => {
    const r = result("late-project");
    assert.equal(r.hash, "#p=late");
    assert.equal(r.selected, "late");
    assert.match(r.main, /Late work/);
  });

  test("a link to a project that doesn't exist shows the overview once data has loaded", () => {
    const r = result("missing-project");
    assert.equal(r.selected, "Overview");
    assert.equal(r.overview, true);
  });

  test("answering shows a saving state, can't be sent twice, and shows a failure on the item", () => {
    const r = result("saving");
    assert.equal(r.during.disabled, true);
    assert.match(r.during.text, /Saving…/);
    assert.equal(r.attempts, 1);
    assert.match(r.after.text, /That didn't save\. Try again in a moment\./);
    assert.equal(r.after.enabled, true);
    assert.equal(r.answer, null);
  });

  test("an answer stuck at 'relayed' can be sent again", () => {
    const r = result("stuck-relay");
    assert.match(r.before, /Sent to the chat 3h ago, but it hasn't confirmed/);
    assert.equal(r.doc.answerState, "answered");
    assert.equal(r.doc.relayedAt, null);
    assert.equal(r.doc.answer.choice, "A");
    assert.match(r.after, /Waiting for a chat to pick it up/);
    assert.doesNotMatch(r.after, /Send again/);
  });

  test("the Work | Private filter shows only that scope's tabs, needs and cards, and keeps its choice", () => {
    const r = result("scope");
    assert.deepEqual(r.all.tabs, ["overview", "job", "home", "bare", "empty"]);
    assert.deepEqual(r.all.tags, ["job", "empty"], "work projects carry a marker only when everything is shown");
    assert.deepEqual(r.all.pressed, ["All"]);
    assert.equal(r.all.badge, "3");
    assert.equal(r.all.hash, "");

    assert.deepEqual(r.work.tabs, ["overview", "job", "empty"]);
    assert.deepEqual(r.work.tags, []);
    assert.deepEqual(r.work.pressed, ["Work"]);
    assert.deepEqual(r.work.needs, ["job need"]);
    assert.deepEqual(r.work.cards, ["Job", "Quiet"]);
    assert.equal(r.work.badge, "1");
    assert.equal(r.work.hash, "#s=work");
    assert.equal(r.work.stored, "work");

    assert.deepEqual(r.priv.tabs, ["overview", "home", "bare"]);
    assert.deepEqual(r.priv.pressed, ["Private"]);
    assert.deepEqual([...r.priv.needs].sort(), ["bare need", "home need"]);
    assert.deepEqual([...r.priv.cards].sort(), ["Bare", "Home"]);
    assert.equal(r.priv.badge, "2");
    assert.equal(r.priv.hash, "#s=private");
    assert.equal(r.priv.stored, "private");

    assert.deepEqual(r.afterUpdate.tabs, r.priv.tabs, "a live update keeps the filter");
    assert.deepEqual(r.afterUpdate.pressed, ["Private"]);

    assert.equal(r.open.selected, "home");
    assert.equal(r.open.hash, "#p=home&s=private");
    assert.equal(r.fellBack.selected, "overview", "an open project outside the new scope falls back to the overview");
    assert.equal(r.fellBack.hash, "#s=work");
    assert.deepEqual(r.back.pressed, ["All"]);
    assert.equal(r.back.hash, "");
    assert.equal(r.back.stored, "all");
  });

  test("a link whose scope hides its project opens the overview", () => {
    const r = result("scope-route");
    assert.equal(r.selected, "overview");
    assert.deepEqual(r.tabs, ["overview", "job"]);
    assert.deepEqual(r.pressed, ["Work"]);
  });

  test("the tabs follow the keyboard pattern for tabs", () => {
    const r = result("keyboard");
    assert.deepEqual(r.start, {
      focused: "tab-overview", selected: "tab-overview", labelledBy: "tab-overview",
      tabindex: ["0", "-1", "-1"], controls: ["main", "main", "main"], panelRole: "tabpanel",
    });
    const moved = (id, tabindex) => ({ focused: id, selected: id, labelledBy: id, tabindex });
    for (const [step, id, tabindex] of [
      ["right", "tab-a", ["-1", "0", "-1"]],
      ["end", "tab-b", ["-1", "-1", "0"]],
      ["wrap", "tab-overview", ["0", "-1", "-1"]],
      ["left", "tab-b", ["-1", "-1", "0"]],
      ["home", "tab-overview", ["0", "-1", "-1"]],
    ]) {
      const { focused, selected, labelledBy, tabindex: t } = r[step];
      assert.deepEqual({ focused, selected, labelledBy, tabindex: t }, moved(id, tabindex), step);
    }
  });

  test("entering a service cost writes the expected patch and shows a saving state, then the new cost", () => {
    const r = result("services-cost");
    assert.match(r.initial, /Stripe/);
    assert.match(r.initial, /Cost not set/);
    // An invalid amount is refused on the row, without a write.
    assert.ok(r.invalid.text.includes("Enter an amount of 0 or more."));
    assert.equal(r.invalid.writes, 0);
    assert.equal(r.during.disabled, true);
    assert.match(r.during.text, /Saving…/);
    assert.equal(r.saved.writes, 1, "the save is sent once");
    const [op, path, data] = r.saved.patch;
    assert.deepEqual([op, path], ["update", "services/p"]);
    assert.deepEqual(Object.keys(data), ["items", "updatedAt"]);
    assert.deepEqual(Object.keys(data.items), ["stripe"]);
    assert.deepEqual(data.items.stripe.manualCost, { monthly: 12.5, currency: "USD", at: data.items.stripe.manualCost.at });
    assert.ok(Date.parse(data.items.stripe.manualCost.at) > 0);
    assert.ok(r.saved.text.includes("$12.50/mo"));
    assert.match(r.saved.text, /entered by you just now/);
    assert.doesNotMatch(r.saved.text, /Saving…/);
    assert.equal(r.saved.header, "$12.50 / month");
  });

  test("a service can be marked free and its typed cost cleared again", () => {
    const r = result("services-cost");
    assert.equal(r.free.cost.monthly, 0);
    assert.ok(r.free.text.includes("$0/mo"));
    assert.match(r.cleared.text, /Cost not set/);
    assert.equal(r.cleared.header, "No costs set");
  });

  test("a workstream folds to one summary line, stays folded, and unfolds again", () => {
    const r = result("stream-fold");
    assert.equal(r.start.expanded, "true");
    assert.ok(r.start.hasSteps && r.start.hasSide);
    assert.match(r.start.controls, /^tg-stream-p--build-body$/);
    assert.equal(r.collapsed.expanded, "false");
    assert.equal(r.collapsed.controls, null);
    assert.equal(r.collapsed.hasSteps, false);
    assert.equal(r.collapsed.hasSide, false);
    assert.equal(r.collapsed.focused, "tg-stream-p--build", "focus stays on the toggle");
    assert.ok(r.collapsed.text.includes("3/7 done · 4 left · 1 for you · 1 blocker"), r.collapsed.text);
    assert.doesNotMatch(r.collapsed.text, /Wire up|Waiting on a key|Recently finished/);
    assert.equal(r.collapsed.blockerChip, "1 blocker");
    assert.equal(r.collapsed.blockerBad, true);
    assert.match(r.collapsed.emptyText, /No steps recorded/, "the other panel stays open");
    assert.deepEqual(JSON.parse(r.collapsed.saved), { "stream:p--build": false });
    // A live update re-renders the page; the panel stays folded.
    assert.equal(r.afterUpdate.expanded, "false");
    assert.equal(r.afterUpdate.hasSteps, false);
    assert.deepEqual([r.both.first, r.both.second], ["false", "false"]);
    assert.match(r.both.secondText, /No steps/);
    assert.doesNotMatch(r.both.secondText, /No steps recorded/);
    assert.equal(r.expanded.expanded, "true");
    assert.ok(r.expanded.hasSteps && r.expanded.hasSide);
    assert.equal(r.expanded.focused, "tg-stream-p--build");
    assert.deepEqual(JSON.parse(r.saved), { "stream:p--build": true, "stream:p--empty": true });
  });

  test("the models pill opens a dialog with range and project controls, remembers the opening range, and Escape returns focus", () => {
    const r = result("models");
    // The pill shows the split for all projects today, and the strip shows even without plan readings.
    assert.equal(r.pill, "ModelstodayOpus 50% · Sonnet 50%");
    assert.equal(r.usageVisible, true);
    assert.deepEqual([r.opened.open, r.opened.pressed, r.opened.project, r.opened.openWith], [true, ["Today"], "", "today"]);
    assert.equal(r.title, "Model usage");
    assert.equal(r.labelled, "models-title");
    assert.deepEqual(r.opened.rows, ["Proj", "Quux"]);
    assert.equal(r.opened.chart, false, "a single day has no chart");
    // 30 days adds the per-day chart (one bar per day) and includes yesterday's usage.
    assert.deepEqual(r.thirty.pressed, ["30 days"]);
    assert.equal(r.thirty.chart, true);
    assert.equal(r.thirty.days, 30);
    assert.equal(r.thirty.focused, "models-range-30d", "focus stays on the control that was used");
    // One project: only its row.
    assert.deepEqual([r.project.project, r.project.rows], ["q", ["Quux"]]);
    // "Open with" is stored, and used the next time.
    assert.equal(r.stored, "all");
    assert.equal(r.afterOpenWith.openWith, "all");
    assert.deepEqual(r.afterOpenWith.pressed, ["30 days"], "changing it doesn't change the open dialog");
    assert.deepEqual(r.closed, { open: false, focused: "models-pill" });
    assert.deepEqual([r.reopened.pressed, r.reopened.project, r.reopened.openWith], [["All time"], "", "all"]);
    // On a project tab the pill and the dialog follow that project.
    assert.equal(r.tabPill, "ModelstodayOpus 67% · Sonnet 33%Opus-heavy");
    assert.deepEqual([r.fromTab.project, r.fromTab.rows], ["p", ["Proj"]]);
    assert.deepEqual(r.afterClose, { open: false, focused: "models-pill" });
  });
});
