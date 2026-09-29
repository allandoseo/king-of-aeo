// Valida a camada de dados de data/ contra os schemas de data/schema/, e roda
// ANTES do build. Run malformada nao vira pagina.
//
// Por que um validador escrito aqui em vez de ajv: o projeto nao tem
// dependencias, e essa e uma propriedade que vale manter. O subconjunto de JSON
// Schema usado pelos dois schemas deste repo e pequeno e esta implementado
// abaixo por inteiro; qualquer palavra-chave que apareca num schema e nao
// esteja aqui DERRUBA a validacao em vez de ser ignorada em silencio, que e o
// modo de falhar que tornaria o validador inutil sem ninguem perceber.
//
// Alem do schema, ha regras que um schema nao alcanca e que estao no fim do
// arquivo: o nome do arquivo tem que bater com a data de toda run dentro dele,
// first_name tem que ser um dos names_returned, e nenhum slug se repete.

import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.join(import.meta.dirname ?? process.cwd(), '..');
const p = (rel) => path.join(RAIZ, rel);

const erros = [];
const falha = (onde, msg) => erros.push(`${onde}: ${msg}`);

const PALAVRAS = new Set(['$schema', '$id', 'title', 'description', 'type', 'enum',
  'pattern', 'required', 'additionalProperties', 'properties', 'items',
  'minItems', 'minLength', 'uniqueItems']);

const tipoDe = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v === 'number' ? 'number' : typeof v;
};

function valida(dado, esquema, onde) {
  for (const k of Object.keys(esquema)) {
    if (!PALAVRAS.has(k)) falha(onde, `schema keyword "${k}" is not implemented by this validator`);
  }

  if (esquema.type !== undefined) {
    const aceitos = Array.isArray(esquema.type) ? esquema.type : [esquema.type];
    const t = tipoDe(dado);
    const ok = aceitos.some((a) => (a === 'integer' ? Number.isInteger(dado) : a === t));
    if (!ok) { falha(onde, `expected ${aceitos.join(' or ')}, got ${t}`); return; }
  }
  if (dado === null) return;

  if (esquema.enum && !esquema.enum.includes(dado)) {
    falha(onde, `${JSON.stringify(dado)} is not one of: ${esquema.enum.join(', ')}`);
  }
  if (typeof dado === 'string') {
    if (esquema.pattern && !new RegExp(esquema.pattern, 'u').test(dado)) {
      falha(onde, `${JSON.stringify(dado)} does not match ${esquema.pattern}`);
    }
    if (esquema.minLength !== undefined && dado.length < esquema.minLength) {
      falha(onde, `shorter than minLength ${esquema.minLength}`);
    }
  }
  if (Array.isArray(dado)) {
    if (esquema.minItems !== undefined && dado.length < esquema.minItems) {
      falha(onde, `has ${dado.length} items, minimum ${esquema.minItems}`);
    }
    if (esquema.uniqueItems) {
      const vistos = dado.map((x) => JSON.stringify(x));
      const dup = vistos.find((x, i) => vistos.indexOf(x) !== i);
      if (dup) falha(onde, `duplicate item ${dup}`);
    }
    if (esquema.items) dado.forEach((v, i) => valida(v, esquema.items, `${onde}[${i}]`));
  }
  if (tipoDe(dado) === 'object') {
    for (const req of esquema.required ?? []) {
      if (!(req in dado)) falha(onde, `missing required property "${req}"`);
    }
    if (esquema.additionalProperties === false && esquema.properties) {
      for (const k of Object.keys(dado)) {
        if (!(k in esquema.properties)) falha(onde, `unexpected property "${k}"`);
      }
    }
    for (const [k, sub] of Object.entries(esquema.properties ?? {})) {
      if (k in dado) valida(dado[k], sub, `${onde}.${k}`);
    }
  }
}

const leJson = (rel) => {
  try { return JSON.parse(fs.readFileSync(p(rel), 'utf8')); } catch (e) {
    falha(rel, `invalid JSON: ${e.message}`);
    return null;
  }
};

// ---------- runs ----------

const esquemaRun = leJson('data/schema/run.schema.json');
const dirRuns = p('data/runs');
if (!fs.existsSync(dirRuns)) falha('data/runs', 'directory does not exist');

const arquivos = fs.existsSync(dirRuns)
  ? fs.readdirSync(dirRuns).filter((f) => f.endsWith('.json')).sort() : [];
let totalRuns = 0;

for (const arq of arquivos) {
  const rel = `data/runs/${arq}`;
  if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(arq)) {
    falha(rel, 'file name must be YYYY-MM-DD.json: the date is the key, not a label');
    continue;
  }
  const runs = leJson(rel);
  if (!runs) continue;
  if (esquemaRun) valida(runs, esquemaRun, rel);
  if (!Array.isArray(runs)) continue;
  totalRuns += runs.length;
  const dataDoArquivo = arq.replace('.json', '');
  runs.forEach((r, i) => {
    const onde = `${rel}[${i}]`;
    // O nome do arquivo e a data. Run com outra data dentro some das paginas
    // que agrupam por dia, sem erro nenhum, e ninguem descobre.
    if (r.date !== dataDoArquivo) falha(onde, `date "${r.date}" does not match the file name "${dataDoArquivo}"`);
    // first_name tem que ser um dos nomes devolvidos. Um nome primario que nao
    // esta na lista e um nome que a resposta nao deu.
    if (r.first_name && Array.isArray(r.names_returned) && !r.names_returned.includes(r.first_name)) {
      falha(onde, `first_name "${r.first_name}" is not in names_returned`);
    }
    // Nome primario sem nome nenhum devolvido nao existe.
    if (r.first_name && Array.isArray(r.names_returned) && !r.names_returned.length) {
      falha(onde, 'first_name is set but names_returned is empty');
    }
    // Se o verbatim e nulo, nao houve nome: a lista tem que estar vazia.
    if (r.name_returned_verbatim === null && Array.isArray(r.names_returned) && r.names_returned.length) {
      falha(onde, 'names_returned is not empty but name_returned_verbatim is null');
    }
  });
}

// Data duplicada entre arquivos nao acontece pelo nome, mas duas runs iguais
// dentro do mesmo dia sim, e uma delas seria contagem dobrada no placar.
for (const arq of arquivos) {
  const runs = leJson(`data/runs/${arq}`);
  if (!Array.isArray(runs)) continue;
  const chaves = runs.map((r) => `${r.engine}|${r.locale}|${r.query}`);
  const dup = chaves.find((x, i) => chaves.indexOf(x) !== i);
  if (dup) falha(`data/runs/${arq}`, `two runs share engine|locale|query: ${dup}`);
}

// ---------- claimants ----------

const esquemaClaimants = leJson('data/schema/claimants.schema.json');
const claimants = leJson('data/claimants.json');
if (claimants && esquemaClaimants) valida(claimants, esquemaClaimants, 'data/claimants.json');
if (claimants?.claimants) {
  const slugs = claimants.claimants.map((c) => c.slug);
  const dup = slugs.find((x, i) => slugs.indexOf(x) !== i);
  if (dup) falha('data/claimants.json', `duplicate slug "${dup}"`);
  // primary_url nulo exige explicacao. Campo vazio sem motivo e dado perdido
  // que parece dado ausente.
  for (const c of claimants.claimants) {
    if (c.primary_url === null && !/not confirmed|404|no url/i.test(c.url_status)) {
      falha('data/claimants.json', `${c.slug}: primary_url is null but url_status does not say why`);
    }
  }
}

// ---------- relatorio ----------

console.log(`validate-data: ${arquivos.length} arquivo(s) de run, ${totalRuns} run(s), `
  + `${claimants?.claimants?.length ?? 0} reivindicante(s).`);
if (!erros.length) {
  console.log('validate-data: sem erros.');
  process.exit(0);
}
console.log(`\nERRO (${erros.length}):`);
for (const e of erros) console.log(`  ${e}`);
console.log('\nvalidate-data: reprovado.');
process.exit(1);
