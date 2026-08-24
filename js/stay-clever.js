import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from "./supabase-config.js";

// Chapter accordions
function openChapter(card) {
  card.classList.add("open");
  card.querySelector(".chapter-head")?.setAttribute("aria-expanded", "true");
}

document.querySelectorAll(".chapter-head").forEach((btn) => {
  btn.addEventListener("click", () => {
    const card = btn.closest(".chapter-card");
    const open = card.classList.toggle("open");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });
});

// Deep link to a chapter (e.g. #chapter2) expands and scrolls to its card.
// Waits for "load" so the header partial has finished injecting and
// --pf-sticky-offset (used by the card's scroll-margin-top) is accurate.
window.addEventListener("load", () => {
  const id = decodeURIComponent(location.hash.slice(1));
  const card = id && document.getElementById(id);
  if (!card || !card.classList.contains("chapter-card")) return;

  // The chapter grid is still sitting in its unrevealed .reveal position
  // (translateY(24px)) at this point. Left alone, the scroll-triggered
  // IntersectionObserver would reveal it a moment after we scroll, dragging
  // the card up and sliding its top under the sticky header. Reveal it
  // instantly instead, with no transition, so the scroll lands on its final position.
  const revealParent = card.closest(".reveal");
  if (revealParent && !revealParent.classList.contains("in")) {
    revealParent.style.transition = "none";
    revealParent.classList.add("in");
    void revealParent.offsetHeight;
    revealParent.style.transition = "";
  }

  openChapter(card);
  card.scrollIntoView({ block: "start", behavior: "smooth" });
});

// Generic modal open / close (works for any .modal-overlay)
document.querySelectorAll("[data-open-modal]").forEach((b) =>
  b.addEventListener("click", (e) => {
    e.preventDefault();
    const m = document.getElementById(b.getAttribute("data-open-modal"));
    if (!m) return;
    m.classList.add("open");
    m.setAttribute("aria-hidden", "false");
    const first = m.querySelector("input");
    if (first) first.focus();
  })
);
document.querySelectorAll(".modal-overlay").forEach((m) => {
  const close = () => { m.classList.remove("open"); m.setAttribute("aria-hidden", "true"); };
  m.querySelector(".modal-close")?.addEventListener("click", close);
  m.addEventListener("click", (e) => { if (e.target === m) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && m.classList.contains("open")) close(); });
});

// Signup forms -> subscribers table (same table the newsletter uses)
const sb = isConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

function wireForm({ formId, fields, source, track }) {
  const form = document.getElementById(formId);
  if (!form) return;
  const errEl = form.querySelector(".form-error");
  const okEl = form.querySelector(".form-success");
  const btn = form.querySelector("button[type=submit]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.style.display = "none";
    const row = { source };
    for (const [key, id] of Object.entries(fields)) {
      row[key] = (document.getElementById(id)?.value || "").trim();
    }
    if (!row.email) return;
    if (!sb) {
      errEl.textContent = "This isn't available right now. Please email info@profiscience.com.";
      errEl.style.display = "block";
      return;
    }
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "Sending…";
    const { error } = await sb.from("subscribers").insert(row);
    btn.disabled = false;
    btn.textContent = label;
    // 23505 = duplicate email; treat as success (they're already on the list).
    if (error && error.code !== "23505") {
      errEl.textContent = "Something went wrong. Please try again in a moment.";
      errEl.style.display = "block";
      return;
    }
    form.reset();
    okEl.style.display = "block";
    if (window.pfTrack) window.pfTrack(track, { source });
  });
}

wireForm({
  formId: "freeCopyForm",
  fields: { name: "fc-name", email: "fc-email", company: "fc-company" },
  source: "stay-clever-free-copy",
  track: "book_free_copy_request",
});
wireForm({
  formId: "cleCornerForm",
  fields: { name: "cc-name", email: "cc-email" },
  source: "cle-corner",
  track: "cle_corner_signup",
});
