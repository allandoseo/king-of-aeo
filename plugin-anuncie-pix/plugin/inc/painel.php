<?php
/**
 * Painel: Configuracoes -> Anuncie com Pix.
 */

if (!defined('ABSPATH')) exit;

add_action('admin_menu', function () {
  add_options_page('Anuncie com Pix', 'Anuncie com Pix', 'manage_options',
    'anuncie-pix', 'apix_pagina');
});

add_action('admin_init', function () {
  register_setting('apix_grupo', APIX_OPCAO, [
    'type'              => 'array',
    'sanitize_callback' => 'apix_sanitiza',
    'default'           => [],
  ]);
});

function apix_sanitiza($bruto) {
  if (!is_array($bruto)) $bruto = [];
  $atual = apix_config();

  $limpo = [
    'ambiente'   => in_array($bruto['ambiente'] ?? '', ['sandbox', 'producao'], true)
                      ? $bruto['ambiente'] : 'sandbox',
    'cpt'        => sanitize_key($bruto['cpt'] ?? 'perfil') ?: 'perfil',
    'max_fotos'  => max(1, min(20, absint($bruto['max_fotos'] ?? 5))),
    'max_mb'     => max(1, min(16, absint($bruto['max_mb'] ?? 4))),
    'limite_ip'  => max(1, min(50, absint($bruto['limite_ip'] ?? 3))),
    'vence_dias' => max(1, min(30, absint($bruto['vence_dias'] ?? 1))),
    'abandono_h' => max(2, min(720, absint($bruto['abandono_h'] ?? 48))),
    'whats'      => preg_replace('/\D+/', '', (string) ($bruto['whats'] ?? '')),
    'planos'     => [],
  ];

  // a chave e o token em branco no formulario significam "nao mexer", nunca
  // "apagar": e facil salvar o painel sem reparar nesses campos e derrubar a
  // integracao inteira sem saber por que
  $chave = trim((string) ($bruto['chave'] ?? ''));
  $limpo['chave'] = $chave !== '' ? sanitize_text_field($chave) : $atual['chave'];

  $webhook = trim((string) ($bruto['webhook'] ?? ''));
  $limpo['webhook'] = $webhook !== '' ? sanitize_text_field($webhook) : $atual['webhook'];
  if ($limpo['webhook'] === '') $limpo['webhook'] = wp_generate_password(40, false, false);

  $planos = is_array($bruto['planos'] ?? null) ? $bruto['planos'] : [];
  foreach (array_slice($planos, 0, 8) as $p) {
    if (!is_array($p)) continue;
    $slug = sanitize_key($p['slug'] ?? '');
    $nome = sanitize_text_field($p['nome'] ?? '');
    if ($slug === '' || $nome === '') continue;

    $limpo['planos'][] = [
      'slug'     => $slug,
      'nome'     => $nome,
      'valor'    => round(max(0.01, (float) str_replace(',', '.', (string) ($p['valor'] ?? 0))), 2),
      'dias'     => max(1, min(3650, absint($p['dias'] ?? 30))),
      'vip'      => empty($p['vip']) ? 0 : 1,
      'destaque' => empty($p['destaque']) ? 0 : 1,
    ];
  }
  if (!$limpo['planos']) $limpo['planos'] = apix_planos_padrao();

  return $limpo;
}

function apix_pagina() {
  if (!current_user_can('manage_options')) return;

  $c = apix_config();
  $planos = $c['planos'];
  while (count($planos) < 4) $planos[] = ['slug'=>'','nome'=>'','valor'=>'','dias'=>30,'vip'=>0,'destaque'=>0];

  $url_webhook = rest_url(APIX_NS . '/asaas');
  $tem_const   = defined('APIX_ASAAS_CHAVE') && APIX_ASAAS_CHAVE;
  ?>
  <div class="wrap">
    <h1>Anuncie com Pix</h1>

    <div class="notice notice-warning" style="padding:.8rem 1rem">
      <p><strong>Antes de ligar em producao:</strong> confira os endpoints da API
      do Asaas no arquivo <code>inc/asaas.php</code>, nos trechos marcados
      <code>CONFERIR</code>. Eles foram escritos sem acesso a documentacao do
      Asaas e precisam ser confirmados contra <code>docs.asaas.com</code>.</p>
    </div>

    <h2>1. Chave da API</h2>
    <?php if ($tem_const) : ?>
      <p style="color:#1a7f37"><strong>A chave esta no wp-config.php</strong>
      (constante <code>APIX_ASAAS_CHAVE</code>). E o lugar certo. O campo abaixo
      fica sem efeito.</p>
    <?php else : ?>
      <p><strong>Recomendado:</strong> tire a chave do banco e ponha no
      <code>wp-config.php</code>:</p>
      <p><code>define('APIX_ASAAS_CHAVE', 'sua_chave_aqui');</code></p>
      <p>Chave no banco vai para dentro de todo backup e de todo dump.</p>
    <?php endif; ?>

    <h2>2. Webhook no Asaas</h2>
    <p>No Asaas, em <em>Integracoes &rarr; Webhooks</em>, cadastre:</p>
    <table class="widefat striped" style="max-width:860px">
      <tbody>
        <tr><td style="width:12rem"><strong>URL</strong></td>
            <td><code><?php echo esc_html($url_webhook); ?></code></td></tr>
        <tr><td><strong>Token</strong></td>
            <td><code><?php echo esc_html($c['webhook']); ?></code>
            <br><small>O Asaas devolve este valor no cabecalho
            <code>asaas-access-token</code>. O plugin recusa o que nao casar.</small></td></tr>
        <tr><td><strong>Eventos</strong></td>
            <td><code>PAYMENT_RECEIVED</code>, <code>PAYMENT_CONFIRMED</code>,
            <code>PAYMENT_REFUNDED</code>, <code>PAYMENT_CHARGEBACK_REQUESTED</code></td></tr>
      </tbody>
    </table>
    <p><small>Se o webhook falhar, nao tem problema grave: de hora em hora o
    plugin confere na API os anuncios pendentes das ultimas 72 horas e publica o
    que ja foi pago.</small></p>

    <h2>3. Pagina do formulario</h2>
    <p>Crie uma pagina e coloque o shortcode <code>[anunciar]</code> nela. A mesma
    pagina mostra o QR Code depois do envio.</p>

    <form method="post" action="options.php">
      <?php settings_fields('apix_grupo'); ?>

      <h2>Configuracoes</h2>
      <table class="form-table" role="presentation">
        <tr>
          <th scope="row">Ambiente</th>
          <td>
            <select name="<?php echo esc_attr(APIX_OPCAO); ?>[ambiente]">
              <option value="sandbox" <?php selected($c['ambiente'], 'sandbox'); ?>>Sandbox (teste)</option>
              <option value="producao" <?php selected($c['ambiente'], 'producao'); ?>>Producao (dinheiro real)</option>
            </select>
            <p class="description">Em sandbox o formulario mostra um aviso de teste ao anunciante.</p>
          </td>
        </tr>
        <tr>
          <th scope="row"><label for="apix-chave">Chave da API</label></th>
          <td>
            <input type="password" id="apix-chave" class="regular-text" autocomplete="new-password"
                   name="<?php echo esc_attr(APIX_OPCAO); ?>[chave]" value=""
                   placeholder="<?php echo $c['chave'] !== '' ? 'ja salva — deixe vazio para manter' : 'cole a chave'; ?>">
            <p class="description">Vazio mantem a que esta salva. Use a constante no wp-config quando possivel.</p>
          </td>
        </tr>
        <tr>
          <th scope="row"><label for="apix-webhook">Token do webhook</label></th>
          <td>
            <input type="text" id="apix-webhook" class="regular-text"
                   name="<?php echo esc_attr(APIX_OPCAO); ?>[webhook]" value=""
                   placeholder="deixe vazio para manter o atual">
            <p class="description">Vazio mantem o atual. Trocar aqui exige trocar no Asaas tambem.</p>
          </td>
        </tr>
        <tr>
          <th scope="row"><label for="apix-cpt">Tipo de conteudo</label></th>
          <td>
            <input type="text" id="apix-cpt" class="regular-text"
                   name="<?php echo esc_attr(APIX_OPCAO); ?>[cpt]"
                   value="<?php echo esc_attr($c['cpt']); ?>">
            <p class="description">
              <code>perfil</code> nos sites cujo tema ja registra esse tipo. Onde
              nao existir, o plugin registra sozinho.
              <?php echo post_type_exists($c['cpt'])
                ? '<strong style="color:#1a7f37">Existe agora.</strong>'
                : '<strong style="color:#8a6d00">Nao existe ainda — o plugin vai registrar.</strong>'; ?>
            </p>
          </td>
        </tr>
        <tr>
          <th scope="row">Fotos</th>
          <td>
            Maximo <input type="number" min="1" max="20" class="small-text"
              name="<?php echo esc_attr(APIX_OPCAO); ?>[max_fotos]"
              value="<?php echo (int) $c['max_fotos']; ?>"> fotos,
            de <input type="number" min="1" max="16" class="small-text"
              name="<?php echo esc_attr(APIX_OPCAO); ?>[max_mb]"
              value="<?php echo (int) $c['max_mb']; ?>"> MB cada.
            <p class="description">
              Toda foto e reempacotada pelo servidor: sai JPEG de no maximo
              1600px, sem EXIF e sem o GPS que o celular grava.
              <?php
              $gd = function_exists('imagecreatefromstring');
              $fi = function_exists('finfo_open');
              printf('<br>GD: <strong style="color:%s">%s</strong> &nbsp; fileinfo: <strong style="color:%s">%s</strong>',
                $gd ? '#1a7f37' : '#b32d2e', $gd ? 'disponivel' : 'FALTANDO',
                $fi ? '#1a7f37' : '#b32d2e', $fi ? 'disponivel' : 'FALTANDO');
              if (!$gd || !$fi) echo '<br><strong style="color:#b32d2e">Sem as duas, o upload e recusado inteiro.</strong>';
              ?>
            </p>
          </td>
        </tr>
        <tr>
          <th scope="row">Limites</th>
          <td>
            <input type="number" min="1" max="50" class="small-text"
              name="<?php echo esc_attr(APIX_OPCAO); ?>[limite_ip]"
              value="<?php echo (int) $c['limite_ip']; ?>"> envios por IP por hora.<br>
            Pix vence em <input type="number" min="1" max="30" class="small-text"
              name="<?php echo esc_attr(APIX_OPCAO); ?>[vence_dias]"
              value="<?php echo (int) $c['vence_dias']; ?>"> dia(s).<br>
            Rascunho sem pagamento e apagado depois de
            <input type="number" min="2" max="720" class="small-text"
              name="<?php echo esc_attr(APIX_OPCAO); ?>[abandono_h]"
              value="<?php echo (int) $c['abandono_h']; ?>"> horas, com as fotos.
          </td>
        </tr>
        <tr>
          <th scope="row"><label for="apix-whats">WhatsApp de suporte</label></th>
          <td>
            <input type="text" id="apix-whats" class="regular-text"
              name="<?php echo esc_attr(APIX_OPCAO); ?>[whats]"
              value="<?php echo esc_attr($c['whats']); ?>" placeholder="5511999999999">
            <p class="description">Mostrado ao anunciante se o Pix nao carregar. So numeros, com pais e DDD.</p>
          </td>
        </tr>
      </table>

      <h2>Planos</h2>
      <p class="description">Os valores que vieram instalados sao exemplo. Troque pelos seus.</p>
      <table class="widefat striped" style="max-width:860px;margin-top:.6rem">
        <thead>
          <tr>
            <th style="width:9rem">Slug</th><th>Nome</th>
            <th style="width:8rem">Valor (R$)</th><th style="width:6rem">Dias</th>
            <th style="width:5rem">VIP</th><th style="width:7rem">Destaque</th>
          </tr>
        </thead>
        <tbody>
        <?php foreach ($planos as $i => $p) :
          $b = esc_attr(APIX_OPCAO) . '[planos][' . (int) $i . ']'; ?>
          <tr>
            <td><input type="text" style="width:100%" name="<?php echo $b; ?>[slug]"
                   value="<?php echo esc_attr($p['slug']); ?>" placeholder="vip"></td>
            <td><input type="text" style="width:100%" name="<?php echo $b; ?>[nome]"
                   value="<?php echo esc_attr($p['nome']); ?>" placeholder="VIP"></td>
            <td><input type="text" style="width:100%" name="<?php echo $b; ?>[valor]"
                   value="<?php echo esc_attr($p['valor']); ?>" placeholder="149,90"></td>
            <td><input type="number" min="1" style="width:100%" name="<?php echo $b; ?>[dias]"
                   value="<?php echo esc_attr($p['dias']); ?>"></td>
            <td style="text-align:center"><input type="checkbox" value="1"
                   name="<?php echo $b; ?>[vip]" <?php checked(!empty($p['vip'])); ?>></td>
            <td style="text-align:center"><input type="checkbox" value="1"
                   name="<?php echo $b; ?>[destaque]" <?php checked(!empty($p['destaque'])); ?>></td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
      <p class="description">Linha com slug ou nome vazio e ignorada. Slug vazio em todas restaura os exemplos.</p>

      <?php submit_button(); ?>
    </form>
  </div>
  <?php
}
