#!/usr/bin/env node
// indexnow.mjs — avisa o IndexNow (Bing, Yandex, Seznam, Naver) das URLs que mudaram.
//
//   node tools/indexnow.mjs            envia o que esta na fila
//   node tools/indexnow.mjs --all      envia TODAS as URLs do sitemap de paginas
//   node tools/indexnow.mjs --dry-run  mostra o que enviaria, sem enviar
//
// Modo normal: a fila e escrita pelo build.mjs, que compara o sitemap-pages.xml
// novo com o que estava no disco e enfileira as URLs cujo <lastmod> mudou. A
// fila acumula entre builds e so e esvaziada aqui, depois de o endpoint
// aceitar: build rodado duas vezes nao perde o que a primeira achou, e ping que
// falha nao some com a lista.
//
// Modo --all: existe porque <lastmod> tem granularidade de DIA. Uma pagina
// editada de novo no mesmo dia, depois de ja ter sido pingada, mantem a mesma
// string de data e por isso nao reentra na fila. Depois de uma sessao com
// varias edicoes seguidas, --all resolve sem depender dessa comparacao.
//
// A chave fica na raiz do dominio, como o protocolo exige: public/<chave>.txt,
// contendo a propria chave. Este script a descobre sozinho, para a chave nao
// existir escrita em dois lugares.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname ?? process.cwd(), '..');
const HOST = 'kingofaeo.pro';
const FILA = path.join(ROOT, 'tools/indexnow-queue.json');
const SITEMAP = path.join(ROOT, 'public/sitemap-pages.xml');
const ENDPOINT = 'https://api.indexnow.org/indexnow';

function morre(msg) {
  console.error(`indexnow: ${msg}`);
  process.exit(1);
}

// INDEXNOW_KEY no ambiente tem precedencia sobre o arquivo. Vale dizer o que
// isso protege e o que nao protege: o protocolo EXIGE que a chave esteja
// publicada em https://<host>/<chave>.txt, porque e assim que o buscador prova
// que quem pediu a indexacao controla o dominio. Ela e publica por desenho.
// Ler do ambiente serve para trocar de chave sem editar codigo, e para o build
// rodar onde o arquivo ainda nao foi para o disco. Nao e segredo.
function chaveDoAmbiente() {
  const v = (process.env.INDEXNOW_KEY ?? '').trim();
  if (!v) return null;
  if (!/^[0-9a-zA-Z-]{8,128}$/.test(v)) morre('INDEXNOW_KEY fora do formato aceito pelo protocolo');
  return v;
}

// A chave e um arquivo na raiz publica cujo nome, sem .txt, e o proprio conteudo.
function achaChave() {
  const dir = path.join(ROOT, 'public');
  const achados = fs.readdirSync(dir)
    .filter((n) => /^[0-9a-f]{8,128}\.txt$/i.test(n))
    .filter((n) => fs.readFileSync(path.join(dir, n), 'utf8').trim() === path.basename(n, '.txt'));
  if (achados.length === 0) morre('no key file in public/: expected <key>.txt containing that same key');
  if (achados.length > 1) morre(`more than one key file in public/: ${achados.join(', ')}`);
  return path.basename(achados[0], '.txt');
}

function leFila() {
  if (!fs.existsSync(FILA)) return null;
  const v = JSON.parse(fs.readFileSync(FILA, 'utf8'));
  return Array.isArray(v) ? v : null;
}

function leSitemap() {
  if (!fs.existsSync(SITEMAP)) morre('public/sitemap-pages.xml not found; run node build.mjs first');
  const locs = [...fs.readFileSync(SITEMAP, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (!locs.length) morre('public/sitemap-pages.xml has no <loc>');
  return locs;
}

const seco = process.argv.includes('--dry-run');
const tudo = process.argv.includes('--all');

const origem = tudo ? leSitemap() : leFila();
if (origem === null) {
  console.log('indexnow: nada na fila; rode node build.mjs primeiro, ou use --all.');
  process.exit(0);
}
if (!origem.length) {
  console.log('indexnow: fila vazia, nada a enviar. Use --all para reenviar o sitemap inteiro.');
  process.exit(0);
}

// O protocolo so aceita URLs do mesmo host da chave. URL de outro host, se
// alguma voltar ao sitemap, precisa da propria chave, no proprio dominio.
const minhas = origem.filter((u) => { try { return new URL(u).host === HOST; } catch { return false; } });
const alheias = origem.filter((u) => !minhas.includes(u));

const chave = chaveDoAmbiente() ?? achaChave();
const corpo = {
  host: HOST,
  key: chave,
  keyLocation: `https://${HOST}/${chave}.txt`,
  urlList: minhas,
};

console.log(`indexnow: ${minhas.length} URL(s) para ${HOST}${tudo ? ' (--all: sitemap inteiro)' : ''}`);
for (const u of minhas) console.log(`  ${u}`);
if (alheias.length) {
  console.log(`  (${alheias.length} fora de ${HOST}, ignorada(s): ${alheias.join(', ')})`);
}

if (seco) {
  console.log(`--dry-run: nada enviado. keyLocation seria ${corpo.keyLocation}`);
  process.exit(0);
}
if (!minhas.length) {
  console.log('indexnow: nada em nosso host para enviar.');
  process.exit(0);
}

const r = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(corpo),
});
const texto = await r.text().catch(() => '');
console.log(`indexnow: HTTP ${r.status} ${r.statusText}${texto ? ` — ${texto.slice(0, 200)}` : ''}`);

// 200 aceito; 202 aceito e chave em validacao. So ai a fila e esvaziada — em
// --all tambem, porque o que ela guardava acabou de ser enviado junto.
if (r.status === 200 || r.status === 202) {
  fs.mkdirSync(path.dirname(FILA), { recursive: true });
  fs.writeFileSync(FILA, '[]\n', 'utf8');
  console.log(`indexnow: fila esvaziada (${path.relative(ROOT, FILA)})`);
} else {
  console.error('indexnow: fila mantida para tentar de novo.');
  process.exit(1);
}
