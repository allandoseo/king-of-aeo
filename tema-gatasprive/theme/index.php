<?php
/**
 * Home, arquivo de anuncios, bairro, categoria e busca.
 * Um arquivo so: as quatro listagens tem o mesmo desenho, muda o titulo.
 */
if (!defined('ABSPATH')) exit;
get_header();

$cidade = get_theme_mod('gp_cidade', 'Goiânia');

/* ---- titulo, migalha e texto de abertura, conforme a tela ---- */
if (is_tax('bairro')) {
  $termo  = get_queried_object();
  $titulo = 'Acompanhantes no ' . $termo->name;
  $intro  = term_description($termo);
  $migalha = '<a href="' . esc_url(home_url('/')) . '">' . esc_html($cidade) . '</a> &rsaquo; ' . esc_html($termo->name);
} elseif (is_search()) {
  $titulo = 'Resultados para "' . get_search_query() . '"';
  $intro = '';
  $migalha = '<a href="' . esc_url(home_url('/')) . '">' . esc_html($cidade) . '</a> &rsaquo; Busca';
} else {
  $titulo = 'Acompanhantes em ' . $cidade;
  $intro  = get_theme_mod('gp_intro', '');
  $migalha = esc_html($cidade) . ' &rsaquo; Acompanhantes';
}

$primeira = !is_paged();
?>

<?php if ($intro && $primeira) : ?>
  <div class="gp-wrap">
    <section class="gp-intro">
      <h1><?php echo esc_html($titulo); ?></h1>
      <?php echo wpautop(wp_kses_post($intro)); ?>
    </section>
  </div>
<?php endif; ?>

<?php
/* ---- faixa de destaques: so na home, so na primeira pagina ---- */
if ($primeira && (is_home() || is_front_page())) :
  $dest = gp_consulta([
    'posts_per_page' => 16,
    'meta_query'     => [['key' => 'gp_destaque', 'value' => '1']],
  ]);
  if ($dest->have_posts()) : ?>
    <section aria-label="Em destaque">
      <div class="gp-destaques">
        <?php while ($dest->have_posts()) : $dest->the_post();
          $capa = gp_capa_id(); ?>
          <a href="<?php the_permalink(); ?>" class="gp-dest">
            <span class="gp-dest__foto">
              <?php if ($capa) echo wp_get_attachment_image($capa, 'gp-dest', false,
                ['loading' => 'lazy', 'alt' => '']); ?>
            </span>
            <span class="gp-dest__nome"><?php the_title(); ?></span>
          </a>
        <?php endwhile; ?>
      </div>
    </section>
  <?php endif;
  wp_reset_postdata();
endif; ?>

<div class="gp-secao" id="conteudo">
  <?php if ($intro && $primeira) : ?>
    <h2><?php echo esc_html($titulo); ?></h2>
  <?php else : ?>
    <h1><?php echo esc_html($titulo); ?></h1>
  <?php endif; ?>
  <p class="gp-migalha"><?php echo $migalha; ?></p>
</div>

<?php if (have_posts()) : ?>

  <div class="gp-grade" id="gp-grade">
    <?php while (have_posts()) : the_post();
      get_template_part('template-parts/card');
    endwhile; ?>
  </div>

  <?php gp_paginacao(); ?>

<?php else : ?>

  <div class="gp-vazio">
    <h1><?php echo is_search() ? 'Nada encontrado' : 'Ainda não há anúncios aqui'; ?></h1>
    <p>
      <?php if (is_search()) : ?>
        Nenhum anúncio bateu com essa busca. Tente outro nome ou bairro.
      <?php else : ?>
        Os anúncios aparecem aqui assim que forem publicados.
      <?php endif; ?>
    </p>
    <a class="gp-bt gp-bt--roxo" href="<?php echo esc_url(home_url('/')); ?>">Ver todos os anúncios</a>
  </div>

<?php endif; ?>

<?php get_footer(); ?>
