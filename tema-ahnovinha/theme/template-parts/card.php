<?php
/**
 * Card da grade masonry.
 *
 * A capa sai em tamanho grande e altura natural — e isso que faz o masonry
 * funcionar. Sem recorte fixo, cada card tem a altura da propria imagem.
 *
 * No lugar do contador de curtidas do design entra a contagem de fotos:
 * curtida aqui seria numero inventado, contagem de foto e dado real.
 */
if (!defined('ABSPATH')) exit;

$capa = ahn_capa_id();
$qtd  = ahn_qtd_fotos();
$cat  = ahn_categoria();
?>
<article <?php post_class('ahn-card'); ?>>
  <a href="<?php the_permalink(); ?>" class="ahn-card__capa">
    <?php if ($capa) {
      echo wp_get_attachment_image($capa, 'large', false, ['loading' => 'lazy', 'alt' => '']);
    } ?>
    <?php if ($qtd) : ?>
      <span class="ahn-card__qtd">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.2" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2"></rect>
          <circle cx="8.5" cy="10" r="1.6"></circle>
          <path d="m21 16-5-5L7 19"></path>
        </svg>
        <?php echo (int) $qtd; ?>
      </span>
    <?php endif; ?>
  </a>

  <div class="ahn-card__texto">
    <h3><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3>
    <span class="ahn-card__meta">
      <?php if ($cat) : ?>
        <?php echo esc_html($cat->name); ?>
      <?php else : ?>
        <?php echo esc_html(get_the_date()); ?>
      <?php endif; ?>
    </span>
  </div>
</article>
