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
      if (!s || typeof s.label !== 'string' || typeof s.url !== 'string') fail(`${FILES.timeline}: item ${i} source ${j} needs string "label" and "url"`);
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
function findPersonsById(node, id, out = []) {
  if (Array.isArray(node)) {
    for (const v of node) findPersonsById(v, id, out);
  } else if (node && typeof node === 'object') {
    // Uma referencia pendente ({"@id": …} sozinho) nao e o no real: nao recebe sameAs.
    const isRef = Object.keys(node).length === 1 && node['@id'] !== undefined;
    if (hasType(node, 'Person') && node['@id'] === id && !isRef) out.push(node);
    for (const v of Object.values(node)) findPersonsById(v, id, out);
  }
  return out;
}

// Escreve sameAs e url no no Person cujo @id bate com o de data/entity.json.
// Filtrar por @id, e nao so por @type, importa: a home e a pagina do concurso
// citam os rivais como Person dentro de mentions, sem @id, e eles precisam
// continuar sem sameAs. Nos com @id igual se fundem no grafo, entao duas
// paginas que declarem o mesmo @id com listas diferentes se contradizem.
function patchPersonSameAs(file, person, { subjectOf = false } = {}) {
  return (nodes) => {
    const found = findPersonsById(nodes, person.id);
    if (found.length !== 1) fail(`${file.rel}: expected exactly 1 Person node with "@id":"${person.id}", found ${found.length}`);
    found[0].sameAs = [...person.sameAs];
    found[0].url = person.url;
    // subjectOf so entra onde foi pedido. Nos com o mesmo @id se fundem, entao
    // declarar em duas paginas ja basta para o grafo inteiro receber.
    if (subjectOf && (person.subjectOf || []).length) {
      found[0].subjectOf = person.subjectOf.map((o) => ({ ...o }));
    } else {
      delete found[0].subjectOf;
    }
  };
}

// ---------- tabela de evidências ----------

const EVIDENCE_STATUS = ['Public record', 'Self-reported', 'Independent'];

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
    const sources = it.sources.map((s) => (
      isInternal(s.url)
        ? `<a href="${esc(s.url)}">${esc(s.label)}</a>`
        : `<a href="${esc(s.url)}" rel="noopener">${esc(s.label)}</a>`
    )).join(', ');
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
];

const CITACAO_ENGINES = ['ChatGPT', 'Claude', 'Perplexity', 'Gemini', 'Google AI Overview', 'Copilot'];

const CITACAO_COLUNAS = [
  { chave: 'date', rotulo: 'Date', desc: 'Date of the run, ISO 8601 (YYYY-MM-DD).' },
  { chave: 'engine', rotulo: 'Engine', desc: `Answer engine queried. One of: ${CITACAO_ENGINES.join(', ')}.` },
  { chave: 'prompt', rotulo: 'Prompt', desc: 'The prompt submitted, verbatim. One of the three fixed prompts of the method.' },
  { chave: 'name_returned', rotulo: 'Name returned', desc: 'The name the engine gave as King of AEO, verbatim. Empty when the engine returned no name.' },
  { chave: 'link_cited', rotulo: 'Link cited', desc: 'Whether the answer cited a link at all: yes or no.' },
  { chave: 'domain_cited', rotulo: 'Domain cited', desc: 'Domain of the cited link. Empty when no link was cited.' },
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
  return uteis.slice(1).map(({ texto, n }) => {
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
    for (const k of ['link_cited', 'entity_resolved']) {
      if (!sim_nao.has(r[k])) fail(`${CITACAO_CSV}: ${onde}: "${k}" must be yes or no, got ${JSON.stringify(r[k])}`);
    }
    // Coerencia interna: citar link sem dizer qual dominio, ou dizer o dominio
    // sem ter citado link, sao a mesma linha querendo dizer duas coisas.
    if (r.link_cited === 'yes' && !r.domain_cited) fail(`${CITACAO_CSV}: ${onde}: link_cited=yes needs a "domain_cited"`);
    if (r.link_cited === 'no' && r.domain_cited) fail(`${CITACAO_CSV}: ${onde}: link_cited=no must leave "domain_cited" empty, got ${JSON.stringify(r.domain_cited)}`);
    return r;
  });
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
  const porEngine = CITACAO_ENGINES
    .map((e) => ({ engine: e, rs: doDia.filter((r) => r.engine === e) }))
    .filter((x) => x.rs.length);

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

  const linhasTabela = porEngine.map(({ engine, rs }) => `        <tr><th scope="row">${esc(engine)}</th>`
    + `<td data-label="Name returned">${nomes(rs)}</td>`
    + `<td data-label="Link cited">${conta(rs, 'link_cited')}/${rs.length}</td>`
    + `<td data-label="Entity resolved">${conta(rs, 'entity_resolved')}/${rs.length}</td></tr>`).join('\n');

  return ['      <p><strong>Citation log</strong> &middot; latest run '
    + `<time datetime="${esc(ultima)}">${esc(longDate(ultima))}</time> &middot; `
    + `${doDia.length} answer${doDia.length === 1 ? '' : 's'} across ${porEngine.length} engine${porEngine.length === 1 ? '' : 's'}. `
    + 'Published whether or not the result favours this page &mdash; see the '
    + '<a href="/citation-log/">full log and method</a>.</p>',
  '      <div class="scroll">',
  '      <table class="stacked">',
  '        <thead><tr><th scope="col">Engine</th><th scope="col">Name returned</th><th scope="col">Link cited</th><th scope="col">Entity resolved</th></tr></thead>',
  '        <tbody>',
  linhasTabela,
  '        </tbody>',
  '      </table>',
  '      </div>'].join('\n');
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
  { loc: `${SITE}/citation-log.csv`, arquivo: CITACAO_CSV },
  { loc: `${SITE}/llms.txt`, arquivo: FILES.llms },
  { loc: `${SITE}/llms-full.txt`, arquivo: FILES.llmsFull },
  { loc: `${SITE}/evidence.csv`, arquivo: 'public/evidence.csv' },
  { loc: 'https://cobertura.kingofaeo.pro/', arquivo: null },
];

const SITEMAPS_FILHOS = ['sitemap-pages.xml', 'sitemap-images.xml', 'sitemap-videos.xml'];

function renderPagesSitemap(fallback) {
  const linhas = PAGINAS.map(({ loc, arquivo }) => {
    if (arquivo && !fs.existsSync(path.join(ROOT, arquivo))) {
      fail(`${FILES.sitemapPages}: ${loc} points at ${arquivo}, which does not exist`);
    }
    const quando = arquivo ? `\n    <lastmod>${gitLastChange(arquivo, fallback)}</lastmod>` : '';
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
  q.acceptedAnswer.text = asOfReplacer(home, AS_OF_LOWER, `as of ${homeReviewedLong}`)(q.acceptedAnswer.text, `FAQ "${faqName}" acceptedAnswer.text`);
  patchPersonSameAs(home, entity.person, { subjectOf: true })(nodes);

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
  patchPersonSameAs(contest, entity.person, { subjectOf: true })(nodes);
});
patchFooterRow(contest, footerRow);

// --- song: public/king-of-aeo-song/index.html ---
// A pagina e escrita a mao, mas declara o mesmo Person @id das outras tres.
// O build so sincroniza esse no; o resto do grafo (musica, video, FAQ) fica
// como esta. Sem isto a pagina mantinha uma lista propria e defasada.
const song = readText(FILES.song);
patchJsonLd(song, (nodes) => { patchPersonSameAs(song, entity.person)(nodes); });
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
// --- /citation-log/ ---
const citacoes = lerCitacoes();
const citacaoPagina = readText(FILES.citationLog);
replaceMarker(home, 'verifyPrompts', `\n${renderHomePrompts()}\n    `);
replaceMarker(citacaoPagina, 'citationPrompts', `\n${renderCitacaoPrompts()}\n    `);
replaceMarker(citacaoPagina, 'citationLog', `\n${renderCitacaoTabela(citacoes)}\n    `);
patchCitacaoDataset(citacaoPagina, citacoes, gitLastChange(CITACAO_CSV, today));
replaceMarker(home, 'latestRun', `\n${renderLatestRun(citacoes)}\n    `);

const prefixes = dofollowPrefixes(entity, videos);
const relPages = [home, contest, song, citacaoPagina, ...archive];
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
