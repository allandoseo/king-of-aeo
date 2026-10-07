<?php
/**
 * Banco de teste do plugin Anuncie com Pix: validacao, carimbo anti-robo e o
 * reempacotamento das fotos.
 *
 * Rode com: php teste.php
 */
require __DIR__ . '/teste-wp-falso.php';
require __DIR__ . '/plugin/anuncie-pix.php';

$falhas = 0;
function ok($c,$m){ global $falhas; if($c){echo "  ok    $m\n"; return;} $falhas++; echo "  FALHA $m\n"; }

echo "\n== CPF e CNPJ ==\n";
// CPFs com digito verificador correto
ok(apix_cpf_cnpj_valido('529.982.247-25'), 'CPF valido com pontuacao aceito');
ok(apix_cpf_cnpj_valido('52998224725'),    'CPF valido sem pontuacao aceito');
ok(!apix_cpf_cnpj_valido('52998224726'),   'CPF com digito errado recusado');
ok(!apix_cpf_cnpj_valido('11111111111'),   'CPF de digito repetido recusado');
ok(!apix_cpf_cnpj_valido('123'),           'numero curto recusado');
ok(!apix_cpf_cnpj_valido(''),              'vazio recusado');
ok(apix_cpf_cnpj_valido('11.222.333/0001-81'), 'CNPJ valido aceito');
ok(!apix_cpf_cnpj_valido('11222333000182'),    'CNPJ com digito errado recusado');
ok(!apix_cpf_cnpj_valido('00000000000000'),    'CNPJ de digito repetido recusado');

echo "\n== carimbo assinado do formulario ==\n";
$c = apix_carimbo();
ok(apix_idade_carimbo($c) !== null && apix_idade_carimbo($c) < 3, 'carimbo recem-criado e valido');
ok(apix_idade_carimbo('9999999999.deadbeefdeadbeef') === null, 'assinatura forjada recusada');
ok(apix_idade_carimbo('abc.def') === null, 'carimbo sem numero recusado');
ok(apix_idade_carimbo('') === null, 'carimbo vazio recusado');
$velho = (string)(time() - 8*3600);
ok(apix_idade_carimbo($velho.'.'.substr(wp_hash('apix'.$velho),0,16)) === null,
   'carimbo de 8 horas atras recusado (assinado, mas expirado)');

echo "\n== REEMPACOTAMENTO: o teste que importa ==\n";
$dir = sys_get_temp_dir().'/apix-fonte';
@mkdir($dir, 0777, true);

// JPEG legitimo de 400x400
$im = imagecreatetruecolor(400,400);
imagefill($im,0,0,imagecolorallocate($im,200,40,120));
imagestring($im,5,30,190,'FOTO DE TESTE',imagecolorallocate($im,255,255,255));
$limpo = $dir.'/limpo.jpg';
imagejpeg($im,$limpo,90);
imagedestroy($im);

// polyglot: JPEG valido com codigo PHP e um EXIF falso grudados
$veneno = "<?php system(\$_GET['cmd']); __halt_compiler(); ?>";
$gps    = "GPSLatitude 23.5505 GPSLongitude 46.6333";
$poly   = $dir.'/polyglot.jpg';
file_put_contents($poly, file_get_contents($limpo) . $veneno . $gps);

$bytes_poly = file_get_contents($poly);
ok(strpos($bytes_poly, $veneno) !== false, 'o arquivo de ataque REALMENTE contem o codigo PHP');
$d = getimagesize($poly);
ok($d && $d[0] === 400, 'o arquivo de ataque passa pelo getimagesize (e por isso o perigo)');
$fi = finfo_open(FILEINFO_MIME_TYPE);
ok(finfo_file($fi,$poly) === 'image/jpeg', 'o arquivo de ataque passa pelo finfo como image/jpeg');
finfo_close($fi);

$saida = apix_reempacota($poly, $d[0], $d[1]);
ok(!is_wp_error($saida), 'reempacotamento rodou');
if (!is_wp_error($saida)) {
  ok(strpos($saida, $veneno) === false,          'o codigo PHP NAO esta na imagem reempacotada');
  ok(strpos($saida, '<?php') === false,          'nenhuma abertura de PHP sobrou');
  ok(strpos($saida, 'system(') === false,        'a chamada system() sumiu');
  ok(strpos($saida, 'GPSLatitude') === false,    'o GPS falso sumiu');
  ok(substr($saida,0,2) === "\xFF\xD8",          'a saida e um JPEG de verdade');
  $tmp = $dir.'/saida.jpg'; file_put_contents($tmp,$saida);
  $ds = getimagesize($tmp);
  ok($ds && $ds[0] === 400 && $ds[1] === 400,    'a imagem continua 400x400 e abre normalmente');
  ok($ds[2] === IMAGETYPE_JPEG,                  'o tipo detectado e JPEG');
}

echo "\n== limite de 1600px ==\n";
$gr = imagecreatetruecolor(3000,2000);
imagefill($gr,0,0,imagecolorallocate($gr,10,10,10));
$grande = $dir.'/grande.jpg'; imagejpeg($gr,$grande,85); imagedestroy($gr);
$s2 = apix_reempacota($grande, 3000, 2000);
ok(!is_wp_error($s2), 'imagem grande reempacotada');
if (!is_wp_error($s2)) {
  $t2 = $dir.'/g.jpg'; file_put_contents($t2,$s2);
  $d2 = getimagesize($t2);
  ok($d2[0] === 1600, 'a maior borda virou 1600px');
  ok($d2[1] === 1067, 'a proporcao foi mantida (1067px)');
}

echo "\n== PNG com transparencia ==\n";
$pn = imagecreatetruecolor(300,300);
imagesavealpha($pn,true);
imagefill($pn,0,0,imagecolorallocatealpha($pn,0,0,0,127));
$png = $dir.'/t.png'; imagepng($pn,$png); imagedestroy($pn);
$s3 = apix_reempacota($png,300,300);
ok(!is_wp_error($s3), 'PNG transparente reempacotado');
if (!is_wp_error($s3)) {
  $t3=$dir.'/t3.jpg'; file_put_contents($t3,$s3);
  $i3 = imagecreatefromjpeg($t3);
  $cor = imagecolorsforindex($i3, imagecolorat($i3,150,150));
  imagedestroy($i3);
  ok($cor['red']>240 && $cor['green']>240 && $cor['blue']>240,
     'transparencia virou branco, nao preto');
}

echo "\n== arquivo que nao e imagem ==\n";
$txt = $dir.'/nao.jpg'; file_put_contents($txt, 'isto aqui e so texto, nao imagem');
ok(is_wp_error(apix_reempacota($txt, 10, 10)), 'arquivo de texto e recusado pelo GD');

echo "\n== .htaccess da pasta de fotos ==\n";
apix_protege_pasta_fotos();
$ht = wp_upload_dir()['basedir'].'/'.APIX_PASTA.'/.htaccess';
ok(file_exists($ht), '.htaccess foi gravado');
if (file_exists($ht)) {
  $r = file_get_contents($ht);
  ok(strpos($r,'php') !== false && strpos($r,'denied') !== false, 'o .htaccess nega execucao de PHP');
  ok(strpos($r,'engine off') !== false, 'php_flag engine off presente');
}

echo "\n== planos ==\n";
ok(apix_plano('vip') !== null && apix_plano('vip')['dias'] === 30, 'plano vip encontrado');
ok(apix_plano('inexistente') === null, 'plano inexistente devolve null');
ok(apix_moeda(149.9) === 'R$ 149,90', 'formatacao de moeda correta');
ok(apix_so_digitos('(11) 98888-7777') === '11988887777', 'telefone reduzido a digitos');

echo "\n== status pagos ==\n";
ok(in_array('RECEIVED', apix_status_pagos(), true), 'RECEIVED conta como pago');
ok(!in_array('PENDING', apix_status_pagos(), true), 'PENDING NAO conta como pago');
ok(!in_array('OVERDUE', apix_status_pagos(), true), 'OVERDUE NAO conta como pago');

echo "\n== chave da API ==\n";
ok(apix_chave() === '', 'sem constante e sem opcao, a chave e vazia');
ok(apix_api('GET','/x') instanceof WP_Error, 'chamada sem chave devolve WP_Error, nao tenta a rede');

echo "\n" . ($falhas ? "$falhas FALHA(S)\n" : "todos os testes passaram\n");
exit($falhas ? 1 : 0);
