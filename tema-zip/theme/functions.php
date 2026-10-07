<?php
add_action('after_setup_theme', function () {
  add_theme_support('title-tag');
  add_theme_support('post-thumbnails');
  add_theme_support('custom-logo', [
    'height' => 130, 'width' => 300, 'flex-height' => true, 'flex-width' => true,
  ]);
  register_nav_menus(['principal' => 'Menu principal', 'rodape' => 'Links úteis (rodapé)']);
});

/* ---------- Customizer: topo do site ---------- */
add_action('customize_register', function ($wp_customize) {
  $wp_customize->add_section('dmix_topo', [
    'title'       => 'Topo do site',
    'priority'    => 25,
    'description' => 'Logo e banner do cabeçalho.',
  ]);

  // a logo usa o controle nativo, mas aparece aqui junto do banner
  if ($wp_customize->get_control('custom_logo')) {
    $wp_customize->get_control('custom_logo')->section = 'dmix_topo';
    $wp_customize->get_control('custom_logo')->priority = 5;
  }

  $wp_customize->add_setting('dmix_banner', [
    'default' => '', 'sanitize_callback' => 'esc_url_raw', 'transport' => 'refresh',
  ]);
  $wp_customize->add_control(new WP_Customize_Image_Control($wp_customize, 'dmix_banner', [
    'label'       => 'Banner do topo',
    'description' => 'Faixa larga à direita da logo. Sem imagem, o tema monta a faixa com as fotos dos perfis marcados como Destaque.',
    'section'     => 'dmix_topo',
    'settings'    => 'dmix_banner',
    'priority'    => 10,
  ]));

  $wp_customize->add_setting('dmix_banner_link', [
    'default' => '', 'sanitize_callback' => 'esc_url_raw',
  ]);
  $wp_customize->add_control('dmix_banner_link', [
    'label'       => 'Link do banner',
    'description' => 'Opcional. Deixe em branco para o banner não ser clicável.',
    'type'        => 'url',
    'section'     => 'dmix_topo',
    'priority'    => 15,
  ]);

  $wp_customize->add_setting('dmix_disclaimer', [
    'default'           => 'Este site não é responsável pelos anúncios aqui publicados, tão pouco por consequências diretas ou indiretas que possam corresponder a dados, marcas, pessoas, ou serviços oferecidos nos referidos anúncios.',
    'sanitize_callback' => 'wp_kses_post',
  ]);
  $wp_customize->add_control('dmix_disclaimer', [
    'label'   => 'Aviso do rodapé',
    'type'    => 'textarea',
    'section' => 'dmix_topo',
    'priority' => 20,
  ]);
});

add_action('wp_enqueue_scripts', function () {
  // Lato + League Gothic sao as fontes do site original (2017)
  wp_enqueue_style('dmix-fonts', 'https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&family=League+Gothic&display=swap', [], null);
  wp_enqueue_style('dmix', get_stylesheet_uri(), [], '1.1');
});

add_action('init', function () {
  register_post_type('perfil', [
    'label' => 'Perfis', 'public' => true, 'has_archive' => true, 'menu_icon' => 'dashicons-id',
    'rewrite' => ['slug' => 'perfil'],
    'supports' => ['title', 'editor', 'excerpt', 'thumbnail', 'comments'],
  ]);
  // Hierárquica: Estado > Cidade
  register_taxonomy('local', 'perfil', [
    'label' => 'Estado / Cidade', 'hierarchical' => true, 'public' => true, 'rewrite' => ['slug' => 'local', 'hierarchical' => true],
  ]);
  foreach (['dmix_tel' => 'string', 'dmix_wpp' => 'string', 'dmix_cache' => 'string',
            'dmix_galeria' => 'string', 'dmix_vip' => 'boolean', 'dmix_destaque' => 'boolean'] as $k => $t) {
    register_post_meta('perfil', $k, ['type' => $t, 'single' => true, 'show_in_rest' => true]);
  }
});

// Estado e cidade a partir da taxonomia hierarquica `local`
function dmix_local_do_perfil($post_id = null) {
  $termos = wp_get_object_terms($post_id ?: get_the_ID(), 'local');
  if (is_wp_error($termos) || !$termos) return ['estado' => '', 'cidade' => '', 'cidade_link' => ''];
  // o termo mais profundo e a cidade
  $cidade = $termos[0];
  foreach ($termos as $t) { if ($t->parent) { $cidade = $t; break; } }
  $estado = $cidade->parent ? get_term($cidade->parent, 'local') : null;
  return [
    'estado'      => $estado && !is_wp_error($estado) ? $estado->name : '',
    'cidade'      => $cidade->name,
    'cidade_link' => get_term_link($cidade),
  ];
}

// IDs da galeria -> array de inteiros
function dmix_galeria_ids($post_id = null) {
  $raw = get_post_meta($post_id ?: get_the_ID(), 'dmix_galeria', true);
  if (!$raw) return [];
  return array_filter(array_map('intval', explode(',', $raw)));
}

// Meta box simples
add_action('add_meta_boxes', function () {
  add_meta_box('dmix_dados', 'Contato e destaque', function ($post) {
    wp_nonce_field('dmix_save', 'dmix_nonce');
    $v = fn($k) => esc_attr(get_post_meta($post->ID, $k, true));
    echo '<p><label>Telefone<br><input name="dmix_tel" value="' . $v('dmix_tel') . '" class="widefat"></label></p>';
    echo '<p><label>WhatsApp (só números, com DDI)<br><input name="dmix_wpp" value="' . $v('dmix_wpp') . '" class="widefat"></label></p>';
    echo '<p><label>Cachê<br><input name="dmix_cache" value="' . $v('dmix_cache') . '" class="widefat" placeholder="ex.: Aceito todos os cartões"></label></p>';
    echo '<p><label><input type="checkbox" name="dmix_vip" value="1" ' . checked($v('dmix_vip'), '1', false) . '> VIP</label> &nbsp; ';
    echo '<label><input type="checkbox" name="dmix_destaque" value="1" ' . checked($v('dmix_destaque'), '1', false) . '> Destaque</label></p>';
  }, 'perfil', 'side');

  add_meta_box('dmix_galeria_box', 'Galeria de fotos', function ($post) {
    $ids = get_post_meta($post->ID, 'dmix_galeria', true);
    echo '<input type="hidden" id="dmix_galeria" name="dmix_galeria" value="' . esc_attr($ids) . '">';
    echo '<div id="dmix-galeria-preview" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px"></div>';
    echo '<button type="button" class="button" id="dmix-galeria-sel">Selecionar fotos</button> ';
    echo '<button type="button" class="button" id="dmix-galeria-limpa">Limpar</button>';
    echo '<p class="description">Aparecem na seção “Confira minhas fotos” da página do perfil.</p>';
  }, 'perfil', 'normal');
});

// media picker da galeria
add_action('admin_enqueue_scripts', function ($hook) {
  global $post;
  if (!in_array($hook, ['post.php', 'post-new.php'], true)) return;
  if (!$post || $post->post_type !== 'perfil') return;
  wp_enqueue_media();
  $js = <<<'JS'
jQuery(function($){
  var campo = $('#dmix_galeria'), prev = $('#dmix-galeria-preview'), frame;
  function desenha(){
    prev.empty();
    (campo.val()||'').split(',').filter(Boolean).forEach(function(id){
      wp.media.attachment(id).fetch().then(function(){
        var a = wp.media.attachment(id).toJSON();
        var u = (a.sizes && a.sizes.thumbnail) ? a.sizes.thumbnail.url : a.url;
        prev.append('<img src="'+u+'" style="width:70px;height:70px;object-fit:cover;border:1px solid #ccc">');
      });
    });
  }
  $('#dmix-galeria-sel').on('click', function(e){
    e.preventDefault();
    if (frame) { frame.open(); return; }
    frame = wp.media({title:'Fotos do perfil', multiple:'add', library:{type:'image'},
                      button:{text:'Usar estas fotos'}});
    frame.on('select', function(){
      var ids = frame.state().get('selection').map(function(m){ return m.id; });
      var atuais = (campo.val()||'').split(',').filter(Boolean);
      campo.val(atuais.concat(ids).filter(function(v,i,a){return a.indexOf(v)===i;}).join(','));
      desenha();
    });
    frame.open();
  });
  $('#dmix-galeria-limpa').on('click', function(e){ e.preventDefault(); campo.val(''); prev.empty(); });
  desenha();
});
JS;
  wp_add_inline_script('jquery', $js);
});
add_action('save_post_perfil', function ($id) {
  if (!isset($_POST['dmix_nonce']) || !wp_verify_nonce($_POST['dmix_nonce'], 'dmix_save') || !current_user_can('edit_post', $id)) return;
  update_post_meta($id, 'dmix_tel', sanitize_text_field($_POST['dmix_tel'] ?? ''));
  update_post_meta($id, 'dmix_wpp', preg_replace('/\D/', '', $_POST['dmix_wpp'] ?? ''));
  update_post_meta($id, 'dmix_cache', sanitize_text_field($_POST['dmix_cache'] ?? ''));
  update_post_meta($id, 'dmix_galeria', preg_replace('/[^0-9,]/', '', $_POST['dmix_galeria'] ?? ''));
  update_post_meta($id, 'dmix_vip', isset($_POST['dmix_vip']) ? '1' : '');
  update_post_meta($id, 'dmix_destaque', isset($_POST['dmix_destaque']) ? '1' : '');
});

// Busca só em perfis
add_action('pre_get_posts', function ($q) {
  if (!is_admin() && $q->is_main_query() && $q->is_search()) $q->set('post_type', 'perfil');
});

function dmix_query($flag = null, $n = -1) {
  $args = ['post_type' => 'perfil', 'posts_per_page' => $n];
  if ($flag) $args['meta_query'] = [['key' => $flag, 'value' => '1']];
  if (is_tax('local')) $args['tax_query'] = [['taxonomy' => 'local', 'terms' => get_queried_object_id(), 'include_children' => true]];
  return new WP_Query($args);
}
function dmix_local_label() {
  return is_tax('local') ? ' - ' . single_term_title('', false) : '';
}
