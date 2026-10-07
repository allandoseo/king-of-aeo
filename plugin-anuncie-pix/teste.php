<?php
/**
 * Banco de teste do plugin Anuncie com Pix.
 *
 * Testa o que nao depende da API do Asaas: validacao de CPF/CNPJ, o carimbo
 * assinado do formulario e — o mais importante — o reempacotamento das fotos.
 */
define('ABSPATH', __DIR__ . '/');
define('HOUR_IN_SECONDS', 3600);
define('DAY_IN_SECONDS', 86400);
define('MINUTE_IN_SECONDS', 60);
define('MB_IN_BYTES', 1048576);

$GLOBALS['opcoes'] = [];
function add_action($g,$cb,$p=10,$n=1){} function add_filter($g,$cb,$p=10,$n=1){}
function remove_filter($g,$cb,$p=10){} function add_shortcode($t,$cb){}
function is_admin(){return false;} function post_type_exists($t){return true;}
function taxonomy_exists($t){return true;} function register_post_type($t,$a){}
function register_taxonomy($t,$o,$a){} function register_activation_hook($f,$cb){}
function register_deactivation_hook($f,$cb){} function wp_next_scheduled($h){return false;}
function wp_schedule_event($t,$r,$h){} function wp_clear_scheduled_hook($h){}
function flush_rewrite_rules(){} function get_option($k,$d=false){return $GLOBALS['opcoes'][$k] ?? $d;}
function update_option($k,$v){$GLOBALS['opcoes'][$k]=$v; return true;}
function wp_generate_password($n=12,$s=true,$x=false){return substr(str_repeat('a1b2c3d4e5f6g7h8',8),0,$n);}
function wp_hash($d){return hash_hmac('md5',$d,'sal-de-teste');}
function wp_upload_dir(){return ['basedir'=>sys_get_temp_dir().'/apix-teste','baseurl'=>'http://x/u'];}
function trailingslashit($s){return rtrim($s,'/').'/';}
function wp_mkdir_p($d){return is_dir($d) || mkdir($d,0777,true);}
function wp_basename($p){return basename($p);}
function sanitize_title($s){return strtolower(preg_replace('/[^a-z0-9]+/i','-',$s));}
function esc_html($s){return htmlspecialchars((string)$s,ENT_QUOTES);}
function home_url($p=''){return 'https://exemplo.com'.$p;}
function get_bloginfo($x=''){return '6.5';}
function wp_parse_url($u,$c=-1){return $c===-1?parse_url($u):parse_url($u,$c);}
function wp_json_encode($d){return json_encode($d);}
function rest_url($p=''){return 'https://exemplo.com/wp-json/'.$p;}
function wp_remote_request($u,$a){return new WP_Error('sem_rede','sem rede no teste');}
function is_wp_error($t){return $t instanceof WP_Error;}
function wp_remote_retrieve_response_code($r){return 0;}
function wp_remote_retrieve_body($r){return '';}
function sanitize_text_field($s){return trim(strip_tags((string)$s));}
function sanitize_key($s){return strtolower(preg_replace('/[^a-z0-9_\-]/i','',(string)$s));}
function absint($n){return abs((int)$n);}
function get_post_thumbnail_id($p=null){return 0;}
function set_post_thumbnail($p,$a){}
function get_children($a){return [];}
function wp_delete_attachment($id,$f=false){}
function wp_insert_attachment($a,$f,$p){return 123;}
function wp_update_attachment_metadata($id,$m){}
function wp_generate_attachment_metadata($id,$f){return [];}
function wp_upload_bits($nome,$x,$bits){
  $d = wp_upload_dir()['basedir'].'/'.APIX_PASTA;
  wp_mkdir_p($d);
  $cheio = $d.'/'.$nome;
  file_put_contents($cheio,$bits);
  return ['file'=>$cheio,'url'=>'http://x/'.$nome,'error'=>false];
}
class WP_Error {
  private $c,$m;
  public function __construct($c='',$m='',$d=null){$this->c=$c;$this->m=$m;}
  public function get_error_message(){return $this->m;}
  public function get_error_code(){return $this->c;}
}
class WP_REST_Request {}
class WP_REST_Response { public function __construct($d=null,$s=200){} }
function register_rest_route($ns,$r,$a){}
function get_posts($a){return [];}
function get_post_meta($p,$k,$s=false){return '';}
function update_post_meta($p,$k,$v){}
function get_post_status($p){return 'draft';}
function get_permalink($p=null){return 'https://exemplo.com/a/';}
function get_edit_post_link($p,$c=''){return '';}
function get_the_title($p=null){return 'T';}
function wp_specialchars_decode($s,$q=null){return $s;}
function wp_mail($a,$b,$c){return true;}
function wp_update_post($a){return true;}
function do_action($g,...$a){}
function date_i18n($f,$t){return date($f,$t);}
function get_transient($k){return false;} function set_transient($k,$v,$t){}
function delete_transient($k){} function term_exists($t,$tx='',$p=0){return 0;}
function wp_insert_term($t,$tx='',$a=[]){return ['term_id'=>1];}
function wp_set_object_terms($p,$t,$tx,$a=false){}
function add_options_page(...$a){} function register_setting($g,$o,$a=[]){}
function current_user_can($c){return true;}
function wp_unslash($v){return is_string($v)?stripslashes($v):$v;}
function wp_strip_all_tags($s){return strip_tags((string)$s);}
function is_email($e){return (bool)filter_var($e,FILTER_VALIDATE_EMAIL);}

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
