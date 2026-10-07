<?php
/**
 * Banco de teste dos lembretes de vencimento.
 *
 * O foco e apix_marco_lembrete(), que decide quem recebe o que e quando. E a
 * funcao em que errar significa mandar tres e-mails no mesmo dia, ou nenhum.
 *
 * Rode com: php teste-lembretes.php
 */
require __DIR__ . '/teste-wp-falso.php';
require __DIR__ . '/plugin/anuncie-pix.php';

ob_start();
$falhas = 0;
function ok($c,$m){ global $falhas; if($c){echo "  ok    $m\n"; return;} $falhas++; echo "  FALHA $m\n"; }

$antes  = [7, 3, 1];
$depois = [2];

echo "\n== ainda longe do vencimento ==\n";
ok(apix_marco_lembrete(30, $antes, $depois, []) === null, 'faltando 30 dias, nao avisa');
ok(apix_marco_lembrete(8,  $antes, $depois, []) === null, 'faltando 8 dias, nao avisa');

echo "\n== os marcos, um por vez ==\n";
$m = apix_marco_lembrete(7, $antes, $depois, []);
ok($m && $m['enviar'] === 'a7', 'faltando 7 dias, dispara o marco de 7');
ok($m['marcar'] === ['a7'], 'marca so o de 7');

$m = apix_marco_lembrete(5, $antes, $depois, ['a7' => 1]);
ok($m === null, 'faltando 5 dias com o de 7 ja enviado, fica calado');

$m = apix_marco_lembrete(3, $antes, $depois, ['a7' => 1]);
ok($m && $m['enviar'] === 'a3', 'faltando 3 dias, dispara o de 3');

$m = apix_marco_lembrete(1, $antes, $depois, ['a7' => 1, 'a3' => 1]);
ok($m && $m['enviar'] === 'a1', 'faltando 1 dia, dispara o de 1');

$m = apix_marco_lembrete(0, $antes, $depois, ['a7' => 1, 'a3' => 1]);
ok($m && $m['enviar'] === 'a1', 'vencendo hoje ainda cabe no marco de 1 dia');

echo "\n== nada se repete ==\n";
ok(apix_marco_lembrete(1, $antes, $depois, ['a7'=>1,'a3'=>1,'a1'=>1]) === null,
   'com os tres marcos enviados, nao manda de novo');
ok(apix_marco_lembrete(0, $antes, $depois, ['a7'=>1,'a3'=>1,'a1'=>1]) === null,
   'nem no dia do vencimento');

echo "\n== o site ficou fora do ar e voltou com tres marcos vencidos ==\n";
// este e o caso que importa: sem tratamento, sairiam a7, a3 e a1 de uma vez
$m = apix_marco_lembrete(1, $antes, $depois, []);
ok($m && $m['enviar'] === 'a1', 'manda so o MAIS URGENTE, nao os tres');
ok($m['marcar'] === ['a7', 'a3', 'a1'],
   'mas marca os tres como entregues, para nao disparar os atrasados na proxima rodada');
// confirma que a proxima rodada fica calada
ok(apix_marco_lembrete(1, $antes, $depois, array_fill_keys($m['marcar'], 1)) === null,
   'na rodada seguinte nao sai nada');

echo "\n== depois de vencer ==\n";
ok(apix_marco_lembrete(-1, $antes, $depois, ['a7'=>1,'a3'=>1,'a1'=>1]) === null,
   'vencido ha 1 dia, o marco de 2 dias ainda nao chegou');
$m = apix_marco_lembrete(-2, $antes, $depois, ['a7'=>1,'a3'=>1,'a1'=>1]);
ok($m && $m['enviar'] === 'd2', 'vencido ha 2 dias, dispara o aviso de depois');
ok(apix_marco_lembrete(-5, $antes, $depois, ['a7'=>1,'a3'=>1,'a1'=>1,'d2'=>1]) === null,
   'com o de depois ja enviado, para de insistir');

echo "\n== marco de antes nao vale depois de vencido ==\n";
// faltando -3 dias nao e "faltando 3 dias"
$m = apix_marco_lembrete(-3, [3], [], []);
ok($m === null, 'dias negativos nao disparam marco de antes');

echo "\n== configuracao vazia ==\n";
ok(apix_marco_lembrete(1, [], [], []) === null, 'sem marcos configurados, nunca avisa');
ok(apix_marco_lembrete(-9, [], [], []) === null, 'nem depois de vencer');

echo "\n== ordem da configuracao nao importa ==\n";
$m = apix_marco_lembrete(2, [1, 7, 3], [], []);
ok($m && $m['enviar'] === 'a3', 'configurado como "1, 7, 3", faltando 2 dias dispara o de 3');

echo "\n== numero negativo ou zero na configuracao e ignorado ==\n";
$m = apix_marco_lembrete(1, [0, -5, 3], [], []);
ok($m && $m['enviar'] === 'a3' && $m['marcar'] === ['a3'], 'so o 3 valeu');

echo "\n== leitura da lista do painel ==\n";
ok(apix_lista_numeros('7, 3, 1') === [7,3,1],       'virgula e espaco');
ok(apix_lista_numeros('7;3 1') === [7,3,1],         'qualquer separador serve');
ok(apix_lista_numeros('7, 7, 3') === [7,3],         'repetido entra uma vez');
ok(apix_lista_numeros('') === [],                   'vazio devolve lista vazia');
ok(apix_lista_numeros('abc') === [],                'texto sem numero devolve vazio');
ok(apix_lista_numeros('0, 400, 5') === [5],         'zero e acima de 365 saem');

echo "\n== telefone para o link do WhatsApp ==\n";
ok(apix_telefone_internacional('(11) 98888-7777') === '5511988887777', 'celular com DDD ganha o 55');
ok(apix_telefone_internacional('11988887777')     === '5511988887777', 'so digitos, ganha o 55');
ok(apix_telefone_internacional('5511988887777')   === '5511988887777', 'quem ja tem o 55 nao ganha outro');
ok(apix_telefone_internacional('1133334444')      === '551133334444',  'fixo de 10 digitos tambem');
ok(apix_telefone_internacional('988887777')       === '', 'sem DDD nao da para adivinhar: devolve vazio');
ok(apix_telefone_internacional('')                === '', 'vazio devolve vazio');
ok(apix_telefone_internacional('abc')             === '', 'texto devolve vazio');
ok(apix_telefone_internacional('+55 (11) 98888-7777') === '5511988887777', 'com + e pontuacao');

echo "\n== marcadores do texto ==\n";
$id = apix_falso_post(['post_title' => 'Ana - Santo Andre'], [
  'apix_email' => 'ana@exemplo.com', 'apix_plano' => 'vip',
]);
$texto = apix_preenche('{anuncio} / {dias} / {plano} / {valor} / {site}', $id, 3);
ok(strpos($texto, 'Ana - Santo Andre') !== false, '{anuncio} trocado');
ok(strpos($texto, '/ 3 /') !== false,             '{dias} trocado');
ok(strpos($texto, 'VIP') !== false,               '{plano} trocado');
ok(strpos($texto, 'R$ 149,90') !== false,         '{valor} trocado');
ok(strpos($texto, '{') === false,                 'nenhum marcador sobrou');

// dias negativo sai positivo no texto: "vence em -3 dias" nao se escreve
ok(strpos(apix_preenche('{dias}', $id, -3), '3') === 0, '{dias} sai sempre positivo');

echo "\n== link do WhatsApp ==\n";
update_post_meta($id, 'dmix_wpp', '(11) 98888-7777');
$url = apix_whats_url($id, 3);
ok(strpos($url, 'https://wa.me/5511988887777?text=') === 0, 'URL do wa.me com o telefone certo');
ok(strpos($url, ' ') === false, 'a mensagem foi codificada para URL (sem espaco cru)');
ok(strpos(rawurldecode($url), 'Ana - Santo Andre') !== false, 'a mensagem decodificada traz o anuncio');

// sem WhatsApp, cai para o telefone
delete_post_meta($id, 'dmix_wpp');
update_post_meta($id, 'dmix_tel', '11977776666');
ok(strpos(apix_whats_url($id, 3), '5511977776666') !== false, 'sem WhatsApp, usa o telefone');

// sem numero nenhum
delete_post_meta($id, 'dmix_tel');
ok(apix_whats_url($id, 3) === '', 'sem numero, nao gera link quebrado');

echo "\n== rotulo do marco no admin ==\n";
ok(apix_rotulo_marco('a7') === '7 dia(s) antes',  'a7 legivel');
ok(apix_rotulo_marco('d2') === '2 dia(s) depois', 'd2 legivel');

echo "\n== a rodada completa grava o controle e nao repete ==\n";
$GLOBALS['fw']['emails'] = [];
$id2 = apix_falso_post(['post_status' => 'publish', 'post_title' => 'Beto'], [
  'apix_email'  => 'beto@exemplo.com',
  'apix_plano'  => 'comum',
  'apix_expira' => time() + 2 * DAY_IN_SECONDS,   // faltando 2 dias -> marco a3
]);
apix_roda_lembretes();
ok(count(apix_falso_emails()) === 1, 'saiu um e-mail');
$env = get_post_meta($id2, 'apix_lembretes', true);
ok(is_array($env) && isset($env['a7'], $env['a3']), 'marcou a7 e a3 como entregues');
ok(!isset($env['a1']), 'nao marcou o a1, que ainda nao chegou');

$GLOBALS['fw']['emails'] = [];
apix_roda_lembretes();
ok(count(apix_falso_emails()) === 0, 'rodar de novo no mesmo dia nao manda nada');

echo "\n== anuncio sem e-mail valido nao trava a rodada ==\n";
$GLOBALS['fw']['emails'] = [];
$id3 = apix_falso_post(['post_status' => 'publish'], [
  'apix_email' => 'nao-e-email', 'apix_expira' => time() + DAY_IN_SECONDS,
]);
apix_roda_lembretes();
ok(get_post_meta($id3, 'apix_lembretes', true) === '',
   'e-mail invalido nao marca como enviado (para nao perder o aviso em silencio)');

echo "\n== renovar zera o controle ==\n";
update_post_meta($id2, 'apix_renov_cobranca', 'pay_x');
update_post_meta($id2, 'apix_renov_plano', 'comum');
apix_aplica_renovacao($id2);
ok(get_post_meta($id2, 'apix_lembretes', true) === '',
   'depois de renovar, os marcos zeram — senao quem renova nunca mais seria avisado');

echo "\n" . ($falhas ? "$falhas FALHA(S)\n" : "todos os testes passaram\n");
exit($falhas ? 1 : 0);
