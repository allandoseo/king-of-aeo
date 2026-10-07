<?php
/**
 * Aparencia: tokens de cor, CSS base e substituicao de template pelo tema.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 * ---------------------------
 * A primeira versao do checkout tinha cor fixa no codigo: acento magenta, campo
 * com fundo branco e texto quase preto. Funciona num tema claro e e um desastre
 * nos outros dois da rede, que sao escuros — campo branco em pagina #0f0f0f, com
 * o texto do rotulo invisivel. Nao era so "pouco personalizado": era ilegivel.
 *
 * E OS TEMAS NAO USAM O MESMO NOME DE VARIAVEL
 * --------------------------------------------
 * Nao da para simplesmente ler "--acento" do tema, porque cada um batizou do seu
 * jeito:
 *
 *   ahnovinha    --acento #fb016a   --superficie #fff      --tinta  --linha --raio
 *   diretorio-mix--red    #e01111   --panel      #1f1f1f   --ink    --line
 *   gatasprive   --roxo   #720eec   --superficie #1a1a1c   --texto  --linha --raio
 *   Blocksy      --theme-palette-color-1 ...
 *
 * COMO FUNCIONA
 * -------------
 * O plugin usa tokens proprios (--apix-acento, --apix-fundo, ...) e o valor
 * padrao de cada um e uma CADEIA de var() que tenta os nomes conhecidos, em
 * ordem, terminando num valor seguro:
 *
 *   --apix-acento: var(--acento, var(--red, var(--roxo, ... #b5176b)));
 *
 * Resultado: instalado em qualquer um dos tres temas, o checkout ja sai na cor
 * do site sem ninguem configurar nada. Em tema desconhecido, cai no padrao.
 *
 * E quando o dono quiser mandar: o campo de cor no painel grava o token direto,
 * e token explicito ganha da cadeia. Herdar e o padrao, nao a imposicao.
 *
 * SUBSTITUICAO DE TEMPLATE
 * ------------------------
 * Se o tema tiver anuncie-pix/checkout.php, ele e usado em vez do HTML embutido.
 * E o caminho para quem quer mexer no layout de verdade sem editar o plugin, que
 * perderia a alteracao na proxima atualizacao.
 */

if (!defined('ABSPATH')) exit;

/**
 * Os tokens, montados a partir das opcoes.
 *
 * Sai como bloco <style> com os tokens no escopo .apix — nao em :root, para o
 * plugin nao redefinir variavel do tema e mudar a cor do site inteiro.
 */
function apix_tokens() {
  $c = apix_config();

  // cadeias de heranca: do nome mais provavel ao mais generico
  $cadeias = [
    'acento'     => 'var(--acento, var(--red, var(--roxo, var(--theme-palette-color-1, #b5176b))))',
    'acento-esc' => 'var(--acento-esc, var(--red-d, var(--roxo-claro, var(--theme-palette-color-2, #8d1153))))',
    'fundo'      => 'var(--superficie, var(--panel, var(--fundo, var(--theme-palette-color-8, #fff))))',
    'fundo-2'    => 'var(--chip, var(--panel-3, var(--superficie-2, rgba(128,128,128,.10))))',
    'texto'      => 'var(--texto, var(--ink, var(--tinta, var(--theme-palette-color-4, #16181a))))',
    'texto-2'    => 'var(--texto-fraco, var(--text, var(--tinta-fraca, currentColor)))',
    'linha'      => 'var(--linha, var(--line, var(--theme-palette-color-6, rgba(128,128,128,.32))))',
    'raio'       => 'var(--raio, 8px)',
  ];

  // O painel manda quando preenchido — mas o valor e revalidado AQUI, na saida.
  //
  // apix_sanitiza() ja valida na entrada, e isso nao basta: a opcao pode ser
  // escrita por outro caminho (WP-CLI, outro plugin, migracao, banco direto) e
  // entao um valor cru cairia dentro deste bloco <style>. Validar onde o valor
  // SAI e o que de fato protege, porque e aqui que ele vira CSS.
  $cor     = apix_cor_valida($c['cor'] ?? '');
  $cor_esc = apix_cor_valida($c['cor_esc'] ?? '');

  if ($cor !== '')     $cadeias['acento']     = $cor;
  if ($cor_esc !== '') $cadeias['acento-esc'] = $cor_esc;

  // (int) resolve o raio: valor nao numerico vira 0, nunca texto solto no CSS
  if (($c['raio'] ?? '') !== '') $cadeias['raio'] = max(0, min(40, (int) $c['raio'])) . 'px';

  $linhas = '';
  foreach ($cadeias as $nome => $valor) {
    $linhas .= sprintf('--apix-%s:%s;', $nome, $valor);
  }

  // Contraste do texto sobre o botao. Nao da para calcular em CSS, e herdar o
  // texto do tema deixaria texto escuro sobre botao escuro. O padrao e branco,
  // que serve para quase todo acento saturado; quem usa acento claro (amarelo,
  // por exemplo) troca no painel.
  $sobre = apix_cor_valida($c['cor_botao'] ?? '');
  $linhas .= '--apix-sobre-acento:' . ($sobre !== '' ? $sobre : '#fff') . ';';

  return '<style id="apix-tokens">.apix{' . $linhas . '}</style>';
}

/**
 * CSS base do formulario, do checkout e da area. Embutido, uma vez por pagina.
 *
 * Nada de cor fixa aqui: tudo sai dos tokens. Herda a fonte da pagina, para o
 * bloco nao parecer colado de outro site.
 */
function apix_css() {
  static $saiu = false;
  if ($saiu) return '';
  $saiu = true;

  return apix_tokens() . '<style id="apix-css">
.apix{max-width:720px;margin:0 auto;font-family:inherit;font-size:1rem;color:var(--apix-texto)}
.apix *,.apix *::before,.apix *::after{box-sizing:border-box}
.apix h3{margin:1.6rem 0 .6rem;font-size:1.15rem}
.apix h4{margin:1.4rem 0 .5rem;font-size:1rem}
.apix label{display:block;margin:.9rem 0 .25rem;font-weight:600}
.apix input[type=text],.apix input[type=email],.apix input[type=tel],
.apix input[type=number],.apix textarea,.apix select{
  width:100%;padding:.65rem .75rem;font:inherit;line-height:1.4;
  color:var(--apix-texto);background:var(--apix-fundo);
  border:1px solid var(--apix-linha);border-radius:var(--apix-raio)}
.apix input:focus-visible,.apix textarea:focus-visible,.apix select:focus-visible{
  outline:2px solid var(--apix-acento);outline-offset:1px}
.apix textarea{min-height:9rem;resize:vertical}
.apix input[type=file]{width:100%;padding:.6rem;font:inherit;color:var(--apix-texto);
  background:var(--apix-fundo-2);border:1px dashed var(--apix-linha);border-radius:var(--apix-raio)}
.apix .apix-dica{font-size:.84rem;color:var(--apix-texto-2);opacity:.8;margin:.25rem 0 0}
.apix .apix-check{display:flex;gap:.55rem;align-items:flex-start;margin:.9rem 0;font-weight:400}
.apix .apix-check input{margin-top:.3rem;flex:0 0 auto;accent-color:var(--apix-acento)}
.apix .apix-planos{display:grid;gap:.7rem;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
.apix .apix-plano{display:block;border:2px solid var(--apix-linha);border-radius:var(--apix-raio);
  padding:.9rem;cursor:pointer;font-weight:400;background:var(--apix-fundo)}
.apix .apix-plano:has(input:checked){border-color:var(--apix-acento);
  background:color-mix(in srgb,var(--apix-acento) 8%,transparent)}
.apix .apix-plano input{accent-color:var(--apix-acento)}
.apix .apix-plano b{display:block;font-size:1.05rem}
.apix .apix-plano .apix-preco{display:block;font-size:1.3rem;font-weight:700;margin:.3rem 0;
  color:var(--apix-acento)}
.apix button,.apix .apix-botao{display:inline-block;margin-top:1.4rem;padding:.85rem 1.7rem;
  border:0;border-radius:var(--apix-raio);background:var(--apix-acento);
  color:var(--apix-sobre-acento);font:inherit;font-weight:700;line-height:1.3;
  text-decoration:none;cursor:pointer}
.apix button:hover,.apix .apix-botao:hover{background:var(--apix-acento-esc)}
.apix button:focus-visible{outline:2px solid var(--apix-texto);outline-offset:2px}
.apix .apix-erro{border-left:4px solid #c0392b;
  background:color-mix(in srgb,#c0392b 10%,transparent);
  padding:.8rem 1rem;margin:0 0 1.2rem;border-radius:0 var(--apix-raio) var(--apix-raio) 0}
.apix .apix-aviso{border-left:4px solid #e0a800;
  background:color-mix(in srgb,#e0a800 12%,transparent);
  padding:.8rem 1rem;margin:1rem 0;border-radius:0 var(--apix-raio) var(--apix-raio) 0;font-size:.9rem}
.apix .apix-erro ul,.apix .apix-aviso ul{margin:.4rem 0 0;padding-left:1.1rem}
.apix-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
@media(max-width:520px){
  .apix button,.apix .apix-botao{width:100%;text-align:center}
}
</style>';
}

/**
 * Carrega um template do tema, se existir.
 *
 * O tema pode criar anuncie-pix/checkout.php e receber tudo em $dados. Passar um
 * array em vez de extract() e deliberado: extract() em template despeja nomes
 * soltos no escopo e um deles acaba colidindo com variavel do tema, num bug que
 * aparece so em um site e ninguem liga a causa.
 *
 * Devolve string vazia quando o tema nao tem o arquivo.
 */
function apix_template($nome, $dados = []) {
  $arquivo = locate_template(['anuncie-pix/' . $nome . '.php']);
  if (!$arquivo) return '';

  ob_start();
  include $arquivo;
  return (string) ob_get_clean();
}

/**
 * Logo do checkout: a enviada no painel, ou a do proprio site.
 *
 * A logo do site vem primeiro como escolha natural — se o tema ja tem uma, o
 * checkout nao deveria pedir outra.
 */
function apix_logo_html() {
  $c = apix_config();
  if (empty($c['logo_mostrar'])) return '';

  if (!empty($c['logo'])) {
    return sprintf(
      '<p class="apix-logo"><img src="%s" alt="%s" height="48" loading="eager"></p>',
      esc_url($c['logo']),
      esc_attr(wp_specialchars_decode(get_bloginfo('name'), ENT_QUOTES))
    );
  }

  $id = (int) get_theme_mod('custom_logo');
  if ($id) {
    $url = wp_get_attachment_image_url($id, 'medium');
    if ($url) {
      return sprintf('<p class="apix-logo"><img src="%s" alt="%s" height="48" loading="eager"></p>',
        esc_url($url), esc_attr(wp_specialchars_decode(get_bloginfo('name'), ENT_QUOTES)));
    }
  }

  return '';
}

/**
 * Uma cor valida em hexadecimal, ou ''.
 *
 * O campo do painel e aberto e o valor entra direto num bloco <style>. Sem esta
 * conferencia, um valor com "}" fecharia a regra e o resto viraria CSS livre na
 * pagina — que e injecao de CSS, e CSS consegue bastante coisa: cobrir a tela,
 * trocar o texto de um botao, esconder um aviso.
 */
function apix_cor_valida($v) {
  $v = trim((string) $v);
  if ($v === '') return '';
  return preg_match('/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i', $v) ? strtolower($v) : '';
}
