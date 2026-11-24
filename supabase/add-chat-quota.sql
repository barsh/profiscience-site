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
-- Five buckets, checked in one round trip:
--   ip:<addr>:<minute>      burst control          — stops a hammering script
--   smin:<session>:<minute> burst, per conversation — same idea, one chat
--   ipday:<addr>:<date>     per-visitor/day        — stops a slow grinder
--   convday:<addr>:<date>   new conversations/day  — stops session-id rotation
--   day:<date>              GLOBAL per-day         — the actual bill ceiling
--
-- The global bucket is the one that matters against rotating addresses.
-- convday is what stops a script that mints a new session id per message
-- on one IP: the per-session turn cap (enforced in the Edge Function from
-- chat_transcripts, not here) would otherwise reset every time.
--
-- Defaults match supabase/functions/chat/abuse.mjs. The Edge Function
-- passes its own values (env-overridable), so changing a number here
-- only affects a hand-run call. Change both if you change the policy.
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

-- One row per conversation id we have already counted toward convday.
-- Not an identity: the id is whatever the browser (or a script) sent,
-- trimmed to 64 characters by the Edge Function. Rows older than two
-- days are deleted by chat_check_quota, same as the rate buckets.
create table if not exists public.chat_sessions (
  session_id text primary key,
  ip         text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_sessions_created_idx
  on public.chat_sessions (created_at);

alter table public.chat_sessions enable row level security;

-- ---------------------------------------------------------
-- Atomic quota check. Increments all three buckets and reports whether
-- the request may proceed. One statement per bucket, INSERT ... ON
-- CONFLICT DO UPDATE, so concurrent callers can't race the counter.
--
-- Returns the FIRST limit breached so the caller can respond
-- differently to "you're too fast" vs "the site is done for today".
-- ---------------------------------------------------------
-- The global default assumes the chat function's cached prompt prefix is
-- actually being cached. That prefix measures 8,224 tokens (the knowledge
-- base in functions/chat/knowledge.ts, the system prompt, and the tool
-- definitions) and is sent on every request, so its billing rate sets the
-- ceiling. Measured against Opus 4.8 rather than estimated:
--
--   cache hit   ~$0.016/request  ->  ~$2.50/day at 150 requests
--   cache miss  ~$0.053/request  ->  ~$8/day at 150 requests
--
-- (prefix + ~800 tokens of replayed conversation + ~300 output tokens)
--
-- Both are survivable, which is the point of the cap. But if the chat
-- function ever starts interpolating something per-request or per-visitor
-- ahead of the cache_control breakpoint, every request becomes a miss and
-- this number quietly triples. The function logs read/write token counts on
-- every reply — check those before assuming the ceiling still holds.
-- The argument list grew (session burst, conversations per day). CREATE
-- OR REPLACE cannot change a signature, and leaving the old overload in
-- place makes PostgREST refuse the call as ambiguous. Drop both shapes.
drop function if exists public.chat_check_quota(text, integer, integer, integer);
drop function if exists public.chat_check_quota(text, integer, integer, integer, text, integer, integer);

create or replace function public.chat_check_quota(
  p_ip                     text,
  p_per_minute             integer default 10,   -- burst, per IP
  p_per_day_ip             integer default 40,   -- sustained, per IP
  p_per_day_global         integer default 150,  -- the bill ceiling: see note above
  p_session                text    default '',
  p_per_minute_session     integer default 10,   -- burst, per conversation
  p_conversations_per_day  integer default 12    -- new session ids, per IP
)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minute  text := to_char(now() at time zone 'utc', 'YYYYMMDDHH24MI');
  v_day     text := to_char(now() at time zone 'utc', 'YYYYMMDD');
  v_ip      text := left(coalesce(nullif(btrim(p_ip), ''), 'unknown'), 128);
  v_session text := left(coalesce(nullif(btrim(p_session), ''), 'unknown'), 64);
  v_burst   integer;
  v_ipday   integer;
  v_global  integer;
  v_sburst  integer;
  v_conv    integer;
  v_known   boolean;
  v_inserted boolean := false;
begin
  -- Opportunistic cleanup. Cheap, and avoids needing a cron job.
  delete from public.chat_rate_limit where expires_at < now();
  delete from public.chat_sessions where created_at < now() - interval '2 days';

  insert into public.chat_rate_limit (bucket, count, expires_at)
  values ('ip:' || v_ip || ':' || v_minute, 1, now() + interval '2 minutes')
  on conflict (bucket) do update set count = chat_rate_limit.count + 1
  returning count into v_burst;

  insert into public.chat_rate_limit (bucket, count, expires_at)
  values ('ipday:' || v_ip || ':' || v_day, 1, now() + interval '2 days')
  on conflict (bucket) do update set count = chat_rate_limit.count + 1
  returning count into v_ipday;

  insert into public.chat_rate_limit (bucket, count, expires_at)
  values ('day:' || v_day, 1, now() + interval '2 days')
  on conflict (bucket) do update set count = chat_rate_limit.count + 1
  returning count into v_global;

  insert into public.chat_rate_limit (bucket, count, expires_at)
  values ('smin:' || v_session || ':' || v_minute, 1, now() + interval '2 minutes')
  on conflict (bucket) do update set count = chat_rate_limit.count + 1
  returning count into v_sburst;

  -- A conversation counts the first time we see its session id. Repeating
  -- that id (the normal case: the next turn of the same chat) does not
  -- consume another slot. FOUND is false when ON CONFLICT DO NOTHING
  -- skips the insert, including the race where two requests arrive together.
  select exists(
    select 1 from public.chat_sessions where session_id = v_session
  ) into v_known;

  if not v_known then
    insert into public.chat_sessions (session_id, ip)
    values (v_session, v_ip)
    on conflict (session_id) do nothing;
    v_inserted := found;
  end if;

  if v_inserted then
    insert into public.chat_rate_limit (bucket, count, expires_at)
    values ('convday:' || v_ip || ':' || v_day, 1, now() + interval '2 days')
    on conflict (bucket) do update set count = chat_rate_limit.count + 1
    returning count into v_conv;
  end if;

  if v_global > p_per_day_global then
    return query select false, 'global_daily'::text;
  elsif v_ipday > p_per_day_ip then
    return query select false, 'ip_daily'::text;
  elsif v_burst > p_per_minute then
    return query select false, 'ip_burst'::text;
  elsif v_sburst > p_per_minute_session then
    return query select false, 'session_burst'::text;
  elsif v_inserted and v_conv > p_conversations_per_day then
    return query select false, 'conversations_daily'::text;
  else
    return query select true, 'ok'::text;
  end if;
end $$;

revoke all on function public.chat_check_quota(text, integer, integer, integer, text, integer, integer)
  from public, anon, authenticated;

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
