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

<a class="ahn-pula" href="#conteudo">Pular para o conteudo</a>

<?php get_template_part('template-parts/portao-idade'); ?>

<header class="ahn-topo">
  <?php
  $esq = get_theme_mod('ahn_barra_esq', '18+ &middot; conteudo para maiores');
  $dir = get_theme_mod('ahn_barra_dir', '');
  if ($esq || $dir) : ?>
    <div class="ahn-topo__barra">
      <div class="ahn-wrap">
        <span><?php echo wp_kses_post($esq); ?></span>
        <?php if ($dir) : ?><span><?php echo wp_kses_post($dir); ?></span><?php endif; ?>
      </div>
    </div>
  <?php endif; ?>

  <div class="ahn-wrap ahn-topo__miolo">
    <?php if (has_custom_logo()) : ?>
      <div class="ahn-marca ahn-marca--img"><?php the_custom_logo(); ?></div>
    <?php else :
      /* marca do design: disco redondo + nome. A segunda palavra do nome do
         site fica no tom de acento. */
      $parte = explode(' ', get_bloginfo('name'), 2);
    ?>
      <a href="<?php echo esc_url(home_url('/')); ?>" class="ahn-marca" rel="home">
        <span class="ahn-marca__disco" aria-hidden="true"></span>
        <span><?php echo esc_html($parte[0]);
          if (!empty($parte[1])) echo ' <em>' . esc_html($parte[1]) . '</em>'; ?></span>
      </a>
    <?php endif; ?>

    <?php if (has_nav_menu('principal')) : ?>
      <nav aria-label="Menu principal">
        <?php wp_nav_menu([
          'theme_location' => 'principal',
          'menu_class'     => 'ahn-menu',
          'container'      => false,
          'depth'          => 1,
        ]); ?>
      </nav>
    <?php endif; ?>

    <?php get_search_form(); ?>
  </div>

  <?php
  // fileira de categorias: so nas listagens, como no design
  if (!is_singular() && !is_404()) get_template_part('template-parts/chips');
  ?>
</header>
