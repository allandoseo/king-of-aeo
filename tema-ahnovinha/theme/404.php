<?php
if (!defined('ABSPATH')) exit;
get_header();
?>

<div class="ahn-corpo" id="conteudo">
  <div class="ahn-vazio">
    <h1>Página não encontrada</h1>
    <p>O endereço que você abriu não existe mais, ou foi digitado errado.</p>
    <a class="ahn-bt ahn-bt--sim" href="<?php echo esc_url(home_url('/')); ?>">Ir para a home</a>
  </div>

  <?php $recentes = new WP_Query(['posts_per_page' => 8, 'ignore_sticky_posts' => true]);
  if ($recentes->have_posts()) : ?>
    <h2 class="ahn-secao" style="margin-top:38px">Publicações recentes</h2>
    <div class="ahn-grade">
      <?php while ($recentes->have_posts()) : $recentes->the_post();
        get_template_part('template-parts/card');
      endwhile; ?>
    </div>
    <?php wp_reset_postdata();
  endif; ?>
</div>

<?php get_footer(); ?>
