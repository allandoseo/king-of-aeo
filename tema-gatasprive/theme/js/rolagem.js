/**
 * Rolagem infinita, por cima de um link de verdade.
 *
 * O HTML traz <a class="gp-pag__mais" href="...pagina 2..." rel="next">. Este
 * script observa esse botao: quando ele entra na tela, busca a proxima pagina,
 * tira os cards de dentro dela e cola na grade. Para quem usa, vira rolagem
 * infinita; para o buscador, continua sendo uma corrente de links navegavel.
 *
 * Tres cuidados que nao sao enfeite:
 *  - uma requisicao por vez, senao rolar rapido dispara varias ao mesmo tempo;
 *  - o endereco da barra acompanha a pagina carregada, entao recarregar ou
 *    compartilhar nao joga a pessoa de volta para o comeco;
 *  - se der erro, o botao volta ao normal e continua clicavel.
 */
(function () {
  var grade = document.getElementById('gp-grade');
  if (!grade || !('IntersectionObserver' in window)) return;   // sem suporte: fica o botao

  var ocupado = false;

  function botao() {
    return document.querySelector('.gp-pag__mais');
  }

  async function carrega() {
    var bt = botao();
    if (!bt || ocupado) return;

    ocupado = true;
    bt.classList.add('carregando');
    bt.querySelector('span').textContent = 'Carregando…';

    try {
      var r = await fetch(bt.href, { credentials: 'same-origin' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var doc = new DOMParser().parseFromString(await r.text(), 'text/html');

      var novos = doc.querySelectorAll('#gp-grade .gp-card');
      for (var i = 0; i < novos.length; i++) {
        grade.appendChild(document.importNode(novos[i], true));
      }

      // o endereco passa a ser o da pagina que acabou de entrar
      try { history.replaceState(null, '', bt.href); } catch (e) {}

      var proximo = doc.querySelector('.gp-pag__mais');
      var nav = bt.closest('.gp-pag');
      if (proximo && nav) {
        nav.innerHTML = proximo.outerHTML;       // avanca o botao para a pagina seguinte
        observa();
      } else if (nav) {
        nav.remove();                            // acabou o acervo
        observador.disconnect();
      }
    } catch (e) {
      bt.classList.remove('carregando');
      bt.querySelector('span').textContent = 'Carregar mais';
    }

    ocupado = false;
  }

  var observador = new IntersectionObserver(function (entradas) {
    if (entradas[0] && entradas[0].isIntersecting) carrega();
  }, { rootMargin: '600px 0px' });               // adianta: carrega antes de chegar no fim

  function observa() {
    var bt = botao();
    if (bt) observador.observe(bt);
  }

  // clique continua funcionando e nao recarrega a pagina
  document.addEventListener('click', function (e) {
    var bt = e.target.closest ? e.target.closest('.gp-pag__mais') : null;
    if (!bt) return;
    e.preventDefault();
    carrega();
  });

  observa();
})();
