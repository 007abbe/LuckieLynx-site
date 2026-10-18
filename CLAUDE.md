# Working on luckielynx-site

**Never push to `main` (or merge anything into it) without Abbe's explicit approval in the chat.**
Every push to `main` deploys luckielynx.com straight away. Make the change, show it (preview or screenshots)
and wait for a clear "push it" / "go live" before pushing.

## How the repo works

- Sources: `template.html` (landing page), `pages/` (download and admin pages), `faq.json`, `worker/index.js`.
- `site/` is the built output and is committed. After any source change run `python3 build.py` (needs Pillow),
  then commit `site/` together with the sources.
- Cloudflare Workers Builds deploys on push to `main` with `npx wrangler deploy`. Its build command is empty on purpose.
- Supabase SQL lives in `supabase/`; it is run by hand in the Supabase SQL Editor, never automatically.
- Do not put the Supabase service_role key or any other secret in this repo. The anon key in `wrangler.jsonc`
  and `site/assets/` is public by design.
