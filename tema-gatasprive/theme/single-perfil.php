<?php
/**
 * Pagina do anuncio.
 * Galeria a esquerda, painel com dados e WhatsApp a direita — o botao verde e
 * o unico objetivo da pagina, entao fica acima da dobra em qualquer tela.
 */
if (!defined('ABSPATH')) exit;
get_header();

$cidade = get_theme_mod('gp_cidade', 'Goiânia');

while (have_posts()) : the_post();
  $capa   = gp_capa_id();
  $fotos  = gp_fotos();
  $bairro = gp_bairro();
  $wpp    = gp_whatsapp();
?>

<div class="gp-perfil" id="conteudo">

  <div>
    <div class="gp-galeria">
      <?php if ($capa) : ?>
        <button type="button" class="gp-galeria__principal" data-i="0"
                data-grande="<?php echo esc_url(wp_get_attachment_image_url($capa, 'gp-grande')); ?>"
                aria-label="Ampliar foto 1">
          <?php echo wp_get_attachment_image($capa, 'gp-grande', false,
            ['alt' => esc_attr(get_the_title())]); ?>
        </button>
      <?php endif; ?>

      <?php $i = $capa ? 1 : 0;
      foreach ($fotos as $foto) : ?>
        <button type="button" class="gp-galeria__mini" data-i="<?php echo (int) $i; ?>"
                data-grande="<?php echo esc_url(wp_get_attachment_image_url($foto->ID, 'gp-grande')); ?>"
                aria-label="Ampliar foto <?php echo (int) ($i + 1); ?>">
          <?php echo wp_get_attachment_image($foto->ID, 'gp-card', false,
            ['loading' => 'lazy', 'alt' => '']); ?>
        </button>
      <?php $i++; endforeach; ?>
    </div>
  </div>

  <aside class="gp-perfil__painel">
    <h1><?php the_title(); ?></h1>

    <p class="gp-perfil__local">
      <?php echo esc_html($cidade); ?>
      <?php if ($bairro) : ?>
        &middot; <a href="<?php echo esc_url(get_term_link($bairro)); ?>"><b><?php echo esc_html($bairro->name); ?></b></a>
      <?php endif; ?>
    </p>

    <?php
    $linhas = [];
    foreach (gp_campos() as $k => $rotulo) {
      $v = trim((string) get_post_meta(get_the_ID(), $k, true));
      if ($v !== '') $linhas[$rotulo] = $v;
    }
    if ($linhas) : ?>
      <ul class="gp-dados">
        <?php foreach ($linhas as $rotulo => $v) : ?>
          <li><span><?php echo esc_html($rotulo); ?></span><b><?php echo esc_html($v); ?></b></li>
        <?php endforeach; ?>
      </ul>
    <?php endif; ?>

    <?php if ($wpp) :
      $msg = rawurlencode('Oi! Vi seu anuncio no ' . get_bloginfo('name') . '.');
    ?>
      <a href="https://wa.me/<?php echo esc_attr($wpp); ?>?text=<?php echo $msg; ?>"
         class="gp-bt gp-bt--zap" style="width:100%;justify-content:center"
         rel="nofollow noopener" target="_blank">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2zm5.6 14.2c-.2.6-1.2 1.2-1.7 1.2-.4 0-1 .1-3.3-.8-2.8-1.2-4.5-4-4.6-4.2-.1-.2-1.1-1.4-1.1-2.7s.7-1.9.9-2.1c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.1 1 2 1.3 2.3 1.4.2.1.4.1.6-.1l.8-1c.2-.2.3-.2.6-.1l2 .9c.2.1.4.2.4.3.1.2.1.6 0 1z"/>
        </svg>
        Chamar no WhatsApp
      </a>
    <?php endif; ?>

    <?php if (trim(wp_strip_all_tags(get_the_content()))) : ?>
      <div class="gp-perfil__texto">
        <h2>Sobre</h2>
        <?php the_content(); ?>
      </div>
    <?php endif; ?>

    <div class="gp-aviso-cx">
      Confira os dados antes de combinar. O site divulga o anúncio e não intermedia
      nem se responsabiliza pelo que for combinado entre as partes.
    </div>
  </aside>

</div>

<?php
/* ---- outros do mesmo bairro: mantem a pessoa no site ---- */
if ($bairro) :
  $mais = gp_consulta([
    'posts_per_page' => 4,
    'post__not_in'   => [get_the_ID()],
    'tax_query'      => [['taxonomy' => 'bairro', 'field' => 'term_id', 'terms' => $bairro->term_id]],
  ]);
  if ($mais->have_posts()) : ?>
    <div class="gp-secao"><h2>Também no <?php echo esc_html($bairro->name); ?></h2></div>
    <div class="gp-grade">
      <?php while ($mais->have_posts()) : $mais->the_post();
        get_template_part('template-parts/card');
      endwhile; ?>
    </div>
  <?php endif;
  wp_reset_postdata();
endif; ?>

<div class="gp-lb" id="gp-lb" hidden role="dialog" aria-modal="true" aria-label="Foto ampliada">
  <button class="gp-lb__bt gp-lb__fecha" id="gp-lb-fecha" aria-label="Fechar">&times;</button>
  <button class="gp-lb__bt gp-lb__ant" id="gp-lb-ant" aria-label="Anterior">&lsaquo;</button>
  <div class="gp-lb__palco" id="gp-lb-palco"></div>
  <button class="gp-lb__bt gp-lb__pro" id="gp-lb-pro" aria-label="Próxima">&rsaquo;</button>
  <div class="gp-lb__conta" id="gp-lb-conta"></div>
</div>

<?php endwhile; ?>

<?php get_footer(); ?>
