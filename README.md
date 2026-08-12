# Profiscience website

Static marketing site for profiscience.com, plus three things that are not static:

| Piece | What it is | Lives in |
|---|---|---|
| **The site** | Hand-written HTML/CSS/JS. No build step — the `.html` files in this folder are what ships. | repo root |
| **The assistant** | The chat widget, bottom-right of every page. Answers product questions and captures leads into Pipedrive. | `supabase/functions/chat/` |
| **The admin** | Password-protected page for editing resources, viewing subscribers, and reading chat transcripts. | `admin/` |

Data lives in Supabase (Postgres). There is no server to maintain — the two
"backend" pieces are Supabase Edge Functions.

---

## ⚠️ Read this first: account ownership

As of July 2026, several things this site depends on are under a personal
account rather than a company one. **This is the most important open item
in the project**, ahead of any feature work.

| Service | Owner | Risk if that person is unavailable |
|---|---|---|
| GitHub `barsh/profiscience-site` | Personal | Company cannot deploy or change the site if the account holder is unavailable |
| Supabase project `rqkbjvyxhdknbjhaszya` | Check the dashboard | Loses leads, subscribers, and chat transcripts — **real customer data** |
| Anthropic (AI billing) | Personal, personal card | Chat stops when the card fails |
| Pipedrive `profiscience.pipedrive.com` | Company ✅ | — |

Moving these is account admin, not engineering. The application code changes
in exactly one place — the Anthropic API key is a single Supabase secret.

**When the GitHub repo moves to a company organization**, four things need
updating in the same session or the site breaks quietly:

1. `git remote set-url origin <new url>`
2. The `repository` field in `package.json`
3. `.github/workflows/supabase-keepalive.yml` — its self-heal commit pushes to the repo
4. `ALLOWED_ORIGIN` in Supabase secrets — the GitHub Pages URL changes with the account name, and the chat widget goes silent if it isn't updated

---

## Tools you need

Only required for deploying the assistant or running database changes.
Editing the site's HTML needs none of them.

| Tool | For | Install |
|---|---|---|
| **Supabase CLI** | Deploying functions, setting secrets | `npm i -g supabase` or [docs](https://supabase.com/docs/guides/cli) |
| **Deno** | Typechecking and running the functions locally (optional) | `winget install DenoLand.Deno` |
| **Node** | The knowledge-base extractor script (optional) | [nodejs.org](https://nodejs.org) |

Docker is **not** needed. `supabase functions serve` asks for it, but Deno
runs the functions directly — see [Running locally](#running-the-assistant-locally).

---

## Deploying the website

The site is plain files. Whatever hosts it, deploying means publishing the
repo contents — there is nothing to compile.

The current GitHub Pages host and the planned `www.profiscience.com` cutover
are documented in [`docs/domain-cutover.md`](docs/domain-cutover.md). Keep the
Supabase CORS change in the same deployment window as any host change.

`web.config` at the root holds the IIS redirect rules that keep the old
`.aspx` URLs working. See `migration/URL-MIGRATION.md` for the full
old-to-new URL map and what is still outstanding.

---

## Deploying the assistant

From the repo root:

```powershell
supabase functions deploy chat
```

That is the whole deployment. It uploads `supabase/functions/chat/`
(both `index.ts` and `knowledge.ts`) and is live within seconds.

**It deploys your working files, not your commits** — whatever is on disk
goes up, committed or not. Commit afterwards so what is running matches
what is in GitHub.

**Run the database changes first** (below) if any are outstanding. The
function writes columns that must already exist.

### Verify it worked

```powershell
curl.exe -s https://rqkbjvyxhdknbjhaszya.supabase.co/functions/v1/chat `
  -H "content-type: application/json" `
  -d '{\"session_id\":\"deploy-check\",\"messages\":[{\"role\":\"user\",\"content\":\"What is CLESite?\"}]}'
```

A sensible answer means it is live. Then:

```powershell
supabase functions logs chat
```

Look for `[chat] cache read=… write=…`. The first request after a deploy
writes; every one after should read. See [Costs](#costs).

---

## Database setup

Run these in the **Supabase SQL Editor** (Dashboard → SQL Editor → New
query). Every file is idempotent — re-running is always safe, and is how
you apply changes.

**Order matters.** Each depends on the ones above it:

| # | File | What it creates |
|---|---|---|
| 1 | `supabase/schema.sql` | Foundation: articles, the `editors` allowlist, and `is_editor()` — everything else needs this |
| 2 | `supabase/add-subscribers.sql` | Newsletter signups |
| 3 | `supabase/add-unsubscribe.sql` | Unsubscribe handling |
| 4 | `supabase/add-chat-leads.sql` | Leads captured by the assistant |
| 5 | `supabase/add-chat-quota.sql` | Rate limits and the daily spend ceiling |
| 6 | `supabase/add-chat-transcripts.sql` | Conversation log and the admin review views |
| 7 | `supabase/add-chat-costs.sql` | Cost estimates and reconciliation |

The remaining `supabase/*.sql` files are one-off content imports, not setup.

### Granting someone admin access

The admin panel checks an allowlist. Add the person's email to
`public.editors`, then have them sign up in Supabase Auth with that same
address:

```sql
insert into public.editors (email) values ('someone@profiscience.com');
```

---

## Secrets

Set with `supabase secrets set NAME=value`, and list with
`supabase secrets list` (values are hidden). These live server-side only —
none of them are ever sent to a browser.

| Secret | Required | What it is |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | Pays for the assistant. Console → Settings → API keys |
| `ALLOWED_ORIGIN` | **Yes** | Comma-separated list of sites allowed to call the functions |
| `PIPEDRIVE_API_TOKEN` | No | Pushes leads to the CRM. Without it, leads are still saved in Supabase |
| `ANTHROPIC_ADMIN_KEY` | No | Cost reporting only. Requires an **organization** account |
| `ANTHROPIC_WORKSPACE_ID` | No | Scopes cost reporting to the chat widget alone |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
injected automatically — do not set them.

### About `ALLOWED_ORIGIN`

An origin is **scheme + host + port, never a path**. A trailing
`/profiscience-site` will never match and the widget fails silently.

```
ALLOWED_ORIGIN=https://www.profiscience.com,https://profiscience.com,https://new.profiscience.com,https://barsh.github.io,https://andrewster05.github.io,http://localhost:3000
```

`localhost` and `127.0.0.1` are different origins to a browser. Keep the
production domain first — it is the fallback when nothing matches.

### About the service-role key

`SUPABASE_SERVICE_ROLE_KEY` (and the newer `sb_secret_…` form) bypasses
every security policy in the database. It belongs in Supabase secrets and
a password manager — **never** in this repo, a workflow file, or browser
code. The `sb_publishable_…` key committed in the keep-alive workflow is a
different key and is public by design.

---

## The admin panel

Open `admin/index.html` over **http**, not by double-clicking the file —
`file://` sends a null origin that the security rules reject. If you are
serving the site locally, `npx serve .` then `http://localhost:3000/admin/`.

Sign in with a Supabase Auth account whose email is in `public.editors`.

| Tab | What it does |
|---|---|
| **Resources** | Create and edit articles on the resources page |
| **Subscribers** | Newsletter list, with CSV export |
| **Chats** | Every conversation with the assistant |

### The Chats tab

Lists conversations newest-first with the opening question, turn count,
estimated cost, and whether it produced a lead. Filter by period, by
outcome, or search — search covers every message in every conversation,
not just the first.

Open a row for the full transcript. If a lead was captured you also get
their details and an **Open in Pipedrive** button.

A conversation is now kept in the visitor's browser, so one row can span a
refresh, several pages, and a return visit days later — expect longer
transcripts with gaps in the timestamps rather than a string of one-turn
conversations. A new row starts when they click **New chat**, clear their
site data, or leave it alone for 30 days.

**Delete conversation** removes the transcript and its lead together. The
Pipedrive record is not touched.

⚠️ Transcripts contain whatever visitors typed — names, work emails, firm
names. Retention is not automatic. Decide on a window and run
`select public.chat_purge_transcripts(90);` periodically, or schedule it.
This is also the thing a privacy policy would need to describe.

---

## Changing what the assistant knows

Everything factual the assistant can say lives in one file:
**`supabase/functions/chat/knowledge.ts`**. It is plain English, not code.
Edit it, run `supabase functions deploy chat`, and the change is live.

Two rules that matter more than they look:

1. **Never add a statistic, customer name, or price.** The file lists what
   is off-limits and why. The assistant is deliberately vague about
   company size and never quotes a figure.
2. **Removing something does not make the assistant say "no".** It makes it
   hand off to a human. The assistant is instructed never to deny a
   capability it has no information about, because a false "we don't do
   that" sends a real prospect to a competitor and nobody ever finds out.

The site's own pages are the source. To re-extract them for review:

```powershell
node scripts/build-knowledge.mjs
```

That writes `scripts/extracted.txt` and flags anything unquotable.
`node scripts/build-knowledge.mjs --check` fails if the site has changed
since the knowledge base was last reviewed — useful before a release.

---

## Costs

The assistant costs a few dollars a day at most. Two safeguards:

- **A hard daily cap** — 150 requests, set in `add-chat-quota.sql`. Past
  that the widget politely refers people to email for the rest of the day.
- **Prompt caching** — the assistant's ~8,200-token briefing is billed at
  a tenth of the normal rate after the first request each hour.

In the admin, the Chats tab header shows estimated spend this month. In
SQL:

```sql
select * from public.chat_costs_monthly;      -- the monthly bill
select * from public.chat_cost_per_lead;      -- spend per lead captured
select * from public.chat_denials_recent;     -- assistant said no when it shouldn't have
select * from public.chat_handoffs_recent;    -- questions it couldn't answer
```

These are **estimates** — our own token counts times Anthropic's published
rates. The authority is the Anthropic bill. Record the real monthly figure
into `chat_actual_costs` and `chat_cost_reconciliation` shows the variance.
See the comments in `add-chat-costs.sql`.

---

## When something is wrong

| Symptom | Cause | Fix |
|---|---|---|
| "Chat is unavailable right now." | Daily cap hit, or the database is unreachable | Check `select * from public.chat_usage_today;`. If the cap is the issue, raise `p_per_day_global` in `add-chat-quota.sql` and re-run it |
| "You're sending messages faster than I can answer" | Per-visitor burst limit | Normal. Self-clears in a minute |
| Widget does nothing on the live site | `ALLOWED_ORIGIN` does not list that site | Add the origin (no path!) and redeploy both functions |
| Assistant invents limitations, or says "I don't know" | Missing information | Read `chat_denials_recent` and `chat_handoffs_recent`, then add the facts to `knowledge.ts` |
| Assistant quotes a price or a statistic | Guardrail regression | Should never happen. Check the "Never state" section of `knowledge.ts` |
| Costs higher than expected | Prompt cache being invalidated | `select * from public.chat_cache_health;` — writes should be a small fraction of reads |
| Admin shows no data after signing in | Email not in `public.editors` | Add it (see [Database setup](#database-setup)) |
| Sync actual button fails | `sync-costs` not deployed, or CORS | Optional feature — see the notes in `supabase/functions/sync-costs/index.ts` |

Logs for either function:

```powershell
supabase functions logs chat
supabase functions logs sync-costs
```

---

## Running the assistant locally

Optional, and useful before deploying a knowledge-base change.

Docker is not required. Create `.env.local` in the repo root (already
gitignored) with `ANTHROPIC_API_KEY`, `SUPABASE_URL`, and
`SUPABASE_SERVICE_ROLE_KEY`. Leave `PIPEDRIVE_API_TOKEN` out so test
conversations cannot create real CRM leads.

Add `ALLOWED_ORIGIN` too if you want to use the **widget** rather than
curl — e.g. `ALLOWED_ORIGIN=http://localhost:3000`, matching whatever
port you are serving the site on. Without it the function answers with
`Access-Control-Allow-Origin: null`, the browser blocks the reply, and
the panel says *"I couldn't reach the server"* — the same message it
shows when nothing is listening at all. curl ignores CORS, so the test
below passes while the widget stays broken.

```powershell
deno check --node-modules-dir=none supabase/functions/chat/index.ts
deno run -A --node-modules-dir=none --env-file=.env.local supabase/functions/chat/index.ts
```

It listens on **port 8000**. Test it:

```powershell
curl.exe -s http://localhost:8000 `
  -H "content-type: application/json" `
  -d '{\"session_id\":\"local-test\",\"messages\":[{\"role\":\"user\",\"content\":\"Do you track CPD for our Australian offices?\"}]}'
```

This points at the **production** database, so test rows land in the real
tables. Clean up afterwards:

```sql
delete from public.chat_transcripts where session_id = 'local-test';
```
