#!/usr/bin/env node
// monitor.mjs — instrumento de medicao de citacao em answer engines.
//
//   node tools/aeo-monitor/monitor.mjs runsheet <cliente>
//   node tools/aeo-monitor/monitor.mjs check    <cliente>
//   node tools/aeo-monitor/monitor.mjs report   <cliente>
//
// ISTO NAO E UM SCRAPER, E A DECISAO E DELIBERADA.
//
// Em 25 e 26 de setembro de 2026, tentando montar o citation log do
// kingofaeo.pro, ficou provado o seguinte: Claude exige conta, Gemini responde
// uma vez e depois recusa, Bing devolve pagina de bloqueio, Google devolve
// CAPTCHA no dominio brasileiro, e o ChatGPT deu duas respostas diferentes para
// o mesmo prompt com minutos de diferenca.
//
// Um scraper nessas condicoes nao produz dado: produz dado falso com aparencia
// de dado. Bloqueio vira "nenhum nome retornado", e ninguem percebe seis meses
// depois. Entao este programa nao consulta engine nenhum. Ele faz as tres
// coisas que sustentam a medicao:
//
//   runsheet  diz exatamente o que rodar nesta semana, e em que ordem;
//   check     recusa o arquivo se a disciplina foi quebrada;
//   report    transforma as observacoes num relatorio que o cliente entende.
//
// O operador humano roda as consultas e anota. O valor do servico e a
// disciplina e o registro, nao a automacao.

import fs from 'node:fs';
import path from 'node:path';

const RAIZ = import.meta.dirname ?? process.cwd();
const COLUNAS = ['date', 'engine', 'locale', 'query', 'brand_named', 'name_returned',
  'link_cited', 'domain_cited', 'entity_resolved'];
const SIM_NAO = new Set(['yes', 'no']);
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCALE_RE = /^[A-Z]{2} · [a-z]{2}(-[A-Za-z]{2,4})?$/;

function morre(msg) {
  console.error(`monitor: ${msg}`);
  process.exit(1);
}

const isoValida = (s) => DATA_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

function leCliente(slug) {
  if (!/^[a-z0-9-]+$/.test(slug || '')) morre('nome de cliente invalido: use minusculas, numeros e hifen');
  const p = path.join(RAIZ, 'clients', `${slug}.json`);
  if (!fs.existsSync(p)) morre(`cliente nao encontrado: ${path.relative(RAIZ, p)}`);
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const k of ['brand', 'entity', 'own_domains', 'queries', 'engines', 'locales']) {
    if (!c[k]) morre(`clients/${slug}.json: falta "${k}"`);
  }
  for (const k of ['own_domains', 'queries', 'engines', 'locales']) {
    if (!Array.isArray(c[k]) || !c[k].length) morre(`clients/${slug}.json: "${k}" deve ser lista nao vazia`);
  }
  for (const l of c.locales) {
    if (!LOCALE_RE.test(l)) morre(`clients/${slug}.json: locale "${l}" deve ser no formato "BR · pt-BR"`);
  }
  c.slug = slug;
  return c;
}

function csvLinha(linha, onde) {
  const campos = [];
  let campo = '';
  let dentro = false;
  for (let i = 0; i < linha.length; i += 1) {
    const ch = linha[i];
    if (dentro) {
      if (ch === '"') { if (linha[i + 1] === '"') { campo += '"'; i += 1; } else dentro = false; } else campo += ch;
    } else if (ch === '"') {
      if (campo !== '') morre(`${onde}: aspas so podem abrir um campo`);
      dentro = true;
    } else if (ch === ',') { campos.push(campo); campo = ''; } else campo += ch;
  }
  if (dentro) morre(`${onde}: campo com aspas nao fechadas`);
  campos.push(campo);
  return campos.map((v) => v.trim());
}

function caminhoObs(c) { return path.join(RAIZ, 'observations', `${c.slug}.csv`); }

function leObservacoes(c) {
  const p = caminhoObs(c);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `${COLUNAS.join(',')}\n# Linhas iniciadas por # sao ignoradas.\n`, 'utf8');
    console.log(`criado ${path.relative(RAIZ, p)} com o cabecalho`);
    return [];
  }
  const uteis = fs.readFileSync(p, 'utf8').replace(/\r\n?/g, '\n').split('\n')
    .map((texto, i) => ({ texto, n: i + 1 }))
    .filter(({ texto }) => texto.trim() && !texto.trimStart().startsWith('#'));
  if (!uteis.length) morre(`${path.relative(RAIZ, p)}: nem o cabecalho`);
  const cab = csvLinha(uteis[0].texto, 'cabecalho');
  if (cab.join(',') !== COLUNAS.join(',')) {
    morre(`${path.relative(RAIZ, p)}: cabecalho deve ser exatamente "${COLUNAS.join(',')}"`);
  }
  return uteis.slice(1).map(({ texto, n }) => {
    const onde = `linha ${n}`;
    const v = csvLinha(texto, onde);
    if (v.length !== COLUNAS.length) morre(`${onde}: esperava ${COLUNAS.length} campos, veio ${v.length}`);
    const r = Object.fromEntries(COLUNAS.map((k, i) => [k, v[i]]));
    r._linha = n;
    return r;
  });
}

// Valida com a mesma severidade do citation log: dado que nao passa aqui nao
// deveria ter sido gravado, e corrigir na origem e mais barato que descobrir
// depois que o relatorio de tres meses esta errado.
function valida(c, obs) {
  const engines = new Set(c.engines);
  const locales = new Set(c.locales);
  const queries = new Set(c.queries);
  const vistos = new Map();
  for (const r of obs) {
    const onde = `linha ${r._linha}`;
    if (!isoValida(r.date)) morre(`${onde}: "date" deve ser AAAA-MM-DD, veio "${r.date}"`);
    if (!engines.has(r.engine)) morre(`${onde}: engine "${r.engine}" nao esta na lista do cliente`);
    if (!locales.has(r.locale)) morre(`${onde}: locale "${r.locale}" nao esta na lista do cliente`);
    if (!queries.has(r.query)) morre(`${onde}: query fora da lista fixa do cliente. Mude a lista de proposito, nao a linha`);
    for (const k of ['brand_named', 'link_cited', 'entity_resolved']) {
      if (!SIM_NAO.has(r[k])) morre(`${onde}: "${k}" deve ser yes ou no, veio "${r[k]}"`);
    }
    if (r.link_cited === 'yes' && !r.domain_cited) morre(`${onde}: link_cited=yes exige "domain_cited"`);
    if (r.link_cited === 'no' && r.domain_cited) morre(`${onde}: link_cited=no exige "domain_cited" vazio`);
    if (r.brand_named === 'yes' && !r.name_returned) morre(`${onde}: brand_named=yes exige "name_returned"`);
    const chave = `${r.date}|${r.engine}|${r.locale}|${r.query}`;
    if (vistos.has(chave)) {
      morre(`${onde}: mesma combinacao ja registrada na linha ${vistos.get(chave)}. Uma observacao por engine, por locale, por query, por rodada: escolhe-se a rodada, nao a resposta`);
    }
    vistos.set(chave, r._linha);
  }
  return obs;
}

const rodadas = (obs) => [...new Set(obs.map((r) => r.date))].sort();
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : 'n/a');

function cmdRunsheet(c) {
  const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const total = c.queries.length * c.engines.length * c.locales.length;
  console.log(`# Runsheet ${c.brand} — ${hoje}`);
  console.log();
  console.log(`${total} observacoes. Sessao nova a cada engine, deslogado, sem memoria e sem personalizacao.`);
  console.log('Engine que bloquear, exigir conta ou travar NAO vira linha: fica sem linha, e a ausencia aparece no relatorio.');
  console.log();
  let i = 0;
  for (const q of c.queries) {
    console.log(`## "${q}"`);
    for (const e of c.engines) {
      for (const l of c.locales) {
        i += 1;
        console.log(`  [ ] ${String(i).padStart(2)}. ${e} / ${l}`);
      }
    }
    console.log();
  }
  console.log('Para cada uma, anote: a marca foi nomeada, que nome veio, houve link, qual o primeiro dominio citado, e se a entidade foi resolvida.');
  console.log(`Depois: node tools/aeo-monitor/monitor.mjs check ${c.slug}`);
}

function cmdCheck(c, obs) {
  const rs = rodadas(obs);
  console.log(`${c.brand}: ${obs.length} observacoes em ${rs.length} rodada(s), sem erro de disciplina.`);
  if (!rs.length) return;
  const esperado = c.queries.length * c.engines.length * c.locales.length;
  for (const d of rs) {
    const n = obs.filter((r) => r.date === d).length;
    console.log(`  ${d}: ${n}/${esperado} (${pct(n, esperado)} de cobertura)`);
  }
}

function cmdReport(c, obs) {
  if (!obs.length) morre('sem observacoes: rode o runsheet e preencha o CSV primeiro');
  const rs = rodadas(obs);
  const ultima = rs[rs.length - 1];
  const anterior = rs.length > 1 ? rs[rs.length - 2] : null;
  const doDia = obs.filter((r) => r.date === ultima);
  const esperado = c.queries.length * c.engines.length * c.locales.length;
  const conta = (lista, k) => lista.filter((r) => r[k] === 'yes').length;
  const proprio = (lista) => lista.filter((r) => c.own_domains.some((d) => r.domain_cited === d)).length;

  const L = [];
  L.push(`# ${c.brand}: o que os answer engines respondem`);
  L.push('');
  L.push(`Rodada de ${ultima}. Entidade medida: ${c.entity}.`);
  L.push('');
  L.push(`Sessao nova a cada consulta, deslogado, sem memoria e sem personalizacao. ${c.queries.length} consultas fixas, ${c.engines.length} engines, ${c.locales.length} locale(s).`);
  L.push('');
  L.push('## Resumo');
  L.push('');
  L.push('| Medida | Rodada atual | Rodada anterior |');
  L.push('| --- | --- | --- |');
  const antDia = anterior ? obs.filter((r) => r.date === anterior) : [];
  const linha = (rotulo, f) => L.push(`| ${rotulo} | ${f(doDia)} | ${anterior ? f(antDia) : 'n/a'} |`);
  linha('Observacoes feitas', (x) => `${x.length} de ${esperado} (${pct(x.length, esperado)})`);
  linha('Marca nomeada', (x) => `${conta(x, 'brand_named')} de ${x.length} (${pct(conta(x, 'brand_named'), x.length)})`);
  linha('Resposta citou algum link', (x) => `${conta(x, 'link_cited')} de ${x.length} (${pct(conta(x, 'link_cited'), x.length)})`);
  linha('Link citado foi nosso', (x) => `${proprio(x)} de ${x.length} (${pct(proprio(x), x.length)})`);
  linha('Entidade resolvida', (x) => `${conta(x, 'entity_resolved')} de ${x.length} (${pct(conta(x, 'entity_resolved'), x.length)})`);
  L.push('');

  L.push('## Por engine e locale');
  L.push('');
  L.push('| Engine | Locale | Obs. | Marca nomeada | Link nosso | Entidade |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const e of c.engines) {
    for (const l of c.locales) {
      const x = doDia.filter((r) => r.engine === e && r.locale === l);
      if (!x.length) { L.push(`| ${e} | ${l} | nao observado | | | |`); continue; }
      L.push(`| ${e} | ${l} | ${x.length} | ${conta(x, 'brand_named')}/${x.length} | ${proprio(x)}/${x.length} | ${conta(x, 'entity_resolved')}/${x.length} |`);
    }
  }
  L.push('');

  const nomes = new Map();
  for (const r of doDia) {
    const nome = r.name_returned || '(nenhum nome)';
    nomes.set(nome, (nomes.get(nome) || 0) + 1);
  }
  L.push('## Nomes devolvidos');
  L.push('');
  for (const [nome, n] of [...nomes].sort((a, b) => b[1] - a[1])) L.push(`- ${nome}: ${n}`);
  L.push('');

  const faltando = [];
  for (const q of c.queries) for (const e of c.engines) for (const l of c.locales) {
    if (!doDia.some((r) => r.query === q && r.engine === e && r.locale === l)) faltando.push(`${e} / ${l} / "${q}"`);
  }
  L.push('## Nao observado nesta rodada');
  L.push('');
  if (!faltando.length) L.push('Nada: a rodada foi completa.');
  else {
    L.push('Estas combinacoes nao produziram observacao. Ausencia de observacao nao e ausencia de resultado, e por isso nao viram linha:');
    L.push('');
    for (const f of faltando) L.push(`- ${f}`);
  }
  L.push('');
  L.push('## Como conferir');
  L.push('');
  L.push('Toda linha deste relatorio sai de um CSV com data, engine, locale e consulta. Qualquer pessoa pode repetir as consultas nas mesmas condicoes e comparar. Respostas de IA variam entre execucoes: uma leitura e anedota, a serie e que informa.');

  const saida = path.join(RAIZ, 'reports', `${c.slug}-${ultima}.md`);
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.writeFileSync(saida, `${L.join('\n')}\n`, 'utf8');
  console.log(`escrito ${path.relative(RAIZ, saida)}`);
  console.log();
  console.log(L.slice(0, 22).join('\n'));
}

const [cmd, slug] = process.argv.slice(2);
if (!cmd || !slug) {
  console.log('uso: monitor.mjs <runsheet|check|report> <cliente>');
  process.exit(cmd ? 1 : 0);
}
const cliente = leCliente(slug);
if (cmd === 'runsheet') cmdRunsheet(cliente);
else if (cmd === 'check') cmdCheck(cliente, valida(cliente, leObservacoes(cliente)));
else if (cmd === 'report') cmdReport(cliente, valida(cliente, leObservacoes(cliente)));
else morre(`comando desconhecido: ${cmd}`);
