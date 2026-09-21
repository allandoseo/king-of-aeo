<?php
/**
 * Tema "Gatas Prive" — diretorio de uma cidade so.
 *
 * Decisao de estrutura que explica o resto do arquivo: como o site atende um
 * unico municipio, nao existe hierarquia estado > cidade. A taxonomia e BAIRRO,
 * plana. Isso corta URL, menu, consulta e manutencao — e e o que torna o site
 * barato. Se um dia precisar de outra cidade, o certo e outro site, nao
 * remendar hierarquia aqui.
 */

if (!defined('ABSPATH')) exit;

define('GP_VER', '1.0');
define('GP_PARCEIROS', 10);   // quantas vagas de link parceiro existem

/**
 * Vagas de parceiro preenchidas, na ordem.
 *
 * Tolerante de proposito: e facil colar o endereco no campo Nome. Em vez de
 * sumir com o link em silencio, o codigo se vira — endereco no campo Nome vira
 * o link, e o texto sai do dominio.
 */
function gp_parceiros() {
  $saida = [];
  for ($i = 1; $i <= GP_PARCEIROS; $i++) {
    $nome = trim((string) get_theme_mod("gp_parceiro_{$i}_nome", ''));
    $url  = trim((string) get_theme_mod("gp_parceiro_{$i}_url", ''));

    if ($url === '' && preg_match('#^(https?://|www\.)#i', $nome)) { $url = $nome; $nome = ''; }
    if ($url === '') continue;
    if (strpos($url, '//') === false) $url = 'https://' . ltrim($url, '/');

    if ($nome === '' || preg_match('#^(https?://|www\.)#i', $nome)) {
      $host = parse_url($url, PHP_URL_HOST);
      $nome = $host ? preg_replace('#^www\.#i', '', $host) : $url;
    }
    $saida[] = ['nome' => $nome, 'url' => $url];
  }
  return $saida;
}

/* ---------------------------------------------------------------- suporte */
add_action('after_setup_theme', function () {
  add_theme_support('title-tag');
  add_theme_support('post-thumbnails');
  add_theme_support('automatic-feed-links');
  add_theme_support('html5', ['search-form', 'caption', 'gallery', 'style', 'script']);
  add_theme_support('custom-logo', ['height' => 62, 'width' => 320, 'flex-height' => true, 'flex-width' => true]);
  register_nav_menus(['rodape' => 'Links do rodape']);

  add_image_size('gp-card', 600, 800, true);    // 3:4, o card da grade
  add_image_size('gp-dest', 160, 160, true);    // avatar redondo
  add_image_size('gp-grande', 1200, 900, false);
});

/* ------------------------------------------------------------ css e fonte */
add_action('wp_enqueue_scripts', function () {
  wp_enqueue_style('gp-fontes',
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap', [], null);

  $css = get_stylesheet_directory() . '/style.css';
  wp_enqueue_style('gp', get_stylesheet_uri(), [], file_exists($css) ? filemtime($css) : GP_VER);

  if (is_singular('perfil')) {
    $js = get_theme_file_path('js/galeria.js');
    wp_enqueue_script('gp-galeria', get_theme_file_uri('js/galeria.js'), [],
      file_exists($js) ? filemtime($js) : GP_VER, true);
  }

  // rolagem infinita: so nas listagens
  if (!is_singular() && !is_404()) {
    $jr = get_theme_file_path('js/rolagem.js');
    wp_enqueue_script('gp-rolagem', get_theme_file_uri('js/rolagem.js'), [],
      file_exists($jr) ? filemtime($jr) : GP_VER, true);
  }
});

/* ------------------------------------------------ tipo de conteudo e taxonomias */
add_action('init', function () {

  register_post_type('perfil', [
    'label'         => 'Anuncios',
    'labels'        => [
      'name'          => 'Anuncios',
      'singular_name' => 'Anuncio',
      'add_new_item'  => 'Novo anuncio',
      'edit_item'     => 'Editar anuncio',
      'search_items'  => 'Buscar anuncios',
    ],
    'public'        => true,
    'has_archive'   => 'acompanhantes',
    'menu_icon'     => 'dashicons-heart',
    'menu_position' => 5,
    'rewrite'       => ['slug' => 'acompanhante', 'with_front' => false],
    'supports'      => ['title', 'editor', 'thumbnail', 'excerpt'],
    'show_in_rest'  => true,
  ]);

  // bairro: plana de proposito, nao hierarquica
  register_taxonomy('bairro', 'perfil', [
    'label'        => 'Bairros',
    'hierarchical' => false,
    'public'       => true,
    'rewrite'      => ['slug' => 'acompanhantes', 'with_front' => false],
    'show_in_rest' => true,
    'show_admin_column' => true,
  ]);

});

/* --------------------------------------------------------------- helpers */

/** Campos do anuncio, na ordem em que saem no painel lateral. */
function gp_campos() {
  return [
    'gp_idade'   => 'Idade',
    'gp_altura'  => 'Altura',
    'gp_atende'  => 'Atende',
    'gp_horario' => 'Horario',
    'gp_cache'   => 'Cache',
  ];
}

/** So os numeros do WhatsApp; vazio quando nao houver. */
function gp_whatsapp($post_id = null) {
  $n = preg_replace('/\D/', '', (string) get_post_meta($post_id ? $post_id : get_the_ID(), 'gp_wpp', true));
  if ($n === '') return '';
  if (strlen($n) <= 11) $n = '55' . $n;   // sem DDI, assume Brasil
  return $n;
}

/** Primeiro bairro do anuncio. */
function gp_bairro($post_id = null) {
  $t = get_the_terms($post_id ? $post_id : get_the_ID(), 'bairro');
  return (!$t || is_wp_error($t)) ? null : $t[0];
}

/**
 * Fotos do anuncio: as imagens anexadas a ele. O fluxo e criar o anuncio,
 * subir as fotos nele e publicar — sem bloco de galeria, sem campo extra.
 * A destacada fica de fora porque ja e a capa na grade.
 */
function gp_fotos($post_id = null) {
  $post_id = $post_id ? $post_id : get_the_ID();
  $fotos = get_children([
    'post_parent'    => $post_id,
    'post_type'      => 'attachment',
    'post_mime_type' => 'image',
    'orderby'        => 'menu_order ID',
    'order'          => 'ASC',
    'numberposts'    => -1,
  ]);
  $capa = (int) get_post_thumbnail_id($post_id);
  if ($capa && isset($fotos[$capa])) unset($fotos[$capa]);
  return $fotos;
}

/** Capa: a destacada, ou a primeira foto. Evita card vazio por esquecimento. */
function gp_capa_id($post_id = null) {
  $post_id = $post_id ? $post_id : get_the_ID();
  $capa = (int) get_post_thumbnail_id($post_id);
  if ($capa) return $capa;
  $fotos = gp_fotos($post_id);
  if (!$fotos) return 0;
  $p = reset($fotos);
  return (int) $p->ID;
}

function gp_e_destaque($post_id = null) {
  return get_post_meta($post_id ? $post_id : get_the_ID(), 'gp_destaque', true) === '1';
}

/** Consulta padrao da grade. */
function gp_consulta($args = []) {
  return new WP_Query(array_merge([
    'post_type'      => 'perfil',
    'posts_per_page' => 24,
    'post_status'    => 'publish',
  ], $args));
}

/**
 * Paginacao: um link de verdade para a proxima pagina.
 *
 * O JavaScript dispara esse link sozinho quando a pessoa chega perto do fim —
 * visualmente vira rolagem infinita. Mas o link continua no HTML, entao o
 * buscador consegue percorrer a corrente de paginas e indexar o acervo inteiro.
 * Rolagem infinita pura, sem link, deixa so a primeira leva no indice.
 *
 * Se o JavaScript falhar, o botao continua ali e funciona no clique.
 */
function gp_paginacao($q = null) {
  global $wp_query;
  $alvo  = $q ? $q : $wp_query;
  $pagina = max(1, (int) get_query_var('paged'));
  if ($pagina >= (int) $alvo->max_num_pages) return;

  $proxima = get_pagenum_link($pagina + 1);
  ?>
  <nav class="gp-pag" aria-label="Mais anuncios">
    <a class="gp-pag__mais" href="<?php echo esc_url($proxima); ?>" rel="next">
      <span>Carregar mais</span>
    </a>
  </nav>
  <?php
}

/* --------------------------------------------------------- campos no admin */
add_action('add_meta_boxes', function () {
  add_meta_box('gp_dados', 'Dados do anuncio', function ($post) {
    wp_nonce_field('gp_salva', 'gp_nonce');
    $v = function ($k) use ($post) { return esc_attr(get_post_meta($post->ID, $k, true)); };

    echo '<p><label><strong>WhatsApp</strong><br>';
    echo '<input name="gp_wpp" value="' . $v('gp_wpp') . '" class="widefat" ';
    echo 'placeholder="62 99999-9999"></label>';
    echo '<span class="description">So numeros ou com formatacao; o tema limpa. '
       . 'Sem DDI, assume 55.</span></p>';

    foreach (gp_campos() as $k => $rotulo) {
      echo '<p><label><strong>' . esc_html($rotulo) . '</strong><br>';
      echo '<input name="' . esc_attr($k) . '" value="' . $v($k) . '" class="widefat"></label></p>';
    }

    echo '<p><label><input type="checkbox" name="gp_destaque" value="1" ';
    echo checked($v('gp_destaque'), '1', false) . '> <strong>Destaque</strong></label><br>';
    echo '<span class="description">Aparece na faixa de cima e ganha selo no card.</span></p>';
  }, 'perfil', 'side', 'high');
});

add_action('save_post_perfil', function ($id) {
  if (!isset($_POST['gp_nonce']) || !wp_verify_nonce($_POST['gp_nonce'], 'gp_salva')) return;
  if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;
  if (!current_user_can('edit_post', $id)) return;

  update_post_meta($id, 'gp_wpp', preg_replace('/[^0-9+ ()-]/', '', $_POST['gp_wpp'] ?? ''));
  foreach (array_keys(gp_campos()) as $k) {
    update_post_meta($id, $k, sanitize_text_field($_POST[$k] ?? ''));
  }
  update_post_meta($id, 'gp_destaque', isset($_POST['gp_destaque']) ? '1' : '');
});

/* ------------------------------------------------------------ Customizer */
add_action('customize_register', function ($wp) {

  $wp->add_section('gp_geral', ['title' => 'Site', 'priority' => 25]);
  if ($wp->get_control('custom_logo')) {
    $wp->get_control('custom_logo')->section  = 'gp_geral';
    $wp->get_control('custom_logo')->priority = 5;
  }

  $wp->add_setting('gp_cidade', ['default' => 'Goiania', 'sanitize_callback' => 'sanitize_text_field']);
  $wp->add_control('gp_cidade', [
    'label' => 'Cidade', 'description' => 'Usada nos titulos e nas etiquetas dos cards.',
    'type' => 'text', 'section' => 'gp_geral',
  ]);

  $wp->add_setting('gp_tagline', [
    'default' => 'Acompanhantes em Goiania', 'sanitize_callback' => 'sanitize_text_field',
  ]);
  $wp->add_control('gp_tagline', [
    'label' => 'Linha sob a marca', 'type' => 'text', 'section' => 'gp_geral',
  ]);

  $wp->add_setting('gp_intro', ['default' => '', 'sanitize_callback' => 'wp_kses_post']);
  $wp->add_control('gp_intro', [
    'label' => 'Texto de abertura da home',
    'description' => 'A caixa no alto. Nas paginas de bairro o tema usa a descricao do bairro.',
    'type' => 'textarea', 'section' => 'gp_geral',
  ]);

  $wp->add_setting('gp_wpp_anuncio', ['default' => '', 'sanitize_callback' => 'sanitize_text_field']);
  $wp->add_control('gp_wpp_anuncio', [
    'label' => 'WhatsApp para anunciar',
    'description' => 'Para onde vai o botao "Publicar anuncio". Vazio, o botao aponta '
                   . 'para a pagina /anunciar/.',
    'type' => 'text', 'section' => 'gp_geral',
  ]);

  $wp->add_setting('gp_disclaimer', [
    'default'           => 'Conteudo destinado a maiores de 18 anos. O site divulga anuncios de '
                         . 'terceiros e nao intermedia, agencia ou se responsabiliza por servicos '
                         . 'combinados entre as partes.',
    'sanitize_callback' => 'wp_kses_post',
  ]);
  $wp->add_control('gp_disclaimer', [
    'label' => 'Aviso do rodape', 'type' => 'textarea', 'section' => 'gp_geral',
  ]);

  /* ---- links parceiros ---- */
  $wp->add_section('gp_parceiros', [
    'title'       => 'Links parceiros',
    'priority'    => 28,
    'description' => 'Ate 10 links. Vagas vazias nao aparecem. Saem seguidos, passando '
                   . 'forca ao destino. So na home por padrao: bloco de links repetido em '
                   . 'todas as paginas e rastro de rede, e com link seguido pesa mais ainda.',
  ]);

  $wp->add_setting('gp_parceiros_titulo', [
    'default' => 'Parceiros', 'sanitize_callback' => 'sanitize_text_field',
  ]);
  $wp->add_control('gp_parceiros_titulo', [
    'label' => 'Titulo do bloco', 'type' => 'text', 'section' => 'gp_parceiros',
  ]);

  $wp->add_setting('gp_parceiros_pago', ['default' => false, 'sanitize_callback' => 'wp_validate_boolean']);
  $wp->add_control('gp_parceiros_pago', [
    'label'       => 'Marcar como patrocinado',
    'description' => 'Ligue quando houver dinheiro, permuta ou troca combinada. Acrescenta '
                   . 'rel="sponsored nofollow". Link pago seguido e esquema de links, e a '
                   . 'punicao atinge os dois sites.',
    'type' => 'checkbox', 'section' => 'gp_parceiros',
  ]);

  $wp->add_setting('gp_parceiros_tudo', ['default' => false, 'sanitize_callback' => 'wp_validate_boolean']);
  $wp->add_control('gp_parceiros_tudo', [
    'label' => 'Mostrar em todas as paginas',
    'description' => 'Desmarcado (recomendado), aparece so na home.',
    'type' => 'checkbox', 'section' => 'gp_parceiros',
  ]);

  for ($i = 1; $i <= GP_PARCEIROS; $i++) {
    $wp->add_setting("gp_parceiro_{$i}_nome", ['default' => '', 'sanitize_callback' => 'sanitize_text_field']);
    $wp->add_control("gp_parceiro_{$i}_nome", [
      'label' => "{$i}. Nome (o texto que aparece)", 'type' => 'text', 'section' => 'gp_parceiros',
    ]);
    $wp->add_setting("gp_parceiro_{$i}_url", ['default' => '', 'sanitize_callback' => 'esc_url_raw']);
    $wp->add_control("gp_parceiro_{$i}_url", [
      'label' => "{$i}. Endereco (https://...)", 'type' => 'url', 'section' => 'gp_parceiros',
    ]);
  }

  /* ---- portao 18+ ---- */
  $wp->add_section('gp_idade', [
    'title' => 'Portao 18+', 'priority' => 26,
    'description' => 'Desligado por padrao. Ligado, o aviso aparece so para quem ainda nao '
                   . 'confirmou — o conteudo da pagina continua indo inteiro no HTML, entao o '
                   . 'buscador ve o mesmo que o visitante.',
  ]);
  $wp->add_setting('gp_idade_ativo', ['default' => false, 'sanitize_callback' => 'wp_validate_boolean']);
  $wp->add_control('gp_idade_ativo', [
    'label' => 'Mostrar o portao 18+', 'type' => 'checkbox', 'section' => 'gp_idade',
  ]);
  $wp->add_setting('gp_idade_saida', [
    'default' => 'https://www.google.com.br', 'sanitize_callback' => 'esc_url_raw',
  ]);
  $wp->add_control('gp_idade_saida', [
    'label' => 'Para onde vai quem clica em Sair', 'type' => 'url', 'section' => 'gp_idade',
  ]);

  /* ---- verificacao ---- */
  $wp->add_section('gp_verificacao', ['title' => 'Verificacao do Google', 'priority' => 27]);
  $wp->add_setting('gp_google_verify', ['default' => '', 'sanitize_callback' => 'sanitize_text_field']);
  $wp->add_control('gp_google_verify', [
    'label' => 'google-site-verification',
    'description' => 'So o codigo. O Yoast tem campo igual; use um ou outro, nunca os dois.',
    'type' => 'text', 'section' => 'gp_verificacao',
  ]);
});

add_action('wp_head', function () {
  $c = trim((string) get_theme_mod('gp_google_verify', ''));
  if ($c === '') return;
  printf('<meta name="google-site-verification" content="%s" />' . "\n", esc_attr($c));
}, 1);

/* -------------------------------------------- busca so nos anuncios */
add_action('pre_get_posts', function ($q) {
  if (is_admin() || !$q->is_main_query()) return;

  if ($q->is_search()) $q->set('post_type', 'perfil');

  // destaque primeiro em toda listagem: e o que o anunciante paga para ter
  if ($q->is_post_type_archive('perfil') || $q->is_tax('bairro')) {
    $q->set('posts_per_page', 24);
    gp_ordena_destaque($q);
  }
});

/* ---------------------------------------------- home mostra os anuncios */
// Sem pagina estatica e sem posts: a home e o arquivo de anuncios.
add_action('pre_get_posts', function ($q) {
  if (is_admin() || !$q->is_main_query()) return;
  if (!$q->is_home() || $q->is_page()) return;
  $q->set('post_type', 'perfil');
  $q->set('posts_per_page', 24);
  gp_ordena_destaque($q);
});

/**
 * Destaque primeiro, sem perder quem nao tem o campo.
 *
 * Usar so meta_key no WP_Query faz o WordPress montar um INNER JOIN com a
 * tabela de metas, e aí todo anuncio que nunca teve o campo "Destaque" gravado
 * some da listagem. O meta_query com EXISTS / NOT EXISTS em OR mantem todos e
 * ainda permite ordenar pelo valor.
 */
function gp_ordena_destaque($q) {
  $q->set('meta_query', [
    'relation' => 'OR',
    'com'  => ['key' => 'gp_destaque', 'compare' => 'EXISTS'],
    'sem'  => ['key' => 'gp_destaque', 'compare' => 'NOT EXISTS'],
  ]);
  $q->set('orderby', ['com' => 'DESC', 'date' => 'DESC']);
}

/* ------------------------------------------------------- limpeza do head */
remove_action('wp_head', 'wp_generator');
remove_action('wp_head', 'wlwmanifest_link');
remove_action('wp_head', 'rsd_link');
remove_action('wp_head', 'wp_shortlink_wp_head');
add_filter('the_generator', '__return_empty_string');
remove_action('wp_head', 'print_emoji_detection_script', 7);
remove_action('wp_print_styles', 'print_emoji_styles');

/* ----------------------------------- regravar regras ao mexer em taxonomia */
foreach (['created_bairro', 'edited_bairro', 'delete_bairro'] as $gp_gatilho) {
  add_action($gp_gatilho, function () { flush_rewrite_rules(false); });
}
add_action('after_switch_theme', function () { flush_rewrite_rules(false); });
