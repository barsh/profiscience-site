/* =========================================================
   Resources page — live from Supabase
   - Loads published articles from Postgres
   - Filter chips for Type (Blog / Newsletter / Case Study …) and Subject
   - Falls back to content/articles.json if the database is unreachable,
     so the page degrades gracefully instead of going blank.
   ========================================================= */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from "./supabase-config.js";

// One shared client for both the article grid and the newsletter form.
const sb = isConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const grid = document.getElementById("resGrid");
if (grid) {
  const typeFilters = document.getElementById("resTypeFilters");
  const subjFilters = document.getElementById("resSubjectFilters");
  const countEl = document.getElementById("resCount");
  const emptyEl = document.getElementById("resEmpty");

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));

  const state = { articles: [], type: "__all", subject: "__all" };

  // --- Load ------------------------------------------------
  async function loadFromSupabase() {
    const { data, error } = await sb
      .from("articles")
      .select(`
        title, excerpt, read_time, image_url, image_alt,
        internal_url, external_url, featured, published_at,
        article_types    ( label ),
        article_subjects ( label )
      `)
      .eq("status", "published")
      .order("featured", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("published_at", { ascending: false });

    if (error) throw error;

    return (data || []).map((r) => ({
      title: r.title,
      excerpt: r.excerpt,
      readTime: r.read_time,
      image: r.image_url,
      imageAlt: r.image_alt,
      url: r.external_url || r.internal_url || "#",
      type: r.article_types?.label || "",
      subject: r.article_subjects?.label || "",
      featured: r.featured,
    }));
  }

  // Fallback: the checked-in JSON file.
  async function loadFromJson() {
    const res = await fetch("content/articles.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    return (data.articles || [])
      .slice()
      .sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
  }

  // --- Render ----------------------------------------------
  function cardHtml(a) {
    const isExternal = /^https?:\/\//i.test(a.url || "");
    const target = isExternal ? ' target="_blank" rel="noopener"' : "";
    const meta = [a.readTime || a.type, a.subject].filter(Boolean).map(esc).join(" · ");

    const thumb = a.image
      ? '<img src="' + esc(a.image) + '" alt="' + esc(a.imageAlt || a.title) + '" loading="lazy" />'
      : "";

    return (
      '<a href="' + esc(a.url || "#") + '" class="res-card reveal in"' +
        ' data-type="' + esc(a.type) + '" data-subject="' + esc(a.subject) + '"' + target + ">" +
        '<div class="thumb">' + thumb +
          '<span class="tag">' + esc((a.type || "").toUpperCase()) + "</span>" +
        "</div>" +
        '<div class="body">' +
          "<h3>" + esc(a.title) + "</h3>" +
          "<p>" + esc(a.excerpt) + "</p>" +
          '<div class="meta">' + meta + "</div>" +
        "</div>" +
      "</a>"
    );
  }

  function chipsHtml(values, active) {
    return ['<button class="res-chip' + (active === "__all" ? " active" : "") + '" data-value="__all">All</button>']
      .concat(
        values.map((v) =>
          '<button class="res-chip' + (active === v ? " active" : "") + '" data-value="' + esc(v) + '">' +
            esc(v) +
          "</button>"
        )
      )
      .join("");
  }

  function visible() {
    return state.articles.filter(
      (a) =>
        (state.type === "__all" || a.type === state.type) &&
        (state.subject === "__all" || a.subject === state.subject)
    );
  }

  function render() {
    const items = visible();
    grid.innerHTML = items.map(cardHtml).join("");

    if (countEl) {
      countEl.textContent =
        items.length === state.articles.length
          ? state.articles.length + (state.articles.length === 1 ? " resource" : " resources")
          : "Showing " + items.length + " of " + state.articles.length;
    }

    if (emptyEl) {
      const none = items.length === 0;
      emptyEl.textContent = none ? "Nothing matches those filters yet." : "";
      emptyEl.style.display = none ? "block" : "none";
    }
  }

  function wireChips(container, key) {
    if (!container) return;
    container.addEventListener("click", (e) => {
      const btn = e.target.closest(".res-chip");
      if (!btn) return;
      state[key] = btn.getAttribute("data-value");
      container.querySelectorAll(".res-chip").forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
      render();
      if (window.pfTrack) window.pfTrack("resource_filter", { [key]: state[key] });
    });
  }

  function uniq(list) {
    return list.filter((v, i) => v && list.indexOf(v) === i);
  }

  // --- Boot ------------------------------------------------
  (async () => {
    let articles = [];
    try {
      if (!isConfigured) throw new Error("Supabase not configured yet");
      articles = await loadFromSupabase();
    } catch (err) {
      console.warn("[resources] falling back to articles.json:", err.message);
      try {
        articles = await loadFromJson();
      } catch (err2) {
        if (emptyEl) {
          emptyEl.textContent = "We couldn't load resources right now. Please try again shortly.";
          emptyEl.style.display = "block";
        }
        return;
      }
    }

    state.articles = articles;

    if (!articles.length) {
      if (emptyEl) {
        emptyEl.textContent = "No resources yet — check back soon.";
        emptyEl.style.display = "block";
      }
      return;
    }

    if (typeFilters) typeFilters.innerHTML = chipsHtml(uniq(articles.map((a) => a.type)), "__all");
    if (subjFilters) subjFilters.innerHTML = chipsHtml(uniq(articles.map((a) => a.subject)), "__all");
    wireChips(typeFilters, "type");
    wireChips(subjFilters, "subject");

    render();
  })();
}

/* =========================================================
   Newsletter signup -> subscribers table (single opt-in)
   ========================================================= */
const nlForm = document.getElementById("newsletterForm");
if (nlForm) {
  const btn = document.getElementById("nlSubmit");
  const errEl = document.getElementById("nlError");
  const okEl = document.getElementById("nlSuccess");

  nlForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.style.display = "none";

    const row = {
      name: nlForm.name.value.trim(),
      email: nlForm.email.value.trim(),
      company: nlForm.company.value.trim(),
      source: nlForm.dataset.source || "website",
    };

    if (!row.email) return;

    if (!sb) {
      errEl.textContent = "Signups aren't available right now. Please email info@profiscience.com.";
      errEl.style.display = "block";
      return;
    }

    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "Subscribing…";

    const { error } = await sb.from("subscribers").insert(row);

    btn.disabled = false;
    btn.textContent = label;

    // 23505 = duplicate email (unique violation). They're already on the list,
    // so treat re-subscribing as a success rather than surfacing an error.
    // (A plain insert is used instead of upsert: upsert needs UPDATE rights,
    // which the public role intentionally lacks, so it would 401.)
    if (error && error.code !== "23505") {
      errEl.textContent = "Something went wrong. Please try again in a moment.";
      errEl.style.display = "block";
      if (window.pfTrack) window.pfTrack("newsletter_error", { message: error.message });
      return;
    }

    nlForm.reset();
    okEl.style.display = "block";
    if (window.pfTrack) window.pfTrack("newsletter_signup", { source: row.source });
  });
}
