/* =========================================================
   Fact-sheet extractor for the chat agent
   ---------------------------------------------------------
   Reads the site's own HTML from disk and emits plain text, so the
   curated knowledge base in supabase/functions/chat/knowledge.ts can be
   written — and later re-checked — against what the site actually says.

   Reads local files rather than scraping over HTTP: no network, no rate
   limits, and no chance of the fact sheet describing a deployed version
   of the site that differs from the one in this commit.

   This does NOT write knowledge.ts. Its output is a review artifact.
   knowledge.ts is curated by hand because a raw dump of the site would
   carry statistics and customer metrics the agent is explicitly told
   never to cite — see the guardrails in chat/index.ts.

   Usage:
     node scripts/build-knowledge.mjs            # writes scripts/extracted.txt
     node scripts/build-knowledge.mjs --check    # diffs against last run
   ========================================================= */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "scripts", "extracted.txt");

// Ordered deliberately: the pages a prospect's questions actually land on.
// Case studies are included for context, but note that everything they
// contain about named firms and outcomes is off-limits for the agent to
// state — they are here so the curator can see what NOT to carry over.
const PAGES = [
  "index.html",
  "platform.html",
  "pricing.html",
  "about.html",
  "support.html",
  // The founder's book. Easy to overlook as marketing, but the chapter
  // summaries are the only place on the site that discuss CPD, non-US
  // regulators, and multi-jurisdictional compliance — the exact questions
  // an Australian or UK firm arrives with.
  "stay-clever.html",
  "clients.html",
  "case-study-foley-lardner.html",
  "case-study-haynes-boone.html",
  "case-study-womble-bond-dickinson.html",
  "case-study-steptoe-johnson.html",
  "case-study-verrill.html",
  "case-study-bond-schoeneck-king.html",
];

/**
 * Strip markup down to readable prose.
 *
 * Deliberately regex-based rather than a DOM parser: these files are
 * hand-authored, well-formed, and have no client-rendered content in the
 * regions we care about (the header and footer are injected at runtime,
 * so they are empty divs on disk). A parser dependency would buy nothing.
 */
function extract(html) {
  return (
    html
      // Drop everything that isn't prose. <head> goes first so its
      // <title> and meta descriptions don't leak in as body text.
      .replace(/<head[\s\S]*?<\/head>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      // Give block-level elements a line break so headings and list items
      // don't run together into one unreadable paragraph.
      .replace(/<\/(h[1-6]|p|li|section|article|div|td|th|tr)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      // Mark headings so the curator can see the page's shape.
      .replace(/<h([1-6])[^>]*>/gi, (_, level) => `\n${"#".repeat(Number(level))} `)
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, "")
      // Entities that actually appear in these files.
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&(?:quot|#34);/g, '"')
      .replace(/&(?:#39|apos|rsquo|lsquo);/g, "'")
      .replace(/&(?:mdash|#8212);/g, "—")
      .replace(/&(?:ndash|#8211);/g, "–")
      .replace(/&hellip;/g, "…")
      // Collapse the whitespace the tag removal leaves behind.
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
  );
}

/**
 * Flag content the agent is forbidden to state, so curation is a review
 * step rather than a memory test. These mirror the "what you must not do"
 * rules in the chat system prompt: no prices, no statistics, no customer
 * counts, no years-in-business figures.
 */
const FORBIDDEN = [
  { label: "percentage", re: /\b\d{1,3}%/g },
  { label: "price", re: /\$[\d,]+/g },
  { label: "duration/tenure", re: /\b\d+\+?\s+years?\b/gi },
  { label: "headcount", re: /\b[\d,]{2,}\s+(?:attorneys|lawyers|users|firms|employees)\b/gi },
];

function auditLine(line) {
  const hits = [];
  for (const { label, re } of FORBIDDEN) {
    const matches = line.match(re);
    if (matches) hits.push(`${label}: ${matches.join(", ")}`);
  }
  return hits;
}

const sections = [];
let flagged = 0;

for (const page of PAGES) {
  const path = join(ROOT, page);
  if (!existsSync(path)) {
    console.warn(`skip (missing): ${page}`);
    continue;
  }

  const text = extract(readFileSync(path, "utf8"));
  const lines = text.split("\n").map((line) => {
    const hits = auditLine(line);
    if (hits.length === 0) return line;
    flagged++;
    // Inline marker so a reviewer scanning the file can't miss it.
    return `${line}\n   >>> DO NOT STATE — ${hits.join("; ")}`;
  });

  sections.push(`${"=".repeat(70)}\n${page}\n${"=".repeat(70)}\n\n${lines.join("\n")}`);
}

const output = sections.join("\n\n");
const words = output.split(/\s+/).filter(Boolean).length;

if (process.argv.includes("--check")) {
  // Drift check for CI: fails when the site has changed since the fact
  // sheet was last reviewed, so knowledge.ts can't silently go stale.
  if (!existsSync(OUT)) {
    console.error("No scripts/extracted.txt to compare against. Run without --check first.");
    process.exit(1);
  }
  if (readFileSync(OUT, "utf8") !== output) {
    console.error(
      "Site content has changed since the fact sheet was last reviewed.\n" +
        "Re-run `node scripts/build-knowledge.mjs`, diff the result, and update\n" +
        "supabase/functions/chat/knowledge.ts if the change is material.",
    );
    process.exit(1);
  }
  console.log("Fact sheet is up to date with site content.");
  process.exit(0);
}

writeFileSync(OUT, output, "utf8");

console.log(`Wrote ${OUT}`);
console.log(`  ${PAGES.length} pages, ~${words.toLocaleString()} words (~${Math.round((words * 4) / 3).toLocaleString()} tokens)`);
console.log(`  ${flagged} line(s) flagged as unquotable — review before copying into knowledge.ts`);
