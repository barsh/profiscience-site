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
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  PIPEDRIVE_DOMAIN,
  isConfigured,
} from "../js/supabase-config.js";

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
    chats: [],              // rows from the chat_conversations_with_cost view
    chatMonths: [],         // rows from chat_costs_monthly, for the spend strip
    chatsLoaded: false,
    chatSearchIds: null,    // Set of session_ids matching the search, or null for "no search"
    openChat: null,         // session_id currently shown in the drawer
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
      ["resourcesPanel", "subscribersPanel", "chatsPanel"].forEach((id) => {
        $(id).classList.toggle("is-hidden", id !== panelId);
      });
      if (panelId === "subscribersPanel" && !state.subsLoaded) loadSubscribers();
      if (panelId === "chatsPanel" && !state.chatsLoaded) loadChats();
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

  // ---------- chats ----------
  //
  // Conversations with the site assistant. Two jobs: read the exchanges the
  // agent couldn't answer (those are gaps to fill in knowledge.ts) and get
  // from a captured lead to its Pipedrive record without searching by email.

  // PIPEDRIVE_DOMAIN comes from js/supabase-config.js — see the comment
  // there for where to find it. Blank is a supported state, not a broken
  // one: the lead id renders as text instead of a link.

  // Costs are pennies, so the usual 2dp is all zeros. Four decimals for a
  // single conversation, two once it is a monthly total.
  //
  // Every figure this renders is an ESTIMATE — our own token counts times
  // published rates — so it is prefixed with a tilde. The authority is the
  // Anthropic bill; record it in chat_actual_costs and compare through
  // chat_cost_reconciliation.
  function fmtUsd(v, dp) {
    const n = Number(v || 0);
    return "~$" + n.toFixed(dp == null ? 4 : dp);
  }

  async function loadChats() {
    const [convos, months] = await Promise.all([
      sb
        .from("chat_conversations_with_cost")
        .select("*")
        .order("last_at", { ascending: false })
        .limit(500),
      sb.from("chat_costs_monthly").select("*").limit(12),
    ]);

    if (convos.error) {
      note($("appNote"), "Couldn't load chats: " + convos.error.message, "error");
      return;
    }
    state.chats = convos.data || [];

    // Cost views live in add-chat-costs.sql, which is a separate migration.
    // If it has not been run the conversations still list fine — the spend
    // strip just stays empty rather than the whole tab failing.
    state.chatMonths = months.error ? [] : months.data || [];
    if (months.error) console.warn("[admin] cost views unavailable:", months.error.message);

    state.chatsLoaded = true;
    renderChatSpend();
    renderChats();
  }

  function renderChatSpend() {
    const el = $("chatSpend");
    const months = state.chatMonths || [];
    if (!months.length) {
      el.innerHTML = "";
      return;
    }
    const thisMonth = new Date().toISOString().slice(0, 7);
    const cur = months.find((m) => String(m.month).slice(0, 7) === thisMonth);
    const prev = months.find((m) => String(m.month).slice(0, 7) !== thisMonth);

    el.innerHTML =
      '<div class="chat-spend-now">' +
      fmtUsd(cur ? cur.est_total_usd : 0, 2) +
      "<span>estimated this month</span></div>" +
      (prev
        ? '<div class="chat-spend-prev">' +
          fmtUsd(prev.est_total_usd, 2) +
          " in " +
          esc(String(prev.month).slice(0, 7)) +
          "</div>"
        : "") +
      // Cache writes should be a rounding error against reads. When they
      // are not, the prefix is being invalidated and the same prompt is
      // being paid for at roughly ten times the rate.
      (cur && Number(cur.est_cache_write_usd) > Number(cur.est_cache_read_usd)
        ? '<div class="chat-spend-warn">Cache writes exceed reads — prefix is being invalidated</div>'
        : "");
  }

  function visibleChats() {
    const period = $("chatPeriod").value;
    const lead = $("chatFilterLead").value;
    const matched = state.chatSearchIds; // null = no active search

    let cutoff = null;
    if (period !== "__all") {
      cutoff = Date.now() - Number(period) * 86400000;
    }

    return state.chats.filter((c) => {
      if (cutoff && new Date(c.last_at).getTime() < cutoff) return false;
      if (lead === "lead" && !c.captured_lead) return false;
      if (lead === "nolead" && c.captured_lead) return false;
      if (lead === "support" && !c.routed_support) return false;
      if (matched && !matched.has(c.session_id)) return false;
      return true;
    });
  }

  // Who the conversation was with, for the list. A lead is the only time we
  // know — anonymous visitors stay a dash rather than an empty cell, so the
  // column reads as "nobody left details" and not as missing data.
  //
  // Falling back to the email as the label matters: the capture tool can
  // return an email with no name, and "—" next to a working copy button
  // would look broken.
  function personCell(c) {
    const email = c.lead_email || "";
    const label = c.lead_name || email;
    if (!label) return '<span class="chat-person chat-person-none">—</span>';

    // With no email there is nothing to copy, so the name stays inert text
    // rather than a control that looks clickable and does nothing.
    if (!email) return '<span class="chat-person">' + esc(label) + "</span>";

    // A button, not an anchor: it copies rather than navigates, and the
    // tooltip is what tells you which address you are about to get.
    return (
      '<button type="button" class="chat-person" data-copy="' +
      esc(email) +
      '" title="Copy ' +
      esc(email) +
      '">' +
      esc(label) +
      "</button>"
    );
  }

  /**
   * Copy text and say so on the button itself.
   *
   * The async Clipboard API is undefined outside a secure context, which
   * includes opening this file from disk — so the old selection trick is
   * kept as a fallback rather than letting the button silently do nothing.
   */
  async function copyText(text, btn) {
    const original = btn.getAttribute("data-copy-label") || btn.textContent;
    btn.setAttribute("data-copy-label", original);

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("copy rejected");
      }
      btn.textContent = "Copied";
      btn.classList.add("is-copied");
    } catch (err) {
      console.warn("[admin] copy failed:", err);
      btn.textContent = "Failed";
    }

    clearTimeout(btn._copyTimer);
    btn._copyTimer = setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove("is-copied");
    }, 1400);
  }

  // Delegated, so the list and the drawer's lead card both work without
  // rewiring anything after each innerHTML rebuild.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest("[data-copy]");
    if (!btn) return;
    e.preventDefault();
    // The row is not clickable today (only its Open button is), but the
    // button sits inside one — keep the click from travelling if that
    // ever changes.
    e.stopPropagation();
    copyText(btn.getAttribute("data-copy"), btn);
  });

  function outcomeLabel(c) {
    if (c.captured_lead) {
      return '<span class="chat-pill lead">Lead</span>';
    }
    if (c.routed_support) return '<span class="chat-pill support">Support</span>';
    return '<span class="chat-pill">—</span>';
  }

  function renderChats() {
    const items = visibleChats();
    const total = state.chats.length;
    const leads = state.chats.filter((c) => c.captured_lead).length;
    $("chatCount").textContent =
      total === 0
        ? "No conversations yet."
        : total + " conversations · " + leads + " produced a lead";

    const rows = $("chatRows");
    if (!items.length) {
      rows.innerHTML = "";
      show($("chatEmpty"));
      $("chatEmpty").textContent = total
        ? "Nothing matches those filters."
        : "No conversations yet.";
      return;
    }
    hide($("chatEmpty"));

    rows.innerHTML = items
      .map(
        (c) =>
          '<div class="adm-row chat" data-session="' +
          esc(c.session_id) +
          '">' +
          "<span>" +
          fmtDate(c.started_at) +
          "</span>" +
          personCell(c) +
          '<span class="chat-q">' +
          esc(c.first_question) +
          "</span>" +
          "<span>" +
          c.turns +
          "</span>" +
          '<span class="chat-cost">' +
          fmtUsd(c.est_cost_usd) +
          "</span>" +
          "<span>" +
          outcomeLabel(c) +
          "</span>" +
          '<span><button class="btn-sm" data-open="' +
          esc(c.session_id) +
          '">Open</button></span>' +
          "</div>",
      )
      .join("");

    rows.querySelectorAll("[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => openChat(btn.getAttribute("data-open")));
    });
  }

  // Search runs server-side across every turn, not just the opening question
  // held in the conversation index — someone looking for "Australia" wants
  // the chat where it came up on turn four as much as turn one.
  let searchTimer = null;
  async function runChatSearch() {
    const q = $("chatSearch").value.trim();
    if (q.length < 2) {
      state.chatSearchIds = null;
      renderChats();
      return;
    }
    const like = "%" + q.replace(/[%_]/g, "\\$&") + "%";
    const { data, error } = await sb
      .from("chat_transcripts")
      .select("session_id")
      .or("question.ilike." + like + ",reply.ilike." + like)
      .limit(2000);

    if (error) {
      note($("appNote"), "Search failed: " + error.message, "error");
      return;
    }
    const ids = new Set((data || []).map((r) => r.session_id));

    // Lead fields live on the conversation index rather than the turns, so
    // match them here too — otherwise searching someone's firm name finds
    // nothing even though their lead is right there.
    const ql = q.toLowerCase();
    state.chats.forEach((c) => {
      const hay = [c.lead_name, c.lead_email, c.lead_firm, c.lead_summary]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (hay.includes(ql)) ids.add(c.session_id);
    });

    state.chatSearchIds = ids;
    renderChats();
  }

  $("chatSearch").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runChatSearch, 250);
  });
  ["chatPeriod", "chatFilterLead"].forEach((id) => {
    $(id).addEventListener("change", renderChats);
  });

  function leadCard(c) {
    if (!c || !c.captured_lead) return "";

    // The name copies the address, exactly as it does in the list, so the
    // same click does the same thing in both places.
    const nameValue = c.lead_email ? personCell(c) : null;

    // The email itself still navigates — one control to reach them, one to
    // paste them somewhere else.
    //
    // encodeURI, not encodeURIComponent — the latter turns "@" into %40,
    // which works but shows up mangled in some mail clients.
    const emailValue =
      '<a class="chat-mailto" href="mailto:' +
      esc(encodeURI(c.lead_email || "")) +
      '">' +
      esc(c.lead_email) +
      "</a>";

    const rows = [
      ["Name", c.lead_name, nameValue],
      ["Email", c.lead_email, c.lead_email ? emailValue : null],
      ["Firm", c.lead_firm, null],
      ["Size", c.lead_firm_size, null],
      ["Interest", c.lead_interest, null],
    ]
      .filter((r) => r[1])
      .map(
        (r) =>
          '<div class="chat-lead-row"><span>' +
          esc(r[0]) +
          "</span><span>" +
          (r[2] || esc(r[1])) +
          "</span></div>",
      )
      .join("");

    let crm = "";
    if (c.pipedrive_lead_id && PIPEDRIVE_DOMAIN) {
      crm =
        '<a class="btn-sm" target="_blank" rel="noopener" href="https://' +
        esc(PIPEDRIVE_DOMAIN) +
        ".pipedrive.com/leads/inbox/" +
        encodeURIComponent(c.pipedrive_lead_id) +
        '">Open in Pipedrive</a>';
    } else if (c.pipedrive_lead_id) {
      // No domain configured — show the id so it can still be pasted into
      // Pipedrive's search rather than pretending the link doesn't exist.
      crm = '<span class="adm-note info">Pipedrive lead ' + esc(c.pipedrive_lead_id) + "</span>";
    } else {
      // Written to Supabase but never synced: this is the replay queue in
      // chat_leads, and it means someone should push it manually.
      crm = '<span class="adm-note error">Not synced to Pipedrive</span>';
    }

    return (
      '<div class="chat-lead">' +
      "<h3>Lead captured</h3>" +
      rows +
      (c.lead_summary
        ? '<p class="chat-lead-summary">' + esc(c.lead_summary) + "</p>"
        : "") +
      '<div class="chat-lead-crm">' +
      crm +
      "</div>" +
      "</div>"
    );
  }

  async function openChat(sessionId) {
    const convo = state.chats.find((c) => c.session_id === sessionId);
    state.openChat = sessionId;

    $("chatDrawerTitle").textContent =
      "Conversation · " +
      fmtDate(convo && convo.started_at) +
      (convo ? " · " + fmtUsd(convo.est_cost_usd) : "");
    $("chatDrawerNote").textContent = "";
    $("chatLeadCard").innerHTML = leadCard(convo);
    $("chatThread").innerHTML = '<p class="adm-note info">Loading…</p>';
    show($("chatScrim"));
    show($("chatDrawer"));

    const { data, error } = await sb
      .from("chat_transcripts")
      .select("turn,created_at,question,reply,tool_called")
      .eq("session_id", sessionId)
      .order("turn", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      $("chatThread").innerHTML =
        '<p class="adm-note error">' + esc(error.message) + "</p>";
      return;
    }

    $("chatThread").innerHTML = (data || [])
      .map(
        (t) =>
          '<div class="chat-turn">' +
          '<div class="chat-msg user"><span class="who">Visitor</span>' +
          esc(t.question) +
          "</div>" +
          '<div class="chat-msg bot"><span class="who">Assistant</span>' +
          esc(t.reply) +
          "</div>" +
          (t.tool_called
            ? '<div class="chat-tool">called ' + esc(t.tool_called) + "</div>"
            : "") +
          "</div>",
      )
      .join("");
  }

  function closeChat() {
    hide($("chatScrim"));
    hide($("chatDrawer"));
    state.openChat = null;
  }

  $("closeChatDrawer").addEventListener("click", closeChat);
  $("chatScrim").addEventListener("click", closeChat);

  // Pull the authoritative figure from Anthropic's Cost API into
  // chat_actual_costs. The Admin API key never comes near this page — the
  // sync-costs Edge Function holds it and checks this editor's session
  // before using it.
  $("chatSyncCosts").addEventListener("click", async () => {
    const btn = $("chatSyncCosts");
    btn.disabled = true;
    btn.textContent = "Syncing…";

    try {
      const { data } = await sb.auth.getSession();
      const token = data.session && data.session.access_token;
      if (!token) throw new Error("Session expired — sign in again.");

      const res = await fetch(SUPABASE_URL + "/functions/v1/sync-costs", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + token },
        body: JSON.stringify({ months: 3 }),
      });
      const body = await res.json();

      if (!res.ok) {
        // The function distinguishes "not set up" from "misconfigured";
        // pass its own wording through rather than flattening both to
        // "sync failed", because the fixes are completely different.
        note($("appNote"), body.detail || body.error || "Sync failed.", "error");
        return;
      }

      note(
        $("appNote"),
        "Recorded " +
          body.months_written +
          " month(s)." +
          (body.workspace_scoped
            ? ""
            : " Organization-wide totals — not scoped to the chat widget."),
        body.workspace_scoped ? "success" : "info",
      );
      state.chatsLoaded = false;
      await loadChats();
    } catch (err) {
      // fetch() rejects with a bare "Failed to fetch" for a missing
      // function, a CORS refusal, and an offline browser alike. Say which
      // is most likely, because the fixes are unrelated — and the usual
      // cause is simply that sync-costs has never been deployed.
      const msg = String((err && err.message) || err);
      note(
        $("appNote"),
        /failed to fetch|networkerror|load failed/i.test(msg)
          ? "Couldn't reach sync-costs. It is optional and probably not deployed " +
              "(supabase functions deploy sync-costs). If it is deployed, add this " +
              "page's origin to ALLOWED_ORIGIN — opening the admin from file:// " +
              "sends a null origin that CORS will reject."
          : msg,
        "error",
      );
    } finally {
      btn.disabled = false;
      btn.textContent = "Sync actual";
    }
  });

  $("chatDeleteBtn").addEventListener("click", async () => {
    if (!state.openChat) return;
    const convo = state.chats.find((c) => c.session_id === state.openChat);
    const warn = convo && convo.captured_lead
      ? "Delete this conversation AND its captured lead? The Pipedrive record is not affected."
      : "Delete this conversation? This cannot be undone.";
    if (!confirm(warn)) return;

    // One RPC rather than two deletes, so a removed test conversation can't
    // leave its lead row orphaned. The is_editor() check lives in Postgres.
    const { error } = await sb.rpc("chat_delete_conversation", {
      p_session_id: state.openChat,
    });
    if (error) {
      note($("chatDrawerNote"), error.message, "error");
      return;
    }
    state.chats = state.chats.filter((c) => c.session_id !== state.openChat);
    closeChat();
    renderChats();
    note($("appNote"), "Conversation deleted.", "info");
  });

  // ---------- go ----------
  refreshSession();
}
