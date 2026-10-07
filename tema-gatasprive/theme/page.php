<?php
/** Pagina de texto: Sobre, Anunciar, Contato, Privacidade. */
if (!defined('ABSPATH')) exit;
get_header();
?>
<div class="gp-pagina" id="conteudo">
  <?php while (have_posts()) : the_post(); ?>
    <article <?php post_class(); ?>>
      <h1><?php the_title(); ?></h1>
      <div class="gp-pagina__corpo">
        <?php the_content(); ?>
        <?php wp_link_pages(['before' => '<nav class="gp-pag">', 'after' => '</nav>']); ?>
      </div>
    </article>
  <?php endwhile; ?>
</div>
<?php get_footer(); ?>
