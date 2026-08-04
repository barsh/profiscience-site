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
  const showAllBtn = document.getElementById("resShowAll");
  const emptyEl = document.getElementById("resEmpty");

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));

  const state = { articles: [], type: "__all", subject: "__all" };

  function uniq(list) {
    return list.filter((v, i) => v && list.indexOf(v) === i);
  }

  function availableTypes() {
    return uniq(state.articles.map((a) => a.type));
  }

  function availableSubjects() {
    return uniq(state.articles.map((a) => a.subject));
  }

  function normalizeFilterValue(value, allowedValues) {
    if (!value || value === "__all") return "__all";
    return allowedValues.includes(value) ? value : "__all";
  }

  function setActiveChip(container, value) {
    if (!container) return;
    container.querySelectorAll(".res-chip").forEach((chip) => {
      chip.classList.toggle("active", chip.getAttribute("data-value") === value);
    });
  }

  // Hash format: #type=Case%20Study&subject=AI
  // Non-filter hashes like #library or #newsletter are ignored.
  function parseFilterHash() {
    const raw = (window.location.hash || "").replace(/^#/, "");
    if (!raw) {
      return { type: "__all", subject: "__all" };
    }
    if (!raw.includes("=")) return null;

    const params = new URLSearchParams(raw);
    const hasFilterKey = params.has("type") || params.has("subject");
    if (!hasFilterKey) return null;

    return {
      type: params.get("type") || "__all",
      subject: params.get("subject") || "__all",
    };
  }

  function writeFilterHash() {
    const params = new URLSearchParams();
    if (state.type !== "__all") params.set("type", state.type);
    if (state.subject !== "__all") params.set("subject", state.subject);
    const nextHash = params.toString();
    const currentHash = (window.location.hash || "").replace(/^#/, "");
    if (currentHash === nextHash) return;

    const nextUrl =
      window.location.pathname +
      window.location.search +
      (nextHash ? "#" + nextHash : "");
    window.history.replaceState(null, "", nextUrl);
  }
  function applyHashToFilters() {
    const parsed = parseFilterHash();
    if (!parsed) return false;

    state.type = normalizeFilterValue(parsed.type, availableTypes());
    state.subject = normalizeFilterValue(parsed.subject, availableSubjects());
    writeFilterHash();
    setActiveChip(typeFilters, state.type);
    setActiveChip(subjFilters, state.subject);
    render();
    return true;    return true;
  }

  // --- Load ------------------------------------------------
  async function loadFromSupabase() {
    const { data, error } = await sb
      .from("articles")
      .select(`
        slug, title, excerpt, read_time, image_url, image_alt,
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
      // No external/internal link means it's an inline post — the DB constraint
      // guarantees such a row has a body, so send it to the reusable post page.
      url: r.external_url || r.internal_url || ("post?slug=" + encodeURIComponent(r.slug)),
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
    const isCaseStudy = /case\s*study/i.test(a.type || "");
    const thumbClass = isCaseStudy && a.image ? "thumb logo-thumb" : "thumb";

    const thumb = a.image
      ? '<img src="' + esc(a.image) + '" alt="' + esc(a.imageAlt || a.title) + '" loading="lazy" />'
      : "";

    return (
      '<a href="' + esc(a.url || "#") + '" class="res-card reveal in"' +
        ' data-type="' + esc(a.type) + '" data-subject="' + esc(a.subject) + '"' + target + ">" +
        '<div class="' + thumbClass + '">' + thumb +
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

  // Shimmer placeholders shown while the fetch is in flight.
  function skeletonHtml(n) {
    const card =
      '<div class="res-card skeleton" aria-hidden="true">' +
        '<div class="sk-thumb"></div>' +
        '<div class="body">' +
          '<div class="sk-line sk-title"></div>' +
          '<div class="sk-line sk-title short"></div>' +
          '<div class="sk-line"></div>' +
          '<div class="sk-line"></div>' +
          '<div class="sk-line short"></div>' +
          '<div class="sk-line sk-meta"></div>' +
        "</div>" +
      "</div>";
    return card.repeat(n);
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
    const total = state.articles.length;
    const isFiltered = state.type !== "__all" || state.subject !== "__all";
    const hasHiddenItems = items.length < total;
    grid.innerHTML = items.map(cardHtml).join("");

    if (countEl) {
      if (!isFiltered || !hasHiddenItems) {
        countEl.textContent =
          total + (total === 1 ? " resource" : " resources");
      } else {
        countEl.textContent =
          "Showing " + items.length + " of " + total + " resources";
      }
    }

    if (showAllBtn) {
      showAllBtn.style.display = isFiltered && hasHiddenItems ? "inline-flex" : "none";
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
      setActiveChip(container, state[key]);
      writeFilterHash();
      render();
      if (window.pfTrack) window.pfTrack("resource_filter", { [key]: state[key] });
    });
  }

  function clearFilters() {
    state.type = "__all";
    state.subject = "__all";
    setActiveChip(typeFilters, state.type);
    setActiveChip(subjFilters, state.subject);
    writeFilterHash();
    render();
  }

  // --- Boot ------------------------------------------------
  (async () => {
    // Show shimmer tiles right away so a slow load isn't a blank page.
    grid.innerHTML = skeletonHtml(6);

    let articles = [];
    try {
      if (!isConfigured) throw new Error("Supabase not configured yet");
      articles = await loadFromSupabase();
    } catch (err) {
      console.warn("[resources] falling back to articles.json:", err.message);
      try {
        articles = await loadFromJson();
      } catch (err2) {
        grid.innerHTML = "";
        if (emptyEl) {
          emptyEl.textContent = "We couldn't load resources right now. Please try again shortly.";
          emptyEl.style.display = "block";
        }
        return;
      }
    }

    state.articles = articles;

    if (!articles.length) {
      grid.innerHTML = "";
      if (emptyEl) {
        emptyEl.textContent = "No resources yet — check back soon.";
        emptyEl.style.display = "block";
      }
      return;
    }

    if (typeFilters) typeFilters.innerHTML = chipsHtml(availableTypes(), "__all");
    if (subjFilters) subjFilters.innerHTML = chipsHtml(availableSubjects(), "__all");
    wireChips(typeFilters, "type");
    wireChips(subjFilters, "subject");
    if (showAllBtn) {
      showAllBtn.addEventListener("click", () => {
        clearFilters();
        if (window.pfTrack) window.pfTrack("resource_filter_clear", { source: "show_all" });
      });
    }

    if (!applyHashToFilters()) {
      render();
    }

    window.addEventListener("hashchange", () => {
      applyHashToFilters();
    });
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
