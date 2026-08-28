import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const WCAG_NORMAL_TEXT_MINIMUM_RATIO = 4.5;

function relativeLuminance(hexColor: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hexColor)) {
    throw new Error(`invalid hexadecimal color ${hexColor}`);
  }
  const red = Number.parseInt(hexColor.slice(1, 3), 16);
  const green = Number.parseInt(hexColor.slice(3, 5), 16);
  const blue = Number.parseInt(hexColor.slice(5, 7), 16);
  const linear = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const [linearRed, linearGreen, linearBlue] = linear;
  if (linearRed === undefined || linearGreen === undefined || linearBlue === undefined) {
    throw new Error("color conversion did not produce three channels");
  }
  return linearRed * 0.2126 + linearGreen * 0.7152 + linearBlue * 0.0722;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

test("muted console text meets normal-text contrast on both dark surfaces", () => {
  const css = readFileSync(resolve("apps/web/public/p1.css"), "utf8");
  const colorMatch = css.match(/--paper-muted:\s*(#[0-9a-f]{6})/i);
  assert.ok(colorMatch, "p1.css must define --paper-muted");
  const mutedColor = colorMatch[1];
  assert.ok(mutedColor, "--paper-muted must contain a hexadecimal color");

  assert.ok(
    css.includes(
      ".timeline li,\n.timeline li::before,\n.live-form input::placeholder {\n  color: var(--paper-muted);\n}",
    ),
    "inactive timeline text and form placeholders must use the accessible muted color",
  );
  assert.ok(
    css.includes(".live-form input::placeholder {\n  opacity: 1;\n}"),
    "placeholder opacity must remain deterministic across browsers",
  );

  for (const [surface, background] of [
    ["primary", "#090a08"],
    ["live panel", "#10120f"],
  ] as const) {
    const ratio = contrastRatio(mutedColor, background);
    assert.ok(
      ratio >= WCAG_NORMAL_TEXT_MINIMUM_RATIO,
      `${surface} contrast ${ratio.toFixed(2)}:1 is below ${WCAG_NORMAL_TEXT_MINIMUM_RATIO}:1`,
    );
  }
});
