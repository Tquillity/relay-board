// Text colours stay readable: every text colour token meets WCAG AA (4.5:1) on every background
// the page puts text on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./helpers.mjs";

const css = readFileSync(join(root, "index.html"), "utf8");
const token = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  assert.ok(m, `--${name} should be a #rrggbb colour in :root`);
  return m[1];
};
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("the contrast formula matches known values", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(2), "21.00");
  assert.equal(contrast("#777777", "#ffffff").toFixed(2), "4.48");
});

for (const text of ["text", "muted", "faint"]) {
  test(`--${text} is readable on every background`, () => {
    for (const bg of ["bg", "surface", "surface-2"]) {
      const ratio = contrast(token(text), token(bg));
      assert.ok(ratio >= 4.5, `--${text} on --${bg} is ${ratio.toFixed(2)}:1, below 4.5:1`);
    }
  });
}

// The model colours mark bars and swatches (never text), so they need 3:1 against the surfaces behind them.
test("every model colour is distinguishable from the surfaces it sits on", () => {
  for (const family of ["opus", "sonnet", "haiku", "fable", "other"]) {
    for (const bg of ["surface", "surface-2"]) {
      const ratio = contrast(token(`m-${family}`), token(bg));
      assert.ok(ratio >= 3, `--m-${family} on --${bg} is ${ratio.toFixed(2)}:1, below 3:1`);
    }
  }
});
