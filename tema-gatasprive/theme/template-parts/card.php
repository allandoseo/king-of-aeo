<?php
/**
 * Card do anuncio na grade.
 * A foto preenche o card inteiro; o degrade no CSS garante que o nome continue
 * legivel tanto sobre foto escura quanto clara.
 */
if (!defined('ABSPATH')) exit;

$capa   = gp_capa_id();
$bairro = gp_bairro();
$cidade = get_theme_mod('gp_cidade', 'Goiânia');
$resumo = get_the_excerpt();
if (!$resumo) $resumo = wp_trim_words(wp_strip_all_tags(get_the_content()), 18, '…');
?>
<a href="<?php the_permalink(); ?>" <?php post_class('gp-card'); ?>>
  <?php if (gp_e_destaque()) : ?>
    <span class="gp-selo">Destaque</span>
  <?php endif; ?>

  <span class="gp-card__foto">
    <?php if ($capa) echo wp_get_attachment_image($capa, 'gp-card', false,
      ['loading' => 'lazy', 'alt' => '']); ?>
  </span>

  <span class="gp-card__texto">
    <span class="gp-card__nome"><?php the_title(); ?></span>
    <?php if ($resumo) : ?>
      <span class="gp-card__resumo"><?php echo esc_html($resumo); ?></span>
    <?php endif; ?>
    <span class="gp-card__tags">
      <span class="gp-tag"><?php echo esc_html($cidade); ?></span>
      <?php if ($bairro) : ?>
        <span class="gp-tag"><?php echo esc_html($bairro->name); ?></span>
      <?php endif; ?>
    </span>
  </span>
</a>
