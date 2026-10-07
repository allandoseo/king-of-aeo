<?php
/**
 * Pagina de texto (Sobre, Contato, Privacidade). Coluna estreita e legivel.
 */
if (!defined('ABSPATH')) exit;
get_header();
?>

<div class="ahn-pagina" id="conteudo">
  <?php while (have_posts()) : the_post(); ?>
    <article <?php post_class(); ?>>
      <h1><?php the_title(); ?></h1>
      <div class="ahn-pagina__corpo">
        <?php the_content(); ?>
        <?php wp_link_pages(['before' => '<nav class="ahn-pag">', 'after' => '</nav>']); ?>
      </div>
    </article>
  <?php endwhile; ?>
</div>

<?php get_footer(); ?>
