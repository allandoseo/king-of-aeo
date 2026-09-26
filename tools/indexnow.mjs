#!/usr/bin/env node
// indexnow.mjs — avisa o IndexNow (Bing, Yandex, Seznam, Naver) das URLs que mudaram.
//
//   node tools/indexnow.mjs            envia
//   node tools/indexnow.mjs --dry-run  mostra o que enviaria, sem enviar
//
// A fila e escrita pelo build.mjs: a cada build ele compara o sitemap-pages.xml
// que vai gravar com o que estava no disco e enfileira toda URL cujo <lastmod>
// mudou, ou que nasceu agora. A fila acumula entre builds e so e esvaziada aqui,
// depois de o endpoint aceitar: build rodado duas vezes nao perde o que a
// primeira rodada achou, e um ping que falha nao some com a lista.
//
// A chave fica na raiz do dominio, como o protocolo exige: public/<chave>.txt,
// contendo a propria chave. Este script a descobre sozinho, para a chave nao
// existir escrita em dois lugares.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname ?? process.cwd(), '..');
const HOST = 'kingofaeo.pro';
const FILA = path.join(ROOT, 'tools/indexnow-queue.json');
const ENDPOINT = 'https://api.indexnow.org/indexnow';

function morre(msg) {
  console.error(`indexnow: ${msg}`);
  process.exit(1);
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

const seco = process.argv.includes('--dry-run');

if (!fs.existsSync(FILA)) {
  console.log('indexnow: nada na fila; rode node build.mjs primeiro.');
  process.exit(0);
}
const fila = JSON.parse(fs.readFileSync(FILA, 'utf8'));
if (!Array.isArray(fila) || fila.length === 0) {
  console.log('indexnow: fila vazia, nada a enviar.');
  process.exit(0);
}

// O protocolo so aceita URLs do mesmo host da chave. O subdominio da cobertura
// e outro host: precisa da propria chave, no proprio dominio.
const minhas = fila.filter((u) => { try { return new URL(u).host === HOST; } catch { return false; } });
const alheias = fila.filter((u) => !minhas.includes(u));

const chave = achaChave();
const corpo = {
  host: HOST,
  key: chave,
  keyLocation: `https://${HOST}/${chave}.txt`,
  urlList: minhas,
};

console.log(`indexnow: ${minhas.length} URL(s) para ${HOST}`);
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

// 200 aceito, 202 aceito e chave em validacao. So ai a fila e esvaziada.
if (r.status === 200 || r.status === 202) {
  fs.writeFileSync(FILA, '[]\n', 'utf8');
  console.log(`indexnow: fila esvaziada (${path.relative(ROOT, FILA)})`);
} else {
  console.error('indexnow: fila mantida para tentar de novo.');
  process.exit(1);
}
