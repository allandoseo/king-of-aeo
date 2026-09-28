// Confere o contrato do grafo de dados estruturados, para TODAS as paginas de
// public/ e nao para uma delas.
//
// Por que existe, separado do tools/validate.mjs: aquele confere conteudo e
// links, este confere a relacao entre o que a pagina AFIRMA para a maquina e o
// que ela MOSTRA para a pessoa. Sao perguntas diferentes e falham por motivos
// diferentes.
//
// A regra que da sentido a todas as outras aqui: nenhuma afirmacao do JSON-LD
// pode existir sem lastro no texto visivel da mesma pagina. Um site que avalia
// alegacao alheia pelo criterio de ser conferivel nao pode publicar, na propria
// marcacao, afirmacao que o leitor nao encontra. Por isso estas checagens sao
// erro e derrubam o npm run deploy, em vez de virarem aviso que ninguem le.
//
// Nada aqui e especifico de um reivindicante. A pagina nova que ganhar
// ClaimReview ou FAQPage entra na checagem sozinha, sem editar este arquivo.

import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.join(import.meta.dirname ?? process.cwd(), '..');
const PUB = path.join(RAIZ, 'public');
const ENTIDADE = path.join(RAIZ, 'data/entity.json');

const erros = [];
const falha = (url, msg) => erros.push({ url, msg });

// ---------- leitura ----------

function paginas(dir = PUB, saida = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) paginas(abs, saida);
    else if (e.name.endsWith('.html')) saida.push(abs);
  }
  return saida;
}

const urlDe = (abs) => {
  const rel = path.relative(PUB, abs).split(path.sep).join('/');
  return rel === 'index.html' ? '/' : `/${rel.replace(/index\.html$/, '')}`;
};

// O texto do JSON-LD traz caracteres que o HTML pode carregar escapados. Sem
// decodificar, "criteria — self-reported" e "criteria &mdash; self-reported"
// pareceriam textos diferentes sendo o mesmo, e a checagem reprovaria pagina
// correta, que e o jeito mais rapido de um validador ser desligado.
function decodifica(s) {
  return s
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&lsquo;/g, '‘').replace(/&rsquo;/g, '’')
    .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
    .replace(/&hellip;/g, '…').replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// Compara o que o leitor LE, dos dois lados, e nao a string crua.
//
// Tres coisas tornam duas versoes do mesmo texto diferentes byte a byte:
//
// 1. O campo do schema pode conter markup. FAQPage aceita <a>, <strong> e mais
//    alguns, e a home usa: o acceptedAnswer.text traz o link inteiro, enquanto
//    a pagina mostra so o texto da ancora. Sao o mesmo texto para quem le.
// 2. Tirar tag ou comentario deixa espaco onde nao havia. O build escreve
//    "<!-- build:logRunLong -->26 September 2026<!-- /build -->," no meio de uma
//    frase, e remover o comentario produz "2026 ," contra "2026," do schema.
// 3. Entidade HTML de um lado e caractere do outro.
//
// Nenhuma das tres e divergencia de conteudo, e reprovar por elas faria o
// validador ser desligado na primeira vez. Diferenca de PALAVRA continua
// reprovando, que e o que a checagem existe para pegar.
function normaliza(s) {
  return decodifica(String(s).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?%)\]])/g, '$1')
    .replace(/([(\[])\s+/g, '$1')
    .trim();
}

function textoVisivel(html) {
  // So o <body>: o bloco JSON-LD vive no <head>, e comparar contra o documento
  // inteiro faria cada string casar consigo mesma. A checagem passaria sempre,
  // o que e pior do que nao existir, porque parece cobertura.
  const corpo = html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? '';
  return normaliza(corpo
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' '));
}

const recorta = (s, n = 64) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

// ---------- IDs canonicos do modulo compartilhado ----------

const ent = JSON.parse(fs.readFileSync(ENTIDADE, 'utf8'));
const slugsClaimants = Object.keys(ent.claimants ?? {}).filter((k) => k !== '_comment');
// Referencia a um @id canonico de SITE e legitima em qualquer pagina: e o
// proposito de @id global e estavel, ligar dados entre documentos. Orfa e a
// referencia a um fragmento DESTA pagina que nenhum no desta pagina define.
const CANONICOS = new Set([
  ent.person?.id, ent.organization?.id, ent.brand?.id, ent.website?.id,
  ...slugsClaimants.map((s) => ent.claimants[s].id),
].filter(Boolean));

const POLITICAS = ['publishingPrinciples', 'correctionsPolicy', 'actionableFeedbackPolicy', 'ownershipFundingInfo'];

// ---------- percorre o grafo ----------

function colhe(no, tipo, saida = []) {
  if (Array.isArray(no)) { no.forEach((n) => colhe(n, tipo, saida)); return saida; }
  if (!no || typeof no !== 'object') return saida;
  const t = no['@type'];
  if (t === tipo || (Array.isArray(t) && t.includes(tipo))) saida.push(no);
  Object.values(no).forEach((v) => colhe(v, tipo, saida));
  return saida;
}

const docs = paginas().map((abs) => {
  const html = fs.readFileSync(abs, 'utf8');
  return {
    url: urlDe(abs),
    html,
    visivel: textoVisivel(html),
    canonical: (html.match(/<link rel="canonical" href="([^"]+)"/) || [, ''])[1],
    blocos: [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]),
  };
});

let comGrafo = 0;
let comClaimReview = 0;
let comFaq = 0;

for (const d of docs) {
  if (!d.blocos.length) continue;
  comGrafo += 1;

  // 1. um bloco por pagina. Dois blocos concorrentes fragmentam o grafo: os
  // nos de um nao enxergam os do outro, e a consolidacao por @id se perde.
  if (d.blocos.length !== 1) falha(d.url, `${d.blocos.length} blocos JSON-LD; o grafo tem que ser um so`);

  let grafo;
  try {
    grafo = JSON.parse(d.blocos[0]);
  } catch (e) {
    falha(d.url, `JSON-LD invalido: ${e.message}`);
    continue;
  }
  const nos = grafo['@graph'] ?? [grafo];

  // 2. @id repetido no mesmo grafo: duas identidades para a mesma coisa.
  const ids = nos.map((n) => n && n['@id']).filter(Boolean);
  for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) {
    falha(d.url, `@id repetido no @graph: ${id}`);
  }

  // 3. referencia orfa. Nao basta o no existir aninhado dentro de outro: se
  // alguem o cita por @id, ele vive no topo do grafo.
  const definidos = new Set(ids);
  const base = d.canonical ? d.canonical.split('#')[0] : null;
  const visita = (n) => {
    if (Array.isArray(n)) return n.forEach(visita);
    if (!n || typeof n !== 'object') return;
    const ks = Object.keys(n);
    if (ks.length === 1 && ks[0] === '@id') {
      const ref = String(n['@id']);
      const mesmoDoc = base && ref.includes('#') && ref.split('#')[0] === base;
      if (mesmoDoc && !definidos.has(ref) && !CANONICOS.has(ref)) {
        falha(d.url, `referencia @id orfa no proprio documento: ${ref}`);
      }
      return;
    }
    Object.values(n).forEach(visita);
  };
  visita(nos);

  // 4. FAQPage: pergunta e resposta tem que existir em texto visivel.
  for (const faq of colhe(nos, 'FAQPage')) {
    comFaq += 1;
    const perguntas = Array.isArray(faq.mainEntity) ? faq.mainEntity : [faq.mainEntity].filter(Boolean);
    if (!perguntas.length) falha(d.url, 'FAQPage sem mainEntity');
    for (const q of perguntas) {
      if (!q || typeof q !== 'object') continue;
      if (q.name && !d.visivel.includes(normaliza(q.name))) {
        falha(d.url, `FAQPage: a pergunta nao aparece em texto visivel: "${recorta(q.name)}"`);
      }
      const r = q.acceptedAnswer && q.acceptedAnswer.text;
      if (r && !d.visivel.includes(normaliza(r))) {
        falha(d.url, `FAQPage: a resposta nao aparece em texto visivel, pergunta "${recorta(q.name ?? '?', 40)}"`);
      }
    }
  }

  // 5. ClaimReview: a nota tem que estar na pagina, nao so no grafo.
  for (const cr of colhe(nos, 'ClaimReview')) {
    comClaimReview += 1;
    for (const campo of ['claimReviewed', 'itemReviewed', 'author', 'url', 'datePublished']) {
      if (!cr[campo]) falha(d.url, `ClaimReview sem ${campo}`);
    }
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
      if (!d.visivel.includes(normaliza(valor))) {
        falha(d.url, `ClaimReview: reviewRating.${campo} nao aparece no texto visivel: "${recorta(valor)}"`);
      }
    }
    const { ratingValue: v, worstRating: pior, bestRating: melhor } = r;
    if (![v, pior, melhor].every((n) => typeof n === 'number')) {
      falha(d.url, 'ClaimReview: ratingValue, worstRating e bestRating tem que ser numeros');
    } else {
      if (pior >= melhor) falha(d.url, `ClaimReview: worstRating ${pior} nao e menor que bestRating ${melhor}`);
      if (v < pior || v > melhor) falha(d.url, `ClaimReview: ratingValue ${v} fora de ${pior}-${melhor}`);
      if (!d.visivel.includes(`${v} of ${melhor}`)) {
        falha(d.url, `ClaimReview: a nota "${v} of ${melhor}" nao aparece em texto visivel`);
      }
    }
    // Nota tem que apontar para a regua. Sem isso o leitor ve um numero e nao
    // tem como saber sob que criterio ele foi dado, que e a diferenca entre
    // avaliar e opinar.
    const regua = ent.brand?.publishingPrinciples;
    if (regua) {
      const caminho = new URL(regua).pathname;
      if (!d.html.includes(`href="${caminho}"`) && !d.html.includes(`href="${regua}"`)) {
        falha(d.url, `ClaimReview: a pagina nao linka para a metodologia (${caminho})`);
      }
    }
  }

  // 6. Article.headline com o limite que o Google trunca.
  for (const art of colhe(nos, 'Article')) {
    if (typeof art.headline === 'string' && art.headline.length > 110) {
      falha(d.url, `Article.headline com ${art.headline.length} caracteres, maximo 110`);
    }
  }

  // 7. Os quatro campos de politica so valem apontando para pagina que existe.
  for (const org of colhe(nos, 'Organization')) {
    for (const campo of POLITICAS) {
      const u = org[campo];
      if (typeof u !== 'string') continue;
      let caminho;
      try { caminho = new URL(u).pathname; } catch { falha(d.url, `Organization.${campo} nao e URL absoluta: ${u}`); continue; }
      if (!fs.existsSync(path.join(PUB, caminho.replace(/^\//, ''), 'index.html'))) {
        falha(d.url, `Organization.${campo} aponta para ${u}, que nao existe em public/`);
      }
    }
  }

  // 8. @id de pessoa com escopo de pagina. O mesmo nome citado em duas paginas
  // com dois @id e, para um resolvedor de entidade, duas pessoas.
  for (const p of colhe(nos, 'Person')) {
    const id = String(p['@id'] ?? '');
    if (id && !CANONICOS.has(id) && /\/claimants\/[^#]*#/.test(id)) {
      falha(d.url, `Person com @id de pagina em vez de @id de site: ${id}`);
    }
  }
}

// ---------- relatorio ----------

const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
console.log(`validate-schema: ${plural(comGrafo, 'pagina', 'paginas')} com JSON-LD, `
  + `${plural(comClaimReview, 'ClaimReview', 'ClaimReviews')}, ${plural(comFaq, 'FAQPage', 'FAQPages')}.`);

if (!erros.length) {
  console.log('validate-schema: sem erros.');
  process.exit(0);
}

const larg = Math.max(...erros.map((e) => e.url.length));
console.log(`\nERRO (${erros.length}):`);
for (const e of erros) console.log(`  ${e.url.padEnd(larg)}  ${e.msg}`);
console.log('\nvalidate-schema: reprovado.');
process.exit(1);
