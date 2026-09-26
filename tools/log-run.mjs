#!/usr/bin/env node
// log-run.mjs — grava uma run no citation log e regenera o que depende dela.
//
//   node tools/log-run.mjs --date 2026-10-03 --engine ChatGPT --locale "US · en" \
//        --prompt "king of aeo" --name "James Dooley" --domain usatoday.com --entity yes
//
//   node tools/log-run.mjs --json '{"date":"...","engine":"...", ...}'
//   node tools/log-run.mjs --json runs.json        # arquivo com um objeto ou uma lista
//   node tools/log-run.mjs --dry-run ...           # valida e mostra, sem gravar
//
// O que ele faz, nesta ordem: valida a run contra as listas fixas, acrescenta
// ao public/citation-log.csv, roda o build (que regenera a pagina da semana, o
// CSV da semana e o hub) e avisa se a semana corrente ainda nao tem runs
// suficientes para virar pagina.
//
// O que ele NAO faz: consultar engine nenhum. O dado entra a mao porque foi
// observado a mao. Vide tools/aeo-monitor/README.md para o porque.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RAIZ = path.join(import.meta.dirname ?? process.cwd(), '..');
const CSV = path.join(RAIZ, 'public/citation-log.csv');
const MIN_RUNS_SEMANA = 5;

const COLUNAS = ['date', 'engine', 'locale', 'prompt', 'name_returned',
  'link_cited', 'domain_cited', 'entity_resolved'];
const SIM_NAO = new Set(['yes', 'no']);

function morre(msg) {
  console.error(`log-run: ${msg}`);
  process.exit(1);
}

// ---------- listas fixas, lidas do build para nao existirem em dois lugares ----------

function listasDoBuild() {
  const src = fs.readFileSync(path.join(RAIZ, 'build.mjs'), 'utf8');
  const engines = src.match(/const CITACAO_ENGINES = \[([\s\S]*?)\];/);
  const prompts = src.match(/const CITACAO_PROMPTS = \[([\s\S]*?)\];/);
  if (!engines || !prompts) morre('nao achei CITACAO_ENGINES ou CITACAO_PROMPTS em build.mjs');
  const extrai = (s) => [...s.matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
  return { engines: extrai(engines[1]), prompts: extrai(prompts[1]) };
}

// ---------- entrada ----------

const argv = process.argv.slice(2);
const SECO = argv.includes('--dry-run');
const pega = (nome) => {
  const i = argv.indexOf(`--${nome}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

function daLinhaDeComando() {
  const mapa = {
    date: 'date', engine: 'engine', locale: 'locale', prompt: 'prompt',
    name: 'name_returned', domain: 'domain_cited', entity: 'entity_resolved',
  };
  const r = {};
  for (const [flag, coluna] of Object.entries(mapa)) {
    const v = pega(flag);
    if (v !== undefined) r[coluna] = v;
  }
  return Object.keys(r).length ? [r] : [];
}

function daJson() {
  const v = pega('json');
  if (v === undefined) return [];
  const bruto = fs.existsSync(v) ? fs.readFileSync(v, 'utf8') : v;
  let d;
  try {
    d = JSON.parse(bruto);
  } catch (e) {
    morre(`--json nao e JSON valido nem caminho de arquivo: ${e.message}`);
  }
  return Array.isArray(d) ? d : [d];
}

const entradas = [...daJson(), ...daLinhaDeComando()];
if (!entradas.length) {
  console.log('uso: log-run.mjs --date ... --engine ... --locale ... --prompt ... '
    + '--name ... --domain ... --entity yes|no');
  console.log('     log-run.mjs --json \'{"date":"..."}\'   ou   --json arquivo.json');
  process.exit(0);
}

// ---------- validacao ----------

const { engines, prompts } = listasDoBuild();
const existentes = fs.readFileSync(CSV, 'utf8').split(/\r?\n/)
  .filter((l) => l && !l.startsWith('#'));
const cabecalho = existentes[0];
if (cabecalho !== COLUNAS.join(',')) {
  morre(`public/citation-log.csv: cabecalho inesperado${'\n'}  esperado: ${COLUNAS.join(',')}${'\n'}  veio:     ${cabecalho}`);
}

// Chave de unicidade igual a do build: uma observacao por engine, por locale,
// por prompt, por data. Escolhe-se a rodada, nao a resposta.
const vistos = new Set(existentes.slice(1).map((l) => {
  const v = l.split(',');
  return `${v[0]}|${v[1]}|${v[2]}|${v[3]}`;
}));

const novas = [];
for (const [i, bruta] of entradas.entries()) {
  const onde = `run ${i + 1}`;
  const r = { ...bruta };

  // link_cited e derivado: se ha dominio, houve link. Nao se pede ao operador
  // um campo que o proprio dado ja responde.
  r.domain_cited = (r.domain_cited ?? '').trim();
  r.link_cited = r.domain_cited ? 'yes' : 'no';
  r.name_returned = (r.name_returned ?? '').trim();

  for (const c of ['date', 'engine', 'locale', 'prompt', 'entity_resolved']) {
    if (!r[c]) morre(`${onde}: falta "${c}"`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) morre(`${onde}: "date" deve ser AAAA-MM-DD, veio ${r.date}`);
  if (!engines.includes(r.engine)) {
    morre(`${onde}: engine ${JSON.stringify(r.engine)} fora da lista: ${engines.join(', ')}`);
  }
  if (!prompts.includes(r.prompt)) {
    morre(`${onde}: prompt fora da lista fixa. Mudar a lista e decisao, e se faz em `
      + 'CITACAO_PROMPTS no build.mjs, que reescreve a pagina junto.');
  }
  if (!SIM_NAO.has(r.entity_resolved)) morre(`${onde}: "entity" deve ser yes ou no`);
  if (!/^[A-Z]{2} · [a-z]{2}(-[A-Za-z]{2,4})?$/.test(r.locale)) {
    morre(`${onde}: "locale" fora do formato, exemplo: "US · en" ou "BR · pt-BR"`);
  }

  const chave = `${r.date}|${r.engine}|${r.locale}|${r.prompt}`;
  if (vistos.has(chave)) {
    morre(`${onde}: ja existe observacao para ${r.engine} / ${r.locale} nesta data e neste prompt. `
      + 'Uma por combinacao: escolhe-se a rodada, nao a resposta.');
  }
  vistos.add(chave);
  novas.push(r);
}

const campo = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const linhas = novas.map((r) => COLUNAS.map((c) => campo(r[c] ?? '')).join(','));

console.log(`log-run: ${novas.length} run(s) validada(s)`);
for (const l of linhas) console.log(`  ${l.slice(0, 120)}`);

if (SECO) {
  console.log('--dry-run: nada gravado.');
  process.exit(0);
}

// ---------- grava e regenera ----------

const texto = fs.readFileSync(CSV, 'utf8');
fs.writeFileSync(CSV, texto.replace(/\r?\n*$/, '\n') + linhas.join('\n') + '\n', 'utf8');
console.log(`log-run: gravado em public/citation-log.csv`);

execFileSync('node', ['build.mjs'], { cwd: RAIZ, stdio: 'inherit' });

// ---------- aviso sobre a semana corrente ----------

function semanaIso(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const alvo = new Date(d);
  alvo.setUTCDate(alvo.getUTCDate() + 4 - (alvo.getUTCDay() || 7));
  const ano = alvo.getUTCFullYear();
  const n = Math.ceil(((alvo - new Date(Date.UTC(ano, 0, 1))) / 86400000 + 1) / 7);
  return `${ano}-w${n}`;
}

const atual = semanaIso(novas[novas.length - 1].date);
const daSemana = fs.readFileSync(CSV, 'utf8').split(/\r?\n/)
  .filter((l) => l && !l.startsWith('#'))
  .slice(1)
  .filter((l) => semanaIso(l.split(',')[0]) === atual);

console.log();
if (daSemana.length < MIN_RUNS_SEMANA) {
  console.log(`log-run: ATENCAO. A semana ${atual} tem ${daSemana.length} run(s), abaixo de `
    + `${MIN_RUNS_SEMANA}. A pagina da semana NAO foi gerada, de proposito: melhor nao existir do `
    + 'que existir fina. Faltam ' + (MIN_RUNS_SEMANA - daSemana.length) + '.');
} else {
  console.log(`log-run: semana ${atual} com ${daSemana.length} runs. Pagina gerada.`);
  console.log(`         Se a nota editorial dela ainda nao existe, o build ja teria reprovado: `
    + 'escreva em data/citation-weeks.json o que mudou na semana.');
}
