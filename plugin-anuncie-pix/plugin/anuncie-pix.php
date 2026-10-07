<?php
/**
 * Plugin Name: Anuncie com Pix
 * Description: Formulario de anuncio com cobranca Pix pelo Asaas. O anunciante preenche, paga e o anuncio publica sozinho quando o Pix cai.
 * Version: 1.0
 * Requires at least: 6.0
 * Requires PHP: 7.4
 *
 * ATENCAO, LEIA ANTES DE LIGAR EM PRODUCAO
 * ----------------------------------------
 * Os endpoints e os nomes de campo da API do Asaas estao TODOS em inc/asaas.php,
 * entre os marcadores "CONFERIR". Eles foram escritos sem acesso a documentacao
 * do Asaas: o ambiente onde este plugin foi gerado nao alcanca docs.asaas.com.
 * Confira cada um no painel do Asaas (Integracoes -> API) antes de trocar o
 * ambiente para producao. Codigo de pagamento escrito de memoria e conferido
 * depois nao e codigo pronto, e rascunho que parece pronto.
 *
 * COMO O FLUXO FUNCIONA
 * ---------------------
 *  1. O anunciante abre a pagina com o shortcode [anunciar].
 *  2. Preenche, sobe as fotos, declara ser maior de 18 e envia.
 *  3. O plugin cria o anuncio como RASCUNHO, nunca publicado.
 *  4. Cria o cliente e a cobranca Pix no Asaas e mostra o QR Code.
 *  5. O Pix cai. O Asaas chama o webhook.
 *  6. O webhook NAO acredita no que recebeu: consulta a cobranca na API do
 *     Asaas e so publica se a propria Asaas disser que foi paga.
 *  7. Um agendamento despublica o anuncio quando o plano vence, e apaga os
 *     rascunhos que nunca pagaram junto com as fotos deles.
 *
 * A CHAVE DA API NAO DEVE FICAR NO BANCO
 * --------------------------------------
 * Defina no wp-config.php, acima da linha "That's all, stop editing":
 *
 *     define('APIX_ASAAS_CHAVE', 'sua_chave_aqui');
 *
 * A constante tem prioridade sobre o campo do painel. Chave no banco vaza em
 * backup, em dump de banco e em qualquer plugin que leia opcoes — e chave de
 * cobranca vazada e dinheiro de outra pessoa saindo da sua conta.
 */

if (!defined('ABSPATH')) exit;

define('APIX_VER', '1.0');
define('APIX_OPCAO', 'apix_config');
define('APIX_NS', 'anuncie/v1');          // namespace do REST; renomeie por site
define('APIX_CRON', 'apix_manutencao');

/** Configuracao salva, com os padroes preenchidos. */
function apix_config() {
  $padrao = [
    'ambiente'   => 'sandbox',   // sandbox | producao
    'chave'      => '',          // so usada se a constante nao existir
    'webhook'    => '',          // token que o Asaas devolve no cabecalho
    'cpt'        => 'perfil',
    'max_fotos'  => 5,
    'max_mb'     => 4,
    'limite_ip'  => 3,           // envios por IP por hora
    'vence_dias' => 1,           // validade da cobranca Pix
    'abandono_h' => 48,          // rascunho sem pagamento morre depois disso
    'whats'      => '',          // WhatsApp de suporte mostrado ao anunciante
    'moderar'    => 1,           // edicao em anuncio no ar espera liberacao
    'sessao_dias'=> 7,           // quanto dura o login da area do anunciante
    'link_min'   => 30,          // validade do link de acesso enviado por e-mail
    'planos'     => apix_planos_padrao(),
  ];
  $c = get_option(APIX_OPCAO, []);
  if (!is_array($c)) $c = [];
  $c = array_merge($padrao, $c);
  if (!is_array($c['planos']) || !$c['planos']) $c['planos'] = apix_planos_padrao();
  return $c;
}

/**
 * Planos de exemplo. Os valores sao chute e precisam ser trocados no painel:
 * nao invento preco de servico de ninguem.
 */
function apix_planos_padrao() {
  return [
    ['slug' => 'comum',    'nome' => 'Comum',    'valor' => 49.90,  'dias' => 30, 'vip' => 0, 'destaque' => 0],
    ['slug' => 'destaque', 'nome' => 'Destaque', 'valor' => 89.90,  'dias' => 30, 'vip' => 0, 'destaque' => 1],
    ['slug' => 'vip',      'nome' => 'VIP',      'valor' => 149.90, 'dias' => 30, 'vip' => 1, 'destaque' => 1],
  ];
}

/** Um plano pelo slug, ou null. */
function apix_plano($slug) {
  foreach (apix_config()['planos'] as $p) {
    if (($p['slug'] ?? '') === $slug) return $p;
  }
  return null;
}

/** A chave da API: constante primeiro, campo do painel so como reserva. */
function apix_chave() {
  if (defined('APIX_ASAAS_CHAVE') && APIX_ASAAS_CHAVE) return (string) APIX_ASAAS_CHAVE;
  return (string) apix_config()['chave'];
}

/** O tipo de conteudo do anuncio. */
function apix_cpt() {
  return apix_config()['cpt'] ?: 'perfil';
}

/**
 * Registra o CPT e a taxonomia so se ainda nao existirem.
 *
 * O travestismix ainda nao tem tema proprio, entao o plugin se vira sozinho.
 * Nos sites onde o tema ja registra 'perfil' e 'local' (tema-zip,
 * tema-gatasprive), ele nao mexe em nada: dois registros do mesmo CPT com
 * rotulos diferentes e briga silenciosa que termina em admin quebrado.
 */
add_action('init', function () {
  $cpt = apix_cpt();

  if (!post_type_exists($cpt)) {
    register_post_type($cpt, [
      'labels' => [
        'name'          => 'Anuncios',
        'singular_name' => 'Anuncio',
        'add_new_item'  => 'Adicionar anuncio',
        'edit_item'     => 'Editar anuncio',
        'search_items'  => 'Buscar anuncios',
      ],
      'public'       => true,
      'has_archive'  => true,
      'rewrite'      => ['slug' => $cpt],
      'menu_icon'    => 'dashicons-id',
      'supports'     => ['title', 'editor', 'thumbnail', 'excerpt'],
      'show_in_rest' => false,   // o anuncio nao precisa de API publica
    ]);
  }

  if (!taxonomy_exists('local')) {
    register_taxonomy('local', [$cpt], [
      'labels'       => ['name' => 'Locais', 'singular_name' => 'Local'],
      'public'       => true,
      'hierarchical' => true,    // Estado > Cidade
      'rewrite'      => ['slug' => 'local'],
      'show_in_rest' => false,
    ]);
  }
}, 5);

/* ------------------------------------------------------------------- partes */
require_once __DIR__ . '/inc/asaas.php';
require_once __DIR__ . '/inc/fotos.php';
require_once __DIR__ . '/inc/formulario.php';
require_once __DIR__ . '/inc/area.php';
require_once __DIR__ . '/inc/revisao.php';
require_once __DIR__ . '/inc/webhook.php';
require_once __DIR__ . '/inc/manutencao.php';
if (is_admin()) require_once __DIR__ . '/inc/painel.php';

/* ----------------------------------------------------------------- ativacao */
register_activation_hook(__FILE__, function () {
  $c = apix_config();

  // token do webhook sorteado na ativacao: token em branco deixaria o endpoint
  // aberto, e endpoint de publicacao aberto e anuncio de graca para qualquer um
  if ($c['webhook'] === '') {
    $c['webhook'] = wp_generate_password(40, false, false);
    update_option(APIX_OPCAO, $c);
  }

  if (!wp_next_scheduled(APIX_CRON)) {
    wp_schedule_event(time() + 300, 'hourly', APIX_CRON);
  }

  apix_protege_pasta_fotos();
  flush_rewrite_rules();
});

register_deactivation_hook(__FILE__, function () {
  wp_clear_scheduled_hook(APIX_CRON);
});
