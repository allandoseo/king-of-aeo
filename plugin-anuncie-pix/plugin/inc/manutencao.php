<?php
/**
 * Manutencao de hora em hora: vence plano, limpa abandonado e recupera o Pix
 * que caiu sem o webhook chegar.
 */

if (!defined('ABSPATH')) exit;

add_action(APIX_CRON, 'apix_manutencao_roda');

function apix_manutencao_roda() {
  apix_vence_planos();
  apix_limpa_abandonados();
  apix_confere_pendentes();
  apix_confere_renovacoes();
  apix_limpa_fotos_orfas();
}

/** Tira do ar o que passou do prazo do plano. */
function apix_vence_planos() {
  $ids = get_posts([
    'post_type'   => apix_cpt(),
    'post_status' => 'publish',
    'numberposts' => 50,
    'fields'      => 'ids',
    'meta_query'  => [[
      'key'     => 'apix_expira',
      'value'   => time(),
      'compare' => '<',
      'type'    => 'NUMERIC',
    ]],
  ]);

  foreach ($ids as $id) apix_despublica($id, 'plano vencido');
}

/**
 * Apaga rascunho que nunca pagou, com as fotos.
 *
 * Sem isso o site vira hospedagem de imagem de graca: sobe foto, nao paga, o
 * arquivo fica no servidor para sempre. E o disco enche sem ninguem notar,
 * porque rascunho nao aparece no site.
 *
 * So apaga o que o proprio plugin criou (tem apix_token) e que nunca foi
 * publicado. Rascunho escrito a mao no admin nao e tocado.
 */
function apix_limpa_abandonados() {
  $horas = max(2, (int) apix_config()['abandono_h']);
  $corte = gmdate('Y-m-d H:i:s', time() - $horas * HOUR_IN_SECONDS);

  $ids = get_posts([
    'post_type'       => apix_cpt(),
    'post_status'     => 'draft',
    'numberposts'     => 30,
    'fields'          => 'ids',
    'date_query'      => [['before' => $corte, 'column' => 'post_modified_gmt']],
    'meta_query'      => [
      'relation' => 'AND',
      ['key' => 'apix_token',       'compare' => 'EXISTS'],
      ['key' => 'apix_publicado_em','compare' => 'NOT EXISTS'],
    ],
  ]);

  foreach ($ids as $id) {
    $status = (string) get_post_meta($id, 'apix_status', true);
    if (in_array($status, apix_status_pagos(), true)) continue;   // pago: nao mexe

    apix_apaga_fotos($id);
    wp_delete_post($id, true);
  }
}

/**
 * Rede de seguranca: confere na API os anuncios ainda pendentes.
 *
 * Webhook se perde. O servidor estava fora do ar no minuto do aviso, o Asaas
 * desistiu depois das tentativas, alguem mexeu na configuracao. Sem esta
 * conferencia o anunciante pagou e o anuncio nao subiu — e e voce quem
 * descobre pelo WhatsApp dele, irritado, no dia seguinte.
 *
 * So os das ultimas 72 horas, no maximo 10 por rodada: a API tem limite de
 * requisicoes e isto roda a cada hora.
 */
function apix_confere_pendentes() {
  if (apix_chave() === '') return;

  $ids = get_posts([
    'post_type'   => apix_cpt(),
    'post_status' => 'draft',
    'numberposts' => 10,
    'fields'      => 'ids',
    'date_query'  => [['after' => gmdate('Y-m-d H:i:s', time() - 72 * HOUR_IN_SECONDS),
                       'column' => 'post_date_gmt']],
    'meta_query'  => [
      'relation' => 'AND',
      ['key' => 'apix_cobranca',    'compare' => 'EXISTS'],
      ['key' => 'apix_publicado_em','compare' => 'NOT EXISTS'],
    ],
  ]);

  foreach ($ids as $id) {
    $cobranca = (string) get_post_meta($id, 'apix_cobranca', true);
    if ($cobranca === '') continue;

    $real = apix_cobranca_status($cobranca);
    if (is_wp_error($real) || empty($real['status'])) continue;

    $status = strtoupper((string) $real['status']);
    update_post_meta($id, 'apix_status', $status);

    if (in_array($status, apix_status_pagos(), true)) {
      apix_log('resgate', 'anuncio ' . $id . ' estava pago e nao tinha publicado');
      apix_publica($id);
    }
  }
}

/**
 * A mesma rede de seguranca, para renovacao.
 *
 * apix_confere_pendentes() so olha rascunho sem apix_publicado_em, entao nao ve
 * renovacao nenhuma: anuncio renovado ja esta publicado e ja tem essa meta. Sem
 * esta funcao, uma renovacao cujo webhook se perdeu some em silencio — o
 * anunciante pagou, o prazo nao subiu, e o anuncio cai no vencimento antigo.
 */
function apix_confere_renovacoes() {
  if (apix_chave() === '') return;

  $ids = get_posts([
    'post_type'    => apix_cpt(),
    'post_status'  => 'any',
    'numberposts'  => 10,
    'fields'       => 'ids',
    'meta_key'     => 'apix_renov_cobranca',
    'meta_compare' => 'EXISTS',
  ]);

  foreach ($ids as $id) {
    $cobranca = (string) get_post_meta($id, 'apix_renov_cobranca', true);
    if ($cobranca === '') continue;

    $real = apix_cobranca_status($cobranca);
    if (is_wp_error($real) || empty($real['status'])) continue;

    if (in_array(strtoupper((string) $real['status']), apix_status_pagos(), true)) {
      apix_log('resgate', 'renovacao do anuncio ' . $id . ' estava paga e nao tinha subido o prazo');
      apix_aplica_renovacao($id);
    }
  }
}

/**
 * Apaga foto que ficou esperando liberacao de um anuncio que nao existe mais.
 *
 * Acontece quando o anuncio e apagado pelo admin sem passar pela limpeza do
 * plugin. A foto fica sem pai, invisivel na biblioteca de midia filtrada por
 * anuncio, ocupando disco para sempre.
 */
function apix_limpa_fotos_orfas() {
  $fotos = get_posts([
    'post_type'    => 'attachment',
    'post_status'  => 'inherit',
    'numberposts'  => 30,
    'fields'       => 'ids',
    'meta_key'     => 'apix_espera_de',
    'meta_compare' => 'EXISTS',
  ]);

  foreach ($fotos as $fid) {
    $dono = (int) get_post_meta($fid, 'apix_espera_de', true);
    if ($dono && get_post_status($dono) !== false) continue;   // o anuncio existe
    wp_delete_attachment($fid, true);
  }
}

/* --------------------------------------------- coluna de status no admin */
/**
 * Uma coluna na listagem dizendo em que pe esta cada anuncio. Sem isso, saber
 * quem pagou exige abrir um por um.
 */
add_action('admin_init', function () {
  $cpt = apix_cpt();

  add_filter("manage_{$cpt}_posts_columns", function ($cols) {
    $cols['apix'] = 'Pagamento';
    return $cols;
  });

  add_action("manage_{$cpt}_posts_custom_column", function ($col, $post_id) {
    if ($col !== 'apix') return;

    $status = (string) get_post_meta($post_id, 'apix_status', true);
    if ($status === '') { echo '—'; return; }

    $plano  = (string) get_post_meta($post_id, 'apix_plano', true);
    $expira = (int) get_post_meta($post_id, 'apix_expira', true);

    $pago = in_array($status, apix_status_pagos(), true);
    printf('<strong style="color:%s">%s</strong><br><small>%s</small>',
      $pago ? '#1a7f37' : '#8a6d00',
      esc_html($pago ? 'Pago' : $status),
      esc_html($plano)
    );

    if ($expira) {
      printf('<br><small>%s %s</small>',
        $expira < time() ? 'venceu em' : 'vence em',
        esc_html(date_i18n('d/m/Y', $expira))
      );
    }

    $erros = get_post_meta($post_id, 'apix_fotos_erros', true);
    if (is_array($erros) && $erros) {
      printf('<br><small style="color:#b32d2e">%d aviso(s) nas fotos</small>', count($erros));
    }
  }, 10, 2);
});
