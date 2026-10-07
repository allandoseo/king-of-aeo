/**
 * Lightbox da galeria.
 *
 * Escrita a mao de proposito: uma biblioteca pronta custaria dezenas de KB
 * em toda pagina de post, e este site vive de pagina com muita imagem.
 *
 * A imagem grande so e baixada quando a pessoa abre a foto. A miniatura da
 * grade ja usa loading="lazy", entao a pagina abre leve mesmo com 40 fotos.
 */
(function () {
  var grade = document.querySelector('.ahn-grade-fotos');
  var lb    = document.getElementById('ahn-lb');
  if (!grade || !lb) return;

  var palco = document.getElementById('ahn-lb-palco');
  var conta = document.getElementById('ahn-lb-conta');
  var fotos = Array.prototype.slice.call(grade.querySelectorAll('.ahn-foto'));
  var total = fotos.length;
  var atual = 0;
  var voltarPara = null;

  if (!total) return;

  function mostra(i) {
    atual = (i + total) % total;
    var bt  = fotos[atual];
    var src = bt.getAttribute('data-grande');

    palco.innerHTML = '';
    var img = new Image();
    img.src = src;
    var mini = bt.querySelector('img');
    img.alt = mini ? (mini.getAttribute('alt') || '') : '';
    palco.appendChild(img);

    conta.textContent = (atual + 1) + ' de ' + total;

    // adianta a proxima, para a navegacao nao piscar
    if (total > 1) {
      var prox = new Image();
      prox.src = fotos[(atual + 1) % total].getAttribute('data-grande');
    }
  }

  function abre(i) {
    voltarPara = document.activeElement;
    mostra(i);
    lb.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    document.getElementById('ahn-lb-fecha').focus();
  }

  function fecha() {
    lb.hidden = true;
    document.documentElement.style.overflow = '';
    palco.innerHTML = '';
    if (voltarPara && voltarPara.focus) voltarPara.focus();
  }

  grade.addEventListener('click', function (e) {
    var bt = e.target.closest ? e.target.closest('.ahn-foto') : null;
    if (!bt) return;
    abre(parseInt(bt.getAttribute('data-i'), 10) || 0);
  });

  document.getElementById('ahn-lb-fecha').addEventListener('click', fecha);
  document.getElementById('ahn-lb-ant').addEventListener('click', function () { mostra(atual - 1); });
  document.getElementById('ahn-lb-pro').addEventListener('click', function () { mostra(atual + 1); });

  // clique no fundo fecha; clique na imagem, nao
  lb.addEventListener('click', function (e) { if (e.target === lb) fecha(); });

  document.addEventListener('keydown', function (e) {
    if (lb.hidden) return;
    if (e.key === 'Escape')     { fecha(); }
    if (e.key === 'ArrowLeft')  { mostra(atual - 1); }
    if (e.key === 'ArrowRight') { mostra(atual + 1); }
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
