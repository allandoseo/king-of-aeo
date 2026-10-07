<?php
/**
 * WordPress falso para os bancos de teste do plugin.
 *
 * Nao e um WordPress: e o minimo que o plugin toca, com armazenamento de
 * verdade em memoria para opcoes, transients, posts e meta. Isso permite testar
 * a logica que mexe em estado — dono do anuncio, soma de prazo na renovacao,
 * sessao — sem banco, sem rede e sem instalar nada.
 *
 * Carregue ANTES do plugin. Depois use apix_falso_post() para criar anuncios.
 */

define('ABSPATH', __DIR__ . '/');
define('HOUR_IN_SECONDS', 3600);
define('DAY_IN_SECONDS', 86400);
define('MINUTE_IN_SECONDS', 60);
define('MB_IN_BYTES', 1048576);

$GLOBALS['fw'] = [
  'opcoes'     => [],
  'transients' => [],
  'posts'      => [],
  'meta'       => [],
  'emails'     => [],
  'proximo_id' => 100,
];

/* ------------------------------------------------------------------ fixtures */

/** Cria um post falso e devolve o ID. */
function apix_falso_post($campos = [], $metas = []) {
  $id = $GLOBALS['fw']['proximo_id']++;
  $GLOBALS['fw']['posts'][$id] = array_merge([
    'ID' => $id, 'post_type' => 'perfil', 'post_status' => 'draft',
    'post_title' => 'Anuncio', 'post_content' => '', 'post_parent' => 0,
    'post_date_gmt' => gmdate('Y-m-d H:i:s'),
  ], $campos);
  $GLOBALS['fw']['meta'][$id] = $metas;
  return $id;
}

function apix_falso_meta($id) { return $GLOBALS['fw']['meta'][$id] ?? []; }
function apix_falso_emails()  { return $GLOBALS['fw']['emails']; }

/* ------------------------------------------------------- ganchos e shortcodes */
function add_action($g,$cb,$p=10,$n=1){} function add_filter($g,$cb,$p=10,$n=1){}
function remove_filter($g,$cb,$p=10){} function add_shortcode($t,$cb){}
function do_action($g,...$a){} function apply_filters($g,$v,...$a){return $v;}
function add_meta_box(...$a){} function register_rest_route($ns,$r,$a){}
function register_activation_hook($f,$cb){} function register_deactivation_hook($f,$cb){}
function add_options_page(...$a){} function register_setting($g,$o,$a=[]){}
function settings_fields($g){} function submit_button(...$a){}
function wp_nonce_field($a='',$n='',$r=true,$e=true){return '';}
function wp_verify_nonce($n,$a=''){return 1;}
function current_user_can($c,$o=null){return true;}
function is_admin(){return false;}
function wp_is_post_revision($id){return false;} function wp_is_post_autosave($id){return false;}
function remove_all_actions($g,$p=null){}

/* ------------------------------------------------------------ tipos e taxonomias */
function post_type_exists($t){return true;} function taxonomy_exists($t){return true;}
function register_post_type($t,$a){} function register_taxonomy($t,$o,$a){}
function term_exists($t,$tx='',$p=0){return 0;}
function wp_insert_term($t,$tx='',$a=[]){return ['term_id'=>1];}
function wp_set_object_terms($p,$t,$tx,$a=false){}

/* ------------------------------------------------------------------- agendamento */
function wp_next_scheduled($h){return false;} function wp_schedule_event($t,$r,$h){}
function wp_clear_scheduled_hook($h){} function flush_rewrite_rules(){}

/* ------------------------------------------------------------------- opcoes */
function get_option($k,$d=false){return $GLOBALS['fw']['opcoes'][$k] ?? $d;}
function update_option($k,$v){$GLOBALS['fw']['opcoes'][$k]=$v; return true;}
function delete_option($k){unset($GLOBALS['fw']['opcoes'][$k]); return true;}

/* --------------------------------------------------------------- transients */
function get_transient($k){
  $t = $GLOBALS['fw']['transients'][$k] ?? null;
  if ($t === null) return false;
  if ($t['expira'] > 0 && $t['expira'] < time()) { unset($GLOBALS['fw']['transients'][$k]); return false; }
  return $t['valor'];
}
function set_transient($k,$v,$s=0){
  $GLOBALS['fw']['transients'][$k] = ['valor'=>$v, 'expira'=>$s>0?time()+$s:0];
  return true;
}
function delete_transient($k){unset($GLOBALS['fw']['transients'][$k]); return true;}

/* -------------------------------------------------------------------- posts */
function get_post_status($id){return $GLOBALS['fw']['posts'][$id]['post_status'] ?? false;}
function get_post_type($id){return $GLOBALS['fw']['posts'][$id]['post_type'] ?? false;}
function get_the_title($id=null){return $GLOBALS['fw']['posts'][$id]['post_title'] ?? '';}
function get_post_field($c,$id){return $GLOBALS['fw']['posts'][$id][$c] ?? '';}
function get_permalink($id=null){return 'https://exemplo.com/a/'.(int)$id.'/';}
function get_edit_post_link($id,$c=''){return '';}
function wp_update_post($a){
  $id = (int)($a['ID'] ?? 0);
  if (!$id || !isset($GLOBALS['fw']['posts'][$id])) return 0;
  foreach ($a as $k=>$v) if ($k!=='ID') $GLOBALS['fw']['posts'][$id][$k]=$v;
  return $id;
}
function wp_insert_post($a,$erro=false){
  return apix_falso_post($a);
}
function wp_delete_post($id,$forcar=false){unset($GLOBALS['fw']['posts'][$id]); return true;}
function wp_delete_attachment($id,$forcar=false){unset($GLOBALS['fw']['posts'][$id]); return true;}
function wp_insert_attachment($a,$f,$p){return apix_falso_post(array_merge($a,['post_type'=>'attachment','post_parent'=>$p]));}
function get_children($a){
  $pai = (int)($a['post_parent'] ?? 0);
  $saida = [];
  foreach ($GLOBALS['fw']['posts'] as $id=>$p) {
    if ($p['post_type']==='attachment' && (int)$p['post_parent']===$pai) $saida[$id]=(object)$p;
  }
  return $saida;
}
function get_post_thumbnail_id($id=null){return (int)get_post_meta($id,'_thumbnail_id',true);}
function set_post_thumbnail($id,$a){update_post_meta($id,'_thumbnail_id',(int)$a);}
function wp_get_attachment_image_url($id,$t=''){return 'https://exemplo.com/f/'.(int)$id.'.jpg';}
function wp_update_attachment_metadata($id,$m){}
function wp_generate_attachment_metadata($id,$f){return [];}
function post_password_required($p=null){return false;}

/**
 * get_posts falso: cobre so o que o plugin usa — post_type, post_status,
 * meta_key/meta_value, meta_compare EXISTS e fields=ids.
 */
function get_posts($a){
  $tipo    = $a['post_type'] ?? 'post';
  $status  = $a['post_status'] ?? 'publish';
  $status  = is_array($status) ? $status : ($status==='any' ? null : [$status]);
  $quantos = (int)($a['numberposts'] ?? $a['posts_per_page'] ?? 5);
  $saida = [];

  foreach ($GLOBALS['fw']['posts'] as $id=>$p) {
    if ($p['post_type'] !== $tipo) continue;
    if ($status !== null && !in_array($p['post_status'], $status, true)) continue;

    if (!empty($a['meta_key'])) {
      $tem = array_key_exists($a['meta_key'], apix_falso_meta($id));
      if (($a['meta_compare'] ?? '') === 'EXISTS') {
        if (!$tem) continue;
      } elseif (isset($a['meta_value'])) {
        if (!$tem || (string) get_post_meta($id,$a['meta_key'],true) !== (string) $a['meta_value']) continue;
      }
    }
    if (!empty($a['post__in']) && !in_array($id, (array)$a['post__in'], true)) continue;

    $saida[] = $id;
    if (count($saida) >= $quantos) break;
  }
  return $saida;
}

/* --------------------------------------------------------------------- meta */
function get_post_meta($id,$k='',$unico=false){
  $m = apix_falso_meta($id);
  if ($k==='') return $m;
  if (!array_key_exists($k,$m)) return $unico ? '' : [];
  return $unico ? $m[$k] : [$m[$k]];
}
function update_post_meta($id,$k,$v){$GLOBALS['fw']['meta'][$id][$k]=$v; return true;}
function delete_post_meta($id,$k,$v=''){unset($GLOBALS['fw']['meta'][$id][$k]); return true;}

/* ------------------------------------------------------------------ escapes */
function esc_html($s){return htmlspecialchars((string)$s,ENT_QUOTES);}
function esc_attr($s){return htmlspecialchars((string)$s,ENT_QUOTES);}
function esc_url($u){return htmlspecialchars((string)$u,ENT_QUOTES);}
function esc_textarea($s){return htmlspecialchars((string)$s,ENT_QUOTES);}
function esc_url_raw($u,$p=null){
  $u = trim((string)$u); if ($u==='') return '';
  $p = $p ?: ['http','https'];
  $e = parse_url($u, PHP_URL_SCHEME);
  if ($e === null) return $u;
  return in_array(strtolower((string)$e),$p,true) ? $u : '';
}
function sanitize_text_field($s){return trim(strip_tags((string)$s));}
function sanitize_email($e){return filter_var(trim((string)$e),FILTER_SANITIZE_EMAIL);}
function sanitize_key($s){return strtolower(preg_replace('/[^a-z0-9_\-]/i','',(string)$s));}
function sanitize_title($s){return strtolower(preg_replace('/[^a-z0-9]+/i','-',(string)$s));}
function wp_kses_post($s){return (string)$s;}
function wp_strip_all_tags($s){return strip_tags((string)$s);}
function wp_unslash($v){return is_string($v)?stripslashes($v):$v;}
function is_email($e){return (bool)filter_var($e,FILTER_VALIDATE_EMAIL);}
function absint($n){return abs((int)$n);}
function checked($a,$b=true,$e=true){return (string)$a===(string)$b?' checked':'';}
function selected($a,$b=true,$e=true){return (string)$a===(string)$b?' selected':'';}

/* ------------------------------------------------------------------- diversos */
function home_url($p=''){return 'https://exemplo.com'.$p;}
function admin_url($p=''){return 'https://exemplo.com/wp-admin/'.$p;}
function rest_url($p=''){return 'https://exemplo.com/wp-json/'.$p;}
function site_url($p=''){return 'https://exemplo.com'.$p;}
function get_bloginfo($x=''){return $x==='name' ? 'Site' : '6.5';}
function wp_specialchars_decode($s,$q=null){return $s;}
function is_ssl(){return true;}
function wp_salt($e=''){return 'sal-'.$e.'-de-teste';}
function wp_hash($d){return hash_hmac('md5',$d,'sal-de-teste');}
function wp_generate_password($n=12,$s=true,$x=false){
  return substr(str_repeat(bin2hex(random_bytes(16)),4),0,$n);
}
function wp_parse_url($u,$c=-1){return $c===-1?parse_url($u):parse_url($u,$c);}
function wp_json_encode($d){return json_encode($d);}
function wp_basename($p){return basename($p);}
function trailingslashit($s){return rtrim((string)$s,'/').'/';}
function wp_mkdir_p($d){return is_dir($d) || mkdir($d,0777,true);}
function wp_upload_dir(){return ['basedir'=>sys_get_temp_dir().'/apix-teste','baseurl'=>'http://x/u'];}
function date_i18n($f,$t=null){return date($f,$t===null?time():$t);}
function add_query_arg($k,$v=null,$u=null){
  if (is_array($k)) { $u = $v; $pares = $k; } else { $pares = [$k=>$v]; }
  $u = $u ?: 'https://exemplo.com/';
  return $u . (strpos($u,'?')===false?'?':'&') . http_build_query($pares);
}
function remove_query_arg($k,$u=null){return $u ?: 'https://exemplo.com/';}
function get_queried_object_id(){return 0;}
function wp_doing_ajax(){return false;}
function is_feed(){return false;} function is_embed(){return false;} function is_404(){return false;}
function is_page($i=''){return false;} function is_singular($t=''){return true;}
function in_the_loop(){return true;} function is_main_query(){return true;}
function get_search_form($a=[]){return '';}
function locate_template($nomes,$carregar=false,$uma=true){return '';}
function get_theme_mod($n,$p=false){return $p;}

/** wp_mail falso: guarda a mensagem. */
function wp_mail($para,$assunto,$corpo,$cab='',$anexos=[]){
  $GLOBALS['fw']['emails'][] = ['para'=>$para,'assunto'=>$assunto,'corpo'=>$corpo];
  return true;
}

/** wp_safe_redirect falso: lanca, para o teste ver para onde ia. */
class ApixRedirecionou extends Exception { public $url; }
function wp_safe_redirect($url,$s=302){
  $e = new ApixRedirecionou('redirecionou'); $e->url = $url; throw $e;
}
function wp_redirect($url,$s=302){return wp_safe_redirect($url,$s);}

/* ------------------------------------------------------------------ rede off */
function wp_remote_request($u,$a){return new WP_Error('sem_rede','sem rede no teste');}
function wp_remote_retrieve_response_code($r){return 0;}
function wp_remote_retrieve_body($r){return '';}
function is_wp_error($t){return $t instanceof WP_Error;}

class WP_Error {
  private $c,$m;
  public function __construct($c='',$m='',$d=null){$this->c=$c;$this->m=$m;}
  public function get_error_message(){return $this->m;}
  public function get_error_code(){return $this->c;}
}
class WP_REST_Request {
  private $p,$h,$j;
  public function __construct($p=[],$h=[],$j=null){$this->p=$p;$this->h=$h;$this->j=$j;}
  public function get_param($k){return $this->p[$k] ?? null;}
  public function get_header($k){return $this->h[strtolower($k)] ?? '';}
  public function get_json_params(){return $this->j;}
}
class WP_REST_Response {
  public $dados,$status;
  public function __construct($d=null,$s=200){$this->dados=$d;$this->status=$s;}
  public function get_status(){return $this->status;}
  public function get_data(){return $this->dados;}
}
class WP_Widget { public function __construct(...$a){} }
function register_widget($c){}
