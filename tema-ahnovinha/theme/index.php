<?php
/**
 * Home, busca e listagem geral. Grade masonry, largura cheia, sem lateral —
 * como no design.
 */
if (!defined('ABSPATH')) exit;
get_header();
?>

<div class="ahn-corpo" id="conteudo">

  <?php if (is_search()) : ?>
    <h1 class="ahn-secao">
      Resultados para &ldquo;<?php echo esc_html(get_search_query()); ?>&rdquo;
    </h1>
  <?php elseif (is_home() && !is_front_page()) : ?>
    <h1 class="ahn-secao"><?php echo esc_html(get_the_title(get_option('page_for_posts'))); ?></h1>
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
      <h1><?php echo is_search() ? 'Nada encontrado' : 'Ainda não há nada por aqui'; ?></h1>
      <p>
        <?php if (is_search()) : ?>
          Nenhuma publicação bateu com essa busca. Tente outra palavra.
        <?php else : ?>
          As publicações aparecem aqui assim que forem criadas.
        <?php endif; ?>
      </p>
      <a class="ahn-bt ahn-bt--sim" href="<?php echo esc_url(home_url('/')); ?>">Ir para a home</a>
    </div>

  <?php endif; ?>

</div>

<?php get_footer(); ?>
