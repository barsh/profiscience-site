# Domain cutover runbook

## Current temporary host

GitHub Pages is currently configured for `new.profiscience.com`. The repository's
root `CNAME` file is the source-controlled record of that setting. EasyDNS must
publish:

```text
new  CNAME  barsh.github.io.
```

Wait for GitHub Pages to issue the certificate before enabling **Enforce HTTPS**.
The Pages API reports `https_enforced: true` only after the certificate exists.

## Planned production host

The intended canonical host is `https://www.profiscience.com`; the apex
`https://profiscience.com` should redirect to it. The HTML canonical tags,
Open Graph URLs, `robots.txt`, and `sitemap.xml` already use the intended
`www` host, so do not change them during the temporary `new` phase.

Do not repoint the current production DNS records until the temporary host has
been accepted and a cutover window is agreed.

## Cutover checklist

1. In GitHub Pages, change the custom domain from `new.profiscience.com` to
   `www.profiscience.com`. GitHub updates the root `CNAME` file; pull that
   commit locally so the repository remains in sync.
2. In EasyDNS, create `www` as a CNAME to `barsh.github.io.`.
3. Point the apex `profiscience.com` to GitHub Pages using all four A records:

   ```text
   185.199.108.153
   185.199.109.153
   185.199.110.153
   185.199.111.153
   ```

   If EasyDNS supports it, also add GitHub Pages' IPv6 AAAA records:

   ```text
   2606:50c0:8000::153
   2606:50c0:8001::153
   2606:50c0:8002::153
   2606:50c0:8003::153
   ```

4. Wait for DNS propagation and for GitHub Pages to issue a certificate, then
   enable **Enforce HTTPS** in Pages.
5. Update the Supabase Edge Function secret `ALLOWED_ORIGIN` before testing
   chat from the new host. Preserve the temporary and legacy hosts until they
   are intentionally retired:

   ```text
   https://www.profiscience.com,https://profiscience.com,https://new.profiscience.com,https://barsh.github.io,https://andrewster05.github.io,http://localhost:3000
   ```

6. Verify `https://www.profiscience.com/`,
   `https://profiscience.com/`, `https://www.profiscience.com/robots.txt`,
   `https://www.profiscience.com/sitemap.xml`, and a real chat request from a
   browser. Confirm the apex redirects to `www` and that the final URL is HTTPS.
7. Only after the new production host is accepted, remove temporary and legacy
   origins from `ALLOWED_ORIGIN`, retire `new.profiscience.com` if desired, and
   remove any obsolete DNS records.

## Chat dependency

The chat endpoint is not configured through GitHub Actions. It is a Supabase
Edge Function that performs exact CORS matching against its server-side
`ALLOWED_ORIGIN` secret. A GitHub Pages domain change therefore requires the
Supabase secret update in the same deployment window.
