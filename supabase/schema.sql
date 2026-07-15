-- =========================================================
-- Profiscience — resources schema
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: everything is idempotent.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Lookup tables (so types/subjects are editable data,
--    not hardcoded strings in the frontend)
-- ---------------------------------------------------------
create table if not exists public.article_types (
  slug        text primary key,
  label       text not null,
  sort_order  int  not null default 100
);

create table if not exists public.article_subjects (
  slug        text primary key,
  label       text not null,
  sort_order  int  not null default 100
);

insert into public.article_types (slug, label, sort_order) values
  ('case-study', 'Case Study', 10),
  ('blog',       'Blog',       20),
  ('newsletter', 'Newsletter', 30),
  ('whitepaper', 'Whitepaper', 40),
  ('guide',      'Guide',      50),
  ('webinar',    'Webinar',    60),
  ('playbook',   'Playbook',   70)
on conflict (slug) do update set label = excluded.label, sort_order = excluded.sort_order;

insert into public.article_subjects (slug, label, sort_order) values
  ('legal-cle',    'Legal & CLE', 10),
  ('ai-product',   'AI & Product', 20),
  ('onboarding',   'Onboarding',   30),
  ('integrations', 'Integrations', 40),
  ('compliance',   'Compliance',   50),
  ('research',     'Research',     60)
on conflict (slug) do update set label = excluded.label, sort_order = excluded.sort_order;

-- ---------------------------------------------------------
-- 2. Articles
-- ---------------------------------------------------------
create table if not exists public.articles (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  title        text not null,
  type_slug    text not null references public.article_types(slug)    on update cascade,
  subject_slug text not null references public.article_subjects(slug) on update cascade,
  excerpt      text not null default '',
  body         text,                 -- optional long-form content (markdown/html)
  read_time    text,                 -- e.g. "5 min read"; null = show the type instead
  image_url    text,                 -- public URL from the article-images storage bucket
  image_alt    text,
  pdf_url      text,                 -- optional downloadable asset
  external_url text,                 -- if set, the card links here instead of an internal page
  internal_url text,                 -- e.g. "case-study-verrill.html"
  featured     boolean not null default false,
  status       text    not null default 'draft'
                 check (status in ('draft', 'published', 'archived')),
  sort_order   int     not null default 100,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null
);

-- A card has to link somewhere.
alter table public.articles drop constraint if exists articles_has_a_link;
alter table public.articles add  constraint articles_has_a_link
  check (internal_url is not null or external_url is not null or body is not null);

create index if not exists articles_status_idx    on public.articles (status);
create index if not exists articles_type_idx      on public.articles (type_slug);
create index if not exists articles_subject_idx   on public.articles (subject_slug);
create index if not exists articles_published_idx on public.articles (published_at desc nulls last);

-- Keep updated_at honest.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists articles_touch_updated_at on public.articles;
create trigger articles_touch_updated_at
  before update on public.articles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------
-- 3. Editors — the allowlist that defines who may write.
--    Keyed by email so you can add someone BEFORE they sign up.
-- ---------------------------------------------------------
create table if not exists public.editors (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

-- SECURITY DEFINER so the check itself isn't subject to RLS.
create or replace function public.is_editor()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.editors e
    where lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- >>> Add editors by running this in the Supabase SQL Editor — NOT here. <<<
-- Real addresses are deliberately kept out of this file: GitHub Pages serves
-- every file in the repo, so anything committed here is publicly readable at
-- https://<your-site>/supabase/schema.sql, even from a private repo.
--
-- insert into public.editors (email, note) values
--   ('first.last@profiscience.com', 'owner'),
--   ('someone.else@profiscience.com', 'editor')
-- on conflict (email) do nothing;
--
-- To see who currently has access:  select * from public.editors;

-- ---------------------------------------------------------
-- 4. Row-level security
--    Public: read PUBLISHED articles only.
--    Editors: full control.
--    This is enforced by Postgres, not by the frontend — which is
--    why shipping the anon key in browser JS is safe.
-- ---------------------------------------------------------
alter table public.articles         enable row level security;
alter table public.article_types    enable row level security;
alter table public.article_subjects enable row level security;
alter table public.editors          enable row level security;

drop policy if exists "public reads published articles" on public.articles;
create policy "public reads published articles"
  on public.articles for select
  to anon, authenticated
  using (status = 'published');

drop policy if exists "editors read all articles" on public.articles;
create policy "editors read all articles"
  on public.articles for select
  to authenticated
  using (public.is_editor());

drop policy if exists "editors insert articles" on public.articles;
create policy "editors insert articles"
  on public.articles for insert
  to authenticated
  with check (public.is_editor());

drop policy if exists "editors update articles" on public.articles;
create policy "editors update articles"
  on public.articles for update
  to authenticated
  using (public.is_editor())
  with check (public.is_editor());

drop policy if exists "editors delete articles" on public.articles;
create policy "editors delete articles"
  on public.articles for delete
  to authenticated
  using (public.is_editor());

-- Lookup tables: anyone may read (needed to render filter chips); only editors may change.
drop policy if exists "anyone reads types" on public.article_types;
create policy "anyone reads types"
  on public.article_types for select to anon, authenticated using (true);

drop policy if exists "editors write types" on public.article_types;
create policy "editors write types"
  on public.article_types for all to authenticated
  using (public.is_editor()) with check (public.is_editor());

drop policy if exists "anyone reads subjects" on public.article_subjects;
create policy "anyone reads subjects"
  on public.article_subjects for select to anon, authenticated using (true);

drop policy if exists "editors write subjects" on public.article_subjects;
create policy "editors write subjects"
  on public.article_subjects for all to authenticated
  using (public.is_editor()) with check (public.is_editor());

-- Editors list: only editors can see it. The public must never enumerate staff emails.
drop policy if exists "editors read editors" on public.editors;
create policy "editors read editors"
  on public.editors for select to authenticated using (public.is_editor());

-- Note: no insert/update/delete policy on public.editors, so nobody can grant
-- themselves access through the API. Add editors from the SQL Editor only.

-- ---------------------------------------------------------
-- 5. Image storage
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('article-images', 'article-images', true)
on conflict (id) do update set public = true;

drop policy if exists "anyone views article images" on storage.objects;
create policy "anyone views article images"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'article-images');

drop policy if exists "editors upload article images" on storage.objects;
create policy "editors upload article images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'article-images' and public.is_editor());

drop policy if exists "editors update article images" on storage.objects;
create policy "editors update article images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'article-images' and public.is_editor());

drop policy if exists "editors delete article images" on storage.objects;
create policy "editors delete article images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'article-images' and public.is_editor());

-- ---------------------------------------------------------
-- 6. Newsletter subscribers (see supabase/add-subscribers.sql)
--    Public may INSERT a signup only; editors read/manage the list.
-- ---------------------------------------------------------
create table if not exists public.subscribers (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  name       text,
  company    text,
  status     text not null default 'subscribed'
               check (status in ('subscribed', 'unsubscribed')),
  source     text,
  created_at timestamptz not null default now()
);
create index if not exists subscribers_created_idx on public.subscribers (created_at desc);

create or replace function public.lowercase_subscriber_email()
returns trigger language plpgsql as $$
begin
  new.email = lower(trim(new.email));
  return new;
end $$;

drop trigger if exists subscribers_lowercase_email on public.subscribers;
create trigger subscribers_lowercase_email
  before insert or update on public.subscribers
  for each row execute function public.lowercase_subscriber_email();

alter table public.subscribers enable row level security;

drop policy if exists "anyone can subscribe" on public.subscribers;
create policy "anyone can subscribe"
  on public.subscribers for insert to anon, authenticated with check (true);

drop policy if exists "editors read subscribers" on public.subscribers;
create policy "editors read subscribers"
  on public.subscribers for select to authenticated using (public.is_editor());

drop policy if exists "editors update subscribers" on public.subscribers;
create policy "editors update subscribers"
  on public.subscribers for update to authenticated
  using (public.is_editor()) with check (public.is_editor());

drop policy if exists "editors delete subscribers" on public.subscribers;
create policy "editors delete subscribers"
  on public.subscribers for delete to authenticated using (public.is_editor());

-- ---------------------------------------------------------
-- 7. Seed: the five existing case studies
-- ---------------------------------------------------------
insert into public.articles
  (slug, title, type_slug, subject_slug, excerpt, internal_url, pdf_url, featured, status, sort_order, published_at)
values
  ('steptoe-johnson',
   'Steptoe & Johnson',
   'case-study', 'legal-cle',
   'How a national firm standardizes training and CLE tracking on Profiscience.',
   'case-study-steptoe-johnson.html',
   'assets/case-studies/steptoe-johnson.pdf',
   true, 'published', 10, now()),

  ('verrill-equips-for-growth',
   'Verrill Equips for Growth',
   'case-study', 'onboarding',
   'Scaling onboarding and continuing education as the firm grows.',
   'case-study-verrill.html',
   'assets/case-studies/verrill-equips-for-growth.pdf',
   true, 'published', 20, now()),

  ('wbd-closed-captioning',
   'Womble Bond Dickinson: Closed Captioning at Scale',
   'case-study', 'ai-product',
   'Delivering accessible, captioned video learning across the firm.',
   'case-study-womble-bond-dickinson.html',
   'assets/case-studies/womble-bond-dickinson-closed-captioning.pdf',
   true, 'published', 30, now()),

  ('haynes-boone-sdk-extension',
   'Haynes Boone: Extending the Platform with the SDK',
   'case-study', 'integrations',
   'A look at how the firm tailored Profiscience to its own systems.',
   'case-study-haynes-boone.html',
   'assets/case-studies/haynes-boone-sdk-extension.pdf',
   false, 'published', 40, now()),

  ('bond-schoeneck-king',
   'Bond, Schoeneck & King',
   'case-study', 'legal-cle',
   'Managing attorney CLE and compliance in one place.',
   'case-study-bond-schoeneck-king.html',
   'assets/case-studies/bond-schoeneck-king.pdf',
   false, 'published', 50, now()),

  ('foley-lardner',
   'Foley & Lardner: LinkedIn Learning at Scale',
   'case-study', 'integrations',
   'Running a firm-wide enrichment plan through the LinkedIn Learning Extension — 90% participation.',
   'case-study-foley-lardner.html',
   'assets/case-studies/foley-lardner-lil-extension.pdf',
   false, 'published', 60, now())
on conflict (slug) do nothing;
