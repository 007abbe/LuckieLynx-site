"""Build the LuckieLynx site from template.html.

  python3 build.py

Outputs
  site/          the real website for Cloudflare Pages (talks to Supabase)
  preview.html   single-file design preview with a demo login (no Supabase calls)
"""
import base64, json, pathlib, re, shutil

ROOT = pathlib.Path(__file__).parent
SB_URL = "https://qeslzsokehipmemjfcva.supabase.co"
SB_KEY = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlc2x6c29rZWhpcG1lbWpmY3ZhIiwi"
          "cm9sZSI6ImFub24iLCJpYXQiOjE3OTIyMjUyNjcsImV4cCI6MjEwNzgwMTI2N30.8GxM7Zqa1YKWIkuVHIu_FE5E35lSL1TK1LRNS3Dsjjw")
SUPABASE_JS = ROOT / "vendor" / "supabase-2.45.4.js"
SITE_URL = "https://luckielynx.com"

tpl = (ROOT / "template.html").read_text()

m = re.search(r"<!--APP-SCRIPTS-->\n<script data-app>\n(.*?)</script>\n", tpl, re.S)
assert m, "app script block not found"
app_js = m.group(1)


def data_uri(path):
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()


# ---------- preview (single file, demo login) ----------
preview = tpl.replace("{{ICON64}}", data_uri(ROOT / "icon_64.png"))
preview = preview.replace(
    m.group(0),
    "<script>window.LL_CONFIG = { preview: true };</script>\n<script>\n" + app_js + "</script>\n",
)
for a, b in (('"/download"', '"download.html"'), ("'/download'", "'download.html'"), ('"/admin"', '"admin.html"')):
    preview = preview.replace(a, b)
assert "{{" not in preview
(ROOT / "preview.html").write_text(preview)

# ---------- real site ----------
site = ROOT / "site"
if site.exists():
    shutil.rmtree(site)
(site / "assets").mkdir(parents=True)
shutil.copy(ROOT / "icon_64.png", site / "assets" / "icon-64.png")
shutil.copy(ROOT / "luckielynx_icon_transparent.png", site / "assets" / "icon.png")
shutil.copy(ROOT / "luckielynx_logo_transparent.png", site / "assets" / "logo.png")
shutil.copy(SUPABASE_JS, site / "assets" / "supabase-2.45.4.js")
shutil.copy(ROOT / "og-image.png", site / "assets" / "og-image.png")

# favicons: a square 192px PNG (what Google search shows) and a classic /favicon.ico
from PIL import Image
src = Image.open(ROOT / "luckielynx_icon_transparent.png").convert("RGBA")
side = max(src.size)
sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
sq.paste(src, ((side - src.width) // 2, (side - src.height) // 2))
for n in (192, 512):
    sq.resize((n, n), Image.LANCZOS).save(site / "assets" / f"icon-{n}.png", optimize=True)
sq.resize((180, 180), Image.LANCZOS).save(site / "assets" / "apple-touch-icon.png", optimize=True)
sq.save(site / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

config = "window.LL_CONFIG = " + json.dumps({"url": SB_URL, "key": SB_KEY, "preview": False}) + ";\n"
(site / "assets" / "app.js").write_text(config + app_js)

page = tpl.replace('<link rel="icon" type="image/png" href="{{ICON64}}">',
    '<link rel="icon" href="/favicon.ico" sizes="48x48">\n'
    '<link rel="icon" type="image/png" sizes="192x192" href="/assets/icon-192.png">', 1)
page = page.replace("{{ICON64}}", "assets/icon-64.png")
page = page.replace(
    m.group(0),
    '<script src="assets/supabase-2.45.4.js"></script>\n<script src="assets/app.js"></script>\n',
)
# a real document head for the live site (the artifact preview gets this from its host)
head = (
    "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
    "<meta name=\"theme-color\" content=\"#06120c\">\n"
    f"<link rel=\"canonical\" href=\"{SITE_URL}/\">\n"
    "<meta property=\"og:type\" content=\"website\">\n"
    "<meta property=\"og:title\" content=\"LuckieLynx\">\n"
    "<meta property=\"og:description\" content=\"Grab your Nexor. Make the train. A skill-based play-to-earn extraction game.\">\n"
    "<meta property=\"og:site_name\" content=\"LuckieLynx\">\n"
    "<meta name=\"twitter:card\" content=\"summary_large_image\">\n"
    f"<meta property=\"og:url\" content=\"{SITE_URL}/\">\n"
    f"<meta property=\"og:image\" content=\"{SITE_URL}/assets/og-image.png\">\n"
    "<meta property=\"og:image:width\" content=\"1200\">\n"
    "<meta property=\"og:image:height\" content=\"630\">\n"
    "<meta property=\"og:image:alt\" content=\"LuckieLynx: Grab your Nexor. Make the train.\">\n"
    "<link rel=\"apple-touch-icon\" href=\"/assets/apple-touch-icon.png\">\n"
)
page = page.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "")
# search title for the live site (the preview keeps the short artifact name)
page = page.replace("<title>LuckieLynx</title>", "<title>LuckieLynx | Skill-based play-to-earn extraction game</title>", 1)
# structured data for search engines (a data block, not a script, so the CSP allows it)
faq = json.loads((ROOT / "faq.json").read_text())
ld = {
    "@context": "https://schema.org",
    "@graph": [
        {"@type": "Organization", "@id": SITE_URL + "/#org", "name": "LuckieLynx", "alternateName": "LuckyLynx & Ace",
         "url": SITE_URL + "/", "logo": SITE_URL + "/assets/icon.png",
         "sameAs": ["https://discord.gg/nm3kwmGbHj", "https://luckylynxace.com"]},
        {"@type": "WebSite", "@id": SITE_URL + "/#site", "name": "LuckieLynx", "url": SITE_URL + "/",
         "publisher": {"@id": SITE_URL + "/#org"}},
        {"@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq]},
    ],
}
head += '<script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False) + "</script>\n"
body_start = page.index("</style>") + len("</style>\n")
page = head + page[:body_start] + "</head>\n<body>\n" + page[body_start:] + "</body>\n</html>\n"
assert "{{" not in page
assert "<script>" not in page, "inline script left in site build (CSP blocks it)"
(site / "index.html").write_text(page)

(site / "_headers").write_text(
    "/*\n"
    "  Content-Security-Policy: default-src 'self'; script-src 'self'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
    f"img-src 'self' data:; connect-src 'self' {SB_URL} wss://{SB_URL[8:]}; "
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'\n"
    "  X-Content-Type-Options: nosniff\n"
    "  Referrer-Policy: strict-origin-when-cross-origin\n"
    "  Permissions-Policy: camera=(), microphone=(), geolocation=()\n"
    "  Strict-Transport-Security: max-age=31536000\n"
    "\n/assets/*\n"
    "  Cache-Control: public, max-age=3600\n"
)
(site / "robots.txt").write_text(f"User-agent: *\nAllow: /\n")
print("built preview.html and site/:", sorted(p.name for p in site.rglob("*") if p.is_file()))


# ---------- download and admin pages ----------
css = re.search(r"<style>\n(.*?)</style>", tpl, re.S).group(1)
fonts = re.search(r'<link rel="stylesheet" href="https://fonts.googleapis.com[^"]*">', tpl).group(0)
footer = re.search(r"<footer>.*?</footer>\n", tpl, re.S).group(0)
(site / "assets" / "site.css").write_text(css)
(site / "assets" / "config.js").write_text(config)
for name in ("common.js", "download.js", "admin.js"):
    shutil.copy(ROOT / "pages" / name, site / "assets" / name)

SUB_HEADER = """<header class="top">
  <div class="wrap">
    <a class="brand" href="/" aria-label="LuckieLynx home">
      <img src="{{ICON64}}" alt="" width="36" height="36">
      <span>LuckieLynx</span>
    </a>
    <nav class="nav" aria-label="Pages">
      <a href="/">Home</a>
      <a href="/download" id="nav-download" hidden>Download</a>
      <a href="/admin" id="nav-admin" hidden>Admin</a>
      <span class="nav-actions">
        <a class="btn btn-quiet notched" id="nav-account" href="/#signup" hidden>Account</a>
        <button class="btn btn-quiet notched" id="nav-signout" type="button" hidden>Sign out</button>
        <a class="btn btn-gold notched" id="nav-signin" href="/#signin">Sign in</a>
      </span>
    </nav>
  </div>
</header>
"""
SUBPAGES = {
    "download": ("Downloads", "Tester downloads for LuckieLynx alpha and beta builds."),
    "admin": ("Admin", "LuckieLynx admin."),
}
common_js = (ROOT / "pages" / "common.js").read_text()
for slug, (title, desc) in SUBPAGES.items():
    body = (ROOT / "pages" / f"{slug}.body.html").read_text()
    page_js = (ROOT / "pages" / f"{slug}.js").read_text()
    inner = SUB_HEADER + body + footer

    # live site
    live = (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
        "<meta name=\"theme-color\" content=\"#06120c\">\n<meta name=\"robots\" content=\"noindex\">\n"
        f"<title>{title} | LuckieLynx</title>\n<meta name=\"description\" content=\"{desc}\">\n"
        "<link rel=\"icon\" href=\"/favicon.ico\" sizes=\"48x48\">\n"
        "<link rel=\"icon\" type=\"image/png\" sizes=\"192x192\" href=\"/assets/icon-192.png\">\n"
        "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n"
        f"{fonts}\n<link rel=\"stylesheet\" href=\"/assets/site.css\">\n</head>\n<body>\n"
        + inner.replace("{{ICON64}}", "/assets/icon-64.png")
        + "<script src=\"/assets/supabase-2.45.4.js\"></script>\n<script src=\"/assets/config.js\"></script>\n"
          f"<script src=\"/assets/common.js\"></script>\n<script src=\"/assets/{slug}.js\"></script>\n</body>\n</html>\n"
    )
    live = live.replace('src="assets/icon-64.png"', 'src="/assets/icon-64.png"')
    assert "<script>" not in live and "{{" not in live
    (site / f"{slug}.html").write_text(live)

    # preview (single file per page, demo data, paths mapped to sibling files)
    pv = (
        f"<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        f"<title>{title} | LuckieLynx</title>\n{fonts}\n<style>\n{css}</style>\n</head>\n<body>\n"
        + inner.replace("{{ICON64}}", data_uri(ROOT / "icon_64.png")).replace('src="assets/icon-64.png"', 'src="' + data_uri(ROOT / "icon_64.png") + '"')
        + "<script>window.LL_CONFIG = { preview: true, home: 'index.html' };</script>\n"
        f"<script>\n{common_js}</script>\n<script>\n{page_js}</script>\n</body>\n</html>\n"
    )
    for a, b in (('href="/#', 'href="index.html#'), ('href="/"', 'href="index.html"'),
                 ('href="/download"', 'href="download.html"'), ('href="/admin"', 'href="admin.html"')):
        pv = pv.replace(a, b)
    (ROOT / f"preview-{slug}.html").write_text(pv)

(site / "robots.txt").write_text("User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n")
print("built download/admin pages:", sorted(p.name for p in site.rglob("*") if p.is_file()))
