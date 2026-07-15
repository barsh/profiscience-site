-- Set the client logo as each case study's card image.
-- Run once in the Supabase SQL Editor. Logos already live in the repo under
-- assets/clients/, so no upload is needed — we just point image_url at them.
update public.articles set image_url = 'assets/clients/steptoe.png',      image_alt = 'Steptoe & Johnson logo'       where slug = 'steptoe-johnson';
update public.articles set image_url = 'assets/clients/verrill.png',      image_alt = 'Verrill logo'                 where slug = 'verrill-equips-for-growth';
update public.articles set image_url = 'assets/clients/womble.png',       image_alt = 'Womble Bond Dickinson logo'   where slug = 'wbd-closed-captioning';
update public.articles set image_url = 'assets/clients/Haynes_Boone.png', image_alt = 'Haynes Boone logo'            where slug = 'haynes-boone-sdk-extension';
update public.articles set image_url = 'assets/clients/Bond_Logo.jfif',   image_alt = 'Bond, Schoeneck & King logo'  where slug = 'bond-schoeneck-king';
update public.articles set image_url = 'assets/clients/foley-lardner.svg',image_alt = 'Foley & Lardner logo'         where slug = 'foley-lardner';
