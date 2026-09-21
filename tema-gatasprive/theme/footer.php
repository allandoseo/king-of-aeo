<?php if (!defined('ABSPATH')) exit; ?>

<?php get_template_part('template-parts/parceiros'); ?>

<footer class="gp-rodape">
  <div class="gp-wrap">
    <span>&copy; <?php echo esc_html(date('Y')); ?> <?php bloginfo('name'); ?></span>
    <?php if (has_nav_menu('rodape')) {
      wp_nav_menu(['theme_location' => 'rodape', 'container' => false, 'depth' => 1]);
    } ?>
  </div>
  <?php $av = get_theme_mod('gp_disclaimer');
  if ($av) : ?>
    <div class="gp-rod-aviso"><?php echo wp_kses_post($av); ?></div>
  <?php endif; ?>
</footer>

<?php wp_footer(); ?>
</body>
</html>
