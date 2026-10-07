<?php
/**
 * Upload de fotos pelo formulario publico.
 *
 * Este e o arquivo perigoso do plugin. Aceitar arquivo de visitante anonimo,
 * ANTES de qualquer pagamento, e a maior porta de entrada que um site
 * WordPress pode abrir: quem manda o arquivo nao se identificou, nao pagou e
 * nao tem nada a perder.
 *
 * As cinco camadas, e por que cada uma existe:
 *
 * 1. Extensao na lista branca. Barra o ingenuo, e so ele.
 * 2. Tipo real pelo finfo, lendo os bytes. $_FILES['type'] vem do navegador:
 *    quem envia escolhe o que escrever ali, entao nao vale nada.
 * 3. getimagesize() precisa devolver largura e altura. Arquivo que nao e
 *    imagem de verdade morre aqui.
 * 4. REEMPACOTAMENTO pelo GD: a imagem e decodificada para memoria e gravada
 *    de novo em JPEG. Isso e o que de fato protege. Existe arquivo que e JPEG
 *    valido E codigo PHP ao mesmo tempo (polyglot): passa pelas tres camadas
 *    de cima e ainda executa se alguem conseguir acessa-lo. Reempacotado, o
 *    que sai do GD sao pixels e mais nada — qualquer byte estranho fica para
 *    tras, inclusive o EXIF, que carrega GPS da foto.
 * 5. .htaccess negando execucao na pasta. Rede de seguranca para o caso de o
 *    servidor estar configurado para executar PHP dentro de uploads.
 *
 * O nome do arquivo tambem e reescrito. Nome que vem de fora traz '../',
 * caractere nulo e nome duplicado de proposito.
 */

if (!defined('ABSPATH')) exit;

define('APIX_PASTA', 'anuncios');   // subpasta dentro de wp-content/uploads

/** Tipos aceitos: o que o GD sabe reabrir sem drama. */
function apix_tipos_ok() {
  return [
    'image/jpeg' => ['jpg', 'jpeg'],
    'image/png'  => ['png'],
    'image/webp' => ['webp'],
  ];
}

/**
 * Grava um .htaccess negando execucao na pasta das fotos.
 *
 * Roda na ativacao. Nginx ignora .htaccess — nesse caso a protecao tem de ir
 * para o server block, e isso esta no LEIAME.
 */
function apix_protege_pasta_fotos() {
  $up = wp_upload_dir();
  $dir = trailingslashit($up['basedir']) . APIX_PASTA;
  if (!wp_mkdir_p($dir)) return;

  $regras = "# Gravado pelo plugin Anuncie com Pix.\n"
          . "# Aqui dentro so existe imagem. Nada e para ser executado.\n"
          . "<FilesMatch \"\\.(?i:php|phar|phtml|php[0-9]|pl|py|cgi|asp|aspx|jsp|sh)$\">\n"
          . "  Require all denied\n"
          . "</FilesMatch>\n"
          . "php_flag engine off\n";

  $alvo = $dir . '/.htaccess';
  if (!file_exists($alvo) || md5_file($alvo) !== md5($regras)) {
    file_put_contents($alvo, $regras);
  }
}

/**
 * Processa as fotos enviadas e anexa ao post.
 *
 * Devolve ['anexos' => [ids], 'erros' => [mensagens]]. Foto que falha nao
 * derruba o anuncio inteiro: o anunciante preencheu tudo, e perder o
 * formulario por causa de um arquivo ruim e motivo para ele desistir.
 */
function apix_processa_fotos($campo, $post_id, $limite = null) {
  $c      = apix_config();
  // $limite permite passar quantas vagas ainda restam. Sem ele, o limite valeria
  // por envio e nao por anuncio: quem ja tem 5 fotos adicionaria 5 a cada
  // edicao, e o teto do painel nao significaria nada.
  $maximo = $limite !== null ? max(0, (int) $limite) : max(1, (int) $c['max_fotos']);
  if ($maximo < 1) {
    return ['anexos' => [], 'erros' => [sprintf('O anuncio ja tem o maximo de %d fotos. '
      . 'Apague alguma antes de enviar outra.', (int) $c['max_fotos'])]];
  }
  $bytes  = max(1, (int) $c['max_mb']) * MB_IN_BYTES;
  $saida  = ['anexos' => [], 'erros' => []];

  if (empty($_FILES[$campo]) || !is_array($_FILES[$campo]['name'])) return $saida;

  apix_protege_pasta_fotos();

  $nomes = $_FILES[$campo]['name'];
  $total = count($nomes);

  for ($i = 0; $i < $total; $i++) {
    if (count($saida['anexos']) >= $maximo) {
      $saida['erros'][] = sprintf('Foram aceitas as %d primeiras fotos.', $maximo);
      break;
    }

    $erro = (int) ($_FILES[$campo]['error'][$i] ?? UPLOAD_ERR_NO_FILE);
    if ($erro === UPLOAD_ERR_NO_FILE) continue;
    if ($erro !== UPLOAD_ERR_OK) {
      $saida['erros'][] = 'Uma foto nao chegou completa. Tente de novo.';
      continue;
    }

    $tmp  = (string) ($_FILES[$campo]['tmp_name'][$i] ?? '');
    $nome = (string) ($nomes[$i] ?? '');

    // tmp_name tem de ser mesmo um upload desta requisicao
    if ($tmp === '' || !is_uploaded_file($tmp)) {
      $saida['erros'][] = 'Arquivo invalido.';
      continue;
    }

    $tamanho = (int) ($_FILES[$campo]['size'][$i] ?? 0);
    if ($tamanho <= 0 || $tamanho > $bytes) {
      $saida['erros'][] = sprintf('"%s" passa de %d MB.', esc_html(wp_basename($nome)), (int) $c['max_mb']);
      continue;
    }

    $anexo = apix_guarda_foto($tmp, $nome, $post_id);
    if (is_wp_error($anexo)) {
      $saida['erros'][] = sprintf('"%s": %s', esc_html(wp_basename($nome)), $anexo->get_error_message());
      continue;
    }

    $saida['anexos'][] = $anexo;
  }

  // a primeira vira a capa
  if ($saida['anexos'] && !get_post_thumbnail_id($post_id)) {
    set_post_thumbnail($post_id, $saida['anexos'][0]);
  }

  return $saida;
}

/**
 * Valida, reempacota e grava uma foto. Devolve o ID do anexo ou WP_Error.
 */
function apix_guarda_foto($tmp, $nome_original, $post_id) {
  // --- camada 1: extensao
  $ext = strtolower(pathinfo($nome_original, PATHINFO_EXTENSION));
  $permitidas = array_merge(...array_values(apix_tipos_ok()));
  if (!in_array($ext, $permitidas, true)) {
    return new WP_Error('apix_ext', 'formato nao aceito. Envie JPG, PNG ou WebP.');
  }

  // --- camada 2: tipo real, lido dos bytes
  if (!function_exists('finfo_open')) {
    return new WP_Error('apix_finfo', 'o servidor nao tem a extensao fileinfo do PHP.');
  }
  $fi = finfo_open(FILEINFO_MIME_TYPE);
  $mime = finfo_file($fi, $tmp);
  finfo_close($fi);
  if (!isset(apix_tipos_ok()[$mime])) {
    return new WP_Error('apix_mime', 'o arquivo nao e uma imagem.');
  }
  // extensao tem de combinar com o conteudo
  if (!in_array($ext, apix_tipos_ok()[$mime], true)) {
    return new WP_Error('apix_mime_ext', 'a extensao nao corresponde ao conteudo do arquivo.');
  }

  // --- camada 3: tem dimensao?
  $dim = @getimagesize($tmp);
  if (!$dim || empty($dim[0]) || empty($dim[1])) {
    return new WP_Error('apix_dim', 'nao foi possivel ler a imagem.');
  }
  if ($dim[0] < 200 || $dim[1] < 200) {
    return new WP_Error('apix_pequena', 'a imagem e pequena demais (minimo 200x200).');
  }
  // bomba de descompressao: imagem pequena no disco que estoura a memoria ao abrir
  if (($dim[0] * $dim[1]) > 50000000) {
    return new WP_Error('apix_grande', 'a imagem tem resolucao alta demais.');
  }

  // --- camada 4: reempacotamento
  $jpeg = apix_reempacota($tmp, $dim[0], $dim[1]);
  if (is_wp_error($jpeg)) return $jpeg;

  // --- nome reescrito: nada do que veio de fora sobrevive
  $base = sanitize_title(pathinfo($nome_original, PATHINFO_FILENAME));
  if ($base === '') $base = 'foto';
  $arquivo = sprintf('%s-%d-%s.jpg', substr($base, 0, 40), $post_id, wp_generate_password(6, false, false));

  // wp_upload_bits grava dentro de uploads, pelo caminho do WordPress: nao da
  // para apontar para fora com '../'
  add_filter('upload_dir', 'apix_subpasta');
  $gravado = wp_upload_bits($arquivo, null, $jpeg);
  remove_filter('upload_dir', 'apix_subpasta');

  if (!empty($gravado['error'])) {
    return new WP_Error('apix_gravar', 'nao foi possivel gravar o arquivo.');
  }

  $anexo_id = wp_insert_attachment([
    'post_mime_type' => 'image/jpeg',
    'post_title'     => $base,
    'post_content'   => '',
    'post_status'    => 'inherit',
  ], $gravado['file'], $post_id);

  if (is_wp_error($anexo_id) || !$anexo_id) {
    @unlink($gravado['file']);
    return new WP_Error('apix_anexo', 'nao foi possivel anexar o arquivo.');
  }

  require_once ABSPATH . 'wp-admin/includes/image.php';
  wp_update_attachment_metadata($anexo_id, wp_generate_attachment_metadata($anexo_id, $gravado['file']));

  return (int) $anexo_id;
}

/** Manda os uploads do plugin para a subpasta propria. */
function apix_subpasta($dirs) {
  $dirs['path']   = $dirs['basedir'] . '/' . APIX_PASTA;
  $dirs['url']    = $dirs['baseurl'] . '/' . APIX_PASTA;
  $dirs['subdir'] = '/' . APIX_PASTA;
  return $dirs;
}

/**
 * Decodifica a imagem e grava de novo em JPEG, pelo GD.
 *
 * E aqui que o polyglot morre: entra arquivo, sai pixel. Tambem derruba o
 * EXIF, que em foto de celular carrega coordenada de GPS — num site deste
 * ramo, publicar o endereco de casa de quem anuncia junto com a foto nao e
 * descuido pequeno.
 *
 * O limite de 1600px na maior borda nao e so economia de banda: imagem de
 * celular moderna tem 4000px e nenhum lugar do site mostra isso.
 */
function apix_reempacota($caminho, $largura, $altura) {
  if (!function_exists('imagecreatefromstring')) {
    return new WP_Error('apix_gd', 'o servidor nao tem a extensao GD do PHP.');
  }

  $bruto = file_get_contents($caminho);
  if ($bruto === false) return new WP_Error('apix_ler', 'nao foi possivel ler o arquivo.');

  $img = @imagecreatefromstring($bruto);
  unset($bruto);
  if (!$img) return new WP_Error('apix_decodificar', 'a imagem esta corrompida.');

  $teto = 1600;
  if ($largura > $teto || $altura > $teto) {
    $escala = $teto / max($largura, $altura);
    $nl = max(1, (int) round($largura * $escala));
    $na = max(1, (int) round($altura * $escala));
    $menor = imagecreatetruecolor($nl, $na);
    if ($menor) {
      // fundo branco: PNG e WebP com transparencia viram preto em JPEG
      imagefill($menor, 0, 0, imagecolorallocate($menor, 255, 255, 255));
      imagecopyresampled($menor, $img, 0, 0, 0, 0, $nl, $na, $largura, $altura);
      imagedestroy($img);
      $img = $menor;
    }
  } else {
    // mesmo sem redimensionar, achata a transparencia
    $plano = imagecreatetruecolor($largura, $altura);
    if ($plano) {
      imagefill($plano, 0, 0, imagecolorallocate($plano, 255, 255, 255));
      imagecopy($plano, $img, 0, 0, 0, 0, $largura, $altura);
      imagedestroy($img);
      $img = $plano;
    }
  }

  ob_start();
  $ok = imagejpeg($img, null, 82);
  $jpeg = ob_get_clean();
  imagedestroy($img);

  if (!$ok || $jpeg === '' || $jpeg === false) {
    return new WP_Error('apix_jpeg', 'nao foi possivel converter a imagem.');
  }

  return $jpeg;
}

/**
 * Apaga as fotos de um anuncio. Usado na limpeza dos abandonados.
 *
 * Pega as duas situacoes: as anexadas (filhas do post) e as que estao soltas
 * esperando liberacao. Sem a segunda, apagar o anuncio deixaria a foto no disco
 * para sempre, sem pai e sem nada que a ligue a nada — invisivel no admin e
 * impossivel de achar depois.
 */
function apix_apaga_fotos($post_id) {
  $filhos = get_children(['post_parent' => $post_id, 'post_type' => 'attachment', 'numberposts' => -1]);
  foreach ($filhos as $f) wp_delete_attachment($f->ID, true);

  foreach (apix_fotos_em_analise($post_id) as $fid) wp_delete_attachment($fid, true);
}
