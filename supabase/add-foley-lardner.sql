-- Add the Foley & Lardner case study to the live resources list.
-- Run once in the Supabase SQL Editor. (Or add it via the admin "New resource"
-- form instead — this is just the faster path.)
insert into public.articles
  (slug, title, type_slug, subject_slug, excerpt, internal_url, pdf_url, featured, status, sort_order, published_at)
values
  ('foley-lardner',
   'Foley & Lardner: LinkedIn Learning at Scale',
   'case-study', 'integrations',
   'Running a firm-wide enrichment plan through the LinkedIn Learning Extension — 90% participation.',
   'case-study-foley-lardner.html',
   'assets/case-studies/foley-lardner-lil-extension.pdf',
   false, 'published', 60, now())
on conflict (slug) do nothing;
