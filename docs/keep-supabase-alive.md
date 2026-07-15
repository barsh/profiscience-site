# Keeping Supabase alive

The resources page and the admin load their data from a **free-tier Supabase**
project. Free projects **pause after ~1 week of inactivity**, and a paused
project means the resources page can't load. This doc explains how we keep it
awake, and how to make that bulletproof.

"Activity" means a query hitting the database. Real site traffic barely counts —
loading the homepage doesn't query Supabase, and even a visit to the resources
page only queries it when a real browser runs the JavaScript. So we don't rely
on traffic; we ping the database on a schedule.

## We use two independent mechanisms

Either one alone keeps the project live. Running both means one can fail
silently and the project still never pauses.

### 1. GitHub Action (already set up, no maintenance)

`.github/workflows/supabase-keepalive.yml` runs daily on GitHub's servers,
queries the database, and self-heals so GitHub never auto-disables it. Nothing
to configure. Confirm it's healthy once: repo → **Actions** tab → **Supabase
keep-alive** → **Run workflow**, and check it goes green.

This keeps working after the site moves to profiscience.com, because it talks to
Supabase directly and doesn't depend on the website. Its only dependency is that
**this repo stays on GitHub.** If the repo is ever deleted or abandoned, set up
mechanism 2.

### 2. External pinger (independent backup — 5-minute setup)

This runs on a third-party service, so it survives even if the GitHub repo goes
away. Recommended: [cron-job.org](https://cron-job.org) (free).

Create one cron job with these exact settings:

- **URL**
  ```
  https://rqkbjvyxhdknbjhaszya.supabase.co/rest/v1/articles?select=id&limit=1
  ```
- **Schedule:** once a day (any time)
- **Request method:** GET
- **Custom request headers** (add both):
  ```
  apikey: sb_publishable_Y-lJeRmMpUi3Xd13_psUtg_GHpjkDWf
  Authorization: Bearer sb_publishable_Y-lJeRmMpUi3Xd13_psUtg_GHpjkDWf
  ```
- **Expected result:** HTTP 200. cron-job.org can email you if it ever fails —
  turn that on, and a paused project becomes something you hear about, not
  something you discover from a broken page.

The key above is the **public** publishable key (same one committed in
`js/supabase-config.js`). It's safe to paste into a third-party service —
row-level security is what protects the data. Never use the `service_role` /
secret key here.

Any equivalent works too: UptimeRobot, Better Uptime, Pingdom, an Azure
Function timer, or a cron line on any server you control:

```
0 6 * * * curl -s "https://rqkbjvyxhdknbjhaszya.supabase.co/rest/v1/articles?select=id&limit=1" -H "apikey: sb_publishable_Y-lJeRmMpUi3Xd13_psUtg_GHpjkDWf" > /dev/null
```

## The only zero-maintenance guarantee: don't use the free tier

Every free-tier keep-alive is a workaround for the pause policy. The one option
with **no pinger and no caveats** is Supabase's **Pro plan (~$25/month)**, where
projects never pause. If this database is business-critical, that removes the
entire class of problem — no workflow to stay enabled, no third-party pinger to
keep configured. Worth it once the site is the real profiscience.com.
