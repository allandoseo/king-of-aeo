<?php $tel = get_post_meta(get_the_ID(), 'dmix_tel', true); $wpp = get_post_meta(get_the_ID(), 'dmix_wpp', true); ?>
<article class="vip">
  <a class="photo" href="<?php the_permalink(); ?>"><?php the_post_thumbnail('large'); ?></a>
  <div>
    <h2><?php the_title(); ?></h2>
    <?php if ($tel): ?><a class="btn btn-tel" href="tel:<?php echo esc_attr(preg_replace('/\D/', '', $tel)); ?>">&#9742; TEL: <?php echo esc_html($tel); ?></a><?php endif; ?>
    <?php if ($wpp): ?><a class="btn btn-wpp" href="https://wa.me/<?php echo esc_attr($wpp); ?>" target="_blank" rel="noopener">&#9990; WPP: <?php echo esc_html($wpp); ?></a><?php endif; ?>
    <div class="desc"><?php the_excerpt(); ?></div>
    <a class="btn-perfil" href="<?php the_permalink(); ?>">VISITAR PERFIL</a>
  </div>
</article>
