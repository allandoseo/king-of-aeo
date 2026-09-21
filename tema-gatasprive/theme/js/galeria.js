/**
 * Lightbox da galeria do anuncio.
 *
 * Escrita a mao: biblioteca pronta custaria dezenas de KB em toda pagina de
 * perfil, e este site vive de pagina com muita foto. A imagem grande so e
 * baixada quando a pessoa abre; as miniaturas usam loading="lazy".
 */
(function () {
  var lb = document.getElementById('gp-lb');
  var botoes = Array.prototype.slice.call(
    document.querySelectorAll('.gp-galeria__principal, .gp-galeria__mini')
  );
  if (!lb || !botoes.length) return;

  var palco = document.getElementById('gp-lb-palco');
  var conta = document.getElementById('gp-lb-conta');
  var total = botoes.length;
  var atual = 0;
  var voltarPara = null;

  function mostra(i) {
    atual = (i + total) % total;
    var bt = botoes[atual];

    palco.innerHTML = '';
    var img = new Image();
    img.src = bt.getAttribute('data-grande');
    var mini = bt.querySelector('img');
    img.alt = mini ? (mini.getAttribute('alt') || '') : '';
    palco.appendChild(img);

    conta.textContent = (atual + 1) + ' de ' + total;

    // adianta a proxima para a navegacao nao piscar
    if (total > 1) {
      var prox = new Image();
      prox.src = botoes[(atual + 1) % total].getAttribute('data-grande');
    }
  }

  function abre(i) {
    voltarPara = document.activeElement;
    mostra(i);
    lb.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    document.getElementById('gp-lb-fecha').focus();
  }

  function fecha() {
    lb.hidden = true;
    document.documentElement.style.overflow = '';
    palco.innerHTML = '';
    if (voltarPara && voltarPara.focus) voltarPara.focus();
  }

  botoes.forEach(function (bt, i) {
    bt.addEventListener('click', function () { abre(i); });
  });

  document.getElementById('gp-lb-fecha').addEventListener('click', fecha);
  document.getElementById('gp-lb-ant').addEventListener('click', function () { mostra(atual - 1); });
  document.getElementById('gp-lb-pro').addEventListener('click', function () { mostra(atual + 1); });
  lb.addEventListener('click', function (e) { if (e.target === lb) fecha(); });

  document.addEventListener('keydown', function (e) {
    if (lb.hidden) return;
    if (e.key === 'Escape')     fecha();
    if (e.key === 'ArrowLeft')  mostra(atual - 1);
    if (e.key === 'ArrowRight') mostra(atual + 1);
  });

  // arrastar o dedo no celular
  var x0 = null;
  lb.addEventListener('touchstart', function (e) { x0 = e.changedTouches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', function (e) {
    if (x0 === null) return;
    var d = e.changedTouches[0].clientX - x0;
    if (Math.abs(d) > 45) mostra(atual + (d < 0 ? 1 : -1));
    x0 = null;
  }, { passive: true });
})();
