// URL switches used only to take the README screenshots of the demo; the real board has none.
//   ?open=history,finished  unfolds matching section headers and "Show …" lists
//   ?only=history           hides every section of a project view except its header and History
(() => {
  // The page renders once the fonts stylesheet has loaded and the mock's first snapshots arrive,
  // which can take a while on a slow network. Keep looking for each section until it shows up.
  const RETRY_MS = 100, GIVE_UP_MS = 3000;
  const q = new URLSearchParams(location.search);

  if (q.get("open")) {
    const pending = new Set(q.get("open").split(","));
    const started = Date.now();
    const unfold = () => {
      for (const word of [...pending]) {
        // "Show N finished workstreams" and similar lists
        const re = new RegExp(`^Show .*${word}`, "i");
        const lists = [...document.querySelectorAll(".collapser")].filter((b) => re.test(b.textContent));
        lists.forEach((b) => b.click());
        // Folded section headers, e.g. ?open=history
        const heads = [...document.querySelectorAll(".eyebrow-btn[aria-expanded=false], .digest-toggle[aria-expanded=false]")]
          .filter((b) => b.textContent.replace(/^\W+/, "").toLowerCase().startsWith(word.toLowerCase()));
        heads.forEach((b) => b.click());
        if (lists.length || heads.length) pending.delete(word);
      }
      if (pending.size && Date.now() - started < GIVE_UP_MS) setTimeout(unfold, RETRY_MS);
    };
    setTimeout(unfold, RETRY_MS);
  }

  if (q.get("only") === "history") {
    const css = document.createElement("style");
    css.textContent = 'main > section:not(.proj-head):not([aria-labelledby^="hist-h"]) { display: none !important; }';
    document.head.append(css);
  }
})();
