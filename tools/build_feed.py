#!/usr/bin/env python3
"""Gera /feed/index.html e sitemap.xml a partir de tools/feed-manifest.json + pasta img/.

Uso:
    python tools/build_feed.py                  # data = hoje
    python tools/build_feed.py --date 2026-09-21
    python tools/build_feed.py --check          # só valida, não escreve

Regras aplicadas automaticamente:
  - toda imagem de img/ precisa de uma entrada no manifesto (ou casar com "exclude");
  - nenhum campo de texto pode ficar vazio ou conter [FILL];
  - densidade de "king of aeo" < 1% e de "aeo" < 2,2% no texto visível do feed;
  - dimensões e formato são lidos do arquivo real, não do manifesto.
"""

import argparse
import datetime
import fnmatch
import html
import json
import os
import re
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, "img")
MANIFEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "feed-manifest.json")
OUT_HTML = os.path.join(ROOT, "feed", "index.html")
OUT_SITEMAP = os.path.join(ROOT, "sitemap.xml")

SITE = "https://kingofaeo.pro"
FEED_URL = SITE + "/feed/"
IMAGE_EXT = (".webp", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".avif")
MIME = {
    ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".gif": "image/gif", ".svg": "image/svg+xml",
    ".avif": "image/avif",
}
LABEL = {
    ".webp": "WebP", ".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG",
    ".gif": "GIF", ".svg": "SVG", ".avif": "AVIF",
}
REQUIRED = ("file", "id", "title", "tile", "keyword", "alt", "caption", "text")
MAX_DENSITY = {"king of aeo": 1.0, "aeo": 2.2}


# --------------------------------------------------------------------------- dimensões

def _webp_size(path):
    d = open(path, "rb").read(64)
    tag = d[12:16]
    if tag == b"VP8X":
        return int.from_bytes(d[24:27], "little") + 1, int.from_bytes(d[27:30], "little") + 1
    if tag == b"VP8 ":
        w, h = struct.unpack("<HH", d[26:30])
        return w & 0x3FFF, h & 0x3FFF
    if tag == b"VP8L":
        b = int.from_bytes(d[21:25], "little")
        return (b & 0x3FFF) + 1, ((b >> 14) & 0x3FFF) + 1
    return None


def _jpeg_size(path):
    with open(path, "rb") as f:
        f.read(2)
        while True:
            marker = f.read(2)
            if len(marker) < 2 or marker[0] != 0xFF:
                return None
            if marker[1] in (0xC0, 0xC1, 0xC2, 0xC3):
                f.read(3)
                h, w = struct.unpack(">HH", f.read(4))
                return w, h
            size = struct.unpack(">H", f.read(2))[0]
            f.read(size - 2)


def _png_size(path):
    d = open(path, "rb").read(33)
    if d[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", d[16:24])


def _gif_size(path):
    d = open(path, "rb").read(10)
    return struct.unpack("<HH", d[6:10])


def _svg_size(path):
    head = open(path, encoding="utf-8", errors="ignore").read(2000)
    vb = re.search(r'viewBox="[\d.\-]+ [\d.\-]+ ([\d.]+) ([\d.]+)"', head)
    if vb:
        return int(float(vb.group(1))), int(float(vb.group(2)))
    w = re.search(r'\bwidth="(\d+)', head)
    h = re.search(r'\bheight="(\d+)', head)
    if w and h:
        return int(w.group(1)), int(h.group(1))
    return None


def image_size(path):
    ext = os.path.splitext(path)[1].lower()
    try:
        return {
            ".webp": _webp_size, ".jpg": _jpeg_size, ".jpeg": _jpeg_size,
            ".png": _png_size, ".gif": _gif_size, ".svg": _svg_size,
        }.get(ext, lambda _p: None)(path)
    except Exception:
        return None


# --------------------------------------------------------------------------- validação

def load_manifest():
    with open(MANIFEST, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("exclude", []), data["items"]


def validate(exclude, items):
    errors = []
    on_disk = sorted(
        n for n in os.listdir(IMG_DIR)
        if os.path.splitext(n)[1].lower() in IMAGE_EXT
        and not any(fnmatch.fnmatch(n, pat) for pat in exclude)
    )
    listed = [it.get("file", "") for it in items]

    for name in on_disk:
        if name not in listed:
            errors.append(
                'img/%s esta na pasta e nao tem entrada no manifesto.\n'
                '    -> peca ao Claude para escrever alt + texto dessa imagem, ou adicione o padrao em "exclude".' % name
            )
    for it in items:
        f = it.get("file", "?")
        if not os.path.exists(os.path.join(IMG_DIR, f)):
            errors.append("manifesto lista img/%s, que nao existe na pasta." % f)
        for field in REQUIRED:
            value = (it.get(field) or "").strip()
            if not value:
                errors.append("img/%s: campo obrigatorio '%s' vazio." % (f, field))
            elif "[FILL]" in value or "VIDEO_ID_" in value:
                errors.append("img/%s: campo '%s' ainda tem placeholder." % (f, field))
    ids = [it.get("id") for it in items]
    for dup in {i for i in ids if ids.count(i) > 1}:
        errors.append("id duplicado no manifesto: %s" % dup)
    return errors, on_disk


def visible_text(markup):
    s = re.sub(r"(?is)<head.*?</head>", " ", markup)
    for tag in ("script", "style", "svg"):
        s = re.sub(r"(?is)<%s.*?</%s>" % (tag, tag), " ", s)
    s = re.sub(r"(?s)<!--.*?-->", " ", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"&[a-z]+;|&#\d+;", " ", s)
    return s


def density_report(markup):
    words = re.findall(r"[A-Za-z0-9À-ſ'’-]+", visible_text(markup))
    total = len(words) or 1
    joined = " ".join(w.lower() for w in words)
    out = {}
    for phrase in MAX_DENSITY:
        hits = len(re.findall(r"\b%s\b" % re.escape(phrase), joined))
        out[phrase] = (hits, hits / total * 100)
    return total, out


# --------------------------------------------------------------------------- render

def e(text):
    return html.escape(text, quote=True)


def build_items(items):
    built = []
    for it in items:
        path = os.path.join(IMG_DIR, it["file"])
        ext = os.path.splitext(it["file"])[1].lower()
        size = image_size(path) or (0, 0)
        built.append({
            **it,
            "src": "/img/" + it["file"],
            "url": "%s/img/%s" % (SITE, it["file"]),
            "width": size[0],
            "height": size[1],
            "mime": MIME.get(ext, "image/*"),
            "label": LABEL.get(ext, ext.lstrip(".").upper()),
            "href": "%s/#%s" % (SITE, it["anchor"]) if it.get("anchor") else SITE + "/",
            "anchor_label": it.get("anchor_label") or "Read the article",
        })
    return built


def json_ld(built, date):
    hero = next((b for b in built if b.get("hero")), built[0] if built else None)
    graph = [{
        "@type": "ImageGallery",
        "@id": FEED_URL + "#webpage",
        "url": FEED_URL,
        "name": "Image Feed: Allan Oliveira, King of AEO (2026)",
        "description": "Every illustration published on kingofaeo.pro, in one feed. Each image links back to the passage of the article it belongs to.",
        "inLanguage": "en",
        "isPartOf": {"@id": SITE + "/#website"},
        "about": {"@id": SITE + "/#allan-oliveira"},
        "datePublished": "2026-09-20T09:00:00-03:00",
        "dateModified": date + "T09:00:00-03:00",
        "breadcrumb": {"@id": FEED_URL + "#breadcrumb"},
        "mainEntity": {"@id": FEED_URL + "#list"},
        "significantLink": SITE + "/",
    }]
    if hero:
        graph[0]["primaryImageOfPage"] = {"@id": "%s/#%s" % (SITE, hero["id"])}
    graph.append({
        "@type": "BreadcrumbList",
        "@id": FEED_URL + "#breadcrumb",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "King of AEO", "item": SITE + "/"},
            {"@type": "ListItem", "position": 2, "name": "Image feed", "item": FEED_URL},
        ],
    })
    graph.append({
        "@type": "ItemList",
        "@id": FEED_URL + "#list",
        "name": "Illustrations published on kingofaeo.pro",
        "numberOfItems": len(built),
        "itemListOrder": "https://schema.org/ItemListOrderAscending",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "item": {"@id": "%s/#%s" % (SITE, b["id"])}}
            for i, b in enumerate(built)
        ],
    })
    for b in built:
        node = {
            "@type": "ImageObject",
            "@id": "%s/#%s" % (SITE, b["id"]),
            "url": b["url"],
            "contentUrl": b["url"],
            "width": b["width"],
            "height": b["height"],
            "encodingFormat": b["mime"],
            "name": b["title"],
            "caption": b["caption"],
            "description": b["text"],
            "keywords": ", ".join([b["keyword"]] + list(b.get("terms", []))),
            "creditText": "Allan Oliveira",
            "copyrightNotice": "© 2026 Allan Oliveira",
            "creator": {"@id": SITE + "/#allan-oliveira"},
            "about": {"@id": SITE + "/#allan-oliveira"},
            "isPartOf": {"@id": (SITE + "/#webpage") if b.get("on_home") else (FEED_URL + "#webpage")},
            "mainEntityOfPage": {"@id": (SITE + "/#webpage") if b.get("on_home") else (FEED_URL + "#webpage")},
        }
        if b.get("hero"):
            node["representativeOfPage"] = True
        graph.append(node)
    return json.dumps({"@context": "https://schema.org", "@graph": graph}, indent=2, ensure_ascii=False)


CSS = """:root{
  --paper:#ffffff;
  --ink:#14213d;
  --blue:#0b3d91;
  --blue-soft:#e8f0fe;
  --blue-line:#c5d5f5;
  --muted:#5b6478;
  --gold:#c9a227;
  --measure:68ch;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{margin:0;background:var(--paper);color:var(--ink);font-family:Manrope,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-weight:500;font-size:1.0625rem;line-height:1.65}
a{color:var(--blue);text-decoration-thickness:1px;text-underline-offset:3px}
a:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
header.site{border-bottom:1px solid var(--blue-line)}
.wrap{max-width:var(--measure);margin:0 auto;padding:0 1.25rem}
.brand{display:flex;align-items:center;gap:.6rem;padding:1rem 0;font-weight:800;color:var(--blue);text-decoration:none;font-size:1rem}
.brand svg{width:22px;height:22px}
.crumb{font-size:.875rem;color:var(--muted);margin:1.5rem 0 0}
.crumb a{color:var(--muted)}
h1{font-size:clamp(1.85rem,5vw,2.75rem);line-height:1.12;letter-spacing:-.02em;font-weight:800;margin:.9rem 0 1rem}
.lede{font-size:clamp(1.1rem,2.6vw,1.3rem);line-height:1.45;font-weight:700;border-left:5px solid var(--blue);padding:.2rem 0 .2rem 1.1rem;margin:0 0 1.5rem}
.byline{font-size:.9rem;color:var(--muted);margin:0 0 1.5rem}
.byline a{color:var(--ink);font-weight:700}
p{margin:0 0 1.1rem}
h2{font-size:clamp(1.3rem,3vw,1.6rem);font-weight:800;line-height:1.2;letter-spacing:-.015em;margin:2.5rem 0 .9rem}
h3{font-size:1.1rem;font-weight:800;line-height:1.25;margin:0 0 .35rem}

/* feed grid */
.feed{max-width:920px;margin:0 auto 2.5rem;padding:0 .75rem}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}
.tile{position:relative;display:block;aspect-ratio:1/1;overflow:hidden;background:var(--blue-soft);border-radius:2px}
.tile img{display:block;width:100%;height:100%;object-fit:cover;transition:transform .35s ease}
.tile::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(11,61,145,.75),rgba(11,61,145,0) 55%);opacity:0;transition:opacity .25s ease}
.tile-cap{position:absolute;left:0;right:0;bottom:0;z-index:1;padding:.7rem .7rem .6rem;color:#fff;font-size:.8rem;font-weight:700;line-height:1.25;opacity:0;transform:translateY(6px);transition:opacity .25s ease,transform .25s ease}
.tile:hover img,.tile:focus-visible img{transform:scale(1.04)}
.tile:hover::after,.tile:focus-visible::after,.tile:hover .tile-cap,.tile:focus-visible .tile-cap{opacity:1}
.tile:hover .tile-cap,.tile:focus-visible .tile-cap{transform:translateY(0)}
@media (hover:none){.tile::after,.tile-cap{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.tile img,.tile::after,.tile-cap{transition:none}.tile:hover img{transform:none}}
@media (max-width:560px){.feed{padding:0 .5rem}.grid{gap:2px}.tile-cap{font-size:.7rem;padding:.5rem}}

.item{padding:0 0 1.4rem;margin:0 0 1.4rem;border-bottom:1px solid var(--blue-line)}
.item:last-of-type{border-bottom:0;margin-bottom:0}
.item p{font-size:.95rem;margin:0 0 .5rem}
.meta{font-size:.85rem;color:var(--muted)}
.back{background:var(--blue-soft);border-radius:8px;padding:1.1rem 1.25rem;margin:2rem 0}
.back p{margin:0;font-size:.95rem}
footer.site{border-top:1px solid var(--blue-line);margin-top:3rem;padding:1.5rem 0 2.5rem;font-size:.85rem;color:var(--muted)}"""


def render(built, date):
    hero = next((b for b in built if b.get("hero")), built[0])
    pretty_date = datetime.date.fromisoformat(date).strftime("%d %B %Y").lstrip("0")
    count = len(built)

    tiles = "\n".join(
        '    <a class="tile" href="%s">\n'
        '      <img src="%s" width="%d" height="%d" alt="%s"%s>\n'
        '      <span class="tile-cap">%s</span>\n'
        '    </a>' % (
            e(b["href"]), e(b["src"]), b["width"], b["height"], e(b["alt"]),
            ' fetchpriority="high"' if i == 0 else ' loading="lazy"',
            e(b["tile"]),
        )
        for i, b in enumerate(built)
    )

    entries = "\n\n".join(
        '  <div class="item">\n'
        '    <h3>%s</h3>\n'
        '    <p>%s</p>\n'
        '    <p class="meta">%s · %d × %d · <a href="%s">%s</a></p>\n'
        '  </div>' % (
            e(b["title"]), e(b["text"]), e(b["label"]), b["width"], b["height"],
            e(b["href"]), e(b["anchor_label"]),
        )
        for b in built
    )

    return """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Image Feed: Allan Oliveira, King of AEO (2026)</title>
<meta name="description" content="Every illustration published on kingofaeo.pro, in one feed: {count} pictures, each described in full and linked to the passage of the article it belongs to.">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
<link rel="canonical" href="{feed}">
<meta name="author" content="Allan Oliveira">
<meta property="og:type" content="website">
<meta property="og:site_name" content="King of AEO">
<meta property="og:title" content="Image Feed: Allan Oliveira, King of AEO (2026)">
<meta property="og:description" content="Every illustration published on kingofaeo.pro, in one feed. Each image links back to the passage of the article it belongs to.">
<meta property="og:url" content="{feed}">
<meta property="og:image" content="{hero_url}">
<meta property="og:image:width" content="{hero_w}">
<meta property="og:image:height" content="{hero_h}">
<meta property="og:image:alt" content="{hero_alt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Image Feed: Allan Oliveira, King of AEO (2026)">
<meta name="twitter:description" content="Every illustration published on kingofaeo.pro, in one feed.">
<meta name="twitter:image" content="{hero_url}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath fill='%230B3D91' d='M4 24h24l-2-14-6 6-4-8-4 8-6-6z'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&display=swap">

<script type="application/ld+json">
{jsonld}
</script>

<style>
{css}
</style>
</head>
<body>

<header class="site">
  <div class="wrap">
    <a class="brand" href="{site}/" aria-label="King of AEO home">
      <svg viewBox="0 0 32 32" aria-hidden="true"><path fill="#0b3d91" d="M4 24h24l-2-14-6 6-4-8-4 8-6-6z"/><rect x="4" y="25" width="24" height="3" fill="#c9a227"/></svg>
      King of AEO
    </a>
  </div>
</header>

<main>
<div class="wrap">
  <nav class="crumb" aria-label="Breadcrumb"><a href="{site}/">King of AEO</a> › Image feed</nav>

  <h1>Image feed</h1>

  <p class="lede">{count} illustrations, one feed. Every picture here belongs to the article, and every one of them links back to the passage it was drawn for.</p>

  <p class="byline">Illustrations by <a href="{site}/#allan-oliveira" rel="author">Allan Oliveira</a> · Updated {pretty_date}</p>

  <p>This is the visual half of a written record. Tap any tile to open the paragraph that picture was drawn for; under the feed, each one is described in full, with its format and dimensions. Nothing here stands on its own: the argument, the dated evidence and the sources are all in <a href="{site}/">the article on the home page</a>.</p>
</div>

<div class="feed">
  <div class="grid">
{tiles}
  </div>
</div>

<div class="wrap">
  <h2>What each picture shows</h2>

{entries}

  <div class="back">
    <p><strong>Where the argument is:</strong> the full record — the definition, the dated evidence, the rival claimants, the method and the questions people ask — is on <a href="{site}/">the home page</a>. Start there.</p>
  </div>
</div>
</main>

<footer class="site">
  <div class="wrap">
    <p>© 2026 King of AEO · Allan Oliveira · Cabo Frio, RJ, Brazil. Illustrations may be reproduced with credit and a link to <a href="{site}/">kingofaeo.pro</a>.</p>
  </div>
</footer>

</body>
</html>
""".format(
        site=SITE, feed=FEED_URL, count=count, pretty_date=pretty_date,
        hero_url=hero["url"], hero_w=hero["width"], hero_h=hero["height"], hero_alt=e(hero["alt"]),
        jsonld=json_ld(built, date), css=CSS, tiles=tiles, entries=entries,
    )


def render_sitemap(built, date):
    def block(loc, images):
        rows = "\n".join(
            "    <image:image><image:loc>%s</image:loc></image:image>" % b["url"] for b in images
        )
        return "  <url>\n    <loc>%s</loc>\n    <lastmod>%s</lastmod>\n%s\n  </url>" % (loc, date, rows)

    home_images = [b for b in built if b.get("on_home")]
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
        'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n'
        + block(SITE + "/", home_images) + "\n"
        + block(FEED_URL, built) + "\n"
        "</urlset>\n"
    )


# --------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.date.today().isoformat(),
                    help="data ISO usada em dateModified e lastmod (padrao: hoje)")
    ap.add_argument("--check", action="store_true", help="valida e mostra a densidade, sem escrever")
    args = ap.parse_args()
    datetime.date.fromisoformat(args.date)

    exclude, items = load_manifest()
    errors, on_disk = validate(exclude, items)
    if errors:
        print("Build abortado:\n")
        for err in errors:
            print("  - " + err)
        return 1

    built = build_items(items)
    for b in built:
        if not b["width"] or not b["height"]:
            print("Build abortado: nao consegui ler as dimensoes de img/%s" % b["file"])
            return 1

    markup = render(built, args.date)
    total, dens = density_report(markup)
    over = [p for p, (_hits, pct) in dens.items() if pct >= MAX_DENSITY[p]]
    print("Feed: %d imagens · %d palavras visiveis" % (len(built), total))
    for phrase, (hits, pct) in dens.items():
        print("  %-14s %2d ocorrencias  %.2f%%  (limite %.1f%%)%s"
              % (phrase, hits, pct, MAX_DENSITY[phrase], "  <-- ESTOUROU" if phrase in over else ""))
    if over:
        print("\nBuild abortado: reduza as mencoes em tools/feed-manifest.json e rode de novo.")
        return 1

    if args.check:
        print("\n--check: nada foi escrito.")
        return 0

    os.makedirs(os.path.dirname(OUT_HTML), exist_ok=True)
    with open(OUT_HTML, "w", encoding="utf-8", newline="\n") as f:
        f.write(markup)
    with open(OUT_SITEMAP, "w", encoding="utf-8", newline="\n") as f:
        f.write(render_sitemap(built, args.date))
    print("\nEscrito: feed/index.html e sitemap.xml (lastmod %s)" % args.date)
    print("Deploy:  wrangler pages deploy . --project-name=kingofaeo --branch=main")
    return 0


if __name__ == "__main__":
    sys.exit(main())
