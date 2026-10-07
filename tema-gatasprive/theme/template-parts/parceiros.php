<?php
/**
 * Bloco de links parceiros, acima do rodape.
 *
 * Duas decisoes que nao sao de estilo:
 *
 * 1. Os links saem SEGUIDOS por padrao, para passar forca ao destino. A chave
 *    "Marcar como patrocinado" acrescenta rel="sponsored nofollow" quando houver
 *    contrapartida — dinheiro, permuta ou troca combinada. Nesse caso a marcacao
 *    nao e opcional: link pago seguido e esquema de links, e a punicao atinge os
 *    dois sites.
 *
 * 2. Por padrao so sai na home. Bloco de links identico em todas as paginas e o
 *    padrao classico que entrega rede: o mesmo conjunto de destinos repetido em
 *    centenas de URLs do mesmo dominio.
 *
 * O noopener fica sempre: e seguranca de navegador, nao tem relacao com SEO e
 * nao afeta a transmissao de forca.
 */
if (!defined('ABSPATH')) exit;

$links = gp_parceiros();
if (!$links) return;

if (!get_theme_mod('gp_parceiros_tudo', false) && !is_front_page() && !is_home()) return;

$titulo = get_theme_mod('gp_parceiros_titulo', 'Parceiros');
$rel    = get_theme_mod('gp_parceiros_pago', false) ? 'sponsored nofollow noopener' : 'noopener';
?>
<aside class="gp-parceiros" aria-label="<?php echo esc_attr($titulo); ?>">
  <div class="gp-wrap">
    <?php if ($titulo) : ?>
      <h2 class="gp-parceiros__tit"><?php echo esc_html($titulo); ?></h2>
    <?php endif; ?>
    <ul class="gp-parceiros__lista">
      <?php foreach ($links as $l) : ?>
        <li>
          <a href="<?php echo esc_url($l['url']); ?>"
             rel="<?php echo esc_attr($rel); ?>" target="_blank">
            <?php echo esc_html($l['nome']); ?>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M7 17 17 7M9 7h8v8"></path>
            </svg>
          </a>
        </li>
      <?php endforeach; ?>
    </ul>
  </div>
</aside>
