<?php
/**
 * Banco de teste da aparencia: sanitizacao de cor, tokens, heranca do tema e
 * substituicao de template.
 *
 * Rode com: php teste-visual.php
 */
require __DIR__ . '/teste-wp-falso.php';
require __DIR__ . '/plugin/anuncie-pix.php';

ob_start();
$falhas = 0;
function ok($c,$m){ global $falhas; if($c){echo "  ok    $m\n"; return;} $falhas++; echo "  FALHA $m\n"; }

/** Reinicia o "static $saiu" entre casos, recarregando so o valor dos tokens. */
function tokens_com($opcoes) {
  $c = apix_config();
  $GLOBALS['fw']['opcoes'][APIX_OPCAO] = array_merge($c, $opcoes);
  return apix_tokens();
}

echo "\n== cor valida ==\n";
ok(apix_cor_valida('#fb016a') === '#fb016a', 'hex de 6 digitos passa');
ok(apix_cor_valida('#FB016A') === '#fb016a', 'maiuscula passa e vira minuscula');
ok(apix_cor_valida('#e11')    === '#e11',    'hex de 3 digitos passa');
ok(apix_cor_valida('  #e11 ') === '#e11',    'espaco em volta e aparado');
ok(apix_cor_valida('')        === '',        'vazio devolve vazio (= herdar)');

echo "\n== INJECAO DE CSS: o que o campo de cor tenta impedir ==\n";
// o valor vai direto para dentro de .apix{ --apix-acento: AQUI; }
$ataques = [
  '#fff}body{display:none'                        => 'fechar a regra e esconder a pagina',
  'red;}.apix button{background:url(http://x)'     => 'fechar e trocar o botao',
  '#fff;}*{position:fixed;inset:0'                => 'cobrir a tela inteira',
  'expression(alert(1))'                          => 'expressao antiga de IE',
  'url(javascript:alert(1))'                      => 'url com javascript',
  "#fff</style><script>alert(1)</script>"         => 'fechar o style e abrir script',
  'var(--x)'                                      => 'var() arbitrario',
  'rgb(0,0,0)'                                    => 'funcao de cor (recusada por nao ser hex)',
];
foreach ($ataques as $bruto => $descricao) {
  ok(apix_cor_valida($bruto) === '', 'recusado: ' . $descricao);
}

echo "\n== nenhum ataque chega ao <style> ==\n";
$css = tokens_com(['cor' => '#fff}body{display:none']);
ok(strpos($css, 'display:none') === false, 'o valor recusado nao aparece no CSS');
ok(strpos($css, '</style>') === strrpos($css, '</style>'), 'existe um unico </style>');
ok(substr_count($css, '<style') === 1, 'existe um unico <style');

$css = tokens_com(['cor' => '#fff</style><script>alert(1)</script>']);
ok(strpos($css, '<script') === false, 'nenhum <script> foi injetado');

echo "\n== heranca do tema quando nada esta configurado ==\n";
$css = tokens_com(['cor' => '', 'cor_esc' => '', 'raio' => '']);
ok(strpos($css, '--apix-acento:var(--acento,') !== false,
   'o acento comeca tentando --acento (ahnovinha)');
ok(strpos($css, 'var(--red,') !== false,   'depois tenta --red (diretorio-mix)');
ok(strpos($css, 'var(--roxo,') !== false,  'depois tenta --roxo (gatasprive)');
ok(strpos($css, 'var(--theme-palette-color-1,') !== false, 'depois tenta o Blocksy');
ok(strpos($css, '#b5176b') !== false,      'e termina num valor seguro');

echo "\n== os tokens de fundo e texto tambem herdam ==\n";
ok(strpos($css, '--apix-fundo:var(--superficie,') !== false,
   'o fundo tenta --superficie antes de --panel');
ok(strpos($css, '--apix-texto:var(--texto,') !== false,
   'o texto tenta --texto (gatasprive) antes de --ink (mix) e --tinta (ahnovinha)');
ok(strpos($css, 'var(--ink,') !== false && strpos($css, 'var(--tinta,') !== false,
   'as duas outras variaveis de texto estao na cadeia');

echo "\n== tema escuro: o campo NAO fica branco com texto preto ==\n";
// e o bug que motivou tudo isto: cor fixa no CSS
$base = apix_css();
ok(strpos($base, 'background:#fff') === false, 'nenhum fundo branco fixo no CSS base');
ok(strpos($base, 'color:#111') === false,      'nenhuma cor de texto fixa no CSS base');
ok(strpos($base, 'background:var(--apix-fundo)') !== false, 'o campo usa o token de fundo');
ok(strpos($base, 'color:var(--apix-texto)') !== false,      'o campo usa o token de texto');

echo "\n== cor configurada manda na cadeia ==\n";
$css = tokens_com(['cor' => '#e01111', 'cor_esc' => '#a80808']);
ok(strpos($css, '--apix-acento:#e01111;') !== false, 'a cor do painel entra direto');
ok(strpos($css, '--apix-acento:var(') === false,     'e a cadeia de heranca sai do caminho');
ok(strpos($css, '--apix-acento-esc:#a80808;') !== false, 'o hover tambem');

echo "\n== raio ==\n";
$css = tokens_com(['raio' => '']);
ok(strpos($css, '--apix-raio:var(--raio, 8px)') !== false, 'vazio herda o --raio do tema');
$css = tokens_com(['raio' => '2']);
ok(strpos($css, '--apix-raio:2px;') !== false, 'valor configurado vira px');

echo "\n== cor do texto sobre o botao ==\n";
$css = tokens_com(['cor_botao' => '']);
ok(strpos($css, '--apix-sobre-acento:#fff;') !== false, 'padrao e branco');
$css = tokens_com(['cor_botao' => '#111111']);
ok(strpos($css, '--apix-sobre-acento:#111111;') !== false, 'configurado manda');

echo "\n== os tokens ficam no escopo .apix, nao em :root ==\n";
$css = tokens_com([]);
ok(strpos($css, '.apix{') !== false, 'o bloco e escopado em .apix');
ok(strpos($css, ':root') === false,
   'nada em :root — o plugin nao redefine variavel do tema e nao muda a cor do site');

echo "\n== barra de etapas ==\n";
$GLOBALS['fw']['opcoes'][APIX_OPCAO] = array_merge(apix_config(), ['passos' => 1]);
$p = apix_passos_html(2);
ok(strpos($p, 'apix-co__passo--feito') !== false, 'a etapa 1 aparece como concluida');
ok(strpos($p, 'apix-co__passo--agora') !== false, 'a etapa 2 aparece como atual');
ok(strpos($p, 'aria-current="step"') !== false,   'a etapa atual tem aria-current');
ok(substr_count($p, '<li') === 3,                 'tres etapas');
$GLOBALS['fw']['opcoes'][APIX_OPCAO] = array_merge(apix_config(), ['passos' => 0]);
ok(apix_passos_html(2) === '', 'desligado no painel, nao sai nada');

echo "\n== logo ==\n";
$GLOBALS['fw']['opcoes'][APIX_OPCAO] = array_merge(apix_config(),
  ['logo_mostrar' => 1, 'logo' => 'https://exemplo.com/logo.png']);
$l = apix_logo_html();
ok(strpos($l, 'https://exemplo.com/logo.png') !== false, 'usa a logo configurada');
ok(strpos($l, 'alt=') !== false, 'a logo tem alt');
$GLOBALS['fw']['opcoes'][APIX_OPCAO] = array_merge(apix_config(), ['logo_mostrar' => 0]);
ok(apix_logo_html() === '', 'desligada no painel, nao sai nada');

echo "\n== substituicao de template pelo tema ==\n";
ok(apix_template('checkout') === '', 'tema sem o arquivo devolve vazio (usa o embutido)');

echo "\n== o CSS sai uma vez so por pagina ==\n";
// apix_css usa static; numa mesma requisicao a segunda chamada tem de vir vazia
$primeira = apix_css();
ok($primeira === '', 'ja tinha saido antes neste teste, entao a repeticao e vazia');

echo "\n" . ($falhas ? "$falhas FALHA(S)\n" : "todos os testes passaram\n");
exit($falhas ? 1 : 0);
