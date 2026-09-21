<?php if (!defined('ABSPATH')) exit; ?>
<form role="search" method="get" action="<?php echo esc_url(home_url('/')); ?>">
  <label class="gp-oculto" for="gp-busca">Buscar</label>
  <input type="search" id="gp-busca" name="s" value="<?php echo esc_attr(get_search_query()); ?>"
         placeholder="Buscar por nome ou bairro">
  <button type="submit" class="gp-bt gp-bt--roxo">Buscar</button>
</form>
