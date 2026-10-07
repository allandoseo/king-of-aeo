<?php
/**
 * Post de galeria.
 * Coluna cheia, sem barra lateral: com 20 fotos, cada pixel de largura conta.
 */
if (!defined('ABSPATH')) exit;
get_header();
?>

<?php while (have_posts()) : the_post();
  $fotos = ahn_fotos_do_post();
  $total = count($fotos);
  $texto = apply_filters('the_content', get_the_content());
  if ($total) $texto = ahn_texto_sem_imagens($texto);
?>

<article <?php post_class('ahn-galeria-post'); ?> id="conteudo">

  <?php ahn_etiqueta_cat(); ?>
  <h1><?php the_title(); ?></h1>
  <p class="ahn-meta">
    <?php if ($total) : ?>
      <?php echo (int) $total; ?> <?php echo $total === 1 ? 'foto' : 'fotos'; ?> &middot;
    <?php endif; ?>
    <?php echo esc_html(get_the_date()); ?>
  </p>

  <?php if (trim(wp_strip_all_tags($texto))) : ?>
    <div class="ahn-intro"><?php echo $texto; ?></div>
  <?php endif; ?>

  <?php if ($total) : ?>
    <div class="ahn-grade-fotos">
      <?php $i = 0;
      foreach ($fotos as $foto) : $i++;
        $grande = wp_get_attachment_image_url($foto->ID, 'large');
        if (!$grande) $grande = wp_get_attachment_image_url($foto->ID, 'full');
        $alt = get_post_meta($foto->ID, '_wp_attachment_image_alt', true);
      ?>
        <button type="button" class="ahn-foto"
                data-i="<?php echo (int) ($i - 1); ?>"
                data-grande="<?php echo esc_url($grande); ?>"
                data-n="<?php echo (int) $i . '/' . (int) $total; ?>"
                aria-label="Abrir foto <?php echo (int) $i; ?> de <?php echo (int) $total; ?>">
          <?php /* 'medium_large' nao e recortado: a foto mantem a proporcao
                   original, que e o que faz o masonry ter altura variada */ ?>
          <?php echo wp_get_attachment_image($foto->ID, 'medium_large', false, [
            'loading' => 'lazy',
            'alt'     => $alt ? $alt : '',
          ]); ?>
        </button>
      <?php endforeach; ?>
    </div>
  <?php endif; ?>

  <?php
  /* Tag que e uma URL nunca e tag de verdade — e lixo que algum importador
     despejou no campo errado. Alem de feia, publica o endereco de origem.
     Filtra aqui para a pagina nao depender de o banco estar limpo. */
  $tags = get_the_tags();
  if ($tags) {
    $tags = array_filter($tags, function ($t) {
      $n = trim($t->name);
      if (preg_match('#^(https?:)?//#i', $n)) return false;   // http:// ou //
      if (preg_match('#^https?//#i', $n))     return false;   // http// sem os dois pontos
      if (preg_match('#\.(com|net|org|br|xxx)(/|$)#i', $n)) return false;
      if (strlen($n) > 60) return false;                      // frase inteira nao e tag
      return true;
    });
  }
  if ($tags) : ?>
    <div class="ahn-tags">
      <?php foreach ($tags as $t) : ?>
        <a href="<?php echo esc_url(get_tag_link($t->term_id)); ?>"><?php echo esc_html($t->name); ?></a>
      <?php endforeach; ?>
    </div>
  <?php endif; ?>

  <?php
  $ant = get_previous_post(true);
  $pro = get_next_post(true);
  if ($ant || $pro) : ?>
    <nav class="ahn-vizinhos" aria-label="Outros posts">
      <?php if ($ant) : ?>
        <a href="<?php echo esc_url(get_permalink($ant)); ?>">
          <small>&lsaquo; Anterior</small><?php echo esc_html(get_the_title($ant)); ?>
        </a>
      <?php else : ?><span></span><?php endif; ?>
      <?php if ($pro) : ?>
        <a href="<?php echo esc_url(get_permalink($pro)); ?>" class="dir">
          <small>Próximo &rsaquo;</small><?php echo esc_html(get_the_title($pro)); ?>
        </a>
      <?php endif; ?>
    </nav>
  <?php endif; ?>

  <?php
  // relacionados da mesma categoria: segura a pessoa no site e distribui
  // forca interna entre os posts, em vez de concentrar tudo na home
  $cat = ahn_categoria();
  if ($cat) :
    $mais = new WP_Query([
      'cat'                 => $cat->term_id,
      'posts_per_page'      => 4,
      'post__not_in'        => [get_the_ID()],
      'ignore_sticky_posts' => true,
    ]);
    if ($mais->have_posts()) : ?>
      <h2 class="ahn-secao">Mais de <?php echo esc_html($cat->name); ?></h2>
      <div class="ahn-relacionados">
        <?php while ($mais->have_posts()) : $mais->the_post();
          get_template_part('template-parts/card');
        endwhile; ?>
      </div>
    <?php endif;
    wp_reset_postdata();
  endif; ?>

  <?php if (comments_open() || get_comments_number()) comments_template(); ?>

</article>

<?php endwhile; ?>

<?php if (is_singular('post')) : ?>
<div class="lb" id="ahn-lb" hidden role="dialog" aria-modal="true" aria-label="Foto ampliada">
  <button class="lb__bt lb__fecha" id="ahn-lb-fecha" aria-label="Fechar">&times;</button>
  <button class="lb__bt lb__ant" id="ahn-lb-ant" aria-label="Anterior">&lsaquo;</button>
  <div class="lb__palco" id="ahn-lb-palco"></div>
  <button class="lb__bt lb__pro" id="ahn-lb-pro" aria-label="Próxima">&rsaquo;</button>
  <div class="lb__conta" id="ahn-lb-conta"></div>
</div>
<?php endif; ?>

<?php get_footer(); ?>
