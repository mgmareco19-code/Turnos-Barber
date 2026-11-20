/* Panel superadmin: alta de locales, abonos y suspensión */
(() => {
  const cfg = window.APP_CONFIG;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  let locales = [], pagos = [], mesFiltro = null; // mesFiltro: "AAAA-MM" elegido en el gráfico

  $$(".js-plataforma").forEach((el) => (el.innerHTML = U.logoHtml(cfg.plataforma.nombre)));

  /* ---------- Sesión ---------- */
  async function arrancar() {
    if (DB.modo === "demo") {
      $("#campoEmail").hidden = true;
      $("#loginHint").hidden = false;
      $("#loginHint").innerHTML = `Modo demo: la contraseña es <b>${U.esc(cfg.demoPasswordSuper)}</b>`;
    }
    if (await DB.esSuper()) mostrarPanel(); else mostrarLogin();
  }
  function mostrarLogin() {
    $("#vistaPanel").hidden = true; $("#vistaLogin").hidden = false; U.icons();
    $(DB.modo === "demo" ? "[name=password]" : "[name=email]", $("#formLogin")).focus();
  }
  async function mostrarPanel() {
    $("#vistaLogin").hidden = true; $("#vistaPanel").hidden = false;
    await cargar();
  }
  $("#formLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, err = $("#loginError"), btn = $("button[type=submit]", f);
    err.hidden = true; btn.disabled = true;
    try { await DB.superLogin(f.email.value.trim(), f.password.value); f.reset(); mostrarPanel(); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { btn.disabled = false; }
  });
  $("#btnSalir").addEventListener("click", async () => { await DB.superLogout(); mostrarLogin(); });

  /* ---------- Datos ---------- */
  async function cargar() {
    try { [locales, pagos] = await Promise.all([DB.superNegocios(), DB.superPagos()]); render(); renderIngresos(); }
    catch (e) { U.toast(e.message, "error"); if (!(await DB.esSuper())) mostrarLogin(); }
  }
  // Si otra pestaña (el panel de un dueño, una reserva) cambió algo, refrescar
  window.addEventListener("storage", () => { if (!$("#vistaPanel").hidden && !$("dialog[open]")) cargar(); });

  const grupo = (l) => (["vencido", "gracia"].includes(l.estado.clave) ? "vencidos" : l.estado.clave);
  function filtrados() {
    const q = $("#buscar").value.trim().toLowerCase(), f = $("#filtro").value;
    return locales.filter((l) => (!f || grupo(l) === f) &&
      (!q || [l.nombre, l.slug, l.dueno].some((x) => String(x).toLowerCase().includes(q))));
  }

  function render() {
    const n = (k) => locales.filter((l) => grupo(l) === k).length;
    const tiles = [
      ["store", "Locales activos", n("activo") + n("por_vencer"), `${locales.length} en total`],
      ["clock-alert", "Por vencer", n("por_vencer"), "en los próximos 7 días"],
      ["alert-circle", "Vencidos", n("vencidos"), `${n("suspendido")} suspendido${n("suspendido") === 1 ? "" : "s"}`],
      ["calendar-check", "Turnos 30 días", locales.reduce((a, l) => a + l.turnos30, 0), `${locales.reduce((a, l) => a + l.proximos, 0)} próximos`],
    ];
    $("#kpis").innerHTML = tiles.map(([i, l, v, s]) => `
      <div class="kpi"><span class="kpi__icon"><i data-lucide="${i}"></i></span>
      <div><small>${l}</small><strong>${v}</strong><em>${s}</em></div></div>`).join("");

    const ls = filtrados();
    $("#lista").innerHTML = !ls.length ? `<p class="empty"><i data-lucide="store"></i>${locales.length ? "Ningún local coincide con la búsqueda." : "Todavía no hay locales. Creá el primero con «Nuevo local»."}</p>` : `
      <table class="tabla tabla--locales">
        <thead><tr><th>Local</th><th>Dueño</th><th>Equipo</th><th>Turnos</th><th>Abono</th><th><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${ls.map((l) => `
          <tr class="${l.estado.reserva ? "" : "is-pausa"}">
            <td data-l="Local"><div class="local-cel"><span class="logo-thumb">${l.logo ? `<img src="${U.esc(l.logo)}" alt="">` : '<i data-lucide="scissors"></i>'}</span>
              <span><strong>${U.esc(l.nombre)}</strong><small>?local=${U.esc(l.slug)}</small></span></div></td>
            <td data-l="Dueño">${U.esc(l.dueno || "—")}</td>
            <td data-l="Equipo">${l.barberos} barbero${l.barberos === 1 ? "" : "s"}<small>${l.servicios} servicio${l.servicios === 1 ? "" : "s"}</small></td>
            <td data-l="Turnos">${l.turnos30} <small>últimos 30 días · ${l.proximos} próximos</small></td>
            <td data-l="Abono"><span class="estado-neg estado-neg--${l.estado.clave}">${l.estado.txt}</span>
              <small>${l.vence_el ? "vence " + fechaNum(l.vence_el) : "sin vencimiento"} · ${U.gs(l.precio)}/mes</small></td>
            <td class="tabla__acc">
              <button class="btn btn--ghost btn--sm" data-cobrar="${l.id}" title="Registrar pago y renovar el abono"><i data-lucide="banknote"></i>Cobrar</button>
              <button class="icon-btn" data-accesos="${l.id}" title="Accesos para compartir" aria-label="Accesos de ${U.esc(l.nombre)}"><i data-lucide="key-round"></i></button>
              <a class="icon-btn" href="${U.linkReserva(l.slug)}" target="_blank" rel="noopener" aria-label="Ver reservas de ${U.esc(l.nombre)}"><i data-lucide="external-link"></i></a>
              <button class="icon-btn" data-editar="${l.id}" aria-label="Editar ${U.esc(l.nombre)}"><i data-lucide="pencil"></i></button>
            </td>
          </tr>`).join("")}</tbody>
      </table>`;
    U.icons();
  }
  const fechaNum = (s) => { const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };
  $("#buscar").addEventListener("input", render);
  $("#filtro").addEventListener("change", render);

  /* ---------- Pestañas ---------- */
  $$("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    const t = b.dataset.tab;
    $$("[data-tab]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    $("#vistaLocales").hidden = t !== "locales"; $("#barraLocales").hidden = t !== "locales";
    $("#vistaIngresos").hidden = t !== "ingresos";
  }));

  /* ---------- Ingresos ---------- */
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const MESES_L = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const mesTxt = (ym, largo) => { const [y, m] = ym.split("-").map(Number); return largo ? `${MESES_L[m - 1]} ${y}` : MESES[m - 1]; };
  const suma = (ps) => ps.reduce((a, p) => a + p.monto, 0);
  const gsCorto = (n) => n >= 1e6 ? (n / 1e6).toLocaleString("es-PY", { maximumFractionDigits: 1 }) + " M" : n >= 1000 ? Math.round(n / 1000) + " mil" : String(n);

  function renderIngresos() {
    const hoy = U.hoy(), mesActual = hoy.slice(0, 7);
    const finMes = U.addDays(U.sumarMeses(mesActual + "-01", 1), -1);
    const cobrables = locales.filter((l) => l.activo && l.estado.clave !== "vencido");
    const esperado = cobrables.reduce((a, l) => a + l.precio, 0);
    const delMes = pagos.filter((p) => p.fecha.startsWith(mesActual));
    const porCobrar = locales.filter((l) => l.activo && l.vence_el && l.vence_el <= finMes).sort((a, b) => a.vence_el.localeCompare(b.vence_el));
    const anio = suma(pagos.filter((p) => p.fecha.startsWith(hoy.slice(0, 4))));

    const tiles = [
      ["wallet", `Cobrado en ${MESES_L[Number(mesActual.slice(5)) - 1]}`, U.gs(suma(delMes)), `${delMes.length} pago${delMes.length === 1 ? "" : "s"}`],
      ["trending-up", "Ingreso mensual esperado", U.gs(esperado), `${cobrables.length} local${cobrables.length === 1 ? "" : "es"} al día`],
      ["hourglass", "Por cobrar este mes", U.gs(porCobrar.reduce((a, l) => a + l.precio, 0)), `${porCobrar.length} local${porCobrar.length === 1 ? "" : "es"}`],
      ["calendar", `Cobrado en ${hoy.slice(0, 4)}`, U.gs(anio), "en el año"],
    ];
    $("#kpisIng").innerHTML = tiles.map(([i, l, v, s]) => `
      <div class="kpi"><span class="kpi__icon"><i data-lucide="${i}"></i></span>
      <div><small>${l}</small><strong>${v}</strong><em>${s}</em></div></div>`).join("");

    // Gráfico: últimos 12 meses
    const meses = Array.from({ length: 12 }, (_, i) => U.sumarMeses(mesActual + "-01", i - 11).slice(0, 7));
    const tot = meses.map((ym) => suma(pagos.filter((p) => p.fecha.startsWith(ym))));
    const max = Math.max(esperado, ...tot, 1);
    const tope = Math.ceil(max / 50000) * 50000;
    const alto = (f) => `calc(1.6rem + (100% - 1.6rem) * ${f})`; // 1.6rem = fila de los meses
    $("#grafico").innerHTML = `
      <div class="barras__eje" aria-hidden="true">${[1, .5, 0].map((f) => `<span style="bottom:${f * 100}%">${gsCorto(tope * f)}</span>`).join("")}</div>
      <div class="barras__area">
        ${[1, .5].map((f) => `<i class="barras__linea" style="bottom:${alto(f)}"></i>`).join("")}
        ${esperado ? `<i class="barras__meta" style="bottom:${alto(esperado / tope)}"><span>esperado ${gsCorto(esperado)}</span></i>` : ""}
        ${meses.map((ym, i) => `
          <button class="mes-bar${ym === mesFiltro ? " is-sel" : ""}${ym === mesActual ? " is-hoy" : ""}" data-mes="${ym}"
            aria-label="${mesTxt(ym, true)}: ${U.gs(tot[i])}" aria-pressed="${ym === mesFiltro}">
            <span class="mes-bar__tip">${mesTxt(ym, true)}<b>${U.gs(tot[i])}</b></span>
            <span class="mes-bar__val" style="height:${(tot[i] / tope) * 100}%">${ym === mesActual && tot[i] ? `<em>${gsCorto(tot[i])}</em>` : ""}</span>
            <span class="mes-bar__mes">${mesTxt(ym)}</span>
          </button>`).join("")}
      </div>`;

    // Por cobrar
    $("#porCobrarSub").textContent = porCobrar.length ? `vencen hasta el ${fechaNum(finMes)}` : "";
    $("#porCobrar").innerHTML = !porCobrar.length ? `<p class="empty"><i data-lucide="party-popper"></i>Todos al día este mes.</p>` : `
      <ul class="cobros">${porCobrar.map((l) => `
        <li><span class="logo-thumb">${l.logo ? `<img src="${U.esc(l.logo)}" alt="">` : '<i data-lucide="scissors"></i>'}</span>
          <span class="cobros__txt"><strong>${U.esc(l.nombre)}</strong>
            <small>${l.vence_el < hoy ? "venció" : "vence"} ${fechaNum(l.vence_el)} · ${U.gs(l.precio)}</small></span>
          <span class="estado-neg estado-neg--${l.estado.clave}">${l.estado.txt}</span>
          <button class="btn btn--ghost btn--sm" data-cobrar="${l.id}"><i data-lucide="banknote"></i>Cobrar</button></li>`).join("")}
      </ul>`;

    // Pagos
    const ps = mesFiltro ? pagos.filter((p) => p.fecha.startsWith(mesFiltro)) : pagos.slice(0, 30);
    $("#pagosTitulo").textContent = mesFiltro ? `Pagos de ${mesTxt(mesFiltro, true)} · ${U.gs(suma(ps))}` : "Últimos pagos";
    $("#btnVerTodos").hidden = !mesFiltro;
    $("#pagos").innerHTML = !ps.length ? `<p class="empty"><i data-lucide="receipt"></i>No hay pagos ${mesFiltro ? "en este mes" : "registrados"}.</p>` : `
      <table class="tabla tabla--pagos">
        <thead><tr><th>Fecha</th><th>Local</th><th>Cubre</th><th class="num">Monto</th><th><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${ps.map((p) => `<tr>
          <td data-l="Fecha">${fechaNum(p.fecha)}</td>
          <td data-l="Local">${U.esc(p.local)}</td>
          <td data-l="Cubre">${p.meses} mes${p.meses === 1 ? "" : "es"}<small>hasta ${fechaNum(p.hasta)}</small></td>
          <td data-l="Monto" class="num"><strong>${U.gs(p.monto)}</strong></td>
          <td class="tabla__acc"><button class="icon-btn" data-borrar-pago="${p.id}" aria-label="Borrar pago"><i data-lucide="trash-2"></i></button></td>
        </tr>`).join("")}</tbody>
      </table>`;
    U.icons();
  }
  $("#grafico").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mes]"); if (!b) return;
    mesFiltro = mesFiltro === b.dataset.mes ? null : b.dataset.mes; renderIngresos();
  });
  $("#btnVerTodos").addEventListener("click", () => { mesFiltro = null; renderIngresos(); });
  $("#pagos").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-borrar-pago]"); if (!b) return;
    const p = pagos.find((x) => x.id === Number(b.dataset.borrarPago));
    if (!confirm(`¿Borrar el pago de ${U.gs(p.monto)} de «${p.local}» (${fechaNum(p.fecha)})?\n\nEl vencimiento del local no cambia: si hace falta, corregilo editando el local.`)) return;
    try { await DB.superEliminarPago(p.id); U.toast("Pago borrado"); await cargar(); }
    catch (ex) { U.toast(ex.message, "error"); }
  });
  $("#porCobrar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cobrar]"); if (b) abrirPago(locales.find((x) => x.id === Number(b.dataset.cobrar)));
  });

  /* ---------- Registrar pago ---------- */
  const fP = $("#formPago");
  let pagoLocal = null;
  function abrirPago(l) {
    pagoLocal = l; fP.reset(); $("#pagoError").hidden = true;
    fP.id.value = l.id; fP.meses.value = "1"; fP.fecha.value = U.hoy(); fP.fecha.max = U.hoy();
    fP.monto.value = l.precio;
    $("#pagoLocal").innerHTML = `<strong>${U.esc(l.nombre)}</strong> · ${U.gs(l.precio)} por mes · ${l.vence_el ? (l.vence_el < U.hoy() ? "venció el " : "vence el ") + fechaNum(l.vence_el) : "sin vencimiento"}`;
    resumenPago(); U.icons();
    $("#modalPago").showModal();
  }
  function resumenPago() {
    const l = pagoLocal, desde = !l.vence_el || l.vence_el < U.hoy() ? U.hoy() : l.vence_el;
    const hasta = U.sumarMeses(desde, Number(fP.meses.value));
    $("#pagoResumen").innerHTML = `<i data-lucide="calendar-check"></i> Queda activo hasta el <b>${fechaNum(hasta)}</b>` +
      (l.activo ? "" : " y se reactiva el local") + ".";
    U.icons();
  }
  fP.meses.addEventListener("change", () => { fP.monto.value = pagoLocal.precio * Number(fP.meses.value); resumenPago(); });
  fP.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#pagoError"); err.hidden = true;
    if (!fP.monto.value || !fP.fecha.value) { err.textContent = "Completá el monto y la fecha del pago."; err.hidden = false; return; }
    const btn = $("#btnGuardarPago"); btn.disabled = true;
    try {
      const { pago } = await DB.superRegistrarPago(pagoLocal.id, { monto: Number(fP.monto.value), meses: Number(fP.meses.value), fecha: fP.fecha.value });
      $("#modalPago").close();
      U.toast(`Pago de ${U.gs(pago.monto)} registrado · activo hasta el ${fechaNum(pago.hasta)}`);
      await cargar();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { btn.disabled = false; }
  });

  $("#lista").addEventListener("click", async (e) => {
    const r = e.target.closest("[data-cobrar]");
    if (r) abrirPago(locales.find((x) => x.id === Number(r.dataset.cobrar)));
    const ac = e.target.closest("[data-accesos]");
    if (ac) { const l = locales.find((x) => x.id === Number(ac.dataset.accesos)); mostrarCreado(l, l.dueno, false); }
    const ed = e.target.closest("[data-editar]");
    if (ed) abrirLocal(locales.find((x) => x.id === Number(ed.dataset.editar)));
  });

  /* ---------- Alta / edición ---------- */
  const fL = $("#formLocal");
  let slugTocado = false;
  $("#slugPre").textContent = location.protocol === "file:" ? "…/index.html?local=" : U.linkReserva("").replace(/^https?:\/\//, "");

  function abrirLocal(l = null) {
    fL.reset(); $("#localError").hidden = true;
    slugTocado = Boolean(l);
    fL.id.value = l?.id || "";
    fL.nombre.value = l?.nombre || "";
    fL.slug.value = l?.slug || "";
    fL.dueno.value = l?.dueno || "";
    fL.vence_el.value = l ? (l.vence_el || "") : U.addDays(U.hoy(), 30); // 30 días de prueba
    fL.precio.value = l ? l.precio : cfg.precioMensual;
    fL.activo.checked = l ? l.activo : true;
    $("#campoActivo").hidden = !l;
    $("#slugAviso").hidden = true;
    $("#localTitulo").textContent = l ? `Editar «${l.nombre}»` : "Nuevo local";
    $("#btnGuardarLocal").innerHTML = l ? '<i data-lucide="save"></i>GUARDAR CAMBIOS' : '<i data-lucide="store"></i>CREAR LOCAL';
    txtActivo(); validarSlug(); U.icons();
    $("#modalLocal").showModal();
    fL.nombre.focus();
  }
  const txtActivo = () => { $("#activoTxt").textContent = fL.activo.checked ? "Activo" : "Suspendido (sin reservas online)"; };
  function validarSlug() {
    const id = Number(fL.id.value) || undefined, s = fL.slug.value;
    const msg = s ? DB.slugLibre(s, id) : "";
    $("#slugMsg").textContent = msg || (s ? "Disponible" : "");
    $("#slugMsg").className = "slug__msg " + (msg ? "is-err" : "is-ok");
    const original = id && locales.find((x) => x.id === id)?.slug;
    $("#slugAviso").hidden = !original || original === s;
    return !msg;
  }
  fL.nombre.addEventListener("input", () => { if (!slugTocado) { fL.slug.value = U.slugify(fL.nombre.value); validarSlug(); } });
  fL.slug.addEventListener("input", () => {
    slugTocado = true;
    const limpio = fL.slug.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-{2,}/g, "-");
    if (limpio !== fL.slug.value) fL.slug.value = limpio;
    validarSlug();
  });
  fL.slug.addEventListener("blur", () => { fL.slug.value = fL.slug.value.replace(/^-+|-+$/g, ""); validarSlug(); });
  fL.activo.addEventListener("change", txtActivo);
  $("#btnNuevo").addEventListener("click", () => abrirLocal());

  fL.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#localError"); err.hidden = true;
    fL.slug.value = fL.slug.value.replace(/^-+|-+$/g, "");
    if (!fL.checkValidity() || !validarSlug()) {
      err.textContent = $("#slugMsg").classList.contains("is-err") ? $("#slugMsg").textContent : "Completá el nombre, el link, un email válido y el precio del abono.";
      err.hidden = false; return;
    }
    const id = Number(fL.id.value) || null;
    const datos = { nombre: fL.nombre.value.trim(), slug: fL.slug.value, dueno: fL.dueno.value.trim(), vence_el: fL.vence_el.value || null, precio: Number(fL.precio.value) };
    const btn = $("#btnGuardarLocal"); btn.disabled = true;
    try {
      if (id) {
        const r = await DB.superGuardarNegocio(id, { ...datos, activo: fL.activo.checked });
        $("#modalLocal").close(); U.toast("Cambios guardados");
        if (r?.clave_temporal) mostrarCreado(r, datos.dueno, false, r.clave_temporal); // se le creó usuario al dueño
      } else {
        const n = await DB.superCrearNegocio(datos);
        $("#modalLocal").close();
        mostrarCreado(n, datos.dueno, true, n.clave_temporal);
      }
      await cargar();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { btn.disabled = false; }
  });

  /**
   * Accesos del local: link de reservas (clientes) + panel del staff.
   * nuevo=true al darlo de alta. claveNueva: la contraseña recién generada (modo online).
   * En modo online la contraseña guardada no se puede ver (está encriptada): se genera una nueva.
   */
  let accesoActual = null;
  function mostrarCreado(n, email, nuevo = true, claveNueva = null) {
    accesoActual = { n, email, nuevo };
    const reserva = U.linkReserva(n.slug);
    const panel = new URL("admin.html?u=" + encodeURIComponent(email || ""), location.href).href;
    const demo = DB.modo === "demo";
    const conocida = demo || Boolean(claveNueva);
    const clave = demo ? cfg.demoPasswordDueno : (claveNueva || "(la que ya tiene el dueño)");
    $("#accClaveNueva").hidden = demo;
    $("#accClaveNueva").lastChild.textContent = claveNueva ? "Generar otra" : "Generar nueva";
    $("#creadoTitulo").textContent = nuevo ? "Local creado" : `Accesos · ${n.nombre}`;
    $("#creadoSub").textContent = nuevo
      ? "Mandale estos datos al dueño. Desde su panel carga barberos, servicios, horario y WhatsApp."
      : "Copiá lo que necesites para mandarle al dueño o a su staff.";
    $("#accReserva").textContent = reserva;
    $("#accPanel").textContent = panel;
    $("#accUsuario").textContent = email || "—";
    $("#accClave").textContent = clave;
    $("#accClaveCopiar").hidden = !conocida;
    $("#creadoAbrir").href = reserva;
    $("#accPanelAbrir").href = panel;
    $("#creadoMsg").textContent =
      `¡Hola! ${nuevo ? "Ya está listo el sistema de turnos de" : "Te paso los accesos del sistema de turnos de"} ${n.nombre}.\n\n` +
      `📅 Link para tus clientes:\n${reserva}\n\n` +
      `🔑 Acceso del staff (tu panel):\n${panel}\nUsuario: ${email}\n` +
      (conocida ? `Contraseña: ${clave}\n` + (demo ? "" : "(podés cambiarla en «Configuración»)\n") : "") + "\n" +
      (nuevo ? `Entrá al panel y cargá tus barberos, servicios, horario y WhatsApp en «Configuración».` : `Desde el panel ves la agenda, cargás turnos y cambiás la configuración del local.`) +
      (n.vence_el ? `\n\nTu abono está activo hasta el ${fechaNum(n.vence_el)}.` : "");
    $("#btnWaMsg").href = "https://wa.me/?text=" + encodeURIComponent($("#creadoMsg").textContent);
    U.icons();
    if (!$("#modalCreado").open) { $(".acceso__msg").open = false; $("#modalCreado").showModal(); }
  }
  const copiar = async (txt, ok) => {
    try { await navigator.clipboard.writeText(txt); U.toast(ok); }
    catch (e) { U.toast("No se pudo copiar: seleccionalo a mano", "error"); }
  };
  $("#btnCopiarMsg").addEventListener("click", () => copiar($("#creadoMsg").textContent, "Mensaje copiado"));
  $("#accClaveNueva").addEventListener("click", async (e) => {
    const { n, email, nuevo } = accesoActual;
    if (!confirm(`¿Generar una contraseña nueva para ${email}?\n\nLa anterior deja de funcionar y se cierran sus sesiones abiertas.`)) return;
    const btn = e.currentTarget; btn.disabled = true;
    try { const clave = await DB.superResetClave(n.id); mostrarCreado(n, email, nuevo, clave); U.toast("Contraseña nueva generada"); }
    catch (ex) { U.toast(ex.message, "error"); }
    finally { btn.disabled = false; }
  });
  $("#modalCreado").addEventListener("click", (e) => {
    const b = e.target.closest("[data-copiar]"); if (!b) return;
    copiar($("#" + b.dataset.copiar).textContent, "Copiado");
  });

  $$("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  $$("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

  arrancar();
})();
