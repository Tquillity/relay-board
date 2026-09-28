# Screenshots

The screenshots in the main README are taken from the demo (`npm run demo`), so they only ever show made-up data.

To retake them, point `CHROME` at a Chrome binary, then run this from the repo root:

- Linux: `google-chrome`
- macOS: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`
- Git Bash on Windows: `"/c/Program Files/Google/Chrome/Application/chrome.exe"`

```bash
npm run demo
DEMO="file://$(pwd -W 2>/dev/null || pwd)/docs/demo/index.html"
shot() {
  "$CHROME" --headless=new --hide-scrollbars --lang=en-US --window-size="$2" \
    --virtual-time-budget=4000 --user-data-dir="$(mktemp -d)" \
    --screenshot="$PWD/docs/screenshots/$1.png" "$DEMO$3"
}
shot overview 1280,1500 ""
shot project  1280,1500 "#p=acme-storefront"
shot digest   1280,720  "?open=since"
shot history  1280,560  "?open=history&only=history#p=acme-storefront"
```

- `?open=<word>` unfolds the sections whose header starts with that word. `since` is the "Since you last looked" strip.
- `?only=history` hides everything on a project tab except its History section.
- Both hooks live in `demo/screenshot-hooks.js`.
- A fresh `--user-data-dir` for each shot starts every section in its default state, and lets this run while your normal Chrome is open.
