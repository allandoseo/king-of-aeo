<!doctype html>
<html <?php language_attributes(); ?>>
<head><meta charset="<?php bloginfo('charset'); ?>"><meta name="viewport" content="width=device-width,initial-scale=1"><?php wp_head(); ?></head>
<body <?php body_class(); ?>>
<header class="site-header"><div class="wrap">

  <div class="brand">
    <?php if (has_custom_logo()) : ?>
      <a href="<?php echo esc_url(home_url('/')); ?>" class="logo logo--img" rel="home">
        <?php
        $logo_id = get_theme_mod('custom_logo');
        echo wp_get_attachment_image($logo_id, 'full', false, [
          'class' => 'logo-img',
          'alt'   => get_bloginfo('name'),
        ]);
        ?>
      </a>
      <?php if (get_bloginfo('description')) : ?>
        <div class="tag"><?php bloginfo('description'); ?></div>
      <?php endif; ?>
    <?php else : ?>
      <a href="<?php echo esc_url(home_url('/')); ?>" class="logo"><small><?php bloginfo('name'); ?></small>MIX<div class="tag"><?php bloginfo('description'); ?></div></a>
    <?php endif; ?>

    <nav class="main-nav"><?php wp_nav_menu(['theme_location' => 'principal', 'container' => false, 'fallback_cb' => false]); ?></nav>
  </div>

  <?php
  $banner = get_theme_mod('dmix_banner');
  $banner_link = get_theme_mod('dmix_banner_link');
  ?>
  <?php if ($banner) : ?>
    <div class="hero-banner">
      <?php if ($banner_link) : ?><a href="<?php echo esc_url($banner_link); ?>"><?php endif; ?>
        <img src="<?php echo esc_url($banner); ?>" alt="" loading="eager" decoding="async">
      <?php if ($banner_link) : ?></a><?php endif; ?>
    </div>
  <?php else : ?>
    <div class="hero-strip">
      <?php $h = dmix_query('dmix_destaque', 4); while ($h->have_posts()) { $h->the_post(); ?>
        <a class="slot" href="<?php the_permalink(); ?>"><?php the_post_thumbnail('large'); ?></a>
      <?php } wp_reset_postdata(); ?>
    </div>
  <?php endif; ?>

</div></header>
<main class="site-main"><div class="wrap">
<?php get_sidebar(); ?>
<section class="content">
