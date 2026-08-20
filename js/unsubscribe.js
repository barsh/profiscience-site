import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from "./supabase-config.js";

const sb = isConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const form = document.getElementById("unsubForm");
const errEl = document.getElementById("unsubError");
const okEl = document.getElementById("unsubSuccess");
const btn = document.getElementById("unsubBtn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errEl.style.display = "none";
  const email = document.getElementById("unsub-email").value.trim();
  if (!email) return;
  if (!sb) {
    errEl.textContent = "Unsubscribe isn't available right now. Please email info@profiscience.com to be removed.";
    errEl.style.display = "block";
    return;
  }
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "Processing…";
  const { error } = await sb.rpc("unsubscribe", { p_email: email });
  btn.disabled = false;
  btn.textContent = label;
  if (error) {
    errEl.textContent = "Something went wrong. Please email info@profiscience.com to be removed.";
    errEl.style.display = "block";
    return;
  }
  // Succeeds whether or not the address was on the list (no enumeration).
  form.style.display = "none";
  okEl.style.display = "block";
  if (window.pfTrack) window.pfTrack("cle_corner_unsubscribe", {});
});
