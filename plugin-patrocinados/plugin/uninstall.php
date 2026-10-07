<?php
/**
 * Roda quando o plugin e apagado em Plugins -> Excluir. O WordPress acha este
 * arquivo pelo nome, sem gancho registrado e sem escrita no banco a cada visita.
 *
 * Opcao orfa fica na wp_options para sempre, e opcao com nome conhecido num site
 * que "nunca teve esse plugin" e rastro.
 */

if (!defined('WP_UNINSTALL_PLUGIN')) exit;

delete_option('apat_config');
