#!/usr/bin/env node
// rollout.mjs — publica paginas novas em lotes diarios, nao todas de uma vez.
//
//   node tools/rollout.mjs --status    mostra a fila e o que sai hoje
//   node tools/rollout.mjs --dry-run   faz tudo menos mover, publicar e pingar
//   node tools/rollout.mjs             publica o lote do dia
//
// POR QUE ISTO PRECISA EXISTIR.
//
// O Cloudflare Pages publica o diretorio public/ inteiro. Nao da para "segurar"
// uma pagina que ja esta la: se o arquivo existe, ele vai ao ar no proximo
// deploy. Entao a pagina que ainda nao chegou a vez fica FORA de public/, em
// content/pending/<slug>/, e este programa a move no dia dela.
//
// O IndexNow recebe so as URLs do lote do dia. Mandar as dez de uma vez
// anularia o proposito de escalonar: o que se quer e que cada pagina chegue ao
// rastreador como item proprio, e nao como despejo.
//
// LOTE=3 por dia e o padrao pedido. Nao ha magica no numero: o que importa e
// que seja constante, porque o sinal aqui e ritmo, nao volume.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RAIZ = path.join(import.meta.dirname ?? process.cwd(), '..');
const MANIFESTO = path.join(RAIZ, 'tools/rollout.json');
const PENDENTES = path.join(RAIZ, 'content/pending');
const PUBLICO = path.join(RAIZ, 'public');
const FILA = path.join(RAIZ, 'tools/indexnow-queue.json');
const SITE = 'https://kingofaeo.pro';
const LOTE = 3;

const SECO = process.argv.includes('--dry-run');
const SO_STATUS = process.argv.includes('--status');

function morre(msg) {
  console.error(`rollout: ${msg}`);
  process.exit(1);
}

function hoje() {
  return new Date().toISOString().slice(0, 10);
}

function leManifesto() {
  if (!fs.existsSync(MANIFESTO)) morre(`${path.relative(RAIZ, MANIFESTO)} nao existe`);
  const d = JSON.parse(fs.readFileSync(MANIFESTO, 'utf8'));
  if (!Array.isArray(d.paginas)) morre('manifesto sem a lista "paginas"');
  const vistos = new Set();
  for (const p of d.paginas) {
    if (!/^\/[a-z0-9-]+\/$/.test(p.slug)) morre(`slug fora do formato: ${p.slug}`);
    if (vistos.has(p.slug)) morre(`slug repetido no manifesto: ${p.slug}`);
    vistos.add(p.slug);
  }
  return d;
}

function caminhoPendente(slug) {
  return path.join(PENDENTES, slug.replace(/^\/|\/$/g, ''), 'index.html');
}

function caminhoPublico(slug) {
  return path.join(PUBLICO, slug.replace(/^\/|\/$/g, ''), 'index.html');
}

// A ordem do manifesto E a ordem de publicacao. Quem esta primeiro sai primeiro,
// e por isso a lista comeca pela pagina de maior valor.
const manifesto = leManifesto();
const publicadas = manifesto.paginas.filter((p) => p.publicadoEm);
const naFila = manifesto.paginas.filter((p) => !p.publicadoEm);

if (SO_STATUS || !naFila.length) {
  console.log(`rollout: ${publicadas.length} publicada(s), ${naFila.length} na fila`);
  console.log();
  for (const p of manifesto.paginas) {
    const onde = p.publicadoEm
      ? `publicada em ${p.publicadoEm}`
      : (fs.existsSync(caminhoPendente(p.slug)) ? 'pronta, aguardando a vez' : 'SEM ARQUIVO em content/pending/');
    console.log(`  ${p.slug.padEnd(38)} ${onde}`);
  }
  console.log();
  if (naFila.length) {
    console.log(`Proximo lote (${Math.min(LOTE, naFila.length)}):`);
    for (const p of naFila.slice(0, LOTE)) console.log(`  ${p.slug}`);
  } else {
    console.log('Fila vazia: nada a publicar.');
  }
  process.exit(0);
}

// Um lote por dia. Rodar duas vezes no mesmo dia nao publica seis.
const jaHoje = publicadas.filter((p) => p.publicadoEm === hoje());
if (jaHoje.length >= LOTE) {
  console.log(`rollout: o lote de ${hoje()} ja saiu (${jaHoje.map((p) => p.slug).join(', ')}).`);
  process.exit(0);
}

const lote = naFila.slice(0, LOTE - jaHoje.length);
// Uma execucao pode morrer DEPOIS de mover e ANTES de registrar a data, e foi
// o que aconteceu na primeira vez, quando o deploy nao conseguiu invocar o
// wrangler. Nesse estado a pagina esta em public/ e o manifesto ainda diz que
// nao saiu: a execucao seguinte retoma dali em vez de travar.
for (const p of lote) {
  const emPendente = fs.existsSync(caminhoPendente(p.slug));
  const emPublico = fs.existsSync(caminhoPublico(p.slug));
  if (emPendente && emPublico) {
    morre(`${p.slug}: existe em content/pending/ E em public/. Apague um dos dois antes de seguir`);
  }
  if (!emPendente && !emPublico) {
    morre(`${p.slug}: nao ha arquivo em ${path.relative(RAIZ, caminhoPendente(p.slug))}`);
  }
  p._retomada = emPublico;
  if (emPublico) console.log(`  ${p.slug} ja estava em public/: retomando execucao interrompida`);
}

console.log(`rollout: lote de ${hoje()} — ${lote.length} pagina(s)`);
for (const p of lote) console.log(`  ${p.slug}`);
console.log();

if (SECO) {
  console.log('--dry-run: nada movido, nada publicado, nada enviado ao IndexNow.');
  process.exit(0);
}

// 1. move para public/
for (const p of lote) {
  if (p._retomada) continue;
  const destino = caminhoPublico(p.slug);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(caminhoPendente(p.slug), destino);
  fs.rmSync(path.dirname(caminhoPendente(p.slug)), { recursive: true, force: true });
  console.log(`  movida  ${path.relative(RAIZ, destino)}`);
}

// shell: true no Windows porque npx e wrangler sao shims .cmd, e execFileSync
// sem shell nao os resolve. Falhou exatamente aqui na primeira execucao real.
const roda = (cmd, args) => execFileSync(cmd, args, {
  cwd: RAIZ, stdio: 'inherit', shell: process.platform === 'win32',
});

// 2. build e validacao ANTES de publicar. Se o guard rail reprovar, a pagina
//    volta para a fila: e melhor atrasar um dia do que publicar quebrado.
try {
  roda('node', ['build.mjs']);
  roda('node', ['tools/validate.mjs']);
} catch {
  for (const p of lote) {
    if (p._retomada) continue;
    const origem = caminhoPublico(p.slug);
    const volta = caminhoPendente(p.slug);
    fs.mkdirSync(path.dirname(volta), { recursive: true });
    fs.copyFileSync(origem, volta);
    fs.rmSync(path.dirname(origem), { recursive: true, force: true });
  }
  morre('build ou validacao reprovou; o lote voltou para content/pending/ e nada foi publicado');
}

// 3. deploy
roda('npx', ['wrangler', 'pages', 'deploy', 'public', '--project-name=kingofaeo', '--branch=main']);

// 4. IndexNow SO com as URLs do lote. A fila e escrita aqui e o envio continua
//    sendo o tools/indexnow.mjs, que ja trata chave, host e resposta.
fs.writeFileSync(FILA, `${JSON.stringify(lote.map((p) => SITE + p.slug), null, 2)}\n`, 'utf8');
roda('node', ['tools/indexnow.mjs']);

// 5. so agora o manifesto registra a data
for (const p of lote) { p.publicadoEm = hoje(); delete p._retomada; }
fs.writeFileSync(MANIFESTO, `${JSON.stringify(manifesto, null, 2)}\n`, 'utf8');
console.log();
console.log(`rollout: lote de ${hoje()} publicado. Restam ${naFila.length - lote.length} na fila.`);
