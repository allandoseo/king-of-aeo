<?php get_header(); $loc = dmix_local_label(); ?>

<?php if (is_search()): ?>
  <h1 class="sec-title">Busca: <?php echo esc_html(get_search_query()); ?></h1>
  <div class="grid"><?php while (have_posts()) { the_post(); get_template_part('template-parts/card-grid'); } ?></div>
<?php else: ?>
  <h1 class="sec-title">Perfis VIP<?php echo esc_html($loc); ?></h1>
  <?php $q = dmix_query('dmix_vip'); while ($q->have_posts()) { $q->the_post(); get_template_part('template-parts/card-vip'); } wp_reset_postdata(); ?>

  <h2 class="sec-title">Destaques<?php echo esc_html($loc); ?></h2>
  <div class="grid"><?php $q = dmix_query('dmix_destaque'); while ($q->have_posts()) { $q->the_post(); get_template_part('template-parts/card-grid'); } wp_reset_postdata(); ?></div>

  <h2 class="sec-title dark">Todos os perfis<?php echo esc_html($loc); ?></h2>
  <div class="grid"><?php $q = dmix_query(); while ($q->have_posts()) { $q->the_post(); get_template_part('template-parts/card-grid'); } wp_reset_postdata(); ?></div>
<?php endif; ?>

<?php get_footer(); ?>
