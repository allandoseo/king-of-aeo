# kingofaeo.pro
Página estática única (index.html + robots.txt + sitemap.xml) no Cloudflare Pages, projeto `kingofaeo`.
Deploy: `wrangler pages deploy . --project-name=kingofaeo --branch=main`
Regras: manter "king of aeo" abaixo de 1% e "aeo" abaixo de 2,2% de densidade no texto visível. Toda edição de conteúdo atualiza dateModified no JSON-LD, o "Updated" visível na byline e o <lastmod> do sitemap.xml para a mesma data. Nunca deployar com [FILL] ou VIDEO_ID_ no arquivo. Não criar páginas novas sem pedido explícito.
