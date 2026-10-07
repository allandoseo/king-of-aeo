<?php
/**
 * Portao 18+. Desligado por padrao (o protótipo aprovado nao tinha); liga no
 * Customizer.
 *
 * Regra que nao pode ser quebrada: o conteudo da pagina vai SEMPRE no HTML,
 * para todo mundo. O portao e so uma camada por cima, revelada pelo JavaScript
 * para quem ainda nao confirmou. Buscador nao executa esse JS e recebe a pagina
 * inteira — ninguem ve coisa diferente de ninguem. Servir conteudo diferente
 * para o Google e cloaking, e e motivo de punicao.
 */
if (!defined('ABSPATH')) exit;
if (!get_theme_mod('gp_idade_ativo', false)) return;

$saida = get_theme_mod('gp_idade_saida', 'https://www.google.com.br');
?>
<div class="gp-idade" id="gp-idade" role="dialog" aria-modal="true"
     aria-labelledby="gp-idade-tit" hidden>
  <div class="gp-idade__caixa">
    <span class="gp-idade__selo" aria-hidden="true">18+</span>
    <h2 id="gp-idade-tit">Conteúdo para maiores de 18 anos</h2>
    <p>
      Este site divulga anúncios de conteúdo adulto. Ao entrar, você declara ser
      maior de 18 anos.
    </p>
    <div class="gp-idade__bts">
      <button type="button" class="gp-bt gp-bt--roxo" id="gp-idade-sim">
        Tenho 18 anos ou mais
      </button>
      <a class="gp-bt gp-bt--cinza" href="<?php echo esc_url($saida); ?>" rel="nofollow noopener">
        Sair
      </a>
    </div>
  </div>
</div>
<script>
(function () {
  var cx = document.getElementById('gp-idade');
  if (!cx) return;
  var CHAVE = 'gp18';

  function jaAceitou() {
    try { if (localStorage.getItem(CHAVE) === '1') return true; } catch (e) {}
    return document.cookie.indexOf(CHAVE + '=1') !== -1;
  }
  function guarda() {
    try { localStorage.setItem(CHAVE, '1'); } catch (e) {}
    var d = new Date(); d.setTime(d.getTime() + 30 * 864e5);
    document.cookie = CHAVE + '=1;expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
  }

  if (jaAceitou()) return;

  cx.hidden = false;
  document.documentElement.style.overflow = 'hidden';
  document.getElementById('gp-idade-sim').addEventListener('click', function () {
    guarda();
    cx.hidden = true;
    document.documentElement.style.overflow = '';
  });
})();
</script>
