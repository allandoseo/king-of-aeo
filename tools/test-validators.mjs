// Testa os validadores: adultera o repositorio de proposito e exige que
// tools/validate-schema.mjs e build.mjs REPROVEM cada adulteracao.
//
// Por que existe: um validador que nunca viu um caso ruim nao e um validador,
// e uma suposicao. As checagens deste repo garantem que nenhuma afirmacao do
// JSON-LD existe sem lastro no texto visivel, e essa garantia vale o que valer
// a prova de que elas mordem. Rodar o validador contra a arvore limpa so
// mostra que ele nao acusa falso positivo, que e a metade facil.
//
// A licao que produziu a guarda mais importante daqui: na primeira versao, um
// dos casos trocava uma string com indentacao errada. A substituicao nao casava,
// o arquivo saia intacto, o validador passava e o teste era contabilizado como
// aprovado. Um teste que testa nada e pior que nenhum teste, porque ocupa o
// lugar dele. Agora toda adulteracao e conferida: se o arquivo nao mudou, o
// caso falha com "adulteracao nao aplicada" em vez de virar um OK silencioso.
//
// Uso: npm test
//
// O script escreve nos arquivos do repositorio e os restaura no finally,
// inclusive se um caso estourar. Por seguranca ele se recusa a comecar com
// alteracao pendente nos arquivos que toca: assim, se algo o matar no meio,
// `git checkout` recupera tudo sem perder trabalho seu.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.join(import.meta.dirname ?? process.cwd(), '..');
const p = (rel) => path.join(RAIZ, rel);

const DOOLEY = 'public/claimants/james-dooley/index.html';
const HOME = 'public/index.html';
const SONG = 'public/king-of-aeo-song/index.html';
const ENT = 'data/entity.json';
const FAQ = 'data/faq.json';

const BUILD = 'node build.mjs';
const SCHEMA = 'node tools/validate-schema.mjs';
const CONTEUDO = 'node tools/validate.mjs';

function roda(cmd) {
  try {
    execSync(cmd, { cwd: RAIZ, stdio: 'pipe' });
    return { ok: true, saida: '' };
  } catch (e) {
    return { ok: false, saida: String(e.stdout || '') + String(e.stderr || '') };
  }
}

// A primeira linha util da saida, para o relatorio mostrar POR QUE reprovou e
// nao so que reprovou. Caso que reprova pelo motivo errado e falso positivo.
function motivo(saida) {
  const m = saida.match(/Error: build\.mjs: (.+)/);
  if (m) return m[1].trim();
  const linha = saida.split('\n').find((l) => /^\s{2}\//.test(l));
  return linha ? linha.trim() : '(sem mensagem)';
}

const jsonEdit = (fn) => (texto) => {
  const d = JSON.parse(texto);
  fn(d);
  return `${JSON.stringify(d, null, 2)}\n`;
};

// grupo, arquivo, nome, comando que tem que reprovar, adulteracao
const CASOS = [
  ['validate-schema.mjs, sobre o HTML publicado', DOOLEY, 'ratingExplanation adulterado no texto visivel', SCHEMA,
    (t) => t.replace('It fails independent corroboration', 'It meets independent corroboration')],
  ['validate-schema.mjs, sobre o HTML publicado', DOOLEY, 'alternateName adulterado so no JSON-LD', SCHEMA,
    (t) => t.replace('"alternateName": "Self-reported, syndicated and observed; not independently corroborated"', '"alternateName": "Fully corroborated"')],
  ['validate-schema.mjs, sobre o HTML publicado', DOOLEY, 'nota do JSON-LD divergindo da pagina', SCHEMA,
    (t) => t.replace('"ratingValue": 3', '"ratingValue": 4')],
  ['validate-schema.mjs, sobre o HTML publicado', DOOLEY, 'ratingValue fora da escala', SCHEMA,
    (t) => t.replace('"ratingValue": 3', '"ratingValue": 9')],
  ['validate-schema.mjs, sobre o HTML publicado', DOOLEY, 'ClaimReview sem itemReviewed', SCHEMA,
    (t) => t.replace(/"itemReviewed": \{[^}]*\},\n/, '')],
  ['validate-schema.mjs, sobre o HTML publicado', DOOLEY, 'resposta de FAQ apagada da pagina', SCHEMA,
    (t) => t.replace(/<p>No corroborated answer exists[\s\S]*?<\/p>/, '<p>removido</p>')],
  ['validate-schema.mjs, sobre o HTML publicado', DOOLEY, 'pergunta de FAQ apagada da pagina', SCHEMA,
    (t) => t.replace('<summary>Was the Leigh ceremony independently verified?</summary>', '<summary>outra coisa</summary>')],
  ['validate-schema.mjs, sobre o HTML publicado', DOOLEY, 'referencia @id orfa', SCHEMA,
    (t) => t.replace('/claimants/james-dooley/#citation-sturm",\n      "name"', '/claimants/james-dooley/#nao-existe",\n      "name"')],
  ['validate-schema.mjs, sobre o HTML publicado', DOOLEY, '@id de pagina de volta na pessoa', SCHEMA,
    (t) => t.replace(/"@id": "https:\/\/kingofaeo\.pro\/#james-dooley"/g, '"@id": "https://kingofaeo.pro/claimants/james-dooley/#claimant"')],
  ['validate-schema.mjs, sobre o HTML publicado', DOOLEY, 'Article.headline acima de 110 caracteres', SCHEMA,
    (t) => t.replace('"headline": "Is James Dooley the King of AEO?"', `"headline": "${'x'.repeat(111)}"`)],
  ['validate-schema.mjs, sobre o HTML publicado', DOOLEY, 'pagina com nota que nao linka para a metodologia', SCHEMA,
    (t) => t.replace(/href="\/metodologia\/"/g, 'href="/outra/"')],
  ['validate-schema.mjs, sobre o HTML publicado', HOME, 'dois blocos JSON-LD na mesma pagina', SCHEMA,
    (t) => t.replace('</head>', '<script type="application/ld+json">{"@context":"https://schema.org","@graph":[]}</script>\n</head>')],
  ['validate-schema.mjs, sobre o HTML publicado', HOME, 'campo de politica do Organization apontando para 404', SCHEMA,
    (t) => t.replace('"correctionsPolicy": "https://kingofaeo.pro/politica-de-correcao/"', '"correctionsPolicy": "https://kingofaeo.pro/nao-existe/"')],
  ['validate-schema.mjs, sobre o HTML publicado', SONG, 'pergunta repetida em duas rotas', SCHEMA,
    (t) => t.replace('"name": "What does Rei do AEO mean?"', '"name": "Is this an official award?"')],

  ['build.mjs, sobre o registro na origem', FAQ, 'pergunta repetida entre rotas', BUILD,
    jsonEdit((d) => d['/king-of-aeo-song/'].push({ q: 'What is AEO?', a: 'teste' }))],
  ['build.mjs, sobre o registro na origem', FAQ, 'comentario HTML dentro de uma resposta', BUILD,
    jsonEdit((d) => { d['/'][0].a = `<!-- build:x -->${d['/'][0].a}`; })],
  ['build.mjs, sobre o registro na origem', FAQ, 'rota do registro sem pagina em public/', BUILD,
    jsonEdit((d) => { d['/nao-existe/'] = [{ q: 'a', a: 'b' }]; })],
  ['build.mjs, sobre o registro na origem', FAQ, 'pergunta repetida dentro da mesma rota', BUILD,
    jsonEdit((d) => d['/'].push({ ...d['/'][0] }))],
  ['build.mjs, sobre o registro na origem', ENT, 'verdict com ratingValue fora da escala', BUILD,
    jsonEdit((d) => { d.claimants['james-dooley'].verdict.ratingValue = 7; })],
  ['build.mjs, sobre o registro na origem', ENT, 'verdict ausente em claimant com ClaimReview', BUILD,
    jsonEdit((d) => { delete d.claimants['james-dooley'].verdict; })],
  ['build.mjs, sobre o registro na origem', ENT, 'campo de politica apontando para pagina inexistente', BUILD,
    jsonEdit((d) => { d.brand.correctionsPolicy = 'https://kingofaeo.pro/nao-existe/'; })],
  ['build.mjs, sobre o registro na origem', ENT, 'claimant com @id de pagina em vez de @id de site', BUILD,
    jsonEdit((d) => { d.claimants.vithurs.id = 'https://kingofaeo.pro/claimants/vithurs/#claimant'; })],
  // sameAs afirma identidade: a mesma URL em duas entidades diz que as duas sao
  // a mesma coisa. Era o caso de https://seomais.com.br/, que estava em
  // person.sameAs e era tambem organization.url, contradizendo o worksFor.
  ['build.mjs, sobre o registro na origem', ENT, 'URL da agencia reivindicada tambem pela pessoa', BUILD,
    jsonEdit((d) => d.person.sameAs.push(d.organization.url))],
  ['build.mjs, sobre o registro na origem', ENT, 'perfil do projeto reivindicado tambem pela pessoa', BUILD,
    jsonEdit((d) => d.person.sameAs.push(d.brand.sameAs[0]))],
];

const arquivos = [...new Set(CASOS.map(([, arq]) => arq))];

// Alteracao pendente nos arquivos que este script escreve significa que uma
// interrupcao brusca custaria trabalho seu. Melhor recusar do que arriscar.
const sujos = execSync('git status --porcelain', { cwd: RAIZ, encoding: 'utf8' })
  .split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
const conflito = arquivos.filter((a) => sujos.includes(a));
if (conflito.length) {
  console.error(`test-validators: ha alteracao nao commitada em ${conflito.join(', ')}.`);
  console.error('Este script escreve nesses arquivos e os restaura no fim. Commite ou guarde antes de rodar.');
  process.exit(1);
}

const originais = new Map(arquivos.map((a) => [a, fs.readFileSync(p(a), 'utf8')]));
const restaura = () => { for (const [a, t] of originais) fs.writeFileSync(p(a), t); };
process.on('SIGINT', () => { restaura(); process.exit(130); });

let aprovados = 0;
const problemas = [];

try {
  // Controle ANTES dos casos: com a arvore limpa os tres tem que passar. Se nao
  // passam, os testes negativos nao provam nada, porque qualquer um deles
  // reprovaria pelo motivo errado.
  console.log('--- controle: arvore limpa ---');
  for (const [rotulo, cmd] of [['build.mjs', BUILD], ['validate.mjs', CONTEUDO], ['validate-schema.mjs', SCHEMA]]) {
    const r = roda(cmd);
    console.log(`  ${rotulo.padEnd(20)} ${r.ok ? 'exit 0' : 'FALHOU'}`);
    if (!r.ok) problemas.push(`controle: ${rotulo} ja reprova com a arvore limpa`);
  }
  if (problemas.length) throw new Error('controle reprovou');

  let grupo = '';
  for (const [g, arq, nome, cmd, mexe] of CASOS) {
    if (g !== grupo) { grupo = g; console.log(`\n--- ${g} ---`); }
    restaura();
    const antes = fs.readFileSync(p(arq), 'utf8');
    const depois = mexe(antes);
    // A guarda que faltava. Adulteracao que nao muda o arquivo faz o validador
    // passar por nao haver o que pegar, e o caso seria contado como aprovado.
    if (depois === antes) {
      console.log(`  NAO APLICOU  ${nome}`);
      problemas.push(`${nome}: a adulteracao nao alterou ${arq}; o caso nao testou nada`);
      continue;
    }
    fs.writeFileSync(p(arq), depois);
    const r = roda(cmd);
    if (r.ok) {
      console.log(`  NAO PEGOU    ${nome}`);
      problemas.push(`${nome}: ${cmd} passou com o arquivo adulterado`);
    } else {
      console.log(`  reprova      ${nome}`);
      console.log(`                 -> ${motivo(r.saida).slice(0, 110)}`);
      aprovados += 1;
    }
  }
} finally {
  restaura();
  roda(BUILD);
}

console.log(`\n${aprovados} de ${CASOS.length} adulteracoes reprovadas.`);
if (problemas.length) {
  console.log(`\nPROBLEMA (${problemas.length}):`);
  for (const x of problemas) console.log(`  ${x}`);
  console.log('\ntest-validators: reprovado.');
  process.exit(1);
}
console.log('test-validators: sem problemas.');
