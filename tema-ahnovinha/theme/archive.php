<?php
/**
 * Categoria, tag e demais arquivos. Mesma grade da home.
 */
if (!defined('ABSPATH')) exit;
get_header();
?>

<div class="ahn-corpo" id="conteudo">

  <h1 class="ahn-secao"><?php echo wp_kses_post(get_the_archive_title()); ?></h1>

  <?php $desc = get_the_archive_description();
  if ($desc) : ?>
    <div class="ahn-intro"><?php echo wp_kses_post($desc); ?></div>
  <?php endif; ?>

  <?php if (have_posts()) : ?>
    <div class="ahn-grade">
      <?php while (have_posts()) : the_post();
        get_template_part('template-parts/card');
      endwhile; ?>
    </div>
    <?php ahn_paginacao(); ?>
  <?php else : ?>
    <div class="ahn-vazio">
      <h1>Nada por aqui ainda</h1>
      <p>Esta seção ainda não tem publicações.</p>
      <a class="ahn-bt ahn-bt--sim" href="<?php echo esc_url(home_url('/')); ?>">Ir para a home</a>
    </div>
  <?php endif; ?>

</div>

<?php get_footer(); ?>
