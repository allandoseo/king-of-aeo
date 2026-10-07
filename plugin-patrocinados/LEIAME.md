# Plugin "Areas Patrocinadas"

Areas de banner para os sites da rede, com marcação de link patrocinado feita no código e não no painel.

Instalar por **Plugins → Adicionar novo → Enviar plugin**, enviando `areas-patrocinadas.zip`. Configurar em **Configurações → Áreas patrocinadas**.

Funciona com qualquer tema atual, inclusive Blocksy: usa só ganchos do núcleo do WordPress (`wp_body_open`, `the_content`, `get_footer`), nunca gancho próprio de tema — esses mudam de nome entre versões e quebram na atualização.

## Zonas

| Zona | Onde sai | Como carrega |
|---|---|---|
| **Topo** | Logo abaixo do cabeçalho, em todas as páginas | `loading="eager"` + `fetchpriority="low"` |
| **Meio do texto** | Dentro do post, depois do parágrafo escolhido | `loading="lazy"` |
| **Lateral** | Widget *Área patrocinada*, ou `[patrocinado]` | `loading="lazy"` |
| **Rodapé** | Fim do conteúdo, antes do rodapé do tema | `loading="lazy"` |

O shortcode aceita qualquer zona: `[patrocinado zona="rodape"]`.

## Decisões que não são à toa

- **Banner externo sai sempre com `rel="sponsored nofollow"`.** Não é chave de painel. Banner é espaço pago, e link pago seguido é esquema de links — a punição atinge os dois lados. Quem passa força é o link editorial no meio do texto, não a imagem repetida em todas as páginas.
- **Destino dentro do próprio site sai sem marcação nenhuma** e sem `target="_blank"`. Marcar link interno como patrocinado joga fora o rastreamento interno de força sem ganhar nada.
- **Largura e altura são obrigatórias.** Sem elas o navegador não sabe quanto espaço reservar, o conteúdo pula quando a imagem chega e o CLS vai embora — e CLS ruim é perda de posição, não detalhe de acabamento. Vaga sem medida simplesmente não aparece.
- **O CSS sai embutido no `<head>`, nunca em arquivo.** Arquivo de plugin aparece como `/wp-content/plugins/areas-patrocinadas/...` no HTML de toda página; o mesmo caminho repetido nos sites da rede é rastro pronto. São ~1 KB: embutido custa menos que a requisição que economiza.
- **CSS só sai quando há banner cadastrado.** Página sem anúncio não carrega CSS de anúncio.
- **Nada de seletor da biblioteca de mídia.** O seletor exige a `wp.media`, que é JS a mais no admin. O campo é de endereço: sobe a imagem em Mídia, copia a URL do arquivo, cola.
- **Rótulo "Publicidade" acima de cada bloco.** Identificar publicidade é exigência do CDC (art. 36), não cortesia. O campo pode ficar vazio, mas não deveria.
- **Sem contagem de cliques.** Gravaria no banco a cada visita, pesando o site, e cria tabela com nome próprio — mais um rastro. Quem precisa de número usa o painel do anunciante ou um encurtador.
- **Fora de feed, embed, REST, 404 e da página de política de privacidade**, além das páginas listadas em *Não mostrar em*.

## Anti-footprint na rede

Antes de instalar no segundo site, renomeie:

1. A pasta e o arquivo principal: `areas-patrocinadas/areas-patrocinadas.php` → outro nome.
2. O `Plugin Name:` no cabeçalho do arquivo.
3. O prefixo `apat_` / `APAT_` (funções, constantes, `id` do `<style>`) e as classes CSS `apat-*`. Um `sed` resolve:

```bash
sed -i 's/apat/xyz/g; s/APAT/XYZ/g' areas-patrocinadas.php inc/painel.php
```

Plugin idêntico, com o mesmo nome e as mesmas classes CSS, nos mesmos sites que linkam para o mesmo destino, é o tipo de coincidência que não passa por coincidência. O HTML não revela o nome do plugin, mas revela as classes CSS e o `id` do bloco de estilo.

## Empacotar

```bash
python3 empacota.py
```

Gera `areas-patrocinadas.zip` a partir de `plugin/`, com `/` como separador — o `Compress-Archive` do PowerShell grava `\` e o unzip do servidor Linux não entende.

## Checklist depois de ativar

1. Subir as imagens em **Mídia** e copiar a URL de cada arquivo.
2. **Configurações → Áreas patrocinadas**: preencher as vagas com medida real do arquivo.
3. **Aparência → Widgets**: adicionar *Área patrocinada* na lateral, se for usar a zona lateral.
4. Conferir no HTML publicado: `rel="sponsored nofollow noopener"` em todo banner externo.
5. Medir CLS antes e depois no PageSpeed Insights. Se subiu, a medida informada não é a medida real do arquivo.

## Pendente

- Vagas por categoria (banner de uma cidade só nos posts daquela cidade).
- Rotação entre dois ou mais criativos na mesma vaga.
