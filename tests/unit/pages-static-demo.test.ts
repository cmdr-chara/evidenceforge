import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("Pages assets are repository-subpath safe and preserve the evidence boundary", () => {
  const html = readFileSync(resolve("apps/web/public/index.html"), "utf8");
  const app = readFileSync(resolve("apps/web/public/app.js"), "utf8");
  const workflow = readFileSync(resolve(".github/workflows/pages.yml"), "utf8");

  for (const path of ["styles.css", "p1.css", "app.js", "stream-scope.js", "assets/evidence-strata.webp"]) {
    assert.match(html, new RegExp(`[\\"']\\./${path.replace(".", "\\.")}`));
  }
  assert.match(app, /Static GitHub Pages showcase/);
  assert.match(app, /credentialed TrueForge requires the local server/);
  assert.match(app, /for \(const control of elements\.liveForm\.elements\) control\.disabled = true/);
  assert.match(workflow, /node scripts\/build-pages\.mjs/);
  assert.match(workflow, /actions\/deploy-pages@v5/);
});
