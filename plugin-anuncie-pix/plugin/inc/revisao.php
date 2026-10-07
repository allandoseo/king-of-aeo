<?php
/**
 * Liberacao das alteracoes que o anunciante enviou.
 *
 * O PROBLEMA QUE ISTO RESOLVE: quem paga R$ 49 e ganha o direito de editar uma
 * pagina publicada do seu site pode, depois de aprovado, trocar o texto por
 * qualquer coisa. Num site deste ramo isso nao e hipotese remota, e o que
 * aparece na pagina e sua responsabilidade, nao da pessoa que anunciou.
 *
 * E A SOLUCAO QUE NAO CASTIGA O ANUNCIANTE: a alteracao fica guardada em meta e
 * o anuncio CONTINUA NO AR com o conteudo anterior. Ninguem fica sem anuncio
 * esperando voce acordar — o que estava valendo continua valendo. As fotos
 * novas ficam soltas do post, sem pai, para nenhuma galeria do tema mostrar
 * foto que ainda nao foi conferida.
 *
 * Telefone e WhatsApp nunca esperam: sao dado de contato, nao conteudo, e
 * segurar a troca de numero por um dia e o tipo de atrito que faz o anunciante
 * ir embora.
 *
 * Para liberar na hora e sem conferir nada, desligue "Conferir alteracoes" no
 * painel. A escolha e sua; o padrao e conferir.
 */

if (!defined('ABSPATH')) exit;

/* ------------------------------------------------- aviso no topo do admin */
add_action('admin_notices', function () {
  if (!current_user_can('edit_posts')) return;

  $ids = apix_com_alteracao_pendente(20);
  if (!$ids) return;

  $url = admin_url('edit.php?post_type=' . apix_cpt() . '&apix_filtro=pendente');
  printf(
    '<div class="notice notice-warning"><p><strong>%d anuncio(s)</strong> com alteracao '
    . 'aguardando liberacao. Os anuncios seguem no ar com o conteudo anterior. '
    . '<a href="%s">Ver a lista</a></p></div>',
    count($ids), esc_url($url)
  );
});

/** IDs com alteracao de texto esperando, ou com foto esperando. */
function apix_com_alteracao_pendente($quantos = 20) {
  $texto = get_posts([
    'post_type'   => apix_cpt(),
    'post_status' => 'any',
    'numberposts' => $quantos,
    'fields'      => 'ids',
    'meta_key'    => 'apix_pendente',
    'meta_compare'=> 'EXISTS',
  ]);

  // fotos soltas apontando para anuncios
  $fotos = get_posts([
    'post_type'   => 'attachment',
    'post_status' => 'inherit',
    'numberposts' => 50,
    'fields'      => 'ids',
    'meta_key'    => 'apix_espera_de',
    'meta_compare'=> 'EXISTS',
  ]);
  $com_foto = [];
  foreach ($fotos as $f) {
    $dono = (int) get_post_meta($f, 'apix_espera_de', true);
    if ($dono) $com_foto[$dono] = true;
  }

  return array_values(array_unique(array_merge(array_map('intval', $texto), array_keys($com_foto))));
}

/* ----------------------------------------------- filtro na listagem do admin */
add_action('pre_get_posts', function ($q) {
  if (!is_admin() || !$q->is_main_query()) return;
  if (empty($_GET['apix_filtro']) || $_GET['apix_filtro'] !== 'pendente') return;
  if ($q->get('post_type') !== apix_cpt()) return;

  $ids = apix_com_alteracao_pendente(100);
  $q->set('post__in', $ids ? $ids : [0]);   // [0] para nao listar tudo quando nao ha nenhum
});

/* ------------------------------------------------------------------ metabox */
add_action('add_meta_boxes', function () {
  add_meta_box('apix_revisao', 'Alteracao do anunciante', 'apix_metabox', apix_cpt(), 'normal', 'high');
});

function apix_metabox($post) {
  $pend  = get_post_meta($post->ID, 'apix_pendente', true);
  $fotos = apix_fotos_em_analise($post->ID);

  if (!is_array($pend) && !$fotos) {
    echo '<p>Nada aguardando liberacao.</p>';
    return;
  }

  echo '<p><strong>O anuncio esta no ar com o conteudo atual.</strong> '
     . 'O que esta abaixo so aparece depois que voce liberar.</p>';

  if (is_array($pend)) {
    $titulo_novo = (string) ($pend['titulo'] ?? '');
    $texto_novo  = (string) ($pend['texto'] ?? '');

    if ($titulo_novo !== '' && $titulo_novo !== $post->post_title) {
      echo '<h4>Nome</h4><table class="widefat" style="margin-bottom:1rem"><tbody>';
      printf('<tr><td style="width:50%%;background:#fdeceb">%s</td><td style="background:#dff3e4">%s</td></tr>',
        esc_html($post->post_title), esc_html($titulo_novo));
      echo '</tbody></table>';
    }

    if ($texto_novo !== '' && $texto_novo !== $post->post_content) {
      echo '<h4>Descricao</h4>';
      echo '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">';
      printf('<div style="background:#fdeceb;padding:.7rem;border-radius:4px">'
        . '<strong>Esta no ar</strong><br>%s</div>', wp_kses_post($post->post_content));
      printf('<div style="background:#dff3e4;padding:.7rem;border-radius:4px">'
        . '<strong>Quer trocar por</strong><br>%s</div>', wp_kses_post($texto_novo));
      echo '</div>';
    }

    if (!empty($pend['quando'])) {
      printf('<p><small>Enviada em %s.</small></p>',
        esc_html(date_i18n('d/m/Y H:i', strtotime((string) $pend['quando']))));
    }
  }

  if ($fotos) {
    echo '<h4>Fotos novas</h4><div style="display:flex;gap:.6rem;flex-wrap:wrap">';
    foreach ($fotos as $fid) {
      printf('<img src="%s" style="width:130px;height:auto;border:2px dashed #e0a800;border-radius:4px" alt="">',
        esc_url(wp_get_attachment_image_url($fid, 'medium')));
    }
    echo '</div>';
  }

  wp_nonce_field('apix_revisar_' . $post->ID, 'apix_rev_nonce');
  echo '<p style="margin-top:1.2rem;display:flex;gap:.6rem">';
  submit_button('Liberar', 'primary', 'apix_liberar', false);
  submit_button('Recusar e descartar', 'delete', 'apix_recusar', false);
  echo '</p>';
  echo '<p><small>Liberar aplica o texto e anexa as fotos. Recusar descarta a '
     . 'alteracao e apaga as fotos novas; o anuncio nao muda.</small></p>';
}

/**
 * Trata os botoes do metabox.
 *
 * save_post com prioridade alta e a checagem de capability na frente: sem ela,
 * qualquer requisicao com os campos certos liberaria conteudo nao conferido —
 * seria o mesmo buraco que a analise existe para fechar.
 */
add_action('save_post', function ($post_id, $post) {
  // Trava de reentrancia. wp_update_post() dentro de apix_libera() dispara
  // save_post de novo, e sem isto a funcao se chamaria em loop.
  //
  // A tentacao aqui e remove_all_actions('save_post'), que resolveria o loop e
  // arrancaria, de passagem, os ganchos de TODOS os outros plugins pelo resto
  // da requisicao — cache nao invalidado, indice de busca nao atualizado, e
  // nenhuma mensagem de erro para ligar uma coisa a outra.
  static $dentro = false;
  if ($dentro) return;

  if (wp_is_post_revision($post_id) || wp_is_post_autosave($post_id)) return;
  if ($post->post_type !== apix_cpt()) return;
  if (!current_user_can('edit_post', $post_id)) return;

  $liberar = isset($_POST['apix_liberar']);
  $recusar = isset($_POST['apix_recusar']);
  if (!$liberar && !$recusar) return;

  if (!isset($_POST['apix_rev_nonce'])
   || !wp_verify_nonce($_POST['apix_rev_nonce'], 'apix_revisar_' . $post_id)) return;

  $dentro = true;
  if ($liberar) apix_libera($post_id);
  else          apix_recusa($post_id);
  $dentro = false;
}, 20, 2);

/** Aplica a alteracao guardada. */
function apix_libera($post_id) {
  $pend = get_post_meta($post_id, 'apix_pendente', true);

  if (is_array($pend)) {
    $campos = ['ID' => $post_id];
    if (!empty($pend['titulo'])) $campos['post_title']   = (string) $pend['titulo'];
    if (!empty($pend['texto']))  $campos['post_content'] = (string) $pend['texto'];

    wp_update_post($campos);

    delete_post_meta($post_id, 'apix_pendente');
  }

  foreach (apix_fotos_em_analise($post_id) as $fid) {
    wp_update_post(['ID' => $fid, 'post_parent' => $post_id]);
    delete_post_meta($fid, 'apix_espera_de');
    if (!get_post_thumbnail_id($post_id)) set_post_thumbnail($post_id, $fid);
  }

  do_action('apix_alteracao_liberada', $post_id);
}

/** Descarta a alteracao e apaga as fotos que esperavam. */
function apix_recusa($post_id) {
  delete_post_meta($post_id, 'apix_pendente');
  foreach (apix_fotos_em_analise($post_id) as $fid) {
    wp_delete_attachment($fid, true);
  }
  do_action('apix_alteracao_recusada', $post_id);
}

/* --------------------------------------------------------------- renovacao */

/**
 * Sobe o prazo de um anuncio renovado.
 *
 * SOMA ao que resta, nao substitui: quem renova com 5 dias sobrando nao pode
 * perder esses 5 dias por ter pagado adiantado. Quem renova depois de vencer
 * parte de hoje, porque o prazo vencido nao volta.
 */
function apix_aplica_renovacao($post_id) {
  $cobranca = (string) get_post_meta($post_id, 'apix_renov_cobranca', true);
  if ($cobranca === '') return;

  $plano = apix_plano((string) get_post_meta($post_id, 'apix_renov_plano', true));
  $dias  = $plano ? max(1, (int) $plano['dias']) : 30;

  $resta = (int) get_post_meta($post_id, 'apix_expira', true);
  $base  = $resta > time() ? $resta : time();

  update_post_meta($post_id, 'apix_expira', $base + $dias * DAY_IN_SECONDS);
  update_post_meta($post_id, 'apix_status', 'RECEIVED');

  if ($plano) {
    update_post_meta($post_id, 'apix_plano', $plano['slug']);
    update_post_meta($post_id, 'dmix_vip', !empty($plano['vip']) ? 1 : 0);
    update_post_meta($post_id, 'dmix_destaque', !empty($plano['destaque']) ? 1 : 0);
  }

  // volta ao ar se tinha vencido
  if (get_post_status($post_id) !== 'publish') {
    wp_update_post(['ID' => $post_id, 'post_status' => 'publish']);
  }

  // a cobranca de renovacao virou a cobranca corrente
  update_post_meta($post_id, 'apix_cobranca', $cobranca);
  delete_post_meta($post_id, 'apix_renov_cobranca');
  delete_post_meta($post_id, 'apix_renov_plano');
  delete_post_meta($post_id, 'apix_qr');

  do_action('apix_anuncio_renovado', $post_id);
}
