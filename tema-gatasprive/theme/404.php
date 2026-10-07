<?php
if (!defined('ABSPATH')) exit;
get_header();
?>
<div class="gp-vazio" id="conteudo">
  <h1>Página não encontrada</h1>
  <p>O endereço que você abriu não existe mais, ou foi digitado errado.</p>
  <a class="gp-bt gp-bt--roxo" href="<?php echo esc_url(home_url('/')); ?>">Ver os anúncios</a>
</div>

<?php $r = gp_consulta(['posts_per_page' => 8]);
if ($r->have_posts()) : ?>
  <div class="gp-secao"><h2>Anúncios recentes</h2></div>
  <div class="gp-grade">
    <?php while ($r->have_posts()) : $r->the_post();
      get_template_part('template-parts/card');
    endwhile; ?>
  </div>
  <?php wp_reset_postdata();
endif; ?>

<?php get_footer(); ?>
