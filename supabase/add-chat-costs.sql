-- =========================================================
-- Chat cost accounting
-- Run this AFTER add-chat-transcripts.sql (it reads that table).
-- Run in the Supabase SQL Editor. Idempotent: safe to re-run.
--
-- The transcript log already records the four token counts Anthropic bills
-- separately. This turns them into money.
--
-- The four are NOT interchangeable, which is the whole reason a rate table
-- exists rather than one price:
--
--   input_tokens        the part of the prompt that was NOT cached,
--                       billed at the full input rate
--   cache_read_tokens   the cached prefix on a hit — about a tenth of the
--                       input rate, and normally the bulk of the tokens
--   cache_write_tokens  the cached prefix on a miss — a PREMIUM over the
--                       input rate (2x at the 1-hour TTL this function
--                       uses), which is why a broken cache costs so much
--                       more than it saves
--   output_tokens       what the model wrote, by far the priciest per token
--
-- Treating them as one number would hide the only cost signal that matters:
-- whether the cache is working. See chat_cache_health in
-- add-chat-transcripts.sql for the token-level view of the same question.
-- =========================================================

-- ---------------------------------------------------------
-- Rates, in US dollars per million tokens.
--
-- Keyed by the model string the Edge Function records on each row, so if
-- the function is ever pointed at a different model, its exchanges price
-- themselves correctly without touching any view.
--
-- ⚠️ These are CURRENT rates applied to ALL history. If Anthropic changes
-- pricing and you update a row here, past months are recalculated at the
-- new rate. That is a deliberate simplification: it keeps the schema small
-- and answers "what would this traffic cost today", which is the useful
-- question for forecasting. If you ever need billing-accurate history,
-- add an effective_from column and range-join on it — but you will also
-- need your actual invoices, because this only ever approximates them.
--
-- Verify against platform.claude.com/docs/en/pricing before trusting a
-- figure you are going to put in front of anyone.
-- ---------------------------------------------------------
create table if not exists public.chat_model_pricing (
  model                 text primary key,
  input_per_mtok        numeric(10, 4) not null,
  output_per_mtok       numeric(10, 4) not null,
  cache_read_per_mtok   numeric(10, 4) not null,
  cache_write_per_mtok  numeric(10, 4) not null,
  note                  text,
  updated_at            timestamptz not null default now()
);

-- Claude Opus 4.8, the model in functions/chat/index.ts.
--
-- All four figures are the published per-MTok rates, checked against
-- platform.claude.com/docs/en/about-claude/pricing on 2026-07-31. None of
-- them is derived or estimated:
--
--   base input              $5      -> input_per_mtok
--   1h cache write          $10     -> cache_write_per_mtok  (2x input)
--   cache hits & refreshes  $0.50   -> cache_read_per_mtok   (0.1x input)
--   output                  $25     -> output_per_mtok
--
-- cache_write is the 1-HOUR rate because that is the TTL the function
-- requests. If the cache_control ttl in functions/chat/index.ts ever drops
-- back to the 5-minute default, this must become 6.25 (1.25x input) or
-- every cache miss is overstated by 60%.
--
-- Modifiers that would change these, none of which the function uses:
-- fast mode ($10/$50), the Batch API (50% off), and inference_geo:"us"
-- (1.1x on every category). Global routing is the default and is what the
-- function gets.
insert into public.chat_model_pricing
  (model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok, note)
values
  ('claude-opus-4-8', 5.0000, 25.0000, 0.5000, 10.0000,
   'Published rates verified 2026-07-31. Cache write is the 1h TTL rate (2x input) — change to 6.25 if the function drops to the 5m default.')
on conflict (model) do nothing;   -- do not clobber a rate you edited by hand

alter table public.chat_model_pricing enable row level security;

drop policy if exists "editors read chat pricing" on public.chat_model_pricing;
create policy "editors read chat pricing"
  on public.chat_model_pricing for select
  to authenticated
  using (public.is_editor());

drop policy if exists "editors manage chat pricing" on public.chat_model_pricing;
create policy "editors manage chat pricing"
  on public.chat_model_pricing for all
  to authenticated
  using (public.is_editor()) with check (public.is_editor());

-- ---------------------------------------------------------
-- Per-exchange cost. Everything else aggregates this.
--
-- LEFT JOIN on purpose: an exchange whose model has no rate row prices as
-- NULL, not as zero. A missing rate should look like a gap in the books,
-- not like free traffic.
-- ---------------------------------------------------------
create or replace view public.chat_exchange_costs
  with (security_invoker = true) as
  select
    t.id,
    t.session_id,
    t.turn,
    t.created_at,
    t.model,
    t.input_tokens,
    t.output_tokens,
    t.cache_read_tokens,
    t.cache_write_tokens,
    round(coalesce(t.input_tokens, 0)       * p.input_per_mtok       / 1000000, 6) as est_input_usd,
    round(coalesce(t.output_tokens, 0)      * p.output_per_mtok      / 1000000, 6) as est_output_usd,
    round(coalesce(t.cache_read_tokens, 0)  * p.cache_read_per_mtok  / 1000000, 6) as est_cache_read_usd,
    round(coalesce(t.cache_write_tokens, 0) * p.cache_write_per_mtok / 1000000, 6) as est_cache_write_usd,
    round((
        coalesce(t.input_tokens, 0)       * p.input_per_mtok
      + coalesce(t.output_tokens, 0)      * p.output_per_mtok
      + coalesce(t.cache_read_tokens, 0)  * p.cache_read_per_mtok
      + coalesce(t.cache_write_tokens, 0) * p.cache_write_per_mtok
    ) / 1000000, 6) as est_cost_usd
  from public.chat_transcripts t
  left join public.chat_model_pricing p on p.model = t.model;

-- ---------------------------------------------------------
-- Cost per conversation.
--
--   select * from public.chat_conversation_costs order by est_cost_usd desc;
--
-- Sorting by cost desc answers "what did an expensive conversation look
-- like" — usually a long one, occasionally a cache problem.
-- ---------------------------------------------------------
create or replace view public.chat_conversation_costs
  with (security_invoker = true) as
  select
    session_id,
    count(*)::int          as exchanges,
    sum(est_cost_usd)          as est_cost_usd,
    sum(est_output_usd)        as est_output_usd,
    sum(est_cache_write_usd)   as est_cache_write_usd
  from public.chat_exchange_costs
  group by session_id;

-- ---------------------------------------------------------
-- What the admin Chats tab actually lists: the conversation index from
-- add-chat-transcripts.sql with its cost attached.
-- ---------------------------------------------------------
create or replace view public.chat_conversations_with_cost
  with (security_invoker = true) as
  select
    c.*,
    coalesce(k.est_cost_usd, 0) as est_cost_usd
  from public.chat_conversations c
  left join public.chat_conversation_costs k on k.session_id = c.session_id;

-- ---------------------------------------------------------
-- The monthly bill.
--
--   select * from public.chat_costs_monthly;
--
-- `est_cache_write_usd` is the line to watch. It should be a small fraction of
-- the total: the cached prefix is ~8,200 tokens sent on every single
-- request, so a month where writes rival reads means the cache is being
-- invalidated and you are paying roughly ten times over for the same
-- prompt. See the note in add-chat-quota.sql.
-- ---------------------------------------------------------
create or replace view public.chat_costs_monthly
  with (security_invoker = true) as
  select
    date_trunc('month', created_at)::date        as month,
    count(*)::int                                 as exchanges,
    count(distinct session_id)::int               as conversations,
    round(sum(est_input_usd), 2)                      as est_input_usd,
    round(sum(est_output_usd), 2)                     as est_output_usd,
    round(sum(est_cache_read_usd), 2)                 as est_cache_read_usd,
    round(sum(est_cache_write_usd), 2)                as est_cache_write_usd,
    round(sum(est_cost_usd), 2)                       as est_total_usd,
    round(avg(est_cost_usd), 4)                       as avg_per_exchange_usd
  from public.chat_exchange_costs
  group by 1
  order by 1 desc;

-- ---------------------------------------------------------
-- Same thing by day, for spotting the day something changed.
--
--   select * from public.chat_costs_daily;
-- ---------------------------------------------------------
create or replace view public.chat_costs_daily
  with (security_invoker = true) as
  select
    date_trunc('day', created_at)::date  as day,
    count(*)::int                         as exchanges,
    count(distinct session_id)::int       as conversations,
    round(sum(est_cost_usd), 4)               as est_total_usd,
    round(sum(est_cache_write_usd), 4)        as est_cache_write_usd
  from public.chat_exchange_costs
  where created_at >= now() - interval '90 days'
  group by 1
  order by 1 desc;

-- ---------------------------------------------------------
-- Cost per captured lead — the number that says whether any of this pays.
--
--   select * from public.chat_cost_per_lead;
--
-- Total spend divided by leads captured that month. A blank leads column
-- means the assistant cost money and produced nothing that month, which
-- is worth knowing early rather than at renewal.
-- ---------------------------------------------------------
create or replace view public.chat_cost_per_lead
  with (security_invoker = true) as
  select
    m.month,
    m.conversations,
    m.est_total_usd,
    l.leads,
    case when coalesce(l.leads, 0) > 0
         then round(m.est_total_usd / l.leads, 2)
    end as est_usd_per_lead
  from public.chat_costs_monthly m
  left join (
    select date_trunc('month', created_at)::date as month, count(*)::int as leads
    from public.chat_leads
    group by 1
  ) l on l.month = m.month
  order by m.month desc;

-- =========================================================
-- Reconciliation — estimate vs. what Anthropic actually charged
-- =========================================================
--
-- Everything above is an ESTIMATE: token counts this function recorded,
-- multiplied by published rates. It is arithmetic on our own logs, not a
-- statement from Anthropic. Recording the real figure once a month turns
-- that estimate into something you can trust, or shows you it drifts.
--
-- ⚠️ READ THIS BEFORE COMPARING
-- Your Anthropic bill covers the whole API key, not this chat widget. If
-- the same key is used anywhere else — another app, a script, someone
-- experimenting in the Console — actual will always exceed the estimate
-- and the variance means nothing.
--
-- For the comparison to be meaningful, give the chat function its OWN API
-- key (Console → Settings → API keys) and read that key's usage, not the
-- organization total. Until then, treat actual as an upper bound.
--
-- WHY THIS IS ENTERED BY HAND
-- Anthropic exposes usage and cost through an Admin API, which needs a
-- separate admin key and is not the key this function holds. Automating
-- the pull is a real option later, but it is a different credential and a
-- different endpoint, and I would rather have you typing one number a
-- month than trusting an integration I have not verified against your
-- actual account. One row per month is thirty seconds of work.
-- ---------------------------------------------------------
create table if not exists public.chat_actual_costs (
  -- First day of the month, e.g. 2026-07-01. Matches chat_costs_monthly.
  month       date primary key,
  actual_usd  numeric(12, 2) not null,
  -- Where the number came from, so a future reader knows how much to
  -- trust it: 'console' (usage page), 'invoice' (the actual bill), or
  -- 'admin_api' if this is ever automated.
  source      text not null default 'console',
  -- Set false when the key is shared with other workloads — the variance
  -- is then not a like-for-like comparison and should not be read as
  -- estimate error.
  key_isolated boolean not null default false,
  note        text,
  recorded_at timestamptz not null default now()
);

alter table public.chat_actual_costs enable row level security;

drop policy if exists "editors read actual costs" on public.chat_actual_costs;
create policy "editors read actual costs"
  on public.chat_actual_costs for select
  to authenticated
  using (public.is_editor());

drop policy if exists "editors manage actual costs" on public.chat_actual_costs;
create policy "editors manage actual costs"
  on public.chat_actual_costs for all
  to authenticated
  using (public.is_editor()) with check (public.is_editor());

-- ---------------------------------------------------------
-- Estimate vs actual.
--
--   select * from public.chat_cost_reconciliation;
--
-- Record a month like this:
--
--   insert into public.chat_actual_costs (month, actual_usd, source, key_isolated, note)
--   values ('2026-07-01', 4.18, 'console', true, 'Chat-only API key');
--
-- HOW TO READ variance_pct
--   within a few percent   the estimate is sound; trust it going forward
--   actual much higher     the key is shared, or a rate here is stale
--   actual much lower      usually a rate that has come down since it was
--                          entered, or traffic billed under a discount
--
-- A consistent variance in one direction is worth fixing at the source:
-- correct chat_model_pricing rather than mentally adjusting every figure.
-- ---------------------------------------------------------
create or replace view public.chat_cost_reconciliation
  with (security_invoker = true) as
  select
    m.month,
    m.exchanges,
    m.conversations,
    m.est_total_usd,
    a.actual_usd,
    a.source,
    a.key_isolated,
    round(a.actual_usd - m.est_total_usd, 2)                    as variance_usd,
    case when coalesce(m.est_total_usd, 0) <> 0
         then round(100 * (a.actual_usd - m.est_total_usd) / m.est_total_usd, 1)
    end                                                          as variance_pct
  from public.chat_costs_monthly m
  left join public.chat_actual_costs a on a.month = m.month
  order by m.month desc;
