<?php
/**
 * Formulario publico [anunciar] e painel do Pix.
 *
 * A mesma pagina faz as duas coisas: sem ?anuncio na URL mostra o formulario;
 * com ?anuncio=<token> mostra o QR Code daquele anuncio. Pagina separada para
 * o pagamento significaria um token a mais viajando e mais um lugar para o
 * fluxo quebrar no meio.
 *
 * O token nao e o ID do post. E um segredo sorteado, guardado em meta: com o ID
 * na URL qualquer pessoa trocaria o numero e veria a cobranca de outro
 * anunciante, com nome, CPF e telefone dentro.
 */

if (!defined('ABSPATH')) exit;

add_shortcode('anunciar', 'apix_shortcode');

function apix_shortcode() {
  $token = isset($_GET['anuncio']) ? sanitize_text_field(wp_unslash($_GET['anuncio'])) : '';
  return $token !== '' ? apix_painel_pix($token) : apix_formulario();
}

/* ------------------------------------------------------------------ estilo */
/** CSS embutido, pelo mesmo motivo do plugin de banners: arquivo de plugin no
 *  HTML e caminho identico repetido nos sites da rede. */
function apix_css() {
  static $saiu = false;
  if ($saiu) return '';
  $saiu = true;
  return '<style>
.apix{max-width:720px;margin:0 auto;font-size:1rem}
.apix h3{margin:1.6rem 0 .6rem;font-size:1.1rem}
.apix label{display:block;margin:.9rem 0 .25rem;font-weight:600}
.apix input[type=text],.apix input[type=email],.apix input[type=tel],.apix textarea,.apix select{
  width:100%;padding:.6rem .7rem;border:1px solid #bbb;border-radius:6px;font:inherit;background:#fff;color:#111}
.apix textarea{min-height:9rem;resize:vertical}
.apix .apix-dica{font-size:.82rem;opacity:.7;margin:.2rem 0 0}
.apix .apix-check{display:flex;gap:.55rem;align-items:flex-start;margin:.9rem 0;font-weight:400}
.apix .apix-check input{margin-top:.28rem;flex:0 0 auto}
.apix .apix-planos{display:grid;gap:.7rem;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
.apix .apix-plano{border:2px solid #ddd;border-radius:8px;padding:.85rem;cursor:pointer;font-weight:400}
.apix .apix-plano:has(input:checked){border-color:#b5176b;background:#fdf4f8}
.apix .apix-plano b{display:block;font-size:1.05rem}
.apix .apix-plano .apix-preco{font-size:1.25rem;font-weight:700;margin:.3rem 0}
.apix button{margin-top:1.4rem;padding:.85rem 1.6rem;border:0;border-radius:6px;background:#b5176b;
  color:#fff;font:inherit;font-weight:700;cursor:pointer}
.apix button:hover{background:#8d1153}
.apix .apix-erro{border-left:4px solid #c0392b;background:#fdeceb;padding:.8rem 1rem;margin:0 0 1.2rem;border-radius:0 6px 6px 0}
.apix .apix-aviso{border-left:4px solid #e0a800;background:#fff8e6;padding:.8rem 1rem;margin:1rem 0;border-radius:0 6px 6px 0;font-size:.9rem}
.apix-pix{text-align:center}
.apix-pix img{width:260px;height:260px;max-width:100%;image-rendering:pixelated;border:1px solid #ddd;border-radius:8px}
.apix-copia{display:flex;gap:.5rem;margin:1rem auto;max-width:520px}
.apix-copia input{flex:1;font-family:ui-monospace,monospace;font-size:.78rem}
.apix-copia button{margin:0;white-space:nowrap}
.apix-estado{font-weight:700;margin:1.2rem 0}
.apix-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
</style>';
}

/* -------------------------------------------------------------- formulario */
function apix_formulario() {
  $c = apix_config();
  $erros = get_transient('apix_erros_' . apix_ip_hash());
  if ($erros) delete_transient('apix_erros_' . apix_ip_hash());

  $h = apix_css();
  $h .= '<div class="apix">';

  if ($erros && is_array($erros)) {
    $h .= '<div class="apix-erro"><strong>Nao foi possivel enviar:</strong><ul>';
    foreach ($erros as $e) $h .= '<li>' . esc_html($e) . '</li>';
    $h .= '</ul></div>';
  }

  if (apix_chave() === '') {
    $h .= '<div class="apix-erro">O formulario esta temporariamente fora do ar. '
        . 'Tente mais tarde.</div></div>';
    // mensagem neutra: dizer "a chave da API nao esta configurada" entrega a
    // pilha do site para quem estiver olhando
    return $h;
  }

  if ($c['ambiente'] !== 'producao') {
    $h .= '<div class="apix-aviso"><strong>Modo de teste.</strong> As cobrancas '
        . 'geradas aqui nao sao reais e nenhum anuncio sera cobrado de verdade.</div>';
  }

  $h .= '<form method="post" enctype="multipart/form-data" action="'
      . esc_url(admin_url('admin-post.php')) . '" novalidate>';
  $h .= '<input type="hidden" name="action" value="apix_enviar">';
  $h .= wp_nonce_field('apix_enviar', 'apix_nonce', true, false);
  $h .= '<input type="hidden" name="apix_origem" value="' . esc_attr(apix_url_atual()) . '">';
  // carimbo assinado: so para medir quanto tempo levou para preencher
  $h .= '<input type="hidden" name="apix_t" value="' . esc_attr(apix_carimbo()) . '">';
  // isca: robo preenche tudo que encontra; pessoa nao ve este campo
  $h .= '<div class="apix-hp"><label>Site<input type="text" name="apix_site" value="" '
      . 'tabindex="-1" autocomplete="off"></label></div>';

  $h .= '<h3>Seus dados de anuncio</h3>';
  $h .= apix_campo('text', 'nome', 'Nome que vai aparecer no anuncio', true);
  $h .= apix_campo('tel', 'tel', 'Telefone', true, 'Com DDD. Aparece no anuncio.');
  $h .= apix_campo('tel', 'wpp', 'WhatsApp', false, 'So numeros, com DDD. Deixe vazio se for o mesmo do telefone.');

  $h .= '<label for="apix-local">Cidade e estado</label>';
  $h .= '<input type="text" id="apix-local" name="local" required placeholder="Santo Andre, SP">';
  $h .= '<p class="apix-dica">Escreva cidade e estado, separados por virgula.</p>';

  $h .= '<label for="apix-texto">Descricao do anuncio</label>';
  $h .= '<textarea id="apix-texto" name="texto" required maxlength="4000"></textarea>';
  $h .= '<p class="apix-dica">Minimo 80 caracteres. Nao escreva endereco residencial.</p>';

  $h .= '<h3>Fotos</h3>';
  $h .= '<input type="file" name="fotos[]" multiple accept="image/jpeg,image/png,image/webp">';
  $h .= '<p class="apix-dica">Ate ' . (int) $c['max_fotos'] . ' fotos, ' . (int) $c['max_mb']
      . ' MB cada, em JPG, PNG ou WebP. A primeira vira a capa. As fotos sao '
      . 'reprocessadas no servidor, o que remove a localizacao de GPS que o '
      . 'celular grava dentro do arquivo.</p>';

  $h .= '<h3>Plano</h3><div class="apix-planos">';
  $primeiro = true;
  foreach ($c['planos'] as $p) {
    $h .= '<label class="apix-plano"><input type="radio" name="plano" value="'
        . esc_attr($p['slug']) . '"' . ($primeiro ? ' checked' : '') . ' required> '
        . '<b>' . esc_html($p['nome']) . '</b>'
        . '<span class="apix-preco">' . esc_html(apix_moeda($p['valor'])) . '</span>'
        . '<span>' . (int) $p['dias'] . ' dias no ar</span></label>';
    $primeiro = false;
  }
  $h .= '</div>';

  $h .= '<h3>Dados para a cobranca</h3>';
  $h .= '<p class="apix-dica">O Asaas exige CPF ou CNPJ para emitir o Pix. '
      . 'Estes dados nao aparecem no anuncio.</p>';
  $h .= apix_campo('text', 'cpf', 'CPF ou CNPJ', true);
  $h .= apix_campo('email', 'email', 'E-mail', true, 'Para voce receber o comprovante.');

  $h .= '<h3>Declaracoes</h3>';
  $h .= '<label class="apix-check"><input type="checkbox" name="idade" value="1" required> '
      . 'Declaro que tenho 18 anos ou mais e que todas as pessoas nas fotos '
      . 'enviadas sao maiores de 18 anos.</label>';
  $h .= '<label class="apix-check"><input type="checkbox" name="direitos" value="1" required> '
      . 'Declaro que as fotos sao minhas ou que tenho autorizacao de quem '
      . 'aparece nelas para publica-las neste site.</label>';
  $h .= '<label class="apix-check"><input type="checkbox" name="termos" value="1" required> '
      . 'Concordo com os termos de uso e autorizo o tratamento dos meus dados '
      . 'para publicar o anuncio e emitir a cobranca.</label>';
  $h .= '<p class="apix-dica">A data, a hora e o seu endereco de IP ficam '
      . 'registrados junto com estas declaracoes.</p>';

  $h .= '<button type="submit">Gerar o Pix e continuar</button>';
  $h .= '</form></div>';

  return $h;
}

/** Um campo simples. */
function apix_campo($tipo, $nome, $rotulo, $obrigatorio, $dica = '') {
  $id = 'apix-' . $nome;
  $h  = '<label for="' . esc_attr($id) . '">' . esc_html($rotulo) . '</label>';
  $h .= '<input type="' . esc_attr($tipo) . '" id="' . esc_attr($id) . '" name="'
      . esc_attr($nome) . '"' . ($obrigatorio ? ' required' : '') . ' maxlength="120">';
  if ($dica !== '') $h .= '<p class="apix-dica">' . esc_html($dica) . '</p>';
  return $h;
}

/* -------------------------------------------------------------- recebimento */
add_action('admin_post_nopriv_apix_enviar', 'apix_recebe');
add_action('admin_post_apix_enviar', 'apix_recebe');

function apix_recebe() {
  $c      = apix_config();
  $volta  = isset($_POST['apix_origem']) ? esc_url_raw(wp_unslash($_POST['apix_origem'])) : home_url('/');
  $volta  = apix_url_do_site($volta) ? $volta : home_url('/');
  $erros  = [];

  // --- nonce
  if (!isset($_POST['apix_nonce']) || !wp_verify_nonce($_POST['apix_nonce'], 'apix_enviar')) {
    apix_volta($volta, ['A pagina expirou. Preencha de novo.']);
  }

  // --- isca e tempo de preenchimento
  if (!empty($_POST['apix_site'])) apix_volta($volta, ['Envio recusado.']);
  $segundos = apix_idade_carimbo(isset($_POST['apix_t']) ? (string) $_POST['apix_t'] : '');
  if ($segundos === null) apix_volta($volta, ['A pagina expirou. Preencha de novo.']);
  if ($segundos < 8)     apix_volta($volta, ['Envio recusado.']);

  // --- limite por IP
  $chave_limite = 'apix_lim_' . apix_ip_hash();
  $usos = (int) get_transient($chave_limite);
  if ($usos >= max(1, (int) $c['limite_ip'])) {
    apix_volta($volta, ['Voce ja enviou varios anuncios na ultima hora. Tente mais tarde.']);
  }

  // --- campos
  $nome  = sanitize_text_field(wp_unslash($_POST['nome']  ?? ''));
  $tel   = apix_so_digitos($_POST['tel'] ?? '');
  $wpp   = apix_so_digitos($_POST['wpp'] ?? '');
  $local = sanitize_text_field(wp_unslash($_POST['local'] ?? ''));
  $texto = wp_kses_post(wp_unslash($_POST['texto'] ?? ''));
  $cpf   = apix_so_digitos($_POST['cpf'] ?? '');
  $email = sanitize_email(wp_unslash($_POST['email'] ?? ''));
  $plano = sanitize_key($_POST['plano'] ?? '');

  if (mb_strlen($nome) < 2)        $erros[] = 'Escreva o nome do anuncio.';
  if (strlen($tel) < 10)           $erros[] = 'O telefone precisa ter DDD e numero.';
  if ($wpp !== '' && strlen($wpp) < 10) $erros[] = 'O WhatsApp precisa ter DDD e numero.';
  if (mb_strlen($local) < 4)       $erros[] = 'Escreva a cidade e o estado.';
  if (mb_strlen(wp_strip_all_tags($texto)) < 80) $erros[] = 'A descricao precisa de pelo menos 80 caracteres.';
  if (!apix_cpf_cnpj_valido($cpf)) $erros[] = 'O CPF ou CNPJ nao e valido.';
  if (!is_email($email))           $erros[] = 'O e-mail nao e valido.';
  if (empty($_POST['idade']))      $erros[] = 'E preciso declarar que tem 18 anos ou mais.';
  if (empty($_POST['direitos']))   $erros[] = 'E preciso declarar que tem direito sobre as fotos.';
  if (empty($_POST['termos']))     $erros[] = 'E preciso concordar com os termos.';

  $p = apix_plano($plano);
  if (!$p) $erros[] = 'Escolha um plano.';

  if ($erros) apix_volta($volta, $erros);

  // O contador sobe AQUI, antes de criar qualquer coisa. Se subisse depois da
  // chamada ao Asaas, quem conseguisse fazer a cobranca falhar criaria rascunho
  // e subiria foto sem limite nenhum: o rascunho e as fotos ja existiriam, e o
  // contador nunca chegaria a ser incrementado.
  set_transient($chave_limite, $usos + 1, HOUR_IN_SECONDS);

  // --- rascunho. Nunca publicado aqui: quem publica e o webhook, depois do Pix
  $post_id = wp_insert_post([
    'post_type'    => apix_cpt(),
    'post_status'  => 'draft',
    'post_title'   => $nome,
    'post_content' => $texto,
    'post_author'  => 0,
  ], true);

  if (is_wp_error($post_id) || !$post_id) {
    apix_volta($volta, ['Nao foi possivel criar o anuncio. Tente de novo.']);
  }

  // --- fotos
  $fotos = apix_processa_fotos('fotos', $post_id);

  // --- local: "Santo Andre, SP" -> termo SP (pai) > Santo Andre (filho)
  apix_grava_local($post_id, $local);

  $token = wp_generate_password(32, false, false);

  update_post_meta($post_id, 'dmix_tel', $tel);
  update_post_meta($post_id, 'dmix_wpp', $wpp !== '' ? $wpp : $tel);
  update_post_meta($post_id, 'apix_token', $token);
  update_post_meta($post_id, 'apix_plano', $p['slug']);
  update_post_meta($post_id, 'apix_valor', (float) $p['valor']);
  update_post_meta($post_id, 'apix_email', $email);
  // e por este hash que a area do anunciante acha os anuncios da pessoa: o
  // cookie de sessao guarda o hash, nunca o e-mail
  update_post_meta($post_id, 'apix_email_hash', apix_email_hash($email));
  // CPF so o suficiente para conferir com o Asaas, nunca inteiro:
  // guardar CPF completo no banco de um site de anuncio e risco sem retorno
  update_post_meta($post_id, 'apix_cpf_fim', substr($cpf, -4));
  update_post_meta($post_id, 'apix_declaracao', [
    'idade'    => 1,
    'direitos' => 1,
    'termos'   => 1,
    'ip'       => apix_ip_hash(),     // hash, nao o IP cru
    'quando'   => gmdate('c'),
    'agente'   => substr(sanitize_text_field($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 180),
  ]);
  if ($fotos['erros']) update_post_meta($post_id, 'apix_fotos_erros', $fotos['erros']);

  // --- Asaas
  $cliente = apix_cliente($nome, $cpf, $email, $tel);
  if (is_wp_error($cliente)) {
    apix_log('fluxo', 'cliente: ' . $cliente->get_error_message());
    apix_volta($volta, ['Nao foi possivel gerar a cobranca agora. Tente em alguns minutos.']);
  }

  $cobranca = apix_cobranca($cliente, $p['valor'],
    sprintf('Anuncio %s - plano %s (%d dias)', $nome, $p['nome'], (int) $p['dias']), $post_id);
  if (is_wp_error($cobranca) || empty($cobranca['id'])) {
    apix_log('fluxo', 'cobranca: ' . (is_wp_error($cobranca) ? $cobranca->get_error_message() : 'sem id'));
    apix_volta($volta, ['Nao foi possivel gerar a cobranca agora. Tente em alguns minutos.']);
  }

  update_post_meta($post_id, 'apix_cobranca', sanitize_text_field($cobranca['id']));
  update_post_meta($post_id, 'apix_cliente', sanitize_text_field($cliente));
  update_post_meta($post_id, 'apix_status', 'PENDING');

  wp_safe_redirect(add_query_arg('anuncio', $token, $volta));
  exit;
}

/** Volta para o formulario com os erros na sessao do IP. */
function apix_volta($url, $erros) {
  set_transient('apix_erros_' . apix_ip_hash(), $erros, 10 * MINUTE_IN_SECONDS);
  wp_safe_redirect($url);
  exit;
}

/* ------------------------------------------------------------- painel do Pix */
function apix_painel_pix($token) {
  $post_id = apix_post_por_token($token);
  if (!$post_id) {
    return apix_css() . '<div class="apix"><div class="apix-erro">Anuncio nao encontrado. '
      . 'O link pode ter expirado.</div></div>';
  }

  $status = (string) get_post_meta($post_id, 'apix_status', true);
  $h = apix_css() . '<div class="apix apix-pix">';

  if (in_array($status, apix_status_pagos(), true) || get_post_status($post_id) === 'publish') {
    $h .= '<h3>Pagamento confirmado</h3>';
    $h .= '<p>Seu anuncio esta no ar.</p>';
    if (get_post_status($post_id) === 'publish') {
      $h .= '<p><a href="' . esc_url(get_permalink($post_id)) . '">Ver o anuncio</a></p>';
    }
    return $h . '</div>';
  }

  $cobranca = (string) get_post_meta($post_id, 'apix_cobranca', true);

  // O payload do Pix nao muda enquanto a cobranca existe, entao fica guardado.
  // Sem isso, cada recarregada da pagina — e o anunciante recarrega, esperando
  // a confirmacao — era uma chamada a API. Varias abas abertas estouravam o
  // limite da conta, e ai NENHUM anunciante conseguia gerar cobranca.
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

  if (is_wp_error($qr) || empty($qr['payload'])) {
    $h .= '<div class="apix-erro">Nao foi possivel carregar o Pix agora. '
        . 'Recarregue a pagina em alguns segundos.</div>';
    $whats = apix_config()['whats'];
    if ($whats !== '') {
      $h .= '<p>Se continuar, fale com o suporte: <a rel="nofollow" href="https://wa.me/'
          . esc_attr($whats) . '">WhatsApp</a></p>';
    }
    return $h . '</div>';
  }

  $valor = (float) get_post_meta($post_id, 'apix_valor', true);

  $h .= '<h3>Pague o Pix para publicar</h3>';
  $h .= '<p>Valor: <strong>' . esc_html(apix_moeda($valor)) . '</strong></p>';

  if (!empty($qr['encodedImage'])) {
    // base64 vem da API; o esc_attr nao deixa sair do atributo
    $h .= '<img alt="QR Code do Pix" src="data:image/png;base64,'
        . esc_attr($qr['encodedImage']) . '" width="260" height="260">';
  }

  $h .= '<div class="apix-copia">'
      . '<input type="text" id="apix-payload" readonly value="' . esc_attr($qr['payload']) . '">'
      . '<button type="button" id="apix-copiar">Copiar</button></div>';

  $h .= '<p class="apix-dica">Abra o aplicativo do seu banco, escolha Pix '
      . 'Copia e Cola e cole o codigo. Ou aponte a camera para o QR Code.</p>';

  $h .= '<p class="apix-estado" id="apix-estado">Aguardando o pagamento...</p>';
  $h .= '<p class="apix-dica">Esta pagina se atualiza sozinha. Assim que o Pix '
      . 'cair, o anuncio publica automaticamente — pode levar alguns segundos. '
      . 'Guarde este link para voltar depois.</p>';

  // JS embutido: so copia e consulta o status. Sem biblioteca, sem arquivo.
  $h .= '<script>(function(){
var b=document.getElementById("apix-copiar"),c=document.getElementById("apix-payload");
if(b&&c)b.addEventListener("click",function(){c.select();
  (navigator.clipboard?navigator.clipboard.writeText(c.value):Promise.reject()).then(
    function(){b.textContent="Copiado";},function(){document.execCommand("copy");b.textContent="Copiado";});});
var e=document.getElementById("apix-estado"),n=0;
var u=' . wp_json_encode(rest_url(APIX_NS . '/status')) . '+"?t="+encodeURIComponent(' . wp_json_encode($token) . ');
function v(){if(n++>120)return;fetch(u,{headers:{"Accept":"application/json"}}).then(function(r){return r.json();})
 .then(function(d){if(d&&d.pago){e.textContent="Pagamento confirmado. Publicando...";
   setTimeout(function(){location.reload();},1500);}else{setTimeout(v,5000);}})
 .catch(function(){setTimeout(v,8000);});}
setTimeout(v,5000);})();</script>';

  return $h . '</div>';
}

/* --------------------------------------------------------------- utilidades */

/** O post de um token, ou 0. */
function apix_post_por_token($token) {
  if (strlen($token) < 16) return 0;
  $achados = get_posts([
    'post_type'        => apix_cpt(),
    'post_status'      => ['draft', 'pending', 'publish', 'private'],
    'numberposts'      => 1,
    'fields'           => 'ids',
    'meta_key'         => 'apix_token',
    'meta_value'       => $token,
    'suppress_filters' => false,
  ]);
  return $achados ? (int) $achados[0] : 0;
}

/**
 * So os digitos de um campo. Nao precisa de wp_unslash: a barra invertida que o
 * WordPress acrescenta nao e digito, entao ja sai na regex.
 */
function apix_so_digitos($v) {
  return preg_replace('/\D+/', '', (string) $v);
}

/** R$ 1.234,56 */
function apix_moeda($v) {
  return 'R$ ' . number_format((float) $v, 2, ',', '.');
}

/** Hash do IP. Serve para limitar e para registrar, sem guardar o IP cru. */
function apix_ip_hash() {
  $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
  // atras de Cloudflare o IP real vem neste cabecalho
  if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) $ip = (string) $_SERVER['HTTP_CF_CONNECTING_IP'];
  return substr(wp_hash($ip), 0, 20);
}

/** Carimbo assinado de quando o formulario foi aberto. */
function apix_carimbo() {
  $t = (string) time();
  return $t . '.' . substr(wp_hash('apix' . $t), 0, 16);
}

/** Quantos segundos desde a abertura, ou null se o carimbo foi adulterado. */
function apix_idade_carimbo($carimbo) {
  $partes = explode('.', $carimbo, 2);
  if (count($partes) !== 2) return null;
  [$t, $assinatura] = $partes;
  if (!ctype_digit($t)) return null;
  if (!hash_equals(substr(wp_hash('apix' . $t), 0, 16), $assinatura)) return null;
  $idade = time() - (int) $t;
  if ($idade < 0 || $idade > 6 * HOUR_IN_SECONDS) return null;
  return $idade;
}

/** A URL da pagina atual, para o formulario voltar para ela. */
function apix_url_atual() {
  $id = get_queried_object_id();
  return $id ? get_permalink($id) : home_url('/');
}

/** A URL e deste site? Evita redirecionamento aberto para fora. */
function apix_url_do_site($url) {
  $a = wp_parse_url($url, PHP_URL_HOST);
  $b = wp_parse_url(home_url(), PHP_URL_HOST);
  return $a && $b && strtolower($a) === strtolower($b);
}

/**
 * Grava "Cidade, UF" na taxonomia local, criando UF como pai e Cidade como
 * filha. Termo novo entra sem publicar nada: o rascunho continua rascunho.
 */
function apix_grava_local($post_id, $texto) {
  if (!taxonomy_exists('local')) return;

  $partes = array_map('trim', explode(',', $texto));
  $cidade = $partes[0] ?? '';
  $uf     = isset($partes[1]) ? strtoupper(substr(preg_replace('/[^A-Za-z]/', '', $partes[1]), 0, 2)) : '';
  if ($cidade === '') return;

  $pai = 0;
  if ($uf !== '') {
    $t = term_exists($uf, 'local', 0);
    if (!$t) $t = wp_insert_term($uf, 'local');
    if (!is_wp_error($t)) $pai = (int) $t['term_id'];
  }

  $t = term_exists($cidade, 'local', $pai);
  if (!$t) $t = wp_insert_term($cidade, 'local', ['parent' => $pai]);
  if (is_wp_error($t)) return;

  wp_set_object_terms($post_id, [(int) $t['term_id']], 'local', false);
}

/**
 * Validacao de CPF e CNPJ pelo digito verificador.
 *
 * Nao e burocracia: CPF inventado faz o Asaas recusar a cobranca depois de o
 * anunciante ter preenchido tudo e subido as fotos. Melhor dizer na hora.
 */
function apix_cpf_cnpj_valido($n) {
  $n = preg_replace('/\D/', '', (string) $n);
  if (strlen($n) === 11) return apix_cpf_valido($n);
  if (strlen($n) === 14) return apix_cnpj_valido($n);
  return false;
}

function apix_cpf_valido($cpf) {
  if (preg_match('/^(\d)\1{10}$/', $cpf)) return false;
  for ($t = 9; $t < 11; $t++) {
    $soma = 0;
    for ($i = 0; $i < $t; $i++) $soma += (int) $cpf[$i] * (($t + 1) - $i);
    $d = ((10 * $soma) % 11) % 10;
    if ((int) $cpf[$t] !== $d) return false;
  }
  return true;
}

function apix_cnpj_valido($cnpj) {
  if (preg_match('/^(\d)\1{13}$/', $cnpj)) return false;
  $pesos = [[5,4,3,2,9,8,7,6,5,4,3,2], [6,5,4,3,2,9,8,7,6,5,4,3,2]];
  foreach ([12, 13] as $k => $pos) {
    $soma = 0;
    for ($i = 0; $i < $pos; $i++) $soma += (int) $cnpj[$i] * $pesos[$k][$i];
    $r = $soma % 11;
    $d = $r < 2 ? 0 : 11 - $r;
    if ((int) $cnpj[$pos] !== $d) return false;
  }
  return true;
}
