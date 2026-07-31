/* =========================================================
   Supabase connection
   ---------------------------------------------------------
   WHERE TO FIND THESE (supabase.com/dashboard → your project):

     Project URL → Settings → API      e.g. https://xxxx.supabase.co
     Key         → Settings → API Keys

   The key is labelled either "anon / public" (a long JWT starting
   with eyJ...) or "publishable" (starting with sb_publishable_...),
   depending on how new your project is. EITHER ONE WORKS — paste
   whichever you see. The "Connect" button at the top of the dashboard
   also shows the URL and the correct key together.

   This key is SAFE to commit and ship to the browser — it is public
   by design. Row-level security in Postgres is what actually protects
   the data (see supabase/schema.sql). A static site has no server, so
   there is nowhere else it could live.

   NEVER put the `service_role` / `sb_secret_...` key in this file.
   It bypasses every security policy.
   ========================================================= */

// Base project URL — NOT the /rest/v1/ endpoint. The client appends the paths.
export const SUPABASE_URL = "https://rqkbjvyxhdknbjhaszya.supabase.co";

// Replace after rotating the JWT secret (the old anon key was invalidated by
// the rotation). Accepts either an anon JWT (eyJ...) or a publishable key.
export const SUPABASE_ANON_KEY = "sb_publishable_Y-lJeRmMpUi3Xd13_psUtg_GHpjkDWf";

export const isConfigured =
  !SUPABASE_URL.startsWith("PASTE_") && !SUPABASE_ANON_KEY.startsWith("PASTE_");

/* ---------------------------------------------------------
   Pipedrive — admin only

   Just the subdomain, not the whole URL. Open any lead in Pipedrive and
   look at the address bar:

     https://acme.pipedrive.com/leads/inbox/abc123
             ^^^^  <- this part

   so you would put "acme" below.

   Used by the admin Chats tab to turn a captured lead into a direct link
   into the CRM. Leave it empty and the admin shows the Pipedrive lead id
   as plain text instead — still useful to paste into Pipedrive's search,
   and better than a link that 404s.

   Safe to commit: a company subdomain is not a credential. The API token
   that actually talks to Pipedrive lives in Supabase secrets, server-side.
   --------------------------------------------------------- */
export const PIPEDRIVE_DOMAIN = "profiscience";
