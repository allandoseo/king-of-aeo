<form role="search" method="get" action="<?php echo esc_url(home_url('/')); ?>">
  <input type="search" name="s" value="<?php echo get_search_query(); ?>" aria-label="Buscar">
  <button type="submit" aria-label="Buscar">&#9906;</button>
</form>
