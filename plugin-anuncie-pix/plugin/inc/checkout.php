<?php
/**
 * Checkout: a tela do Pix.
 *
 * Separada do formulario porque e a tela que o anunciante olha com o dinheiro na
 * mao. Ela precisa responder tres coisas sem rolagem: o que estou comprando,
 * quanto custa, e o que acontece depois que eu pagar.
 *
 * Tudo visual sai dos tokens de inc/visual.php, entao o checkout herda a cor, o
 * raio e a fonte do tema — claro ou escuro — sem configuracao. Quem quiser mexer
 * no layout de verdade cria anuncie-pix/checkout.php no tema e recebe os dados
 * prontos, sem editar o plugin.
 */

if (!defined('ABSPATH')) exit;

/** Monta a tela do Pix de um token. */
function apix_painel_pix($token) {
  $post_id = apix_post_por_token($token);
  if (!$post_id) {
    return apix_css() . '<div class="apix"><div class="apix-erro">Anuncio nao encontrado. '
      . 'O link pode ter expirado.</div></div>';
  }

  $status   = (string) get_post_meta($post_id, 'apix_status', true);
  $publicado = get_post_status($post_id) === 'publish';
  $pago     = in_array($status, apix_status_pagos(), true);

  // ja pago: nao mostra QR de cobranca liquidada
  if ($pago || ($publicado && !get_post_meta($post_id, 'apix_renov_cobranca', true))) {
    return apix_checkout_pronto($post_id);
  }

  $cobranca = (string) get_post_meta($post_id, 'apix_cobranca', true);
  $renov    = (string) get_post_meta($post_id, 'apix_renov_cobranca', true);
  if ($renov !== '') $cobranca = $renov;

  // o payload nao muda enquanto a cobranca existe; guardado para nao bater na
  // API a cada recarregada — e o anunciante recarrega, esperando a confirmacao
  $qr = get_post_meta($post_id, 'apix_qr', true);
  if (!is_array($qr) || empty($qr['payload'])) {
    $qr = $cobranca !== '' ? apix_pix_qrcode($cobranca) : new WP_Error('apix', 'sem cobranca');
    if (!is_wp_error($qr) && !empty($qr['payload'])) {
      update_post_meta($post_id, 'apix_qr', [
        'payload'      => (string) $qr['payload'],
        'encodedImage' => (string) ($qr['encodedImage'] ?? ''),
      ]);
    }
  }

  if (is_wp_error($qr) || empty($qr['payload'])) return apix_checkout_falhou();

  $dados = [
    'post_id'  => $post_id,
    'token'    => $token,
    'payload'  => (string) $qr['payload'],
    'imagem'   => (string) ($qr['encodedImage'] ?? ''),
    'valor'    => (float) get_post_meta($post_id, 'apix_valor', true),
    'plano'    => apix_plano((string) get_post_meta($post_id,
                    $renov !== '' ? 'apix_renov_plano' : 'apix_plano', true)),
    'renovacao'=> $renov !== '',
    'titulo'   => get_the_title($post_id),
    'status_url'=> rest_url(APIX_NS . '/status'),
  ];

  // o tema manda, se quiser
  $proprio = apix_template('checkout', $dados);
  if ($proprio !== '') return apix_css() . $proprio;

  return apix_css() . apix_checkout_css() . apix_checkout_html($dados);
}

/* ------------------------------------------------------------------- telas */

function apix_checkout_html($d) {
  $h  = '<div class="apix apix-co">';
  $h .= apix_logo_html();
  $h .= apix_passos_html(2);

  $h .= '<h3>' . ($d['renovacao'] ? 'Renovar o anuncio' : 'Pague o Pix para publicar') . '</h3>';

  /* ---- resumo do pedido ---- */
  $h .= '<div class="apix-co__resumo">';
  $h .= '<div class="apix-co__item"><span>Anuncio</span><strong>'
      . esc_html($d['titulo']) . '</strong></div>';
  if ($d['plano']) {
    $h .= '<div class="apix-co__item"><span>Plano</span><strong>'
        . esc_html($d['plano']['nome']) . '</strong></div>';
    $h .= '<div class="apix-co__item"><span>Tempo no ar</span><strong>'
        . (int) $d['plano']['dias'] . ' dias</strong></div>';
  }
  $h .= '<div class="apix-co__item apix-co__item--total"><span>Total</span><strong>'
      . esc_html(apix_moeda($d['valor'])) . '</strong></div>';
  $h .= '</div>';

  if ($d['renovacao']) {
    $h .= '<p class="apix-dica">A renovacao soma ao prazo que ainda resta: voce '
        . 'nao perde os dias que sobraram.</p>';
  }

  /* ---- QR e copia e cola ---- */
  $h .= '<div class="apix-co__pix">';
  if ($d['imagem'] !== '') {
    $h .= '<img class="apix-co__qr" alt="QR Code do Pix" width="240" height="240" '
        . 'src="data:image/png;base64,' . esc_attr($d['imagem']) . '">';
  }
  $h .= '<div class="apix-co__cola">';
  $h .= '<label for="apix-payload">Pix Copia e Cola</label>';
  $h .= '<div class="apix-co__linha">'
      . '<input type="text" id="apix-payload" readonly value="' . esc_attr($d['payload']) . '">'
      . '<button type="button" id="apix-copiar">Copiar</button></div>';
  $h .= '<p class="apix-dica">Abra o aplicativo do banco, escolha Pix Copia e '
      . 'Cola e cole o codigo. Ou aponte a camera para o QR Code.</p>';
  $h .= '</div></div>';

  /* ---- estado ---- */
  $h .= '<p class="apix-co__estado" id="apix-estado">'
      . '<span class="apix-co__girar" aria-hidden="true"></span> Aguardando o pagamento...</p>';
  $h .= '<p class="apix-dica">Esta pagina se atualiza sozinha. Assim que o Pix '
      . 'cair, o anuncio ' . ($d['renovacao'] ? 'e renovado' : 'publica')
      . ' automaticamente. Guarde este link para voltar depois.</p>';

  $whats = apix_config()['whats'];
  if ($whats !== '') {
    $h .= '<p class="apix-dica">Algum problema? <a rel="nofollow" target="_blank" '
        . 'href="https://wa.me/' . esc_attr($whats) . '">Fale com o suporte no WhatsApp</a></p>';
  }

  $h .= apix_checkout_js($d);

  return $h . '</div>';
}

/** Tela de pagamento confirmado. */
function apix_checkout_pronto($post_id) {
  $h  = apix_css() . apix_checkout_css() . '<div class="apix apix-co">';
  $h .= apix_logo_html();
  $h .= apix_passos_html(3);
  $h .= '<div class="apix-co__ok">';
  $h .= '<svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="currentColor" '
      . 'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      . '<path d="m4 12.5 5 5L20 6.5"/></svg>';
  $h .= '<h3>Pagamento confirmado</h3>';
  $h .= '<p>Seu anuncio esta no ar.</p>';
  $h .= '</div>';

  if (get_post_status($post_id) === 'publish') {
    $h .= '<p style="text-align:center"><a class="apix-botao" href="'
        . esc_url(get_permalink($post_id)) . '">Ver o anuncio</a></p>';
  }

  $area = apix_pagina_area();
  if ($area !== home_url('/')) {
    $h .= '<p class="apix-dica" style="text-align:center">Para editar ou renovar '
        . 'depois, use a <a href="' . esc_url($area) . '">area do anunciante</a>.</p>';
  }

  return $h . '</div>';
}

/** Tela de falha ao carregar o Pix. */
function apix_checkout_falhou() {
  $h = apix_css() . apix_checkout_css() . '<div class="apix apix-co">';
  $h .= '<div class="apix-erro">Nao foi possivel carregar o Pix agora. '
      . 'Recarregue a pagina em alguns segundos — seu anuncio esta salvo.</div>';

  $whats = apix_config()['whats'];
  if ($whats !== '') {
    $h .= '<p><a class="apix-botao" rel="nofollow" target="_blank" href="https://wa.me/'
        . esc_attr($whats) . '">Falar com o suporte</a></p>';
  }
  return $h . '</div>';
}

/**
 * Barra de etapas.
 *
 * Nao e enfeite: o anunciante acabou de entregar CPF, telefone e fotos a um site
 * que nao conhece. Ver "etapa 2 de 3" e saber que falta uma e a diferenca entre
 * esperar e desistir.
 */
function apix_passos_html($atual) {
  if (empty(apix_config()['passos'])) return '';

  $passos = ['Seus dados', 'Pagamento', 'No ar'];
  $h = '<ol class="apix-co__passos">';
  foreach ($passos as $i => $nome) {
    $n = $i + 1;
    $classe = $n < $atual ? ' apix-co__passo--feito' : ($n === $atual ? ' apix-co__passo--agora' : '');
    $h .= '<li class="apix-co__passo' . $classe . '"'
        . ($n === $atual ? ' aria-current="step"' : '') . '>'
        . '<span class="apix-co__num">' . ($n < $atual ? '&check;' : $n) . '</span>'
        . '<span>' . esc_html($nome) . '</span></li>';
  }
  return $h . '</ol>';
}

/* --------------------------------------------------------------------- CSS */
function apix_checkout_css() {
  static $saiu = false;
  if ($saiu) return '';
  $saiu = true;

  return '<style id="apix-co-css">
.apix-co{text-align:left}
.apix-logo{text-align:center;margin:0 0 1.2rem}
.apix-logo img{height:48px;width:auto;display:inline-block}
.apix-co__passos{display:flex;gap:.4rem;list-style:none;margin:0 0 1.6rem;padding:0;
  counter-reset:none;font-size:.82rem}
.apix-co__passo{flex:1;display:flex;flex-direction:column;align-items:center;gap:.35rem;
  text-align:center;opacity:.45;position:relative}
.apix-co__passo::after{content:"";position:absolute;top:13px;left:50%;width:100%;height:2px;
  background:var(--apix-linha);z-index:0}
.apix-co__passo:last-child::after{display:none}
.apix-co__num{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;
  border:2px solid var(--apix-linha);background:var(--apix-fundo);font-weight:700;
  position:relative;z-index:1}
.apix-co__passo--agora{opacity:1;font-weight:700}
.apix-co__passo--agora .apix-co__num{border-color:var(--apix-acento);
  background:var(--apix-acento);color:var(--apix-sobre-acento)}
.apix-co__passo--feito{opacity:.85}
.apix-co__passo--feito .apix-co__num{border-color:var(--apix-acento);color:var(--apix-acento)}
.apix-co__resumo{border:1px solid var(--apix-linha);border-radius:var(--apix-raio);
  padding:.3rem .95rem;margin:0 0 1.2rem;background:var(--apix-fundo-2)}
.apix-co__item{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;
  padding:.6rem 0;border-bottom:1px solid var(--apix-linha)}
.apix-co__item:last-child{border-bottom:0}
.apix-co__item>span{color:var(--apix-texto-2);font-size:.9rem}
.apix-co__item>strong{text-align:right}
.apix-co__item--total>strong{font-size:1.45rem;color:var(--apix-acento)}
.apix-co__pix{display:flex;gap:1.3rem;align-items:flex-start;margin:1.3rem 0}
.apix-co__qr{flex:0 0 auto;width:240px;height:240px;image-rendering:pixelated;
  background:#fff;padding:8px;border:1px solid var(--apix-linha);border-radius:var(--apix-raio)}
.apix-co__cola{flex:1;min-width:0}
.apix-co__cola label{margin-top:0}
.apix-co__linha{display:flex;gap:.5rem}
.apix-co__linha input{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.76rem}
.apix-co__linha button{margin-top:0;padding:.65rem 1.1rem;white-space:nowrap}
.apix-co__estado{display:flex;align-items:center;gap:.55rem;justify-content:center;
  font-weight:700;margin:1.4rem 0 .4rem}
.apix-co__girar{width:15px;height:15px;flex:0 0 auto;border-radius:50%;
  border:2px solid var(--apix-linha);border-top-color:var(--apix-acento);
  animation:apix-girar .9s linear infinite}
@keyframes apix-girar{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.apix-co__girar{animation:none}}
.apix-co__ok{text-align:center;color:var(--apix-acento);margin:1rem 0 .5rem}
.apix-co__ok h3{color:var(--apix-texto);margin:.5rem 0 .2rem}
.apix-co__ok p{color:var(--apix-texto)}
@media(max-width:600px){
  .apix-co__pix{flex-direction:column;align-items:center}
  .apix-co__qr{width:100%;max-width:260px;height:auto;aspect-ratio:1}
  .apix-co__cola{width:100%}
  .apix-co__passos{font-size:.74rem}
}
</style>';
}

/* ---------------------------------------------------------------------- JS */
/**
 * Copiar e consultar o status. Sem biblioteca e sem arquivo.
 *
 * A consulta bate no REST do proprio site, que le o banco — nao a API do Asaas.
 * Uma aba aberta por uma hora faria 720 chamadas, e varias abas estourariam o
 * limite da conta, travando a geracao de cobranca para todos os anunciantes.
 */
function apix_checkout_js($d) {
  $url = add_query_arg('t', $d['token'], $d['status_url']);

  return '<script>(function(){
var b=document.getElementById("apix-copiar"),c=document.getElementById("apix-payload");
if(b&&c)b.addEventListener("click",function(){
  var t=b.textContent;c.select();c.setSelectionRange(0,99999);
  function fim(){b.textContent="Copiado!";setTimeout(function(){b.textContent=t;},2200);}
  if(navigator.clipboard)navigator.clipboard.writeText(c.value).then(fim,function(){
    try{document.execCommand("copy");fim();}catch(e){}});
  else{try{document.execCommand("copy");fim();}catch(e){}}});
var e=document.getElementById("apix-estado"),n=0,u=' . wp_json_encode($url) . ';
function v(){if(n++>120)return;
 fetch(u,{headers:{"Accept":"application/json"}}).then(function(r){return r.json();})
 .then(function(d){if(d&&d.pago){e.innerHTML="Pagamento confirmado. Publicando...";
   setTimeout(function(){location.reload();},1500);}else{setTimeout(v,5000);}})
 .catch(function(){setTimeout(v,8000);});}
setTimeout(v,5000);})();</script>';
}
