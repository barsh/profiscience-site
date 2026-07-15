-- =========================================================
-- Import the legacy CLE Corner / newsletter subscriber list
-- into the new Supabase `subscribers` table.
--
-- WHERE THE OLD LIST LIVES:
--   It is NOT in this repo. The old list is held by the previous ASP.NET
--   system behind /opt-in.aspx (the CLE Corner subscribe form). Export it
--   from that system's admin/database as a CSV first. Columns you want:
--     email (required), name (optional), company (optional)
--
-- HOW TO RUN:
--   Run this in Supabase → SQL Editor (New query). The SQL Editor executes
--   as the table owner, so it bypasses row-level security for the bulk load.
--   `email` is UNIQUE and auto-lowercased by a trigger, so re-running is safe:
--   duplicates are skipped via ON CONFLICT.
-- =========================================================

-- OPTION A — no SQL needed (easiest for a big CSV):
--   Supabase Dashboard → Table Editor → subscribers → "Insert" → "Import data from CSV".
--   Map columns email / name / company. Then tag the source in one statement:
--
--   update public.subscribers
--     set source = 'legacy-import'
--   where source is null;

-- OPTION B — paste the rows here and run:
insert into public.subscribers (email, name, company, source, status)
values
  ('example1@firm.com', 'First Last',  'Example LLP',        'legacy-import', 'subscribed'),
  ('example2@firm.com', 'First Last',  'Another Firm LLP',   'legacy-import', 'subscribed')
  -- ...paste the rest of the list here, one row per subscriber...
on conflict (email) do nothing;

-- If any old records were opt-outs, load them as unsubscribed so we never email them:
-- insert into public.subscribers (email, name, source, status)
-- values ('optout@firm.com', 'First Last', 'legacy-import', 'unsubscribed')
-- on conflict (email) do update set status = 'unsubscribed';

-- Verify the import:
-- select status, count(*) from public.subscribers group by status;
-- select count(*) from public.subscribers where source = 'legacy-import';
