import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from "./supabase-config.js";

// Chapter accordions
document.querySelectorAll(".chapter-head").forEach((btn) => {
  btn.addEventListener("click", () => {
    const card = btn.closest(".chapter-card");
    const open = card.classList.toggle("open");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });
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
