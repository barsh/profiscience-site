-- A sample inline blog post, to see the write-in-the-admin flow end to end.
-- Run in the SQL Editor, then open the resources page — the card links to
-- post.html?slug=sample-blog-post with no HTML file involved.
-- Delete it when you're done:  delete from public.articles where slug = 'sample-blog-post';
insert into public.articles
  (slug, title, type_slug, subject_slug, excerpt, body, featured, status, sort_order, published_at)
values
  ('sample-blog-post',
   'What great legal onboarding looks like in 2026',
   'blog', 'onboarding',
   'A quick field guide to onboarding new attorneys without drowning them in day-one training.',
   $md$
## Start before day one

The best onboarding begins the week **before** a new hire badges in. A short,
self-paced welcome plan — culture, tooling, and a few must-know policies —
turns day one from a firehose into a conversation.

## Keep required training visible

Compliance slips when it's invisible. Surface each person's outstanding items
where they already look, and completion takes care of itself.

- Assign a role-based learning plan on day one
- Automate reminders instead of chasing people
- Track completion in one place

## Measure what matters

If you can't see progress, you can't improve it. Pick two or three metrics —
time-to-productive, completion rate, and satisfaction — and review them monthly.

> Onboarding isn't an event. It's the first 90 days of a relationship.
$md$,
   false, 'published', 5, now())
on conflict (slug) do nothing;
