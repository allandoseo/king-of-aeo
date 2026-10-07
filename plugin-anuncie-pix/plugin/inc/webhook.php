<?php
/**
 * Webhook do Asaas e consulta de status.
 *
 * A REGRA DESTE ARQUIVO: o corpo do webhook nao decide nada.
 *
 * Um webhook e uma URL publica. Qualquer pessoa no mundo pode mandar um POST
 * para ela dizendo "PAYMENT_RECEIVED, externalReference 123". Se o plugin
 * publicasse com base nisso, publicar anuncio de graca seria uma linha de
 * curl — e ninguem descobriria, porque no painel ficaria igual a uma venda.
 *
 * Por isso aqui sao duas barreiras:
 *
 *   1. O token no cabecalho asaas-access-token, comparado com hash_equals.
 *      Comparar com == vaza o token aos poucos pelo tempo de resposta.
 *   2. A CONSULTA DE VOLTA. Com o id da cobranca em maos, o plugin pergunta ao
 *      proprio Asaas qual e o status. So publica se a resposta da API disser
 *      que foi pago. Mesmo que o token vaze, o atacante nao consegue fazer a
 *      Asaas mentir.
 *
 * A barreira 2 e a que importa. A 1 so evita que o trabalho seja feito.
 */

if (!defined('ABSPATH')) exit;

add_action('rest_api_init', function () {
  register_rest_route(APIX_NS, '/asaas', [
    'methods'             => 'POST',
    'callback'            => 'apix_webhook',
    'permission_callback' => '__return_true',   // a autenticacao e o token abaixo
  ]);

  register_rest_route(APIX_NS, '/status', [
    'methods'             => 'GET',
    'callback'            => 'apix_rest_status',
    'permission_callback' => '__return_true',
    'args'                => [
      't' => ['required' => true, 'type' => 'string'],
    ],
  ]);
});

/** Recebe o aviso do Asaas. */
function apix_webhook(WP_REST_Request $req) {
  $esperado = (string) apix_config()['webhook'];
  $recebido = (string) $req->get_header('asaas-access-token');

  if ($esperado === '' || !hash_equals($esperado, $recebido)) {
    apix_log('webhook', 'token recusado');
    // 401 sem detalhe: nao dizer se o token esta errado ou ausente
    return new WP_REST_Response(['ok' => false], 401);
  }

  $corpo = $req->get_json_params();
  if (!is_array($corpo)) return new WP_REST_Response(['ok' => false], 400);

  $evento   = isset($corpo['event']) ? sanitize_text_field((string) $corpo['event']) : '';
  $cobranca = isset($corpo['payment']['id']) ? sanitize_text_field((string) $corpo['payment']['id']) : '';

  if ($cobranca === '') return new WP_REST_Response(['ok' => true, 'nota' => 'sem cobranca'], 200);

  // eventos que nao interessam saem com 200: devolver erro faz o Asaas
  // reenviar o mesmo aviso por horas
  $interessam = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_REFUNDED',
                 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_DELETED'];
  if (!in_array($evento, $interessam, true)) {
    return new WP_REST_Response(['ok' => true, 'nota' => 'ignorado'], 200);
  }

  // --- barreira 2: a verdade vem da API, nao do corpo recebido
  $real = apix_cobranca_status($cobranca);
  if (is_wp_error($real)) {
    apix_log('webhook', 'consulta falhou: ' . $real->get_error_message());
    // 500 de proposito: o Asaas tenta de novo depois, e ai a API pode responder
    return new WP_REST_Response(['ok' => false], 500);
  }

  $status  = isset($real['status']) ? strtoupper((string) $real['status']) : '';
  $post_id = isset($real['externalReference']) ? absint($real['externalReference']) : 0;

  if (!$post_id || get_post_type($post_id) !== apix_cpt()) {
    apix_log('webhook', 'externalReference nao aponta para anuncio: ' . $post_id);
    return new WP_REST_Response(['ok' => true, 'nota' => 'sem anuncio'], 200);
  }

  // a cobranca guardada no anuncio tem de ser esta. Sem isso, uma cobranca de
  // R$ 1 com externalReference apontando para outro anuncio publicaria o caro
  $guardada = (string) get_post_meta($post_id, 'apix_cobranca', true);
  if ($guardada !== $cobranca) {
    apix_log('webhook', 'cobranca nao casa com o anuncio ' . $post_id);
    return new WP_REST_Response(['ok' => true, 'nota' => 'cobranca divergente'], 200);
  }

  update_post_meta($post_id, 'apix_status', $status);

  if (in_array($status, apix_status_pagos(), true)) {
    apix_publica($post_id);
  } elseif (in_array($status, ['REFUNDED', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE',
                              'DELETED', 'REFUND_REQUESTED'], true)) {
    apix_despublica($post_id, 'pagamento desfeito: ' . $status);
  }

  return new WP_REST_Response(['ok' => true], 200);
}

/**
 * Publica o anuncio e marca o vencimento.
 *
 * Idempotente: o Asaas manda PAYMENT_RECEIVED e PAYMENT_CONFIRMED para a mesma
 * cobranca, e reenvia quando nao recebe 200. Publicar duas vezes estenderia o
 * prazo de graca a cada reenvio.
 */
function apix_publica($post_id) {
  if (get_post_meta($post_id, 'apix_publicado_em', true)) return;

  $plano = apix_plano((string) get_post_meta($post_id, 'apix_plano', true));
  $dias  = $plano ? max(1, (int) $plano['dias']) : 30;

  wp_update_post(['ID' => $post_id, 'post_status' => 'publish']);

  update_post_meta($post_id, 'apix_publicado_em', gmdate('c'));
  update_post_meta($post_id, 'apix_expira', time() + $dias * DAY_IN_SECONDS);

  if ($plano) {
    update_post_meta($post_id, 'dmix_vip', !empty($plano['vip']) ? 1 : 0);
    update_post_meta($post_id, 'dmix_destaque', !empty($plano['destaque']) ? 1 : 0);
  }

  apix_avisa_dono($post_id);
  do_action('apix_anuncio_publicado', $post_id);
}

/** Tira do ar sem apagar: estorno, chargeback ou plano vencido. */
function apix_despublica($post_id, $motivo) {
  if (get_post_status($post_id) !== 'publish') return;
  wp_update_post(['ID' => $post_id, 'post_status' => 'draft']);
  update_post_meta($post_id, 'apix_despublicado', $motivo . ' em ' . gmdate('c'));
  do_action('apix_anuncio_despublicado', $post_id, $motivo);
}

/** Avisa o administrador por e-mail. */
function apix_avisa_dono($post_id) {
  $assunto = sprintf('[%s] Anuncio pago e publicado: %s',
    wp_specialchars_decode(get_bloginfo('name'), ENT_QUOTES), get_the_title($post_id));

  $erros = get_post_meta($post_id, 'apix_fotos_erros', true);
  $corpo = "Anuncio publicado automaticamente apos a confirmacao do Pix.\n\n"
         . 'Ver: ' . get_permalink($post_id) . "\n"
         // get_edit_post_link() devolve vazio sem usuario logado, e o webhook
         // roda sem usuario nenhum. A URL e montada a mao.
         . 'Editar: ' . admin_url('post.php?action=edit&post=' . (int) $post_id) . "\n"
         . 'Plano: ' . get_post_meta($post_id, 'apix_plano', true) . "\n"
         . 'Valor: ' . apix_moeda((float) get_post_meta($post_id, 'apix_valor', true)) . "\n";
  if (is_array($erros) && $erros) {
    $corpo .= "\nAvisos no envio das fotos:\n- " . implode("\n- ", $erros) . "\n";
  }

  wp_mail(get_option('admin_email'), $assunto, $corpo);
}

/**
 * Consulta de status para a pagina do Pix.
 *
 * Nao chama a API do Asaas: devolve o que o webhook ja gravou. Se chamasse,
 * uma aba aberta por uma hora faria 720 requisicoes a API, e varias abas
 * abertas estourariam o limite da conta — ai nenhum anunciante conseguiria
 * gerar cobranca.
 */
function apix_rest_status(WP_REST_Request $req) {
  $token = (string) $req->get_param('t');

  // freio simples: 1 consulta por segundo por IP
  $freio = 'apix_st_' . apix_ip_hash();
  if (get_transient($freio)) return new WP_REST_Response(['pago' => false], 200);
  set_transient($freio, 1, 1);

  $post_id = apix_post_por_token($token);
  if (!$post_id) return new WP_REST_Response(['pago' => false], 200);

  $pago = get_post_status($post_id) === 'publish'
       || in_array((string) get_post_meta($post_id, 'apix_status', true), apix_status_pagos(), true);

  return new WP_REST_Response(['pago' => (bool) $pago], 200);
}
