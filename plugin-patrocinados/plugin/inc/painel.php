<?php
/**
 * Painel: Configuracoes -> Areas patrocinadas.
 *
 * Sem seletor da biblioteca de midia de proposito. O seletor exige a wp.media,
 * que e um arquivo JS a mais carregado no admin e um caminho de plugin a mais
 * no HTML. O campo e de endereco: sobe a imagem em Midia, copia a URL do
 * arquivo e cola aqui. Dois cliques a mais, nenhum script.
 */

if (!defined('ABSPATH')) exit;

add_action('admin_menu', function () {
  add_options_page(
    'Areas patrocinadas',
    'Areas patrocinadas',
    'manage_options',
    'areas-patrocinadas',
    'apat_pagina'
  );
});

add_action('admin_init', function () {
  register_setting('apat_grupo', APAT_OPCAO, [
    'type'              => 'array',
    'sanitize_callback' => 'apat_sanitiza',
    'default'           => [],
  ]);
});

/**
 * Limpa o que veio do formulario.
 *
 * Tudo passa por sanitizacao propria em vez de confiar no campo: o painel e
 * aberto a qualquer administrador, e um endereco javascript: colado no campo
 * de destino viraria XIS-ESSE-ESSE em todas as paginas do site.
 */
function apat_sanitiza($bruto) {
  if (!is_array($bruto)) $bruto = [];

  $limpo = [
    'rotulo'    => sanitize_text_field($bruto['rotulo'] ?? 'Publicidade'),
    'paragrafo' => max(1, min(20, absint($bruto['paragrafo'] ?? 3))),
    'fora'      => trim(preg_replace('/[^0-9,\s]/', '', (string) ($bruto['fora'] ?? ''))),
    'vagas'     => [],
  ];

  $zonas = apat_zonas();
  $vagas = is_array($bruto['vagas'] ?? null) ? $bruto['vagas'] : [];

  foreach (array_slice($vagas, 0, APAT_VAGAS) as $v) {
    if (!is_array($v)) continue;

    $imagem  = esc_url_raw(trim((string) ($v['imagem'] ?? '')), ['http', 'https']);
    $destino = esc_url_raw(trim((string) ($v['destino'] ?? '')), ['http', 'https']);

    $limpo['vagas'][] = [
      'ativo'   => empty($v['ativo']) ? 0 : 1,
      'zona'    => isset($zonas[$v['zona'] ?? '']) ? $v['zona'] : 'topo',
      'imagem'  => $imagem,
      'alt'     => sanitize_text_field($v['alt'] ?? ''),
      'destino' => $destino,
      'largura' => min(4000, absint($v['largura'] ?? 0)),
      'altura'  => min(4000, absint($v['altura'] ?? 0)),
    ];
  }

  return $limpo;
}

function apat_pagina() {
  if (!current_user_can('manage_options')) return;

  $c     = apat_config();
  $zonas = apat_zonas();
  $vagas = $c['vagas'];
  while (count($vagas) < APAT_VAGAS) $vagas[] = apat_vaga_vazia();
  ?>
  <div class="wrap">
    <h1>Areas patrocinadas</h1>

    <p>
      Todo banner com destino externo sai com <code>rel="sponsored nofollow"</code>
      e abre em nova aba. Isso nao e opcional: espaco pago com link seguido e
      esquema de links. Destino dentro deste proprio site sai sem marcacao.
    </p>

    <form method="post" action="options.php">
      <?php settings_fields('apat_grupo'); ?>

      <table class="form-table" role="presentation">
        <tr>
          <th scope="row"><label for="apat-rotulo">Rotulo</label></th>
          <td>
            <input name="<?php echo esc_attr(APAT_OPCAO); ?>[rotulo]" id="apat-rotulo"
                   type="text" class="regular-text"
                   value="<?php echo esc_attr($c['rotulo']); ?>">
            <p class="description">
              Texto acima do banner. Deixe vazio para nao mostrar nenhum — mas
              identificar publicidade e exigencia do CDC, nao cortesia.
            </p>
          </td>
        </tr>
        <tr>
          <th scope="row"><label for="apat-paragrafo">Banner do meio entra depois do paragrafo</label></th>
          <td>
            <input name="<?php echo esc_attr(APAT_OPCAO); ?>[paragrafo]" id="apat-paragrafo"
                   type="number" min="1" max="20" class="small-text"
                   value="<?php echo esc_attr($c['paragrafo']); ?>">
            <p class="description">
              Em texto curto o banner nao entra: so sai quando sobram pelo menos
              dois paragrafos depois dele.
            </p>
          </td>
        </tr>
        <tr>
          <th scope="row"><label for="apat-fora">Nao mostrar em</label></th>
          <td>
            <input name="<?php echo esc_attr(APAT_OPCAO); ?>[fora]" id="apat-fora"
                   type="text" class="regular-text"
                   value="<?php echo esc_attr($c['fora']); ?>"
                   placeholder="12, 34, 56">
            <p class="description">
              IDs de paginas, separados por virgula. A pagina de politica de
              privacidade ja fica de fora sozinha.
            </p>
          </td>
        </tr>
      </table>

      <h2>Vagas</h2>
      <p class="description">
        Largura e altura sao obrigatorias: sao elas que reservam o espaco e
        impedem o conteudo de pular quando a imagem carrega. Use a medida real
        do arquivo. Vaga sem imagem, sem destino ou sem medida nao aparece.
      </p>

      <table class="widefat striped" style="margin-top:1rem">
        <thead>
          <tr>
            <th style="width:4rem">Ativa</th>
            <th style="width:12rem">Zona</th>
            <th>Imagem (URL)</th>
            <th>Destino (URL)</th>
            <th>Texto alternativo</th>
            <th style="width:6rem">Larg.</th>
            <th style="width:6rem">Alt.</th>
          </tr>
        </thead>
        <tbody>
        <?php foreach ($vagas as $i => $v) :
          $v    = array_merge(apat_vaga_vazia(), is_array($v) ? $v : []);
          $base = esc_attr(APAT_OPCAO) . '[vagas][' . (int) $i . ']';
        ?>
          <tr>
            <td style="text-align:center">
              <input type="checkbox" name="<?php echo $base; ?>[ativo]" value="1"
                     <?php checked($v['ativo'], 1); ?>>
            </td>
            <td>
              <select name="<?php echo $base; ?>[zona]" style="width:100%">
                <?php foreach ($zonas as $chave => $rotulo) : ?>
                  <option value="<?php echo esc_attr($chave); ?>"
                    <?php selected($v['zona'], $chave); ?>><?php echo esc_html($rotulo); ?></option>
                <?php endforeach; ?>
              </select>
            </td>
            <td>
              <input type="url" name="<?php echo $base; ?>[imagem]" style="width:100%"
                     value="<?php echo esc_attr($v['imagem']); ?>"
                     placeholder="https://.../wp-content/uploads/...">
            </td>
            <td>
              <input type="url" name="<?php echo $base; ?>[destino]" style="width:100%"
                     value="<?php echo esc_attr($v['destino']); ?>"
                     placeholder="https://">
            </td>
            <td>
              <input type="text" name="<?php echo $base; ?>[alt]" style="width:100%"
                     value="<?php echo esc_attr($v['alt']); ?>"
                     placeholder="Nome do anunciante">
            </td>
            <td>
              <input type="number" min="0" max="4000" name="<?php echo $base; ?>[largura]"
                     style="width:100%" value="<?php echo esc_attr($v['largura'] ?: ''); ?>">
            </td>
            <td>
              <input type="number" min="0" max="4000" name="<?php echo $base; ?>[altura]"
                     style="width:100%" value="<?php echo esc_attr($v['altura'] ?: ''); ?>">
            </td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>

      <h2>Onde cada zona aparece</h2>
      <table class="widefat striped">
        <tbody>
          <tr><td style="width:12rem"><strong>Topo</strong></td>
              <td>Logo abaixo do cabecalho, em todas as paginas. Carrega sem lazy
                  porque esta acima da dobra, com prioridade baixa para nao
                  disputar banda com o LCP.</td></tr>
          <tr><td><strong>Meio do texto</strong></td>
              <td>Dentro do post, depois do paragrafo escolhido acima. So em post
                  ou pagina aberta.</td></tr>
          <tr><td><strong>Lateral</strong></td>
              <td>Widget <em>Area patrocinada</em> em Aparencia &rarr; Widgets, ou
                  o shortcode <code>[patrocinado]</code> em qualquer lugar.</td></tr>
          <tr><td><strong>Rodape</strong></td>
              <td>Fim do conteudo, antes do rodape do tema.</td></tr>
        </tbody>
      </table>

      <?php submit_button(); ?>
    </form>
  </div>
  <?php
}
