-- =========================================================
-- Chat agent leads
-- Run this once in the Supabase SQL Editor (SQL Editor → New query).
-- Idempotent: safe to re-run. Requires public.is_editor() from schema.sql.
--
-- The chat Edge Function writes here BEFORE pushing to Pipedrive, so a
-- Pipedrive outage or API change can't lose a qualified lead. Rows with
-- pipedrive_synced = false are the replay queue.
-- =========================================================

create table if not exists public.chat_leads (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  work_email       text not null,
  firm_name        text,
  firm_size        text,
  interest         text,
  summary          text,                 -- why they came in, written by the agent
  source           text default 'site_chat',
  pipedrive_synced boolean not null default false,
  created_at       timestamptz not null default now()
);

create index if not exists chat_leads_created_idx on public.chat_leads (created_at desc);

-- Partial index: the only query that matters operationally is "what still
-- needs replaying into Pipedrive", and that set should normally be empty.
create index if not exists chat_leads_unsynced_idx
  on public.chat_leads (created_at desc) where not pipedrive_synced;

create or replace function public.lowercase_chat_lead_email()
returns trigger language plpgsql as $$
begin
  new.work_email = lower(trim(new.work_email));
  return new;
end $$;

drop trigger if exists chat_leads_lowercase_email on public.chat_leads;
create trigger chat_leads_lowercase_email
  before insert or update on public.chat_leads
  for each row execute function public.lowercase_chat_lead_email();

-- ---------------------------------------------------------
-- Row-level security
--   Anonymous visitors get NOTHING here — not even insert. The Edge
--   Function writes with the service-role key, which bypasses RLS, so
--   there is no reason to expose this table to the browser. Unlike
--   subscribers (where the page itself inserts), nothing client-side
--   ever touches chat_leads.
--   Editors: full read/manage for the admin.
-- ---------------------------------------------------------
alter table public.chat_leads enable row level security;

drop policy if exists "editors read chat leads" on public.chat_leads;
create policy "editors read chat leads"
  on public.chat_leads for select
  to authenticated
  using (public.is_editor());

drop policy if exists "editors update chat leads" on public.chat_leads;
create policy "editors update chat leads"
  on public.chat_leads for update
  to authenticated
  using (public.is_editor()) with check (public.is_editor());

drop policy if exists "editors delete chat leads" on public.chat_leads;
create policy "editors delete chat leads"
  on public.chat_leads for delete
  to authenticated
  using (public.is_editor());
