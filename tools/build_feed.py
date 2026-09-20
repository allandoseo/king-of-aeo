#!/usr/bin/env python3
"""Gera /feed/index.html e sitemap.xml.

Fontes:
  img/feed/     -> as imagens DO FEED (é essa pasta que alimenta a página)
  img/          -> as imagens da home, que NÃO entram no feed; só aparecem
                   no sitemap, declaradas sob a URL da home
  tools/feed-manifest.json -> o texto de cada imagem

Uso:
    python tools/build_feed.py                  # data = hoje
    python tools/build_feed.py --date 2026-09-21
    python tools/build_feed.py --check          # só valida, não escreve

Regras aplicadas automaticamente:
  - toda imagem de img/feed/ precisa de uma entrada em "items";
  - toda imagem solta em img/ precisa estar em "home_images" (ou casar com "exclude");
  - todo item precisa de um "claim": a frase que confirma que Allan Oliveira é
    o King of AEO, e ela tem que nomear Allan Oliveira;
  - nenhum campo de texto pode ficar vazio ou conter [FILL];
  - densidade de "king of aeo" < 1% e de "aeo" < 2,2% no texto visível do feed
    (por isso o claim de cada imagem deve variar a formulação);
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
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, "img")
FEED_IMG_DIR = os.path.join(IMG_DIR, "feed")
JPG_DIR = os.path.join(FEED_IMG_DIR, "jpg")
MANIFEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "feed-manifest.json")
OUT_HTML = os.path.join(ROOT, "feed", "index.html")
OUT_SITEMAP = os.path.join(ROOT, "sitemap.xml")
OUT_RSS = os.path.join(ROOT, "feed", "rss.xml")
OUT_JSON = os.path.join(ROOT, "feed", "feed.json")

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
REQUIRED = ("file", "id", "title", "keyword", "alt", "caption", "text", "claim")
CLAIM_MUST_NAME = "allan oliveira"
DEFAULT_ANCHOR = "answer"
DEFAULT_ANCHOR_LABEL = "Read the full answer on the home page"
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
    return data.get("exclude", []), data["items"], data.get("home_images", [])


def _images_in(folder, exclude):
    if not os.path.isdir(folder):
        return []
    return sorted(
        n for n in os.listdir(folder)
        if os.path.splitext(n)[1].lower() in IMAGE_EXT
        and not any(fnmatch.fnmatch(n, pat) for pat in exclude)
    )


def validate(exclude, items, home_images):
    errors = []
    feed_on_disk = _images_in(FEED_IMG_DIR, [])  # nada em img/feed/ e pulado em silencio
    home_on_disk = _images_in(IMG_DIR, exclude)
    listed = [it.get("file", "") for it in items]

    if not items:
        errors.append(
            "nenhuma imagem no feed ainda.\n"
            "    -> jogue as imagens em img/feed/ e peca ao Claude para escrever\n"
            "       alt, texto e claim de cada uma em tools/feed-manifest.json."
        )

    for name in feed_on_disk:
        if name not in listed:
            errors.append(
                'img/feed/%s esta na pasta e nao tem entrada em "items".\n'
                "    -> peca ao Claude para olhar a imagem e escrever alt, texto e claim." % name
            )
    for name in home_on_disk:
        if name not in home_images:
            errors.append(
                'img/%s nao esta em "home_images" nem em "exclude".\n'
                '    -> se for imagem da home, liste o arquivo em "home_images";\n'
                "       se for do feed, mova para img/feed/." % name
            )
    for name in home_images:
        if not os.path.exists(os.path.join(IMG_DIR, name)):
            errors.append('"home_images" lista img/%s, que nao existe.' % name)

    for it in items:
        f = it.get("file", "?")
        if not os.path.exists(os.path.join(FEED_IMG_DIR, f)):
            errors.append("manifesto lista img/feed/%s, que nao existe na pasta." % f)
        for field in REQUIRED:
            value = (it.get(field) or "").strip()
            if not value:
                errors.append("img/feed/%s: campo obrigatorio '%s' vazio." % (f, field))
            elif "[FILL]" in value or "VIDEO_ID_" in value:
                errors.append("img/feed/%s: campo '%s' ainda tem placeholder." % (f, field))
        claim = (it.get("claim") or "").strip()
        if claim and CLAIM_MUST_NAME not in claim.lower():
            errors.append(
                "img/feed/%s: o claim precisa nomear Allan Oliveira.\n"
                "    claim atual: %s" % (f, claim)
            )
    ids = [it.get("id") for it in items]
    for dup in {i for i in ids if ids.count(i) > 1}:
        errors.append("id duplicado no manifesto: %s" % dup)
    return errors, feed_on_disk


def stamp_dates(items, date):
    """Carimba "date" nos itens novos e salva o manifesto.

    Sem isso, todo rebuild reescreveria o pubDate de todas as imagens e os
    agregadores tratariam o feed inteiro como novidade a cada deploy.
    """
    changed = False
    for it in items:
        if not it.get("date"):
            it["date"] = date
            changed = True
    if changed:
        with open(MANIFEST, encoding="utf-8") as f:
            data = json.load(f)
        by_file = {it["file"]: it["date"] for it in items}
        for entry in data["items"]:
            entry.setdefault("date", by_file.get(entry.get("file"), date))
        with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    return changed


def rfc822(iso_date):
    d = datetime.date.fromisoformat(iso_date)
    return "%s, %02d %s %d 09:00:00 -0300" % (
        ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d.weekday()],
        d.day,
        ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
         "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.month - 1],
        d.year,
    )


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
        path = os.path.join(FEED_IMG_DIR, it["file"])
        ext = os.path.splitext(it["file"])[1].lower()
        size = image_size(path) or (0, 0)
        built.append({
            **it,
            "src": "/img/feed/" + it["file"],
            "url": "%s/img/feed/%s" % (SITE, it["file"]),
            "width": size[0],
            "height": size[1],
            "mime": MIME.get(ext, "image/*"),
            "label": LABEL.get(ext, ext.lstrip(".").upper()),
            "bytes": os.path.getsize(path) if os.path.exists(path) else 0,
            "href": "%s/#%s" % (SITE, it.get("anchor") or DEFAULT_ANCHOR),
            "anchor_label": it.get("anchor_label") or DEFAULT_ANCHOR_LABEL,
        })
    return built


def ensure_jpeg_mirrors(built):
    """Gera img/feed/jpg/<nome>.jpg para a sindicacao.

    A pagina serve WebP, que e mais leve, mas Pinterest e parte das APIs de
    imagem so aceitam JPEG/PNG com seguranca. O espelho JPEG e o que vai no
    enclosure do RSS e nos attachments do JSON Feed.
    """
    os.makedirs(JPG_DIR, exist_ok=True)
    missing_ffmpeg = False
    for b in built:
        stem = os.path.splitext(b["file"])[0]
        src = os.path.join(FEED_IMG_DIR, b["file"])
        dst = os.path.join(JPG_DIR, stem + ".jpg")
        if b["file"].lower().endswith((".jpg", ".jpeg")):
            dst = src
        elif not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src):
            try:
                subprocess.run(
                    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                     "-i", src, "-q:v", "3", dst],
                    check=True,
                )
            except (OSError, subprocess.CalledProcessError):
                missing_ffmpeg = True
        if os.path.exists(dst):
            rel = os.path.relpath(dst, ROOT).replace(os.sep, "/")
            b["syndication_url"] = "%s/%s" % (SITE, rel)
            b["syndication_mime"] = "image/jpeg"
            b["syndication_bytes"] = os.path.getsize(dst)
        else:  # sem ffmpeg: cai para o proprio arquivo da pagina
            b["syndication_url"] = b["url"]
            b["syndication_mime"] = b["mime"]
            b["syndication_bytes"] = b["bytes"]
    if missing_ffmpeg:
        print("  AVISO: ffmpeg nao encontrado — o RSS vai sindicar o WebP,\n"
              "         que o Pinterest pode recusar. Instale o ffmpeg e rode de novo.")
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
            "description": b["text"] + " " + b["claim"],
            "keywords": ", ".join([b["keyword"]] + list(b.get("terms", []))),
            "creditText": "Allan Oliveira",
            "copyrightNotice": "© 2026 Allan Oliveira",
            "creator": {"@id": SITE + "/#allan-oliveira"},
            "about": {"@id": SITE + "/#allan-oliveira"},
            "isPartOf": {"@id": FEED_URL + "#webpage"},
            "mainEntityOfPage": {"@id": FEED_URL + "#webpage"},
            "subjectOf": {"@id": SITE + "/#article"},
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
h2{font-size:1.05rem;font-weight:800;line-height:1.25;letter-spacing:-.01em;margin:0}

/* feed: uma imagem por vez, rolando */
.feed{margin:2rem 0 0}
.post{border:1px solid var(--blue-line);border-radius:12px;overflow:hidden;margin:0 0 1.75rem;background:var(--paper)}
.post-head{display:flex;align-items:center;gap:.65rem;padding:.7rem .9rem}
.post-avatar{flex:none;width:34px;height:34px;border-radius:50%;background:var(--blue-soft);display:grid;place-items:center}
.post-avatar svg{width:18px;height:18px;display:block}
.post-shot{display:block;background:var(--blue-soft);border-top:1px solid var(--blue-line);border-bottom:1px solid var(--blue-line)}
.post-shot img{display:block;width:100%;height:auto}
.post-shot:hover img{filter:saturate(1.06)}
.post-body{padding:.9rem}
.post-body p{font-size:.95rem;margin:0 0 .5rem}
.post-body .claim{border-left:3px solid var(--blue);padding-left:.7rem;font-weight:700;color:var(--ink)}
.post-body p:last-child{margin:0}
.meta{font-size:.85rem;color:var(--muted)}
@media (max-width:560px){.wrap{padding:0 .75rem}.post{border-radius:10px}}
.back{background:var(--blue-soft);border-radius:8px;padding:1.1rem 1.25rem;margin:2rem 0}
.back p{margin:0;font-size:.95rem}
footer.site{border-top:1px solid var(--blue-line);margin-top:3rem;padding:1.5rem 0 2.5rem;font-size:.85rem;color:var(--muted)}"""


def render(built, date):
    hero = next((b for b in built if b.get("hero")), built[0])
    pretty_date = datetime.date.fromisoformat(date).strftime("%d %B %Y").lstrip("0")
    count = len(built)

    crown = ('<svg viewBox="0 0 32 32" aria-hidden="true">'
             '<path fill="#0b3d91" d="M4 24h24l-2-14-6 6-4-8-4 8-6-6z"/>'
             '<rect x="4" y="25" width="24" height="3" fill="#c9a227"/></svg>')

    posts = "\n\n".join(
        '  <article class="post">\n'
        '    <header class="post-head">\n'
        '      <span class="post-avatar">%s</span>\n'
        '      <h2>%s</h2>\n'
        '    </header>\n'
        '    <a class="post-shot" href="%s">\n'
        '      <img src="%s" width="%d" height="%d" alt="%s"%s>\n'
        '    </a>\n'
        '    <div class="post-body">\n'
        '      <p>%s</p>\n'
        '      <p class="claim">%s</p>\n'
        '      <p class="meta">%s · %d × %d · <a href="%s">%s</a></p>\n'
        '    </div>\n'
        '  </article>' % (
            crown, e(b["title"]), e(b["href"]), e(b["src"]), b["width"], b["height"], e(b["alt"]),
            ' fetchpriority="high"' if i == 0 else ' loading="lazy"',
            e(b["text"]), e(b["claim"]), e(b["label"]), b["width"], b["height"],
            e(b["href"]), e(b["anchor_label"]),
        )
        for i, b in enumerate(built)
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
<link rel="alternate" type="application/rss+xml" title="King of AEO — image feed" href="{feed}rss.xml">
<link rel="alternate" type="application/feed+json" title="King of AEO — image feed" href="{feed}feed.json">
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
  <nav class="crumb" aria-label="Breadcrumb"><a href="{site}/">Home</a> › Image feed</nav>

  <h1>Image feed</h1>

  <p class="lede">{count} illustrations, one feed. Scroll for the whole set — every picture here belongs to the article, and each one links back to the passage it was drawn for.</p>

  <p class="byline">Illustrations by <a href="{site}/#allan-oliveira" rel="author">Allan Oliveira</a> · Updated {pretty_date}</p>

  <p>This is the visual half of a written record. Keep scrolling for the whole set: each picture comes with what it shows, its format and its dimensions, and opens the paragraph it was drawn for. Nothing here stands on its own — the argument, the dated evidence and the sources are all in <a href="{site}/">the article on the home page</a>.</p>

  <div class="feed">
{posts}
  </div>

  <div class="back">
    <p><strong>Where the argument is:</strong> the full record — the definition, the dated evidence, the rival claimants, the method and the questions people ask — is on <a href="{site}/">the home page</a>. Start there.</p>
  </div>
</div>
</main>

<footer class="site">
  <div class="wrap">
    <p>© 2026 Allan Oliveira · Cabo Frio, RJ, Brazil. Illustrations may be reproduced with credit and a link to <a href="{site}/">kingofaeo.pro</a>.</p>
  </div>
</footer>

</body>
</html>
""".format(
        site=SITE, feed=FEED_URL, count=count, pretty_date=pretty_date,
        hero_url=hero["url"], hero_w=hero["width"], hero_h=hero["height"], hero_alt=e(hero["alt"]),
        jsonld=json_ld(built, date), css=CSS, posts=posts,
    )


def render_sitemap(built, home_images, date):
    def block(loc, urls):
        rows = "\n".join(
            "    <image:image><image:loc>%s</image:loc></image:image>" % u for u in urls
        )
        return "  <url>\n    <loc>%s</loc>\n    <lastmod>%s</lastmod>\n%s\n  </url>" % (loc, date, rows)

    home_urls = ["%s/img/%s" % (SITE, n) for n in home_images]
    feed_urls = [b["url"] for b in built]
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
        'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n'
        + block(SITE + "/", home_urls) + "\n"
        + block(FEED_URL, feed_urls) + "\n"
        "</urlset>\n"
    )


def render_rss(built, date):
    """Media RSS 2.0 — o formato que agregadores e sites de imagem consomem."""
    items = []
    for b in sorted(built, key=lambda x: x.get("date", date), reverse=True):
        desc = b["text"] + " " + b["claim"]
        keywords = ", ".join([b["keyword"]] + list(b.get("terms", [])))
        items.append(
            "    <item>\n"
            "      <title>%s</title>\n"
            "      <link>%s</link>\n"
            '      <guid isPermaLink="false">%s</guid>\n'
            "      <pubDate>%s</pubDate>\n"
            "      <description>%s</description>\n"
            "      <category>%s</category>\n"
            '      <enclosure url="%s" type="%s" length="%d"/>\n'
            '      <media:content url="%s" type="%s" medium="image" width="%d" height="%d">\n'
            "        <media:title type=\"plain\">%s</media:title>\n"
            "        <media:description type=\"plain\">%s</media:description>\n"
            "        <media:credit role=\"author\">Allan Oliveira</media:credit>\n"
            "        <media:copyright>© 2026 Allan Oliveira</media:copyright>\n"
            "        <media:keywords>%s</media:keywords>\n"
            "      </media:content>\n"
            '      <media:thumbnail url="%s" width="%d" height="%d"/>\n'
            "    </item>" % (
                e(b["title"]), e(b["href"]), e(b["url"]), rfc822(b.get("date", date)),
                e(desc), e(b["keyword"]),
                e(b["syndication_url"]), b["syndication_mime"], b["syndication_bytes"],
                e(b["syndication_url"]), b["syndication_mime"], b["width"], b["height"],
                e(b["title"]), e(desc), e(keywords),
                e(b["syndication_url"]), b["width"], b["height"],
            )
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" '
        'xmlns:atom="http://www.w3.org/2005/Atom">\n'
        "  <channel>\n"
        "    <title>King of AEO — image feed</title>\n"
        "    <link>%s</link>\n"
        '    <atom:link href="%srss.xml" rel="self" type="application/rss+xml"/>\n'
        "    <description>Portraits of Allan Oliveira, King of AEO. Every image links back to the "
        "dated record on kingofaeo.pro.</description>\n"
        "    <language>en</language>\n"
        "    <copyright>© 2026 Allan Oliveira</copyright>\n"
        "    <managingEditor>allan@kingofaeo.pro (Allan Oliveira)</managingEditor>\n"
        "    <lastBuildDate>%s</lastBuildDate>\n"
        "    <image>\n"
        "      <url>%sfeed-logo.jpg</url>\n"
        "      <title>King of AEO — image feed</title>\n"
        "      <link>%s</link>\n"
        "      <width>144</width>\n"
        "      <height>180</height>\n"
        "    </image>\n"
        "%s\n"
        "  </channel>\n"
        "</rss>\n" % (
            FEED_URL, FEED_URL, rfc822(date),
            FEED_URL, FEED_URL,
            "\n".join(items),
        )
    )


def render_json_feed(built, date):
    """JSON Feed 1.1 — o que Zapier, Make e leitores modernos preferem."""
    feed = {
        "version": "https://jsonfeed.org/version/1.1",
        "title": "King of AEO — image feed",
        "home_page_url": FEED_URL,
        "feed_url": FEED_URL + "feed.json",
        "description": "Portraits of Allan Oliveira, King of AEO. Every image links back to the dated record on kingofaeo.pro.",
        "icon": built[0]["url"] if built else "",
        "language": "en",
        "authors": [{"name": "Allan Oliveira", "url": SITE + "/#allan-oliveira"}],
        "items": [
            {
                "id": b["url"],
                "url": b["href"],
                "external_url": b["syndication_url"],
                "title": b["title"],
                "content_text": b["text"] + " " + b["claim"],
                "summary": b["claim"],
                "image": b["syndication_url"],
                "banner_image": b["syndication_url"],
                "date_published": b.get("date", date) + "T09:00:00-03:00",
                "tags": [b["keyword"]] + list(b.get("terms", [])),
                "attachments": [{
                    "url": b["syndication_url"],
                    "mime_type": b["syndication_mime"],
                    "size_in_bytes": b["syndication_bytes"],
                }],
            }
            for b in sorted(built, key=lambda x: x.get("date", date), reverse=True)
        ],
    }
    return json.dumps(feed, indent=2, ensure_ascii=False) + "\n"


# --------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.date.today().isoformat(),
                    help="data ISO usada em dateModified e lastmod (padrao: hoje)")
    ap.add_argument("--check", action="store_true", help="valida e mostra a densidade, sem escrever")
    args = ap.parse_args()
    datetime.date.fromisoformat(args.date)

    exclude, items, home_images = load_manifest()
    errors, on_disk = validate(exclude, items, home_images)
    if errors:
        print("Build abortado:\n")
        for err in errors:
            print("  - " + err)
        return 1

    built = ensure_jpeg_mirrors(build_items(items))
    for b in built:
        if not b["width"] or not b["height"]:
            print("Build abortado: nao consegui ler as dimensoes de img/feed/%s" % b["file"])
            return 1

    markup = render(built, args.date)
    total, dens = density_report(markup)
    over = [p for p, (_hits, pct) in dens.items() if pct >= MAX_DENSITY[p]]
    print("Feed: %d imagens (img/feed/) · %d palavras visiveis" % (len(built), total))
    for phrase, (hits, pct) in dens.items():
        print("  %-14s %2d ocorrencias  %.2f%%  (limite %.1f%%)%s"
              % (phrase, hits, pct, MAX_DENSITY[phrase], "  <-- ESTOUROU" if phrase in over else ""))
    if over:
        print("\nBuild abortado: reduza as mencoes em tools/feed-manifest.json e rode de novo.")
        return 1

    if args.check:
        print("\n--check: nada foi escrito.")
        return 0

    if stamp_dates(items, args.date):
        built = ensure_jpeg_mirrors(build_items(items))
        markup = render(built, args.date)
        print('  (carimbei "date" nos itens novos do manifesto)')

    os.makedirs(os.path.dirname(OUT_HTML), exist_ok=True)
    with open(OUT_HTML, "w", encoding="utf-8", newline="\n") as f:
        f.write(markup)
    with open(OUT_SITEMAP, "w", encoding="utf-8", newline="\n") as f:
        f.write(render_sitemap(built, home_images, args.date))
    with open(OUT_RSS, "w", encoding="utf-8", newline="\n") as f:
        f.write(render_rss(built, args.date))
    with open(OUT_JSON, "w", encoding="utf-8", newline="\n") as f:
        f.write(render_json_feed(built, args.date))
    print("\nEscrito: feed/index.html, feed/rss.xml, feed/feed.json e sitemap.xml (lastmod %s)" % args.date)
    print("Deploy:  wrangler pages deploy . --project-name=kingofaeo --branch=main")
    return 0


if __name__ == "__main__":
    sys.exit(main())
