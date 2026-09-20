# kingofaeo.pro
Site estático no Cloudflare Pages, projeto `kingofaeo`: `index.html` (home, editada à mão), `feed/index.html` (feed de imagens, **gerado**), `robots.txt`, `sitemap.xml` (**gerado**), `_redirects`, `img/`.
Deploy: `wrangler pages deploy . --project-name=kingofaeo --branch=main`

Regras: manter "king of aeo" abaixo de 1% e "aeo" abaixo de 2,2% de densidade no texto visível. Toda edição de conteúdo atualiza dateModified no JSON-LD, o "Updated" visível na byline e o `<lastmod>` do sitemap.xml para a mesma data. Nunca deployar com [FILL] ou VIDEO_ID_ no arquivo. Não criar páginas novas sem pedido explícito.

## Feed de imagens (/feed/)
`feed/index.html` e `sitemap.xml` são gerados — **nunca editar à mão**, a próxima build sobrescreve.

Quando uma imagem nova aparecer em `img/`:
1. Olhar a imagem de verdade (tool Read) antes de escrever qualquer texto — alt e descrição têm que bater com o que está na figura.
2. Adicionar a entrada em `tools/feed-manifest.json`: `file`, `id` único, `title`, `tile` (rótulo curto do mosaico), `keyword` (palavra-chave semântica da imagem), `terms` (variações semânticas), `alt`, `caption`, `text`, `anchor` (âncora da home para onde a imagem aponta; vazio = home), `anchor_label`, `on_home` (true só se a imagem também estiver na home).
3. Rodar `python tools/build_feed.py` e deployar.

A build aborta sozinha se: alguma imagem de `img/` não tiver entrada no manifesto, algum campo obrigatório estiver vazio ou com placeholder, ou a densidade estourar o limite. `--check` valida sem escrever; `--date AAAA-MM-DD` força a data.
