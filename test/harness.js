// Browser harness for test/behaviour.test.mjs. Loaded before index.html in place of the claude.ai
// `db` capability: an in-memory store the scenarios can script (delay a collection, fail a write,
// change a doc behind the page's back, break a live listener). `?scenario=<name>` picks one.
// Each scenario seeds made-up data, acts on the page like a viewer would, and writes what it saw
// as JSON into a results <pre> element, which the test reads from Chrome's DOM dump.
(() => {
  const now = Date.now(), M = 60e3, H = 60 * M, D = 24 * H;
  const at = (ms) => new Date(now - ms).toISOString();
  const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const merge = (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" ? merge(out[k], v) : v;
    return out;
  };

  // ---- The fake store ----
  const DATA = { projects: {}, streams: {}, needs: {}, archive: {}, usage: {}, services: {}, models: {} };
  const writes = [];                              // [op, path, data?] for every write, in order
  const hooks = {
    subscribe: (c, s) => s.deliver(),             // when a listener gets its first snapshot
    beforeGet: async () => {},                    // runs before a doc read returns
    beforeUpdate: async () => {},                 // runs before an update applies (may throw)
  };
  const listeners = {};
  const snap = (c) => ({ docs: Object.entries(DATA[c]).map(([id, r]) => ({ id, exists: true, data: () => clone(r) })), metadata: { fromCache: false } });
  const fire = (c) => (listeners[c] || []).forEach((s) => s.deliver());
  const db = {
    collection: (c) => ({
      onSnapshot(cb, onError) {
        const s = { deliver: () => setTimeout(() => cb(snap(c)), 0), fail: (e) => onError && onError(e) };
        (listeners[c] ||= []).push(s);
        hooks.subscribe(c, s);
        return () => {};
      },
    }),
    doc(path) {
      const [c, id] = path.split("/");
      DATA[c] ||= {};
      return {
        get: async () => { await hooks.beforeGet(path); return { exists: id in DATA[c], data: () => clone(DATA[c][id]) }; },
        set: async (d) => { writes.push(["set", path, clone(d)]); DATA[c][id] = clone(d); fire(c); },
        update: async (d) => {
          writes.push(["update", path, clone(d)]);
          await hooks.beforeUpdate(path, d);
          if (!(id in DATA[c])) throw { code: "invalid_argument" };
          DATA[c][id] = merge(DATA[c][id], clone(d));
          fire(c);
        },
        delete: async () => { writes.push(["delete", path]); delete DATA[c][id]; fire(c); },
        acquire: async () => ({ acquired: true }),
      };
    },
  };
  window.claude = { use: async (name) => (name === "db" ? db : null) };
  // Mark everything as seen, so "Since you last looked" stays out of the way.
  try { localStorage.setItem("relay-last-seen", String(now)); } catch {}

  // ---- Page helpers ----
  const q = (sel, root = document) => root.querySelector(sel);
  const text = (node) => (node ? node.textContent.replace(/\s+/g, " ").trim() : "");
  const button = (label, root = document) => [...root.querySelectorAll("button")].find((b) => text(b) === label || text(b).startsWith(label));
  const needLi = (title) => [...document.querySelectorAll("li.need")].find((li) => text(q(".need-title", li)) === title);
  const until = async (check, ms = 2000) => { for (let t = 0; t < ms; t += 20) { if (check()) return true; await wait(20); } return false; };
  const report = (results) => {
    const pre = document.createElement("pre");
    pre.id = "results";
    pre.textContent = JSON.stringify(results);
    document.body.append(pre);
  };

  const project = (name) => ({ name, updatedAt: at(5 * M) });
  const stream = (project, title, fields = {}) => ({ project, title, status: "active", updatedAt: at(5 * M), steps: [], ...fields });

  // ---- Scenarios ----
  const SCENARIOS = {
    // Another chat resumes a 40-day-old finished stream while the page is archiving it.
    async "archive-race"() {
      DATA.projects.p = project("Proj");
      DATA.streams["p--resumed"] = stream("p", "Resumed work", { status: "done", updatedAt: at(40 * D) });
      DATA.streams["p--old"] = stream("p", "Old work", { status: "done", updatedAt: at(40 * D) });
      let resumed = false;
      hooks.beforeGet = async (path) => {
        if (path === "streams/p--resumed" && !resumed) {
          resumed = true;
          DATA.streams["p--resumed"] = { ...DATA.streams["p--resumed"], status: "active", updatedAt: new Date().toISOString() };
        }
      };
      return async () => {
        await until(() => writes.some((w) => w[0] === "delete"));
        await wait(200);
        const month = Object.values(DATA.archive).find((a) => a.project === "p");
        return {
          resumed: DATA.streams["p--resumed"]?.status ?? null,
          oldExists: "p--old" in DATA.streams,
          deleted: writes.filter((w) => w[0] === "delete").map((w) => w[1]),
          archived: month ? Object.values(month.items).filter(Boolean).map((e) => e.title) : [],
        };
      };
    },

    // The viewer reopens an approval that was answered and handled.
    async reopen() {
      DATA.projects.p = project("Proj");
      DATA.needs["p-ship"] = {
        project: "p", kind: "approval", title: "Ship it", done: true, doneAt: at(H), doneBy: "claude",
        answer: { choice: "Approve", note: null, at: at(2 * H) }, answerState: "handled", relayedAt: at(2 * H), createdAt: at(3 * H),
      };
      return async () => {
        await until(() => button("Show 1 done"));
        button("Show 1 done").click();
        await until(() => button("Reopen"));
        button("Reopen").click();
        await until(() => !DATA.needs["p-ship"].done);
        await wait(100);
        const li = needLi("Ship it");
        return {
          doc: DATA.needs["p-ship"],
          buttons: [...li.querySelectorAll(".btn")].map(text),
          text: text(li),
        };
      };
    },

    // Malformed docs from a buggy agent, including data that claims a different id.
    async malformed() {
      DATA.projects.p = { ...project("Proj"), id: "not-p" };
      DATA.streams["p--a"] = stream("p", "Alpha", {
        id: "p--zzz", steps: [null, { title: "Real step", state: "done" }, "text"], recent: [null, 5, { text: "Did a thing", at: at(M) }], blockers: [null], links: ["x"],
      });
      DATA.streams["p--b"] = stream("p", "Beta", { steps: { weird: true }, session: "text", pr: 5, lastShipped: "yes" });
      DATA.streams["junk"] = "not a doc";
      DATA.needs["p-real"] = { id: "p-fake", project: "p", kind: "task", title: "Real need", steps: [null, "Step one"], options: [{}], createdAt: at(H) };
      return async () => {
        await until(() => needLi("Real need"));
        const main = text(q("#main"));
        button("Done", needLi("Real need")).click();
        await until(() => writes.length);
        return {
          main,
          // Tab labels without their count badges.
          tabs: [...document.querySelectorAll('[role="tab"]')].map((t) => text(t).slice(0, text(t).length - text(q(".count", t)).length)),
          placeholders: document.querySelectorAll("#main .notice").length,
          writePaths: writes.map((w) => w[1]),
        };
      };
    },

    // A live listener dies after the first data arrives; later snapshots must not hide that.
    async "connection-lost"() {
      DATA.projects.p = project("Proj");
      hooks.subscribe = (c, s) => {
        s.deliver();
        if (c === "needs") setTimeout(() => s.fail({ code: "unavailable", message: "gone" }), 50);
      };
      return async () => {
        await wait(150);
        fire("projects");
        await wait(100);
        return { sub: text(q("#sub")), live: q("#pulse").classList.contains("live") };
      };
    },

    // Opened on a project whose data arrives after an unrelated project's.
    async "late-project"() {
      DATA.projects.a = project("Early");
      DATA.streams["late--x"] = stream("late", "Late work");
      hooks.subscribe = (c, s) => (c === "streams" ? setTimeout(() => s.deliver(), 300) : s.deliver());
      return async () => {
        await wait(500);
        return { hash: location.hash, selected: text(q('[role="tab"][aria-selected="true"]')), main: text(q("#main")) };
      };
    },

    // Opened on a project that doesn't exist: once everything has loaded, show the overview.
    async "missing-project"() {
      DATA.projects.a = project("Early");
      return async () => {
        await wait(300);
        return { selected: text(q('[role="tab"][aria-selected="true"]')), overview: !!q("#proj-h") };
      };
    },

    // Approve while the store is slow, then have the save fail.
    async saving() {
      DATA.projects.p = project("Proj");
      DATA.needs["p-go"] = { project: "p", kind: "approval", title: "Go live", createdAt: at(H) };
      let release;
      hooks.beforeUpdate = () => new Promise((_, reject) => { release = () => reject({ code: "unavailable" }); });
      return async () => {
        await until(() => needLi("Go live"));
        button("Approve", needLi("Go live")).click();
        await wait(50);
        const during = {
          disabled: [...needLi("Go live").querySelectorAll(".btn")].every((b) => b.disabled),
          text: text(needLi("Go live")),
        };
        button("Approve", needLi("Go live")).click(); // a disabled button: must not send twice
        await wait(50);
        const attempts = writes.length;
        release();
        await wait(100);
        const li = needLi("Go live");
        return {
          during, attempts,
          after: { text: text(li), enabled: [...li.querySelectorAll(".btn")].every((b) => !b.disabled) },
          answer: DATA.needs["p-go"].answer ?? null,
        };
      };
    },

    // A chat claimed the answer 3 hours ago and never confirmed.
    async "stuck-relay"() {
      DATA.projects.p = project("Proj");
      DATA.needs["p-pick"] = {
        project: "p", kind: "decision", title: "Pick one", options: ["A", "B"], createdAt: at(5 * H),
        answer: { choice: "A", note: null, at: at(4 * H) }, answerState: "relayed", relayedAt: at(3 * H),
      };
      return async () => {
        await until(() => needLi("Pick one"));
        const before = text(needLi("Pick one"));
        button("Send again", needLi("Pick one")).click();
        await until(() => DATA.needs["p-pick"].answerState === "answered");
        await wait(50);
        return { before, doc: DATA.needs["p-pick"], after: text(needLi("Pick one")) };
      };
    },

    // Entering, changing and clearing the monthly cost of a service, with a slow store.
    async "services-cost"() {
      DATA.projects.p = project("Proj");
      DATA.services.p = { project: "p", scannedAt: at(H), updatedAt: at(H), items: { stripe: { name: "Stripe", category: "payments", evidence: [], envVars: [] } } };
      hooks.beforeUpdate = () => wait(150);
      const row = () => q(".svc-row");
      const typeAmount = (value) => {
        const input = q(".cost-edit input");
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      return async () => {
        await until(() => button("Set cost"));
        const initial = text(q("#main"));
        button("Set cost").click();
        await until(() => q(".cost-edit input"));
        typeAmount("-3");
        button("Save").click();
        await wait(30);
        const invalid = { text: text(row()), writes: writes.length };
        typeAmount("12.5");
        button("Save").click();
        await wait(50);
        const during = { text: text(row()), disabled: [...row().querySelectorAll(".btn")].every((b) => b.disabled) };
        await until(() => DATA.services.p.items.stripe.manualCost);
        await wait(100);
        const saved = { text: text(row()), header: text(q("#cost")), patch: writes[0], writes: writes.length };
        hooks.beforeUpdate = async () => {};
        button("Change cost").click();
        await until(() => button("Free"));
        button("Free").click();
        await until(() => DATA.services.p.items.stripe.manualCost?.monthly === 0);
        await wait(50);
        const free = { text: text(row()), cost: DATA.services.p.items.stripe.manualCost };
        button("Change cost").click();
        await until(() => button("Clear"));
        button("Clear").click();
        await until(() => DATA.services.p.items.stripe.manualCost === null);
        await wait(50);
        return { initial, invalid, during, saved, free, cleared: { text: text(row()), header: text(q("#cost")) } };
      };
    },

    // Folding a workstream panel: a one-line summary, remembered across re-renders and reloads.
    async "stream-fold"() {
      DATA.projects.p = project("Proj");
      DATA.streams["p--build"] = stream("p", "Build the thing", {
        steps: [
          { title: "Plan", state: "done" }, { title: "Scaffold", state: "done" }, { title: "Wire up", state: "done" },
          { title: "Write tests", state: "active" }, { title: "Review", state: "todo", by: "you" }, { title: "Ship", state: "todo" }, { title: "Announce", state: "todo" },
        ],
        blockers: [{ text: "Waiting on a key", severity: "high" }],
      });
      DATA.streams["p--empty"] = stream("p", "Empty plan");
      return async () => {
        await until(() => q("#tg-stream-p--build"));
        const toggle = () => q("#tg-stream-p--build");
        const panel = () => toggle().closest(".stream");
        const snap = () => ({
          expanded: toggle().getAttribute("aria-expanded"),
          controls: toggle().getAttribute("aria-controls"),
          hasSteps: !!panel().querySelector(".steps"),
          hasSide: !!panel().querySelector(".side"),
          text: text(panel()),
          focused: document.activeElement?.id || null,
        });
        const start = snap();
        toggle().focus();
        toggle().click();
        await wait(50);
        const collapsed = snap();
        collapsed.blockerChip = text(q(".stream-sum .chip", panel()));
        collapsed.blockerBad = q(".stream-sum .chip", panel()).classList.contains("high");
        collapsed.emptyText = text(q("#tg-stream-p--empty").closest(".stream"));
        collapsed.saved = localStorage.getItem("relay-open");
        // Another chat updates the stream: the panel stays folded.
        DATA.streams["p--build"].currentTask = "Something new";
        fire("streams");
        await wait(80);
        const afterUpdate = snap();
        // Collapsing the second panel doesn't touch the first, and the choice is stored per stream.
        q("#tg-stream-p--empty").click();
        await wait(50);
        const both = { first: snap().expanded, second: q("#tg-stream-p--empty").getAttribute("aria-expanded"), secondText: text(q("#tg-stream-p--empty").closest(".stream")) };
        q("#tg-stream-p--empty").click();
        await wait(50);
        toggle().click();
        await wait(50);
        const expanded = snap();
        return { start, collapsed, afterUpdate, both, expanded, saved: localStorage.getItem("relay-open") };
      };
    },

    // The All | Work | Private filter: what each choice shows, and that it survives a re-render.
    async scope() {
      DATA.projects.job = { ...project("Job"), scope: "work", order: 1 };
      DATA.projects.home = { ...project("Home"), scope: "private", order: 2 };
      DATA.projects.bare = { ...project("Bare"), order: 3 };
      DATA.projects.empty = { ...project("Quiet"), scope: "work", order: 4 };
      for (const slug of ["job", "home", "bare"]) {
        DATA.streams[`${slug}--a`] = stream(slug, `${slug} stream`);
        DATA.needs[`n-${slug}`] = { project: slug, kind: "task", title: `${slug} need`, createdAt: at(H) };
      }
      const snap = () => ({
        tabs: [...document.querySelectorAll('[role="tab"]')].map((t) => t.dataset.tab),
        tags: [...document.querySelectorAll(".scope-tag")].map((t) => t.closest('[role="tab"]').dataset.tab),
        pressed: [...document.querySelectorAll("#scope-switch button")].filter((b) => b.getAttribute("aria-pressed") === "true").map(text),
        needs: [...document.querySelectorAll("li.need .need-title")].map(text),
        cards: [...document.querySelectorAll("article.card h3")].map(text),
        badge: text(q("#tab-overview .count")),
        hash: location.hash,
        stored: localStorage.getItem("relay-scope"),
        selected: q('[role="tab"][aria-selected="true"]')?.dataset.tab,
      });
      const click = async (sel) => { q(sel).click(); await wait(50); };
      return async () => {
        await until(() => q("#scope-work") && document.querySelectorAll("article.card").length === 4);
        const all = snap();
        await click("#scope-work");
        const work = snap();
        await click("#scope-private");
        const priv = snap();
        // A live update re-renders the page; the choice stays.
        fire("projects");
        await wait(80);
        const afterUpdate = snap();
        // Open a private project, then switch to Work: it is no longer in scope, so the overview shows.
        await click("#tab-home");
        const open = snap();
        await click("#scope-work");
        const fellBack = snap();
        await click("#scope-all");
        return { all, work, priv, afterUpdate, open, fellBack, back: snap() };
      };
    },

    // A link to a project that the link's own scope hides shows the overview.
    async "scope-route"() {
      DATA.projects.job = { ...project("Job"), scope: "work" };
      DATA.projects.home = { ...project("Home"), scope: "private" };
      return async () => {
        await wait(300);
        return {
          selected: q('[role="tab"][aria-selected="true"]')?.dataset.tab,
          tabs: [...document.querySelectorAll('[role="tab"]')].map((t) => t.dataset.tab),
          pressed: [...document.querySelectorAll("#scope-switch button")].filter((b) => b.getAttribute("aria-pressed") === "true").map(text),
        };
      };
    },

    // The models pill opens the Model usage dialog: range and project controls, a remembered
    // starting range, and Escape closes it and returns focus to the pill.
    async models() {
      DATA.projects.p = { ...project("Proj"), order: 1 };
      DATA.projects.q = { ...project("Quux"), order: 2 };
      const day = (back) => {
        const d = new Date(), e = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
        return `d-${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`;
      };
      const entry = (out, msgs = 1) => ({ in: 0, out, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, msgs });
      DATA.models[day(0)] = { projects: { p: { opus: entry(1e6), sonnet: entry(1e6) }, q: { sonnet: entry(1e6) } } };
      DATA.models[day(1)] = { projects: { p: { sonnet: entry(2e6) } } };
      const pill = () => text(q("#models-pill"));
      const dialog = () => q("#models-dialog");
      const pressed = () => [...document.querySelectorAll("#models-dialog .m-range button")].filter((b) => b.getAttribute("aria-pressed") === "true").map(text);
      const rowNames = () => [...document.querySelectorAll("#models-dialog table.m-table")].pop()
        ? [...[...document.querySelectorAll("#models-dialog table.m-table")].pop().querySelectorAll("tbody tr td:first-child")].map(text) : [];
      const choose = async (id, value) => { const sel = q(id); sel.value = value; sel.dispatchEvent(new Event("change", { bubbles: true })); await wait(40); };
      const snap = () => ({
        open: dialog().open, pressed: pressed(), project: q("#models-project")?.value, openWith: q("#models-openwith")?.value,
        rows: rowNames(), chart: !!q("#models-dialog .m-chart svg"), days: document.querySelectorAll("#models-dialog .m-chart svg title").length,
        focused: document.activeElement?.id || null,
      });
      return async () => {
        await until(() => q("#models-pill") && /Opus/.test(text(q("#models-pill"))));
        const out = { pill: pill(), usageVisible: !q("#usage").hidden };
        q("#models-pill").focus();
        q("#models-pill").click();
        await wait(60);
        out.opened = snap();
        out.title = text(q("#models-title"));
        out.labelled = dialog().getAttribute("aria-labelledby");
        q("#models-range-30d").focus(); q("#models-range-30d").click(); await wait(40);
        out.thirty = snap();
        await choose("#models-project", "q");
        out.project = snap();
        await choose("#models-openwith", "all");
        out.stored = localStorage.getItem("relay-models-open");
        out.afterOpenWith = snap();
        document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await wait(80);
        out.closed = { open: dialog().open, focused: document.activeElement?.id || null };
        q("#models-pill").click(); await wait(60);
        out.reopened = snap();
        document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await wait(60);
        // From a project tab: that project today, and the dialog starts on it.
        q("#tab-p").click(); await wait(60);
        out.tabPill = pill();
        q("#models-pill").click(); await wait(60);
        out.fromTab = snap();
        q("#models-close").click(); await wait(60);
        out.afterClose = { open: dialog().open, focused: document.activeElement?.id || null };
        return out;
      };
    },

    // Keyboard use of the project tabs.
    async keyboard() {
      DATA.projects.a = { ...project("Alpha"), order: 1 };
      DATA.projects.b = { ...project("Beta"), order: 2 };
      return async () => {
        await until(() => document.querySelectorAll('[role="tab"]').length === 3);
        const press = (key) => document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        const snapshot = () => ({
          focused: document.activeElement?.id || null,
          selected: q('[role="tab"][aria-selected="true"]')?.id || null,
          labelledBy: q("#main").getAttribute("aria-labelledby"),
          tabindex: [...document.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute("tabindex")),
          controls: [...document.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute("aria-controls")),
          panelRole: q("#main").getAttribute("role"),
        });
        q("#tab-overview").focus();
        const steps = { start: snapshot() };
        press("ArrowRight"); steps.right = snapshot();
        press("End"); steps.end = snapshot();
        press("ArrowRight"); steps.wrap = snapshot();
        press("ArrowLeft"); steps.left = snapshot();
        press("Home"); steps.home = snapshot();
        return steps;
      };
    },
  };

  const name = new URLSearchParams(location.search).get("scenario");
  const scenario = SCENARIOS[name];
  if (!scenario) { addEventListener("load", () => report({ error: `unknown scenario ${name}` })); return; }
  const ready = scenario();
  addEventListener("load", async () => {
    try {
      const run = await ready;
      await wait(100); // let the page connect and draw its first snapshot
      report(await run());
    } catch (e) {
      report({ error: String(e?.stack || e?.message || e) });
    }
  });
})();
