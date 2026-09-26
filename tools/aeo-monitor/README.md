# AEO Monitor

Instrumento de medicao de citacao em answer engines. Roda fora do site: nada
daqui vai para `public/`.

## O que o servico e

Toda semana, um conjunto fixo de consultas e feito num conjunto fixo de
engines, em sessao nova e deslogada. O que cada um responde e anotado. O
cliente recebe um relatorio com cinco numeros e a serie deles no tempo:

1. quantas observacoes foram feitas, de quantas planejadas;
2. em quantas a marca foi nomeada;
3. em quantas a resposta citou algum link;
4. em quantas o link citado era nosso;
5. em quantas a entidade foi resolvida, isto e, o engine tratou a marca como
   coisa conhecida em vez de repetir a string da pergunta.

As tres ultimas sao coisas diferentes e viram linhas diferentes. Ser mencionado
nao custa nada ao engine; ser citado com link significa que ele se comprometeu
com uma fonte; resolver a entidade e o unico que indica que ele sabe de quem se
trata. Relatorio que junta as tres num numero so esconde o que interessa.

## O que o servico nao e

Nao promete posicao, nao promete citacao e nao promete prazo. Respostas de IA
sao nao deterministas: a mesma pergunta devolve fontes diferentes em dias
diferentes, em paises diferentes e em contas diferentes. Quem promete resultado
aqui esta vendendo o que nao controla.

O que o servico entrega e medicao honesta e repetivel. O valor esta em saber o
que esta acontecendo, com serie temporal, em vez de adivinhar.

## Por que nao e um scraper

Em 25 e 26 de setembro de 2026, montando o citation log do kingofaeo.pro, isto
foi o que aconteceu ao tentar automatizar:

- Claude exige conta, sem uso deslogado;
- Gemini respondeu uma vez e depois parou de aceitar envio;
- Bing devolveu pagina de bloqueio com 216 caracteres;
- google.com.br devolveu CAPTCHA;
- o ChatGPT deu duas respostas diferentes para o mesmo prompt com minutos de
  diferenca.

Um scraper nessas condicoes nao produz dado: produz dado falso com aparencia de
dado. Bloqueio de bot vira "nenhum nome retornado" e ninguem percebe seis meses
depois, quando o relatorio ja foi apresentado.

Por isso o instrumento nao consulta engine nenhum. Ele planeja a rodada, recusa
o arquivo se a disciplina foi quebrada e escreve o relatorio. O operador humano
roda e anota. O produto e a disciplina e o registro, nao a automacao.

Isso tambem e o que torna o servico dificil de copiar: qualquer um escreve um
scraper, e quase ninguem mantem uma serie honesta por seis meses.

## Como rodar

    node tools/aeo-monitor/monitor.mjs runsheet <cliente>
    node tools/aeo-monitor/monitor.mjs check    <cliente>
    node tools/aeo-monitor/monitor.mjs report   <cliente>

- `runsheet` imprime a lista do que rodar nesta semana, na ordem, com caixas
  para marcar. Uma linha por consulta, engine e locale.
- `check` valida `observations/<cliente>.csv` e mostra a cobertura por rodada.
  Ele PARA em: data fora do formato, engine ou locale fora da lista do cliente,
  consulta fora da lista fixa, yes/no invalido, link sem dominio, dominio sem
  link, marca nomeada sem nome, e duas observacoes da mesma combinacao na mesma
  rodada.
- `report` escreve `reports/<cliente>-<data>.md`, comparando com a rodada
  anterior.

Engine que bloquear, exigir conta ou travar **nao vira linha**. A ausencia
aparece na secao "Nao observado nesta rodada" do relatorio. Ausencia de
observacao nao e ausencia de resultado, e a diferenca entre as duas e o que
separa este relatorio de um chute com tabela.

## Configurar um cliente

Copie `clients/seomais.json`, renomeie para o slug do cliente e edite. O slug
do arquivo e o slug dos comandos.

As consultas sao **fixas**. O validador recusa observacao com consulta fora da
lista, de proposito: mudar a lista no meio quebra a comparabilidade da serie, e
tem que ser uma decisao, nao um acidente de digitacao.

Escolha consultas que um cliente real digitaria, neutras, **sem o nome da marca
dentro**. Consulta que ja contem a resposta devolve a resposta, e nao mede nada.

`own_domains` separa "citou algum link" de "citou o nosso link".

## Arquivos

    clients/<cliente>.json        marca, dominios proprios, consultas, engines, locales
    observations/<cliente>.csv    as observacoes. Escrito a mao, uma linha por observacao
    reports/<cliente>-<data>.md   o relatorio. Gerado, nunca editado a mao

`observations/seomais.csv` vem com cabecalho e comentarios e **nenhuma linha de
dado**, de proposito. Linha so entra aqui depois de alguem rodar a consulta e
ver a resposta. `reports/` vem vazio pela mesma razao: relatorio sem observacao
seria numero inventado, e o comando `report` recusa rodar sem observacao.

O relatorio em `reports/` e o que vai para o cliente.

## Cadencia e leitura

Uma rodada por semana, no mesmo dia. Uma leitura isolada e anedota; a serie e
que informa. Tres rodadas ja mostram tendencia; seis respondem se os engines
convergem ou divergem ao longo do tempo.

Cobertura parcial e normal e nao e defeito: e o estado real do acesso a esses
sistemas. O relatorio diz quanto foi coberto, e isso tambem e informacao para o
cliente.
