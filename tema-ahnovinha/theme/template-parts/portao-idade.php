<?php
/**
 * Portao 18+.
 *
 * Regra que nao pode ser quebrada: o conteudo da pagina e SEMPRE entregue no
 * HTML, para todo mundo. O portao e apenas uma camada por cima, revelada pelo
 * JavaScript so para quem ainda nao confirmou. Buscador nao executa esse JS e
 * recebe a pagina inteira — ou seja, ninguem ve coisa diferente de ninguem.
 * Servir conteudo diferente para o Google seria cloaking, e e motivo de punicao.
 */
if (!defined('ABSPATH')) exit;
if (!get_theme_mod('ahn_idade_ativo', true)) return;

$tit   = get_theme_mod('ahn_idade_tit', 'Conteudo para maiores de 18 anos');
$txt   = get_theme_mod('ahn_idade_txt', 'Este site tem conteudo adulto. Ao entrar, voce declara ser maior de 18 anos e concorda em visualizar esse tipo de material.');
$saida = get_theme_mod('ahn_idade_saida', 'https://www.google.com.br');
?>
<div class="ahn-idade" id="ahn-idade" role="dialog" aria-modal="true"
     aria-labelledby="ahn-idade-tit" hidden>
  <div class="ahn-idade__caixa">
    <span class="ahn-idade__selo" aria-hidden="true">18+</span>
    <h2 id="ahn-idade-tit"><?php echo esc_html($tit); ?></h2>
    <p><?php echo wp_kses_post($txt); ?></p>
    <div class="ahn-idade__bts">
      <button type="button" class="ahn-bt ahn-bt--sim" id="ahn-idade-sim">
        Tenho 18 anos ou mais
      </button>
      <a class="ahn-bt ahn-bt--nao" href="<?php echo esc_url($saida); ?>" rel="nofollow noopener">
        Sair do site
      </a>
    </div>
  </div>
</div>
<script>
(function () {
  var cx = document.getElementById('ahn-idade');
  if (!cx) return;

  var CHAVE = 'ahn18';

  function jaAceitou() {
    try { if (localStorage.getItem(CHAVE) === '1') return true; } catch (e) {}
    return document.cookie.indexOf(CHAVE + '=1') !== -1;
  }

  function guarda() {
    try { localStorage.setItem(CHAVE, '1'); } catch (e) {}
    // 30 dias; o cookie e a rede de seguranca quando o localStorage esta bloqueado
    var d = new Date();
    d.setTime(d.getTime() + 30 * 864e5);
    document.cookie = CHAVE + '=1;expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
  }

  if (jaAceitou()) return;          // ja confirmou antes: nem mostra

  cx.hidden = false;
  document.documentElement.style.overflow = 'hidden';

  document.getElementById('ahn-idade-sim').addEventListener('click', function () {
    guarda();
    cx.hidden = true;
    document.documentElement.style.overflow = '';
  });
})();
</script>
