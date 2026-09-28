#!/usr/bin/env node
// validate.mjs — guard rails do site. Le o que o build escreveu e reprova.
//
//   node tools/validate.mjs            avisos nao quebram o build
//   node tools/validate.mjs --strict   todo aviso vira erro
//
// POR QUE EXISTEM DOIS NIVEIS.
//
// As regras de tamanho (description entre 120 e 158, title ate 60, minimo de
// 500 palavras, minimo de 2 links entrando) foram medidas contra o site real
// em 26 de setembro de 2026: 9 das 12 paginas reprovavam. Fazer o build quebrar
// naquele dia significaria reescrever 9 descriptions e 2 titles de paginas ja
// indexadas, o que e decisao editorial, nao decisao de build.
//
// Entao elas saem como AVISO, e o --strict existe para o dia em que o conteudo
// estiver ajustado. As regras que ninguem viola hoje (JSON-LD invalido, slug
// duplicado, link interno quebrado, referencia @id orfa) quebram desde ja: nao
// ha conflito, e sao as que causam dano real e silencioso.
//
// Este programa NAO escreve nada. Ele so le e reprova.

import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.join(import.meta.dirname ?? process.cwd(), '..');
const PUB = path.join(RAIZ, 'public');
const ESTRITO = process.argv.includes('--strict');

const LIMITES = {
  palavrasMin: 500,
  descMin: 120,
  descMax: 158,
  titleMax: 60,
  entrantesMin: 2,
};

// O /404.html e servido pelo Cloudflare quando nada casa. Nao tem canonical,
// nao tem JSON-LD, ninguem linka para ele e ele nao deve ter 500 palavras.
// Medi-lo pelas regras de conteudo so produziria ruido permanente no relatorio.
const SEM_REGRA_DE_CONTEUDO = new Set(['/404.html']);

const erros = [];
const avisos = [];
const falha = (url, msg) => erros.push({ url, msg });
const avisa = (url, msg) => (ESTRITO ? erros : avisos).push({ url, msg });

// ---------- leitura ----------

function paginas(dir = PUB, saida = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) paginas(p, saida);
    else if (e.name.endsWith('.html')) saida.push(p);
  }
  return saida;
}

function urlDe(abs) {
  const rel = path.relative(PUB, abs).split(path.sep).join('/');
  return rel === 'index.html' ? '/' : '/' + rel.replace(/index\.html$/, '');
}

function semMarcacao(html) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pega(html, re) {
  const m = html.match(re);
  return m ? m[1].trim() : '';
}

// Um href interno pode apontar para uma pagina, um arquivo servido ou uma
// ancora. Aqui so interessa se o alvo existe no que vai ser publicado.
function alvoExiste(href) {
  const limpo = href.split('#')[0].split('?')[0];
  if (!limpo || limpo === '/') return fs.existsSync(path.join(PUB, 'index.html'));
  const base = path.join(PUB, limpo.replace(/^\//, ''));
  if (limpo.endsWith('/')) return fs.existsSync(path.join(base, 'index.html'));
  return fs.existsSync(base) || fs.existsSync(path.join(base, 'index.html'));
}

function normaliza(href) {
  const limpo = href.split('#')[0].split('?')[0];
  return limpo === '' ? null : limpo;
}

// ---------- coleta ----------

const docs = paginas().map((abs) => {
  const html = fs.readFileSync(abs, 'utf8');
  const corpo = html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  const blocos = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]);
  return {
    abs,
    url: urlDe(abs),
    title: pega(html, /<title>([\s\S]*?)<\/title>/),
    desc: pega(html, /<meta name="description" content="([\s\S]*?)"\s*\/?>/),
    canonical: pega(html, /<link rel="canonical" href="([^"]+)"/),
    h1: semMarcacao(pega(html, /<h1[^>]*>([\s\S]*?)<\/h1>/)),
    palavras: semMarcacao(html).split(' ').filter(Boolean).length,
    // So o <body>. A checagem 1b compara o texto do JSON-LD com o que a pagina
    // mostra, e o bloco JSON-LD vive no <head>: comparar contra o documento
    // inteiro faria a string casar consigo mesma e a checagem passaria sempre.
    corpo,
    blocos,
    hrefs: [...corpo.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]),
  };
});

// ---------- 1. JSON-LD valido e sem referencia @id orfa ----------

for (const d of docs) {
  if (!d.blocos.length) {
    if (!SEM_REGRA_DE_CONTEUDO.has(d.url)) avisa(d.url, 'nenhum bloco JSON-LD');
    continue;
  }
  for (const [i, cru] of d.blocos.entries()) {
    let dado;
    try {
      dado = JSON.parse(cru);
    } catch (e) {
      falha(d.url, `JSON-LD invalido no bloco ${i + 1}: ${e.message}`);
      continue;
    }
    const grafo = dado['@graph'] ?? [dado];
    const ids = grafo.map((n) => n && n['@id']).filter(Boolean);
    const repetido = ids.find((x, k) => ids.indexOf(x) !== k);
    if (repetido) falha(d.url, `@id repetido no @graph: ${repetido}`);
    const conhecidos = new Set(ids);
    // So e orfa a referencia a um fragmento DESTE documento. Um @id como
    // https://kingofaeo.pro/#article citado em /feed/ aponta para o no que a
    // home define, e isso e o proposito de @id global e estavel: ligar dados
    // entre documentos. A primeira versao desta regra reprovou 63 referencias
    // legitimas do feed e barrou o deploy. O erro era da regra.
    const base = d.canonical ? d.canonical.split('#')[0] : null;
    const visita = (n) => {
      if (Array.isArray(n)) return n.forEach(visita);
      if (!n || typeof n !== 'object') return;
      const chaves = Object.keys(n);
      if (chaves.length === 1 && chaves[0] === '@id') {
        const ref = String(n['@id']);
        const [doc, frag] = [ref.split('#')[0], ref.includes('#')];
        if (frag && base && doc === base && !conhecidos.has(ref)) {
          falha(d.url, `referencia @id orfa no proprio documento: ${ref}`);
        }
      }
      Object.values(n).forEach(visita);
    };
    visita(grafo);
  }
}

// ---------- 1b. a nota tem que estar na pagina, e nao so no grafo ----------
//
// ClaimReview cuja nota nao aparece no conteudo visivel e marcacao invalida:
// afirma para a maquina uma avaliacao que o leitor humano nao encontra. Esta
// checagem compara reviewRating.alternateName e reviewRating.ratingExplanation,
// palavra por palavra, com o texto renderizado da MESMA pagina.
//
// Ela e erro e nao aviso de proposito. O argumento inteiro deste site e que
// alegacao sem lastro conferivel nao vale; publicar uma nota que so existe no
// JSON-LD seria cometer, na propria marcacao, o defeito que as paginas cobram
// dos outros. Entao o build cai.
//
// A decodificacao de entidade existe porque o texto do JSON-LD traz caracteres
// que o HTML pode carregar escapados. Sem ela, "criteria — self-reported" e
// "criteria &mdash; self-reported" pareceriam textos diferentes sendo o mesmo.

function decodifica(s) {
  return s
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&lsquo;/g, '‘').replace(/&rsquo;/g, '’')
    .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
    .replace(/&nbsp;/g, ' ').replace(/&hellip;/g, '…')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const normalizaTexto = (s) => decodifica(s).replace(/\s+/g, ' ').trim();

function colheClaimReviews(no, saida = []) {
  if (Array.isArray(no)) { no.forEach((n) => colheClaimReviews(n, saida)); return saida; }
  if (!no || typeof no !== 'object') return saida;
  const t = no['@type'];
  if (t === 'ClaimReview' || (Array.isArray(t) && t.includes('ClaimReview'))) saida.push(no);
  Object.values(no).forEach((v) => colheClaimReviews(v, saida));
  return saida;
}

for (const d of docs) {
  const visivel = normalizaTexto(semMarcacao(d.corpo ?? ''));
  for (const cru of d.blocos) {
    let dado;
    try { dado = JSON.parse(cru); } catch { continue; }
    for (const cr of colheClaimReviews(dado['@graph'] ?? dado)) {
      const r = cr.reviewRating;
      if (!r || typeof r !== 'object') {
        falha(d.url, 'ClaimReview sem reviewRating');
        continue;
      }
      for (const campo of ['alternateName', 'ratingExplanation']) {
        const valor = r[campo];
        if (typeof valor !== 'string' || valor.trim() === '') {
          falha(d.url, `ClaimReview: reviewRating.${campo} ausente ou vazio`);
          continue;
        }
        if (!visivel.includes(normalizaTexto(valor))) {
          const trecho = valor.length > 60 ? `${valor.slice(0, 57)}...` : valor;
          falha(d.url, `ClaimReview: reviewRating.${campo} nao aparece no texto visivel da pagina: "${trecho}"`);
        }
      }
    }
  }
}

// ---------- 2. slug duplicado ----------

const porCanonical = new Map();
for (const d of docs) {
  if (!d.canonical) {
    if (!SEM_REGRA_DE_CONTEUDO.has(d.url)) avisa(d.url, 'sem <link rel="canonical">');
    continue;
  }
  const antes = porCanonical.get(d.canonical);
  if (antes) falha(d.url, `canonical duplicado, ja usado por ${antes}: ${d.canonical}`);
  else porCanonical.set(d.canonical, d.url);
}

// ---------- 3. link interno quebrado, e grafo de links ----------

const entrando = new Map(docs.map((d) => [d.url, new Set()]));
for (const d of docs) {
  const daqui = new Set();
  for (const href of d.hrefs) {
    const alvo = normaliza(href);
    if (!alvo) continue;
    if (!alvoExiste(alvo)) {
      falha(d.url, `link interno quebrado: ${alvo}`);
      continue;
    }
    if (entrando.has(alvo) && alvo !== d.url) daqui.add(alvo);
  }
  for (const alvo of daqui) entrando.get(alvo).add(d.url);
}

// ---------- 4. regras de tamanho e de ligacao ----------

for (const d of docs) {
  if (SEM_REGRA_DE_CONTEUDO.has(d.url)) continue;
  if (d.palavras < LIMITES.palavrasMin) {
    avisa(d.url, `${d.palavras} palavras, minimo ${LIMITES.palavrasMin}`);
  }
  if (!d.desc) {
    avisa(d.url, 'sem meta description');
  } else if (d.desc.length < LIMITES.descMin || d.desc.length > LIMITES.descMax) {
    avisa(d.url, `description com ${d.desc.length} caracteres, fora de ${LIMITES.descMin}-${LIMITES.descMax}`);
  }
  if (d.title.length > LIMITES.titleMax) {
    avisa(d.url, `title com ${d.title.length} caracteres, maximo ${LIMITES.titleMax}`);
  }
  if (!d.h1) avisa(d.url, 'sem <h1>');
  const n = entrando.get(d.url).size;
  if (n < LIMITES.entrantesMin) {
    avisa(d.url, `${n} pagina(s) apontando para ela, minimo ${LIMITES.entrantesMin}`);
  }
}

// ---------- 5. cluster /questions/: minimo de links entrando, e isto REPROVA ----------
//
// Nao e aviso. O cluster existe para que estas paginas parem de depender de um
// unico link, e uma regra que so avisa nao garante nada. O hub da um link, a
// anterior ou a proxima da outro, e a irmã em Related da o terceiro: se o
// numero cair abaixo de tres, alguma dessas ligacoes se perdeu e o build para.
// Todas as paginas do cluster, publicadas ou nao. As que ainda estao em
// content/pending/ sao ignoradas abaixo; as que ja sairam tem de ter tres.
const CLUSTER_PERGUNTAS = [
  '/aeo-vs-geo/',
  '/aeo-vs-seo/',
  '/how-to-measure-aeo/',
  '/how-to-do-aeo/',
  '/how-much-does-aeo-cost/',
  '/aeo-tools/',
  '/how-to-optimize-a-page-for-aeo/',
  '/why-is-aeo-important/',
  '/how-to-rank-in-ai-overviews/',
  '/how-to-get-cited-by-chatgpt/',
];
const MIN_ENTRANDO_PERGUNTAS = 3;

// Pagina publicada HOJE fica de fora da regra por um dia. Nao e afrouxamento:
// numa fila que sai de dois em dois, a segunda do lote so ganha o terceiro
// link quando a irma dela sair, no lote seguinte. Exigir os tres no mesmo dia
// faria a regra impedir a publicacao que ela existe para qualificar. No
// proximo build ela e cobrada como todas as outras.
// O lote em execucao chega pelo ambiente, posto por tools/rollout.mjs. Ler do
// manifesto nao funciona: o rollout so grava publicadoEm DEPOIS de o validador
// passar, entao durante a validacao a pagina ainda nao consta como publicada.
// Duas fontes, e as duas sao necessarias. Durante a execucao do rollout o
// manifesto ainda nao registrou a publicacao, entao o lote vem do ambiente.
// Depois dela, no resto do dia, qualquer build precisa dar a mesma carencia,
// senao o site fica sem poder subir ate a irma da pagina sair no dia seguinte.
const publicadasHoje = (() => {
  const s = new Set((process.env.ROLLOUT_BATCH ?? '').split(',').map((x) => x.trim()).filter(Boolean));
  try {
    const m = JSON.parse(fs.readFileSync(path.join(RAIZ, 'tools/rollout.json'), 'utf8'));
    const hoje = new Date().toISOString().slice(0, 10);
    for (const p of m.paginas) if (p.publicadoEm === hoje) s.add(p.slug);
  } catch { /* sem manifesto, vale so o ambiente */ }
  return s;
})();
for (const url of CLUSTER_PERGUNTAS) {
  if (!entrando.has(url)) continue;  // ainda em content/pending/, nao publicada
  const n = entrando.get(url).size;
  if (publicadasHoje.has(url)) {
    if (n < MIN_ENTRANDO_PERGUNTAS) {
      avisa(url, `${n} link(s) entrando, publicada neste lote; cobrada a partir do proximo build`);
    }
    continue;
  }
  if (n < MIN_ENTRANDO_PERGUNTAS) {
    falha(url, `${n} pagina(s) apontando para ela; o cluster /questions/ exige ${MIN_ENTRANDO_PERGUNTAS}`);
  }
}

// ---------- relatorio ----------

docs.sort((a, b) => a.url.localeCompare(b.url));
const larg = Math.max(...docs.map((d) => d.url.length), 3);
console.log(`validate: ${docs.length} paginas${ESTRITO ? '  (--strict: todo aviso e erro)' : ''}`);
console.log();
console.log(`${'URL'.padEnd(larg)}  ${'pal'.padStart(5)}  ${'ttl'.padStart(3)}  ${'desc'.padStart(4)}  ${'ent'.padStart(3)}`);
console.log('-'.repeat(larg + 24));
for (const d of docs) {
  console.log(`${d.url.padEnd(larg)}  ${String(d.palavras).padStart(5)}  `
    + `${String(d.title.length).padStart(3)}  ${String(d.desc.length).padStart(4)}  `
    + `${String(entrando.get(d.url).size).padStart(3)}`);
}
console.log();

const mostra = (rotulo, lista) => {
  if (!lista.length) return;
  console.log(`${rotulo} (${lista.length}):`);
  for (const { url, msg } of lista) console.log(`  ${url}  ${msg}`);
  console.log();
};
mostra('ERRO', erros);
mostra('AVISO', avisos);

if (erros.length) {
  console.error(`validate: ${erros.length} erro(s). Build reprovado.`);
  process.exit(1);
}
console.log(avisos.length
  ? `validate: sem erros, ${avisos.length} aviso(s). Rode com --strict para trata-los como erro.`
  : 'validate: tudo passa, inclusive em --strict.');
