# Tema "Ah Novinha"

Tema WordPress clássico, sem build. Instalar por **Aparência → Temas → Adicionar novo → Enviar tema** e ativar.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `style.css` | Todo o CSS. Variáveis de cor em `:root`, no topo. |
| `functions.php` | Suportes, menus, Customizer, tempo de leitura, limpeza do `<head>`. |
| `header.php` | Faixa preta 18+, marca/logo, menu principal. |
| `footer.php` | Três colunas + aviso legal. |
| `index.php` | Home e busca. Na primeira página o post mais recente vira destaque. |
| `single.php` | Post aberto, com anterior/próximo. |
| `page.php` | Página comum, coluna única e larga, sem lateral. |
| `archive.php` | Categoria, tag, data. |
| `404.php` | Erro 404 com busca e posts recentes. |
| `sidebar.php` | Busca, categorias, mais recentes, área de widget opcional. |
| `searchform.php` | Formulário de busca. |
| `template-parts/card.php` | Card do post na grade. |
| `template-parts/portao-idade.php` | Portão 18+. |

## Depois de ativar

1. **Configurações → Geral** — nome e descrição do site. A marca no topo usa o nome: a primeira palavra fica preta, o resto no tom de acento. Sem logo enviada, é esse texto que aparece.
2. **Aparência → Menus** — criar *Principal (topo)* e *Links úteis (rodapé)*.
3. **Aparência → Personalizar** — seções novas: *Topo do site*, *Portão 18+*, *Rodapé*.
4. **Configurações → Links permanentes** — usar "Nome do post". Nunca deixar no padrão com `?p=123`.
5. **Posts → Categorias** — apagar a "Sem categoria" depois de criar as reais.

## Portão 18+

O conteúdo da página é **sempre** entregue no HTML, para todo mundo. O portão é só uma camada por cima, revelada pelo JavaScript apenas para quem ainda não confirmou.

Isso é de propósito: buscador não executa esse JS, recebe a página inteira, e ninguém vê conteúdo diferente de ninguém. Servir uma coisa para o Google e outra para o visitante é cloaking, e é motivo de punição. **Não trocar esse mecanismo por um redirecionamento no servidor.**

A confirmação fica 30 dias, em `localStorage` com cookie como reserva.

## Cores

Trocar no `:root` do `style.css`:

```css
--acento:#b5176b;      /* magenta: botões, etiquetas, links */
--acento-esc:#8d1153;  /* o mesmo, mais escuro, para hover */
--tinta:#1b1419;       /* texto e faixa preta do topo */
--fundo-alt:#f7f3f5;   /* fundo dos títulos de caixa */
```

## Decisões que não são à toa

- **Não parece com os outros temas da rede.** Serifada no título, fundo claro, grade de cards, prefixo `ahn-`. Tema repetido entre sites da mesma rede é footprint.
- **Sem bloco de links fixo** no rodapé ou na lateral.
- **Card sem imagem destacada omite a capa** em vez de mostrar retângulo vazio.
- **`<head>` limpo**: sem `generator`, sem RSD/WLW, sem script de emoji.
- **CSS versionado pelo `filemtime`**: editou o arquivo, o navegador pega na hora, sem limpar cache.

## Pendente

- Criar as páginas Sobre, Contato e Política de privacidade.
- Definir as categorias reais.
- Enviar uma logo, se for usar imagem no lugar do texto.
