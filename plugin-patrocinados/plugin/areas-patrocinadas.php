<?php
/**
 * Plugin Name: Areas Patrocinadas
 * Description: Areas de banner (topo, meio do conteudo, lateral e rodape) com marcacao de link patrocinado, reserva de espaco para nao mexer o layout e rotulo de publicidade.
 * Version: 1.0
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Text Domain: areas-patrocinadas
 *
 * Por que plugin e nao tema: o tema do site e de terceiro e recebe atualizacao.
 * Banner dentro do tema volta a estaca zero na primeira atualizacao, e tema
 * filho so para colar quatro ganchos e peso desnecessario.
 *
 * Tres decisoes que nao sao de estilo:
 *
 * 1. O CSS sai embutido no <head>, nao em arquivo. Arquivo de plugin aparece
 *    como /wp-content/plugins/areas-patrocinadas/... no HTML de toda pagina, e
 *    o mesmo caminho repetido nos sites da rede e rastro pronto. Sao ~1 KB:
 *    embutido custa menos que a requisicao que ele economiza.
 *
 * 2. Banner externo sai SEMPRE com rel="sponsored nofollow". Nao e opcao de
 *    painel. Banner e espaco pago; link pago seguido e esquema de links, e a
 *    punicao atinge os dois lados. O destino certo para passar forca e o link
 *    editorial no meio do texto, nao a imagem repetida em todas as paginas.
 *
 * 3. Largura e altura sao obrigatorias por vaga. Sem elas o navegador nao sabe
 *    quanto espaco reservar, o conteudo pula quando a imagem chega e o CLS vai
 *    embora — e CLS ruim e perda de posicao, nao detalhe de acabamento.
 */

if (!defined('ABSPATH')) exit;

define('APAT_VER', '1.0');
define('APAT_VAGAS', 8);           // quantas vagas de banner existem no painel
define('APAT_OPCAO', 'apat_config');

/** Zonas disponiveis: chave => rotulo no painel. */
function apat_zonas() {
  return [
    'topo'    => 'Topo (abaixo do cabecalho)',
    'meio'    => 'Meio do texto (dentro do post)',
    'lateral' => 'Lateral (widget ou shortcode)',
    'rodape'  => 'Rodape (abaixo do conteudo)',
  ];
}

/** Configuracao salva, com os padroes preenchidos. */
function apat_config() {
  $padrao = [
    'rotulo'    => 'Publicidade',
    'paragrafo' => 3,     // depois de qual paragrafo entra a vaga "meio"
    'fora'      => '',    // IDs de paginas onde nada aparece
    'vagas'     => [],
  ];
  $c = get_option(APAT_OPCAO, []);
  if (!is_array($c)) $c = [];
  $c = array_merge($padrao, $c);
  if (!is_array($c['vagas'])) $c['vagas'] = [];
  return $c;
}

/** Uma vaga vazia, para o painel desenhar a linha. */
function apat_vaga_vazia() {
  return [
    'ativo'   => 0,
    'zona'    => 'topo',
    'imagem'  => '',
    'alt'     => '',
    'destino' => '',
    'largura' => 0,
    'altura'  => 0,
  ];
}

/**
 * Esta pagina recebe banner?
 *
 * Fora: feed, embed, REST e as paginas listadas no campo "Nao mostrar em".
 * Politica de privacidade e contato entram nessa lista por padrao de bom senso
 * — nao e lugar de anuncio e e onde o visitante vai quando desconfiou de algo.
 */
function apat_pode_exibir() {
  if (is_feed() || is_embed() || is_404()) return false;
  if (defined('REST_REQUEST') && REST_REQUEST) return false;
  if (wp_doing_ajax()) return false;

  $fora = array_filter(array_map('absint', preg_split('/[^0-9]+/', (string) apat_config()['fora'])));
  if ($fora && is_page($fora)) return false;

  $privacidade = (int) get_option('wp_page_for_privacy_policy');
  if ($privacidade && is_page($privacidade)) return false;

  return true;
}

/** Vagas ativas e completas de uma zona, na ordem do painel. */
function apat_banners($zona) {
  $saida = [];
  foreach (apat_config()['vagas'] as $v) {
    $v = array_merge(apat_vaga_vazia(), is_array($v) ? $v : []);
    if (!$v['ativo'] || $v['zona'] !== $zona) continue;
    if ($v['imagem'] === '' || $v['destino'] === '') continue;
    if ($v['largura'] < 1 || $v['altura'] < 1) continue;   // sem medida nao sai: ver decisao 3
    $saida[] = $v;
  }
  return $saida;
}

/**
 * O destino e do proprio site?
 *
 * Banner que aponta para uma pagina de casa nao e espaco pago e nao leva
 * sponsored — marcar link interno como patrocinado joga fora o proprio
 * rastreamento interno de forca sem ganho nenhum.
 */
function apat_eh_interno($url) {
  $casa = wp_parse_url(home_url(), PHP_URL_HOST);
  $alvo = wp_parse_url($url, PHP_URL_HOST);
  if (!$alvo) return true;                                  // caminho relativo
  return strtolower(preg_replace('#^www\.#i', '', $alvo))
      === strtolower(preg_replace('#^www\.#i', '', (string) $casa));
}

/** HTML de um banner. */
function apat_banner_html($v, $zona) {
  $interno = apat_eh_interno($v['destino']);

  // topo fica acima da dobra: lazy ali atrasa a imagem sem economizar nada.
  // fetchpriority baixo evita que o anuncio dispute banda com o LCP do texto.
  $carga = $zona === 'topo'
    ? ' loading="eager" fetchpriority="low"'
    : ' loading="lazy"';

  $img = sprintf(
    '<img src="%s" alt="%s" width="%d" height="%d" decoding="async"%s>',
    esc_url($v['imagem']),
    esc_attr($v['alt']),
    (int) $v['largura'],
    (int) $v['altura'],
    $carga
  );

  if ($interno) {
    return sprintf('<a class="apat-alvo" href="%s">%s</a>', esc_url($v['destino']), $img);
  }

  return sprintf(
    '<a class="apat-alvo" href="%s" rel="sponsored nofollow noopener" target="_blank">%s</a>',
    esc_url($v['destino']),
    $img
  );
}

/**
 * HTML de uma zona inteira. Devolve string vazia quando nao ha nada a mostrar,
 * para quem chama nao imprimir caixa vazia.
 */
function apat_bloco($zona) {
  if (!apat_pode_exibir()) return '';

  $banners = apat_banners($zona);
  if (!$banners) return '';

  $c = apat_config();

  // o aria-label nao acompanha o rotulo quando ele e apagado: aside sem nome
  // acessivel e so mais uma regiao anonima para quem usa leitor de tela.
  $nome = $c['rotulo'] !== '' ? $c['rotulo'] : 'Publicidade';

  $out = sprintf('<aside class="apat apat--%s" aria-label="%s">',
    esc_attr($zona), esc_attr($nome));

  if ($c['rotulo'] !== '') {
    $out .= sprintf('<span class="apat__rotulo">%s</span>', esc_html($c['rotulo']));
  }

  foreach ($banners as $v) {
    // o espaco ja fica reservado pelos atributos width/height da imagem, que o
    // navegador usa como aspect-ratio. Aqui so entra o teto de largura, para o
    // banner nao ser esticado acima do tamanho real do arquivo.
    $out .= sprintf('<div class="apat__vaga" style="max-width:%dpx">', (int) $v['largura']);
    $out .= apat_banner_html($v, $zona);
    $out .= '</div>';
  }

  return $out . '</aside>';
}

/* ----------------------------------------------------------------- estilo */
/**
 * CSS embutido, uma vez por pagina, e so quando ha banner para mostrar.
 * Pagina sem anuncio nao carrega CSS de anuncio.
 */
add_action('wp_head', function () {
  if (!apat_pode_exibir()) return;
  if (!apat_banners('topo') && !apat_banners('meio')
   && !apat_banners('lateral') && !apat_banners('rodape')) return;
  ?>
<style id="apat-css">
.apat{margin:1.75rem auto;text-align:center;max-width:100%}
.apat__rotulo{display:block;margin:0 0 .35rem;font-size:.66rem;letter-spacing:.09em;
  text-transform:uppercase;opacity:.55}
.apat__vaga{margin:0 auto .75rem;width:100%}
.apat__vaga>a{display:block}
.apat__vaga:last-child{margin-bottom:0}
.apat-alvo{display:block;line-height:0}
.apat-alvo img{display:block;width:100%;height:auto;border-radius:6px}
.apat--topo{margin-top:.9rem}
.apat--lateral{margin:0 0 1.5rem}
@media(prefers-reduced-motion:no-preference){
  .apat-alvo{transition:opacity .18s ease}
  .apat-alvo:hover{opacity:.88}
}
</style>
  <?php
}, 20);

/* ------------------------------------------------------------------ zonas */

/**
 * Topo. wp_body_open e gancho do nucleo e todo tema atual o dispara, entao
 * funciona sem depender de gancho proprio do tema — que muda de nome entre
 * versoes e quebra na atualizacao.
 */
add_action('wp_body_open', function () {
  echo apat_bloco('topo'); // phpcs:ignore WordPress.Security.EscapeOutput -- montado com esc_* acima
});

/**
 * Meio do texto.
 *
 * So em post aberto, so na consulta principal e so quando sobra texto depois
 * do ponto de insercao: banner colado no fim do artigo nao e "meio do texto",
 * e um segundo banner de rodape.
 */
add_filter('the_content', 'apat_meio_do_texto', 20);

function apat_meio_do_texto($html) {
  if (!is_singular() || !in_the_loop() || !is_main_query()) return $html;
  if (post_password_required()) return $html;

  $bloco = apat_bloco('meio');
  if ($bloco === '') return $html;

  $apos = max(1, (int) apat_config()['paragrafo']);
  $partes = explode('</p>', $html);

  // precisa de pelo menos dois paragrafos depois do banner
  if (count($partes) < $apos + 3) return $html;

  $antes  = array_slice($partes, 0, $apos);
  $depois = array_slice($partes, $apos);

  return implode('</p>', $antes) . '</p>' . $bloco . implode('</p>', $depois);
}

/**
 * Rodape. get_footer dispara antes do template do rodape carregar, entao o
 * banner cai no fim do conteudo e nao depois dos creditos — wp_footer sairia
 * la embaixo, fora do fluxo de leitura.
 */
add_action('get_footer', function () {
  echo apat_bloco('rodape'); // phpcs:ignore WordPress.Security.EscapeOutput
});

/** Lateral e qualquer lugar: [patrocinado] ou [patrocinado zona="rodape"]. */
add_shortcode('patrocinado', function ($atts) {
  $a = shortcode_atts(['zona' => 'lateral'], $atts, 'patrocinado');
  return isset(apat_zonas()[$a['zona']]) ? apat_bloco($a['zona']) : '';
});

/** Widget, para quem monta a lateral por Aparencia -> Widgets. */
class APAT_Widget extends WP_Widget {
  public function __construct() {
    parent::__construct('apat_widget', 'Area patrocinada', [
      'description' => 'Banners marcados como zona "Lateral".',
    ]);
  }
  public function widget($args, $instance) {
    $bloco = apat_bloco('lateral');
    if ($bloco === '') return;
    echo $args['before_widget'];
    if (!empty($instance['title'])) {
      echo $args['before_title'] . esc_html($instance['title']) . $args['after_title'];
    }
    echo $bloco; // phpcs:ignore WordPress.Security.EscapeOutput
    echo $args['after_widget'];
  }
  public function form($instance) {
    $t = isset($instance['title']) ? $instance['title'] : '';
    printf(
      '<p><label for="%1$s">Titulo (opcional)</label>
       <input class="widefat" id="%1$s" name="%2$s" type="text" value="%3$s"></p>',
      esc_attr($this->get_field_id('title')),
      esc_attr($this->get_field_name('title')),
      esc_attr($t)
    );
  }
  public function update($novo, $antigo) {
    return ['title' => sanitize_text_field($novo['title'] ?? '')];
  }
}
add_action('widgets_init', function () { register_widget('APAT_Widget'); });

// A limpeza na desinstalacao fica em uninstall.php, que o WordPress executa
// sozinho. register_uninstall_hook() grava na wp_options a cada carregamento de
// pagina, o que e uma escrita no banco por visita para nada.

/* ------------------------------------------------------------------ painel */
// so no admin: o front nao tem o que fazer com o formulario, e codigo carregado
// em toda visita e memoria gasta por nada.
if (is_admin()) require_once __DIR__ . '/inc/painel.php';
