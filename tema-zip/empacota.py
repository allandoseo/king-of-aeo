# -*- coding: utf-8 -*-
"""Empacota o tema para upload, sem o CLAUDE.md (documentacao, nao vai pro servidor)."""
import base64, zipfile, io, os

RAIZ = 'theme'
buf = io.BytesIO()
z = zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED)

n = 0
for pasta, _, arquivos in os.walk(RAIZ):
    for a in arquivos:
        caminho = os.path.join(pasta, a)
        rel = os.path.relpath(caminho, RAIZ).replace(os.sep, '/')
        if rel == 'CLAUDE.md':
            continue
        z.write(caminho, rel)
        n += 1
        print('  %-34s %d bytes' % (rel, os.path.getsize(caminho)))
z.close()

dados = buf.getvalue()
b64 = base64.b64encode(dados).decode()
open('pacote.b64', 'w').write(b64)

print()
print('arquivos  :', n)
print('zip bytes :', len(dados))
print('base64    :', len(b64), 'chars')
