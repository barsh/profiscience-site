-- =========================================================
-- One-off: remove duplicate chat leads (one conversation, many lead rows)
-- Run in the Supabase SQL Editor AFTER the fixed chat Edge Function is
-- deployed and add-chat-transcripts.sql has been re-run.
--
-- Background: the chat agent called capture_lead each time a visitor
-- added a detail, and each call inserted a new chat_leads row (and pushed
-- a new Pipedrive lead). The admin Chats tab then listed that conversation
-- once per lead row. The Edge Function now updates the existing lead, and
-- the chat_conversations view shows at most one lead per conversation.
-- This file cleans up the rows already written and then makes the rule
-- a database constraint.
--
-- Rule: per session_id, keep the NEWEST row (the most complete details),
-- carrying over the Pipedrive id from an older synced row if the newest
-- one doesn't have it. Delete the rest. Transcripts are not touched.
--
-- Run step 1 first and check what it shows. Steps 2–3 change data.
-- =========================================================

-- 1. PREVIEW — which conversations have duplicates, and which row is kept.
select
  session_id,
  id,
  name,
  work_email,
  created_at,
  pipedrive_synced,
  pipedrive_lead_id,
  row_number() over (partition by session_id order by created_at desc) = 1 as keep
from public.chat_leads
where session_id in (
  select session_id from public.chat_leads
  where session_id is not null
  group by session_id having count(*) > 1
)
order by session_id, created_at desc;

-- 2. CLEANUP — in one transaction.
begin;

-- Carry the Pipedrive link onto the row being kept, if it lacks one.
update public.chat_leads keep
set pipedrive_lead_id = src.pipedrive_lead_id,
    pipedrive_synced  = true
from (
  select distinct on (session_id) session_id, pipedrive_lead_id
  from public.chat_leads
  where session_id is not null and pipedrive_lead_id is not null
  order by session_id, created_at desc
) src
where keep.session_id = src.session_id
  and keep.pipedrive_lead_id is null
  and keep.id = (
    select id from public.chat_leads x
    where x.session_id = keep.session_id
    order by created_at desc limit 1
  );

delete from public.chat_leads d
using (
  select id,
         row_number() over (partition by session_id order by created_at desc) as rn
  from public.chat_leads
  where session_id is not null
) r
where d.id = r.id and r.rn > 1;

commit;

-- 3. GUARD — one lead per conversation from now on. Fails if step 2
-- hasn't removed every duplicate, which is the point.
create unique index if not exists chat_leads_session_unique
  on public.chat_leads (session_id)
  where session_id is not null;
