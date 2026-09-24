#!/usr/bin/env node
// build.mjs — kingofaeo.pro build step. Plain Node ESM, zero dependencies.
// Run from the repo root:  node build.mjs
//
// Reads  data/site.json, data/timeline.json, data/scoreboard.json, data/entity.json
// Patches public/index.html, public/king-of-aeo-contest/index.html, public/sitemap.xml
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
  sitemap: 'public/sitemap.xml',
  videoSitemap: 'public/sitemap-videos.xml',
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

function patchSitemap(file, homeLastmod, contestLastmod) {
  const homeRe = /(<url>\s*<loc>https:\/\/kingofaeo\.pro\/<\/loc>\s*<lastmod>)([^<]*)(<\/lastmod>)/;
  if (!homeRe.test(file.text)) fail(`${file.rel}: no <url> with <loc>https://kingofaeo.pro/</loc> followed by <lastmod>`);
  file.text = file.text.replace(homeRe, (_, a, __, c) => a + homeLastmod + c);

  const contestLoc = 'https://kingofaeo.pro/king-of-aeo-contest/';
  const contestRe = /(<url>\s*<loc>https:\/\/kingofaeo\.pro\/king-of-aeo-contest\/<\/loc>\s*<lastmod>)([^<]*)(<\/lastmod>)/;
  if (contestRe.test(file.text)) {
    file.text = file.text.replace(contestRe, (_, a, __, c) => a + contestLastmod + c);
  } else {
    if (file.text.includes(`<loc>${contestLoc}</loc>`)) fail(`${file.rel}: contest <url> exists but has no <lastmod> directly after its <loc>`);
    if (!file.text.includes('</urlset>')) fail(`${file.rel}: missing </urlset>`);
    const entry = `  <url>\n    <loc>${contestLoc}</loc>\n    <lastmod>${contestLastmod}</lastmod>\n  </url>\n`;
    file.text = file.text.replace(/[ \t]*<\/urlset>/, () => `${entry}</urlset>`);
  }
}

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
function patchPersonSameAs(file, person) {
  return (nodes) => {
    const found = findPersonsById(nodes, person.id);
    if (found.length !== 1) fail(`${file.rel}: expected exactly 1 Person node with "@id":"${person.id}", found ${found.length}`);
    found[0].sameAs = [...person.sameAs];
    found[0].url = person.url;
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
  return doc.videos;
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
function renderVideo(v) {
  const capa = `https://i.ytimg.com/vi/${v.youtubeId}/maxresdefault.jpg`;
  return [
    `<div class="video" id="${esc(v.slot)}" style="background-image:url(${esc(capa)})">`,
    `  <a class="video-play" href="https://www.youtube.com/watch?v=${esc(v.youtubeId)}" data-yt="${esc(v.youtubeId)}" aria-label="Play: ${esc(v.name)}">`,
    '    <svg viewBox="0 0 80 80" aria-hidden="true" focusable="false"><circle cx="40" cy="40" r="38" fill="currentColor"/><path d="M33 25 59 40 33 55z" fill="#fff"/></svg>',
    '  </a>',
    '</div>',
    `<p class="video-caption">${esc(videoCaption(v))}</p>`,
  ];
}

// Troca a capa pelo player, já tocando. Fica em uma linha só de <script> no fim
// da página, e só é emitido quando existe vídeo declarado.
const VIDEO_SCRIPT = `<script>
document.querySelectorAll('.video a[data-yt]').forEach(function (a) {
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
    // data-label alimenta o layout empilhado do celular (ver .stacked em site.css)
    return `<tr><td data-label="Date">${esc(it.dateLabel)}</td><td data-label="Event">${esc(it.event)}</td><td data-label="Who">${esc(it.who)}</td><td data-label="Source">${sources}</td></tr>`;
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
const videos = validateVideos(readJson(FILES.videos));

// As duas datas de modificação saem do git, não de data/site.json. Só as datas de
// publicação continuam declaradas: quando uma página nasceu é fato editorial, não
// dá para derivar do arquivo, que muda a cada edição.
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
  patchPersonSameAs(home, entity.person)(nodes);

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
  patchPersonSameAs(contest, entity.person)(nodes);
});
patchFooterRow(contest, footerRow);

// --- song: public/king-of-aeo-song/index.html ---
// A pagina e escrita a mao, mas declara o mesmo Person @id das outras tres.
// O build so sincroniza esse no; o resto do grafo (musica, video, FAQ) fica
// como esta. Sem isto a pagina mantinha uma lista propria e defasada.
const song = readText(FILES.song);
patchJsonLd(song, (nodes) => { patchPersonSameAs(song, entity.person)(nodes); });

// --- /archive/: so a politica de rel ---
const archive = [FILES.archiveIndex, FILES.archiveLegend, FILES.archiveFiveLaws].map(readText);

// --- rel dos links externos, em todas as paginas que este build controla ---
// A /feed/ fica de fora porque quem a escreve e tools/build_feed.py. Os links
// externos dela sao todos da propria entidade (rodape e caixa do autor), entao
// nao ha o que marcar la. O relatorio abaixo mostra a conta por pagina.
const prefixes = dofollowPrefixes(entity, videos);
const relPages = [home, contest, song, ...archive];
const stamped = relPages.reduce((n, f) => n + stampStylesheets(f), 0);
if (stamped === 0) fail('no local stylesheet link was versioned; check the <link> markup');
const relStats = relPages.map((f) => [f.rel, normalizeExternalRel(f, prefixes)]);

// --- sitemap: public/sitemap.xml ---
const sitemap = readText(FILES.sitemap);
patchSitemap(sitemap, homeReviewed, contestUpdated);

// --- sitemap de video: so o bloco da home, do mesmo data/videos.json ---
const videoSitemap = readText(FILES.videoSitemap);
const ytChannel = entity.person.sameAs.find((u) => /^https:\/\/www\.youtube\.com\//.test(u)) || '';
replaceMarker(videoSitemap, 'homeVideos', renderHomeVideoSitemap(
  VIDEO_SLOTS.map((s2) => videos.find((v) => v.slot === s2)).filter(Boolean),
  ytChannel,
));

// Everything validated and patched in memory; only now touch the disk.
writeText(home);
writeText(contest);
writeText(song);
for (const f of archive) writeText(f);
writeText(sitemap);
writeText(videoSitemap);

for (const [rel, s] of relStats) {
  console.log(`  rel  ${rel.padEnd(38)} ${String(s.dofollow).padStart(2)} dofollow  ${String(s.nofollow).padStart(2)} nofollow  ${s.changed} alterado(s)`);
}

// O CSV que o Dataset.distribution aponta. Fica fora do sitemap de proposito:
// o sitemap so lista paginas HTML.
{
  const abs = path.join(ROOT, evidence.csvPath);
  const out = renderEvidenceCsv(evidence);
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  fs.writeFileSync(abs, out, 'utf8');
  console.log(`${before === out ? 'unchanged' : 'wrote'} ${evidence.csvPath} (${published(evidence).length} linhas)`);
}
