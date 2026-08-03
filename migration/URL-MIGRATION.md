# Migration to profiscience.com — URL & launch checklist

**Short answer to "will the old URLs still work?": No — not by themselves.**
The old site is ASP.NET and every page is a `.aspx` URL. The new site is static
`.html`. Nothing maps automatically, so every old link (Google results, the printed
book's links, LinkedIn, bookmarks, emails) will 404 unless we add **301 redirects**.
The redirect rules below fix that.

---

## 1. Old → New redirect map

| Old URL | New URL | Notes |
|---|---|---|
| `/` | `/` (index.html) | unchanged |
| `/products.aspx` | `/features.html` | |
| `/products.aspx#universitysite` | `/features.html` | anchor dropped |
| `/products.aspx#clesite` | `/features.html#cle` | |
| `/about.aspx` | `/about.html` | |
| `/about.aspx#team` | `/about.html#leadership` | |
| `/contact.aspx` | `/contact.html` | |
| `/request-demo.aspx` | `/contact.html` | discovery-call form lives here now |
| `/testimonials.aspx` | `/clients.html#what-clients-say` | |
| `/support` | `/support.html` | |
| `/stay-clever-book` and `/stay-clever-book/` | `/stay-clever.html` | |
| `/stay-clever-book/chapter0.aspx` … `chapter14.aspx` | `/stay-clever.html` | chapters are now accordions on one page |
| `/stay-clever-book/cle-corner` | `/stay-clever.html#the-cle-corner` | CLE Corner signup is the popup here |
| `/opt-in.aspx` | `/stay-clever.html#the-cle-corner` | old newsletter subscribe |
| `/CaseStudies/*.pdf` | keep serving, or → matching `/case-study-*.html` | see §3 |

| `/opt-out.aspx` | `/unsubscribe.html` | ✅ built |

### Decisions (resolved)
- **Host = IIS on a VM.** The redirects are live in **`/web.config`** at the repo root — it
  deploys with the site. Requires the IIS **URL Rewrite** module installed on the VM.
- **Unsubscribe** — ✅ built (`/unsubscribe.html` + `supabase/add-unsubscribe.sql`).
- **`/members/login.aspx`** — no login on the new site, so it is **not** redirected (left as-is).

- **`/CaseStudies/*.pdf`** — ✅ redirected to the matching `case-study-*.html`
  (ScormFly / "UniversitySite Return to US" have no page, so they land on `/clients.html`).

### Still open
- **`/UniversitySite-Public-API-Documentation`** — the Integrations page links to this old
  URL. It must still resolve after cut-over (keep the page or redirect it).

---

## 2. Redirect config (pick the one matching the host)

### If staying on IIS (current host) — `web.config` at the site root
```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="products-cle" stopProcessing="true">
          <match url="^products\.aspx$" />
          <action type="Redirect" url="/features.html" redirectType="Permanent" />
        </rule>
        <rule name="about" stopProcessing="true">
          <match url="^about\.aspx$" />
          <action type="Redirect" url="/about.html" redirectType="Permanent" />
        </rule>
        <rule name="contact" stopProcessing="true">
          <match url="^(contact|request-demo)\.aspx$" />
          <action type="Redirect" url="/contact.html" redirectType="Permanent" />
        </rule>
        <rule name="testimonials" stopProcessing="true">
          <match url="^testimonials\.aspx$" />
          <action type="Redirect" url="/clients.html#what-clients-say" redirectType="Permanent" />
        </rule>
        <rule name="book-chapters" stopProcessing="true">
          <match url="^stay-clever-book/chapter[0-9]+\.aspx$" />
          <action type="Redirect" url="/stay-clever.html" redirectType="Permanent" />
        </rule>
        <rule name="book-cle-corner" stopProcessing="true">
          <match url="^stay-clever-book/cle-corner/?$" />
          <action type="Redirect" url="/stay-clever.html#the-cle-corner" redirectType="Permanent" />
        </rule>
        <rule name="book" stopProcessing="true">
          <match url="^stay-clever-book/?$" />
          <action type="Redirect" url="/stay-clever.html" redirectType="Permanent" />
        </rule>
        <rule name="opt-in" stopProcessing="true">
          <match url="^opt-in\.aspx$" />
          <action type="Redirect" url="/stay-clever.html#the-cle-corner" redirectType="Permanent" />
        </rule>
        <!-- TODO: opt-out.aspx -> /unsubscribe.html once that page exists -->
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
```

### If moving to Netlify / Cloudflare Pages — `_redirects` at the site root
```
/products.aspx                       /features.html            301
/about.aspx                          /about.html               301
/contact.aspx                        /contact.html             301
/request-demo.aspx                   /contact.html             301
/testimonials.aspx                   /clients.html#what-clients-say 301
/stay-clever-book                    /stay-clever.html         301
/stay-clever-book/                   /stay-clever.html         301
/stay-clever-book/cle-corner         /stay-clever.html#the-cle-corner 301
/stay-clever-book/chapter*.aspx      /stay-clever.html         301
/opt-in.aspx                         /stay-clever.html#the-cle-corner 301
# /opt-out.aspx                      /unsubscribe.html         301   # once it exists
```

---

## 3. Open gaps to close before launch
1. **Unsubscribe page** — add `/unsubscribe.html` (or an opt-out flow) so newsletter emails
   have a working unsubscribe. The `subscribers` table already has a `status` column
   (`subscribed` / `unsubscribed`) ready for it.
2. **Case-study PDFs** — the old site linked directly to `/CaseStudies/*.pdf`. The new repo
   has PDFs under `assets/case-studies/` with different filenames. Either keep the old PDF
   URLs served, or redirect each to its `case-study-*.html` page.
3. **API docs link** — confirm `/UniversitySite-Public-API-Documentation` survives cut-over.
4. **LMS login** — confirm where `members/login.aspx` should point after launch.

---

## 4. Forms (your action items)
All three forms are built and wired; they need the live host + Supabase to verify end-to-end:
- **Discovery-call form** — Pipedrive web-form embed on `contact.html`. Test after deploy.
- **Free-copy form** & **Join The CLE Corner** — both write to the Supabase `subscribers`
  table (differentiated by `source`: `stay-clever-free-copy` vs `cle-corner`). They need
  `supabase/add-subscribers.sql` to have been run once (it has, since the newsletter works).

## 5. Subscriber import → see `supabase/import-subscribers.sql`
