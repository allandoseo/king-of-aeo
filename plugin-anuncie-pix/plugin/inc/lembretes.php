<?php
/**
 * Lembrete de vencimento: por e-mail (automatico) e por WhatsApp (um clique).
 *
 * POR QUE O WHATSAPP NAO E AUTOMATICO AQUI
 * ----------------------------------------
 * Mandar WhatsApp por conta propria exige uma destas tres coisas, e nenhuma e
 * "facil":
 *
 *  1. WhatsApp Cloud API, da Meta. E o caminho oficial e o unico que nao corre
 *     risco de banimento por uso indevido. Custa: conta Meta Business, empresa
 *     verificada, um numero DEDICADO (nao da para usar o numero que voce ja usa
 *     no WhatsApp normal), e modelo de mensagem aprovado pela Meta antes de
 *     qualquer envio fora da janela de 24h. Verificacao leva dias. E a politica
 *     de mensagens da Meta restringe conteudo adulto — vale conferir com cuidado
 *     antes de investir tempo nisso, porque se o ramo do site nao for aceito, a
 *     conta cai depois de tudo pronto.
 *
 *  2. Biblioteca nao oficial (Baileys, whatsapp-web.js e parecidas). Mantem uma
 *     sessao do WhatsApp Web aberta num processo Node. Viola os termos, o numero
 *     e banido com frequencia, e precisa de um processo rodando sempre — nao
 *     funciona em hospedagem compartilhada de WordPress, que e onde este plugin
 *     vive.
 *
 *  3. Revenda de gateway. As baratas sao a opcao 2 embrulhada, com o mesmo risco
 *     de banimento, so que no numero do cliente. As oficiais sao a opcao 1 com
 *     mensalidade.
 *
 * O QUE ESTE ARQUIVO FAZ NO LUGAR
 * -------------------------------
 *  - E-mail: automatico, nos marcos configurados antes e depois do vencimento.
 *    Nao depende de aprovacao de ninguem e nao tem risco.
 *  - WhatsApp: uma tela no admin lista quem esta vencendo, com a mensagem ja
 *     escrita. Um clique abre o WhatsApp com o texto pronto e voce aperta
 *     enviar. Nao e automatico, mas sao dois segundos por anunciante, sai do SEU
 *     numero (que o anunciante reconhece), nao custa nada, nao precisa de
 *     aprovacao e nao existe risco de banimento.
 *
 * Se depois voce quiser o envio automatico pela Cloud API, o unico lugar a mexer
 * e apix_whats_url(): o resto — quem avisar, quando, com que texto e o controle
 * de repeticao — ja esta pronto e vale para os dois.
 */

if (!defined('ABSPATH')) exit;

/* ------------------------------------------------------------------- marcos */

/**
 * Decide qual lembrete mandar, se algum.
 *
 * Funcao pura de proposito: e a regra que decide quem recebe o que, e e a parte
 * em que errar significa mandar tres e-mails no mesmo dia para quem ja pagou.
 *
 * $dias pode ser negativo (ja venceu). Devolve null quando nao ha nada a fazer,
 * ou ['enviar' => 'a3', 'marcar' => ['a7','a3']].
 *
 * Manda UM so por rodada, e marca todos os marcos que ja passaram. Sem isso, um
 * site que ficou fora do ar por uma semana voltaria disparando o lembrete de 7
 * dias, o de 3 e o de 1 de uma vez — tres e-mails seguidos, que e a melhor
 * forma de ser marcado como spam.
 */
function apix_marco_lembrete($dias, $antes, $depois, $enviados) {
  $ordem = [];   // do mais distante ao mais urgente

  rsort($antes);
  foreach ($antes as $d) {
    $d = (int) $d;
    if ($d < 0) continue;
    $ordem[] = ['chave' => 'a' . $d, 'cabe' => ($dias >= 0 && $dias <= $d)];
  }

  sort($depois);
  foreach ($depois as $d) {
    $d = (int) $d;
    if ($d < 1) continue;
    $ordem[] = ['chave' => 'd' . $d, 'cabe' => ($dias <= -$d)];
  }

  $cabem = [];
  foreach ($ordem as $m) if ($m['cabe']) $cabem[] = $m['chave'];
  if (!$cabem) return null;

  // o mais urgente e o ultimo da ordem
  $urgente = end($cabem);

  // tudo que cabe ja foi mandado: nada a fazer
  $faltam = array_diff($cabem, array_keys($enviados));
  if (!$faltam) return null;

  return ['enviar' => $urgente, 'marcar' => $cabem];
}

/* ------------------------------------------------------------------- e-mail */

add_action(APIX_CRON, 'apix_roda_lembretes');

function apix_roda_lembretes() {
  $c = apix_config();
  $antes  = apix_lista_numeros($c['lembrar_antes']);
  $depois = apix_lista_numeros($c['lembrar_depois']);
  if (!$antes && !$depois) return;

  $maior = $antes ? max($antes) : 0;

  // Candidatos: publicados vencendo em ate $maior dias, e os que venceram
  // recentemente. O limite de 40 por rodada e para nao estourar o tempo de
  // execucao nem disparar centenas de e-mails de uma vez, o que derruba a
  // reputacao do dominio.
  $ids = get_posts([
    'post_type'   => apix_cpt(),
    'post_status' => ['publish', 'draft'],
    'numberposts' => 40,
    'fields'      => 'ids',
    'meta_query'  => [[
      'key'     => 'apix_expira',
      'value'   => time() + ($maior + 1) * DAY_IN_SECONDS,
      'compare' => '<',
      'type'    => 'NUMERIC',
    ]],
  ]);

  foreach ($ids as $id) {
    $expira = (int) get_post_meta($id, 'apix_expira', true);
    if (!$expira) continue;

    // nao insiste para sempre com quem ja desistiu
    $limite = $depois ? max($depois) : 0;
    if ($expira < time() - ($limite + 3) * DAY_IN_SECONDS) continue;

    $dias = (int) floor(($expira - time()) / DAY_IN_SECONDS);

    $enviados = get_post_meta($id, 'apix_lembretes', true);
    if (!is_array($enviados)) $enviados = [];

    $marco = apix_marco_lembrete($dias, $antes, $depois, $enviados);
    if (!$marco) continue;

    if (apix_manda_email_lembrete($id, $dias)) {
      foreach ($marco['marcar'] as $chave) {
        if (!isset($enviados[$chave])) $enviados[$chave] = time();
      }
      update_post_meta($id, 'apix_lembretes', $enviados);
    }
  }
}

/** Monta e manda o e-mail. */
function apix_manda_email_lembrete($id, $dias) {
  $email = (string) get_post_meta($id, 'apix_email', true);
  if ($email === '' || !is_email($email)) return false;

  $c = apix_config();
  $assunto = apix_preenche($c['lembrete_assunto'], $id, $dias);
  $corpo   = apix_preenche($c['lembrete_corpo'], $id, $dias);

  $ok = wp_mail($email, $assunto, $corpo);
  apix_log('lembrete', 'anuncio ' . $id . ' dias ' . $dias . ($ok ? ' enviado' : ' FALHOU'));

  return (bool) $ok;
}

/**
 * Troca os marcadores do texto.
 *
 * Tudo que entra aqui vem do painel (texto do dono do site) ou do proprio
 * anuncio. Nada vem do visitante, mas o texto vai para e-mail e para URL, entao
 * cada destino escapa o seu: o e-mail e texto puro e a URL passa por
 * rawurlencode em apix_whats_url().
 */
function apix_preenche($modelo, $id, $dias) {
  $plano = apix_plano((string) get_post_meta($id, 'apix_plano', true));

  $trocas = [
    '{anuncio}' => get_the_title($id),
    '{dias}'    => (string) abs((int) $dias),
    '{plano}'   => $plano ? $plano['nome'] : '',
    '{valor}'   => $plano ? apix_moeda($plano['valor']) : '',
    '{link}'    => apix_pagina_area(),
    '{site}'    => wp_specialchars_decode(get_bloginfo('name'), ENT_QUOTES),
  ];

  return str_replace(array_keys($trocas), array_values($trocas), (string) $modelo);
}

/** "7, 3, 1" -> [7, 3, 1]. */
function apix_lista_numeros($texto) {
  $saida = [];
  foreach (preg_split('/[^0-9]+/', (string) $texto) as $n) {
    if ($n === '') continue;
    $n = (int) $n;
    if ($n > 0 && $n <= 365) $saida[] = $n;
  }
  return array_values(array_unique($saida));
}

/* ----------------------------------------------------------------- WhatsApp */

/**
 * Normaliza o telefone para o formato que o wa.me aceita: so digitos, com
 * codigo do pais.
 *
 * O anunciante digita "(11) 98888-7777", "11988887777" ou "5511988887777". O
 * wa.me so entende o ultimo. Sem o 55 na frente o link abre uma conversa com um
 * numero de outro pais, ou com ninguem.
 */
function apix_telefone_internacional($bruto, $pais = '55') {
  $n = preg_replace('/\D+/', '', (string) $bruto);
  if ($n === '') return '';

  // ja vem com o codigo do pais
  if (strlen($n) >= 12 && strpos($n, $pais) === 0) return $n;

  // 10 digitos (fixo com DDD) ou 11 (celular com DDD)
  if (strlen($n) === 10 || strlen($n) === 11) return $pais . $n;

  // 8 ou 9 digitos: falta o DDD, nao da para adivinhar
  if (strlen($n) <= 9) return '';

  return $n;
}

/** O link que abre o WhatsApp com a mensagem pronta. */
function apix_whats_url($id, $dias) {
  $tel = apix_telefone_internacional(get_post_meta($id, 'dmix_wpp', true));
  if ($tel === '') $tel = apix_telefone_internacional(get_post_meta($id, 'dmix_tel', true));
  if ($tel === '') return '';

  $texto = apix_preenche(apix_config()['whats_msg'], $id, $dias);

  return 'https://wa.me/' . $tel . '?text=' . rawurlencode($texto);
}

/* ------------------------------------------------- tela de vencimentos no admin */

add_action('admin_menu', function () {
  add_submenu_page(
    'edit.php?post_type=' . apix_cpt(),
    'Vencimentos',
    'Vencimentos',
    'edit_posts',
    'apix-vencimentos',
    'apix_tela_vencimentos'
  );
});

function apix_tela_vencimentos() {
  if (!current_user_can('edit_posts')) return;

  $c      = apix_config();
  $antes  = apix_lista_numeros($c['lembrar_antes']);
  $janela = $antes ? max($antes) : 7;

  $ids = get_posts([
    'post_type'   => apix_cpt(),
    'post_status' => ['publish', 'draft'],
    'numberposts' => 100,
    'fields'      => 'ids',
    'meta_query'  => [[
      'key'     => 'apix_expira',
      'value'   => time() + ($janela + 1) * DAY_IN_SECONDS,
      'compare' => '<',
      'type'    => 'NUMERIC',
    ]],
  ]);

  // ordena pelo que vence primeiro
  $linhas = [];
  foreach ($ids as $id) {
    $expira = (int) get_post_meta($id, 'apix_expira', true);
    if (!$expira) continue;
    $linhas[] = ['id' => $id, 'expira' => $expira];
  }
  usort($linhas, function ($a, $b) { return $a['expira'] <=> $b['expira']; });
  ?>
  <div class="wrap">
    <h1>Vencimentos</h1>

    <p>Anuncios vencendo nos proximos <?php echo (int) $janela; ?> dias, e os que
    ja venceram. O e-mail de lembrete sai sozinho; esta tela e para o WhatsApp.</p>

    <div class="notice notice-info inline" style="padding:.7rem 1rem;margin:1rem 0">
      <p><strong>Por que o WhatsApp nao e automatico.</strong> Envio automatico
      exige a Cloud API da Meta: empresa verificada, numero dedicado (nao serve o
      que voce ja usa) e modelo de mensagem aprovado antes de qualquer envio — e
      a politica de mensagens da Meta restringe conteudo adulto, o que vale
      conferir antes de investir tempo. As alternativas nao oficiais violam os
      termos, derrubam o numero e precisam de um processo rodando sempre, que
      hospedagem de WordPress nao tem.</p>
      <p>O botao abaixo resolve sem nada disso: abre o WhatsApp com o texto
      pronto, sai do <strong>seu</strong> numero — que o anunciante reconhece — e
      voce so aperta enviar.</p>
    </div>

    <?php if (!$linhas) : ?>
      <p>Nenhum anuncio vencendo agora.</p>
    <?php else : ?>
      <table class="widefat striped">
        <thead>
          <tr>
            <th>Anuncio</th><th style="width:9rem">Vencimento</th>
            <th style="width:7rem">Plano</th><th style="width:11rem">E-mail enviado</th>
            <th style="width:13rem">WhatsApp</th>
          </tr>
        </thead>
        <tbody>
        <?php foreach ($linhas as $l) :
          $id   = $l['id'];
          $dias = (int) floor(($l['expira'] - time()) / DAY_IN_SECONDS);
          $wa   = apix_whats_url($id, $dias);
          $env  = get_post_meta($id, 'apix_lembretes', true);
          $env  = is_array($env) ? $env : [];
          $no_ar = get_post_status($id) === 'publish';
        ?>
          <tr>
            <td>
              <strong><a href="<?php echo esc_url(get_edit_post_link($id)); ?>">
                <?php echo esc_html(get_the_title($id)); ?></a></strong>
              <?php if (!$no_ar) echo ' <span style="color:#b32d2e">(fora do ar)</span>'; ?>
            </td>
            <td>
              <?php
              echo esc_html(date_i18n('d/m/Y', $l['expira']));
              printf('<br><strong style="color:%s">%s</strong>',
                $dias < 0 ? '#b32d2e' : ($dias <= 3 ? '#8a6d00' : '#1a7f37'),
                esc_html($dias < 0
                  ? sprintf('venceu ha %d dia(s)', abs($dias))
                  : ($dias === 0 ? 'vence hoje' : sprintf('em %d dia(s)', $dias))));
              ?>
            </td>
            <td><?php echo esc_html((string) get_post_meta($id, 'apix_plano', true)); ?></td>
            <td>
              <?php if ($env) : ?>
                <?php foreach ($env as $chave => $quando) : ?>
                  <small><?php echo esc_html(apix_rotulo_marco($chave)); ?>
                  — <?php echo esc_html(date_i18n('d/m H:i', (int) $quando)); ?></small><br>
                <?php endforeach; ?>
              <?php else : ?>
                <small style="opacity:.6">nenhum ainda</small>
              <?php endif; ?>
            </td>
            <td>
              <?php if ($wa !== '') : ?>
                <a class="button button-primary" target="_blank" rel="noopener"
                   href="<?php echo esc_url($wa); ?>">Abrir no WhatsApp</a>
              <?php else : ?>
                <small style="color:#b32d2e">sem numero valido</small>
              <?php endif; ?>
            </td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    <?php endif; ?>

    <p style="margin-top:1.5rem"><small>O texto da mensagem e os marcos de aviso
    ficam em <a href="<?php echo esc_url(admin_url('options-general.php?page=anuncie-pix')); ?>">Configuracoes
    &rarr; Anuncie com Pix</a>.</small></p>
  </div>
  <?php
}

/** "a7" -> "7 dias antes". */
function apix_rotulo_marco($chave) {
  $n = (int) substr($chave, 1);
  return strpos($chave, 'a') === 0
    ? sprintf('%d dia(s) antes', $n)
    : sprintf('%d dia(s) depois', $n);
}
