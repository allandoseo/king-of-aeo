<?php get_header(); ?>

<?php while (have_posts()) : the_post();
  $id    = get_the_ID();
  $tel   = get_post_meta($id, 'dmix_tel', true);
  $wpp   = get_post_meta($id, 'dmix_wpp', true);
  $cache = get_post_meta($id, 'dmix_cache', true);
  $loc   = dmix_local_do_perfil($id);
  $fotos = dmix_galeria_ids($id);
?>

<h1 class="sec-title perfil-titulo"><span class="pin" aria-hidden="true">&#9679;</span> <?php the_title(); ?></h1>

<div class="perfil-topo">

  <div class="perfil-contato">
    <?php if ($tel) : ?>
      <a class="btn btn-tel" href="tel:<?php echo esc_attr(preg_replace('/\D/', '', $tel)); ?>">
        <span class="ic">&#9742;</span> FONE: <?php echo esc_html($tel); ?>
      </a>
    <?php endif; ?>
    <?php if ($wpp) : ?>
      <a class="btn btn-wpp" href="https://wa.me/<?php echo esc_attr($wpp); ?>" target="_blank" rel="noopener nofollow">
        <span class="ic">&#9990;</span> WPP: <?php echo esc_html($tel ?: $wpp); ?>
      </a>
    <?php endif; ?>

    <div class="perfil-texto"><?php the_content(); ?></div>
  </div>

  <aside class="perfil-dados">
    <h2>Dados do anúncio</h2>
    <dl>
      <div><dt>Nome</dt><dd><?php the_title(); ?></dd></div>
      <?php if ($loc['estado']) : ?>
        <div><dt>Estado</dt><dd><?php echo esc_html($loc['estado']); ?></dd></div>
      <?php endif; ?>
      <?php if ($loc['cidade']) : ?>
        <div><dt>Cidade</dt>
          <dd><?php if (!is_wp_error($loc['cidade_link'])) : ?>
            <a href="<?php echo esc_url($loc['cidade_link']); ?>"><?php echo esc_html($loc['cidade']); ?></a>
          <?php else : echo esc_html($loc['cidade']); endif; ?></dd></div>
      <?php endif; ?>
      <?php if ($cache) : ?>
        <div><dt>Cachê</dt><dd><?php echo esc_html($cache); ?></dd></div>
      <?php endif; ?>
    </dl>
  </aside>

</div>

<?php if ($fotos || has_post_thumbnail()) : ?>
  <h2 class="sec-title">Confira minhas fotos</h2>
  <div class="perfil-galeria">
    <?php
    if (!$fotos && has_post_thumbnail()) { $fotos = [get_post_thumbnail_id($id)]; }
    foreach ($fotos as $att) :
      $full = wp_get_attachment_image_url($att, 'full');
      if (!$full) continue; ?>
      <a href="<?php echo esc_url($full); ?>" target="_blank" rel="noopener">
        <?php echo wp_get_attachment_image($att, 'large', false, ['loading' => 'lazy', 'decoding' => 'async']); ?>
      </a>
    <?php endforeach; ?>
  </div>
<?php endif; ?>

<p class="perfil-lembrete">
  Não se esqueça de dizer no contato que você viu o anúncio no site <strong><?php bloginfo('name'); ?></strong>.
</p>

<?php
  // busca direta: wp_list_comments() depende da query montada por
  // comments_template(), que nao roda aqui
  $comentarios = get_comments(array(
    'post_id' => $id, 'status' => 'approve', 'order' => 'ASC', 'type' => 'comment',
  ));
?>
<?php if (comments_open() || $comentarios) : ?>
  <div class="perfil-comentarios">
    <div class="pc-form">
      <h2 class="sec-title">O que achou? Deixe seu comentário</h2>
      <p class="pc-nota">
        Aqui você pode fazer elogios. Para comentar, basta preencher o formulário.
        Este não é canal de comunicação com quem anuncia — para contato, use o telefone
        ou o WhatsApp acima. Comentários passam por aprovação antes de aparecer.
      </p>
      <?php comment_form([
        'title_reply'         => '',
        'comment_notes_before'=> '',
        'comment_notes_after' => '',
        'label_submit'        => 'Comentar',
        'comment_field'       => '<p class="cf"><label for="comment">Mensagem</label>'
                               . '<textarea id="comment" name="comment" rows="5" required></textarea></p>',
        'fields'              => [
          'author' => '<p class="cf"><label for="author">Apelido</label>'
                    . '<input id="author" name="author" type="text" required></p>',
        ],
      ]); ?>
    </div>

    <div class="pc-lista">
      <h2 class="sec-title dark">Veja os comentários</h2>
      <?php if ($comentarios) : ?>
        <ol class="pc-itens">
          <?php foreach ($comentarios as $c) : ?>
            <li class="pc-item">
              <div class="pc-balao"><?php echo wpautop(esc_html($c->comment_content)); ?></div>
              <p class="pc-meta">Comentado por <strong><?php echo esc_html($c->comment_author); ?></strong>
                em <?php echo esc_html(mysql2date('d/m/Y', $c->comment_date)); ?></p>
            </li>
          <?php endforeach; ?>
        </ol>
      <?php else : ?>
        <p class="pc-vazio">Ainda não há comentários neste anúncio.</p>
      <?php endif; ?>
    </div>
  </div>
<?php endif; ?>

<?php endwhile; ?>

<?php get_footer(); ?>
