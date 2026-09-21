<?php if (!defined('ABSPATH')) exit; ?>
<form class="ahn-busca" role="search" method="get" action="<?php echo esc_url(home_url('/')); ?>">
  <label class="ahn-oculto" for="ahn-busca-campo">Buscar</label>
  <input type="search" id="ahn-busca-campo" name="s"
         value="<?php echo esc_attr(get_search_query()); ?>"
         placeholder="Buscar imagens, categorias, tags...">
  <button type="submit" aria-label="Buscar">
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5"></circle><path d="M15.5 15.5 21 21"></path>
    </svg>
  </button>
</form>
