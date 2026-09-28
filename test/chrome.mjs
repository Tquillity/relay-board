// Finding and driving headless Chrome for the browser tests (e2e.test.mjs, behaviour.test.mjs).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/** Chrome's path: $CHROME, a usual install location, or a chrome/chromium on PATH. Null if none. */
export function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const fixed = {
    win32: [
      join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    ],
    darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"],
  }[process.platform] || [];
  const found = fixed.find((p) => existsSync(p));
  if (found) return found;
  const names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
  const exts = process.platform === "win32" ? [".exe", ""] : [""];
  for (const dir of (process.env.PATH || "").split(delimiter).filter(Boolean)) {
    for (const name of names) {
      for (const ext of exts) if (existsSync(join(dir, name + ext))) return join(dir, name + ext);
    }
  }
  return null;
}

/**
 * Loads `url` in headless Chrome with its own fresh profile and returns the DOM once the page's
 * timers have run for `budget` ms of virtual time.
 */
export function dumpDom(chrome, url, profileDir, budget = 4000) {
  const args = [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
    ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    // No network: the web-font request fails at once, so results never depend on it.
    "--host-resolver-rules=MAP * ~NOTFOUND",
    "--lang=en-US", `--user-data-dir=${profileDir}`,
    `--virtual-time-budget=${budget}`, "--dump-dom", url,
  ];
  return new Promise((resolve, reject) => {
    execFile(chrome, args, { timeout: 90e3, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, LANG: "en_US.UTF-8", TZ: "UTC" } }, (err, stdout, stderr) => {
      if (err) reject(new Error(`Chrome failed for ${url}: ${err.message}\n${stderr}`));
      else if (!stdout.includes('id="main"')) reject(new Error(`Chrome returned no page for ${url}:\n${stderr}`));
      else resolve(stdout);
    });
  });
}

/** Decodes the HTML entities Chrome's DOM dump uses. */
export const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
