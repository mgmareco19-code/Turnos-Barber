/* Página de ventas: precio, nombre de la plataforma y links de WhatsApp salen de js/config.js */
(() => {
  const cfg = window.APP_CONFIG, p = cfg.plataforma;
  const msgs = {
    demo: `Hola! Vi la página de ${p.nombre} y quiero ver una demo para mi barbería.`,
    alta: `Hola! Quiero empezar a usar ${p.nombre} en mi barbería.`,
  };
  document.querySelectorAll("[data-wa]").forEach((a) => { a.href = U.waLink(p.soporteWhatsapp, msgs[a.dataset.wa] || msgs.demo); });
  document.querySelectorAll("[data-precio]").forEach((el) => { el.textContent = U.gs(cfg.precioMensual); });
  document.querySelectorAll(".js-plataforma").forEach((el) => { el.innerHTML = U.logoHtml(p.nombre); });
  document.querySelectorAll(".js-plataforma-txt").forEach((el) => { el.textContent = p.nombre; });
  document.querySelectorAll("[data-anio]").forEach((el) => { el.textContent = new Date().getFullYear(); });
  if (document.getElementById("inicio")) document.title = `${p.nombre} · Turnos online y gestión para barberías`;
  U.icons();
})();
