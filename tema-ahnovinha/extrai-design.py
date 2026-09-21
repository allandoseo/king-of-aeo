r"""Extrai do bundle do design so o que interessa para reconstruir o tema:
cores, fontes, medidas e os textos de interface. O arquivo tem 345 KB de
JavaScript empacotado; ler tudo nao ajuda e custa caro.
"""
import re
import sys
import html
import collections

caminho = sys.argv[1]
s = open(caminho, encoding="utf-8", errors="replace").read()

print("=" * 60)
print("CORES")
print("=" * 60)
cores = collections.Counter(re.findall(r"#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b", s))
for cor, n in cores.most_common(28):
    print("  %-10s %dx" % (cor.lower(), n))

print()
print("=" * 60)
print("FONTES")
print("=" * 60)
fontes = set()
for m in re.findall(r"font-family\s*:\s*([^;}\"']{3,90})", s):
    fontes.add(m.strip())
for m in re.findall(r"fonts\.googleapis\.com/css2\?([^\"')]{5,200})", s):
    fontes.add("GoogleFonts: " + m[:160])
for f in sorted(fontes)[:20]:
    print("  " + f)

print()
print("=" * 60)
print("VARIAVEIS CSS")
print("=" * 60)
for nome, val in sorted(set(re.findall(r"(--[a-z0-9-]{2,40})\s*:\s*([^;}\"']{1,60})", s)))[:50]:
    print("  %-26s %s" % (nome, val.strip()))

print()
print("=" * 60)
print("CLASSES / ESTRUTURA (nomes repetidos)")
print("=" * 60)
cls = collections.Counter(re.findall(r"className\s*:\s*\"([^\"]{3,120})\"", s))
vistos = collections.Counter()
for c, n in cls.items():
    for parte in c.split():
        vistos[parte] += n
for c, n in vistos.most_common(45):
    print("  %-34s %dx" % (c, n))

print()
print("=" * 60)
print("TEXTOS DE INTERFACE")
print("=" * 60)
aspas = '"' + "'" + "`"
pat = re.compile("[" + aspas + "]([^" + aspas + "\\\\]{3,120})[" + aspas + "]")
alvo = re.compile(r"[çãõáéíóúâêôàº]|fotos?|galeria|categoria|busca|menu|ver|mais|p[áa]gina|in[íi]cio|tags?|anterior|pr[óo]xim", re.I)
ruim = re.compile(r"[{}<>;]|function|return|var |http|\.js|\.css|rgba|=>|px$|^[0-9.]+$|webkit|module")
vis, out = set(), []
for m in pat.finditer(s):
    t = m.group(1).strip()
    if not alvo.search(t) or ruim.search(t) or t in vis:
        continue
    vis.add(t)
    out.append(t)
print("  (%d encontrados)" % len(out))
for t in out[:70]:
    print("  - " + html.unescape(t))
