<aside>
  <div class="box search"><h3>Encontre</h3><?php get_search_form(); ?></div>
  <div class="box estados"><h3>Estados</h3>
    <ul><?php foreach (get_terms(['taxonomy' => 'local', 'parent' => 0, 'hide_empty' => false]) as $t) {
      echo '<li><a href="' . esc_url(get_term_link($t)) . '">' . esc_html($t->name) . '</a></li>';
    } ?></ul>
  </div>
</aside>
