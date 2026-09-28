// URL switches used only to take the README screenshots of the demo; the real board has none.
//   ?open=history,finished  unfolds matching section headers and "Show …" lists
//   ?only=history           hides every section of a project view except its header and History
(() => {
  // Long enough for the mock's first snapshots to arrive and the page to render.
  const RENDER_DELAY_MS = 400;
  const q = new URLSearchParams(location.search);

  if (q.get("open")) {
    setTimeout(() => {
      for (const word of q.get("open").split(",")) {
        // "Show N finished workstreams" and similar lists
        const re = new RegExp(`^Show .*${word}`, "i");
        [...document.querySelectorAll(".collapser")].filter((b) => re.test(b.textContent)).forEach((b) => b.click());
        // Folded section headers, e.g. ?open=history
        [...document.querySelectorAll(".eyebrow-btn[aria-expanded=false], .digest-toggle[aria-expanded=false]")]
          .filter((b) => b.textContent.replace(/^\W+/, "").toLowerCase().startsWith(word.toLowerCase()))
          .forEach((b) => b.click());
      }
    }, RENDER_DELAY_MS);
  }

  if (q.get("only") === "history") {
    const css = document.createElement("style");
    css.textContent = 'main > section:not(.proj-head):not([aria-labelledby^="hist-h"]) { display: none !important; }';
    document.head.append(css);
  }
})();
