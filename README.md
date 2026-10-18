# luckielynx.com

The LuckieLynx website: landing page, accounts, tester codes, downloads and admin.

- **Hosting:** Cloudflare Worker (`luckielynx`). It serves the built site in `site/` and runs `worker/index.js` for `/api/*`.
- **Accounts and data:** Supabase (Stockholm). Sign-up, sign-in, profiles, tester access, codes.
- **Game builds:** Cloudflare R2 bucket `luckielynx-builds`, downloaded through `/api/file` with 10-minute links.
- **Email:** Resend, sending as noreply@luckielynx.com.

## Pages

| Path | What it is |
|---|---|
| `/` | Landing page, sign-up, sign-in, account panel, tester code box |
| `/download` | Builds for signed-in testers with access |
| `/admin` | Admin only: open/close phases, set codes, builds, testers |
| `/api/file?t=…` | Streams a build from R2 if the token is valid |

## Editing the site

All page sources live outside `site/`:

- `template.html`: the landing page, its styles and the main script
- `pages/`: download and admin page bodies and scripts (`common.js` is shared)
- `faq.json`: FAQ text (also used for Google structured data)
- `worker/index.js`: the download service

After editing, run `python3 build.py` (needs Pillow) to regenerate `site/`, then commit and push. Cloudflare redeploys on every push to `main`.

## One-time setup

1. **Supabase SQL:** run `supabase/schema.sql`, then `supabase/access.sql` in the SQL Editor.
2. **Make yourself admin:** in the SQL Editor run
   `update public.profiles set is_admin = true where lower(username) = lower('YOUR_USERNAME');`
3. **R2:** in Cloudflare, open R2, finish the free sign-up, and create a bucket named `luckielynx-builds`.
4. **Deploys:** in Cloudflare, open the `luckielynx` Worker, go to Settings → Build, and connect this GitHub repo. Deploy command: `npx wrangler deploy`.

## Releasing a build to testers

1. Upload the build (for example a .zip) to the `luckielynx-builds` bucket, inside a folder per phase: `beta/LuckieLynx-Beta-0.1.zip`.
2. On `/admin`, open the phase, enter that path under **Build file in R2**, add a build name and notes, and save.
3. Generate a code, optionally limit uses or set an end date, save, and send the code to your testers.

Testers enter the code in the box on the home page or on `/download`, and the download appears for them.
