/* =========================================================
   Static-site verification
   ---------------------------------------------------------
   Checks that every root-level HTML page references local scripts,
   stylesheets, images, and icons that exist in this repository.
   ========================================================= */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const htmlPages = readdirSync(ROOT).filter((file) => file.endsWith(".html"));
const missing = [];

function isExternal(url) {
  return /^(https?:|#|data:|mailto:|tel:|\/)/.test(url);
}

for (const page of htmlPages) {
  const html = readFileSync(join(ROOT, page), "utf8");
  const references = html.matchAll(
    /<(?:script|img|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi,
  );

  for (const [, url] of references) {
    if (isExternal(url)) continue;

    const asset = resolve(ROOT, dirname(page), url.split(/[?#]/)[0]);
    if (!existsSync(asset)) missing.push(`${page}: ${url}`);
  }
}

if (missing.length) {
  console.error(`Missing local asset reference(s):\n${missing.join("\n")}`);
  process.exit(1);
}

console.log(
  `Validated ${htmlPages.length} HTML page(s) and their local script, image, stylesheet, and icon references.`,
);
