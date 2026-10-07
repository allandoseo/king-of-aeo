r"""Empacota plugin/ como areas-patrocinadas.zip, pronto para 'Enviar plugin'.

O Compress-Archive do PowerShell 5.1 grava '\' como separador dentro do zip, e o
unzip do WordPress em servidor Linux nao entende isso: em vez da pasta, aparecem
arquivos chamados "areas-patrocinadas\areas-patrocinadas.php". O zipfile do
Python grava '/' sempre, que e o que o formato manda.
"""
import os
import zipfile

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "plugin")
PASTA = "areas-patrocinadas"
DEST = os.path.join(BASE, PASTA + ".zip")

if os.path.exists(DEST):
    os.remove(DEST)

n = 0
with zipfile.ZipFile(DEST, "w", zipfile.ZIP_DEFLATED) as z:
    for raiz, _dirs, arquivos in os.walk(SRC):
        for nome in sorted(arquivos):
            cheio = os.path.join(raiz, nome)
            rel = os.path.relpath(cheio, SRC).replace(os.sep, "/")
            z.write(cheio, PASTA + "/" + rel)
            n += 1

print("%s  —  %d arquivos, %.1f KB" % (DEST, n, os.path.getsize(DEST) / 1024))
with zipfile.ZipFile(DEST) as z:
    for nome in z.namelist():
        print("  " + nome)
