# Tema "Diretorio Mix" — instruções para Claude Code

Tema WordPress clássico (PHP, sem build). Copie a pasta `theme/` para `wp-content/themes/diretorio-mix/` e ative.

## Estrutura
- `functions.php` — CPT `perfil`, taxonomia hierárquica `local` (Estado > Cidade), metas `dmix_tel`, `dmix_wpp`, `dmix_vip`, `dmix_destaque`, menus `principal` e `rodape`, helper `dmix_query()`.
- `header.php` — faixa vermelha listrada, logo, menu, 4 fotos inclinadas (perfis com Destaque).
- `sidebar.php` — busca + lista de Estados (termos raiz de `local`).
- `index.php` — home, arquivo de estado/cidade e busca: seções VIP (cards grandes), Destaques (grade) e Todos (grade 4 col).
- `single-perfil.php` — página do perfil.
- `template-parts/card-vip.php`, `card-grid.php`.
- `style.css` — todo o CSS; variáveis em `:root`.

## Próximos passos sugeridos
1. Adicionar portão de confirmação de idade 18+ (modal + cookie) se o conteúdo for adulto.
2. Galeria de fotos no perfil (campo de galeria / ACF).
3. Customizer: logo, texto do disclaimer (`dmix_disclaimer`), cores.
4. Paginação na grade "Todos".
5. Página "Anunciar" com formulário.

## Setup rápido
Criar termos de Estado (Acre … São Paulo) e cidades filhas; criar menus Principal (Início, Anunciar, Contato) e Rodapé.
