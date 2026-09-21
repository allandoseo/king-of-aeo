<?php
/**
 * Tema "Ah Novinha" — blog.
 * Sem build, sem framework. Tudo que o site precisa esta aqui e nos templates.
 */

if (!defined('ABSPATH')) exit;

define('AHN_VER', '1.0');
define('AHN_PARCEIROS', 10);   // quantas vagas de link parceiro existem
// o padrao vive numa constante porque e lido em dois lugares: no registro do
// Customizer e na impressao da meta. Se os dois nao casarem, a meta some
// enquanto ninguem salvar o campo — foi exatamente o que aconteceu.
define('AHN_GSC_PADRAO', 'dmZRaI84dO1gXHisp5RbqRRO3PU9NhdSgkIt2dyfj00');

/**
 * Devolve as vagas de parceiro preenchidas, na ordem.
 *
 * Tolerante de proposito: e facil colar o endereco no campo Nome, ou escrever
 * o nome no campo Endereco. Em vez de sumir com o link em silencio, o codigo
 * se vira:
 *   - endereco no campo Nome  -> vira o link, e o nome sai do dominio
 *   - so o endereco preenchido -> idem
 *   - so o nome preenchido     -> ignora, porque nao da para adivinhar o destino
 */
function ahn_parceiros() {
  $saida = [];
  for ($i = 1; $i <= AHN_PARCEIROS; $i++) {
    $nome = trim((string) get_theme_mod("ahn_parceiro_{$i}_nome", ''));
    $url  = trim((string) get_theme_mod("ahn_parceiro_{$i}_url", ''));

    // trocaram os campos: o "nome" e que e o endereco
    if ($url === '' && preg_match('#^(https?://|www\.)#i', $nome)) {
      $url  = $nome;
      $nome = '';
    }
    if ($url === '') continue;

    if (strpos($url, '//') === false) $url = 'https://' . ltrim($url, '/');

    // sem nome, usa o dominio: melhor "scortsp.com.br" do que link sem texto
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
  add_theme_support('custom-logo', [
    'height' => 72, 'width' => 300, 'flex-height' => true, 'flex-width' => true,
  ]);
  register_nav_menus([
    'principal' => 'Menu principal (topo)',
    'rodape'    => 'Links uteis (rodape)',
  ]);
  // capa do destaque e dos cards
  add_image_size('ahn-capa', 760, 570, true);   // 4:3
  add_image_size('ahn-mini', 124, 124, true);
  add_image_size('ahn-foto', 420, 560, true);   // 3:4, a miniatura da galeria
});

/* ------------------------------------------------------- galeria do post */
/**
 * As fotos do post sao as imagens *anexadas* a ele. O fluxo e: criar o post,
 * subir as fotos nele, escrever duas linhas, publicar. Nada de bloco especial.
 * A imagem destacada fica de fora da grade, porque ela ja e a capa na listagem.
 */
function ahn_fotos_do_post($post_id = null) {
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

function ahn_qtd_fotos($post_id = null) {
  return count(ahn_fotos_do_post($post_id));
}

/**
 * Capa da listagem: a imagem destacada, ou a primeira foto do post quando
 * nao houver destacada. Evita card vazio quando alguem esquece de marcar.
 */
function ahn_capa_id($post_id = null) {
  $post_id = $post_id ? $post_id : get_the_ID();
  $capa = (int) get_post_thumbnail_id($post_id);
  if ($capa) return $capa;
  $fotos = ahn_fotos_do_post($post_id);
  if (!$fotos) return 0;
  $primeira = reset($fotos);
  return (int) $primeira->ID;
}

/**
 * Quando a grade de fotos esta sendo montada pelo tema, as galerias e imagens
 * soltas do corpo saem do texto — senao a mesma foto aparece duas vezes.
 */
function ahn_texto_sem_imagens($html) {
  return preg_replace(
    '#<figure[^>]*class="[^"]*wp-block-(?:gallery|image)[^"]*"[^>]*>.*?</figure>#is',
    '', $html
  );
}

/* ------------------------------------------------- area de widget lateral */
// opcional: fica embaixo das caixas fixas da lateral, para quando voce quiser
// pendurar alguma coisa sem mexer no codigo
add_action('widgets_init', function () {
  register_sidebar([
    'name'          => 'Barra lateral (extra)',
    'id'            => 'ahn-lateral',
    'description'   => 'Aparece depois de Busca, Categorias e Mais recentes.',
    'before_widget' => '<div class="ahn-caixa"><div class="ahn-caixa__corpo">',
    'after_widget'  => '</div></div>',
    'before_title'  => '<h3 class="ahn-caixa__tit" style="margin:-16px -16px 16px">',
    'after_title'   => '</h3>',
  ]);
});

/* ------------------------------------------------------------ css e fonte */
add_action('wp_enqueue_scripts', function () {
  // Sora e a fonte do design
  wp_enqueue_style(
    'ahn-fontes',
    'https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&display=swap',
    [], null
  );
  // versao pelo mtime: editou o css, o navegador pega na hora
  $css = get_stylesheet_directory() . '/style.css';
  wp_enqueue_style('ahn', get_stylesheet_uri(), [], file_exists($css) ? filemtime($css) : AHN_VER);

  if (is_singular()) wp_enqueue_script('comment-reply');

  // a lightbox so carrega no post que tem foto
  if (is_singular('post') && ahn_qtd_fotos()) {
    $js = get_theme_file_path('js/galeria.js');
    wp_enqueue_script('ahn-galeria', get_theme_file_uri('js/galeria.js'), [],
      file_exists($js) ? filemtime($js) : AHN_VER, true);
  }
});

/* ----------------------------------------------------------- resumo curto */
add_filter('excerpt_length', function () { return 24; });
add_filter('excerpt_more', function () { return '&hellip;'; });

/* ------------------------------------------------------ tempo de leitura */
function ahn_tempo_leitura($post_id = null) {
  $txt = wp_strip_all_tags(get_post_field('post_content', $post_id ? $post_id : get_the_ID()));
  // str_word_count() quebra palavra em cada acento e infla a conta em portugues.
  // Contar por espaco e menos elegante e muito mais certo aqui.
  $n   = count(preg_split('/\s+/u', trim($txt), -1, PREG_SPLIT_NO_EMPTY));
  $min = max(1, (int) round($n / 200));
  return $min . ' min de leitura';
}

/* --------------------------------------------------- categoria principal */
function ahn_categoria($post_id = null) {
  $cats = get_the_category($post_id ? $post_id : get_the_ID());
  if (!$cats) return null;
  // ignora "Sem categoria" quando houver outra
  foreach ($cats as $c) {
    if ($c->slug !== 'sem-categoria' && $c->slug !== 'uncategorized') return $c;
  }
  return $cats[0];
}
function ahn_etiqueta_cat($post_id = null) {
  $c = ahn_categoria($post_id);
  if (!$c) return;
  printf('<a href="%s" class="ahn-cat">%s</a>',
    esc_url(get_category_link($c->term_id)), esc_html($c->name));
}

/* ------------------------------------------------------------ Customizer */
add_action('customize_register', function ($wp) {

  /* ---- topo ---- */
  $wp->add_section('ahn_topo', ['title' => 'Topo do site', 'priority' => 25]);

  if ($wp->get_control('custom_logo')) {
    $wp->get_control('custom_logo')->section  = 'ahn_topo';
    $wp->get_control('custom_logo')->priority = 5;
  }

  $wp->add_setting('ahn_barra_esq', [
    'default' => '18+ &middot; conteudo para maiores',
    'sanitize_callback' => 'wp_kses_post',
  ]);
  $wp->add_control('ahn_barra_esq', [
    'label' => 'Faixa preta — texto da esquerda', 'type' => 'text', 'section' => 'ahn_topo',
  ]);

  $wp->add_setting('ahn_barra_dir', ['default' => '', 'sanitize_callback' => 'wp_kses_post']);
  $wp->add_control('ahn_barra_dir', [
    'label' => 'Faixa preta — texto da direita',
    'description' => 'Deixe em branco para nao aparecer.',
    'type' => 'text', 'section' => 'ahn_topo',
  ]);

  /* ---- portao 18+ ---- */
  $wp->add_section('ahn_idade', [
    'title' => 'Portao 18+',
    'priority' => 26,
    'description' => 'O aviso aparece so para quem ainda nao confirmou. O conteudo da pagina '
                   . 'e sempre entregue por tras, para o Google nao ver coisa diferente do visitante.',
  ]);

  $wp->add_setting('ahn_idade_ativo', ['default' => true, 'sanitize_callback' => 'wp_validate_boolean']);
  $wp->add_control('ahn_idade_ativo', [
    'label' => 'Mostrar o portao 18+', 'type' => 'checkbox', 'section' => 'ahn_idade',
  ]);

  $wp->add_setting('ahn_idade_tit', [
    'default' => 'Conteudo para maiores de 18 anos', 'sanitize_callback' => 'sanitize_text_field',
  ]);
  $wp->add_control('ahn_idade_tit', ['label' => 'Titulo', 'type' => 'text', 'section' => 'ahn_idade']);

  $wp->add_setting('ahn_idade_txt', [
    'default' => 'Este site tem conteudo adulto. Ao entrar, voce declara ser maior de 18 anos '
               . 'e concorda em visualizar esse tipo de material.',
    'sanitize_callback' => 'wp_kses_post',
  ]);
  $wp->add_control('ahn_idade_txt', ['label' => 'Texto', 'type' => 'textarea', 'section' => 'ahn_idade']);

  $wp->add_setting('ahn_idade_saida', [
    'default' => 'https://www.google.com.br', 'sanitize_callback' => 'esc_url_raw',
  ]);
  $wp->add_control('ahn_idade_saida', [
    'label' => 'Para onde vai quem clica em "Sair"', 'type' => 'url', 'section' => 'ahn_idade',
  ]);

  /* ---- verificacao do Google ---- */
  $wp->add_section('ahn_verificacao', [
    'title'       => 'Verificacao do Google',
    'priority'    => 30,
    'description' => 'So o codigo, sem a tag inteira. O Yoast tem um campo igual '
                   . 'em Configuracoes > Conexoes do site; use um ou outro, nunca os '
                   . 'dois, senao a meta sai duplicada no HTML.',
  ]);
  $wp->add_setting('ahn_google_verify', [
    'default'           => AHN_GSC_PADRAO,
    'sanitize_callback' => 'sanitize_text_field',
  ]);
  $wp->add_control('ahn_google_verify', [
    'label'       => 'google-site-verification',
    'description' => 'Deixe em branco para nao imprimir a meta.',
    'type'        => 'text', 'section' => 'ahn_verificacao',
  ]);

  /* ---- links parceiros ---- */
  $wp->add_section('ahn_parceiros', [
    'title'       => 'Links parceiros',
    'priority'    => 28,
    'description' => 'Ate 10 links. Vazios nao aparecem. Saem seguidos, passando '
                   . 'forca ao destino. Por padrao so aparecem na home: bloco de links '
                   . 'repetido em todas as paginas e rastro de rede, e com link seguido '
                   . 'isso pesa mais ainda.',
  ]);

  $wp->add_setting('ahn_parceiros_pago', [
    'default' => false, 'sanitize_callback' => 'wp_validate_boolean',
  ]);
  $wp->add_control('ahn_parceiros_pago', [
    'label'       => 'Marcar como patrocinado',
    'description' => 'Ligue quando houver dinheiro, permuta ou troca de link combinada. '
                   . 'Acrescenta rel="sponsored nofollow". Link pago seguido e esquema de '
                   . 'links, e a punicao atinge os dois sites.',
    'type'        => 'checkbox', 'section' => 'ahn_parceiros',
  ]);

  $wp->add_setting('ahn_parceiros_titulo', [
    'default' => 'Parceiros', 'sanitize_callback' => 'sanitize_text_field',
  ]);
  $wp->add_control('ahn_parceiros_titulo', [
    'label' => 'Titulo do bloco', 'type' => 'text', 'section' => 'ahn_parceiros',
  ]);

  $wp->add_setting('ahn_parceiros_tudo', [
    'default' => false, 'sanitize_callback' => 'wp_validate_boolean',
  ]);
  $wp->add_control('ahn_parceiros_tudo', [
    'label'       => 'Mostrar em todas as paginas',
    'description' => 'Desmarcado (recomendado), aparece so na home.',
    'type'        => 'checkbox', 'section' => 'ahn_parceiros',
  ]);

  for ($i = 1; $i <= AHN_PARCEIROS; $i++) {
    $wp->add_setting("ahn_parceiro_{$i}_nome", ['default' => '', 'sanitize_callback' => 'sanitize_text_field']);
    $wp->add_control("ahn_parceiro_{$i}_nome", [
      'label' => "{$i}. Nome (o texto que aparece)", 'type' => 'text', 'section' => 'ahn_parceiros',
    ]);
    $wp->add_setting("ahn_parceiro_{$i}_url", ['default' => '', 'sanitize_callback' => 'esc_url_raw']);
    $wp->add_control("ahn_parceiro_{$i}_url", [
      'label' => "{$i}. Endereco (https://...)", 'type' => 'url', 'section' => 'ahn_parceiros',
    ]);
  }

  /* ---- rodape ---- */
  $wp->add_section('ahn_rodape', ['title' => 'Rodape', 'priority' => 29]);

  $wp->add_setting('ahn_sobre', ['default' => '', 'sanitize_callback' => 'wp_kses_post']);
  $wp->add_control('ahn_sobre', [
    'label' => 'Texto da primeira coluna',
    'description' => 'Vazio, usa a descricao do site (Configuracoes > Geral).',
    'type' => 'textarea', 'section' => 'ahn_rodape',
  ]);

  $wp->add_setting('ahn_disclaimer', [
    'default' => 'Este site e destinado a maiores de 18 anos e nao se responsabiliza por '
               . 'conteudo de terceiros eventualmente citado.',
    'sanitize_callback' => 'wp_kses_post',
  ]);
  $wp->add_control('ahn_disclaimer', [
    'label' => 'Aviso legal', 'type' => 'textarea', 'section' => 'ahn_rodape',
  ]);
});

/* --------------------------------- categoria sem "/categoria/" na URL ---- */
/**
 * O site usa /amadoras/ em vez de /categoria/amadoras/.
 *
 * Sao duas metades que tem que andar juntas:
 *   1. tirar a base do link que o WordPress gera;
 *   2. ensinar o WordPress a reconhecer a URL curta.
 *
 * As regras sao montadas a partir dos slugs que existem de verdade, uma por
 * categoria, em vez de uma regra generica do tipo ([^/]+)/?$. Isso e de
 * proposito: regra generica na raiz engole pagina, post e tudo mais.
 */
function ahn_base_categoria() {
  $base = get_option('category_base');
  return trim($base ? $base : 'category', '/');
}

add_filter('category_link', function ($link) {
  $base = ahn_base_categoria();
  return preg_replace('#/' . preg_quote($base, '#') . '/#', '/', $link, 1);
});

add_filter('category_rewrite_rules', function ($regras) {
  $novas = [];
  foreach (get_categories(['hide_empty' => false]) as $cat) {
    $caminho = $cat->slug;
    // categoria filha mantem o caminho do pai: /pai/filha/
    if ($cat->parent) {
      $pais = get_category_parents($cat->term_id, false, '/', true);
      if (!is_wp_error($pais)) $caminho = trim($pais, '/');
    }
    $q = 'index.php?category_name=' . $cat->slug;
    $novas[$caminho . '/embed/?$']                         = $q . '&embed=true';
    $novas[$caminho . '/feed/(feed|rdf|rss|rss2|atom)/?$'] = $q . '&feed=$matches[1]';
    $novas[$caminho . '/(feed|rdf|rss|rss2|atom)/?$']      = $q . '&feed=$matches[1]';
    $novas[$caminho . '/page/?([0-9]{1,})/?$']             = $q . '&paged=$matches[1]';
    $novas[$caminho . '/?$']                               = $q;
  }
  return $novas;
});

// Criar, renomear ou apagar categoria muda a lista de slugs, entao as regras
// precisam ser regravadas na hora. Sem isto, categoria nova responde 404 ate
// alguem abrir Configuracoes > Links permanentes.
foreach (['created_category', 'edited_category', 'delete_category'] as $ahn_gatilho) {
  add_action($ahn_gatilho, function () { flush_rewrite_rules(false); });
}
add_action('after_switch_theme', function () { flush_rewrite_rules(false); });

/* ------------------------------------- titulo de arquivo sem o prefixo ---- */
// O WordPress escreve "Categoria: Amadoras". Na pagina de categoria o visitante
// ja sabe que esta numa categoria, entao fica so "Amadoras".
add_filter('get_the_archive_title_prefix', '__return_empty_string');

/* ============================================================================
   Conserto do "Ane Importador de fotos"
   ----------------------------------------------------------------------------
   Dois defeitos do plugin, que nao da para corrigir dentro dele sem perder a
   correcao na proxima atualizacao:

   1. Ele cria o post com post_status = 'importador' e NUNCA chama
      register_post_status(). Status nao registrado nao aparece em filtro
      nenhum do painel, entao o post existe no banco e fica invisivel. E por
      isso que a lista mostra "Todos (8) | Publicados (6)".

   2. Na criacao ele passa so post_title, post_status e post_type — sem
      conteudo e sem resumo. Quando a raspagem do titulo falha (os seletores
      sao .gallery-title-h1, depois h1, depois a meta; todos com @ engolindo
      erro), o titulo vem vazio e o WordPress se recusa a criar o post,
      devolvendo 0. O plugin testa `if ($id)` sem else, entao falha calado:
      as imagens ja baixaram e post nenhum aparece.

   Isto vive no tema porque e o unico lugar onde consigo publicar codigo neste
   site hoje. O lugar certo seria um mu-plugin; se um dia trocar de tema,
   lembrar de levar este bloco junto.
   ========================================================================== */

add_action('init', function () {
  register_post_status('importador', [
    'label'                     => 'Importando',
    'public'                    => false,
    'internal'                  => false,
    'protected'                 => true,
    'exclude_from_search'       => true,
    'show_in_admin_all_list'    => true,
    'show_in_admin_status_list' => true,
    'label_count'               => _n_noop(
      'Importando <span class="count">(%s)</span>',
      'Importando <span class="count">(%s)</span>'
    ),
  ]);
});

// deixa passar o post sem conteudo so nesse caso especifico
add_filter('wp_insert_post_empty_content', function ($vazio, $dados) {
  if (isset($dados['post_status']) && $dados['post_status'] === 'importador') return false;
  return $vazio;
}, 10, 2);

// e da um titulo de reserva, para nao nascer post sem nome
add_filter('wp_insert_post_data', function ($dados) {
  if (isset($dados['post_status']) && $dados['post_status'] === 'importador'
      && trim(wp_strip_all_tags($dados['post_title'])) === '') {
    $dados['post_title'] = 'Importando — ' . current_time('d/m/Y H:i:s');
  }
  return $dados;
});

/* ------------------------------------------ verificacao do Search Console */
// Prioridade 1 para sair bem no inicio do <head>: o Google le o comeco do
// documento, e meta de verificacao enterrada no fim ja deu problema.
add_action('wp_head', function () {
  $codigo = trim((string) get_theme_mod('ahn_google_verify', AHN_GSC_PADRAO));
  if ($codigo === '') return;
  printf('<meta name="google-site-verification" content="%s" />' . "\n", esc_attr($codigo));
}, 1);

/* ------------------------------------------------- paginacao com a classe */
function ahn_paginacao() {
  $links = paginate_links([
    'type' => 'array', 'prev_text' => '&lsaquo; Anterior', 'next_text' => 'Proxima &rsaquo;',
  ]);
  if (!$links) return;
  echo '<nav class="ahn-pag" aria-label="Paginacao">' . implode('', $links) . '</nav>';
}

/* ------------------------------------------------------- limpeza do <head> */
// tira o que so serve para dar pista de versao e gerar requisicao a toa
remove_action('wp_head', 'wp_generator');
remove_action('wp_head', 'wlwmanifest_link');
remove_action('wp_head', 'rsd_link');
remove_action('wp_head', 'wp_shortlink_wp_head');
add_filter('the_generator', '__return_empty_string');
// emojis: script que nenhum blog precisa
remove_action('wp_head', 'print_emoji_detection_script', 7);
remove_action('wp_print_styles', 'print_emoji_styles');
