<?php
/**
 * Fileira de categorias em formato de chip, com setas nas pontas.
 *
 * Entram TODAS as categorias, inclusive as ainda sem post. A ordem e por
 * quantidade, entao as cheias ficam na frente e as vazias no fim.
 *
 * As setas so aparecem quando a fileira realmente nao cabe, e cada uma some
 * quando chega na sua ponta. Seta que nao leva a lugar nenhum e pior do que
 * seta nenhuma.
 */
if (!defined('ABSPATH')) exit;

$cats = get_categories(['hide_empty' => false, 'orderby' => 'count', 'order' => 'DESC', 'number' => 0]);
if (!$cats) return;

$atual = is_category() ? (int) get_queried_object_id() : 0;
?>
<div class="ahn-chips-area" id="ahn-chips-area">

  <button type="button" class="ahn-chips__seta ahn-chips__seta--esq"
          id="ahn-chips-esq" aria-label="Ver categorias anteriores" hidden>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M15 5 8 12l7 7"></path>
    </svg>
  </button>

  <nav class="ahn-chips" id="ahn-chips" aria-label="Categorias">
    <a href="<?php echo esc_url(home_url('/')); ?>"<?php
      echo (is_home() || is_front_page()) ? ' class="atual"' : ''; ?>>Tudo</a>
    <?php foreach ($cats as $c) : ?>
      <a href="<?php echo esc_url(get_category_link($c->term_id)); ?>"<?php
        echo $atual === (int) $c->term_id ? ' class="atual"' : ''; ?>>
        <?php echo esc_html($c->name); ?>
      </a>
    <?php endforeach; ?>
  </nav>

  <button type="button" class="ahn-chips__seta ahn-chips__seta--dir"
          id="ahn-chips-dir" aria-label="Ver mais categorias" hidden>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m9 5 7 7-7 7"></path>
    </svg>
  </button>

</div>

<script>
(function () {
  var faixa = document.getElementById('ahn-chips');
  var area  = document.getElementById('ahn-chips-area');
  var esq   = document.getElementById('ahn-chips-esq');
  var dir   = document.getElementById('ahn-chips-dir');
  if (!faixa || !esq || !dir) return;

  function atualiza() {
    var sobra = faixa.scrollWidth - faixa.clientWidth;
    if (sobra < 4) {                      // cabe inteira: nenhuma seta
      esq.hidden = true; dir.hidden = true;
      area.classList.remove('tem-esq', 'tem-dir');
      return;
    }
    var temEsq = faixa.scrollLeft > 4;
    var temDir = faixa.scrollLeft < sobra - 4;
    esq.hidden = !temEsq;
    dir.hidden = !temDir;
    area.classList.toggle('tem-esq', temEsq);
    area.classList.toggle('tem-dir', temDir);
  }

  function anda(sentido) {
    // 65% da largura visivel: avanca bastante sem perder a referencia
    faixa.scrollBy({ left: sentido * faixa.clientWidth * 0.65, behavior: 'smooth' });
  }

  esq.addEventListener('click', function () { anda(-1); });
  dir.addEventListener('click', function () { anda(1); });
  faixa.addEventListener('scroll', atualiza, { passive: true });
  window.addEventListener('resize', atualiza);

  // a fonte Sora chega depois e muda a largura dos chips
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(atualiza);

  atualiza();
})();
</script>
