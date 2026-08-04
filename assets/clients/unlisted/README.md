# Unlisted client logos

These firms were on the website but are **not** on the current Cloud Report, so
they were pulled from the live site (clients grid, homepage logo ticker, and the
legacy trust strip). Their logo files are parked here so they can be restored
quickly if a firm returns.

**To restore a firm:**
1. Move its logo file back to `assets/clients/` (e.g. `git mv assets/clients/unlisted/bracewell.png assets/clients/`).
2. Paste its card back into the `#clientsGrid` in `clients.html` (add a `data-region`).
3. Optionally add its entry back to `TICKER_LOGOS` in `js/main.js`.

Ready-to-paste snippets are in `unlisted-snippets.html` (paths there already
point at this folder, so they render as-is if you just need them temporarily).

## Firms parked here
| Firm | File | Why removed |
|---|---|---|
| Baker Donelson | bakerdonelson.png | not on report (report has BakerHostetler) |
| Bracewell | bracewell.png | not on report |
| Burns & Levinson | burns.PNG | not on report (report has Burns White) |
| Choate Hall & Stewart | choate.PNG | not on report |
| Godfrey & Kahn | Godfrey_Kahn.jfif | not on report |
| Hogan Lovells | Hogan_Lovells.png | not on report |
| Kessler Collins | kessler.png | not on report (report has Kessler Topaz) |
| Loeb & Loeb | Loeb_Loeb.jfif | not on report |
| Murtha Cullina | murtha.png | not on report |
| Piper Sandler | piper.png | not on report (report has Piper Alderman) |
| Pitcher Partners | pitcher.png | not on report |
| Sills Cummis & Gross | sills.PNG | not on report |
| Stites & Harbison | stites.png | not on report |
