-- =========================================================
-- Chat transcripts — the feedback loop for the agent
-- Run this once in the Supabase SQL Editor (SQL Editor → New query).
-- Idempotent: safe to re-run.
--
-- WHY THIS EXISTS
-- The agent's failures are silent. It answered an Australian firm asking
-- about CPD with "CLESite is built around US MCLE… I don't have anything
-- confirming Australian CPD support" — a fabricated denial that sent a
-- qualified prospect away, and that nobody would ever have seen if a
-- colleague hadn't happened to test that exact question by hand.
--
-- There is no reason to think that was the only one. This table is how
-- you stop finding them by luck: every exchange is recorded, and the
-- chat_handoffs_recent view surfaces the ones where the agent couldn't
-- answer. Those are the questions to add to
-- functions/chat/knowledge.ts — that loop is the whole point.
--
-- ⚠️ PRIVACY — READ BEFORE RUNNING
-- This table stores what visitors type, which on a law-firm site will
-- include names, work emails, firm names, and occasionally details of a
-- problem they are trying to solve. That is a real records-retention
-- question, not a technical one:
--   * RLS is on. Anonymous visitors get nothing; only the Edge Function's
--     service-role key writes, and only signed-in editors can read or
--     delete (the admin conversation browser). Every view here is declared
--     security_invoker so it enforces those same policies rather than
--     running as the view owner and quietly bypassing them.
--   * Nothing here is exposed to the chat agent — it is written after the
--     reply and never read back into a prompt.
--   * Retention is NOT automatic. Decide on a window and schedule
--     chat_purge_transcripts() (see the bottom of this file). Ninety days
--     is a reasonable default for a sales-review loop.
--   * If the site adds a privacy-policy line about chat, this is the
--     thing it needs to describe.
-- =========================================================

create table if not exists public.chat_transcripts (
  id                 bigserial primary key,

  -- Groups the turns of one conversation. Generated in the browser and
  -- kept in that browser's localStorage, so it now spans a refresh, other
  -- pages, and a return visit — a resumed conversation stays one row in
  -- chat_conversations instead of arriving as unrelated fragments.
  -- Still not an identity: never tied to a person or an IP, cleared by the
  -- widget's "New chat" control or by clearing site data, and expiring
  -- with the conversation (30 days idle — see js/chat.js).
  session_id         text        not null,
  turn               integer     not null,

  created_at         timestamptz not null default now(),

  question           text        not null,
  reply              text        not null,

  -- Which funnel the exchange landed in. NULL means the agent answered
  -- without routing — the common case, and also where a silent bad
  -- answer hides.
  tool_called        text,
  stop_reason        text,

  -- Usage, so cache health is queryable instead of buried in logs.
  model              text,
  input_tokens       integer,
  output_tokens      integer,
  cache_read_tokens  integer,
  cache_write_tokens integer
);

create index if not exists chat_transcripts_created_idx
  on public.chat_transcripts (created_at desc);

create index if not exists chat_transcripts_session_idx
  on public.chat_transcripts (session_id, turn);

-- ---------------------------------------------------------
-- Row-level security
--   Anonymous visitors get NOTHING — not even insert. The Edge Function
--   writes with the service-role key, which bypasses RLS, so there is no
--   reason to expose this table to the public site.
--   Editors get read and delete, for the admin conversation browser.
--   There is deliberately no update policy: a transcript is a record of
--   what was actually said, and editing it would defeat the purpose.
-- ---------------------------------------------------------
alter table public.chat_transcripts enable row level security;

drop policy if exists "editors read chat transcripts" on public.chat_transcripts;
create policy "editors read chat transcripts"
  on public.chat_transcripts for select
  to authenticated
  using (public.is_editor());

drop policy if exists "editors delete chat transcripts" on public.chat_transcripts;
create policy "editors delete chat transcripts"
  on public.chat_transcripts for delete
  to authenticated
  using (public.is_editor());

-- ---------------------------------------------------------
-- The weekly review queue.
--
-- Surfaces exchanges where the agent most likely could not answer from
-- knowledge.ts. The heuristic is deliberately loose — it is a reading
-- list, not a metric. Over-matching costs you a few seconds of skimming;
-- under-matching costs you a lead.
--
--   select * from public.chat_handoffs_recent;
--
-- Read the `question` column. Anything that should have had a real
-- answer is a gap in the fact sheet — go fill it.
-- ---------------------------------------------------------
create or replace view public.chat_handoffs_recent
  with (security_invoker = true) as
  select
    created_at,
    session_id,
    turn,
    question,
    reply,
    tool_called
  from public.chat_transcripts
  where created_at >= now() - interval '30 days'
    and tool_called is distinct from 'route_to_support'
    and (
         reply ilike '%specialist%'
      or reply ilike '%get you someone%'
      or reply ilike '%connect you%'
      or reply ilike '%put you in touch%'
      or reply ilike '%definite answer%'
      or reply ilike '%our team%'
      or reply ilike '%solutions engineer%'
    )
  order by created_at desc;

-- ---------------------------------------------------------
-- Denial detector.
--
-- The failure mode that matters most does not look like an error: the
-- agent invents a limitation rather than handing off. These phrasings are
-- banned in knowledge.ts, so anything appearing here is the guardrail
-- being ignored — treat a non-empty result as a bug, not a data point.
--
--   select * from public.chat_denials_recent;
-- ---------------------------------------------------------
create or replace view public.chat_denials_recent
  with (security_invoker = true) as
  select created_at, session_id, turn, question, reply
  from public.chat_transcripts
  where created_at >= now() - interval '30 days'
    and (
         reply ilike '%we don''t do%'
      or reply ilike '%we do not do%'
      or reply ilike '%isn''t supported%'
      or reply ilike '%is not supported%'
      or reply ilike '%we only%'
      or reply ilike '%don''t have anything confirming%'
      or reply ilike '%can''t verify%'
      or reply ilike '%on the roadmap%'
      or reply ilike '%not something the platform%'
      or reply ilike '%I don''t know%'
    )
  order by created_at desc;

-- ---------------------------------------------------------
-- Operator view: is prompt caching actually working?
--
-- The cached prefix measures 8,224 tokens and is sent on every request,
-- so whether it is billed at the read rate or the full rate sets the daily
-- cost ceiling (see the note in add-chat-quota.sql). Healthy looks like
-- a large read total and a handful of writes per day.
--
--   select * from public.chat_cache_health;
-- ---------------------------------------------------------
create or replace view public.chat_cache_health
  with (security_invoker = true) as
  select
    date_trunc('day', created_at)::date as day,
    count(*)                            as exchanges,
    sum(cache_read_tokens)              as cached_read,
    sum(cache_write_tokens)             as cached_written,
    sum(input_tokens)                   as uncached_input,
    sum(output_tokens)                  as output
  from public.chat_transcripts
  where created_at >= now() - interval '30 days'
  group by 1
  order by 1 desc;

-- ---------------------------------------------------------
-- Conversation index — what the admin Chats tab lists.
--
-- One row per conversation rather than per exchange, because a reviewer
-- thinks in conversations: who turned up, what they asked first, how far
-- it got, and whether it produced a lead. The individual turns are
-- fetched only when a row is opened.
--
-- Joined to chat_leads on session_id so a captured lead travels with the
-- conversation that earned it — including the Pipedrive id, so the admin
-- can deep-link into the CRM record rather than making someone search
-- for it by email.
--
-- LEFT JOIN, not INNER: most conversations never produce a lead, and
-- those are exactly the ones worth reading.
-- ---------------------------------------------------------
create or replace view public.chat_conversations
  with (security_invoker = true) as
  select
    t.session_id,
    min(t.created_at)                                       as started_at,
    max(t.created_at)                                       as last_at,
    count(*)::int                                           as turns,
    -- Preview text for the list: what they opened with.
    (array_agg(t.question order by t.turn, t.created_at))[1] as first_question,
    bool_or(t.tool_called = 'capture_lead')                  as captured_lead,
    bool_or(t.tool_called = 'route_to_support')              as routed_support,
    sum(coalesce(t.input_tokens, 0)
      + coalesce(t.output_tokens, 0))::bigint                as tokens,
    l.id                                                     as lead_id,
    l.name                                                   as lead_name,
    l.work_email                                             as lead_email,
    l.firm_name                                              as lead_firm,
    l.firm_size                                              as lead_firm_size,
    l.interest                                               as lead_interest,
    l.summary                                                as lead_summary,
    l.pipedrive_lead_id,
    l.pipedrive_synced
  from public.chat_transcripts t
  left join public.chat_leads l on l.session_id = t.session_id
  group by
    t.session_id, l.id, l.name, l.work_email, l.firm_name, l.firm_size,
    l.interest, l.summary, l.pipedrive_lead_id, l.pipedrive_synced
  order by max(t.created_at) desc;

-- ---------------------------------------------------------
-- Delete one conversation, transcript and lead together.
--
-- Exposed as a function rather than left to the client so that removing a
-- test conversation cannot orphan its lead row — the admin has one button
-- and this decides what that means. security definer with a hard
-- is_editor() gate: the check is here, not in the browser.
--
--   select public.chat_delete_conversation('local-test');
-- ---------------------------------------------------------
create or replace function public.chat_delete_conversation(p_session_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if not public.is_editor() then
    raise exception 'not authorised';
  end if;

  delete from public.chat_transcripts where session_id = p_session_id;
  get diagnostics v_deleted = row_count;

  -- The lead is part of the conversation, not a separate record to keep.
  -- A test chat that produced a test lead should leave nothing behind.
  delete from public.chat_leads where session_id = p_session_id;

  return v_deleted;
end $$;

revoke all on function public.chat_delete_conversation(text) from public, anon;
grant execute on function public.chat_delete_conversation(text) to authenticated;

-- ---------------------------------------------------------
-- Retention. Not scheduled automatically — call it yourself, or attach
-- it to pg_cron once you have settled on a window:
--
--   select public.chat_purge_transcripts();      -- default 90 days
--   select public.chat_purge_transcripts(30);
--
-- With pg_cron enabled:
--   select cron.schedule('purge-chat-transcripts', '0 4 * * *',
--                        $$select public.chat_purge_transcripts(90)$$);
-- ---------------------------------------------------------
create or replace function public.chat_purge_transcripts(p_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.chat_transcripts
  where created_at < now() - make_interval(days => p_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke all on function public.chat_purge_transcripts(integer) from public, anon, authenticated;
