<?php
/**
 * Banco de teste da area do anunciante: sessao, link de acesso, dono do
 * anuncio, liberacao de alteracao e soma de prazo na renovacao.
 *
 * Rode com: php teste-area.php
 */
require __DIR__ . '/teste-wp-falso.php';
require __DIR__ . '/plugin/anuncie-pix.php';

// Buffer de saida: setcookie() e nativa e reclama de "headers already sent"
// quando o teste ja imprimiu. Com o buffer ligado, headers_sent() segue falso.
ob_start();

$falhas = 0;
function ok($c,$m){ global $falhas; if($c){echo "  ok    $m\n"; return;} $falhas++; echo "  FALHA $m\n"; }

/** Cria um anuncio de um e-mail. */
function anuncio($email, $campos = [], $metas = []) {
  return apix_falso_post($campos, array_merge([
    'apix_email'      => $email,
    'apix_email_hash' => apix_email_hash($email),
    'apix_token'      => str_repeat('t', 32),
    'apix_plano'      => 'vip',
  ], $metas));
}

$ana  = 'ana@exemplo.com';
$beto = 'beto@exemplo.com';

echo "\n== hash do e-mail ==\n";
ok(apix_email_hash($ana) === apix_email_hash('  ANA@Exemplo.COM  '),
   'maiusculas e espacos nao mudam o hash');
ok(apix_email_hash($ana) !== apix_email_hash($beto), 'e-mails diferentes, hashes diferentes');
ok(strpos(apix_email_hash($ana), '@') === false, 'o hash nao contem o e-mail');
ok(strlen(apix_email_hash($ana)) === 24, 'hash tem tamanho fixo');

echo "\n== cookie de sessao ==\n";
$id_ana = anuncio($ana);
$expira = time() + 7 * DAY_IN_SECONDS;
$_COOKIE[APIX_COOKIE] = apix_valor_sessao($ana, $expira);
ok(apix_sessao_email() === $ana, 'cookie valido devolve o e-mail certo');

// adulteracao do hash: trocar para o hash do Beto sem refazer a assinatura
$partes = explode('.', $_COOKIE[APIX_COOKIE]);
$_COOKIE[APIX_COOKIE] = apix_email_hash($beto) . '.' . $partes[1] . '.' . $partes[2];
ok(apix_sessao_email() === '', 'trocar o hash sem refazer a assinatura e recusado');

// esticar a validade sem refazer a assinatura
$_COOKIE[APIX_COOKIE] = $partes[0] . '.' . (time() + 999 * DAY_IN_SECONDS) . '.' . $partes[2];
ok(apix_sessao_email() === '', 'esticar o prazo sem refazer a assinatura e recusado');

// assinatura valida, mas prazo vencido
$velho = time() - 10;
$_COOKIE[APIX_COOKIE] = apix_valor_sessao($ana, $velho);
ok(apix_sessao_email() === '', 'cookie assinado mas vencido e recusado');

// lixo
foreach (['', 'abc', 'a.b', 'a.b.c.d'] as $lixo) {
  $_COOKIE[APIX_COOKIE] = $lixo;
  if (apix_sessao_email() !== '') { ok(false, 'cookie malformado recusado'); break; }
}
ok(true, 'cookie malformado recusado em todas as formas testadas');

// cookie de e-mail que nao tem anuncio nenhum
$_COOKIE[APIX_COOKIE] = apix_valor_sessao('ninguem@exemplo.com', $expira);
ok(apix_sessao_email() === '', 'cookie de e-mail sem anuncio nao abre sessao');

echo "\n== dono do anuncio ==\n";
$id_beto = anuncio($beto);
ok(apix_e_dono($id_ana, $ana),   'a Ana e dona do anuncio dela');
ok(!apix_e_dono($id_beto, $ana), 'a Ana NAO e dona do anuncio do Beto');
ok(!apix_e_dono($id_ana, $beto), 'o Beto NAO e dono do anuncio da Ana');
ok(!apix_e_dono(999999, $ana),   'anuncio inexistente nao tem dono');
$sem_hash = apix_falso_post([], ['apix_email' => $ana]);   // sem apix_email_hash
ok(!apix_e_dono($sem_hash, $ana), 'anuncio sem hash gravado nao abre para ninguem');

echo "\n== link de acesso por e-mail ==\n";
$GLOBALS['fw']['emails'] = [];
$_POST = ['apix_nonce' => 'x', 'email' => $ana, 'apix_origem' => 'https://exemplo.com/minha-area/'];
try { apix_envia_link(); } catch (ApixRedirecionou $e) {}
$enviados = apix_falso_emails();
ok(count($enviados) === 1, 'um e-mail foi enviado para quem tem anuncio');
ok($enviados[0]['para'] === $ana, 'foi para o e-mail certo');
preg_match('/entrar=([A-Za-z0-9]+)/', $enviados[0]['corpo'], $m);
ok(!empty($m[1]) && strlen($m[1]) === 40, 'o e-mail traz um token de 40 caracteres');
$token = $m[1] ?? '';
$aviso1 = get_transient('apix_aviso_' . apix_ip_hash());

// e-mail que nao tem anuncio: NAO envia, mas a mensagem tem de ser a mesma
$GLOBALS['fw']['emails'] = [];
delete_transient('apix_aviso_' . apix_ip_hash());
$_POST['email'] = 'nao-existe@exemplo.com';
try { apix_envia_link(); } catch (ApixRedirecionou $e) {}
ok(count(apix_falso_emails()) === 0, 'e-mail sem anuncio nao recebe nada');
$aviso2 = get_transient('apix_aviso_' . apix_ip_hash());
ok($aviso1 === $aviso2 && $aviso1 !== false,
   'a mensagem e IDENTICA nos dois casos (nao da para descobrir quem anuncia aqui)');

// e-mail invalido tambem devolve a mesma frase
delete_transient('apix_aviso_' . apix_ip_hash());
$_POST['email'] = 'isto-nao-e-email';
try { apix_envia_link(); } catch (ApixRedirecionou $e) {}
ok(get_transient('apix_aviso_' . apix_ip_hash()) === $aviso1, 'e-mail invalido devolve a mesma frase');

echo "\n== o token do link serve uma vez so ==\n";
$chave = 'apix_link_' . hash('sha256', $token);
ok(get_transient($chave) !== false, 'o token esta guardado');
ok(get_transient('apix_link_' . $token) === false,
   'guardado pelo HASH do token, nao pelo token (dump do banco nao entrega link vivo)');
try { apix_consome_link($token); } catch (ApixRedirecionou $e) {}
ok(get_transient($chave) === false, 'o token foi apagado no primeiro uso');
$saida = apix_consome_link($token);
ok(strpos((string) $saida, 'expirou ou') !== false, 'o segundo uso do mesmo link e recusado');
ok(strpos((string) apix_consome_link('token-que-nunca-existiu'), 'expirou ou') !== false,
   'token inventado e recusado');

echo "\n== freio do pedido de link ==\n";
$GLOBALS['fw']['transients'] = [];
$GLOBALS['fw']['emails'] = [];
$_POST['email'] = $ana;
for ($i = 0; $i < 6; $i++) { try { apix_envia_link(); } catch (ApixRedirecionou $e) {} }
ok(count(apix_falso_emails()) === 3,
   'o freio por e-mail corta no terceiro pedido, mesmo com 6 tentativas');

echo "\n== liberacao de alteracao ==\n";
$id = anuncio($ana, ['post_status' => 'publish', 'post_title' => 'Nome antigo',
                     'post_content' => 'Texto antigo com tamanho suficiente.']);
update_post_meta($id, 'apix_pendente', [
  'titulo' => 'Nome novo', 'texto' => 'Texto novo tambem com tamanho suficiente.',
  'quando' => gmdate('c'),
]);
ok(get_the_title($id) === 'Nome antigo', 'antes de liberar, o anuncio segue com o nome antigo');
ok(get_post_status($id) === 'publish',   'e continua NO AR enquanto espera');
apix_libera($id);
ok(get_the_title($id) === 'Nome novo', 'depois de liberar, o nome novo valeu');
ok(get_post_field('post_content', $id) === 'Texto novo tambem com tamanho suficiente.',
   'o texto novo valeu');
ok(get_post_meta($id, 'apix_pendente', true) === '', 'a alteracao pendente foi limpa');

echo "\n== recusa de alteracao ==\n";
$id2 = anuncio($ana, ['post_status' => 'publish', 'post_title' => 'Fica assim',
                      'post_content' => 'Conteudo que deve permanecer intacto.']);
update_post_meta($id2, 'apix_pendente', ['titulo' => 'Nao deve entrar', 'texto' => 'Nem isto.']);
$foto = apix_falso_post(['post_type' => 'attachment', 'post_status' => 'inherit',
                         'post_parent' => 0], ['apix_espera_de' => $id2]);
ok(in_array($foto, apix_fotos_em_analise($id2), true), 'a foto esta em analise');
apix_recusa($id2);
ok(get_the_title($id2) === 'Fica assim', 'recusar nao mexe no titulo');
ok(get_post_field('post_content', $id2) === 'Conteudo que deve permanecer intacto.',
   'recusar nao mexe no texto');
ok(get_post_meta($id2, 'apix_pendente', true) === '', 'a alteracao foi descartada');
ok(get_post_status($foto) === false, 'a foto recusada foi apagada');

echo "\n== foto em analise fica SOLTA do anuncio ==\n";
$id3 = anuncio($ana, ['post_status' => 'publish']);
$f3 = apix_falso_post(['post_type' => 'attachment', 'post_status' => 'inherit',
                       'post_parent' => 0], ['apix_espera_de' => $id3]);
ok(count(get_children(['post_parent' => $id3, 'post_type' => 'attachment'])) === 0,
   'enquanto espera, a foto NAO e filha do anuncio (galeria do tema nao a mostra)');
apix_libera($id3);
ok(count(get_children(['post_parent' => $id3, 'post_type' => 'attachment'])) === 1,
   'depois de liberar, a foto virou filha do anuncio');
ok(get_post_meta($f3, 'apix_espera_de', true) === '', 'a marca de espera foi removida');
ok((int) get_post_thumbnail_id($id3) === $f3, 'sem capa antes, a foto liberada virou capa');

echo "\n== a foto pertence ao anuncio? ==\n";
ok(apix_foto_do_anuncio($f3, $id3), 'foto anexada pertence');
$f_outro = apix_falso_post(['post_type' => 'attachment', 'post_status' => 'inherit',
                            'post_parent' => $id2], []);
ok(!apix_foto_do_anuncio($f_outro, $id3), 'foto de OUTRO anuncio nao pertence');
ok(!apix_foto_do_anuncio($id3, $id3), 'o proprio anuncio nao e foto dele');

echo "\n== renovacao SOMA ao prazo que resta ==\n";
$resta5 = time() + 5 * DAY_IN_SECONDS;
$id4 = anuncio($ana, ['post_status' => 'publish'], [
  'apix_expira'         => $resta5,
  'apix_renov_cobranca' => 'pay_123',
  'apix_renov_plano'    => 'comum',   // 30 dias
]);
apix_aplica_renovacao($id4);
$novo = (int) get_post_meta($id4, 'apix_expira', true);
ok(abs($novo - ($resta5 + 30 * DAY_IN_SECONDS)) <= 2,
   'quem renova com 5 dias sobrando fica com 35 — nao perde os 5');
ok(get_post_meta($id4, 'apix_cobranca', true) === 'pay_123',
   'a cobranca da renovacao virou a cobranca corrente');
ok(get_post_meta($id4, 'apix_renov_cobranca', true) === '', 'a meta de renovacao foi limpa');
ok(get_post_meta($id4, 'apix_plano', true) === 'comum', 'o plano foi atualizado');

echo "\n== renovacao de anuncio ja vencido parte de hoje ==\n";
$venceu = time() - 20 * DAY_IN_SECONDS;
$id5 = anuncio($ana, ['post_status' => 'draft'], [
  'apix_expira' => $venceu, 'apix_renov_cobranca' => 'pay_456', 'apix_renov_plano' => 'comum',
]);
apix_aplica_renovacao($id5);
$novo5 = (int) get_post_meta($id5, 'apix_expira', true);
ok(abs($novo5 - (time() + 30 * DAY_IN_SECONDS)) <= 2,
   'vencido ha 20 dias ganha 30 dias a partir de hoje, nao 10');
ok(get_post_status($id5) === 'publish', 'anuncio vencido volta ao ar ao renovar');

echo "\n== renovacao sem cobranca registrada nao faz nada ==\n";
$id6 = anuncio($ana, ['post_status' => 'publish'], ['apix_expira' => $resta5]);
apix_aplica_renovacao($id6);
ok((int) get_post_meta($id6, 'apix_expira', true) === $resta5,
   'sem apix_renov_cobranca, o prazo nao se move');

echo "\n== estado mostrado ao anunciante ==\n";
$no_ar = anuncio($ana, ['post_status' => 'publish'], ['apix_expira' => time() + 20 * DAY_IN_SECONDS]);
$e = apix_estado_anuncio($no_ar);
ok($e['rotulo'] === 'No ar' && $e['cor'] === 'ok', 'anuncio publicado aparece como No ar');
ok($e['renovavel'] === false, 'com 20 dias pela frente nao oferece renovar');

$quase = anuncio($ana, ['post_status' => 'publish'], ['apix_expira' => time() + 3 * DAY_IN_SECONDS]);
ok(apix_estado_anuncio($quase)['renovavel'] === true, 'com 3 dias pela frente oferece renovar');

$venc = anuncio($ana, ['post_status' => 'draft'], ['apix_expira' => time() - DAY_IN_SECONDS]);
$ev = apix_estado_anuncio($venc);
ok($ev['rotulo'] === 'Vencido' && $ev['renovavel'] === true, 'vencido aparece como Vencido e renovavel');

$esperando = anuncio($ana, ['post_status' => 'draft'], ['apix_status' => 'PENDING']);
$ee = apix_estado_anuncio($esperando);
ok($ee['rotulo'] === 'Aguardando pagamento' && $ee['pagavel'] === true,
   'nao pago aparece como aguardando pagamento, com link para pagar');

echo "\n== webhook: cobranca de renovacao e aceita, cobranca alheia nao ==\n";
$id7 = anuncio($ana, ['post_status' => 'publish'], [
  'apix_cobranca' => 'pay_antiga', 'apix_renov_cobranca' => 'pay_nova',
]);
$req = new WP_REST_Request([], ['asaas-access-token' => 'errado'], ['event' => 'PAYMENT_RECEIVED']);
$r = apix_webhook($req);
ok($r->get_status() === 401, 'token de webhook errado devolve 401');

echo "\n== lista de alteracoes pendentes no admin ==\n";
$pend = apix_com_alteracao_pendente(50);
ok(in_array($id2, $pend, true) === false, 'anuncio recusado saiu da lista de pendentes');

echo "\n" . ($falhas ? "$falhas FALHA(S)\n" : "todos os testes passaram\n");
exit($falhas ? 1 : 0);
