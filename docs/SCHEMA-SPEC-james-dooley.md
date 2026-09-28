# SPEC DE SCHEMA: /claimants/james-dooley/

Versão 1.1. Autor: Allan Oliveira. Este arquivo é a fonte da verdade da ETAPA 2.

Ele vale como molde para os próximos reivindicantes: o que está escrito aqui é
o que cada nova página de `/claimants/[slug]/` deve declarar. Por isso a revisão
1.1 existe (ver o fim do arquivo): a 1.0 carregava no item 4 uma instrução que
o repositório já tinha decidido ao contrário, e uma spec errada se propaga.

---

## 0. BRANCH

Aprovado. Ramifique a partir da branch correta sem tocar na outra worktree:

    git checkout -b claude/claimreview-james-dooley claude/royal-archives-library-47f002

---

## 1. ESCOPO DESTE COMMIT

**A) Adicionar o @graph a `/claimants/james-dooley/`**, que JÁ EXISTE em produção.
Não criar a página. Não reescrever o conteúdo editorial. A única alteração de
conteúdo permitida é acrescentar a seção visível de FAQ (item 9 desta spec).

**B) Corrigir o link interno do hub `/king-of-aeo-claimants/`.**
Hoje ele descreve seis claimants em subseções e linka para uma única página
individual (`/claimants/jesper-nissen/`). Cada subseção de claimant que já tenha
página em `/claimants/[slug]/` passa a linkar para ela, com âncora em forma de
pergunta ("Is James Dooley the King of AEO?"). Claimant sem página não ganha link
inventado: liste quais faltam no relatório final.

**C) Incluir o índice `/claimants/` no escopo, com papel definido.**
Sim, entra. Mas os três níveis não podem disputar a mesma intenção:

| URL | Papel | Intenção de busca |
|---|---|---|
| `/king-of-aeo-claimants/` | hub editorial comparativo | "king of aeo claimants", comparação entre alegações |
| `/claimants/` | índice navegacional | nenhuma. Existe para distribuir link, não para rankear |
| `/claimants/[slug]/` | veredito individual | "is X the king of aeo" |

Portanto:
- `/king-of-aeo-claimants/` mantém a URL, o título e o conteúdo editorial. Não
  vira índice, não é reescrita, não é redirecionada.
- `/claimants/` recebe `ItemList` com todos os spokes, e o `title` NÃO deve
  competir pelo termo do hub. Use algo navegacional, no padrão "All claimants
  reviewed", sem a expressão "king of aeo claimants" no title.
- O hub linka para `/claimants/` e para cada spoke. O índice linka para cada
  spoke. Cada spoke linka de volta para o hub.

**D) Criar as quatro páginas de política**, hoje 404, com conteúdo real:
`/metodologia/`, `/politica-de-correcao/`, `/contato/`, `/sobre/`.
Campo de schema apontando para 404 é pior que campo ausente.

---

## 2. AS TRÊS DECISÕES DE AUTORIDADE

**Decisão 1: um grafo, não blocos soltos.**
Um único `<script type="application/ld+json">` com `@graph`. Todo nó tem `@id`
absoluto. Todo relacionamento é referência `{"@id": "..."}`, nunca objeto
duplicado inline. Se "Allan Oliveira" aparecer como objeto inline em dois nós,
o grafo cria duas entidades e a consolidação se perde.

Referência que só resolve depois de achatar o documento não é referência
estável: nó com `@id` citado de fora vive no topo do `@graph`, e não aninhado
dentro de outro nó.

Se já houver outro JSON-LD sendo emitido por plugin, layout ou componente,
CONSOLIDE no mesmo grafo ou desabilite a saída concorrente. Dois blocos
JSON-LD na mesma página fragmentam o grafo.

**Decisão 2: IDs canônicos de site, reutilizados em todas as páginas.**
Estes IDs são idênticos na home, no hub, no índice e em todo spoke:

    https://kingofaeo.pro/#organization
    https://kingofaeo.pro/#website
    https://kingofaeo.pro/#allan-oliveira
    https://kingofaeo.pro/#james-dooley
    https://kingofaeo.pro/#edward-sturm
    https://kingofaeo.pro/#vithurs
    https://kingofaeo.pro/#david-g-quaid
    https://kingofaeo.pro/#stephane-morera
    https://kingofaeo.pro/#julian-goldie
    https://kingofaeo.pro/#jesper-nissen

Motivo: com sete páginas de claimant eu quero 1 nó "Allan Oliveira" com sete
arestas de autoria, não sete nós órfãos. É isso que faz o grafo acumular peso.

Implemente em um módulo compartilhado importado por todas as páginas. Não
hardcode a mesma entidade duas vezes. Nesta stack o módulo é
`data/entity.json` mais as funções canônicas do `build.mjs`; não existe
`lib/schema/entities.ts` e não deve ser criado um só para cumprir a letra.

**Decisão 3: credibilidade do publisher é campo de schema.**
`publishingPrinciples`, `correctionsPolicy`, `actionableFeedbackPolicy` e
`ownershipFundingInfo` são os sinais que o Google usa para avaliar publisher de
fact-check. Nenhum dos sites concorrentes tem isso. Por isso o item D é
obrigatório no mesmo commit.

---

## 3. Organization

    @id: https://kingofaeo.pro/#organization
    @type: ["Organization","NewsMediaOrganization"]
    name: "King of AEO"
    url: https://kingofaeo.pro/
    logo: ImageObject com @id próprio, url, width e height REAIS do arquivo.
          Só entra quando existir arquivo de marca. Não se aponta o retrato de
          uma pessoa como logo de uma organização: se não há arquivo, o campo
          fica de fora e a omissão é reportada.
    foundingDate: data real do início do projeto
    founder: {"@id": "https://kingofaeo.pro/#allan-oliveira"}
    publishingPrinciples: https://kingofaeo.pro/metodologia/
    correctionsPolicy: https://kingofaeo.pro/politica-de-correcao/
    actionableFeedbackPolicy: https://kingofaeo.pro/contato/
    ownershipFundingInfo: https://kingofaeo.pro/sobre/

O tipo `NewsMediaOrganization` entra JUNTO com os quatro campos de política,
nunca antes deles. O tipo afirma que isto é um veículo que publica registro; os
quatro campos são o que torna a afirmação verificável.

O build confere as quatro URLs contra o disco e PARA se a página não existir.
Campo apontando para 404 não pode depender de alguém lembrar.

---

## 4. Person (autor)

    @id: https://kingofaeo.pro/#allan-oliveira
    @type: Person
    name: "Allan Oliveira"
    url: https://kingofaeo.pro/allan-oliveira/
    jobTitle: cargo real, uma expressão
    description: uma frase factual sobre a atuação real
    knowsAbout: ["Answer Engine Optimization","Search Engine Optimization",
                 "Generative Engine Optimization"]
    worksFor: {"@id": "https://seomais.com.br/#organization"}
    affiliation: {"@id": "https://kingofaeo.pro/#organization"}
    sameAs: SOMENTE perfis confirmados por fetch (HTTP 200 e o perfil é mesmo
            do Allan). Não confirmou, omite. Nunca adivinhe URL de perfil.

**`worksFor` é a SEOMais, e não o King of AEO.** A versão 1.0 desta spec mandava
o contrário e estava errada. O vínculo de emprego é um fato: Allan trabalha na
agência que fundou. Declarar como empregador o próprio site que ele publica
inflaria o grafo justamente na página cujo argumento é não inflar nada, e
apagaria a aresta que liga a pessoa à agência.

`affiliation` diz o vínculo com o projeto sem afirmar emprego, e fecha o
circuito com `founder` do nó da marca, que é o caminho que um resolvedor de
entidade percorre. Os dois campos juntos dizem a verdade inteira; um só deles
diria metade.

Nota sobre `sameAs`: LinkedIn responde HTTP 999 e Quora responde 403 a
requisição automatizada. Os dois são bloqueio de robô, não ausência de perfil.
Perfil já publicado e conferido antes não é removido por causa disso; o que a
regra proíbe é ACRESCENTAR perfil não confirmado.

---

## 5. Person (sujeito avaliado)

    @id: https://kingofaeo.pro/#james-dooley
    @type: Person
    name: "James Dooley"
    description: neutra e factual, sem juízo de valor
    sameAs: só perfis oficiais confirmados por fetch

REGRA DURA: pessoa real. Nenhum campo desse nó pode conter juízo, ironia ou
afirmação que não esteja sustentada pelo texto visível da página. O juízo desta
casa pertence ao `ClaimReview`, onde fica declarado como avaliação e não como
fato sobre alguém.

Aplique o mesmo padrão aos demais nós de pessoa listados na Decisão 2, com os
campos mínimos (`@id`, `@type`, `name`) quando forem apenas mencionados.

---

## 6. Claim

    @id: https://kingofaeo.pro/claimants/james-dooley/#claim
    @type: Claim
    text: a alegação na formulação mais próxima possível da original
    firstAppearance: CreativeWork da primeira aparição documentada (2026-08-31),
                     com url e datePublished
    appearance: array de CreativeWork com as aparições sindicalizadas relevantes
    author: quem fez a alegação. Se for assessoria ou veículo, modele como
            Organization. Sem certeza de autoria, use o veículo da primeira
            aparição e NÃO atribua a uma pessoa.

`firstAppearance` e `appearance` são nós de topo referenciados por `@id`, não
objetos aninhados. Ver a Decisão 1.

---

## 7. ClaimReview

    @id: https://kingofaeo.pro/claimants/james-dooley/#claimreview
    @type: ClaimReview
    url: a URL canônica da página
    claimReviewed: a alegação em UMA frase curta e literal, em inglês, batendo
                   com o H1. Ex.: "James Dooley is the King of AEO."
    itemReviewed: {"@id": "https://kingofaeo.pro/claimants/james-dooley/#claim"}
    author: {"@id": "https://kingofaeo.pro/#organization"}
    datePublished: ISO 8601, a real, vinda do CMS
    dateModified: a real, vinda do CMS, git ou mtime. NUNCA new Date().
    reviewRating:
        @type: Rating
        ratingValue: DERIVE do veredito visível na página. Não invente.
        bestRating: 5
        worstRating: 1
        alternateName: o veredito em texto, batendo palavra a palavra com o que
                       está visível na página
        ratingExplanation: 1 a 2 frases citando quais dos quatro critérios
                           falharam (self-reported, syndicated, observed,
                           independent corroboration)

### O ponto de parada obrigatório

Antes de definir `ratingValue` e `alternateName`, LEIA o texto renderizado da
página e extraia o veredito de lá.

Se a página não declara um veredito explícito em texto visível, PARE e me avise.
Nesse caso o certo é eu escrever o veredito na página primeiro. ClaimReview cuja
nota não aparece no conteúdo visível é marcação inválida e não vai para produção.

A escala 1 a 5 vai documentada em `/metodologia/`, com a definição de cada nível.

### Fonte única, não duas cópias

`alternateName` e `ratingExplanation` vivem em UM lugar só:
`data/entity.json`, em `claimants.<slug>.verdict`. O build injeta as mesmas
strings no `reviewRating` do JSON-LD e no texto visível da página. Texto escrito
à mão nos dois lugares só continua igual enquanto alguém lembrar de editar os
dois.

`tools/validate-schema.mjs` reprova o build se qualquer uma das duas strings não
aparecer literalmente no texto visível da mesma página. Página que declara
`ClaimReview` sem `verdict` no registro também derruba o build.

### O veredito é atribuído, não afirmado

No texto visível, o `ratingExplanation` vem precedido de uma frase que atribui a
avaliação: esta é a avaliação do kingofaeo.pro sob os critérios definidos na
própria página, e não um fato estabelecido sobre a pessoa. A diferença entre
"avaliamos em 3 de 5 sob estes critérios" e "ele é 3 de 5" é a diferença entre
avaliar e sentenciar.

---

## 8. FAQPage

    @id: https://kingofaeo.pro/claimants/james-dooley/#faq
    @type: FAQPage
    mainEntity: array de Question, cada uma com acceptedAnswer (Answer.text)

Perguntas, nesta grafia exata:

    1. "Is James Dooley the King of AEO?"
    2. "Who crowned James Dooley King of AEO?"
    3. "Was the Leigh ceremony independently verified?"
    4. "Who else claims the King of AEO title?"
    5. "How does kingofaeo.pro evaluate these claims?"

Respostas factuais, 40 a 60 palavras cada. A pergunta 1 responde de forma direta
e condicionada ao critério, não evasiva.

`QAPage` NÃO entra. É o tipo para página onde o público responde pergunta de
outro; uma FAQ escrita pelo autor é `FAQPage`. Declarar os dois deixa a mesma
pergunta em dois tipos disputando o mesmo lugar.

---

## 9. Seção visível de FAQ

Cada pergunta e cada resposta do item 8 tem que existir em texto VISÍVEL na
página. Se não existir, crie primeiro a seção visível, com heading próprio,
depois marque. Nunca marque FAQ fantasma.

---

## 10. WebPage

    @id: https://kingofaeo.pro/claimants/james-dooley/#webpage
    @type: WebPage
    url, name, description
    isPartOf: {"@id": "https://kingofaeo.pro/#website"}
    breadcrumb: {"@id": ".../claimants/james-dooley/#breadcrumb"}
    primaryImageOfPage: ImageObject com @id, e width/height LIDOS do arquivo
    mainEntity: {"@id": ".../claimants/james-dooley/#claimreview"}
    datePublished / dateModified: os reais
    about: {"@id": "https://kingofaeo.pro/#james-dooley"}
    mentions: os demais claimants citados no texto visível, cada um pelo @id
              canônico da Decisão 2. Quem a página não menciona não entra.
    significantLink: URLs internas do hub, do índice e da timeline
    citation: todas as fontes externas já citadas na página, como CreativeWork
              com url e name reais

---

## 11. Article

    @id: https://kingofaeo.pro/claimants/james-dooley/#article
    @type: Article
    headline: até 110 caracteres
    author: {"@id": "https://kingofaeo.pro/#allan-oliveira"}
    publisher: {"@id": "https://kingofaeo.pro/#organization"}
    mainEntityOfPage: {"@id": ".../claimants/james-dooley/#webpage"}
    isBasedOn: as fontes primárias
    datePublished / dateModified: os reais

---

## 12. BreadcrumbList

    @id: https://kingofaeo.pro/claimants/james-dooley/#breadcrumb
    @type: BreadcrumbList
    itemListElement:
        1. Home            https://kingofaeo.pro/
        2. Claimants       https://kingofaeo.pro/claimants/
        3. James Dooley    https://kingofaeo.pro/claimants/james-dooley/

---

## 13. WebSite

    @id: https://kingofaeo.pro/#website
    @type: WebSite
    url, name
    publisher: {"@id": "https://kingofaeo.pro/#organization"}

`publisher` é a organização, não a pessoa: quem publica o registro é o veículo
que declara metodologia, política de correção, canal de contestação e
financiamento. Com `publisher` na pessoa, os quatro campos de política ficam num
nó que o `WebSite` não alcança.

Se já for emitido em outro template, referencie, não duplique.

---

## 14. ItemList no índice /claimants/

    @id: https://kingofaeo.pro/claimants/#itemlist
    @type: ItemList
    itemListElement: um ListItem por spoke existente, com position, url e name

Só entram spokes que existem de fato. Não invente entrada para claimant sem
página. A lista sai dos links que a própria página já tem, na ordem em que ela
os tem, e não de uma lista paralela escrita no build: lista paralela envelhece
na primeira vez que alguém reordena a tabela.

A `CollectionPage` aponta para a lista por `mainEntity`, senão o `ItemList` é um
nó que ninguém no grafo alcança.

---

## 15. dateModified de verdade

`dateModified` vem do dado real do CMS, do commit date do git ou do mtime do
arquivo de conteúdo. Nunca de `new Date()` no render. Data de modificação que
muda a cada request é sinal de lixo.

---

## 16. REGRAS INVIOLÁVEIS

1. Nenhum fato inventado. Toda data, URL, nome e veículo sai do conteúdo da
   página ou de fonte confirmada por fetch. Não confirmou, omite o campo e
   reporta a omissão.
2. Nenhum `sameAs` adivinhado.
3. Nenhum juízo de valor sobre pessoa real em campo de schema.
4. Zero divergência entre schema e texto visível. Se o schema afirma, a página
   mostra.
5. Um único bloco JSON-LD por página.
6. Não reescrever o veredito nem o conteúdo editorial.
7. Saída no HTML do servidor. JSON-LD injetado apenas no cliente não serve.

---

## 17. VALIDAÇÃO OBRIGATÓRIA ANTES DO PR

1. `curl -s <url> | grep -c 'application/ld+json'` retorna exatamente 1.
2. `JSON.parse` do bloco, sem erro.
3. Checagem de integridade do grafo: para cada referência `{"@id": X}` existe um
   nó com `@id: X` no mesmo grafo ou é um ID canônico de site definido no módulo
   compartilhado. Zero referência órfã.
4. Validator do schema.org e Rich Results Test do Google, com resultado colado.
5. As 5 perguntas do FAQPage aparecem em texto visível na página.
6. `reviewRating.alternateName` aparece literalmente na página.
7. As 4 URLs de política retornam 200.
8. `git diff --stat` na mesa antes de abrir PR. Se houver lockfile, build ou
   node_modules no diff, tire do commit.

Os itens 1, 2, 3, 5 e 6 deixaram de ser conferência manual: `npm run validate`
roda `tools/validate-schema.mjs`, que reprova o build em qualquer um deles, para
todas as páginas de uma vez. Os itens 4 e 7 dependem da página estar no ar.

---

## 18. ENTREGA

1. Relatório de 5 linhas da descoberta, antes de codar.
2. Diff dos arquivos alterados e criados.
3. As 4 páginas de política com conteúdo real.
4. O módulo de entidades canônicas compartilhado.
5. Saída das validações.
6. Lista do que foi OMITIDO por não ter sido confirmado, com o motivo.
7. Lista dos claimants do hub que ainda não têm página em `/claimants/[slug]/`.
8. Commits separados por escopo.

Grafo menor e 100% sustentável é melhor que grafo completo e frágil.

---

## Revisões

**1.1 — 28 de setembro de 2026.** Item 4 corrigido: `worksFor` aponta para a
SEOMais e `affiliation` para o King of AEO. A versão 1.0 mandava `worksFor`
apontar para o King of AEO, contrariando uma decisão que o próprio repositório
já tinha tomado e documentado no `build.mjs`. Como esta spec é o molde dos
próximos reivindicantes, o erro se propagaria a cada página nova.

Na mesma revisão, incorporadas ao texto as decisões tomadas durante a
implementação do primeiro reivindicante, para que a próxima página não precise
redescobri-las: `QAPage` fora (item 8), nós de aparição no topo do grafo
(itens 2 e 6), fonte única do veredito e o veredito como avaliação atribuída
(item 7), `WebSite.publisher` na organização (item 13), `ItemList` derivado dos
links da própria página (item 14), `logo` omitido enquanto não houver arquivo de
marca (item 3), bloqueio de robô não sendo ausência de perfil (item 4), e a
promoção dos itens 1, 2, 3, 5 e 6 da validação manual para o `npm run validate`
(item 17).

**1.0.** Versão original.
