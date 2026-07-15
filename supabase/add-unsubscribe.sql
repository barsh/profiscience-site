-- =========================================================
-- Public unsubscribe support for the CLE Corner / newsletter.
-- Run once in Supabase → SQL Editor.
--
-- WHY A FUNCTION: row-level security lets the public (anon) role only INSERT
-- into `subscribers` — it cannot UPDATE. This SECURITY DEFINER function runs
-- as the owner, so the unsubscribe page can flip a single row to
-- 'unsubscribed' by email without opening up UPDATE on the whole table.
-- It only ever sets status (no reads, no deletes), so it's safe to expose.
-- =========================================================

create or replace function public.unsubscribe(p_email text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.subscribers
     set status = 'unsubscribed'
   where email = lower(trim(p_email));
$$;

-- Only allow calling it; nobody gets table-level rights from this.
revoke all on function public.unsubscribe(text) from public;
grant execute on function public.unsubscribe(text) to anon, authenticated;
