<?php
/**
 * Barra lateral: busca, categorias e mais recentes.
 * Nada de bloco de links fixo em todas as paginas — isso deixa rastro.
 */
if (!defined('ABSPATH')) exit;
?>
<aside aria-label="Barra lateral">

  <div class="ahn-caixa">
    <h3 class="ahn-caixa__tit">Buscar no blog</h3>
    <div class="ahn-caixa__corpo"><?php get_search_form(); ?></div>
  </div>

  <?php
  $cats = get_categories(['hide_empty' => true, 'orderby' => 'count', 'order' => 'DESC', 'number' => 8]);
  if ($cats) : ?>
    <div class="ahn-caixa">
      <h3 class="ahn-caixa__tit">Categorias</h3>
      <ul class="ahn-lista">
        <?php foreach ($cats as $c) : ?>
          <li>
            <a href="<?php echo esc_url(get_category_link($c->term_id)); ?>">
              <?php echo esc_html($c->name); ?>
              <span class="qtd"><?php echo (int) $c->count; ?></span>
            </a>
          </li>
        <?php endforeach; ?>
      </ul>
    </div>
  <?php endif; ?>

  <?php
  $recentes = new WP_Query([
    'posts_per_page'      => 4,
    'ignore_sticky_posts' => true,
    'post__not_in'        => is_singular('post') ? [get_the_ID()] : [],
  ]);
  if ($recentes->have_posts()) : ?>
    <div class="ahn-caixa">
      <h3 class="ahn-caixa__tit">Mais recentes</h3>
      <div>
        <?php while ($recentes->have_posts()) : $recentes->the_post(); ?>
          <div class="ahn-recente">
            <?php if (has_post_thumbnail()) : ?>
              <div class="ahn-recente__mini">
                <?php the_post_thumbnail('ahn-mini', ['loading' => 'lazy', 'alt' => '']); ?>
              </div>
            <?php endif; ?>
            <div>
              <h4><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h4>
              <span class="ahn-meta"><?php echo esc_html(get_the_date('j M Y')); ?></span>
            </div>
          </div>
        <?php endwhile; ?>
      </div>
    </div>
    <?php wp_reset_postdata();
  endif; ?>

  <?php if (is_active_sidebar('ahn-lateral')) dynamic_sidebar('ahn-lateral'); ?>

</aside>
