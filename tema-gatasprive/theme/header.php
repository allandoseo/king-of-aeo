<?php if (!defined('ABSPATH')) exit; ?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo('charset'); ?>">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<a class="gp-pula" href="#conteudo">Pular para o conteudo</a>

<?php get_template_part('template-parts/portao-idade'); ?>

<header class="gp-topo">
  <div class="gp-wrap gp-topo__miolo">
    <?php if (has_custom_logo()) : ?>
      <div class="gp-marca gp-marca--img"><?php the_custom_logo(); ?></div>
    <?php else : ?>
      <a href="<?php echo esc_url(home_url('/')); ?>" class="gp-marca" rel="home">
        <?php bloginfo('name'); ?>
        <?php $tag = get_theme_mod('gp_tagline', 'Acompanhantes em Goiania');
        if ($tag) : ?><small><?php echo esc_html($tag); ?></small><?php endif; ?>
      </a>
    <?php endif; ?>

    <div class="gp-topo__acoes">
      <?php
      // com WhatsApp configurado o botao vai direto para a conversa; sem ele,
      // cai na pagina /anunciar/, que e a versao sem autoatendimento
      $wpp_anuncio = preg_replace('/\D/', '', (string) get_theme_mod('gp_wpp_anuncio', ''));
      if ($wpp_anuncio !== '') {
        if (strlen($wpp_anuncio) <= 11) $wpp_anuncio = '55' . $wpp_anuncio;
        $destino = 'https://wa.me/' . $wpp_anuncio . '?text=' .
          rawurlencode('Ola! Quero anunciar no ' . get_bloginfo('name') . '.');
        $rel = ' rel="nofollow noopener" target="_blank"';
      } else {
        $destino = home_url('/anunciar/');
        $rel = '';
      }
      ?>
      <a href="<?php echo esc_url($destino); ?>" class="gp-bt gp-bt--ambar"<?php echo $rel; ?>>
        Publicar anúncio
      </a>
      <a href="<?php echo esc_url(home_url('/contato/')); ?>" class="gp-bt gp-bt--vazio">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" aria-hidden="true">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
        Contato
      </a>
    </div>
  </div>
</header>

<?php
// as duas barras so aparecem nas listagens: na pagina do perfil elas roubariam
// atencao do botao de WhatsApp, que e o que converte
if (!is_singular('page') && !is_404()) :
  $bairros = get_terms(['taxonomy' => 'bairro', 'hide_empty' => true,  'number' => 30,
                        'orderby' => 'count', 'order' => 'DESC']);
  $tax_atual = is_tax('bairro') ? (int) get_queried_object_id() : 0;
?>


  <?php if (!is_wp_error($bairros) && $bairros) : ?>
    <nav class="gp-barra" aria-label="Bairros">
      <div class="gp-wrap gp-barra__miolo">
        <span class="gp-barra__rotulo">Bairros:</span>
        <?php foreach ($bairros as $b) : ?>
          <a href="<?php echo esc_url(get_term_link($b)); ?>"
             class="gp-chip<?php echo $tax_atual === (int) $b->term_id ? ' atual' : ''; ?>">
            <?php echo esc_html($b->name); ?>
          </a>
        <?php endforeach; ?>
      </div>
    </nav>
  <?php endif; ?>

<?php endif; ?>
