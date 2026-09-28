#!/usr/bin/env node
// build.mjs — kingofaeo.pro build step. Plain Node ESM, zero dependencies.
// Run from the repo root:  node build.mjs
//
// Reads  data/site.json, data/timeline.json, data/scoreboard.json, data/entity.json
// Patches public/index.html, public/king-of-aeo-contest/index.html
// Gera  public/llms-full.txt, public/sitemap-pages.xml e o indice public/sitemap.xml
// Le   public/citation-log.csv e monta a tabela de /citation-log/, o Dataset dela
//      e o bloco "latest run" do topo da home
//
// data/entity.json e a fonte unica do sameAs e da linha de rodape. A terceira pagina
// que declara o mesmo Person, public/feed/index.html, e gerada por tools/build_feed.py,
// que le o MESMO arquivo. Depois de editar data/entity.json rode os dois builds.
// Throws (non-zero exit) when any expected marker, <meta> selector or JSON-LD node is missing.
// Idempotent: running it twice produces byte-identical files.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = import.meta.dirname ?? process.cwd();
const SITE = 'https://kingofaeo.pro';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AS_OF_UPPER = /As of \d{1,2} [A-Z][a-z]+ 2026/g;
const AS_OF_LOWER = /as of \d{1,2} [A-Z][a-z]+ 2026/g;
const JSONLD_RE = /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g;

const FILES = {
  site: 'data/site.json',
  timeline: 'data/timeline.json',
  scoreboard: 'data/scoreboard.json',
  entity: 'data/entity.json',
  evidence: 'data/evidence.json',
  videos: 'data/videos.json',
  home: 'public/index.html',
  contest: 'public/king-of-aeo-contest/index.html',
  song: 'public/king-of-aeo-song/index.html',
  feed: 'public/feed/index.html',
  // As tres de /archive/ sao escritas a mao e o build so passa nelas para
  // aplicar a politica de rel dos links externos.
  archiveIndex: 'public/archive/index.html',
  archiveLegend: 'public/archive/the-legend/index.html',
  archiveFiveLaws: 'public/archive/five-laws/index.html',
  sitemapIndex: 'public/sitemap.xml',
  sitemapPages: 'public/sitemap-pages.xml',
  sitemapImages: 'public/sitemap-images.xml',
  videoSitemap: 'public/sitemap-videos.xml',
  citationLog: 'public/citation-log/index.html',
  llms: 'public/llms.txt',
  llmsFull: 'public/llms-full.txt',
};

// ---------- helpers ----------

function fail(msg) { throw new Error(`build.mjs: ${msg}`); }

function isIsoDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function isoDateTime(iso) { return `${iso}T09:00:00-03:00`; }

function esc(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function readJson(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) fail(`${rel}: file not found`);
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); }
  catch (e) { fail(`${rel}: invalid JSON (${e.message})`); }
}

// Reads a text file, records whether it is predominantly CRLF, and normalises to LF for patching.
function readText(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) fail(`${rel}: file not found`);
  const raw = fs.readFileSync(abs, 'utf8');
  const crlf = (raw.match(/\r\n/g) || []).length;
  const lfOnly = (raw.match(/\n/g) || []).length - crlf;
  return { rel, abs, eol: crlf > lfOnly ? '\r\n' : '\n', text: raw.replace(/\r\n?/g, '\n') };
}

// Writes the file back with its original line-ending convention applied to the whole output.
function writeText(file) {
  const out = file.eol === '\r\n' ? file.text.replace(/\n/g, '\r\n') : file.text;
  const before = fs.readFileSync(file.abs, 'utf8');
  fs.writeFileSync(file.abs, out, 'utf8');
  console.log(`${before === out ? 'unchanged' : 'wrote'} ${file.rel}`);
}

// ---------- visible-text markers ----------

// <!-- build:KEY -->…<!-- /build -->  — replaces the text BETWEEN the markers, keeps the markers.
// A key may appear more than once (the home page repeats the date markers); every occurrence
// receives the same content.
function replaceMarker(file, key, inner) {
  const re = new RegExp(`(<!-- build:${escRe(key)} -->)([\\s\\S]*?)(<!-- /build -->)`, 'g');
  const n = [...file.text.matchAll(re)].length;
  if (n === 0) fail(`${file.rel}: missing marker <!-- build:${key} --> … <!-- /build -->`);
  file.text = file.text.replace(re, (_, open, __, close) => open + inner + close);
}

// Leading whitespace of the line that holds the opening marker (used to indent generated blocks).
function markerIndent(file, key) {
  const m = file.text.match(new RegExp(`^([ \\t]*)[^\\n]*<!-- build:${escRe(key)} -->`, 'm'));
  return m ? m[1] : '';
}

function block(file, key, lines) {
  const ind = markerIndent(file, key);
  return '\n' + lines.map((l) => `${ind}  ${l}`).join('\n') + '\n' + ind;
}

// ---------- <meta> attributes (no markers; selected by attribute) ----------

// selector is the literal attribute, e.g. name="description" or property="og:description".
// Exactly one <meta …selector…> tag must exist; its content="…" value is passed through fn.
function patchMeta(file, selector, fn) {
  const tagRe = new RegExp(`<meta\\b[^>]*\\s${escRe(selector)}[^>]*>`, 'g');
  const tags = [...file.text.matchAll(tagRe)];
  if (tags.length !== 1) fail(`${file.rel}: expected exactly 1 <meta ${selector}>, found ${tags.length}`);
  const tag = tags[0][0];
  const cm = tag.match(/\scontent="([^"]*)"/);
  if (!cm) fail(`${file.rel}: <meta ${selector}> has no content="…" attribute`);
  const newTag = tag.replace(cm[0], () => ` content="${fn(cm[1], `<meta ${selector}>`)}"`);
  file.text = file.text.replace(tag, () => newTag);
}

function asOfReplacer(file, re, replacement) {
  return (text, where) => {
    const found = re.test(text);
    re.lastIndex = 0;
    if (!found) fail(`${file.rel}: ${where} does not contain the pattern ${re.source}`);
    return text.replace(re, replacement);
  };
}

// ---------- JSON-LD (no markers; parsed, patched, re-serialised with 2-space indent) ----------

function hasType(node, type) {
  const t = node && node['@type'];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

function patchJsonLd(file, patch) {
  const blocks = [...file.text.matchAll(JSONLD_RE)];
  if (blocks.length !== 1) fail(`${file.rel}: expected exactly 1 <script type="application/ld+json"> block, found ${blocks.length}`);
  const [whole, open, body, close] = blocks[0];
  let obj;
  try { obj = JSON.parse(body); }
  catch (e) { fail(`${file.rel}: JSON-LD block is not valid JSON (${e.message})`); }
  const nodes = Array.isArray(obj) ? obj : Array.isArray(obj['@graph']) ? obj['@graph'] : [obj];
  const ofType = (type) => {
    const found = nodes.filter((n) => hasType(n, type));
    if (found.length === 0) fail(`${file.rel}: JSON-LD has no node with "@type":"${type}"`);
    return found;
  };
  patch(nodes, ofType);
  file.text = file.text.replace(whole, () => `${open}\n${JSON.stringify(obj, null, 2)}\n${close}`);
}

// ---------- sitemap ----------

// ---------- data validation + rendering ----------

function validateSite(site) {
  if (!site || typeof site !== 'object' || Array.isArray(site)) fail(`${FILES.site}: expected an object`);
  for (const k of ['claimSince', 'contestPublished']) {
    if (!isIsoDate(site[k])) fail(`${FILES.site}: "${k}" must be a YYYY-MM-DD date, got ${JSON.stringify(site[k])}`);
  }
  // Datas de modificação escritas à mão envelhecem em silêncio. Se alguém as
  // trouxer de volta, o build avisa em vez de ignorá-las e deixar duas fontes.
  for (const k of ['homeReviewed', 'contestEdited']) {
    if (site[k] !== undefined) {
      fail(`${FILES.site}: "${k}" is no longer read; the modification date now comes from git (see gitLastChange). Remove the field.`);
    }
  }
  return site;
}

function validateTimeline(items) {
  if (!Array.isArray(items)) fail(`${FILES.timeline}: expected an array`);
  items.forEach((it, i) => {
    if (!it || typeof it !== 'object') fail(`${FILES.timeline}: item ${i} is not an object`);
    if (!isIsoDate(it.sort)) fail(`${FILES.timeline}: item ${i} has an invalid "sort" ${JSON.stringify(it.sort)} (expected an ISO date YYYY-MM-DD)`);
    for (const k of ['dateLabel', 'who', 'event']) {
      if (typeof it[k] !== 'string') fail(`${FILES.timeline}: item ${i} is missing string field "${k}"`);
    }
    // eventLink marca um trecho do proprio texto do evento como link. O texto tem
    // de existir, exatamente uma vez, senao o link cairia no lugar errado ou em
    // lugar nenhum sem ninguem notar.
    if (it.eventLink !== undefined) {
      const el = it.eventLink;
      if (!el || typeof el !== 'object') fail(`${FILES.timeline}: item ${i} "eventLink" must be an object with text and url`);
      if (typeof el.text !== 'string' || el.text === '') fail(`${FILES.timeline}: item ${i} eventLink.text must be a non-empty string`);
      if (typeof el.url !== 'string' || !/^(https?:\/\/|\/)\S*$/.test(el.url)) fail(`${FILES.timeline}: item ${i} eventLink.url must be a URL or a root-relative path`);
      const n = it.event.split(el.text).length - 1;
      if (n !== 1) fail(`${FILES.timeline}: item ${i} eventLink.text ${JSON.stringify(el.text)} appears ${n} times in the event; it must appear exactly once`);
    }
    if (!Array.isArray(it.sources)) fail(`${FILES.timeline}: item ${i} "sources" must be an array`);
    it.sources.forEach((s, j) => {
      // Fonte sem "url" e deliberada: o dominio e citado pelo nome e o leitor e
      // mandado para a review interna daquele reivindicante, em "claimant".
      // Citar sem hiperlink continua sendo citar, e a URL segue publicada em
      // evidence.csv para quem quiser conferir.
      if (!s || typeof s.label !== 'string') fail(`${FILES.timeline}: item ${i} source ${j} needs a string "label"`);
      if (s.url !== undefined && typeof s.url !== 'string') fail(`${FILES.timeline}: item ${i} source ${j} "url" must be a string when present`);
      if (s.url === undefined && typeof s.claimant !== 'string') fail(`${FILES.timeline}: item ${i} source ${j} has no "url", so it needs "claimant" naming the review it points to`);
    });
  });
  return items;
}

function validateScoreboard(entries) {
  if (!Array.isArray(entries)) fail(`${FILES.scoreboard}: expected an array`);
  entries.forEach((e, i) => {
    if (!e || typeof e !== 'object') fail(`${FILES.scoreboard}: entry ${i} is not an object`);
    if (!isIsoDate(e.date)) fail(`${FILES.scoreboard}: entry ${i} has an invalid "date" ${JSON.stringify(e.date)} (expected YYYY-MM-DD)`);
    for (const k of ['engine', 'prompt', 'named', 'cited', 'locale', 'note']) {
      if (e[k] !== undefined && e[k] !== null && typeof e[k] !== 'string') fail(`${FILES.scoreboard}: entry ${i} field "${k}" must be a string`);
    }
  });
  return entries;
}

function validateEntity(ent) {
  if (!ent || typeof ent !== 'object' || Array.isArray(ent)) fail(`${FILES.entity}: expected an object`);
  const p = ent.person;
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail(`${FILES.entity}: "person" must be an object`);
  for (const k of ['id', 'name', 'url']) {
    if (typeof p[k] !== 'string' || p[k] === '') fail(`${FILES.entity}: "person.${k}" must be a non-empty string`);
  }
  if (!Array.isArray(p.sameAs) || p.sameAs.length === 0) fail(`${FILES.entity}: "person.sameAs" must be a non-empty array`);
  // A entidade so serve se estiver completa: campo que falta aqui some das doze
  // paginas de uma vez.
  for (const k of ['jobTitle', 'description', 'disambiguatingDescription', 'image']) {
    if (typeof p[k] !== 'string' || p[k] === '') fail(`${FILES.entity}: "person.${k}" must be a non-empty string`);
  }
  for (const k of ['alternateName', 'knowsAbout']) {
    if (!Array.isArray(p[k]) || p[k].length === 0) fail(`${FILES.entity}: "person.${k}" must be a non-empty array`);
  }
  for (const k of ['address', 'homeLocation']) {
    if (!p[k] || typeof p[k] !== 'object' || Array.isArray(p[k])) fail(`${FILES.entity}: "person.${k}" must be an object`);
  }
  const org = ent.organization;
  if (!org || typeof org !== 'object' || Array.isArray(org)) fail(`${FILES.entity}: "organization" must be an object`);
  for (const k of ['id', 'name', 'url']) {
    if (typeof org[k] !== 'string' || org[k] === '') fail(`${FILES.entity}: "organization.${k}" must be a non-empty string`);
  }
  // A marca e os quatro campos de politica. Cada um aponta para uma pagina
  // deste site, e cada pagina e conferida contra o disco: e esta checagem que
  // torna impossivel o campo sobreviver a remocao da pagina. Sem ela, o dia em
  // que alguem apagar /politica-de-correcao/ o schema continua prometendo uma
  // politica que devolve 404, que e pior que nao prometer nada.
  const brand = ent.brand;
  if (!brand || typeof brand !== 'object' || Array.isArray(brand)) fail(`${FILES.entity}: "brand" must be an object`);
  for (const k of ['id', 'name', 'url', 'description', 'foundingDate']) {
    if (typeof brand[k] !== 'string' || brand[k] === '') fail(`${FILES.entity}: "brand.${k}" must be a non-empty string`);
  }
  const POLITICAS = ['publishingPrinciples', 'correctionsPolicy', 'actionableFeedbackPolicy', 'ownershipFundingInfo'];
  for (const k of POLITICAS) {
    const u = brand[k];
    if (typeof u !== 'string' || !/^https?:\/\/\S+$/.test(u)) fail(`${FILES.entity}: "brand.${k}" must be an absolute http(s) URL`);
    if (!u.startsWith(`${SITE}/`)) fail(`${FILES.entity}: "brand.${k}" must be a page of ${SITE}, got ${u}`);
    const rel = `public${new URL(u).pathname}index.html`;
    if (!fs.existsSync(path.join(ROOT, rel))) {
      fail(`${FILES.entity}: "brand.${k}" points at ${u} but ${rel} does not exist; a schema field pointing at a 404 is worse than no field`);
    }
  }

  // Registro dos reivindicantes: @id canonico de site, um por pessoa.
  const cl = ent.claimants;
  if (!cl || typeof cl !== 'object' || Array.isArray(cl)) fail(`${FILES.entity}: "claimants" must be an object`);
  const slugs = Object.keys(cl).filter((k) => k !== '_comment');
  if (!slugs.length) fail(`${FILES.entity}: "claimants" has no entries`);
  const idsVistos = new Set();
  for (const slug of slugs) {
    const c = cl[slug];
    if (!c || typeof c !== 'object' || Array.isArray(c)) fail(`${FILES.entity}: "claimants.${slug}" must be an object`);
    for (const k of ['id', 'name', 'description']) {
      if (typeof c[k] !== 'string' || c[k] === '') fail(`${FILES.entity}: "claimants.${slug}.${k}" must be a non-empty string`);
    }
    // @id de site, nunca de pagina: e a diferenca entre uma entidade com sete
    // arestas e sete entidades com uma aresta cada.
    if (!/^https:\/\/kingofaeo\.pro\/#[a-z0-9-]+$/.test(c.id)) {
      fail(`${FILES.entity}: "claimants.${slug}.id" must be a site-level id like ${SITE}/#slug, got ${c.id}`);
    }
    if (idsVistos.has(c.id)) fail(`${FILES.entity}: "claimants.${slug}.id" duplicates ${c.id}`);
    idsVistos.add(c.id);
    if (c.sameAs !== undefined) {
      if (!Array.isArray(c.sameAs)) fail(`${FILES.entity}: "claimants.${slug}.sameAs" must be an array`);
      c.sameAs.forEach((u, i) => {
        if (typeof u !== 'string' || !/^https?:\/\/\S+$/.test(u)) fail(`${FILES.entity}: claimants.${slug}.sameAs[${i}] must be an absolute http(s) URL`);
      });
    }
  }

  const web = ent.website;
  if (!web || typeof web !== 'object' || Array.isArray(web)) fail(`${FILES.entity}: "website" must be an object`);
  for (const k of ['id', 'name', 'url']) {
    if (typeof web[k] !== 'string' || web[k] === '') fail(`${FILES.entity}: "website.${k}" must be a non-empty string`);
  }
  if (!Array.isArray(web.hasPart)) fail(`${FILES.entity}: "website.hasPart" must be an array`);
  if (p.subjectOf !== undefined) {
    if (!Array.isArray(p.subjectOf)) fail(`${FILES.entity}: "person.subjectOf" must be an array`);
    p.subjectOf.forEach((o, i) => {
      if (!o || typeof o !== 'object' || typeof o['@id'] !== 'string' || !/^https?:\/\/\S+$/.test(o['@id'])) {
        fail(`${FILES.entity}: person.subjectOf[${i}] needs an "@id" with an absolute http(s) URL`);
      }
    });
  }
  p.sameAs.forEach((u, i) => {
    if (typeof u !== 'string' || !/^https?:\/\/\S+$/.test(u)) fail(`${FILES.entity}: person.sameAs[${i}] must be an absolute http(s) URL, got ${JSON.stringify(u)}`);
  });
  // Duplicata em sameAs e erro de fato: o Google trata a lista como o conjunto de
  // perfis da entidade, e repetir uma URL so polui o grafo.
  const seen = new Set();
  for (const u of p.sameAs) {
    if (seen.has(u)) fail(`${FILES.entity}: person.sameAs has a duplicate entry ${JSON.stringify(u)}`);
    seen.add(u);
  }
  if (!Array.isArray(ent.footer)) fail(`${FILES.entity}: "footer" must be an array`);
  ent.footer.forEach((l, i) => {
    if (!l || typeof l !== 'object') fail(`${FILES.entity}: footer[${i}] is not an object`);
    if (typeof l.label !== 'string' || l.label === '') fail(`${FILES.entity}: footer[${i}] needs a non-empty string "label"`);
    if (typeof l.url !== 'string' || !/^https?:\/\/\S+$/.test(l.url)) fail(`${FILES.entity}: footer[${i}] "url" must be an absolute http(s) URL`);
    if (typeof l.rel !== 'boolean') fail(`${FILES.entity}: footer[${i}] "rel" must be true or false`);
    // Um perfil marcado com rel=me esta afirmando "esta pagina sou eu"; ele
    // precisa estar no sameAs, senao as duas declaracoes se contradizem.
    if (l.rel && !seen.has(l.url)) fail(`${FILES.entity}: footer[${i}] has rel=true but ${l.url} is not listed in person.sameAs`);
  });
  const dupFooter = ent.footer.map((l) => l.url).filter((u, i, a) => a.indexOf(u) !== i);
  if (dupFooter.length) fail(`${FILES.entity}: footer has duplicate URLs: ${[...new Set(dupFooter)].join(', ')}`);

  // dofollow: as duas listas que escapam do nofollow, além do sameAs.
  if (ent.dofollow !== undefined) {
    const d = ent.dofollow;
    if (!d || typeof d !== 'object' || Array.isArray(d)) fail(`${FILES.entity}: "dofollow" must be an object with "own" and "reference" arrays`);
    for (const key of Object.keys(d)) {
      if (key !== 'own' && key !== 'reference') fail(`${FILES.entity}: dofollow has unknown list "${key}"; only "own" and "reference" exist`);
      if (!Array.isArray(d[key])) fail(`${FILES.entity}: "dofollow.${key}" must be an array`);
      d[key].forEach((u, i) => {
        if (typeof u !== 'string' || !/^https?:\/\/\S+$/.test(u)) fail(`${FILES.entity}: dofollow.${key}[${i}] must be an absolute http(s) URL`);
        // Repetir no sameAs não quebra nada, mas indica que a entrada está no
        // lugar errado e que alguém vai editar a cópia que não vale.
        const inSameAs = [...seen].some((s) => stripSlash(s) === stripSlash(u));
        if (inSameAs) fail(`${FILES.entity}: dofollow.${key}[${i}] ${u} is already in person.sameAs; remove one of the two`);
      });
    }
    const all = [...(d.own || []), ...(d.reference || [])].map(stripSlash);
    const dupAll = all.filter((u, i, a) => a.indexOf(u) !== i);
    if (dupAll.length) fail(`${FILES.entity}: dofollow has duplicate URLs: ${[...new Set(dupAll)].join(', ')}`);
  }
  return ent;
}

// Renderiza <p class="elsewhere">…</p> exatamente como as paginas ja trazem hoje:
// links separados por " · ", rel="me" so nos perfis pessoais.
function renderFooterRow(links) {
  const parts = links.map((l) => (
    l.rel
      ? `<a href="${esc(l.url)}" rel="me">${esc(l.label)}</a>`
      : `<a href="${esc(l.url)}">${esc(l.label)}</a>`
  ));
  return `<p class="elsewhere">${parts.join(' · ')}</p>`;
}

// Substitui a linha de rodape. Precisa existir exatamente uma na pagina.
function patchFooterRow(file, row) {
  const re = /<p class="elsewhere">[\s\S]*?<\/p>/g;
  const found = [...file.text.matchAll(re)];
  if (found.length !== 1) fail(`${file.rel}: expected exactly 1 <p class="elsewhere"> row, found ${found.length}`);
  file.text = file.text.replace(found[0][0], () => row);
}

// Coleta todo no Person com este @id em qualquer profundidade do grafo.
// A busca precisa ser recursiva porque nem sempre o no esta na raiz do @graph:
// na pagina da musica ele vive dentro de MusicRecording.creator.

// Escreve sameAs e url no no Person cujo @id bate com o de data/entity.json.
// Filtrar por @id, e nao so por @type, importa: a home e a pagina do concurso
// citam os rivais como Person dentro de mentions, sem @id, e eles precisam
// continuar sem sameAs. Nos com @id igual se fundem no grafo, entao duas
// paginas que declarem o mesmo @id com listas diferentes se contradizem.

// ---------- tabela de evidências ----------

// Syndicated existe para o caso em que uma so distribuicao aparece em muitos
// dominios. Sem esse valor, a unica saida honesta seria chamar de Public record
// algo que o leitor leria como cobertura editorial.
// Observed: texto produzido por um sistema de terceiro, nao por este site e nao
// por um release. Nao e independente no sentido editorial, mas tambem nao e
// auto-declarado, e por isso merece nome proprio.
const EVIDENCE_STATUS = ['Public record', 'Self-reported', 'Syndicated', 'Observed', 'Independent'];

function validateEvidence(ev) {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) fail(`${FILES.evidence}: expected an object`);
  for (const k of ['datasetId', 'name', 'description', 'license', 'csvPath', 'csvUrl']) {
    if (typeof ev[k] !== 'string' || ev[k] === '') fail(`${FILES.evidence}: "${k}" must be a non-empty string`);
  }
  if (!Array.isArray(ev.rows) || ev.rows.length === 0) fail(`${FILES.evidence}: "rows" must be a non-empty array`);
  ev.rows.forEach((r, i) => {
    if (!r || typeof r !== 'object') fail(`${FILES.evidence}: rows[${i}] is not an object`);
    for (const k of ['date', 'evidence', 'type', 'where', 'status']) {
      if (typeof r[k] !== 'string' || r[k] === '') fail(`${FILES.evidence}: rows[${i}] needs a non-empty string "${k}"`);
    }
    // O status alimenta a leitura de confiança da página inteira: um valor fora
    // da lista descreveria a evidência de um jeito que o texto não explica.
    if (!EVIDENCE_STATUS.includes(r.status)) {
      fail(`${FILES.evidence}: rows[${i}] status ${JSON.stringify(r.status)} is not one of ${EVIDENCE_STATUS.join(', ')}`);
    }
    if (r.pending !== undefined && r.pending !== true) fail(`${FILES.evidence}: rows[${i}] "pending", when present, must be true`);
    if (!r.pending) {
      if (!isIsoDate(r.date) && r.date !== 'Ongoing') fail(`${FILES.evidence}: rows[${i}] date must be YYYY-MM-DD or "Ongoing", got ${JSON.stringify(r.date)}`);
      if (!/^https?:\/\/\S+$/.test(r.where)) fail(`${FILES.evidence}: rows[${i}] "where" must be an absolute http(s) URL`);
      // Uma linha publicada não pode carregar marcador de pendência.
      for (const k of ['date', 'evidence', 'type', 'where', 'status']) {
        if (r[k].includes('[[')) fail(`${FILES.evidence}: rows[${i}] "${k}" still holds a [[…]] placeholder but the row is not marked pending`);
      }
    }
  });
  return ev;
}

const published = (ev) => ev.rows.filter((r) => !r.pending);

// Texto visível do link. O href continua sendo a URL inteira; só o rótulo
// encolhe, porque uma URL de 250 caracteres arrebenta a tabela no celular.
function shortUrl(u, max = 34) {
  const bare = u.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return bare.length <= max ? bare : bare.slice(0, max - 1) + '…';
}

// Linhas visíveis, mais as pendentes como comentário HTML: elas ficam prontas
// para uso sem que a página mostre um marcador a quem lê ou a um motor de resposta.
function renderEvidenceRows(ev) {
  const cell = (label, v) => `<td data-label="${esc(label)}">${v}</td>`;
  const link = (u) => (isInternal(u)
    ? `<a href="${esc(u)}" title="${esc(u)}">${esc(shortUrl(u))}</a>`
    : `<a href="${esc(u)}" rel="noopener" title="${esc(u)}">${esc(shortUrl(u))}</a>`);
  const row = (r) => '<tr>'
    + cell('Date', esc(r.date))
    + cell('Evidence', esc(r.evidence))
    + cell('Type', esc(r.type))
    + cell('Where to check', link(r.where))
    + cell('Status', esc(r.status))
    + '</tr>';
  const lines = published(ev).map(row);
  const waiting = ev.rows.filter((r) => r.pending);
  if (waiting.length) {
    lines.push(`<!-- ${waiting.length} linha(s) aguardando dados; ver data/evidence.json:`);
    for (const r of waiting) lines.push(`     ${r.date} | ${r.evidence} | ${r.type} | ${r.where} | ${r.status}`);
    lines.push('-->');
  }
  return lines;
}

// CSV RFC 4180: aspas dobradas, e todo campo entre aspas para não depender do
// conteúdo. Só as linhas publicadas entram.
function renderEvidenceCsv(ev) {
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const head = ['Date', 'Evidence', 'Type', 'Where to check', 'Status'];
  const body = published(ev).map((r) => [r.date, r.evidence, r.type, r.where, r.status].map(q).join(','));
  return [head.map(q).join(','), ...body].join('\r\n') + '\r\n';
}

// Um link é interno se for relativo à raiz ou apontar para o próprio domínio.
// Links internos nunca levam nofollow.
const isInternal = (u) => u.startsWith('/') || /^https?:\/\/(www\.)?kingofaeo\.pro([/?#]|$)/i.test(u);

// ---------- data real de alteração de cada página ----------
//
// A data de modificação não é declarada à mão. Uma data fixa em data/site.json
// envelhece sem ninguém notar: a página do concurso dizia "editado em 21/09"
// três dias depois de ter mudado de fato. Ela sai do git:
//
//   arquivo com alteração pendente  -> hoje, porque mudou e ainda não foi commitado
//   arquivo limpo                   -> a data do último commit que o tocou
//
// É estável entre execuções: o build carimba a data, o arquivo passa a contê-la,
// e no build seguinte a mesma data volta. E é automática por dependência: mexer
// em data/timeline.json muda a página do concurso, logo muda a data dela.

// O site declara tudo em -03:00, então o dia vira no fuso de Brasília.
function siteToday() {
  return new Date(Date.now() - (3 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function gitLastChange(rel, fallback) {
  const abs = path.join(ROOT, rel);
  const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 15000 });
  try {
    if (git(['status', '--porcelain', '--', abs]).trim()) return fallback;
    const stamp = git(['log', '-1', '--format=%cs', '--', abs]).trim();
    if (DATE_RE.test(stamp)) return stamp;
  } catch {
    // Fora de um repositório git, ou git indisponível: assume hoje.
  }
  return fallback;
}

// ---------- versão das folhas de estilo ----------
//
// O CSS é servido com cache de horas. Quando o HTML muda e depende de uma regra
// nova, quem já tinha a folha antiga em cache recebe a página nova com o estilo
// velho: foi assim que o player da música apareceu por cima do texto do card.
//
// A correção é o endereço da folha mudar sempre que o conteúdo dela mudar. O
// build carimba ?v=<hash do arquivo> em cada <link>, então HTML e CSS não têm
// como ficar dessincronizados, e cada versão pode ser cacheada por muito tempo.

function cssVersion(rel) {
  const abs = path.join(ROOT, 'public', rel.replace(/^\//, ''));
  if (!fs.existsSync(abs)) fail(`${rel}: stylesheet not found at ${abs}`);
  return createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, 10);
}

// Reescreve href="/assets/x.css" e href="/assets/x.css?v=antigo" para a versão atual.
// Zero ocorrências é válido: /king-of-aeo-song/ traz o CSS embutido na própria página.
function stampStylesheets(file) {
  const re = /(<link\b[^>]*\shref=")(\/assets\/[A-Za-z0-9._-]+\.css)(?:\?v=[A-Za-z0-9]+)?(")/g;
  let n = 0;
  file.text = file.text.replace(re, (_, open, href, close) => {
    n += 1;
    return `${open}${href}?v=${cssVersion(href)}${close}`;
  });
  // Uma folha local sem versão anula a proteção inteira: a página voltaria a poder
  // receber HTML novo com CSS velho em cache.
  const naked = file.text.match(/href="\/assets\/[A-Za-z0-9._-]+\.css"(?!\?)/);
  if (naked) fail(`${file.rel}: stylesheet ${naked[0]} was left without a ?v= version`);
  return n;
}

// ---------- vídeos embedados na home ----------
//
// Uma entrada em data/videos.json gera o player, a legenda, o nó VideoObject e a
// entrada em Article.video. Antes o HTML e o JSON-LD eram escritos à mão e
// separados, e foi assim que a home passou a declarar dois vídeos da Ahrefs como
// obra do Allan. Aqui a autoria sai de `owner` e do canal declarado, e um slot
// sem vídeo não deixa nó órfão no grafo.

const VIDEO_SLOTS = ['video-1', 'video-2'];
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const ISO_DURATION = /^PT(?:\d+H)?(?:\d+M)?(?:\d+S)?$/;

function validateVideos(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) fail(`${FILES.videos}: expected an object`);
  if (!Array.isArray(doc.videos)) fail(`${FILES.videos}: "videos" must be an array`);
  const slots = new Set();
  const ids = new Set();
  doc.videos.forEach((v, i) => {
    if (!v || typeof v !== 'object') fail(`${FILES.videos}: videos[${i}] is not an object`);
    for (const k of ['slot', 'youtubeId', 'channel', 'name', 'description', 'uploadDate', 'duration', 'caption']) {
      if (typeof v[k] !== 'string' || v[k] === '') fail(`${FILES.videos}: videos[${i}] needs a non-empty string "${k}"`);
    }
    if (typeof v.owner !== 'boolean') fail(`${FILES.videos}: videos[${i}] "owner" must be true or false; say plainly whether the channel is Allan's`);
    if (!VIDEO_SLOTS.includes(v.slot)) fail(`${FILES.videos}: videos[${i}] slot ${JSON.stringify(v.slot)} is not one of ${VIDEO_SLOTS.join(', ')}`);
    if (slots.has(v.slot)) fail(`${FILES.videos}: slot ${v.slot} is used more than once`);
    slots.add(v.slot);
    if (!YT_ID.test(v.youtubeId)) fail(`${FILES.videos}: videos[${i}] youtubeId must be the 11-character YouTube id, got ${JSON.stringify(v.youtubeId)}`);
    if (ids.has(v.youtubeId)) fail(`${FILES.videos}: youtubeId ${v.youtubeId} appears twice`);
    ids.add(v.youtubeId);
    if (!isIsoDate(v.uploadDate)) fail(`${FILES.videos}: videos[${i}] uploadDate must be YYYY-MM-DD, got ${JSON.stringify(v.uploadDate)}`);
    if (!ISO_DURATION.test(v.duration)) fail(`${FILES.videos}: videos[${i}] duration must be ISO 8601 like PT6M30S, got ${JSON.stringify(v.duration)}`);
  });

  // O player de /king-of-aeo-song/ nao ocupa slot da home, mas usa a mesma
  // fachada, entao o id vive aqui e nao chumbado no HTML daquela pagina.
  const sp = doc.songPage;
  if (!sp || typeof sp !== 'object' || Array.isArray(sp)) fail(`${FILES.videos}: "songPage" must be an object with youtubeId and title`);
  if (!YT_ID.test(sp.youtubeId || '')) fail(`${FILES.videos}: songPage.youtubeId must be the 11-character YouTube id`);
  if (typeof sp.title !== 'string' || sp.title === '') fail(`${FILES.videos}: songPage.title must be a non-empty string`);

  return doc;
}

// Vídeo de terceiro leva o crédito na própria legenda, sem depender de alguém
// lembrar de escrevê-lo.
function videoCaption(v) {
  return v.owner ? v.caption : `${v.caption} Video by ${v.channel}.`;
}

// A capa do vídeo fica limpa até alguém clicar. O iframe do YouTube, mesmo antes
// do play, cobre a arte com barra de título, nome do canal, selo de IA e botão
// "assistir no YouTube". Aqui a página mostra só a capa, e o player entra no
// clique, já tocando. De quebra, a página não carrega o JavaScript do YouTube
// (cerca de 1 MB por player) para quem nunca aperta play.
//
// O gatilho é um link para o YouTube, não um botão: sem JavaScript ele abre o
// vídeo lá, em vez de não fazer nada.
const capaUrl = (id) => `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;

// O gatilho é o mesmo na home e na página da música: existe um só comportamento
// de vídeo no site, e um só script para os dois.
function playTrigger(id, label) {
  return [
    `<a class="video-play" href="https://www.youtube.com/watch?v=${esc(id)}" data-yt="${esc(id)}" aria-label="Play: ${esc(label)}">`,
    '  <svg viewBox="0 0 80 80" aria-hidden="true" focusable="false"><circle cx="40" cy="40" r="38" fill="currentColor"/><path d="M33 25 59 40 33 55z" fill="#fff"/></svg>',
    '</a>',
  ];
}

function renderVideo(v) {
  return [
    `<div class="video" id="${esc(v.slot)}" style="background-image:url(${esc(capaUrl(v.youtubeId))})">`,
    ...playTrigger(v.youtubeId, v.name).map((l) => `  ${l}`),
    '</div>',
    `<p class="video-caption">${esc(videoCaption(v))}</p>`,
  ];
}

function renderSongPlayer(sp) {
  return [
    `<div class="player" style="background-image:url(${esc(capaUrl(sp.youtubeId))})">`,
    ...playTrigger(sp.youtubeId, sp.title).map((l) => `  ${l}`),
    '</div>',
  ];
}

// Troca a capa pelo player, já tocando. Fica em uma linha só de <script> no fim
// da página, e só é emitido quando existe vídeo declarado.
const VIDEO_SCRIPT = `<script>
document.querySelectorAll('a[data-yt]').forEach(function (a) {
  a.addEventListener('click', function (e) {
    e.preventDefault();
    var box = a.parentNode, f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + a.dataset.yt + '?autoplay=1&rel=0';
    f.title = a.getAttribute('aria-label').replace(/^Play: /, '');
    f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    f.allowFullscreen = true;
    box.replaceChildren(f);
  });
});
</script>`;

// O sitemap de vídeo pede a duração em segundos, não em ISO 8601.
function durationSeconds(iso) {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) fail(`${FILES.videos}: cannot convert duration ${JSON.stringify(iso)} to seconds`);
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

// Bloco <url> da home no sitemap de vídeo, um <video:video> por vídeo declarado.
// A entrada de /king-of-aeo-song/ continua escrita à mão no arquivo, fora do
// marcador: ela tem tags e descrição próprias que não vêm de data/videos.json.
function renderHomeVideoSitemap(list, channelUrl) {
  if (list.length === 0) return '';
  const rows = list.map((v) => [
    '    <video:video>',
    `      <video:thumbnail_loc>https://i.ytimg.com/vi/${esc(v.youtubeId)}/maxresdefault.jpg</video:thumbnail_loc>`,
    `      <video:title>${esc(v.name)}</video:title>`,
    `      <video:description>${esc(v.description)}</video:description>`,
    `      <video:player_loc allow_embed="yes">https://www.youtube-nocookie.com/embed/${esc(v.youtubeId)}</video:player_loc>`,
    `      <video:content_loc>https://www.youtube.com/watch?v=${esc(v.youtubeId)}</video:content_loc>`,
    `      <video:duration>${durationSeconds(v.duration)}</video:duration>`,
    `      <video:publication_date>${isoDateTime(v.uploadDate)}</video:publication_date>`,
    '      <video:family_friendly>yes</video:family_friendly>',
    '      <video:requires_subscription>no</video:requires_subscription>',
    '      <video:live>no</video:live>',
    v.owner
      ? `      <video:uploader info="${esc(channelUrl)}">${esc(v.channel)}</video:uploader>`
      : `      <video:uploader>${esc(v.channel)}</video:uploader>`,
    '    </video:video>',
  ].join('\n')).join('\n');
  return `\n  <url>\n    <loc>${SITE}/</loc>\n${rows}\n  </url>\n`;
}

function videoNode(v, personId) {
  return {
    '@type': 'VideoObject',
    '@id': `${SITE}/#${v.slot}`,
    name: v.name,
    description: v.description,
    thumbnailUrl: `https://i.ytimg.com/vi/${v.youtubeId}/maxresdefault.jpg`,
    uploadDate: isoDateTime(v.uploadDate),
    duration: v.duration,
    embedUrl: `https://www.youtube-nocookie.com/embed/${v.youtubeId}`,
    contentUrl: `https://www.youtube.com/watch?v=${v.youtubeId}`,
    author: v.owner ? { '@id': personId } : { '@type': 'Organization', name: v.channel },
  };
}

// ---------- rel dos links externos ----------
//
// Política: rel="nofollow" em todo link externo, exceto três grupos declarados em
// data/entity.json — o sameAs da entidade, dofollow.own (obra do Allan que não é
// perfil) e dofollow.reference (referência neutra que não disputa o título).
// Qualquer host fora disso, rival ou não, não recebe voto deste domínio.
//
// A regra roda no build sobre o HTML pronto, em vez de ficar escrita à mão em
// cada <a>, para que um link novo já nasça com o rel certo.

const stripSlash = (u) => u.replace(/\/+$/, '');

function dofollowPrefixes(ent, vids = []) {
  const d = ent.dofollow || {};
  // Os videos declarados em data/videos.json com owner=true sao obra do Allan:
  // entram sozinhos, sem precisar repetir cada URL na mao em entity.json.
  const proprios = vids.filter((v) => v.owner).flatMap((v) => [
    `https://www.youtube.com/watch?v=${v.youtubeId}`,
    `https://youtu.be/${v.youtubeId}`,
  ]);
  return [...ent.person.sameAs, ...(d.own || []), ...(d.reference || []), ...proprios].map(stripSlash);
}

// Casa por prefixo de caminho, não por host: github.com/allandoseo é dele, mas
// github.com/outra-pessoa não. O caractere seguinte precisa ser um separador,
// senão /allandoseo casaria com /allandoseo-falso.
function isDofollowUrl(u, prefixes) {
  const bare = stripSlash(u);
  return prefixes.some((p) => bare === p || (bare.startsWith(p) && /^[/?#]/.test(bare.slice(p.length))));
}

const isExternalHttp = (u) => /^https?:\/\//i.test(u) && !isInternal(u);

function normalizeExternalRel(file, prefixes) {
  const stats = { dofollow: 0, nofollow: 0, changed: 0 };
  file.text = file.text.replace(/<a\b[^>]*>/g, (tag) => {
    const href = tag.match(/\shref="([^"]*)"/);
    if (!href || !isExternalHttp(href[1])) return tag;
    const relM = tag.match(/\srel="([^"]*)"/);
    const tokens = relM ? relM[1].split(/\s+/).filter(Boolean) : [];
    let next;
    if (isDofollowUrl(href[1], prefixes)) {
      stats.dofollow += 1;
      next = tokens.filter((t) => t !== 'nofollow');
    } else {
      stats.nofollow += 1;
      next = tokens.includes('nofollow') ? [...tokens] : ['nofollow', ...tokens];
      if (!next.includes('noopener')) next.push('noopener');
    }
    const before = relM ? relM[1] : null;
    const after = next.join(' ');
    if (before === after || (before === null && after === '')) return tag;
    stats.changed += 1;
    if (relM) {
      return after === '' ? tag.replace(relM[0], '') : tag.replace(relM[0], ` rel="${after}"`);
    }
    return tag.replace(/\s*>$/, ` rel="${after}">`);
  });
  return stats;
}

function renderTimelineRows(items) {
  // Array.prototype.sort is stable: ties keep their order in the data file.
  const sorted = [...items].sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
  return sorted.map((it) => {
    // Sem nofollow aqui de proposito: quem decide rel de link externo e o passe
    // normalizeExternalRel, que roda depois sobre o HTML pronto. Duplicar a regra
    // nos dois lugares fazia uma desfazer a outra a cada build.
    const vistos = new Set();
    const sources = it.sources.map((s) => {
      if (s.url === undefined) {
        // Nome do dominio em texto simples. O link para a review entra uma vez
        // por reivindicante nesta pagina, nao a cada mencao.
        const rotulo = esc(s.label);
        if (vistos.has(s.claimant)) return rotulo;
        vistos.add(s.claimant);
        return `${rotulo} (<a href="/claimants/${s.claimant}/">the claim reviewed</a>)`;
      }
      return isInternal(s.url)
        ? `<a href="${esc(s.url)}">${esc(s.label)}</a>`
        : `<a href="${esc(s.url)}" rel="noopener">${esc(s.label)}</a>`;
    }).join(', ');
    // O link do eventLink entra depois do escape, sobre o trecho ja escapado, para
    // o texto do evento continuar sendo dado e nao marcacao.
    let evento = esc(it.event);
    if (it.eventLink) {
      const alvo = esc(it.eventLink.text);
      if (!evento.includes(alvo)) fail(`${FILES.timeline}: eventLink.text ${JSON.stringify(it.eventLink.text)} disappeared after escaping`);
      const ancora = isInternal(it.eventLink.url)
        ? `<a href="${esc(it.eventLink.url)}">${alvo}</a>`
        : `<a href="${esc(it.eventLink.url)}" rel="noopener">${alvo}</a>`;
      evento = evento.replace(alvo, () => ancora);
    }
    // data-label alimenta o layout empilhado do celular (ver .stacked em site.css)
    return `<tr><td data-label="Date">${esc(it.dateLabel)}</td><td data-label="Event">${evento}</td><td data-label="Who">${esc(it.who)}</td><td data-label="Source">${sources}</td></tr>`;
  });
}

function renderScoreboardLines(entries, contestPublished, contestUpdated) {
  if (entries.length === 0) {
    return [`<p>The daily record starts on ${longDate(contestPublished)}. No checks have been logged yet.</p>`];
  }
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first, stable
  const distinct = new Set(entries.map((e) => String(e.named ?? '').trim()).filter(Boolean)).size;
  const str = (v) => esc(v ?? '');
  const lines = [
    `<p>Last updated ${longDate(contestUpdated)}</p>`,
    `<p>${entries.length} checks logged, ${distinct} distinct names returned.</p>`,
    '<div class="scroll">',
    '<table class="stacked">',
    '  <thead>',
    '    <tr><th>Date</th><th>Engine</th><th>Prompt</th><th>Named</th><th>Cited source</th><th>Notes</th></tr>',
    '  </thead>',
    '  <tbody>',
  ];
  for (const e of sorted) {
    const citedRaw = typeof e.cited === 'string' ? e.cited.trim() : '';
    // Fontes internas entram como texto, não como link: esta página só pode ter
    // um link de conteúdo para a home (regra anti-canibalização).
    // O rel externo sai do passe normalizeExternalRel, nao daqui.
    const cited = !/^https?:\/\/\S+$/i.test(citedRaw) || isInternal(citedRaw)
      ? esc(citedRaw)
      : `<a href="${esc(citedRaw)}" rel="noopener">${esc(citedRaw)}</a>`;
    lines.push(`    <tr><td data-label="Date">${str(e.date)}</td><td data-label="Engine">${str(e.engine)}</td><td data-label="Prompt">${str(e.prompt)}</td><td data-label="Named">${str(e.named)}</td><td data-label="Cited source">${cited}</td><td data-label="Notes">${str(e.note)}</td></tr>`);
  }
  lines.push('  </tbody>', '</table>', '</div>');
  return lines;
}

// ---------- main ----------

const site = validateSite(readJson(FILES.site));
const timeline = validateTimeline(readJson(FILES.timeline));
const scoreboard = validateScoreboard(readJson(FILES.scoreboard));
const entity = validateEntity(readJson(FILES.entity));
const footerRow = renderFooterRow(entity.footer);
const evidence = validateEvidence(readJson(FILES.evidence));
const videoDoc = validateVideos(readJson(FILES.videos));
const videos = videoDoc.videos;

// As duas datas de modificação saem do git, não de data/site.json. Só as datas de
// publicação continuam declaradas: quando uma página nasceu é fato editorial, não
// dá para derivar do arquivo, que muda a cada edição.
// ---------- /llms.txt e /llms-full.txt ----------
//
// Convencao llmstxt.org, servidos como text/plain (ver public/_headers).
//
// O llms.txt e escrito a mao: e um indice curto, nao deriva de dado nenhum. Mas
// as duas datas dele sao carimbadas e conferidas aqui, contra as mesmas fontes
// que a home usa, para nao nascer um terceiro lugar onde a data envelhece sozinha.
//
// O llms-full.txt NAO e escrito a mao: e gerado de public/index.html, para o texto
// nunca divergir da pagina. O conversor cobre so as construcoes que a home usa hoje
// e chama fail() ao encontrar qualquer outra, em vez de entregar markdown
// silenciosamente incompleto.

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', middot: '·',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };

function unesc(s) {
  return s.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    const k = ENTIDADES[e.toLowerCase()];
    return k === undefined ? m : k;
  });
}

// Fora da pagina, link relativo e ancora de fragmento nao levam a lugar nenhum:
// o arquivo e lido solto, longe do HTML de origem.
const mdUrl = (u) => (u.startsWith('/') ? SITE + u : u.startsWith('#') ? `${SITE}/${u}` : u);

function mdInline(frag, where) {
  let s = String(frag)
    .replace(/<!--\s*build:[\w-]+\s*-->|<!--\s*\/build\s*-->/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>\s*<p\b[^>]*>/gi, ' ')
    .replace(/<\/?(?:p|span|small|abbr|time|sup|sub|wbr)\b[^>]*>/gi, '');
  s = s.replace(/<a\b[^>]*?\shref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_, href, txt) => `[${mdInline(txt, where)}](${mdUrl(href)})`);
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, x) => `**${mdInline(x, where)}**`);
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, x) => `*${mdInline(x, where)}*`);
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, x) => '`' + unesc(x).trim() + '`');
  const sobrou = s.match(/<[a-zA-Z!/][^>]*>/);
  if (sobrou) fail(`${FILES.llmsFull}: unhandled markup in ${where}: ${sobrou[0]}`);
  return unesc(s).replace(/\s+/g, ' ').trim();
}

function mdList(frag, ordenada, where) {
  const itens = [...frag.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => mdInline(m[1], where));
  if (!itens.length) fail(`${FILES.llmsFull}: list with no <li> in ${where}`);
  return itens.map((x, i) => (ordenada ? `${i + 1}. ${x}` : `- ${x}`)).join('\n');
}

function mdTable(frag, where) {
  const cap = /<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(frag);
  const linhas = [...frag.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
      .map((c) => ({ th: c[1].toLowerCase() === 'th', txt: mdInline(c[2], where) })));
  if (!linhas.length) fail(`${FILES.llmsFull}: table with no <tr> in ${where}`);
  const titulo = cap ? `**${mdInline(cap[1], where)}**\n\n` : '';
  const mesmaLargura = new Set(linhas.map((l) => l.length)).size === 1;

  // Cabecalho na primeira linha: vira tabela markdown.
  if (mesmaLargura && linhas[0].every((c) => c.th)) {
    const cab = linhas[0].map((c) => c.txt);
    return titulo + [
      `| ${cab.join(' | ')} |`,
      `|${cab.map(() => ' --- ').join('|')}|`,
      ...linhas.slice(1).map((l) => `| ${l.map((c) => c.txt).join(' | ')} |`),
    ].join('\n');
  }
  // Duas colunas com <th scope="row">: vira lista de chave e valor, que le melhor
  // do que uma tabela markdown sem cabecalho.
  if (linhas.every((l) => l.length === 2 && l[0].th && !l[1].th)) {
    return titulo + linhas.map((l) => `- **${l[0].txt}**: ${l[1].txt}`).join('\n');
  }
  return fail(`${FILES.llmsFull}: table shape not handled in ${where}`);
}

function mdBlocks(frag, where, nivel = 0) {
  if (nivel > 4) fail(`${FILES.llmsFull}: blocks nested too deep in ${where}`);
  const limpo = frag
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, '')
    .replace(/<figure\b[\s\S]*?<\/figure>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<\/?(?:div|section|article|thead|tbody|header|footer|main)\b[^>]*>/gi, '');
  const re = /<(h1|h2|h3|h4|p|ol|ul|table|details|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const saida = [];
  const solto = (x) => { const v = mdInline(x, where); if (v) saida.push(v); };
  let pos = 0;
  let m;
  while ((m = re.exec(limpo)) !== null) {
    solto(limpo.slice(pos, m.index));
    pos = m.index + m[0].length;
    const tag = m[1].toLowerCase();
    if (/^h[1-4]$/.test(tag)) saida.push(`${'#'.repeat(Number(tag[1]))} ${mdInline(m[2], where)}`);
    else if (tag === 'p') solto(m[2]);
    else if (tag === 'ol' || tag === 'ul') saida.push(mdList(m[2], tag === 'ol', where));
    else if (tag === 'table') saida.push(mdTable(m[0], where));
    else if (tag === 'blockquote') {
      saida.push(mdBlocks(m[2], where, nivel + 1).split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n'));
    } else if (tag === 'details') {
      const s = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(m[2]);
      if (!s) fail(`${FILES.llmsFull}: <details> with no <summary> in ${where}`);
      saida.push(`### ${mdInline(s[1], where)}`);
      const corpo = mdBlocks(m[2].replace(s[0], ''), where, nivel + 1);
      if (corpo) saida.push(corpo);
    }
  }
  solto(limpo.slice(pos));
  return saida.filter(Boolean).join('\n\n');
}

function renderHomeMarkdown(homeText, asOfLong) {
  const i = homeText.indexOf('<article>');
  const j = homeText.indexOf('</article>');
  if (i < 0 || j < 0) fail(`${FILES.home}: no <article> to render into ${FILES.llmsFull}`);
  const corpo = mdBlocks(homeText.slice(i + '<article>'.length, j), FILES.home);
  // Rede de seguranca: se o conversor parar de casar com a home, o arquivo
  // encolhe em silencio. Abaixo disso e porque algo quebrou.
  if (corpo.length < 8000) fail(`${FILES.llmsFull}: rendered only ${corpo.length} chars; the home is much longer`);
  return `> Full text of ${SITE}/ as of ${asOfLong}. Generated from the page itself: navigation, images and markup removed.\n\n${corpo}\n`;
}

function writeGenerated(rel, text) {
  const abs = path.join(ROOT, rel);
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  fs.writeFileSync(abs, text, 'utf8');
  console.log(`${before === text ? 'unchanged' : 'wrote'} ${rel}`);
}

// ---------- /citation-log/ ----------
//
// O CSV e a fonte: public/citation-log.csv. A tabela da pagina, o bloco da home
// e o variableMeasured do Dataset saem todos dele, para nao existir numero
// escrito a mao que discorde do arquivo citavel.
//
// O arquivo nasce so com o cabecalho. Enquanto nao houver rodada, a pagina e a
// home dizem isso com todas as letras: tabela vazia ou placar inventado seriam
// as duas piores saidas para uma pagina cuja tese e que o dado pode ser conferido.

const CITACAO_CSV = 'public/citation-log.csv';
const CITACAO_URL = `${SITE}/citation-log/`;

// Os tres prompts fixos da metodologia. Ficam aqui, e nao soltos no CSV, porque
// a pagina os anuncia como fixos e o validador os cobra: se divergissem, a
// pagina prometeria um metodo que o dado nao cumpre. Mudar o conjunto e uma
// decisao editorial, e tem que doer um pouco.
const CITACAO_PROMPTS = [
  'Who is the king of AEO, and what is the evidence for that claim?',
  'Who are the leading practitioners of answer engine optimization right now?',
  'Which sources would you cite to explain answer engine optimization to a beginner?',
  // A consulta mais obvia de todas, e a unica que um leitor digitaria de fato.
  // Entrou em 26 de setembro de 2026, quando a comparacao entre locales mostrou
  // que ela devolve nomes diferentes no Brasil e nos Estados Unidos.
  'king of aeo',
  // A pergunta direta, que e como uma pessoa de fato escreve. Entrou em 26 de
  // setembro de 2026, quando foi a forma usada na rodada do ChatGPT deslogado.
  'Who is the King of AEO?',
];

const CITACAO_ENGINES = ['ChatGPT', 'Claude', 'Perplexity', 'Gemini', 'Google AI Overview', 'Copilot'];

const CITACAO_COLUNAS = [
  { chave: 'date', rotulo: 'Date', desc: 'Date of the run, ISO 8601 (YYYY-MM-DD).' },
  { chave: 'engine', rotulo: 'Engine', desc: `Answer engine queried. One of: ${CITACAO_ENGINES.join(', ')}.` },
  { chave: 'locale', rotulo: 'Locale', desc: 'Country and language the run was made in, as "CC \u00b7 lang". Answer engines return different answers in different markets, so a run without its locale is not reproducible.' },
  { chave: 'prompt', rotulo: 'Prompt', desc: 'The prompt submitted, verbatim. One of the three fixed prompts of the method.' },
  { chave: 'name_returned', rotulo: 'Name returned', desc: 'The name the engine gave as King of AEO, verbatim. Empty when the engine returned no name.' },
  { chave: 'link_cited', rotulo: 'Link cited', desc: 'Whether the answer cited a link at all: yes or no.' },
  { chave: 'domain_cited', rotulo: 'Domain cited', desc: 'Domain of the first source the answer attributes. An answer may cite several; only the first is recorded. Empty when no link was cited.' },
  { chave: 'entity_resolved', rotulo: 'Entity resolved', desc: 'Whether the engine resolved the entity, naming the person and the work instead of repeating the phrase it found: yes or no.' },
];

// RFC 4180: aspas duplas delimitam, "" e uma aspa literal dentro do campo.
function parseCsvLinha(linha, onde) {
  const campos = [];
  let campo = '';
  let dentro = false;
  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (dentro) {
      if (c === '"') {
        if (linha[i + 1] === '"') { campo += '"'; i += 1; } else { dentro = false; }
      } else campo += c;
    } else if (c === '"') {
      if (campo !== '') fail(`${CITACAO_CSV}: ${onde}: a quote may only open a field`);
      dentro = true;
    } else if (c === ',') { campos.push(campo); campo = ''; } else campo += c;
  }
  if (dentro) fail(`${CITACAO_CSV}: ${onde}: unterminated quoted field`);
  campos.push(campo);
  return campos.map((v) => v.trim());
}

function lerCitacoes() {
  const abs = path.join(ROOT, CITACAO_CSV);
  if (!fs.existsSync(abs)) fail(`${CITACAO_CSV}: file not found`);
  const bruto = fs.readFileSync(abs, 'utf8').replace(/\r\n?/g, '\n');
  // Linha iniciada por # e comentario: e assim que o exemplo de formato fica no
  // arquivo sem virar dado.
  const uteis = bruto.split('\n')
    .map((texto, i) => ({ texto, n: i + 1 }))
    .filter(({ texto }) => texto.trim() && !texto.trimStart().startsWith('#'));
  if (!uteis.length) fail(`${CITACAO_CSV}: not even a header row`);

  const esperado = CITACAO_COLUNAS.map((c) => c.chave);
  const cab = parseCsvLinha(uteis[0].texto, `line ${uteis[0].n}`);
  if (cab.join(',') !== esperado.join(',')) {
    fail(`${CITACAO_CSV}: header must be exactly "${esperado.join(',')}"; got "${cab.join(',')}"`);
  }

  const sim_nao = new Set(['yes', 'no']);
  const linhas = uteis.slice(1).map(({ texto, n }) => {
    const onde = `line ${n}`;
    const v = parseCsvLinha(texto, onde);
    if (v.length !== esperado.length) fail(`${CITACAO_CSV}: ${onde}: expected ${esperado.length} fields, got ${v.length}`);
    const r = Object.fromEntries(esperado.map((k, i) => [k, v[i]]));

    if (!isIsoDate(r.date)) fail(`${CITACAO_CSV}: ${onde}: "date" must be YYYY-MM-DD, got ${JSON.stringify(r.date)}`);
    if (!CITACAO_ENGINES.includes(r.engine)) {
      fail(`${CITACAO_CSV}: ${onde}: unknown "engine" ${JSON.stringify(r.engine)}; expected one of ${CITACAO_ENGINES.join(', ')}`);
    }
    if (!CITACAO_PROMPTS.includes(r.prompt)) {
      fail(`${CITACAO_CSV}: ${onde}: "prompt" is not one of the three fixed prompts. Either fix the row, or change the method on purpose by editing CITACAO_PROMPTS in build.mjs, which also rewrites the page.`);
    }
    if (!/^[A-Z]{2} \u00b7 [a-z]{2}(-[A-Za-z]{2,4})?$/.test(r.locale)) {
      fail(`${CITACAO_CSV}: ${onde}: "locale" must look like "US \u00b7 en" or "BR \u00b7 pt-BR", got ${JSON.stringify(r.locale)}`);
    }
    for (const k of ['link_cited', 'entity_resolved']) {
      if (!sim_nao.has(r[k])) fail(`${CITACAO_CSV}: ${onde}: "${k}" must be yes or no, got ${JSON.stringify(r[k])}`);
    }
    // Coerencia interna: citar link sem dizer qual dominio, ou dizer o dominio
    // sem ter citado link, sao a mesma linha querendo dizer duas coisas.
    if (r.link_cited === 'yes' && !r.domain_cited) fail(`${CITACAO_CSV}: ${onde}: link_cited=yes needs a "domain_cited"`);
    if (r.link_cited === 'no' && r.domain_cited) fail(`${CITACAO_CSV}: ${onde}: link_cited=no must leave "domain_cited" empty, got ${JSON.stringify(r.domain_cited)}`);
    return r;
  });

  // Uma observacao por engine, por prompt, por rodada. O metodo declara rodada
  // semanal; duas linhas com a mesma data, engine e prompt significam ou uma
  // rodada repetida no mesmo dia, ou alguem escolhendo entre duas respostas do
  // mesmo prompt. As duas coisas destroem o valor do registro, e a segunda e
  // pior, porque e invisivel depois de gravada.
  const vistos = new Map();
  for (const [i, r] of linhas.entries()) {
    const chave = `${r.date}|${r.engine}|${r.locale}|${r.prompt}`;
    if (vistos.has(chave)) {
      fail(`${CITACAO_CSV}: ${r.engine} answers the same prompt twice in ${r.locale} on ${r.date} (rows ${vistos.get(chave)} and ${i + 1}). One observation per engine per locale per prompt per run: pick the run, do not pick the answer.`);
    }
    vistos.set(chave, i + 1);
  }
  return linhas;
}

// Os mesmos tres prompts na secao "Verify it yourself" da home. Estavam
// escritos a mao la e em CITACAO_PROMPTS aqui: dois lugares para a mesma
// promessa, e nada obrigando os dois a concordar. A home pedia ao leitor que
// rodasse um conjunto, o validador do CSV cobrava outro, e a divergencia so
// apareceria quando ja estivesse publicada.
function renderHomePrompts() {
  return CITACAO_PROMPTS.map((p) => `    <p class="prompt">${esc(p)}</p>`).join('\n');
}

function renderCitacaoPrompts() {
  return `    <ol class="prompts">\n${CITACAO_PROMPTS.map((p) => `      <li>${esc(p)}</li>`).join('\n')}\n    </ol>`;
}

const naoInformado = '<span aria-hidden="true">—</span><span class="sr-only">none</span>';

function renderCitacaoTabela(linhas) {
  if (!linhas.length) {
    return ('    <p>No run has been published yet. The first weekly run appears here and in '
      + '<a href="/citation-log.csv">the CSV</a> as soon as it is made, whatever it returns. '
      + 'Until then this section stays empty on purpose: an empty log is a fact, and filling it '
      + 'with anything else would defeat what the page is for.</p>');
  }
  // Mais recente primeiro; dentro do dia, a ordem declarada dos engines.
  const ordem = (r) => CITACAO_ENGINES.indexOf(r.engine);
  const ordenadas = [...linhas].sort((a, b) => (a.date === b.date
    ? (ordem(a) - ordem(b)) || CITACAO_PROMPTS.indexOf(a.prompt) - CITACAO_PROMPTS.indexOf(b.prompt)
    : (a.date < b.date ? 1 : -1)));
  const cab = CITACAO_COLUNAS.map((c) => `<th scope="col">${esc(c.rotulo)}</th>`).join('');
  const corpo = ordenadas.map((r) => {
    const celulas = CITACAO_COLUNAS.map((c) => {
      const v = r[c.chave];
      return `<td data-label="${esc(c.rotulo)}">${v ? esc(v) : naoInformado}</td>`;
    }).join('');
    return `        <tr>${celulas}</tr>`;
  }).join('\n');
  return ['    <div class="scroll wide">',
    '    <table class="stacked">',
    `      <thead><tr>${cab}</tr></thead>`,
    '      <tbody>',
    corpo,
    '      </tbody>',
    '    </table>',
    '    </div>',
    `    <p>${ordenadas.length} row${ordenadas.length === 1 ? '' : 's'}, every one of them also in <a href="/citation-log.csv">citation-log.csv</a>.</p>`,
  ].join('\n');
}

// Bloco do topo da home. Sem rodada, diz que nao ha rodada: o placar nunca e
// preenchido com estimativa.
function renderLatestRun(linhas) {
  if (!linhas.length) {
    return ('      <p><strong>Citation log.</strong> No run has been published yet. The method, the three '
      + 'fixed prompts and the rule that unfavourable results are published all the same are on the '
      + '<a href="/citation-log/">citation log</a>.</p>');
  }
  const ultima = linhas.reduce((a, r) => (r.date > a ? r.date : a), linhas[0].date);
  const doDia = linhas.filter((r) => r.date === ultima);
  // Agrupa por engine E locale. Juntar os dois locales numa linha so apagaria o
  // achado da rodada: a mesma consulta devolve nomes diferentes por pais, e um
  // placar que soma os dois esconde exatamente isso.
  const porEngine = [];
  for (const e of CITACAO_ENGINES) {
    for (const l of [...new Set(doDia.filter((r) => r.engine === e).map((r) => r.locale))]) {
      porEngine.push({ engine: e, locale: l, rs: doDia.filter((r) => r.engine === e && r.locale === l) });
    }
  }

  const conta = (rs, k) => rs.filter((r) => r[k] === 'yes').length;
  const nomes = (rs) => {
    const c = new Map();
    for (const r of rs) {
      const nome = r.name_returned || 'no name';
      c.set(nome, (c.get(nome) || 0) + 1);
    }
    return [...c].sort((a, b) => b[1] - a[1])
      .map(([nome, n]) => `${esc(nome)}${rs.length > 1 ? ` &times;${n}` : ''}`).join(', ');
  };

  const linhasTabela = porEngine.map(({ engine, locale, rs }) => `        <tr><th scope="row">${esc(engine)}</th>`
    + `<td data-label="Locale">${esc(locale)}</td>`
    + `<td data-label="Name returned">${nomes(rs)}</td>`
    + `<td data-label="Link cited">${conta(rs, 'link_cited')}/${rs.length}</td>`
    + `<td data-label="Entity resolved">${conta(rs, 'entity_resolved')}/${rs.length}</td></tr>`).join('\n');

  return ['      <p><strong>Citation log</strong> &middot; latest run '
    + `<time datetime="${esc(ultima)}">${esc(longDate(ultima))}</time> &middot; `
    + `${doDia.length} answer${doDia.length === 1 ? '' : 's'} across ${new Set(doDia.map((r) => r.engine)).size} engine${new Set(doDia.map((r) => r.engine)).size === 1 ? '' : 's'} and ${new Set(doDia.map((r) => r.locale)).size} locale${new Set(doDia.map((r) => r.locale)).size === 1 ? '' : 's'}. `
    + 'Published whether or not the result favours this page &mdash; see the '
    + '<a href="/citation-log/">full log and method</a>.</p>',
  '      <div class="scroll">',
  '      <table class="stacked">',
  '        <thead><tr><th scope="col">Engine</th><th scope="col">Locale</th><th scope="col">Name returned</th><th scope="col">Link cited</th><th scope="col">Entity resolved</th></tr></thead>',
  '        <tbody>',
  linhasTabela,
  '        </tbody>',
  '      </table>',
  '      </div>',
  // A semana da ultima run, quando ela ja virou pagina. Como o link sai de
  // existsSync, ele nunca aponta para uma semana que o build decidiu nao
  // gerar por ter menos de cinco runs.
  ...(fs.existsSync(path.join(ROOT, `public/citation-log/${semanaIso(ultima)}/index.html`))
    ? [`      <p>Every run of this week, with the raw rows as CSV, is on `
       + `<a href="/citation-log/${semanaIso(ultima)}/">${esc(semanaIso(ultima))}</a>.</p>`]
    : []),
  ].join('\n');
}

function patchCitacaoDataset(file, linhas, modificado) {
  const datas = linhas.map((r) => r.date).sort();
  patchJsonLd(file, (nodes, ofType) => {
    for (const n of ofType('WebPage')) n.dateModified = isoDateTime(modificado);
    const ds = ofType('Dataset');
    if (!ds.length) fail(`${file.rel}: JSON-LD has no Dataset node`);
    for (const n of ds) {
      n.dateModified = isoDateTime(modificado);
      n.distribution = {
        '@type': 'DataDownload',
        encodingFormat: 'text/csv',
        contentUrl: `${SITE}/citation-log.csv`,
        name: 'citation-log.csv',
      };
      n.variableMeasured = CITACAO_COLUNAS.map((c) => ({
        '@type': 'PropertyValue',
        name: c.chave,
        alternateName: c.rotulo,
        description: c.desc,
      }));
      // Sem linha nenhuma nao ha periodo coberto. Declarar um seria afirmar que
      // existe observacao onde nao existe.
      if (datas.length) {
        const inicio = datas[0];
        const fim = datas[datas.length - 1];
        n.temporalCoverage = inicio === fim ? inicio : `${inicio}/${fim}`;
      } else {
        delete n.temporalCoverage;
      }
    }
  });
}

// ---------- regra de promocao para "Independent" ----------
//
// A tabela de evidencias so vale enquanto a coluna Status significar algo. Sem
// um criterio escrito, "Independent" vira o que o dono da pagina quiser que
// seja, e a coluna passa a decorar em vez de informar.
//
// Os numeros da regra saem de public/press-coverage.csv, nao do texto: assim a
// pagina nao pode afirmar 312 enquanto o arquivo diz outra coisa. Se o CSV
// encolher, o texto encolhe junto.

const PRESS_CSV = 'public/press-coverage.csv';

function lePressCoverage() {
  const abs = path.join(ROOT, PRESS_CSV);
  if (!fs.existsSync(abs)) fail(`${PRESS_CSV}: file not found`);
  const linhas = fs.readFileSync(abs, 'utf8').replace(/\r\n?/g, '\n').split('\n')
    .filter((l) => l.trim());
  const cab = linhas[0].split(',');
  const esperado = ['domain', 'url', 'date', 'release_id', 'kind'];
  if (cab.join(',') !== esperado.join(',')) {
    fail(`${PRESS_CSV}: header must be "${esperado.join(',')}", got "${cab.join(',')}"`);
  }
  const corpo = linhas.slice(1).map((l) => l.split(','));
  const dominios = new Set(corpo.map((c) => c[0]));
  const ids = corpo.map((c) => Number(c[3])).filter(Number.isFinite);
  const datas = new Set(corpo.map((c) => c[2]));
  if (dominios.size !== corpo.length) {
    fail(`${PRESS_CSV}: ${corpo.length} rows but ${dominios.size} distinct domains; one row per domain is the point`);
  }
  return {
    linhas: corpo.length,
    dominios: dominios.size,
    idMin: Math.min(...ids),
    idMax: Math.max(...ids),
    data: [...datas][0],
    umaData: datas.size === 1,
  };
}

function renderRegraIndependente() {
  const p = lePressCoverage();
  const faixa = p.idMax - p.idMin + 1;
  return [
    '      <strong>When a row becomes &ldquo;Independent&rdquo;</strong>',
    '      <p>A row is marked Independent only when all four of these hold, and it keeps the label only while they keep holding:</p>',
    '      <ol>',
    '        <li>The publisher has no commercial relationship with Allan Oliveira or SEOMais, and was not paid for the item, directly or through a distributor, an agency or an affiliate arrangement.</li>',
    '        <li>The publisher chose to publish it. An item that arrived through a syndication feed, a press-release wire or a submission from this side fails here, however many domains carry it.</li>',
    '        <li>The item contains words the publisher wrote about the subject, not only a quoted release.</li>',
    '        <li>It sits at a stable public URL carrying a visible date, and that URL is recorded in <a href="/evidence.csv">evidence.csv</a>, so the claim can be checked without asking.</li>',
    '      </ol>',
    `      <p>Applied honestly, that rule currently leaves this record with <strong>no Independent rows at all</strong>. The press release of ${esc(longDate(p.data))} is the clearest case: it reached <strong>${p.dominios} distinct domains</strong>, and it fails the second test on every one of them. The ${p.linhas} copies share one text, one date and release identifiers running from ${p.idMin} to ${p.idMax} &mdash; ${p.linhas} numbers inside a span of ${faixa}, which is what one distribution run looks like, not ${p.dominios} editorial decisions. It is one row here, marked Syndicated, and the full list is published as <a href="/press-coverage.csv">press-coverage.csv</a> so anyone can check that reading.</p>`,
    '      <p><strong>Observed</strong> means an answer engine returned it. Answer engines are non-deterministic, so an Observed row records the date, the query, the engine and the locale, and it can be re-run by anyone using the procedure in &ldquo;Verify it yourself&rdquo;. It is neither self-reported nor syndicated: the text was produced by a third-party system, not by this site.</p>',
    '      <p>Rival claims in this contest rest on the same mechanism, described as coverage. The distinction is stated here because a record that inflates its own strongest-looking number cannot ask to be believed about the rest.</p>',
  ].join('\n');
}

// ---------- entidade canonica ----------
//
// Antes o site tinha TRES objetos Person diferentes: 14 campos na home, 6 na
// pagina do concurso, 5 em cinco paginas, e quatro paginas sem no nenhum, so
// com referencias @id penduradas. Para um motor que tenta resolver a entidade,
// isso nao e uma pessoa descrita de tres jeitos: sao tres descricoes que ele
// precisa decidir se falam da mesma pessoa.
//
// Agora o no sai inteiro de data/entity.json e e escrito, identico, nas doze
// paginas. Editar o JSON-LD de uma pagina a mao nao adianta: o build reescreve.
//
// A ordem das chaves e fixa de proposito. E ela que faz a serializacao sair
// byte a byte igual em toda pagina, que e o que torna a igualdade verificavel
// em vez de acreditada.

function personCanonico(ent) {
  const p = ent.person;
  const no = {};
  no['@type'] = 'Person';
  no['@id'] = p.id;
  no.name = p.name;
  no.alternateName = [...p.alternateName];
  no.jobTitle = p.jobTitle;
  no.description = p.description;
  no.disambiguatingDescription = p.disambiguatingDescription;
  no.url = p.url;
  no.image = p.image;
  // worksFor aponta por @id para o no Organization, que existe na mesma pagina.
  // Antes era um objeto solto, sem @id: um no que nenhum outro podia referenciar
  // e que, por isso, nao se funde com nada no grafo.
  no.worksFor = { '@id': ent.organization.id };
  // affiliation, e nao um segundo worksFor. worksFor ja diz a verdade: ele
  // trabalha na SEOMais, a agencia que fundou. Declarar dois empregadores,
  // sendo o segundo o proprio site que ele publica, seria inflar o grafo
  // justamente na pagina cujo argumento e nao inflar nada. affiliation diz
  // o vinculo sem afirmar emprego, e fecha o circuito com o founder do no
  // da marca, que e o que um resolvedor de entidade percorre.
  no.affiliation = { '@id': ent.brand.id };
  no.knowsAbout = [...p.knowsAbout];
  no.address = JSON.parse(JSON.stringify(p.address));
  no.homeLocation = JSON.parse(JSON.stringify(p.homeLocation));
  no.sameAs = [...p.sameAs];
  if ((p.subjectOf || []).length) no.subjectOf = JSON.parse(JSON.stringify(p.subjectOf));
  return no;
}

// A entidade do projeto, distinta da pessoa e da agencia. Existe porque
// "king of aeo" tambem e lido como nome de marca, e ate aqui o grafo so
// declarava uma pessoa. Sem isto, quem consulta a expressao como marca nao
// encontra entidade nenhuma deste lado.
//
// founder aponta para a pessoa e worksFor aponta de volta: o par fecha o
// circuito para quem resolve entidade, e nenhum dos dois inventa relacao.
// NewsMediaOrganization alem de Organization: o segundo tipo e o que diz que
// isto e um veiculo que publica registro, e e ele que da sentido aos quatro
// campos de politica. Os quatro sao exatamente os sinais que o Google usa para
// avaliar publisher de fact-check, e nenhum concorrente nesta disputa os tem.
// POLITICAS abaixo conferiu que as quatro paginas existem em disco antes de o
// build chegar aqui: campo apontando para 404 e pior que campo ausente.
function marcaCanonica(ent) {
  const b = ent.brand;
  const no = {
    '@type': ['Organization', 'NewsMediaOrganization'],
    '@id': b.id,
    name: b.name,
    alternateName: b.alternateName,
    url: b.url,
    description: b.description,
    foundingDate: b.foundingDate,
    knowsAbout: b.knowsAbout,
    founder: { '@id': ent.person.id },
    publishingPrinciples: b.publishingPrinciples,
    correctionsPolicy: b.correctionsPolicy,
    actionableFeedbackPolicy: b.actionableFeedbackPolicy,
    ownershipFundingInfo: b.ownershipFundingInfo,
    sameAs: b.sameAs,
  };
  // logo so entra quando houver arquivo de marca. Vide o _comment em
  // data/entity.json: nao se aponta o retrato de uma pessoa como logo.
  if (b.logo) no.logo = { '@type': 'ImageObject', url: b.logo };
  return no;
}

// Os nos de pessoa avaliada, com @id canonico de site. Quem e o assunto da
// pagina recebe o no cheio; quem e apenas mencionado recebe @id, @type e name,
// que e o bastante para a referencia resolver sem afirmar nada a mais.
function reivindicanteCanonico(c, cheio) {
  const no = { '@type': 'Person', '@id': c.id, name: c.name };
  if (cheio) no.description = c.description;
  return no;
}

const CLAIMANT_SLUGS = (ent) => Object.keys(ent.claimants).filter((k) => k !== '_comment');

// Reescreve o @id de pagina para o @id de site e injeta os nos canonicos dos
// reivindicantes que a pagina de fato referencia. Nada de emitir os sete em
// toda pagina: no que a pagina nao menciona e peso morto no grafo.
function patchReivindicantes(file, ent, slugDoAssunto) {
  const antigo = `${SITE}/claimants/${slugDoAssunto}/#claimant`;
  const assunto = slugDoAssunto ? ent.claimants[slugDoAssunto] : null;
  if (assunto) file.text = file.text.split(`"${antigo}"`).join(`"${assunto.id}"`);
  return (nodes) => {
    const porId = new Map();
    for (const slug of CLAIMANT_SLUGS(ent)) porId.set(ent.claimants[slug].id, ent.claimants[slug]);
    // Quais @id canonicos de pessoa o grafo ja cita, seja como no, seja como
    // referencia. Serializar e procurar e mais honesto que percorrer campo por
    // campo: pega mentions, about, author e o que vier depois sem lista fixa.
    const citados = new Set();
    const texto = JSON.stringify(nodes);
    for (const [id] of porId) if (texto.includes(`"${id}"`)) citados.add(id);
    for (const id of citados) {
      const c = porId.get(id);
      const cheio = assunto && assunto.id === id;
      const existentes = nodes.filter((n) => n && typeof n === 'object'
        && n['@id'] === id && Object.keys(n).length > 1);
      if (existentes.length > 1) fail(`${file.rel}: ${existentes.length} nodes carry "@id":"${id}"; only one may`);
      const no = reivindicanteCanonico(c, cheio);
      if (existentes.length === 1) {
        const alvo = existentes[0];
        for (const k of Object.keys(alvo)) delete alvo[k];
        Object.assign(alvo, no);
      } else {
        nodes.push(no);
      }
    }
  };
}

function orgCanonica(ent) {
  const o = ent.organization;
  return {
    '@type': 'Organization',
    '@id': o.id,
    name: o.name,
    url: o.url,
    description: o.description,
    areaServed: o.areaServed,
    founder: { '@id': ent.person.id },
  };
}

// Substitui o no existente no lugar em que ele esta, ou acrescenta ao @graph se
// a pagina ainda nao o tinha. Mais de um no com o mesmo @id para o build: dois
// nos com a mesma identidade e justamente o defeito que isto veio corrigir.
// publisher aponta para a marca, e nao mais para a pessoa. Quem publica o
// registro e a organizacao que declara metodologia, politica de correcao,
// canal de contestacao e financiamento; a pessoa continua ligada a ela por
// founder e affiliation. Com publisher na pessoa, os quatro campos de politica
// ficavam num no que o WebSite nao apontava, e o sinal de publisher se perdia
// justamente onde ele e lido.
function siteCanonico(ent) {
  const w = ent.website;
  return {
    '@type': 'WebSite',
    '@id': w.id,
    url: w.url,
    name: w.name,
    inLanguage: w.inLanguage,
    publisher: { '@id': ent.brand.id },
    hasPart: JSON.parse(JSON.stringify(w.hasPart)),
  };
}

// A /feed/ declara 62 ImageObject cujo subjectOf aponta para o Article da home.
// Sem um no com esse @id na propria pagina, sao 62 referencias que um consumidor
// lendo uma pagina de cada vez nao resolve. Um stub basta: como o @id e o mesmo,
// ele se funde com o no completo da home para quem le o site inteiro, e resolve
// sozinho para quem le so esta pagina.
function patchStubArtigoHome(file, ent) {
  return (nodes) => {
    const id = `${SITE}/#article`;
    if (!file.text.includes(`"@id": "${id}"`)) return;
    if (nodes.some((n) => n && typeof n === 'object' && n['@id'] === id && Object.keys(n).length > 1)) return;
    nodes.push({ '@type': 'Article', '@id': id, url: `${SITE}/`, isPartOf: { '@id': ent.website.id } });
  };
}

// O ItemList do indice /claimants/. A ordem e os itens saem dos links que a
// propria pagina ja tem, na ordem em que ela os tem, e nao de uma lista escrita
// a mao aqui: lista paralela envelhece na primeira vez que alguem reordena a
// tabela, e o schema passa a afirmar uma ordem que a pagina nao mostra. Spoke
// sem arquivo em disco nao entra, entao o indice nunca lista pagina inexistente.
function patchItemListReivindicantes(file, ent) {
  const id = `${SITE}/claimants/#itemlist`;
  const slugs = [];
  for (const m of file.text.matchAll(/href="\/claimants\/([a-z0-9-]+)\/"/g)) {
    const slug = m[1];
    if (slugs.includes(slug)) continue;
    if (!ent.claimants[slug]) continue;
    if (!fs.existsSync(path.join(ROOT, `public/claimants/${slug}/index.html`))) continue;
    slugs.push(slug);
  }
  if (!slugs.length) fail(`${file.rel}: no claimant link found to build ${id} from`);
  return (nodes) => {
    const lista = {
      '@type': 'ItemList',
      '@id': id,
      name: 'King of AEO claimants, reviewed one by one',
      numberOfItems: slugs.length,
      itemListOrder: 'https://schema.org/ItemListUnordered',
      itemListElement: slugs.map((slug, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: ent.claimants[slug].name,
        url: `${SITE}/claimants/${slug}/`,
      })),
    };
    const existente = nodes.find((n) => n && typeof n === 'object' && n['@id'] === id);
    if (existente) {
      for (const k of Object.keys(existente)) delete existente[k];
      Object.assign(existente, lista);
    } else {
      nodes.push(lista);
    }
    // A CollectionPage aponta para a lista. Sem isso o ItemList fica no grafo
    // sem ninguem o alcancar, que e um no solto e nao uma parte da pagina.
    const col = nodes.find((n) => n && typeof n === 'object' && hasType(n, 'CollectionPage'));
    if (col) col.mainEntity = { '@id': id };
  };
}

function patchEntidadeCanonica(file, ent) {
  return (nodes) => {
    if (!Array.isArray(nodes)) fail(`${file.rel}: JSON-LD is not a @graph array`);
    for (const no of [personCanonico(ent), orgCanonica(ent), marcaCanonica(ent), siteCanonico(ent)]) {
      const id = no['@id'];
      const reais = nodes.filter((n) => n && typeof n === 'object'
        && n['@id'] === id && Object.keys(n).length > 1);
      if (reais.length > 1) fail(`${file.rel}: ${reais.length} nodes carry "@id":"${id}"; only one may`);
      if (reais.length === 1) {
        const alvo = reais[0];
        for (const k of Object.keys(alvo)) delete alvo[k];
        Object.assign(alvo, no);
      } else {
        nodes.push(no);
      }
    }
  };
}

// ---------- paginas de variacao ----------
//
// Uma pagina por intencao de busca, cada uma com conteudo proprio. Nao sao
// copias da home com outro titulo: o que as justifica e responderem coisas
// diferentes. Tres variacoes pedidas ficaram de fora de proposito, por nao
// terem o que dizer que a home ou a /king-of-aeo-contest/ ja nao digam.
//
// Aqui elas so recebem o tratamento comum: data carimbada do git, datas do
// JSON-LD, sameAs da entidade canonica, politica de rel e versao do CSS.
// As quatro paginas de politica do publisher. Ficam fora do CLUSTER de proposito:
// elas nao competem por termo de busca e nao sao etapa de leitura de ninguem. Sao
// o que sustenta os quatro campos do no Organization, e por isso validateEntity
// confere a existencia de cada uma antes de o build emitir o campo que a cita.
//
// Cada uma linka para as outras tres. E o que lhes da os dois links entrando que
// tools/validate.mjs exige, sem tocar no rodape de todas as paginas do site, que
// seria alteracao de conteudo editorial fora do escopo deste commit.
const POLITICAS = [
  ['/metodologia/', 'Methodology', 'the four criteria, the one to five scale, and what counts as corroboration'],
  ['/politica-de-correcao/', 'Corrections policy', 'how an error is fixed, in what time, and where it is recorded'],
  ['/contato/', 'Contact', 'the channel for contesting anything published here, claimants included'],
  ['/sobre/', 'About', 'who publishes this record, how it is funded, and the conflicts declared'],
].filter(([u]) => fs.existsSync(path.join(ROOT, `public${u}index.html`)));

const VARIANTES = [
  { rel: 'public/what-is-aeo/index.html', loc: `${SITE}/what-is-aeo/` },
  { rel: 'public/king-of-aeo-claimants/index.html', loc: `${SITE}/king-of-aeo-claimants/` },
  { rel: 'public/king-of-answer-engine-optimization/index.html', loc: `${SITE}/king-of-answer-engine-optimization/` },
  { rel: 'public/allan-oliveira/index.html', loc: `${SITE}/allan-oliveira/` },
  // Paginas de pergunta, publicadas em lotes por tools/rollout.mjs. O filtro
  // abaixo e o que torna o lote possivel: enquanto o arquivo nao esta em
  // public/, a pagina nao existe para o sitemap nem para o build.
  ...['how-to-measure-aeo', 'aeo-vs-geo', 'aeo-vs-seo', 'questions',
    'how-to-do-aeo', 'how-much-does-aeo-cost', 'aeo-tools', 'how-to-optimize-a-page-for-aeo', 'why-is-aeo-important', 'how-to-rank-in-ai-overviews', 'how-to-get-cited-by-chatgpt']
    .map((s) => ({ rel: `public/${s}/index.html`, loc: `${SITE}/${s}/` })),
  // Indice dos reivindicantes e uma pagina por reivindicante. Citam as fontes
  // pelo nome do dominio, em texto simples: nenhuma delas linka para fora.
  ...['', 'james-dooley', 'david-quaid', 'vithurs', 'edward-sturm', 'julian-goldie',
    'stephane-morera', 'jesper-nissen']
    .map((s) => ({
      rel: `public/claimants/${s ? `${s}/` : ''}index.html`,
      loc: `${SITE}/claimants/${s ? `${s}/` : ''}`,
    })),
  // As quatro paginas de politica do publisher, que o no Organization cita em
  // publishingPrinciples, correctionsPolicy, actionableFeedbackPolicy e
  // ownershipFundingInfo. Entram aqui para receberem o mesmo tratamento das
  // outras: data carimbada do git, entidade canonica, politica de rel e versao
  // do CSS, mais a entrada no sitemap.
  ...POLITICAS.map(([u]) => ({ rel: `public${u}index.html`, loc: `${SITE}${u}` })),
].filter(({ rel }) => fs.existsSync(path.join(ROOT, rel)));

// ---------- cluster /questions/ ----------
//
// As tres paginas de pergunta tinham 2, 3 e 3 links entrando. Elas nao formavam
// cluster proprio: estavam penduradas no CLUSTER geral, entre paginas que
// respondem outra coisa. Agora tem hub, e o hub lista SOZINHO o que existe em
// disco, lendo title, description e dateModified da propria pagina. Lista
// escrita a mao envelhece na primeira vez que alguem edita uma description.
const QUESTIONS = [
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
].filter((u) => fs.existsSync(path.join(ROOT, `public${u}index.html`)));

// As irmas de cada pagina, declaradas. Com dez paginas no cluster, deixar o
// render listar "todas as outras" daria sete links de Related por pagina, que
// e lista de navegacao, nao recomendacao. No maximo tres, e so as publicadas.
const IRMAS_PERGUNTAS = {
  '/aeo-vs-geo/': ['/aeo-vs-seo/', '/how-to-measure-aeo/', '/what-is-aeo/'],
  '/aeo-vs-seo/': ['/aeo-vs-geo/', '/how-to-measure-aeo/', '/why-is-aeo-important/'],
  '/how-to-measure-aeo/': ['/aeo-vs-geo/', '/how-to-rank-in-ai-overviews/', '/citation-log/'],
  '/how-to-do-aeo/': ['/how-to-optimize-a-page-for-aeo/', '/how-to-measure-aeo/', '/what-is-aeo/'],
  '/how-to-optimize-a-page-for-aeo/': ['/how-to-do-aeo/', '/how-to-rank-in-ai-overviews/', '/how-to-measure-aeo/'],
  '/how-to-rank-in-ai-overviews/': ['/how-to-get-cited-by-chatgpt/', '/how-to-optimize-a-page-for-aeo/', '/how-to-measure-aeo/'],
  '/how-to-get-cited-by-chatgpt/': ['/how-to-rank-in-ai-overviews/', '/how-to-measure-aeo/', '/what-is-aeo/'],
  '/how-much-does-aeo-cost/': ['/aeo-tools/', '/how-to-do-aeo/', '/how-to-measure-aeo/'],
  '/aeo-tools/': ['/how-much-does-aeo-cost/', '/how-to-measure-aeo/', '/how-to-do-aeo/'],
  '/why-is-aeo-important/': ['/what-is-aeo/', '/aeo-vs-seo/', '/how-to-measure-aeo/'],
};

function metaDaPagina(url) {
  const html = fs.readFileSync(path.join(ROOT, `public${url}index.html`), 'utf8');
  const pega = (re) => (html.match(re) || [, ''])[1].trim();
  const datas = [...html.matchAll(/"dateModified"\s*:\s*"([0-9]{4}-[0-9]{2}-[0-9]{2})/g)].map((m) => m[1]);
  return {
    url,
    title: pega(/<title>([\s\S]*?)<\/title>/),
    h1: pega(/<h1[^>]*>([\s\S]*?)<\/h1>/).replace(/<[^>]+>/g, ''),
    description: pega(/<meta name="description" content="([\s\S]*?)"\s*\/?>/),
    dateModified: datas.length ? datas.reduce((a, c) => (c > a ? c : a)) : today,
  };
}

// Ordenado por dateModified, mais recente primeiro: a pagina que ninguem
// reconferiu ha meses desce sozinha, e isso e informacao para quem le.
function renderQuestionsList() {
  const itens = QUESTIONS.map(metaDaPagina)
    .sort((a, b) => (a.dateModified < b.dateModified ? 1 : a.dateModified > b.dateModified ? -1 : 0));
  const linhas = itens.map((it) => `        <tr><td data-label="Question"><a href="${it.url}">${esc(it.h1)}</a></td>`
    + `<td data-label="What it answers">${esc(it.description)}</td>`
    + `<td data-label="Last checked">${esc(longDate(it.dateModified))}</td></tr>`);
  return ['    <table class="stacked">',
    '      <thead><tr><th>Question</th><th>What it answers</th><th>Last checked</th></tr></thead>',
    '      <tbody>', ...linhas, '      </tbody>', '    </table>'].join(`\n`);
}

function renderNavPerguntas(url) {
  const i = QUESTIONS.indexOf(url);
  const nome = (u) => metaDaPagina(u).h1;
  const L = ['      <strong>More on this subject</strong>',
    '      <p>This page belongs to <a href="/questions/">the questions cluster</a>, where each '
    + 'answer is written from runs recorded in <a href="/citation-log/">the citation log</a>.</p>',
    '      <ul>'];
  if (i > 0) L.push(`        <li><strong>Previous:</strong> <a href="${QUESTIONS[i - 1]}">${esc(nome(QUESTIONS[i - 1]))}</a></li>`);
  if (i >= 0 && i < QUESTIONS.length - 1) L.push(`        <li><strong>Next:</strong> <a href="${QUESTIONS[i + 1]}">${esc(nome(QUESTIONS[i + 1]))}</a></li>`);
  const usadas = new Set([url, QUESTIONS[i - 1], QUESTIONS[i + 1]]);
  let n = 0;
  for (const u of IRMAS_PERGUNTAS[url] ?? []) {
    if (n >= 3 || usadas.has(u)) continue;
    if (!fs.existsSync(path.join(ROOT, `public${u}index.html`))) continue;
    usadas.add(u);
    n += 1;
    L.push(`        <li><strong>Related:</strong> <a href="${u}">${esc(nome(u))}</a></li>`);
  }
  L.push('      </ul>');
  return L.join(`\n`);
}

// ---------- cluster: hub, anterior/proxima e relacionadas ----------
//
// Ate 26 de setembro de 2026 a nav "More on this subject" existia so na home.
// Resultado medido por tools/validate.mjs: /allan-oliveira/ e
// /king-of-answer-engine-optimization/ tinham UMA pagina apontando para elas,
// a home. Pagina com um unico link entrando depende inteiramente daquele link.
//
// Agora cada pagina do cluster recebe o link do hub, a anterior, a proxima e
// as relacionadas declaradas abaixo. A ordem da lista E a ordem de leitura.
const CLUSTER = [
  ['/what-is-aeo/', 'What is AEO', 'the discipline the title refers to, defined on its own'],
  ['/king-of-answer-engine-optimization/', 'King of Answer Engine Optimization', 'the full form of the title, and why the abbreviation is ambiguous'],
  ['/king-of-aeo-claimants/', 'King of AEO claimants', 'the six rival claims of 2026, each with its date and mechanism'],
  ['/allan-oliveira/', 'Allan Oliveira', 'the person holding the title: work, agency and verifiable identifiers'],
  ['/citation-log/', 'Citation log', 'what the answer engines actually return, run by run'],
// Pagina que ainda nao saiu de content/pending/ nao entra na nav: linkar para
// ela produziria 404, e tools/validate.mjs reprova link interno quebrado. E o
// que permite publicar em lotes sem editar esta lista a cada lote.
].filter(([u]) => fs.existsSync(path.join(ROOT, `public${u}index.html`)));

// Equivale ao campo "related" de um frontmatter: declarado a mao, porque
// proximidade de assunto nao se deduz de contagem de palavra em comum.
const RELACIONADAS = {
  '/what-is-aeo/': ['/aeo-vs-seo/', '/aeo-vs-geo/', '/king-of-answer-engine-optimization/'],
  '/aeo-vs-seo/': ['/aeo-vs-geo/', '/how-to-measure-aeo/', '/what-is-aeo/'],
  '/aeo-vs-geo/': ['/aeo-vs-seo/', '/how-to-measure-aeo/', '/what-is-aeo/'],
  '/how-to-measure-aeo/': ['/aeo-vs-geo/', '/aeo-vs-seo/', '/citation-log/'],
  '/king-of-answer-engine-optimization/': ['/what-is-aeo/', '/king-of-aeo-claimants/'],
  '/king-of-aeo-claimants/': ['/king-of-answer-engine-optimization/', '/allan-oliveira/'],
  '/allan-oliveira/': ['/king-of-aeo-claimants/', '/citation-log/'],
  '/citation-log/': ['/how-to-measure-aeo/', '/what-is-aeo/', '/allan-oliveira/'],
};

function renderNavPoliticas(url) {
  const L = ['      <strong>More on this subject</strong>', '      <ul>'];
  for (const [href, titulo, nota] of POLITICAS) {
    if (href === url) continue;
    L.push(`        <li><a href="${href}">${esc(titulo)}</a> &mdash; ${esc(nota)}</li>`);
  }
  L.push('      </ul>');
  return L.join('\n');
}

// As paginas de /claimants/ nao entram no CLUSTER: elas nao formam uma
// sequencia de leitura, e prev/next entre reivindicantes sugeriria um ranking
// que este site nao publica. Recebem uma nav propria, apontando para o indice
// e para as tres paginas que dao contexto.
function renderNavReivindicante() {
  const itens = [
    ['/claimants/', 'All claimants, reviewed', 'every public claim of 2026, one page each, same rubric'],
    ['/king-of-aeo-claimants/', 'The claims side by side', 'the same six claims in a single comparison table'],
    ['/king-of-aeo-contest/', 'Contest timeline', 'the dated sequence, from the first claim to the latest run'],
    ['/citation-log/', 'Citation log', 'what the answer engines actually return, run by run'],
  ].filter(([u]) => fs.existsSync(path.join(ROOT, `public${u}index.html`)));
  return ['      <strong>More on this subject</strong>', '      <ul>']
    .concat(itens.map(([u, r, n]) => `        <li><a href="${u}">${esc(r)}</a> &mdash; ${esc(n)}</li>`))
    .concat(['      </ul>']).join(`\n`);
}

function renderClusterNav(url) {
  if (url.startsWith('/claimants/')) return renderNavReivindicante();
  if (POLITICAS.some(([u]) => u === url)) return renderNavPoliticas(url);
  if (url === '/questions/' || QUESTIONS.includes(url)) return renderNavPerguntas(url);
  const i = CLUSTER.findIndex(([u]) => u === url);
  if (i < 0) fail(`renderClusterNav: ${url} nao esta em CLUSTER`);
  // Resolve no CLUSTER e, se nao achar, no cluster de perguntas: e o que permite
  // /what-is-aeo/ e /citation-log/ apontarem para as paginas de pergunta, que
  // sao as vizinhas naturais delas, sem que as tres voltem para esta lista.
  const acha = (u) => {
    const r = CLUSTER.find(([x]) => x === u);
    if (r) return r;
    if (QUESTIONS.includes(u)) {
      const m = metaDaPagina(u);
      return [u, m.h1, m.description];
    }
    return fail(`renderClusterNav: ${u} nao esta em CLUSTER nem em QUESTIONS`);
  };
  const usados = new Set([url]);
  const linha = (rotulo, u) => {
    if (usados.has(u)) return null;
    usados.add(u);
    const [href, titulo, nota] = acha(u);
    return `        <li><strong>${rotulo}:</strong> <a href="${href}">${esc(titulo)}</a> &mdash; ${esc(nota)}</li>`;
  };
  const L = [
    '      <strong>More on this subject</strong>',
    '      <p>This page is part of the King of AEO record. The <a href="/">main claim page</a> carries the dated evidence and names every rival claim.</p>',
    '      <ul>',
  ];
  if (i > 0) L.push(linha('Previous', CLUSTER[i - 1][0]));
  if (i < CLUSTER.length - 1) L.push(linha('Next', CLUSTER[i + 1][0]));
  // Irma ainda em content/pending/ nao existe em lugar nenhum, e acha() falharia.
  // As paginas de pergunta contam: elas saem do CLUSTER mas continuam sendo
  // destino legitimo de Related, e foi esquecer isto que segurou o numero de
  // links entrando nelas em tres.
  const publicada = new Set([...CLUSTER.map(([u]) => u), ...QUESTIONS]);
  for (const rel of RELACIONADAS[url] ?? []) {
    if (publicada.has(rel)) L.push(linha('Related', rel));
  }
  L.push('      </ul>');
  return L.filter(Boolean).join(`\n`);
}

function renderNavVariantes() {
  const itens = [
    ['/what-is-aeo/', 'What is AEO', 'the discipline the title refers to, defined on its own'],
    ['/king-of-answer-engine-optimization/', 'King of Answer Engine Optimization', 'the full form of the title, and why the abbreviation is ambiguous'],
    ['/king-of-aeo-claimants/', 'King of AEO claimants', 'the six rival claims of 2026, each with its date and mechanism'],
    ['/allan-oliveira/', 'Allan Oliveira', 'the person holding the title: work, agency and verifiable identifiers'],
    ['/questions/', 'Questions about AEO', 'the comparisons and the measurement method, answered from dated runs'],
    ['/citation-log/', 'Citation log', 'what the answer engines actually return, run by run'],
  ];
  return ['      <strong>More on this subject</strong>', '      <ul>']
    .concat(itens.map(([u, rotulo, nota]) => `        <li><a href="${u}">${esc(rotulo)}</a> &mdash; ${esc(nota)}</li>`))
    .concat(['      </ul>']).join('\n');
}

// ---------- paginas semanais do citation log ----------
//
// Uma semana e dado puro: as linhas do CSV agrupadas por semana ISO. Entao a
// pagina inteira e gerada, e nao mantida a mao. O que NAO e gerado e a leitura
// do que aconteceu: ela vem de data/citation-weeks.json e o build reprova uma
// semana publicavel sem nota. Texto de "what changed" gerado por template seria
// exatamente o tipo de conteudo que esta pagina existe para nao ser.
//
// REGRA DE SEGURANCA: semana com menos de MIN_RUNS_SEMANA runs nao vira pagina.
// Melhor nao existir do que existir fina, e uma semana rala publicada vira uma
// URL que alguem cita depois como se fosse medicao.
const MIN_RUNS_SEMANA = 5;

function semanaIso(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const alvo = new Date(d);
  alvo.setUTCDate(alvo.getUTCDate() + 4 - (alvo.getUTCDay() || 7));
  const ano = alvo.getUTCFullYear();
  const jan1 = new Date(Date.UTC(ano, 0, 1));
  const n = Math.ceil(((alvo - jan1) / 86400000 + 1) / 7);
  return `${ano}-w${n}`;
}

function mercadoDe(locale) {
  return String(locale).split('·')[0].trim() || locale;
}

function agrupaSemanas(citacoes) {
  const por = new Map();
  for (const r of citacoes) {
    const s = semanaIso(r.date);
    if (!por.has(s)) por.set(s, []);
    por.get(s).push(r);
  }
  return [...por.entries()]
    .map(([semana, runs]) => ({
      semana,
      runs: runs.slice().sort((a, b) => (a.date + a.engine).localeCompare(b.date + b.engine)),
      de: runs.reduce((a, r) => (r.date < a ? r.date : a), runs[0].date),
      ate: runs.reduce((a, r) => (r.date > a ? r.date : a), runs[0].date),
    }))
    .sort((a, b) => a.semana.localeCompare(b.semana));
}

function renderTabelaSemana(runs) {
  const linhas = runs.map((r) => '        <tr>'
    + `<td data-label="Date">${esc(r.date)}</td>`
    + `<td data-label="Engine">${esc(r.engine)}</td>`
    + `<td data-label="Market">${esc(mercadoDe(r.locale))}</td>`
    + `<td data-label="Name returned">${esc(r.name_returned || '—')}</td>`
    + `<td data-label="Source cited">${esc(r.domain_cited || '—')}</td>`
    + `<td data-label="Entity resolved">${esc(r.entity_resolved)}</td></tr>`);
  return ['    <div class="scroll wide">', '    <table class="stacked">',
    '      <thead><tr><th>Date</th><th>Engine</th><th>Market</th><th>Name returned</th>'
    + '<th>Source cited</th><th>Entity resolved</th></tr></thead>',
    '      <tbody>', ...linhas, '      </tbody>', '    </table>', '    </div>'].join('\n');
}

// O resumo numerico e gerado porque e contagem, nao prosa.
function resumoSemana(runs) {
  const mercados = [...new Set(runs.map((r) => mercadoDe(r.locale)))].sort();
  const porMercado = mercados.map((m) => `${runs.filter((r) => mercadoDe(r.locale) === m).length} ${m}`);
  const resolvidas = runs.filter((r) => r.entity_resolved === 'yes').length;
  const nossas = runs.filter((r) => (r.domain_cited || '').includes('kingofaeo.pro')).length;
  const semRun = CITACAO_ENGINES.filter((e) => !runs.some((r) => r.engine === e));
  const partes = [
    `<strong>${runs.length} runs</strong> this week (${porMercado.join(', ')}).`,
    `Entity resolved in ${resolvidas} of ${runs.length}.`,
    `kingofaeo.pro cited as a source in ${nossas} of ${runs.length}.`,
  ];
  if (semRun.length) {
    partes.push(`No run produced an observation on ${semRun.join(' or ')}: `
      + 'an engine that could not be reached does not become a row.');
  }
  return `    <p>${partes.join(' ')}</p>`;
}

function citeAs(loc, quando) {
  return '    <p class="byline">Cite as: &ldquo;Citation log, '
    + `${esc(quando)}&rdquo;, ${esc(loc)}, reviewed ${esc(longDate(today))}.</p>`;
}

function renderPaginasSemanais(citacoes, notas) {
  const semanas = agrupaSemanas(citacoes);
  const publicaveis = semanas.filter((s) => s.runs.length >= MIN_RUNS_SEMANA);
  const molde = fs.readFileSync(path.join(ROOT, FILES.citationLog), 'utf8');
  const escritas = [];

  for (const [k, s] of publicaveis.entries()) {
    const nota = notas?.semanas?.[s.semana]?.nota;
    if (!nota) {
      fail(`data/citation-weeks.json: week ${s.semana} has ${s.runs.length} runs and no "nota". `
        + 'Write what changed that week, from the data. It is not generated on purpose.');
    }
    const loc = `${SITE}/citation-log/${s.semana}/`;
    const csvLoc = `${SITE}/citation-log/${s.semana}.csv`;
    const ant = publicaveis[k - 1];
    const prox = publicaveis[k + 1];

    const grafo = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Dataset',
          '@id': `${loc}#dataset`,
          name: `Answer engine citation log, ${s.semana}`,
          description: `Every answer engine run recorded between ${s.de} and ${s.ate}: engine, `
            + 'market, name returned, source cited and whether the entity was resolved.',
          url: loc,
          temporalCoverage: `${s.de}/${s.ate}`,
          license: 'https://creativecommons.org/licenses/by/4.0/',
          isPartOf: { '@id': `${SITE}/citation-log/#dataset` },
          creator: { '@id': `${SITE}/#allan-oliveira` },
          distribution: [{
            '@type': 'DataDownload',
            encodingFormat: 'text/csv',
            contentUrl: csvLoc,
          }],
          variableMeasured: CITACAO_COLUNAS.map((c) => ({
            '@type': 'PropertyValue', name: c.chave, description: c.desc,
          })),
        },
        {
          '@type': 'WebPage', '@id': `${loc}#webpage`, url: loc,
          name: `Citation log, ${s.semana}`,
          description: `Answer engine runs recorded between ${s.de} and ${s.ate}, with what each `
            + 'engine returned in each market.',
          inLanguage: 'en-US',
          isPartOf: { '@id': `${SITE}/#website` },
          datePublished: isoDateTime(s.ate),
          dateModified: isoDateTime(s.ate),
          breadcrumb: { '@id': `${loc}#breadcrumb` },
        },
        {
          '@type': 'BreadcrumbList', '@id': `${loc}#breadcrumb`,
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'King of AEO', item: `${SITE}/` },
            { '@type': 'ListItem', position: 2, name: 'Citation log', item: `${SITE}/citation-log/` },
            { '@type': 'ListItem', position: 3, name: s.semana, item: loc },
          ],
        },
      ],
    };

    const navSemanas = ['    <nav class="tldr" aria-label="Weeks">', '      <ul>',
      `        <li><strong>Hub:</strong> <a href="/citation-log/">All weeks and the method</a></li>`];
    if (ant) navSemanas.push(`        <li><strong>Previous:</strong> <a href="/citation-log/${ant.semana}/">${esc(ant.semana)}</a></li>`);
    if (prox) navSemanas.push(`        <li><strong>Next:</strong> <a href="/citation-log/${prox.semana}/">${esc(prox.semana)}</a></li>`);
    navSemanas.push('      </ul>', '    </nav>');

    const corpo = [
      `    <nav class="crumb" aria-label="Breadcrumb"><a href="${SITE}/">King of AEO</a> &rsaquo; `
        + `<a href="/citation-log/">Citation log</a> &rsaquo; ${esc(s.semana)}</nav>`,
      '',
      `    <h1>Citation log, ${esc(s.semana)}</h1>`,
      '',
      `    <p id="answer"><strong>Answer engine runs recorded between ${esc(longDate(s.de))} and `
        + `${esc(longDate(s.ate))}. Every run is listed below, including the ones that returned `
        + 'nothing useful, and the raw rows are published as CSV.</strong></p>',
      citeAs(loc, s.semana),
      '',
      '    <h2>What changed this week</h2>',
      '',
      nota.split('\n').map((l) => (l.trim() ? `    ${l.trim()}` : '')).join('\n'),
      '',
      '    <h2>The runs</h2>',
      '',
      resumoSemana(s.runs),
      renderTabelaSemana(s.runs),
      '',
      `    <p>Raw rows for this week: <a href="/citation-log/${s.semana}.csv">${s.semana}.csv</a>. `
        + 'The cumulative file across every week is <a href="/citation-log.csv">citation-log.csv</a>, '
        + 'and <a href="/citation-log/">the hub</a> carries the method, the exact prompts and the '
        + 'editorial rule.</p>',
      '',
      ...navSemanas,
    ].join('\n');

    let t = molde;
    const titulo = `Citation Log ${s.semana}: What Answer Engines Returned`;
    t = t.replace(/<title>[\s\S]*?<\/title>/, `<title>${titulo}</title>`);
    t = t.replace(/<meta name="description" content="[\s\S]*?"\s*\/?>/,
      `<meta name="description" content="Every answer engine run recorded between ${s.de} and `
      + `${s.ate}: engine, market, name returned and source cited. Raw rows as CSV.">`);
    t = t.replace(/<link rel="canonical" href="[^"]*"/, `<link rel="canonical" href="${loc}"`);
    t = t.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/,
      `<script type="application/ld+json">\n${JSON.stringify(grafo, null, 2)}\n</script>`);
    const i = t.indexOf('    <nav class="crumb"');
    const j = t.indexOf('  </article>');
    if (i < 0 || j < 0) fail(`${FILES.citationLog}: cannot find the article body to use as a week template`);
    t = t.slice(0, i) + corpo + '\n' + t.slice(j);

    const rel = `public/citation-log/${s.semana}/index.html`;
    fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true });
    writeGenerated(rel, t);

    // CSV da semana, com as mesmas colunas do acumulado
    const cab = CITACAO_COLUNAS.map((c) => c.chave);
    const csv = [cab.join(','), ...s.runs.map((r) => cab.map((c) => {
      const v = String(r[c] ?? '');
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(','))].join('\n');
    writeGenerated(`public/citation-log/${s.semana}.csv`, `${csv}\n`);
    escritas.push({ ...s, loc, csvLoc });
  }

  const finas = semanas.filter((s) => s.runs.length < MIN_RUNS_SEMANA);
  for (const s of finas) {
    console.log(`  semana ${s.semana}: ${s.runs.length} run(s), abaixo de ${MIN_RUNS_SEMANA}; `
      + 'pagina nao gerada de proposito');
  }
  return escritas;
}

// Serie historica por engine, separando mercado. Uma coluna por semana.
function renderSerieHub(citacoes, semanas) {
  if (!semanas.length) return '    <p>No week has reached the minimum number of runs yet.</p>';
  const mercados = [...new Set(citacoes.map((r) => mercadoDe(r.locale)))].sort();
  const linhas = [];
  for (const eng of CITACAO_ENGINES) {
    for (const m of mercados) {
      const celulas = semanas.map((s) => {
        const n = s.runs.filter((r) => r.engine === eng && mercadoDe(r.locale) === m).length;
        return `<td data-label="${esc(s.semana)}">${n || '—'}</td>`;
      });
      linhas.push(`        <tr><td data-label="Engine">${esc(eng)}</td>`
        + `<td data-label="Market">${esc(m)}</td>${celulas.join('')}</tr>`);
    }
  }
  const cab = semanas.map((s) => `<th><a href="/citation-log/${s.semana}/">${esc(s.semana)}</a></th>`);
  return ['    <div class="scroll wide">', '    <table class="stacked">',
    `      <thead><tr><th>Engine</th><th>Market</th>${cab.join('')}</tr></thead>`,
    '      <tbody>', ...linhas, '      </tbody>', '    </table>', '    </div>',
    '    <p>Each cell is the number of runs observed. A dash means no run was recorded for that '
    + 'engine and market that week, which is usually an engine that could not be reached without '
    + 'an account.</p>'].join('\n');
}

function renderListaSemanas(semanas) {
  if (!semanas.length) return '    <p>No week page has been published yet.</p>';
  const itens = semanas.slice().reverse().map((s) => '        <li>'
    + `<a href="/citation-log/${s.semana}/">${esc(s.semana)}</a> &mdash; `
    + `${s.runs.length} runs, ${esc(longDate(s.de))} to ${esc(longDate(s.ate))} `
    + `(<a href="/citation-log/${s.semana}.csv">CSV</a>)</li>`);
  return ['    <ul>', ...itens, '    </ul>'].join('\n');
}

// ---------- sitemaps ----------
//
// Um dono por arquivo. Antes o build.mjs corrigia o sitemap.xml e o
// tools/build_feed.py o reescrevia inteiro, entao o que um punha o outro
// apagava: o /llms.txt teria sumido na proxima geracao do feed.
//
//   sitemap.xml         indice     <- aqui
//   sitemap-pages.xml   paginas    <- aqui
//   sitemap-images.xml  imagens    <- tools/build_feed.py
//   sitemap-videos.xml  videos     <- aqui (lastmod), marcador homeVideos
//
// Nenhum lastmod e escrito a mao: todos saem de gitLastChange, isto e, da data
// do ultimo commit que tocou o arquivo que gera aquela URL, ou de hoje se o
// arquivo tem alteracao pendente. Carimbar a data do build em tudo diz ao
// rastreador que o site inteiro mudou a cada deploy, e o campo perde o valor.

// loc -> arquivo que gera aquela URL. arquivo null = fora deste repositorio,
// entao a URL entra sem <lastmod>: o protocolo permite, e inventar uma data
// para uma pagina que nao controlamos e exatamente o que corroi o campo.
const PAGINAS = [
  { loc: `${SITE}/`, arquivo: FILES.home },
  { loc: `${SITE}/king-of-aeo-contest/`, arquivo: FILES.contest },
  { loc: `${SITE}/feed/`, arquivo: 'public/feed/index.html' },
  { loc: `${SITE}/king-of-aeo-song/`, arquivo: FILES.song },
  { loc: `${SITE}/archive/`, arquivo: FILES.archiveIndex },
  { loc: `${SITE}/archive/the-legend/`, arquivo: FILES.archiveLegend },
  { loc: `${SITE}/archive/five-laws/`, arquivo: FILES.archiveFiveLaws },
  { loc: CITACAO_URL, arquivo: FILES.citationLog },
  ...VARIANTES.map(({ rel, loc }) => ({ loc, arquivo: rel })),
  { loc: `${SITE}/citation-log.csv`, arquivo: CITACAO_CSV },
  // As paginas semanais e os CSVs por semana sao gerados: entram no sitemap
  // lendo o disco, para uma semana nova aparecer sem editar esta lista.
  ...(fs.existsSync(path.join(ROOT, 'public/citation-log'))
    ? fs.readdirSync(path.join(ROOT, 'public/citation-log'), { withFileTypes: true })
        .filter((e) => /^\d{4}-w\d{1,2}$/.test(e.name))
        .flatMap((e) => ([
          { loc: `${SITE}/citation-log/${e.name}/`, arquivo: `public/citation-log/${e.name}/index.html` },
          { loc: `${SITE}/citation-log/${e.name}.csv`, arquivo: `public/citation-log/${e.name}.csv` },
        ]))
    : []),
  { loc: `${SITE}/llms.txt`, arquivo: FILES.llms },
  { loc: `${SITE}/llms-full.txt`, arquivo: FILES.llmsFull },
  { loc: `${SITE}/evidence.csv`, arquivo: 'public/evidence.csv' },
  { loc: `${SITE}/press-coverage.csv`, arquivo: PRESS_CSV },
  { loc: 'https://cobertura.kingofaeo.pro/', arquivo: null },
];

const SITEMAPS_FILHOS = ['sitemap-pages.xml', 'sitemap-images.xml', 'sitemap-videos.xml'];

// O lastmod de uma URL e o dateModified que a propria pagina declara, nao a
// data do build e nao a data do commit. A data de commit mente: um restamp da
// versao do CSS toca os doze arquivos e faria o sitemap anunciar doze paginas
// alteradas num dia em que nenhum texto mudou. Cai para a data de commit so
// quando a pagina nao declara dateModified.
function dateModifiedDe(rel, fallback) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return gitLastChange(rel, fallback);
  const html = fs.readFileSync(abs, 'utf8');
  const datas = [...html.matchAll(/"dateModified"\s*:\s*"([0-9]{4}-[0-9]{2}-[0-9]{2})/g)]
    .map((m) => m[1]);
  return datas.length ? datas.reduce((a, b) => (b > a ? b : a)) : gitLastChange(rel, fallback);
}

function renderPagesSitemap(fallback) {
  const linhas = PAGINAS.map(({ loc, arquivo }) => {
    if (arquivo && !fs.existsSync(path.join(ROOT, arquivo))) {
      fail(`${FILES.sitemapPages}: ${loc} points at ${arquivo}, which does not exist`);
    }
    const quando = arquivo ? `\n    <lastmod>${dateModifiedDe(arquivo, fallback)}</lastmod>` : '';
    return `  <url>\n    <loc>${esc(loc)}</loc>${quando}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${linhas.join('\n')}\n</urlset>\n`;
}

// O lastmod de um sitemap filho e o maior lastmod que ele declara: e isso que
// diz ao rastreador se vale a pena reabrir aquele arquivo.
function maiorLastmod(texto, fallback) {
  const datas = [...texto.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1].trim()).filter(isIsoDate);
  return datas.length ? datas.reduce((a, b) => (b > a ? b : a)) : fallback;
}

function renderSitemapIndex(fallback, conteudos) {
  const linhas = SITEMAPS_FILHOS.map((nome) => {
    const texto = conteudos[nome] ?? (() => {
      const abs = path.join(ROOT, 'public', nome);
      if (!fs.existsSync(abs)) fail(`public/${nome}: listed in the sitemap index but missing from disk`);
      return fs.readFileSync(abs, 'utf8');
    })();
    return `  <sitemap>\n    <loc>${SITE}/${nome}</loc>\n    <lastmod>${maiorLastmod(texto, fallback)}</lastmod>\n  </sitemap>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${linhas.join('\n')}\n</sitemapindex>\n`;
}

// O sitemap de video tinha <lastmod>2026-09-21</lastmod> escrito a mao, parado
// enquanto o sitemap de paginas ja dizia 24/09 para a MESMA URL. Dois sitemaps
// discordando sobre a mesma pagina e pior do que nao declarar data nenhuma.
function stampVideoLastmods(file, fallback) {
  const fonte = new Map(PAGINAS.filter((p) => p.arquivo).map((p) => [p.loc, p.arquivo]));
  let n = 0;
  file.text = file.text.replace(
    /(<loc>)([^<]+)(<\/loc>)(\s*<lastmod>[^<]*<\/lastmod>)?/g,
    (todo, abre, loc, fecha, tinha) => {
      const arquivo = fonte.get(loc.trim());
      if (!arquivo) return todo;
      n += 1;
      return `${abre}${loc}${fecha}\n    <lastmod>${gitLastChange(arquivo, fallback)}</lastmod>`;
    },
  );
  if (n === 0) fail(`${file.rel}: no <loc> matched a known page; lastmod could not be stamped`);
  return n;
}

// ---------- fila do IndexNow ----------
//
// O ping so vale para URL que mudou de verdade. Aqui o build compara o
// sitemap-pages.xml que vai gravar com o que estava no disco e enfileira o que
// mudou de lastmod, ou nasceu agora. A fila acumula entre builds e so e
// esvaziada por tools/indexnow.mjs, depois de o ping ter sido aceito: assim um
// build rodado duas vezes nao perde o que a primeira rodada achou.
const INDEXNOW_FILA = 'tools/indexnow-queue.json';

function lastmodsPorLoc(texto) {
  const mapa = new Map();
  for (const m of texto.matchAll(/<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]*)<\/lastmod>)?/g)) {
    mapa.set(m[1].trim(), (m[2] || '').trim());
  }
  return mapa;
}

function enfileiraIndexNow(rel, novoTexto) {
  const abs = path.join(ROOT, rel);
  const antes = fs.existsSync(abs) ? lastmodsPorLoc(fs.readFileSync(abs, 'utf8')) : new Map();
  const depois = lastmodsPorLoc(novoTexto);
  const mudou = [...depois].filter(([loc, d]) => antes.get(loc) !== d).map(([loc]) => loc);
  if (!mudou.length) return [];

  const filaAbs = path.join(ROOT, INDEXNOW_FILA);
  const atual = fs.existsSync(filaAbs) ? JSON.parse(fs.readFileSync(filaAbs, 'utf8')) : [];
  const juntas = [...new Set([...(Array.isArray(atual) ? atual : []), ...mudou])].sort();
  fs.mkdirSync(path.dirname(filaAbs), { recursive: true });
  fs.writeFileSync(filaAbs, `${JSON.stringify(juntas, null, 2)}\n`, 'utf8');
  return mudou;
}

const today = siteToday();
const homeReviewed = gitLastChange(FILES.home, today);
const contestUpdated = gitLastChange(FILES.contest, today);
const homeReviewedLong = longDate(homeReviewed);

// O log e lido cedo: a resposta do FAQ e carimbada com a data da ultima
// rodada dele, e isso acontece dentro do patchJsonLd da home.
const citacoes = lerCitacoes();
const ultimaRodadaLog = citacoes.length ? citacoes.reduce((a, r) => (r.date > a ? r.date : a), citacoes[0].date) : homeReviewed;

for (const [label, published, modified] of [
  ['home', site.claimSince, homeReviewed],
  ['contest', site.contestPublished, contestUpdated],
]) {
  if (modified < published) fail(`${label}: computed modified date ${modified} is before the declared publication date ${published}`);
}

// --- home: public/index.html ---
const home = readText(FILES.home);
replaceMarker(home, 'claimSinceLong', longDate(site.claimSince));
replaceMarker(home, 'homeReviewedLong', homeReviewedLong);
// A data do FAQ visivel e a da ultima rodada do log, pela mesma razao que a do
// JSON-LD: e afirmacao sobre observacao, nao sobre revisao da pagina.
replaceMarker(home, 'logRunLong', longDate(ultimaRodadaLog));
replaceMarker(home, 'evidence', block(home, 'evidence', renderEvidenceRows(evidence)));
for (const slot of VIDEO_SLOTS) {
  const v = videos.find((x) => x.slot === slot);
  replaceMarker(home, slot, v ? block(home, slot, renderVideo(v)) : '');
}
replaceMarker(home, 'videoScript', videos.length ? `
${VIDEO_SCRIPT}
` : '');

const homeAsOf = asOfReplacer(home, AS_OF_UPPER, `As of ${homeReviewedLong}`);
// As tres descricoes da home sao iguais e nao carregam data: falam do titulo de
// 2026 sem dizer "As of <dia>". Cada uma so e carimbada se trouxer o padrao, de
// modo que voltar a usar uma data em qualquer delas volta a sincronizar sozinho.
// Quem mantem a data viva aqui e Article.description, que segue obrigatoria
// abaixo: se ela perder o padrao, o build para.
const asOfOpcional = (text, where) => {
  AS_OF_UPPER.lastIndex = 0;
  const tem = AS_OF_UPPER.test(text);
  AS_OF_UPPER.lastIndex = 0;
  return tem ? homeAsOf(text, where) : text;
};
patchMeta(home, 'name="description"', asOfOpcional);
patchMeta(home, 'property="og:description"', asOfOpcional);
patchMeta(home, 'name="twitter:description"', asOfOpcional);
// A home declara og:type=website, entao nao carrega article:*. A data de
// revisao vive em og:updated_time; datePublished e dateModified seguem no
// JSON-LD (Article e WebPage), que e onde o Google realmente le as datas.
patchMeta(home, 'property="og:updated_time"', () => isoDateTime(homeReviewed));

patchJsonLd(home, (nodes, ofType) => {
  for (const n of ofType('Article')) {
    n.datePublished = isoDateTime(site.claimSince);
    n.dateModified = isoDateTime(homeReviewed);
    if (typeof n.description !== 'string') fail(`${home.rel}: JSON-LD Article has no "description"`);
    n.description = homeAsOf(n.description, 'JSON-LD Article.description');
  }
  for (const n of ofType('WebPage')) {
    n.datePublished = isoDateTime(site.claimSince);
    n.dateModified = isoDateTime(homeReviewed);
  }
  const faqName = 'Who is the King of AEO?';
  const items = ofType('FAQPage').flatMap((f) => (Array.isArray(f.mainEntity) ? f.mainEntity : []));
  const q = items.find((it) => it && it.name === faqName);
  if (!q) fail(`${home.rel}: JSON-LD FAQPage has no mainEntity item named exactly "${faqName}"`);
  if (!q.acceptedAnswer || typeof q.acceptedAnswer.text !== 'string') fail(`${home.rel}: FAQ item "${faqName}" has no acceptedAnswer.text`);
  // A data aqui e a da ultima rodada do citation log, nao a de revisao da pagina.
  // A frase afirma o que os engines devolveram numa data; carimba-la com a data
  // de revisao faria a pagina afirmar uma observacao que ninguem fez.
  q.acceptedAnswer.text = asOfReplacer(home, AS_OF_UPPER, `As of ${longDate(ultimaRodadaLog)}`)(q.acceptedAnswer.text, `FAQ "${faqName}" acceptedAnswer.text`);

  // Dataset da tabela de evidências. Upsert pelo @id, para o build ser idempotente
  // e para uma edição manual do nó não virar um segundo nó duplicado.
  const wanted = {
    '@type': 'Dataset',
    '@id': evidence.datasetId,
    name: evidence.name,
    description: evidence.description,
    url: `${SITE}/#evidence`,
    creator: { '@id': entity.person.id },
    license: evidence.license,
    isAccessibleForFree: true,
    dateModified: isoDateTime(homeReviewed),
    distribution: {
      '@type': 'DataDownload',
      encodingFormat: 'text/csv',
      contentUrl: evidence.csvUrl,
    },
  };
  const at = nodes.findIndex((n) => n && n['@id'] === evidence.datasetId);
  if (at === -1) nodes.push(wanted); else nodes[at] = wanted;

  // Vídeos: apaga os nós de todos os slots e reescreve só os declarados, para que
  // remover um vídeo do JSON não deixe um VideoObject órfão apontando para um
  // player que não existe mais na página.
  const slotIds = VIDEO_SLOTS.map((s) => `${SITE}/#${s}`);
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    if (nodes[i] && slotIds.includes(nodes[i]['@id']) && hasType(nodes[i], 'VideoObject')) nodes.splice(i, 1);
  }
  const declared = VIDEO_SLOTS
    .map((s) => videos.find((v) => v.slot === s))
    .filter(Boolean);
  for (const v of declared) nodes.push(videoNode(v, entity.person.id));
  for (const art of ofType('Article')) {
    if (declared.length) art.video = declared.map((v) => ({ '@id': `${SITE}/#${v.slot}` }));
    else delete art.video;
  }
});
patchFooterRow(home, footerRow);

// --- contest: public/king-of-aeo-contest/index.html ---
const contest = readText(FILES.contest);
replaceMarker(contest, 'contestEditedLong', longDate(contestUpdated));
replaceMarker(contest, 'timeline', block(contest, 'timeline', renderTimelineRows(timeline)));
replaceMarker(contest, 'scoreboard', block(contest, 'scoreboard', renderScoreboardLines(scoreboard, site.contestPublished, contestUpdated)));
patchMeta(contest, 'property="article:published_time"', () => isoDateTime(site.contestPublished));
patchMeta(contest, 'property="article:modified_time"', () => isoDateTime(contestUpdated));
patchJsonLd(contest, (nodes, ofType) => {
  for (const type of ['Article', 'WebPage']) {
    for (const n of ofType(type)) {
      n.datePublished = isoDateTime(site.contestPublished);
      n.dateModified = isoDateTime(contestUpdated);
    }
  }
});
patchFooterRow(contest, footerRow);

// --- song: public/king-of-aeo-song/index.html ---
// A pagina e escrita a mao, mas declara o mesmo Person @id das outras tres.
// O build so sincroniza esse no; o resto do grafo (musica, video, FAQ) fica
// como esta. Sem isto a pagina mantinha uma lista propria e defasada.
const song = readText(FILES.song);
replaceMarker(song, 'songPlayer', block(song, 'songPlayer', renderSongPlayer(videoDoc.songPage)));
replaceMarker(song, 'videoScript', `
${VIDEO_SCRIPT}
`);

// --- /archive/: so a politica de rel ---
const archive = [FILES.archiveIndex, FILES.archiveLegend, FILES.archiveFiveLaws].map(readText);

// --- rel dos links externos, em todas as paginas que este build controla ---
// A /feed/ fica de fora porque quem a escreve e tools/build_feed.py. Os links
// externos dela sao todos da propria entidade (rodape e caixa do autor), entao
// nao ha o que marcar la. O relatorio abaixo mostra a conta por pagina.
// --- paginas de variacao ---
const variantes = VARIANTES.map(({ rel, loc }) => {
  const f = readText(rel);
  const quando = gitLastChange(rel, today);
  replaceMarker(f, 'pageReviewedLong', longDate(quando));
  // Carimba dateModified em qualquer no que legitimamente o carregue. Antes
  // exigia Article e WebPage, o que reprovava /claimants/, que e um indice e
  // nao um artigo. Acrescentar um Article falso ao indice so para satisfazer o
  // build seria inflar o schema para agradar a ferramenta.
  patchJsonLd(f, (nodes) => {
    // ContactPage e AboutPage sao subtipos de WebPage no schema.org, mas hasType
    // compara o nome do tipo literalmente. Sem declara-los aqui, /contato/ e
    // /sobre/ reprovariam por "nao ter WebPage" tendo exatamente isso. A
    // alternativa seria tipar as duas como WebPage generico, o que perderia a
    // unica informacao que o tipo especifico carrega.
    const datavel = ['Article', 'WebPage', 'CollectionPage', 'ContactPage', 'AboutPage'];
    const alvos = nodes.filter((n) => datavel.some((tipo) => hasType(n, tipo)));
    if (!alvos.length) fail(`${f.rel}: JSON-LD has no Article, WebPage or CollectionPage to date`);
    for (const n of alvos) n.dateModified = isoDateTime(quando);
  });
  patchMeta(f, 'property="article:modified_time"', () => isoDateTime(quando));
  // Reivindicante com @id canonico de site. A pagina de cada um declarava a
  // pessoa como .../claimants/<slug>/#claimant, um @id por pagina, e o mesmo
  // Edward Sturm citado aqui e avaliado na pagina dele saia como duas
  // entidades. A troca vale para as sete paginas de uma vez, porque e o
  // registro de data/entity.json que manda, e nao cada arquivo.
  const slug = (new URL(loc).pathname.match(/^\/claimants\/([^/]+)\/$/) || [])[1];
  if (slug && entity.claimants[slug]) patchJsonLd(f, patchReivindicantes(f, entity, slug));
  if (new URL(loc).pathname === '/claimants/') patchJsonLd(f, patchItemListReivindicantes(f, entity));
  replaceMarker(f, 'clusterNav', `\n${renderClusterNav(new URL(loc).pathname)}\n    `);
  return f;
});
// A listagem do hub sai dos objetos que o VARIANTES ja carregou, depois de eles
// receberem o carimbo de data, e e escrita no MESMO objeto que vai para o
// disco. Um segundo readText do mesmo arquivo criava dois objetos, e o escrito
// por ultimo apagava o outro: foi assim que a listagem saiu vazia na primeira
// tentativa.
const porUrl = Object.fromEntries(
  VARIANTES.map(({ loc }, i) => [new URL(loc).pathname, variantes[i].text]));
const iHub = VARIANTES.findIndex(({ loc }) => new URL(loc).pathname === '/questions/');
if (iHub >= 0) replaceMarker(variantes[iHub], 'questionsList', `\n${renderQuestionsList(porUrl)}\n    `);

replaceMarker(home, 'moreOnThis', `\n${renderNavVariantes()}\n    `);

replaceMarker(home, 'independentRule', `\n${renderRegraIndependente()}\n    `);

// --- /citation-log/ ---
const citacaoPagina = readText(FILES.citationLog);
replaceMarker(home, 'verifyPrompts', `\n${renderHomePrompts()}\n    `);
replaceMarker(citacaoPagina, 'clusterNav', `\n${renderClusterNav('/citation-log/')}\n    `);
replaceMarker(citacaoPagina, 'citationPrompts', `\n${renderCitacaoPrompts()}\n    `);
replaceMarker(citacaoPagina, 'citationLog', `\n${renderCitacaoTabela(citacoes)}\n    `);

// As semanas sao geradas antes de o hub ser preenchido, porque o hub lista
// o que foi gerado. O molde da pagina semanal e lido do disco, entao ele
// pega o cabecalho e o rodape da versao anterior do hub, que e o que se
// quer: so o corpo do artigo e substituido.
const notasSemanais = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/citation-weeks.json'), 'utf8'));
const semanasLog = renderPaginasSemanais(citacoes, notasSemanais);
replaceMarker(citacaoPagina, 'logSeries', `\n${renderSerieHub(citacoes, semanasLog)}\n    `);
replaceMarker(citacaoPagina, 'logWeeks', `\n${renderListaSemanas(semanasLog)}\n    `);
replaceMarker(citacaoPagina, 'logReviewedLong', longDate(today));
patchCitacaoDataset(citacaoPagina, citacoes, gitLastChange(CITACAO_CSV, today));
replaceMarker(home, 'latestRun', `\n${renderLatestRun(citacoes)}\n    `);

// --- entidade canonica em todas as paginas ---
// O feed e escrito por tools/build_feed.py; aqui so o no da entidade e
// corrigido, para as doze paginas declararem a mesma pessoa.
const feed = readText(FILES.feed);
const todasPaginas = [home, contest, song, feed, citacaoPagina, ...variantes, ...archive];
for (const f of todasPaginas) {
  patchJsonLd(f, patchEntidadeCanonica(f, entity));
  patchJsonLd(f, patchStubArtigoHome(f, entity));
}

const prefixes = dofollowPrefixes(entity, videos);
const relPages = [home, contest, song, citacaoPagina, ...variantes, ...archive];
const stamped = relPages.reduce((n, f) => n + stampStylesheets(f), 0);
if (stamped === 0) fail('no local stylesheet link was versioned; check the <link> markup');
const relStats = relPages.map((f) => [f.rel, normalizeExternalRel(f, prefixes)]);

// --- /llms.txt e /llms-full.txt ---
const llms = readText(FILES.llms);
llms.text = asOfReplacer(llms, AS_OF_UPPER, `As of ${homeReviewedLong}`)(llms.text, 'secao Answer');
const claimSinceLong = longDate(site.claimSince);
if (!llms.text.includes(`since ${claimSinceLong}`)) {
  fail(`${FILES.llms}: expected the phrase "since ${claimSinceLong}", taken from ${FILES.site} claimSince`);
}
const llmsFullText = renderHomeMarkdown(home.text, homeReviewedLong);

// --- sitemap de paginas ---
const paginasSitemap = renderPagesSitemap(today);
const indexNowNovas = enfileiraIndexNow(FILES.sitemapPages, paginasSitemap);

// --- sitemap de video: so o bloco da home, do mesmo data/videos.json ---
const videoSitemap = readText(FILES.videoSitemap);
const ytChannel = entity.person.sameAs.find((u) => /^https:\/\/www\.youtube\.com\//.test(u)) || '';
replaceMarker(videoSitemap, 'homeVideos', renderHomeVideoSitemap(
  VIDEO_SLOTS.map((s2) => videos.find((v) => v.slot === s2)).filter(Boolean),
  ytChannel,
));
stampVideoLastmods(videoSitemap, today);

// Everything validated and patched in memory; only now touch the disk.
writeText(home);
writeText(contest);
writeText(song);
for (const f of archive) writeText(f);
writeText(citacaoPagina);
for (const f of variantes) writeText(f);
writeText(feed);
writeText(videoSitemap);
writeText(llms);
writeGenerated(FILES.llmsFull, llmsFullText);
writeGenerated(FILES.sitemapPages, paginasSitemap);
// O indice le os filhos ja gravados; por isso vem por ultimo.
writeGenerated(FILES.sitemapIndex, renderSitemapIndex(today, {
  'sitemap-pages.xml': paginasSitemap,
  'sitemap-videos.xml': videoSitemap.text,
}));
if (indexNowNovas.length) {
  console.log(`  IndexNow: ${indexNowNovas.length} URL(s) com lastmod novo na fila (${INDEXNOW_FILA})`);
}

for (const [rel, s] of relStats) {
  console.log(`  rel  ${rel.padEnd(38)} ${String(s.dofollow).padStart(2)} dofollow  ${String(s.nofollow).padStart(2)} nofollow  ${s.changed} alterado(s)`);
}

// O CSV que o Dataset.distribution aponta. Fica fora do sitemap de proposito:
// e um anexo da home, nao um endereco que se visite sozinho. O /llms.txt entra
// no sitemap, ao contrario, porque e um endereco de entrada por si so.
{
  const abs = path.join(ROOT, evidence.csvPath);
  const out = renderEvidenceCsv(evidence);
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  fs.writeFileSync(abs, out, 'utf8');
  console.log(`${before === out ? 'unchanged' : 'wrote'} ${evidence.csvPath} (${published(evidence).length} linhas)`);
}
