/* =========================================================
   Resources Admin
   - Supabase email/password login
   - CRUD on public.articles
   - Image upload to the article-images storage bucket

   Every write is authorised by Postgres row-level security, not by
   this file. Someone who tampers with this JS still can't write
   anything unless their email is in public.editors.
   ========================================================= */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from "../js/supabase-config.js";

const $ = (id) => document.getElementById(id);

const setupView = $("setupView");
const loginView = $("loginView");
const appView = $("appView");

if (!isConfigured) {
  setupView.classList.remove("is-hidden");
} else {
  boot();
}

function boot() {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const state = {
    articles: [],
    types: [],
    subjects: [],
    editing: null,   // the article being edited, or null for a new one
    pendingFile: null,
    imageUrl: null,
    subscribers: [],
    subsLoaded: false,
  };

  // ---------- helpers ----------
  const show = (el) => el.classList.remove("is-hidden");
  const hide = (el) => el.classList.add("is-hidden");

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));

  // image_url values like "assets/clients/steptoe.png" are relative to the SITE
  // ROOT (where resources.html lives). The admin is served from /admin/, so for
  // DISPLAY ONLY we hop up one level. Absolute URLs (http:, blob:, data:) and
  // root-absolute paths are left alone. The stored value is never changed.
  const adminImg = (url) => {
    if (!url) return url;
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("/")) return url;
    return "../" + url;
  };

  function note(el, message, kind) {
    el.textContent = message;
    el.className = "adm-note " + (kind || "info");
    show(el);
  }

  function slugify(s) {
    return String(s)
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  // ---------- auth ----------
  async function refreshSession() {
    const { data } = await sb.auth.getSession();
    if (data.session) {
      await onSignedIn(data.session);
    } else {
      hide(appView);
      show(loginView);
    }
  }

  async function onSignedIn(session) {
    // Confirm this account is actually on the editors allowlist.
    const { data: allowed, error } = await sb.rpc("is_editor");

    if (error) {
      note($("loginError"), "Couldn't verify your access: " + error.message, "error");
      show(loginView);
      return;
    }

    if (!allowed) {
      await sb.auth.signOut();
      note(
        $("loginError"),
        "That account isn't an editor. Ask an admin to add " +
          session.user.email +
          " to the editors table.",
        "error"
      );
      show(loginView);
      return;
    }

    hide(loginView);
    show(appView);
    $("whoami").textContent = session.user.email;
    await loadAll();
  }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    hide($("loginError"));
    const btn = $("loginBtn");
    btn.disabled = true;
    btn.textContent = "Signing in…";

    const { error } = await sb.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value,
    });

    btn.disabled = false;
    btn.textContent = "Sign in";

    if (error) {
      note($("loginError"), error.message, "error");
      return;
    }
    await refreshSession();
  });

  $("signOutBtn").addEventListener("click", async () => {
    await sb.auth.signOut();
    location.reload();
  });

  // ---------- data ----------
  async function loadAll() {
    const [types, subjects, articles] = await Promise.all([
      sb.from("article_types").select("slug,label").order("sort_order"),
      sb.from("article_subjects").select("slug,label").order("sort_order"),
      sb
        .from("articles")
        .select("*")
        .order("featured", { ascending: false })
        .order("sort_order", { ascending: true }),
    ]);

    const failed = [types, subjects, articles].find((r) => r.error);
    if (failed) {
      note($("appNote"), "Couldn't load data: " + failed.error.message, "error");
      return;
    }

    state.types = types.data || [];
    state.subjects = subjects.data || [];
    state.articles = articles.data || [];

    // Populate the selects
    const typeOpts = state.types
      .map((t) => '<option value="' + esc(t.slug) + '">' + esc(t.label) + "</option>")
      .join("");
    const subjOpts = state.subjects
      .map((s) => '<option value="' + esc(s.slug) + '">' + esc(s.label) + "</option>")
      .join("");

    $("f_type").innerHTML = typeOpts;
    $("f_subject").innerHTML = subjOpts;
    $("filterType").innerHTML =
      '<option value="__all">All types</option>' + typeOpts;

    renderRows();
  }

  const labelOf = (list, slug) =>
    (list.find((x) => x.slug === slug) || {}).label || slug || "—";

  function visibleArticles() {
    const q = $("search").value.trim().toLowerCase();
    const type = $("filterType").value;
    const status = $("filterStatus").value;

    return state.articles.filter((a) => {
      if (q && !a.title.toLowerCase().includes(q)) return false;
      if (type !== "__all" && a.type_slug !== type) return false;
      if (status !== "__all" && a.status !== status) return false;
      return true;
    });
  }

  function renderRows() {
    const items = visibleArticles();
    const rows = $("rows");

    if (!items.length) {
      rows.innerHTML = "";
      show($("listEmpty"));
      $("listEmpty").textContent = state.articles.length
        ? "Nothing matches those filters."
        : "No resources yet. Create your first one.";
      return;
    }
    hide($("listEmpty"));

    rows.innerHTML = items
      .map((a) => {
        const thumb = a.image_url
          ? '<img class="adm-thumb" src="' + esc(adminImg(a.image_url)) + '" alt="" />'
          : '<div class="adm-thumb"></div>';

        return (
          '<div class="adm-row">' +
            thumb +
            '<div class="adm-title">' +
              esc(a.title) +
              (a.featured ? ' <span class="badge star">Featured</span>' : "") +
              "<small>" + esc(a.slug) + "</small>" +
            "</div>" +
            '<div class="adm-cell">' + esc(labelOf(state.types, a.type_slug)) + "</div>" +
            '<div class="adm-cell">' + esc(labelOf(state.subjects, a.subject_slug)) + "</div>" +
            '<div><span class="badge ' + esc(a.status) + '">' + esc(a.status) + "</span></div>" +
            '<div class="adm-actions">' +
              '<button class="btn-sm" data-edit="' + esc(a.id) + '">Edit</button>' +
            "</div>" +
          "</div>"
        );
      })
      .join("");

    rows.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const a = state.articles.find((x) => x.id === btn.getAttribute("data-edit"));
        if (a) openDrawer(a);
      });
    });
  }

  ["search", "filterType", "filterStatus"].forEach((id) => {
    $(id).addEventListener("input", renderRows);
    $(id).addEventListener("change", renderRows);
  });

  // ---------- drawer ----------
  function openDrawer(article) {
    state.editing = article || null;
    state.pendingFile = null;
    state.imageUrl = article ? article.image_url : null;

    hide($("drawerError"));
    $("saveStatus").textContent = "";
    $("drawerTitle").textContent = article ? "Edit resource" : "New resource";

    $("f_title").value = article ? article.title : "";
    $("f_slug").value = article ? article.slug : "";
    $("f_type").value = article ? article.type_slug : (state.types[0] || {}).slug || "";
    $("f_subject").value = article ? article.subject_slug : (state.subjects[0] || {}).slug || "";
    $("f_excerpt").value = article ? article.excerpt || "" : "";
    $("f_body").value = article ? article.body || "" : "";
    $("f_image_url").value = article ? article.image_url || "" : "";
    $("f_image_alt").value = article ? article.image_alt || "" : "";
    $("f_internal").value = article ? article.internal_url || "" : "";
    $("f_external").value = article ? article.external_url || "" : "";
    $("f_pdf").value = article ? article.pdf_url || "" : "";
    $("f_read").value = article ? article.read_time || "" : "";
    $("f_status").value = article ? article.status : "draft";
    $("f_sort").value = article ? article.sort_order : 100;
    $("f_featured").checked = article ? !!article.featured : false;

    setPreview(state.imageUrl);

    if (article) show($("deleteBtn"));
    else hide($("deleteBtn"));

    show($("scrim"));
    show($("drawer"));
  }

  function closeDrawer() {
    hide($("scrim"));
    hide($("drawer"));
    state.editing = null;
    state.pendingFile = null;
    state.imageUrl = null;
  }

  $("newBtn").addEventListener("click", () => openDrawer(null));
  $("closeDrawer").addEventListener("click", closeDrawer);
  $("scrim").addEventListener("click", closeDrawer);

  // Auto-slug from the title, but only while creating (never rewrite a live slug).
  $("f_title").addEventListener("input", () => {
    if (!state.editing) $("f_slug").value = slugify($("f_title").value);
  });

  // ---------- image ----------
  function setPreview(url) {
    if (url) {
      $("previewImg").src = adminImg(url);
      show($("imagePreview"));
      hide($("dropzone"));
    } else {
      $("previewImg").removeAttribute("src");
      hide($("imagePreview"));
      show($("dropzone"));
    }
  }

  $("dropzone").addEventListener("click", () => $("f_image").click());
  $("f_image").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) stageFile(file);
  });

  ["dragenter", "dragover"].forEach((ev) =>
    $("dropzone").addEventListener(ev, (e) => {
      e.preventDefault();
      $("dropzone").classList.add("over");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    $("dropzone").addEventListener(ev, (e) => {
      e.preventDefault();
      $("dropzone").classList.remove("over");
    })
  );
  $("dropzone").addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) stageFile(file);
  });

  function stageFile(file) {
    state.pendingFile = file;
    $("f_image_url").value = ""; // an uploaded file wins over a pasted URL
    setPreview(URL.createObjectURL(file));
  }

  // Paste/type an image URL (e.g. an existing client logo) instead of uploading.
  $("f_image_url").addEventListener("input", () => {
    const url = $("f_image_url").value.trim();
    state.pendingFile = null; // a URL overrides any staged file
    $("f_image").value = "";
    state.imageUrl = url || null;
    setPreview(state.imageUrl);
  });

  $("removeImage").addEventListener("click", () => {
    state.pendingFile = null;
    state.imageUrl = null;
    $("f_image").value = "";
    $("f_image_url").value = "";
    setPreview(null);
  });

  async function uploadPendingImage() {
    if (!state.pendingFile) return state.imageUrl;

    const file = state.pendingFile;
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = crypto.randomUUID() + "." + ext;

    const { error } = await sb.storage
      .from("article-images")
      .upload(path, file, { cacheControl: "3600", upsert: false });

    if (error) throw new Error("Image upload failed: " + error.message);

    const { data } = sb.storage.from("article-images").getPublicUrl(path);
    return data.publicUrl;
  }

  // ---------- save / delete ----------
  $("saveBtn").addEventListener("click", async () => {
    hide($("drawerError"));

    const title = $("f_title").value.trim();
    const slug = $("f_slug").value.trim();

    if (!title || !slug) {
      note($("drawerError"), "Title and slug are both required.", "error");
      return;
    }

    const internal = $("f_internal").value.trim();
    const external = $("f_external").value.trim();
    const body = $("f_body").value.trim();
    if (!internal && !external && !body) {
      note($("drawerError"), "Give the card a destination: write a Body, or link to an internal page or external URL.", "error");
      return;
    }

    const btn = $("saveBtn");
    btn.disabled = true;
    $("saveStatus").textContent = state.pendingFile ? "Uploading image…" : "Saving…";

    try {
      const imageUrl = await uploadPendingImage();
      const status = $("f_status").value;

      const row = {
        slug,
        title,
        type_slug: $("f_type").value,
        subject_slug: $("f_subject").value,
        excerpt: $("f_excerpt").value.trim(),
        image_url: imageUrl,
        image_alt: $("f_image_alt").value.trim() || null,
        internal_url: internal || null,
        external_url: external || null,
        body: body || null,
        pdf_url: $("f_pdf").value.trim() || null,
        read_time: $("f_read").value.trim() || null,
        featured: $("f_featured").checked,
        status,
        sort_order: Number($("f_sort").value) || 100,
      };

      // Stamp published_at the first time it goes live.
      if (status === "published" && !(state.editing && state.editing.published_at)) {
        row.published_at = new Date().toISOString();
      }

      let error;
      if (state.editing) {
        ({ error } = await sb.from("articles").update(row).eq("id", state.editing.id));
      } else {
        ({ error } = await sb.from("articles").insert(row));
      }

      if (error) throw error;

      $("saveStatus").textContent = "";
      closeDrawer();
      note($("appNote"), "Saved. The public site is already showing it.", "success");
      await loadAll();
    } catch (err) {
      const msg =
        err.code === "23505"
          ? "That slug is already taken — pick a different one."
          : err.message;
      note($("drawerError"), msg, "error");
      $("saveStatus").textContent = "";
    } finally {
      btn.disabled = false;
    }
  });

  $("deleteBtn").addEventListener("click", async () => {
    if (!state.editing) return;
    if (!confirm('Delete "' + state.editing.title + '"? This cannot be undone.')) return;

    const { error } = await sb.from("articles").delete().eq("id", state.editing.id);
    if (error) {
      note($("drawerError"), error.message, "error");
      return;
    }
    closeDrawer();
    note($("appNote"), "Deleted.", "info");
    await loadAll();
  });

  // ---------- tabs ----------
  document.querySelectorAll(".adm-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".adm-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const panelId = tab.getAttribute("data-panel");
      ["resourcesPanel", "subscribersPanel"].forEach((id) => {
        $(id).classList.toggle("is-hidden", id !== panelId);
      });
      if (panelId === "subscribersPanel" && !state.subsLoaded) loadSubscribers();
    });
  });

  // ---------- subscribers ----------
  async function loadSubscribers() {
    const { data, error } = await sb
      .from("subscribers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      note($("appNote"), "Couldn't load subscribers: " + error.message, "error");
      return;
    }
    state.subscribers = data || [];
    state.subsLoaded = true;
    renderSubscribers();
  }

  function visibleSubscribers() {
    const q = $("subSearch").value.trim().toLowerCase();
    const status = $("subFilterStatus").value;
    return state.subscribers.filter((s) => {
      if (status !== "__all" && s.status !== status) return false;
      if (!q) return true;
      return [s.email, s.name, s.company].some((v) => (v || "").toLowerCase().includes(q));
    });
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    // Fixed format, locale-independent: YYYY-MM-DD
    return iso.slice(0, 10);
  }

  function renderSubscribers() {
    const items = visibleSubscribers();
    const total = state.subscribers.length;
    const active = state.subscribers.filter((s) => s.status === "subscribed").length;
    $("subCount").textContent =
      total === 0 ? "No signups yet." : active + " subscribed · " + total + " total";

    const rows = $("subRows");
    if (!items.length) {
      rows.innerHTML = "";
      show($("subEmpty"));
      $("subEmpty").textContent = total ? "Nothing matches those filters." : "No subscribers yet.";
      return;
    }
    hide($("subEmpty"));

    rows.innerHTML = items
      .map((s) => {
        const unsub = s.status === "unsubscribed";
        return (
          '<div class="adm-row sub">' +
            '<div class="adm-title">' + esc(s.email) + "</div>" +
            '<div class="adm-cell">' + esc(s.name || "—") + "</div>" +
            '<div class="adm-cell">' + esc(s.company || "—") + "</div>" +
            '<div class="adm-cell">' + fmtDate(s.created_at) + "</div>" +
            '<div><span class="badge ' + (unsub ? "archived" : "published") + '">' +
              (unsub ? "unsubscribed" : "subscribed") + "</span></div>" +
            '<div class="adm-actions">' +
              '<button class="btn-sm" data-sub-toggle="' + esc(s.id) + '">' +
                (unsub ? "Resub" : "Unsub") + "</button>" +
            "</div>" +
          "</div>"
        );
      })
      .join("");

    rows.querySelectorAll("[data-sub-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => toggleSubscriber(btn.getAttribute("data-sub-toggle")));
    });
  }

  async function toggleSubscriber(id) {
    const sub = state.subscribers.find((s) => s.id === id);
    if (!sub) return;
    const next = sub.status === "subscribed" ? "unsubscribed" : "subscribed";
    const { error } = await sb.from("subscribers").update({ status: next }).eq("id", id);
    if (error) {
      note($("appNote"), error.message, "error");
      return;
    }
    sub.status = next;
    renderSubscribers();
  }

  ["subSearch", "subFilterStatus"].forEach((id) => {
    $(id).addEventListener("input", renderSubscribers);
    $(id).addEventListener("change", renderSubscribers);
  });

  // CSV export — mirrors the old site's "download mailing list".
  $("subExport").addEventListener("click", () => {
    const rows = visibleSubscribers();
    if (!rows.length) {
      note($("appNote"), "No subscribers to export.", "info");
      return;
    }
    const cell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const header = ["email", "name", "company", "status", "source", "created_at"];
    const csv = [header.join(",")]
      .concat(rows.map((s) => header.map((k) => cell(s[k])).join(",")))
      .join("\r\n");

    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "profiscience-subscribers.csv";
    a.click();
    URL.revokeObjectURL(url);
  });

  // ---------- go ----------
  refreshSession();
}
