<?php
/**
 * Cliente da API do Asaas.
 *
 * ================== CONFERIR ANTES DE PRODUCAO ==================
 * Tudo que depende da documentacao do Asaas esta NESTE arquivo, e so nele:
 * URLs base, caminhos, nome do cabecalho de autenticacao, nomes dos campos do
 * corpo e os valores de status. Foram escritos sem acesso a docs.asaas.com.
 *
 * Confira em Asaas -> Integracoes -> API, ou em docs.asaas.com:
 *   1. A URL base do sandbox. Existiram duas formas em versoes diferentes:
 *      https://api-sandbox.asaas.com/v3   (a que esta em uso aqui)
 *      https://sandbox.asaas.com/api/v3   (a antiga)
 *      Se o primeiro teste devolver 404, e a outra.
 *   2. O nome do cabecalho da chave: aqui esta "access_token".
 *   3. O caminho do QR Code Pix: aqui esta GET /payments/{id}/pixQrCode,
 *      devolvendo encodedImage (PNG em base64) e payload (copia e cola).
 *   4. Os status que contam como pago: aqui estao RECEIVED e CONFIRMED.
 * ===============================================================
 */

if (!defined('ABSPATH')) exit;

/* ------------------------------------------------------------- CONFERIR: 1 */
function apix_api_base() {
  return apix_config()['ambiente'] === 'producao'
    ? 'https://api.asaas.com/v3'
    : 'https://api-sandbox.asaas.com/v3';
}

/* ------------------------------------------------------------- CONFERIR: 4 */
function apix_status_pagos() {
  return ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];
}

/**
 * Uma chamada a API. Devolve array decodificado ou WP_Error.
 *
 * O timeout e curto de proposito: isto roda durante o envio do formulario, com
 * o anunciante olhando a tela. Chamada que pendura 30 segundos faz ele achar
 * que travou, recarregar e gerar duas cobrancas.
 */
function apix_api($metodo, $caminho, $corpo = null) {
  $chave = apix_chave();
  if ($chave === '') {
    return new WP_Error('apix_sem_chave', 'A chave da API do Asaas nao esta configurada.');
  }

  $args = [
    'method'  => $metodo,
    'timeout' => 20,
    'headers' => [
      /* --------------------------------------------------- CONFERIR: 2 */
      'access_token' => $chave,
      'Content-Type' => 'application/json',
      'Accept'       => 'application/json',
      'User-Agent'   => 'WordPress/' . get_bloginfo('version'),
    ],
  ];
  if ($corpo !== null) $args['body'] = wp_json_encode($corpo);

  $r = wp_remote_request(apix_api_base() . $caminho, $args);
  if (is_wp_error($r)) {
    apix_log('rede', $metodo . ' ' . $caminho . ' -> ' . $r->get_error_message());
    return $r;
  }

  $codigo = (int) wp_remote_retrieve_response_code($r);
  $dados  = json_decode(wp_remote_retrieve_body($r), true);
  if (!is_array($dados)) $dados = [];

  if ($codigo < 200 || $codigo >= 300) {
    // o Asaas devolve os erros em errors[].description
    $msg = '';
    if (!empty($dados['errors'][0]['description'])) $msg = $dados['errors'][0]['description'];
    apix_log('api', $metodo . ' ' . $caminho . ' -> HTTP ' . $codigo . ' ' . $msg);
    return new WP_Error('apix_api', $msg !== '' ? $msg : 'Erro HTTP ' . $codigo, ['status' => $codigo]);
  }

  return $dados;
}

/**
 * Acha o cliente pelo CPF/CNPJ ou cria um novo.
 *
 * Procurar antes evita cliente duplicado no Asaas a cada anuncio da mesma
 * pessoa — o painel fica ilegivel e o relatorio de recebimento, inutil.
 */
function apix_cliente($nome, $cpf, $email, $telefone) {
  $achado = apix_api('GET', '/customers?cpfCnpj=' . rawurlencode($cpf));
  if (!is_wp_error($achado) && !empty($achado['data'][0]['id'])) {
    return (string) $achado['data'][0]['id'];
  }

  $novo = apix_api('POST', '/customers', [
    'name'            => $nome,
    'cpfCnpj'         => $cpf,
    'email'           => $email,
    'mobilePhone'     => $telefone,
    'notificationDisabled' => true,   // quem avisa e o site, nao o Asaas
  ]);
  if (is_wp_error($novo)) return $novo;
  if (empty($novo['id'])) return new WP_Error('apix_cliente', 'O Asaas nao devolveu o id do cliente.');

  return (string) $novo['id'];
}

/**
 * Cria a cobranca Pix.
 *
 * externalReference leva o ID do rascunho. E por ele que o webhook sabe qual
 * anuncio publicar, sem confiar em nada mais do que vem de fora.
 *
 * SO PIX, e de proposito — nao e pendencia nem falta de tempo. O Asaas aceita
 * BOLETO e CREDIT_CARD, e e tentador "so acrescentar". Nao acrescente:
 *
 * Pix cai na hora, e e isso que faz o anuncio publicar sozinho. Boleto compensa
 * em dias e cartao pode ser estornado semanas depois. Os dois exigiriam um
 * estado que nao existe aqui — "pago, mas ainda nao confirmado" — com anuncio no
 * ar que talvez precise sair, fila de conferencia e tratamento de estorno. Seria
 * a parte mais facil de errar do plugin inteiro, e o erro custa dinheiro.
 *
 * Se um dia entrar, nao basta trocar esta linha: apix_status_pagos() e o webhook
 * precisam distinguir "recebido" de "confirmado", e apix_despublica() ja cobre o
 * estorno mas nunca foi exercitada com cartao.
 */
function apix_cobranca($cliente_id, $valor, $descricao, $post_id) {
  $dias = max(1, (int) apix_config()['vence_dias']);

  return apix_api('POST', '/payments', [
    'customer'          => $cliente_id,
    'billingType'       => 'PIX',
    'value'             => round((float) $valor, 2),
    'dueDate'           => gmdate('Y-m-d', time() + $dias * DAY_IN_SECONDS),
    'description'       => $descricao,
    'externalReference' => (string) $post_id,
  ]);
}

/* ------------------------------------------------------------- CONFERIR: 3 */
function apix_pix_qrcode($cobranca_id) {
  return apix_api('GET', '/payments/' . rawurlencode($cobranca_id) . '/pixQrCode');
}

/** Consulta a cobranca. E esta a fonte da verdade, nunca o corpo do webhook. */
function apix_cobranca_status($cobranca_id) {
  return apix_api('GET', '/payments/' . rawurlencode($cobranca_id));
}

/**
 * Registro de erro.
 *
 * Nunca grava a chave nem o corpo da requisicao: corpo de cobranca tem CPF e
 * telefone, e log com dado pessoal e vazamento esperando acontecer. So o que
 * serve para depurar: o que foi chamado e o que voltou.
 */
function apix_log($tipo, $mensagem) {
  if (!defined('WP_DEBUG') || !WP_DEBUG) return;
  error_log('[anuncie-pix:' . $tipo . '] ' . $mensagem);
}
