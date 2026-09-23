#!/usr/bin/env node
// build.mjs — kingofaeo.pro build step. Plain Node ESM, zero dependencies.
// Run from the repo root:  node build.mjs
//
// Reads  data/site.json, data/timeline.json, data/scoreboard.json
// Patches public/index.html, public/king-of-aeo-contest/index.html, public/sitemap.xml
// Throws (non-zero exit) when any expected marker, <meta> selector or JSON-LD node is missing.
// Idempotent: running it twice produces byte-identical files.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = import.meta.dirname ?? process.cwd();

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
  home: 'public/index.html',
  contest: 'public/king-of-aeo-contest/index.html',
  sitemap: 'public/sitemap.xml',
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
  for (const k of ['claimSince', 'homeReviewed', 'contestPublished', 'contestEdited']) {
    if (!isIsoDate(site[k])) fail(`${FILES.site}: "${k}" must be a YYYY-MM-DD date, got ${JSON.stringify(site[k])}`);
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

// Um link é interno se for relativo à raiz ou apontar para o próprio domínio.
// Links internos nunca levam nofollow.
const isInternal = (u) => u.startsWith('/') || /^https?:\/\/(www\.)?kingofaeo\.pro(\/|$)/i.test(u);

function renderTimelineRows(items) {
  // Array.prototype.sort is stable: ties keep their order in the data file.
  const sorted = [...items].sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
  return sorted.map((it) => {
    const sources = it.sources.map((s) => (
      isInternal(s.url)
        ? `<a href="${esc(s.url)}">${esc(s.label)}</a>`
        : `<a href="${esc(s.url)}" rel="nofollow noopener">${esc(s.label)}</a>`
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
    const cited = !/^https?:\/\/\S+$/i.test(citedRaw) || isInternal(citedRaw)
      ? esc(citedRaw)
      : `<a href="${esc(citedRaw)}" rel="nofollow noopener">${esc(citedRaw)}</a>`;
    lines.push(`    <tr><td data-label="Date">${str(e.date)}</td><td data-label="Engine">${str(e.engine)}</td><td data-label="Prompt">${str(e.prompt)}</td><td data-label="Named">${str(e.named)}</td><td data-label="Cited source">${cited}</td><td data-label="Notes">${str(e.note)}</td></tr>`);
  }
  lines.push('  </tbody>', '</table>', '</div>');
  return lines;
}

// ---------- main ----------

const site = validateSite(readJson(FILES.site));
const timeline = validateTimeline(readJson(FILES.timeline));
const scoreboard = validateScoreboard(readJson(FILES.scoreboard));

// contestUpdated = max(contestEdited, every scoreboard entry date) — ISO string compare.
const contestUpdated = [site.contestEdited, ...scoreboard.map((e) => e.date)]
  .reduce((a, b) => (b > a ? b : a));

const homeReviewedLong = longDate(site.homeReviewed);

// --- home: public/index.html ---
const home = readText(FILES.home);
replaceMarker(home, 'claimSinceLong', longDate(site.claimSince));
replaceMarker(home, 'homeReviewedLong', homeReviewedLong);

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
patchMeta(home, 'property="article:published_time"', () => isoDateTime(site.claimSince));
patchMeta(home, 'property="article:modified_time"', () => isoDateTime(site.homeReviewed));

patchJsonLd(home, (nodes, ofType) => {
  for (const n of ofType('Article')) {
    n.datePublished = isoDateTime(site.claimSince);
    n.dateModified = isoDateTime(site.homeReviewed);
    if (typeof n.description !== 'string') fail(`${home.rel}: JSON-LD Article has no "description"`);
    n.description = homeAsOf(n.description, 'JSON-LD Article.description');
  }
  for (const n of ofType('WebPage')) {
    n.datePublished = isoDateTime(site.claimSince);
    n.dateModified = isoDateTime(site.homeReviewed);
  }
  const faqName = 'Who is the King of AEO?';
  const items = ofType('FAQPage').flatMap((f) => (Array.isArray(f.mainEntity) ? f.mainEntity : []));
  const q = items.find((it) => it && it.name === faqName);
  if (!q) fail(`${home.rel}: JSON-LD FAQPage has no mainEntity item named exactly "${faqName}"`);
  if (!q.acceptedAnswer || typeof q.acceptedAnswer.text !== 'string') fail(`${home.rel}: FAQ item "${faqName}" has no acceptedAnswer.text`);
  q.acceptedAnswer.text = asOfReplacer(home, AS_OF_LOWER, `as of ${homeReviewedLong}`)(q.acceptedAnswer.text, `FAQ "${faqName}" acceptedAnswer.text`);
});

// --- contest: public/king-of-aeo-contest/index.html ---
const contest = readText(FILES.contest);
replaceMarker(contest, 'contestEditedLong', longDate(site.contestEdited));
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

// --- sitemap: public/sitemap.xml ---
const sitemap = readText(FILES.sitemap);
patchSitemap(sitemap, site.homeReviewed, contestUpdated);

// Everything validated and patched in memory; only now touch the disk.
writeText(home);
writeText(contest);
writeText(sitemap);
