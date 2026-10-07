<?php
/**
 * Roda quando o plugin e apagado em Plugins -> Excluir.
 *
 * Apaga a configuracao, o agendamento e os transients de limite. NAO apaga os
 * anuncios nem as fotos: sao conteudo pago do site, e perder o que o anunciante
 * pagou porque alguem clicou em "Excluir" no plugin errado nao se desfaz.
 */

if (!defined('WP_UNINSTALL_PLUGIN')) exit;

delete_option('apix_config');
delete_option('apix_pagina_anunciar');
wp_clear_scheduled_hook('apix_manutencao');

global $wpdb;
$wpdb->query(
  "DELETE FROM {$wpdb->options}
    WHERE option_name LIKE '\_transient\_apix\_%'
       OR option_name LIKE '\_transient\_timeout\_apix\_%'"
);
