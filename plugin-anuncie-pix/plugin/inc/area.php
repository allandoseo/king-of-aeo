<?php
/**
 * Area do anunciante: [minha-area]
 *
 * O anunciante entra, ve os anuncios dele, edita o texto, troca as fotos e
 * renova o plano sem passar por voce.
 *
 * NAO CRIA USUARIO DO WORDPRESS. De proposito, por tres motivos:
 *
 *  1. Usuario do WordPress tem capability, e capability se escala. Um bug em
 *     qualquer plugin instalado que vaze privilegio passa a valer para
 *     centenas de anunciantes que voce nao conhece.
 *  2. Senha de usuario e suporte eterno: esqueci, nao chega o e-mail, mudou o
 *     telefone. E senha fraca de terceiro vira porta de entrada no seu site.
 *  3. /wp-login.php com centenas de contas e alvo. Sem contas, nao ha o que
 *     tentar adivinhar.
 *
 * No lugar disso, link por e-mail (magic link): o anunciante digita o e-mail,
 * recebe um link de uso unico valido por 30 minutos, e fica com uma sessao em
 * cookie assinado. Quem tem o e-mail tem o anuncio — que e exatamente a mesma
 * garantia de um "esqueci minha senha", sem a senha no meio.
 */

if (!defined('ABSPATH')) exit;

define('APIX_COOKIE', 'apix_sessao');

add_shortcode('minha-area', 'apix_area');

/* --------------------------------------------------------------- roteamento */
function apix_area() {
  // o link do e-mail chega como ?entrar=<token>
  if (!empty($_GET['entrar'])) {
    return apix_consome_link(sanitize_text_field(wp_unslash($_GET['entrar'])));
  }

  $email = apix_sessao_email();
  if ($email === '') return apix_tela_login();

  $acao = isset($_GET['fazer']) ? sanitize_key($_GET['fazer']) : '';
  $alvo = isset($_GET['id']) ? absint($_GET['id']) : 0;

  if ($acao === 'editar' && $alvo) return apix_tela_editar($alvo, $email);
  if ($acao === 'renovar' && $alvo) return apix_tela_renovar($alvo, $email);

  return apix_tela_lista($email);
}

/* ------------------------------------------------------------------- sessao */

/**
 * O cookie e "hash do email . expira . assinatura". Sem o segredo do site nao
 * da para forjar, e nao ha nada dentro que sirva para outra coisa: o hash do
 * e-mail nao volta a ser e-mail.
 *
 * A montagem do valor fica separada do envio do cookie para poder ser testada:
 * setcookie() e funcao nativa do PHP e manda cabecalho de verdade, entao um
 * teste que passasse por ela testaria o PHP, nao esta logica.
 */
function apix_valor_sessao($email, $expira) {
  $alvo = apix_email_hash($email);
  return $alvo . '.' . $expira . '.' . apix_assina($alvo . '.' . $expira);
}

function apix_cria_sessao($email) {
  $dias   = max(1, (int) apix_config()['sessao_dias']);
  $expira = time() + $dias * DAY_IN_SECONDS;
  $valor  = apix_valor_sessao($email, $expira);

  setcookie(APIX_COOKIE, $valor, [
    'expires'  => $expira,
    'path'     => '/',
    'domain'   => '',
    'secure'   => is_ssl(),
    'httponly' => true,      // JavaScript nao le: XSS em qualquer plugin nao rouba a sessao
    'samesite' => 'Lax',
  ]);
}

function apix_encerra_sessao() {
  setcookie(APIX_COOKIE, '', ['expires' => time() - 3600, 'path' => '/', 'httponly' => true]);
}

/**
 * O e-mail da sessao atual, ou ''.
 *
 * Devolve o e-mail de verdade, lido do anuncio: o cookie so guarda o hash, e e
 * o hash que amarra os dois. Assim um cookie valido continua sem servir para
 * descobrir o e-mail de ninguem.
 */
function apix_sessao_email() {
  $bruto = isset($_COOKIE[APIX_COOKIE]) ? (string) $_COOKIE[APIX_COOKIE] : '';
  if ($bruto === '') return '';

  $partes = explode('.', $bruto);
  if (count($partes) !== 3) return '';
  [$alvo, $expira, $assinatura] = $partes;

  if (!ctype_digit($expira) || (int) $expira < time()) return '';
  if (!hash_equals(apix_assina($alvo . '.' . $expira), $assinatura)) return '';

  $ids = apix_anuncios_por_hash($alvo, 1);
  if (!$ids) return '';

  return (string) get_post_meta($ids[0], 'apix_email', true);
}

function apix_assina($dado) {
  return substr(hash_hmac('sha256', $dado, wp_salt('auth')), 0, 32);
}

function apix_email_hash($email) {
  return substr(hash_hmac('sha256', strtolower(trim($email)), wp_salt('nonce')), 0, 24);
}

/* -------------------------------------------------------------- tela: login */
function apix_tela_login() {
  $aviso = get_transient('apix_aviso_' . apix_ip_hash());
  if ($aviso) delete_transient('apix_aviso_' . apix_ip_hash());

  $h = apix_css() . '<div class="apix">';
  if ($aviso) $h .= '<div class="apix-aviso">' . esc_html($aviso) . '</div>';

  $h .= '<h3>Area do anunciante</h3>';
  $h .= '<p>Digite o e-mail que voce usou para anunciar. Enviamos um link de '
      . 'acesso — nao tem senha para lembrar.</p>';
  $h .= '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
  $h .= '<input type="hidden" name="action" value="apix_link">';
  $h .= wp_nonce_field('apix_link', 'apix_nonce', true, false);
  $h .= '<input type="hidden" name="apix_origem" value="' . esc_attr(apix_url_atual()) . '">';
  $h .= '<label for="apix-login">E-mail</label>';
  $h .= '<input type="email" id="apix-login" name="email" required autocomplete="email">';
  $h .= '<button type="submit">Enviar o link de acesso</button>';
  $h .= '</form></div>';

  return $h;
}

/* --------------------------------------------------------- envio do link */
add_action('admin_post_nopriv_apix_link', 'apix_envia_link');
add_action('admin_post_apix_link', 'apix_envia_link');

function apix_envia_link() {
  $volta = isset($_POST['apix_origem']) ? esc_url_raw(wp_unslash($_POST['apix_origem'])) : home_url('/');
  if (!apix_url_do_site($volta)) $volta = home_url('/');

  if (!isset($_POST['apix_nonce']) || !wp_verify_nonce($_POST['apix_nonce'], 'apix_link')) {
    apix_avisa($volta, 'A pagina expirou. Tente de novo.');
  }

  $email = sanitize_email(wp_unslash($_POST['email'] ?? ''));

  // A MENSAGEM E SEMPRE A MESMA, exista o e-mail ou nao. Responder "nao
  // encontramos esse e-mail" transforma o formulario numa consulta: da para
  // descobrir quem anuncia aqui testando uma lista de e-mails.
  $generica = 'Se existir anuncio com esse e-mail, o link de acesso acaba de ser enviado. '
            . 'Confira a caixa de entrada e o spam.';

  if (!is_email($email)) apix_avisa($volta, $generica);

  // freio duplo: por IP e pelo proprio e-mail. So por IP, uma botnet pede mil
  // links para o mesmo e-mail e enche a caixa de alguem no seu nome — e o seu
  // dominio e que ganha reputacao de spam.
  $f_ip = 'apix_lk_ip_' . apix_ip_hash();
  $f_em = 'apix_lk_em_' . apix_email_hash($email);
  if ((int) get_transient($f_ip) >= 5 || (int) get_transient($f_em) >= 3) {
    apix_avisa($volta, $generica);
  }
  set_transient($f_ip, (int) get_transient($f_ip) + 1, HOUR_IN_SECONDS);
  set_transient($f_em, (int) get_transient($f_em) + 1, HOUR_IN_SECONDS);

  $ids = apix_anuncios_por_hash(apix_email_hash($email), 1);
  if (!$ids) apix_avisa($volta, $generica);   // sai calado, com a mesma frase

  $minutos = max(5, (int) apix_config()['link_min']);
  $token   = wp_generate_password(40, false, false);

  // guardado pelo hash do token: um dump da wp_options nao entrega links vivos
  set_transient('apix_link_' . hash('sha256', $token), apix_email_hash($email), $minutos * MINUTE_IN_SECONDS);

  $url = add_query_arg('entrar', $token, $volta);

  $corpo = "Ola.\n\n"
         . "Use o link abaixo para acessar seus anuncios em " . home_url() . ":\n\n"
         . $url . "\n\n"
         . "O link vale por {$minutos} minutos e serve uma vez so.\n"
         . "Se nao foi voce que pediu, ignore este e-mail: nada muda.\n";

  wp_mail($email, 'Seu link de acesso - ' . wp_specialchars_decode(get_bloginfo('name'), ENT_QUOTES), $corpo);

  apix_avisa($volta, $generica);
}

/** Troca o token do link por uma sessao. */
function apix_consome_link($token) {
  $chave = 'apix_link_' . hash('sha256', $token);
  $alvo  = get_transient($chave);

  if (!$alvo) {
    return apix_css() . '<div class="apix"><div class="apix-erro">Este link expirou ou '
      . 'ja foi usado. Peca outro.</div></div>' . apix_tela_login();
  }

  // uso unico: apagado antes de qualquer coisa, para link reenviado ou link que
  // vazou no historico do navegador nao servir uma segunda vez
  delete_transient($chave);

  $ids = apix_anuncios_por_hash($alvo, 1);
  if (!$ids) {
    return apix_css() . '<div class="apix"><div class="apix-erro">Nao encontramos anuncios.</div></div>';
  }

  apix_cria_sessao((string) get_post_meta($ids[0], 'apix_email', true));

  // redireciona para limpar o token da URL: URL com token fica no historico, no
  // Referer e no log do servidor
  wp_safe_redirect(remove_query_arg('entrar', apix_url_atual()));
  exit;
}

/* --------------------------------------------------------------- tela: lista */
function apix_tela_lista($email) {
  $ids = apix_anuncios_por_hash(apix_email_hash($email), 30);
  $base = apix_url_atual();

  $h = apix_css() . apix_css_area() . '<div class="apix">';
  $h .= '<div class="apix-topo"><h3>Seus anuncios</h3>'
      . '<a class="apix-sair" href="' . esc_url(add_query_arg('fazer', 'sair', $base)) . '">Sair</a></div>';

  if (!$ids) {
    $h .= '<p>Nenhum anuncio neste e-mail.</p></div>';
    return $h;
  }

  foreach ($ids as $id) {
    $estado = apix_estado_anuncio($id);
    $h .= '<div class="apix-card">';
    $h .= '<h4>' . esc_html(get_the_title($id)) . '</h4>';
    $h .= '<p class="apix-estado-linha"><span class="apix-pill apix-pill--' . esc_attr($estado['cor'])
        . '">' . esc_html($estado['rotulo']) . '</span> ' . esc_html($estado['detalhe']) . '</p>';

    if (get_post_meta($id, 'apix_pendente', true)) {
      $h .= '<p class="apix-aviso">Voce enviou uma alteracao e ela esta em analise. '
          . 'O anuncio continua no ar com o conteudo anterior ate a liberacao.</p>';
    }

    $h .= '<p class="apix-acoes">';
    $h .= '<a href="' . esc_url(add_query_arg(['fazer' => 'editar', 'id' => $id], $base)) . '">Editar</a>';
    if (get_post_status($id) === 'publish') {
      $h .= ' <a href="' . esc_url(get_permalink($id)) . '">Ver no site</a>';
    }
    if ($estado['renovavel']) {
      $h .= ' <a href="' . esc_url(add_query_arg(['fazer' => 'renovar', 'id' => $id], $base)) . '">Renovar</a>';
    }
    if ($estado['pagavel']) {
      $t = (string) get_post_meta($id, 'apix_token', true);
      $h .= ' <a href="' . esc_url(add_query_arg('anuncio', $t, apix_pagina_anunciar())) . '">Pagar o Pix</a>';
    }
    $h .= '</p></div>';
  }

  return $h . '</div>';
}

/** Em que pe esta o anuncio, em linguagem de anunciante. */
function apix_estado_anuncio($id) {
  $status = (string) get_post_meta($id, 'apix_status', true);
  $pago   = in_array($status, apix_status_pagos(), true);
  $expira = (int) get_post_meta($id, 'apix_expira', true);
  $plano  = apix_plano((string) get_post_meta($id, 'apix_plano', true));
  $nome   = $plano ? $plano['nome'] : '';

  if (get_post_status($id) === 'publish') {
    $dias = $expira ? (int) ceil(($expira - time()) / DAY_IN_SECONDS) : 0;
    return [
      'rotulo'    => 'No ar',
      'cor'       => 'ok',
      'detalhe'   => $nome . ($dias > 0 ? sprintf(' — vence em %d dia(s)', $dias) : ''),
      'renovavel' => $dias <= 10,   // so oferece renovar perto do fim
      'pagavel'   => false,
    ];
  }

  if ($expira && $expira < time()) {
    return ['rotulo' => 'Vencido', 'cor' => 'mal', 'detalhe' => $nome . ' — renove para voltar ao ar',
            'renovavel' => true, 'pagavel' => false];
  }

  if (!$pago) {
    return ['rotulo' => 'Aguardando pagamento', 'cor' => 'espera',
            'detalhe' => $nome, 'renovavel' => false, 'pagavel' => true];
  }

  return ['rotulo' => 'Em analise', 'cor' => 'espera', 'detalhe' => $nome,
          'renovavel' => false, 'pagavel' => false];
}

/* -------------------------------------------------------------- tela: editar */
function apix_tela_editar($id, $email) {
  if (!apix_e_dono($id, $email)) return apix_negado();

  $base = apix_url_atual();
  $erros = get_transient('apix_ed_' . apix_email_hash($email));
  if ($erros) delete_transient('apix_ed_' . apix_email_hash($email));

  $pend = get_post_meta($id, 'apix_pendente', true);
  $moderado = apix_config()['moderar'] && get_post_status($id) === 'publish';

  // mostra o que esta em analise, se houver: senao o anunciante reescreve tudo
  // de novo achando que a alteracao nao foi
  $titulo = is_array($pend) && isset($pend['titulo']) ? $pend['titulo'] : get_the_title($id);
  $texto  = is_array($pend) && isset($pend['texto'])  ? $pend['texto']  : get_post_field('post_content', $id);

  $h = apix_css() . apix_css_area() . '<div class="apix">';
  $h .= '<p class="apix-volta"><a href="' . esc_url($base) . '">&larr; Seus anuncios</a></p>';
  $h .= '<h3>Editar anuncio</h3>';

  if ($erros && is_array($erros)) {
    $h .= '<div class="apix-erro"><ul>';
    foreach ($erros as $e) $h .= '<li>' . esc_html($e) . '</li>';
    $h .= '</ul></div>';
  }

  if ($moderado) {
    $h .= '<div class="apix-aviso">O texto e as fotos novas passam por uma '
        . 'conferencia antes de aparecer. <strong>Seu anuncio nao sai do ar '
        . 'enquanto isso</strong> — ele continua com o conteudo atual. '
        . 'Telefone e WhatsApp mudam na hora.</div>';
  }

  $h .= '<form method="post" enctype="multipart/form-data" action="'
      . esc_url(admin_url('admin-post.php')) . '">';
  $h .= '<input type="hidden" name="action" value="apix_salvar">';
  $h .= '<input type="hidden" name="id" value="' . (int) $id . '">';
  $h .= wp_nonce_field('apix_salvar_' . $id, 'apix_nonce', true, false);
  $h .= '<input type="hidden" name="apix_origem" value="' . esc_attr($base) . '">';

  $h .= '<label for="apix-ed-titulo">Nome do anuncio</label>';
  $h .= '<input type="text" id="apix-ed-titulo" name="titulo" maxlength="120" required value="'
      . esc_attr($titulo) . '">';

  $h .= '<label for="apix-ed-texto">Descricao</label>';
  $h .= '<textarea id="apix-ed-texto" name="texto" required maxlength="4000">'
      . esc_textarea($texto) . '</textarea>';
  $h .= '<p class="apix-dica">Minimo 80 caracteres. Nao escreva endereco residencial.</p>';

  $h .= '<label for="apix-ed-tel">Telefone</label>';
  $h .= '<input type="tel" id="apix-ed-tel" name="tel" maxlength="20" required value="'
      . esc_attr(get_post_meta($id, 'dmix_tel', true)) . '">';

  $h .= '<label for="apix-ed-wpp">WhatsApp</label>';
  $h .= '<input type="tel" id="apix-ed-wpp" name="wpp" maxlength="20" value="'
      . esc_attr(get_post_meta($id, 'dmix_wpp', true)) . '">';

  // --- fotos atuais
  $fotos = get_children(['post_parent' => $id, 'post_type' => 'attachment',
                         'post_mime_type' => 'image', 'numberposts' => -1,
                         'orderby' => 'menu_order ID', 'order' => 'ASC']);
  $capa = (int) get_post_thumbnail_id($id);

  $h .= '<h4>Fotos no ar</h4>';
  if (!$fotos) {
    $h .= '<p class="apix-dica">Nenhuma foto ainda.</p>';
  } else {
    $h .= '<div class="apix-grade">';
    foreach ($fotos as $f) {
      $h .= '<label class="apix-foto">';
      $h .= '<img src="' . esc_url(wp_get_attachment_image_url($f->ID, 'medium')) . '" alt="" loading="lazy">';
      $h .= '<span><input type="checkbox" name="apagar[]" value="' . (int) $f->ID . '"> Apagar</span>';
      $h .= '<span><input type="radio" name="capa" value="' . (int) $f->ID . '"'
          . checked($capa, $f->ID, false) . '> Capa</span>';
      $h .= '</label>';
    }
    $h .= '</div>';
  }

  // --- fotos em analise
  $espera = apix_fotos_em_analise($id);
  if ($espera) {
    $h .= '<h4>Fotos em analise</h4><div class="apix-grade">';
    foreach ($espera as $fid) {
      $h .= '<label class="apix-foto apix-foto--espera">';
      $h .= '<img src="' . esc_url(wp_get_attachment_image_url($fid, 'medium')) . '" alt="" loading="lazy">';
      $h .= '<span><input type="checkbox" name="apagar[]" value="' . (int) $fid . '"> Desistir</span>';
      $h .= '</label>';
    }
    $h .= '</div>';
  }

  $c = apix_config();
  $h .= '<h4>Adicionar fotos</h4>';
  $h .= '<input type="file" name="fotos[]" multiple accept="image/jpeg,image/png,image/webp">';
  $h .= '<p class="apix-dica">Ate ' . (int) $c['max_fotos'] . ' no total, ' . (int) $c['max_mb']
      . ' MB cada.</p>';

  $h .= '<button type="submit">Salvar</button>';
  $h .= '</form></div>';

  return $h;
}

/* -------------------------------------------------------------- salvamento */
add_action('admin_post_nopriv_apix_salvar', 'apix_salva_edicao');
add_action('admin_post_apix_salvar', 'apix_salva_edicao');

function apix_salva_edicao() {
  $email = apix_sessao_email();
  $id    = absint($_POST['id'] ?? 0);
  $volta = isset($_POST['apix_origem']) ? esc_url_raw(wp_unslash($_POST['apix_origem'])) : home_url('/');
  if (!apix_url_do_site($volta)) $volta = home_url('/');

  if ($email === '' || !$id || !apix_e_dono($id, $email)) {
    wp_safe_redirect($volta);
    exit;
  }
  if (!isset($_POST['apix_nonce']) || !wp_verify_nonce($_POST['apix_nonce'], 'apix_salvar_' . $id)) {
    apix_erro_edicao($email, $volta, ['A pagina expirou. Tente de novo.']);
  }

  $titulo = sanitize_text_field(wp_unslash($_POST['titulo'] ?? ''));
  $texto  = wp_kses_post(wp_unslash($_POST['texto'] ?? ''));
  $tel    = apix_so_digitos($_POST['tel'] ?? '');
  $wpp    = apix_so_digitos($_POST['wpp'] ?? '');

  $erros = [];
  if (mb_strlen($titulo) < 2) $erros[] = 'Escreva o nome do anuncio.';
  if (mb_strlen(wp_strip_all_tags($texto)) < 80) $erros[] = 'A descricao precisa de pelo menos 80 caracteres.';
  if (strlen($tel) < 10) $erros[] = 'O telefone precisa ter DDD e numero.';
  if ($wpp !== '' && strlen($wpp) < 10) $erros[] = 'O WhatsApp precisa ter DDD e numero.';
  if ($erros) apix_erro_edicao($email, $volta, $erros);

  // --- apagar foto e sempre imediato, publicado ou nao. Tirar conteudo do ar
  //     nunca e o risco; o risco e colocar. Travar a remocao atras de analise
  //     deixaria uma foto que a pessoa quer fora do ar por mais um dia.
  $apagar = isset($_POST['apagar']) && is_array($_POST['apagar']) ? $_POST['apagar'] : [];
  foreach ($apagar as $fid) {
    $fid = absint($fid);
    if ($fid && apix_foto_do_anuncio($fid, $id)) wp_delete_attachment($fid, true);
  }

  // --- telefone e WhatsApp mudam na hora: sao dado de contato, nao conteudo
  update_post_meta($id, 'dmix_tel', $tel);
  update_post_meta($id, 'dmix_wpp', $wpp !== '' ? $wpp : $tel);

  // --- capa
  if (!empty($_POST['capa'])) {
    $capa = absint($_POST['capa']);
    if ($capa && apix_foto_do_anuncio($capa, $id)) set_post_thumbnail($id, $capa);
  }

  $moderado = apix_config()['moderar'] && get_post_status($id) === 'publish';

  // --- fotos novas, respeitando o teto POR ANUNCIO
  $ja = count(get_children(['post_parent' => $id, 'post_type' => 'attachment',
                            'post_mime_type' => 'image', 'numberposts' => -1]))
      + count(apix_fotos_em_analise($id));
  $novas = apix_processa_fotos('fotos', $id, (int) apix_config()['max_fotos'] - $ja);
  if ($moderado && $novas['anexos']) {
    // Soltas do anuncio ate a liberacao. Se ficassem anexadas, qualquer galeria
    // do tema que lista filhos do post ja mostraria a foto nao conferida —
    // seria analise no papel e publicacao na pratica.
    foreach ($novas['anexos'] as $fid) {
      wp_update_post(['ID' => $fid, 'post_parent' => 0]);
      update_post_meta($fid, 'apix_espera_de', $id);
    }
  }

  if ($novas['erros']) {
    set_transient('apix_ed_' . apix_email_hash($email), $novas['erros'], 10 * MINUTE_IN_SECONDS);
  }

  // --- texto
  if ($moderado) {
    update_post_meta($id, 'apix_pendente', [
      'titulo' => $titulo,
      'texto'  => $texto,
      'quando' => gmdate('c'),
    ]);
    apix_avisa_dono_edicao($id, true);
    apix_erro_edicao($email, $volta, [], 'Alteracao enviada. Ela aparece depois da conferencia; '
      . 'seu anuncio continua no ar com o conteudo atual.');
  }

  wp_update_post(['ID' => $id, 'post_title' => $titulo, 'post_content' => $texto]);
  apix_avisa_dono_edicao($id, false);
  apix_erro_edicao($email, $volta, [], 'Alteracoes salvas.');
}

/** Volta para a area com erros ou com um recado. */
function apix_erro_edicao($email, $volta, $erros, $recado = '') {
  if ($erros) set_transient('apix_ed_' . apix_email_hash($email), $erros, 10 * MINUTE_IN_SECONDS);
  if ($recado !== '') set_transient('apix_aviso_' . apix_ip_hash(), $recado, 10 * MINUTE_IN_SECONDS);
  wp_safe_redirect($volta);
  exit;
}

/* ------------------------------------------------------------ tela: renovar */
function apix_tela_renovar($id, $email) {
  if (!apix_e_dono($id, $email)) return apix_negado();

  $base = apix_url_atual();
  $h = apix_css() . apix_css_area() . '<div class="apix">';
  $h .= '<p class="apix-volta"><a href="' . esc_url($base) . '">&larr; Seus anuncios</a></p>';
  $h .= '<h3>Renovar "' . esc_html(get_the_title($id)) . '"</h3>';
  $h .= '<p>Escolha o plano. A renovacao soma ao prazo que ainda resta — voce '
      . 'nao perde os dias que sobraram.</p>';

  $h .= '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
  $h .= '<input type="hidden" name="action" value="apix_renovar">';
  $h .= '<input type="hidden" name="id" value="' . (int) $id . '">';
  $h .= wp_nonce_field('apix_renovar_' . $id, 'apix_nonce', true, false);
  $h .= '<input type="hidden" name="apix_origem" value="' . esc_attr($base) . '">';

  $h .= '<div class="apix-planos">';
  $atual = (string) get_post_meta($id, 'apix_plano', true);
  foreach (apix_config()['planos'] as $p) {
    $h .= '<label class="apix-plano"><input type="radio" name="plano" value="' . esc_attr($p['slug'])
        . '"' . checked($atual, $p['slug'], false) . ' required> '
        . '<b>' . esc_html($p['nome']) . '</b>'
        . '<span class="apix-preco">' . esc_html(apix_moeda($p['valor'])) . '</span>'
        . '<span>' . (int) $p['dias'] . ' dias</span></label>';
  }
  $h .= '</div><button type="submit">Gerar o Pix da renovacao</button></form></div>';

  return $h;
}

add_action('admin_post_nopriv_apix_renovar', 'apix_gera_renovacao');
add_action('admin_post_apix_renovar', 'apix_gera_renovacao');

function apix_gera_renovacao() {
  $email = apix_sessao_email();
  $id    = absint($_POST['id'] ?? 0);
  $volta = isset($_POST['apix_origem']) ? esc_url_raw(wp_unslash($_POST['apix_origem'])) : home_url('/');
  if (!apix_url_do_site($volta)) $volta = home_url('/');

  if ($email === '' || !$id || !apix_e_dono($id, $email)) { wp_safe_redirect($volta); exit; }
  if (!isset($_POST['apix_nonce']) || !wp_verify_nonce($_POST['apix_nonce'], 'apix_renovar_' . $id)) {
    apix_erro_edicao($email, $volta, ['A pagina expirou. Tente de novo.']);
  }

  $p = apix_plano(sanitize_key($_POST['plano'] ?? ''));
  if (!$p) apix_erro_edicao($email, $volta, ['Escolha um plano.']);

  $cliente = (string) get_post_meta($id, 'apix_cliente', true);
  if ($cliente === '') apix_erro_edicao($email, $volta, ['Nao foi possivel renovar. Fale com o suporte.']);

  $cobranca = apix_cobranca($cliente, $p['valor'],
    sprintf('Renovacao do anuncio %s - plano %s (%d dias)',
      get_the_title($id), $p['nome'], (int) $p['dias']), $id);

  if (is_wp_error($cobranca) || empty($cobranca['id'])) {
    apix_log('renovacao', is_wp_error($cobranca) ? $cobranca->get_error_message() : 'sem id');
    apix_erro_edicao($email, $volta, ['Nao foi possivel gerar a cobranca agora. Tente em alguns minutos.']);
  }

  // guardada em meta propria: o webhook usa isso para somar prazo em vez de
  // publicar de novo
  update_post_meta($id, 'apix_renov_cobranca', sanitize_text_field($cobranca['id']));
  update_post_meta($id, 'apix_renov_plano', $p['slug']);
  update_post_meta($id, 'apix_valor', (float) $p['valor']);
  delete_post_meta($id, 'apix_qr');   // o QR guardado e da cobranca antiga

  $t = (string) get_post_meta($id, 'apix_token', true);
  wp_safe_redirect(add_query_arg('anuncio', $t, apix_pagina_anunciar()));
  exit;
}

/* --------------------------------------------------------------------- sair */
add_action('template_redirect', function () {
  if (isset($_GET['fazer']) && $_GET['fazer'] === 'sair') {
    apix_encerra_sessao();
    wp_safe_redirect(remove_query_arg(['fazer', 'id'], apix_url_atual()));
    exit;
  }
});

/* --------------------------------------------------------------- utilidades */

/** Os anuncios de um hash de e-mail. */
function apix_anuncios_por_hash($hash, $quantos = 30) {
  return get_posts([
    'post_type'   => apix_cpt(),
    'post_status' => ['draft', 'pending', 'publish', 'private'],
    'numberposts' => $quantos,
    'fields'      => 'ids',
    'orderby'     => 'date',
    'order'       => 'DESC',
    'meta_key'    => 'apix_email_hash',
    'meta_value'  => $hash,
  ]);
}

/** O anuncio e deste e-mail? */
function apix_e_dono($id, $email) {
  if (get_post_type($id) !== apix_cpt()) return false;
  $guardado = (string) get_post_meta($id, 'apix_email_hash', true);
  if ($guardado === '') return false;
  return hash_equals($guardado, apix_email_hash($email));
}

/** A foto pertence a este anuncio (anexada ou em analise)? */
function apix_foto_do_anuncio($foto_id, $anuncio_id) {
  if (get_post_type($foto_id) !== 'attachment') return false;
  $pai = (int) get_post_field('post_parent', $foto_id);
  if ($pai === (int) $anuncio_id) return true;
  return (int) get_post_meta($foto_id, 'apix_espera_de', true) === (int) $anuncio_id;
}

/** IDs das fotos que estao soltas, esperando liberacao. */
function apix_fotos_em_analise($anuncio_id) {
  return get_posts([
    'post_type'   => 'attachment',
    'post_status' => 'inherit',
    'numberposts' => 20,
    'fields'      => 'ids',
    'meta_key'    => 'apix_espera_de',
    'meta_value'  => (int) $anuncio_id,
  ]);
}

function apix_negado() {
  return apix_css() . '<div class="apix"><div class="apix-erro">Este anuncio nao e seu.</div></div>';
}

function apix_avisa($url, $texto) {
  set_transient('apix_aviso_' . apix_ip_hash(), $texto, 10 * MINUTE_IN_SECONDS);
  wp_safe_redirect($url);
  exit;
}

/**
 * Acha a pagina que contem um shortcode, e guarda o ID para nao buscar de novo.
 *
 * A busca por conteudo e lenta e imprecisa; a opcao serve de cache. Se a pagina
 * for apagada ou despublicada, o cache e ignorado e a busca roda outra vez.
 */
function apix_pagina_por_shortcode($shortcode, $opcao) {
  $guardada = (int) get_option($opcao);
  if ($guardada && get_post_status($guardada) === 'publish') return get_permalink($guardada);

  $achadas = get_posts([
    'post_type'   => 'page',
    'post_status' => 'publish',
    'numberposts' => 1,
    'fields'      => 'ids',
    's'           => $shortcode,
  ]);
  if ($achadas) {
    update_option($opcao, (int) $achadas[0]);
    return get_permalink((int) $achadas[0]);
  }
  return home_url('/');
}

/** A pagina com [anunciar], para mandar o anunciante ao Pix. */
function apix_pagina_anunciar() {
  return apix_pagina_por_shortcode('[anunciar]', 'apix_pagina_anunciar');
}

/** A pagina com [minha-area], usada nos lembretes de vencimento. */
function apix_pagina_area() {
  return apix_pagina_por_shortcode('[minha-area]', 'apix_pagina_area');
}

/** Aviso ao dono do site a cada edicao. */
function apix_avisa_dono_edicao($id, $em_analise) {
  $assunto = sprintf('[%s] %s: %s',
    wp_specialchars_decode(get_bloginfo('name'), ENT_QUOTES),
    $em_analise ? 'Alteracao aguardando liberacao' : 'Anuncio editado pelo anunciante',
    get_the_title($id));

  $corpo = ($em_analise
      ? "O anunciante enviou uma alteracao. O anuncio continua no ar com o conteudo anterior.\n\n"
      : "O anunciante editou o anuncio e a alteracao ja esta no ar.\n\n")
    . 'Editar: ' . admin_url('post.php?action=edit&post=' . (int) $id) . "\n";

  wp_mail(get_option('admin_email'), $assunto, $corpo);
}

/* ------------------------------------------------------------ estilo da area */
function apix_css_area() {
  static $saiu = false;
  if ($saiu) return '';
  $saiu = true;
  // sem cor fixa: tudo sai dos tokens de inc/visual.php, entao a area acompanha
  // o tema — claro ou escuro — sem configuracao
  return '<style id="apix-area-css">
.apix-topo{display:flex;justify-content:space-between;align-items:baseline;gap:1rem}
.apix-sair{font-size:.88rem}
.apix-volta{margin:0 0 .4rem;font-size:.9rem}
.apix-card{border:1px solid var(--apix-linha);border-radius:var(--apix-raio);
  padding:1rem 1.1rem;margin:0 0 1rem;background:var(--apix-fundo)}
.apix-card h4{margin:0 0 .4rem;font-size:1.05rem}
.apix-estado-linha{margin:.2rem 0 .6rem;font-size:.9rem;color:var(--apix-texto-2)}
.apix-pill{display:inline-block;padding:.14rem .6rem;border-radius:999px;font-size:.74rem;
  font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.apix-pill--ok{background:color-mix(in srgb,#1a7f37 18%,transparent);color:#1a7f37}
.apix-pill--espera{background:color-mix(in srgb,#e0a800 20%,transparent);color:#8a6d00}
.apix-pill--mal{background:color-mix(in srgb,#c0392b 16%,transparent);color:#c0392b}
.apix-acoes{margin:0;display:flex;flex-wrap:wrap;gap:.9rem;font-size:.92rem}
.apix-grade{display:grid;gap:.7rem;grid-template-columns:repeat(auto-fill,minmax(130px,1fr))}
.apix-foto{display:block;border:1px solid var(--apix-linha);border-radius:var(--apix-raio);
  padding:.4rem;font-weight:400;font-size:.82rem;background:var(--apix-fundo)}
.apix-foto img{width:100%;height:auto;border-radius:calc(var(--apix-raio) - 2px);
  display:block;margin-bottom:.35rem}
.apix-foto span{display:flex;gap:.35rem;align-items:center}
.apix-foto input{accent-color:var(--apix-acento)}
.apix-foto--espera{border-style:dashed;border-color:#e0a800;
  background:color-mix(in srgb,#e0a800 8%,transparent)}
</style>';
}
