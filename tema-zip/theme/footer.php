</section>
</div></main>
<p class="disclaimer"><?php echo esc_html(get_theme_mod('dmix_disclaimer', 'Este site não é responsável pelos anúncios aqui publicados, tão pouco por consequências diretas ou indiretas que possam corresponder a dados, marcas, pessoas, ou serviços oferecidos nos referidos anúncios.')); ?></p>
<footer class="site-footer"><div class="wrap">
  <div class="logo"><small><?php bloginfo('name'); ?></small><br>MIX<br><small>&copy; <?php echo date('Y'); ?></small></div>
  <div><small>LINKS ÚTEIS</small><?php wp_nav_menu(['theme_location' => 'rodape', 'container' => false, 'fallback_cb' => false]); ?></div>
</div></footer>
<?php wp_footer(); ?>
</body></html>
