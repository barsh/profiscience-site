/* =========================================================
   Post page — renders one article's inline body from Supabase.
   URL: post.html?slug=my-post-slug
   Body is authored as Markdown in the admin; rendered here and
   sanitized before insertion.
   ========================================================= */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { marked } from "https://esm.sh/marked@12";
import DOMPurify from "https://esm.sh/dompurify@3";
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from "./supabase-config.js";

const $ = (id) => document.getElementById(id);

function fail(msg) {
  $("postTitle").textContent = "Not found";
  $("postExcerpt").textContent = "";
  $("postBody").style.display = "none";
  const e = $("postError");
  e.textContent = msg;
  e.style.display = "block";
}

(async () => {
  const slug = new URLSearchParams(location.search).get("slug");
  if (!slug) return fail("No post specified.");
  if (!isConfigured) return fail("Content isn't available right now.");

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await sb
    .from("articles")
    .select("title, excerpt, body, published_at, image_url, image_alt, article_types(label), article_subjects(label)")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();

  if (error) return fail("We couldn't load this post. Please try again shortly.");
  if (!data) return fail("This post doesn't exist or isn't published yet.");

  // Head + hero
  const type = data.article_types?.label || "";
  const subject = data.article_subjects?.label || "";
  document.title = data.title + " — Profiscience";
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute("content", data.excerpt || "");

  $("postTitle").textContent = data.title;
  $("postExcerpt").textContent = data.excerpt || "";
  $("postEyebrow").textContent = [type, subject].filter(Boolean).join(" · ") || "Resources";

  if (data.published_at) {
    // Locale-independent YYYY-MM-DD → readable
    const d = data.published_at.slice(0, 10);
    $("postByline").textContent = d;
  }

  // Body: Markdown -> HTML -> sanitized
  if (data.body && data.body.trim()) {
    const html = DOMPurify.sanitize(marked.parse(data.body));
    $("postBody").innerHTML = html;
  } else {
    $("postBody").innerHTML = "<p>" + (data.excerpt || "") + "</p>";
  }
})();
