-- =========================================================
-- Chat abuse / spend protection
-- Run this once in the Supabase SQL Editor (SQL Editor → New query).
-- Idempotent: safe to re-run.
--
-- RUN add-chat-leads.sql FIRST — the chat_usage_today view at the bottom
-- reads public.chat_leads, so this file errors if that table is missing.
--
-- Replaces the in-memory rate limiter in the chat Edge Function, which
-- was per-instance and therefore near-useless: Edge Functions are
-- ephemeral and horizontally scaled, so each cold start began with an
-- empty Map and instances never saw each other's counts.
--
-- Three buckets, checked in one round trip:
--   ip:<addr>:<minute>  burst control     — stops a hammering script
--   ipday:<addr>:<date> per-visitor/day   — stops a slow grinder
--   day:<date>          GLOBAL per-day    — the actual bill ceiling
--
-- The global bucket is the one that matters. Per-IP limits fall to
-- rotating addresses; a global cap holds regardless of how the traffic
-- is distributed, because it counts requests, not requesters.
-- =========================================================

create table if not exists public.chat_rate_limit (
  bucket     text primary key,
  count      integer not null default 0,
  expires_at timestamptz not null
);

create index if not exists chat_rate_limit_expires_idx
  on public.chat_rate_limit (expires_at);

-- Locked down completely: only the Edge Function touches this, and it
-- uses the service-role key, which bypasses RLS. No browser-reachable
-- policy is defined, so anon/authenticated get nothing.
alter table public.chat_rate_limit enable row level security;

-- ---------------------------------------------------------
-- Atomic quota check. Increments all three buckets and reports whether
-- the request may proceed. One statement per bucket, INSERT ... ON
-- CONFLICT DO UPDATE, so concurrent callers can't race the counter.
--
-- Returns the FIRST limit breached so the caller can respond
-- differently to "you're too fast" vs "the site is done for today".
-- ---------------------------------------------------------
create or replace function public.chat_check_quota(
  p_ip             text,
  p_per_minute     integer default 10,     -- burst, per IP
  p_per_day_ip     integer default 40,     -- sustained, per IP
  p_per_day_global integer default 150     -- the bill ceiling: ~$3/day
)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minute text := to_char(now() at time zone 'utc', 'YYYYMMDDHH24MI');
  v_day    text := to_char(now() at time zone 'utc', 'YYYYMMDD');
  v_burst  integer;
  v_ipday  integer;
  v_global integer;
begin
  -- Opportunistic cleanup. Cheap, and avoids needing a cron job.
  delete from public.chat_rate_limit where expires_at < now();

  insert into public.chat_rate_limit (bucket, count, expires_at)
  values ('ip:' || p_ip || ':' || v_minute, 1, now() + interval '2 minutes')
  on conflict (bucket) do update set count = chat_rate_limit.count + 1
  returning count into v_burst;

  insert into public.chat_rate_limit (bucket, count, expires_at)
  values ('ipday:' || p_ip || ':' || v_day, 1, now() + interval '2 days')
  on conflict (bucket) do update set count = chat_rate_limit.count + 1
  returning count into v_ipday;

  insert into public.chat_rate_limit (bucket, count, expires_at)
  values ('day:' || v_day, 1, now() + interval '2 days')
  on conflict (bucket) do update set count = chat_rate_limit.count + 1
  returning count into v_global;

  if v_global > p_per_day_global then
    return query select false, 'global_daily'::text;
  elsif v_ipday > p_per_day_ip then
    return query select false, 'ip_daily'::text;
  elsif v_burst > p_per_minute then
    return query select false, 'ip_burst'::text;
  else
    return query select true, 'ok'::text;
  end if;
end $$;

revoke all on function public.chat_check_quota(text, integer, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------
-- Operator view: how much has the chat been used today?
-- Run this to sanity-check traffic before it shows up on an invoice.
--   select * from public.chat_usage_today;
-- ---------------------------------------------------------
create or replace view public.chat_usage_today as
  select
    (select coalesce(count, 0) from public.chat_rate_limit
      where bucket = 'day:' || to_char(now() at time zone 'utc', 'YYYYMMDD')) as requests_today,
    (select count(*) from public.chat_rate_limit
      where bucket like 'ipday:%' || to_char(now() at time zone 'utc', 'YYYYMMDD')) as unique_ips_today,
    (select count(*) from public.chat_leads
      where created_at >= date_trunc('day', now())) as leads_today;
