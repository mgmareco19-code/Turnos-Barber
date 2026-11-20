/* Página pública: flujo de reserva en 4 pasos + «Mi turno» (ver, cambiar o cancelar) */
(() => {
  const cfg = window.APP_CONFIG;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const estado = {
    paso: 1, servicios: [] /* elegidos, en el orden de la lista */, barbero: null /* null = sin preferencia */, fecha: null, hora: null,
    cambio: null, // turno que el cliente está cambiando de día u hora (null = reserva nueva)
  };
  let servicios = [], barberos = [];
  let listo = Promise.resolve();   // carga de servicios y barberos
  let pedidoHorarios = 0;

  /* ---------- Inicio: qué local es (?local=slug) y si viene un turno (&turno=id) ---------- */
  const N = U.neg;
  const qs = new URLSearchParams(location.search);
  const slug = (qs.get("local") || "").trim().toLowerCase();
  const turnoParam = (qs.get("turno") || "").trim();
  $("#demoBadge").hidden = DB.modo !== "demo";

  /** Muestra una sola de las vistas principales */
  function mostrar(vista) {
    ["aviso", "miTurno", "buscarTurno", "flujo"].forEach((id) => ($("#" + id).hidden = id !== vista));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function aviso(icono, titulo, texto, extra = "") {
    mostrar("aviso");
    $("#aviso").innerHTML = `<div class="aviso__icon"><i data-lucide="${icono}"></i></div>
      <h1 class="aviso__titulo">${titulo}</h1><p class="muted">${texto}</p>${extra}`;
    U.icons();
  }

  async function sinLocal() {
    $("#logoNombre").innerHTML = U.logoHtml(cfg.plataforma.nombre);
    // Sin link de un local (la dirección principal): la página de ventas
    if (DB.modo !== "demo") return location.replace("ventas.html");
    const locales = await DB.localesDemo();
    aviso("store", "Elegí una barbería", "Modo demo: cada local tiene su propio link de reservas.",
      `<div class="locales">${locales.map((l) => `<a class="option" href="?local=${encodeURIComponent(l.slug)}">
        <span class="logo-thumb">${l.logo ? `<img src="${U.esc(l.logo)}" alt="">` : '<i data-lucide="scissors"></i>'}</span>
        <span class="option__body"><strong>${U.esc(l.nombre)}</strong><small>?local=${U.esc(l.slug)}</small></span>
        <i data-lucide="arrow-right"></i></a>`).join("")}</div>
      <p class="note">Los dueños entran por <a class="gold" href="admin.html">admin.html</a> y vos administrás los locales en <a class="gold" href="superadmin.html">superadmin.html</a>.</p>`);
  }

  const avisoPausado = () => aviso("calendar-off", "Reservas online pausadas", `${U.esc(N.nombre)} no está recibiendo reservas online en este momento.` +
    (N.whatsapp ? " Escribiles por WhatsApp para pedir tu turno." : ""),
    `<div class="success__actions">${N.whatsapp ? `<a class="btn btn--gold" target="_blank" rel="noopener" href="${U.waLink(N.whatsapp, `Hola ${N.nombre}, quiero pedir un turno.`)}"><i data-lucide="message-circle"></i>ESCRIBIR POR WHATSAPP</a>` : ""}
      <button type="button" class="btn btn--ghost" data-ir-buscar><i data-lucide="calendar-search"></i>YA TENGO TURNO</button></div>`);

  async function init() {
    if (!slug) return sinLocal();
    let n;
    try { n = await DB.negocioPorSlug(slug); }
    catch (e) { return aviso("wifi-off", "Sin conexión", `No pudimos cargar la barbería. ${U.esc(e.message)}`); }
    if (!n) {
      $("#logoNombre").innerHTML = U.logoHtml(cfg.plataforma.nombre);
      return aviso("search-x", "Este link no existe", "Revisá que el link esté bien escrito o pedíselo de nuevo a la barbería.");
    }
    U.setNegocio(n); DB.usar(n.id);
    document.title = `Reservá tu turno | ${n.nombre}`;
    $("#logoLink").innerHTML = U.marcaHtml(n);
    U.setFavicon(n.logo);
    $("#heroLogo").hidden = !n.logo;
    if (n.logo) { $("#heroLogo").src = n.logo; $("#heroLogo").alt = n.nombre; }
    U.icons();
    $("#logoLink").href = `?local=${encodeURIComponent(n.slug)}`;
    $("#direccion").textContent = n.direccion || "";
    $("#direccionBox").hidden = !n.direccion;
    $("#waTop").hidden = !n.whatsapp;
    if (n.whatsapp) $("#waTop").href = U.waLink(n.whatsapp, `Hola ${n.nombre}, tengo una consulta.`);

    listo = Promise.all([DB.servicios(), DB.barberos()]).then(([s, b]) => { servicios = s; barberos = b; });
    listo.catch(() => { /* se muestra donde se usa */ });

    if (turnoParam) return abrirMiTurno(turnoParam);
    if (!n.estado.reserva) return avisoPausado();
    irReserva();
  }

  /** Vuelve al paso 1 de una reserva nueva */
  async function irReserva() {
    setTurnoEnUrl(null);
    confirmandoCancel = false;
    if (estado.cambio) salirCambio();
    if (!N.estado.reserva) return avisoPausado();
    mostrar("flujo");
    estado.barbero = undefined;
    cabecera(); renderRecordado();
    irA(1);
    try { await listo; renderServicios(); }
    catch (e) {
      $("#listaServicios").innerHTML = `<p class="empty"><i data-lucide="wifi-off"></i>No pudimos cargar los servicios. ${U.esc(e.message)}</p>`;
      U.icons();
    }
  }

  /* ---------- Navegación entre pasos ---------- */
  function irA(paso) {
    estado.paso = paso;
    $$("[data-panel]").forEach((p) => (p.hidden = Number(p.dataset.panel) !== paso));
    $("#exito").hidden = true;
    $("#steps").hidden = false;
    $("#accesoMiTurno").hidden = Boolean(estado.cambio);
    $$("#steps li").forEach((li) => {
      const n = Number(li.dataset.step);
      li.classList.toggle("is-active", n === paso);
      li.classList.toggle("is-done", n < paso);
      li.querySelector("button").disabled = n > maxPaso() || (estado.cambio && n === 1); // al cambiar, los servicios quedan iguales
      li.querySelector("button").setAttribute("aria-current", n === paso ? "step" : "false");
    });
    if (paso === 2) renderBarberos();
    if (paso === 3) renderDias();
    if (paso === 4) renderResumen();
    const h = document.querySelector(`[data-panel="${paso}"] h2`);
    h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const maxPaso = () => (!estado.servicios.length ? 1 : estado.barbero === undefined ? 2 : !estado.hora ? 3 : 4);

  $$("#steps button").forEach((b) => b.addEventListener("click", () => irA(Number(b.closest("li").dataset.step))));
  $$("[data-back]").forEach((b) => b.addEventListener("click", () => {
    if (estado.cambio && estado.paso <= 2) return volverAMiTurno();
    irA(estado.paso - 1);
  }));
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-ir-reserva]")) irReserva();
    else if (e.target.closest("[data-ir-buscar]")) { mostrar("buscarTurno"); setTimeout(() => $("#formBuscar").codigo.focus(), 50); }
  });

  /** Textos de arriba según sea una reserva nueva o un cambio de turno */
  function cabecera() {
    const c = Boolean(estado.cambio);
    $("#headEyebrow").textContent = c ? `Código ${estado.cambio.codigo}` : "Turnos online";
    $("#headTitulo").innerHTML = c ? 'Cambiá tu <span class="gold">turno</span>' : 'Reservá tu <span class="gold">turno</span>';
    $("#headTexto").textContent = c ? "Elegí el nuevo día y horario. Los servicios quedan iguales."
      : "Elegí uno o varios servicios, barbero y horario. Te confirmamos por WhatsApp.";
    $("#t4").textContent = c ? "Confirmá el cambio" : "Confirmá tu reserva";
    $('#steps li[data-step="4"] em').textContent = c ? "Confirmar" : "Tus datos";
    $("#camposDatos").disabled = c; $("#camposDatos").hidden = c;
    $("#notaCambio").hidden = !c;
    $("#btnReservar").innerHTML = `<i data-lucide="calendar-check"></i>${c ? "CONFIRMAR CAMBIO" : "CONFIRMAR TURNO"}`;
    $("#formError").hidden = true;
    U.icons();
  }

  /* ---------- Paso 1: servicios (uno o varios) ---------- */
  const totalDur = () => estado.servicios.reduce((a, s) => a + s.duracion, 0);
  const totalPrecio = () => estado.servicios.reduce((a, s) => a + s.precio, 0);
  const nombresServicios = () => estado.servicios.map((s) => s.nombre).join(" + ");
  const elegido = (id) => estado.servicios.some((s) => s.id === id);

  function renderServicios() {
    $("#listaServicios").innerHTML = servicios.map((s) => `
      <button type="button" class="option option--check ${elegido(s.id) ? "is-selected" : ""}" data-id="${s.id}"
        role="listitem" aria-pressed="${elegido(s.id)}">
        <span class="check" aria-hidden="true"><i data-lucide="check"></i></span>
        <span class="option__body">
          <strong>${U.esc(s.nombre)}</strong>
          ${s.descripcion ? `<small>${U.esc(s.descripcion)}</small>` : ""}
          <span class="option__meta"><i data-lucide="clock"></i>${U.durTxt(s.duracion)}<b class="price-inline">· ${U.gs(s.precio)}</b></span>
        </span>
        <span class="price">${U.gs(s.precio)}</span>
      </button>`).join("") || `<p class="empty">No hay servicios cargados todavía.</p>`;
    renderBarra();
    U.icons();
  }
  function renderBarra() {
    const n = estado.servicios.length;
    $("#barraServicios").hidden = !n;
    if (!n) return;
    $("#barraTexto").innerHTML = `<strong>${n} servicio${n === 1 ? "" : "s"}</strong>
      <span>${U.durTxt(totalDur())} · <b class="gold">${U.gs(totalPrecio())}</b></span>`;
  }
  $("#listaServicios").addEventListener("click", (e) => {
    const b = e.target.closest(".option"); if (!b) return;
    const id = Number(b.dataset.id);
    if (elegido(id)) estado.servicios = estado.servicios.filter((s) => s.id !== id);
    else if (estado.servicios.length >= DB.MAX_SERVICIOS) return U.toast(`Podés elegir hasta ${DB.MAX_SERVICIOS} servicios por turno.`, "error");
    else estado.servicios = servicios.filter((s) => s.id === id || elegido(s.id)); // mantiene el orden de la lista
    estado.hora = null; // cambia la duración: hay que volver a elegir horario
    const y = b.getBoundingClientRect().top;
    renderServicios();
    // mantener el foco y la posición en el botón tocado
    const nb = $(`#listaServicios .option[data-id="${id}"]`); nb?.focus({ preventScroll: true });
    if (nb) window.scrollBy(0, nb.getBoundingClientRect().top - y);
    $$("#steps li").forEach((li) => (li.querySelector("button").disabled = Number(li.dataset.step) > maxPaso()));
  });
  $("#btnContinuar").addEventListener("click", () => estado.servicios.length && irA(2));

  /* ---------- Paso 2: barbero ---------- */
  function renderBarberos() {
    if (!barberos.length) {
      $("#listaBarberos").innerHTML = `<p class="empty"><i data-lucide="calendar-x"></i>Por ahora no hay barberos disponibles para reservar online.</p>`;
      return U.icons();
    }
    const ini = (n) => n.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
    const opts = [{ id: null, nombre: "Sin preferencia", especialidad: "El primero disponible" }, ...barberos];
    $("#listaBarberos").innerHTML = opts.map((b) => `
      <button type="button" class="option option--barber ${estado.barbero === b.id ? "is-selected" : ""}" data-id="${b.id ?? ""}" role="listitem">
        <span class="avatar ${b.id === null ? "avatar--any" : ""}">${b.id === null ? '<i data-lucide="users"></i>' :
          b.foto ? `<img src="${U.esc(b.foto)}" alt="">` : ini(b.nombre)}</span>
        <span class="option__body"><strong>${U.esc(b.nombre)}</strong>${b.especialidad ? `<small>${U.esc(b.especialidad)}</small>` : ""}</span>
      </button>`).join("");
    U.icons();
  }
  $("#listaBarberos").addEventListener("click", (e) => {
    const b = e.target.closest(".option"); if (!b) return;
    estado.barbero = b.dataset.id ? Number(b.dataset.id) : null;
    estado.hora = null;
    irA(3);
  });

  /* ---------- Paso 3: día y hora ---------- */
  function renderDias() {
    const dias = [];
    for (let i = 0; i < (N.dias_anticipacion || 21); i++) dias.push(U.addDays(U.hoy(), i));
    const abiertos = dias.filter((d) => U.horarioDe(d));
    if (!estado.fecha || !abiertos.includes(estado.fecha)) estado.fecha = abiertos[0];
    $("#dias").innerHTML = dias.map((d) => {
      const f = U.fechaCorta(d), cerrado = !U.horarioDe(d), motivo = U.cierreDe(d)?.motivo;
      return `<button type="button" role="option" class="day ${d === estado.fecha ? "is-selected" : ""}" data-fecha="${d}"
        ${cerrado ? `disabled aria-label="Cerrado${motivo ? ": " + U.esc(motivo) : ""}" title="Cerrado${motivo ? ": " + U.esc(motivo) : ""}"` : ""} aria-selected="${d === estado.fecha}">
        <small>${d === U.hoy() ? "Hoy" : f.dia}</small><strong>${f.num}</strong><small>${cerrado ? "cerrado" : f.mes}</small></button>`;
    }).join("");
    $("#dias .is-selected")?.scrollIntoView({ inline: "center", block: "nearest" });
    renderHorarios();
  }
  $("#dias").addEventListener("click", (e) => {
    const b = e.target.closest(".day"); if (!b || b.disabled) return;
    estado.fecha = b.dataset.fecha; estado.hora = null;
    $$("#dias .day").forEach((d) => { d.classList.toggle("is-selected", d === b); d.setAttribute("aria-selected", d === b); });
    renderHorarios();
  });

  /** Al cambiar un turno, su horario actual se marca (elegirlo no cambiaría nada) */
  const esActual = (hora) => {
    const t = estado.cambio;
    return Boolean(t) && estado.fecha === t.fecha && hora === t.hora && (!estado.barbero || estado.barbero === t.barbero_id);
  };

  async function renderHorarios() {
    const id = ++pedidoHorarios;
    const box = $("#horarios");
    $("#diaTitulo").textContent = estado.fecha ? U.fechaLarga(estado.fecha) : "";
    if (!estado.fecha) { box.innerHTML = `<p class="empty">No hay días disponibles.</p>`; return; }
    box.innerHTML = Array(8).fill('<span class="skeleton skeleton--time"></span>').join("");
    try {
      // al cambiar, el propio turno no cuenta como ocupado (se puede correr media hora con el mismo barbero)
      const ocupados = await DB.ocupados(estado.fecha, estado.cambio?.id);
      if (id !== pedidoHorarios) return; // llegó una respuesta vieja
      const ids = estado.barbero ? [estado.barbero] : barberos.map((b) => b.id);
      const lista = U.slots(estado.fecha, totalDur(), ocupados, ids).filter((s) => !s.pasado);
      const libres = lista.filter((s) => s.libres.length && !esActual(s.hora));
      if (!libres.length) {
        box.innerHTML = `<p class="empty"><i data-lucide="calendar-x"></i>No quedan horarios este día. Probá con otro.</p>`;
      } else {
        box.innerHTML = lista.map((s) => esActual(s.hora)
          ? `<button type="button" class="time is-actual" disabled title="Tu turno actual" aria-label="${s.hora}, tu turno actual">${s.hora}<small>actual</small></button>`
          : `<button type="button" class="time ${s.hora === estado.hora ? "is-selected" : ""}"
          data-hora="${s.hora}" ${s.libres.length ? "" : "disabled aria-label=\"" + s.hora + " ocupado\""}>${s.hora}</button>`).join("");
      }
    } catch (e) {
      box.innerHTML = `<p class="empty">No pudimos cargar los horarios. ${U.esc(e.message)}</p>`;
    }
    U.icons();
  }
  $("#horarios").addEventListener("click", (e) => {
    const b = e.target.closest(".time"); if (!b || b.disabled) return;
    estado.hora = b.dataset.hora;
    irA(4);
  });

  /* ---------- Paso 4: datos (o confirmación del cambio) ---------- */
  const nombreBarbero = (id) => (id ? barberos.find((b) => b.id === id)?.nombre : "Sin preferencia");
  const filasResumen = (barberoId, antes = null) => `
    ${antes ? `<div class="summary__antes"><dt><i data-lucide="history"></i>Antes</dt>
      <dd><s>${U.fechaLarga(antes.fecha)}, ${antes.hora} hs</s><small>con ${U.esc(antes.barbero?.nombre || "")}</small></dd></div>` : ""}
    <div><dt><i data-lucide="scissors"></i>${estado.servicios.length > 1 ? "Servicios" : "Servicio"}</dt>
      <dd>${estado.servicios.map((s) => `<span class="dd-line">${U.esc(s.nombre)}${estado.servicios.length > 1 ? ` <small>${U.gs(s.precio)}</small>` : ""}</span>`).join("")}</dd></div>
    <div><dt><i data-lucide="user"></i>Barbero</dt><dd>${U.esc(nombreBarbero(barberoId))}</dd></div>
    <div><dt><i data-lucide="calendar"></i>Día</dt><dd>${U.fechaLarga(estado.fecha)}</dd></div>
    <div><dt><i data-lucide="clock"></i>Hora</dt><dd>${estado.hora} hs · ${U.durTxt(totalDur())}</dd></div>
    <div><dt><i data-lucide="wallet"></i>${estado.servicios.length > 1 ? "Total" : "Precio"}</dt><dd class="gold">${U.gs(totalPrecio())}</dd></div>`;
  function renderResumen() { $("#resumen").innerHTML = filasResumen(estado.barbero, estado.cambio); U.icons(); }

  $("#formDatos").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, err = $("#formError");
    err.hidden = true;
    if (!f.checkValidity()) {
      f.querySelector(":invalid").focus();
      err.textContent = "Completá tu nombre y un número de celular válido.";
      err.hidden = false; return;
    }
    const btn = $("#btnReservar");
    btn.disabled = true; btn.classList.add("is-loading");
    try {
      if (estado.cambio) {
        const antes = estado.cambio;
        const t = await DB.reprogramarTurno(antes.id, { fecha: estado.fecha, hora: estado.hora, barbero_id: estado.barbero });
        mostrarExito(t, null, antes);
      } else {
        const datos = Object.fromEntries(new FormData(f));
        const r = await DB.reservar({ servicio_ids: estado.servicios.map((s) => s.id), barbero_id: estado.barbero, fecha: estado.fecha, hora: estado.hora, ...datos });
        mostrarExito(r, datos);
        f.reset();
      }
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      if (estado.cambio) renderHorarios(); // el horario se pudo haber ocupado: refrescar
    } finally {
      btn.disabled = false; btn.classList.remove("is-loading");
    }
  });

  function mostrarExito(r, datos, antes = null) {
    $$("[data-panel]").forEach((p) => (p.hidden = true));
    $("#steps").hidden = true;
    $("#exito").hidden = false;
    $("#accesoMiTurno").hidden = true;
    $("#exitoTitulo").textContent = antes ? "¡Turno cambiado!" : "¡Turno reservado!";
    $("#codigo").textContent = r.codigo;
    $("#resumenFinal").innerHTML = filasResumen(r.barbero_id, antes);
    const msg = antes
      ? `Hola! Cambié mi turno en ${N.nombre} (código ${r.codigo}):\n` +
        `• Antes: ${U.fechaLarga(antes.fecha)} a las ${antes.hora} hs\n` +
        `• Ahora: ${U.fechaLarga(estado.fecha)} a las ${estado.hora} hs con ${nombreBarbero(r.barbero_id)}`
      : `Hola! Reservé un turno en ${N.nombre}:\n` +
        `• ${nombresServicios()} con ${nombreBarbero(r.barbero_id)}\n` +
        `• ${U.fechaLarga(estado.fecha)} a las ${estado.hora} hs\n` +
        `• A nombre de ${datos.nombre.trim()}\nCódigo: ${r.codigo}`;
    $("#waConfirmar").hidden = !N.whatsapp;
    if (N.whatsapp) $("#waConfirmar").href = U.waLink(N.whatsapp, msg);
    const link = U.linkTurno(N.slug, r.id);
    $("#linkMiTurno").href = link;
    $("#linkMiTurno").textContent = link.replace(/^[a-z]+:\/\/\/?/, "");
    recordar({ id: r.id, fecha: estado.fecha, hora: estado.hora });
    U.icons();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $("#nuevaReserva").addEventListener("click", () => {
    Object.assign(estado, { servicios: [], barbero: undefined, hora: null });
    irReserva();
  });
  $("#copiarLink").addEventListener("click", async () => {
    const url = $("#linkMiTurno").href;
    try { await navigator.clipboard.writeText(url); U.toast("Link copiado. Guardalo para cambiar o cancelar tu turno."); }
    catch (e) { window.prompt("Copiá tu link:", url); }
  });

  /* ================= MI TURNO ================= */
  /* Turnos reservados desde este navegador (solo para mostrar el aviso «Tenés un turno…») */
  const MIS = "tb_mis_turnos";
  const misTurnos = () => { try { return JSON.parse(localStorage.getItem(MIS)) || []; } catch (e) { return []; } };
  const guardarMis = (l) => { try { localStorage.setItem(MIS, JSON.stringify(l.slice(-10))); } catch (e) { /* sin storage */ } };
  const recordar = (t) => guardarMis([...misTurnos().filter((x) => x.id !== t.id), { slug, id: t.id, fecha: t.fecha, hora: t.hora }]);
  const olvidar = (id) => guardarMis(misTurnos().filter((x) => x.id !== id));

  function renderRecordado() {
    const r = !estado.cambio && misTurnos().filter((x) => x.slug === slug && x.fecha >= U.hoy())
      .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora))[0];
    const el = $("#recordado");
    el.hidden = !r;
    if (!r) return;
    el.href = `?local=${encodeURIComponent(slug)}&turno=${encodeURIComponent(r.id)}`;
    el.dataset.id = r.id;
    el.innerHTML = `<i data-lucide="calendar-check"></i>
      <span>Tenés un turno el <b>${U.fechaLarga(r.fecha)}</b> a las <b>${r.hora} hs</b></span>
      <em>Ver o cambiar<i data-lucide="arrow-right"></i></em>`;
    U.icons();
  }
  $("#recordado").addEventListener("click", (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault(); abrirMiTurno($("#recordado").dataset.id);
  });

  function setTurnoEnUrl(id) {
    try {
      const u = new URL(location.href);
      if (id) u.searchParams.set("turno", id); else u.searchParams.delete("turno");
      history.replaceState(null, "", u);
    } catch (e) { /* algunos navegadores no dejan en file:// */ }
  }

  async function abrirMiTurno(id) {
    mostrar("miTurno");
    $("#miTurno").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    let t;
    try { t = await DB.miTurno({ id }); }
    catch (e) {
      return aviso("wifi-off", "Sin conexión", `No pudimos cargar tu turno. ${U.esc(e.message)}`,
        `<div class="success__actions"><a class="btn btn--gold" href="${U.esc(location.href)}"><i data-lucide="refresh-cw"></i>PROBAR DE NUEVO</a></div>`);
    }
    if (!t) {
      olvidar(id); setTurnoEnUrl(null);
      return aviso("search-x", "No encontramos tu turno", "El link no es válido o el turno ya no existe. Podés buscarlo con tu código de reserva.",
        `<div class="success__actions"><button type="button" class="btn btn--gold" data-ir-buscar><i data-lucide="search"></i>BUSCAR CON MI CÓDIGO</button>
          <button type="button" class="btn btn--ghost" data-ir-reserva>HACER UNA RESERVA</button></div>`);
    }
    renderMiTurno(t);
  }

  const ESTADO_CLIENTE = {
    pendiente: ["hourglass", "Reservado · falta que el local lo confirme"],
    confirmado: ["badge-check", "Confirmado"],
    completado: ["check-circle-2", "Atendido"],
    ausente: ["user-x", "No asististe"],
    cancelado: ["x-circle", "Cancelado"],
  };
  let turnoVisto = null, confirmandoCancel = false;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /** msg: "cancelado" justo después de cancelar */
  function renderMiTurno(t, msg = "") {
    turnoVisto = t;
    mostrar("miTurno");
    setTurnoEnUrl(t.id);
    const activo = ["pendiente", "confirmado"].includes(t.estado);
    if (activo && t.fecha >= U.hoy()) recordar(t); else olvidar(t.id);
    const [icono, txt] = ESTADO_CLIENTE[t.estado] || ["info", t.estado];
    const max = t.max_cambios ?? 3, quedan = max - (t.cambios || 0);
    const cuando = `${U.fechaLarga(t.fecha)} a las ${t.hora} hs`;
    const wa = (texto, etiqueta, cls = "btn--ghost") => N.whatsapp
      ? `<a class="btn ${cls}" target="_blank" rel="noopener" href="${U.waLink(N.whatsapp, texto)}"><i data-lucide="message-circle"></i>${etiqueta}</a>` : "";
    const waCambio = wa(`Hola ${N.nombre}! Tengo un turno el ${cuando} (código ${t.codigo}) y necesito cambiarlo.`, "ESCRIBIR POR WHATSAPP");

    let acciones;
    if (t.editable && confirmandoCancel) {
      acciones = `<div class="mi-turno__confirmar" role="alert">
          <p><strong>¿Seguro que querés cancelar este turno?</strong><br>El horario queda libre para otra persona.</p>
          <div class="success__actions">
            <button type="button" class="btn btn--danger" data-accion="cancelar-si"><i data-lucide="calendar-x"></i>SÍ, CANCELAR</button>
            <button type="button" class="btn btn--ghost" data-accion="cancelar-no">NO, VOLVER</button>
          </div></div>`;
    } else if (t.editable) {
      const puedeCambiar = quedan > 0 && N.estado.reserva;
      const notas = [`Podés cambiarlo o cancelarlo hasta ${U.durTxt(N.margen_minutos ?? 30)} antes.`];
      if (!N.estado.reserva) notas.push("Los cambios online están pausados: podés cancelarlo o escribirnos.");
      else if (quedan <= 0) notas.push(`Ya lo cambiaste ${max} veces: para otro cambio, escribinos por WhatsApp.`);
      else if (t.cambios) notas.push(`Te ${quedan === 1 ? "queda 1 cambio" : `quedan ${quedan} cambios`}.`);
      acciones = `<div class="success__actions">
          ${puedeCambiar ? `<button type="button" class="btn btn--gold" data-accion="cambiar"><i data-lucide="calendar-clock"></i>CAMBIAR DÍA U HORA</button>` : waCambio}
          <button type="button" class="btn btn--danger" data-accion="cancelar"><i data-lucide="calendar-x"></i>CANCELAR TURNO</button>
        </div>
        <p class="note">${notas.join(" ")}</p>`;
    } else if (activo && t.fecha >= U.hoy()) {
      acciones = `<p class="mi-turno__info"><i data-lucide="clock-alert"></i>Falta poco para tu turno: ya no se puede cambiar desde acá. Si necesitás algo, escribinos.</p>
        <div class="success__actions">${waCambio}</div>`;
    } else if (t.estado === "cancelado") {
      acciones = `<p class="mi-turno__info"><i data-lucide="info"></i>${msg === "cancelado" ? "Listo, tu turno quedó cancelado." : "Este turno está cancelado."}</p>
        <div class="success__actions">
          ${msg === "cancelado" ? wa(`Hola ${N.nombre}! Cancelé mi turno del ${cuando} (código ${t.codigo}). ¡Gracias!`, "AVISAR AL LOCAL") : ""}
          ${N.estado.reserva ? `<button type="button" class="btn btn--gold" data-ir-reserva><i data-lucide="calendar-plus"></i>RESERVAR OTRO TURNO</button>` : ""}
        </div>`;
    } else {
      acciones = `<p class="mi-turno__info"><i data-lucide="info"></i>Este turno ya pasó.</p>
        <div class="success__actions">${N.estado.reserva ? `<button type="button" class="btn btn--gold" data-ir-reserva><i data-lucide="calendar-plus"></i>RESERVAR OTRO TURNO</button>` : ""}</div>`;
    }

    const items = t.items || [];
    $("#miTurno").innerHTML = `
      <p class="eyebrow">Tu turno · ${U.esc(N.nombre)}</p>
      <h1 class="mi-turno__fecha ${t.estado === "cancelado" ? "is-cancel" : ""}">${cap(U.fechaLarga(t.fecha))}<span class="gold">${t.hora} hs</span></h1>
      <span class="pill pill--${t.estado}"><i data-lucide="${icono}"></i>${txt}</span>
      <dl class="summary">
        <div><dt><i data-lucide="scissors"></i>${items.length > 1 ? "Servicios" : "Servicio"}</dt>
          <dd>${items.map((i) => `<span class="dd-line">${U.esc(i.nombre)}${items.length > 1 ? ` <small>${U.gs(i.precio)}</small>` : ""}</span>`).join("")}</dd></div>
        <div><dt><i data-lucide="user"></i>Barbero</dt><dd>${U.esc(t.barbero?.nombre || "")}</dd></div>
        <div><dt><i data-lucide="clock"></i>Duración</dt><dd>${U.durTxt(t.duracion)}</dd></div>
        <div><dt><i data-lucide="wallet"></i>${items.length > 1 ? "Total" : "Precio"}</dt><dd class="gold">${U.gs(t.precio)}</dd></div>
        <div><dt><i data-lucide="hash"></i>Código</dt><dd>${U.esc(t.codigo)}</dd></div>
      </dl>
      ${acciones}
      ${N.direccion ? `<p class="note mi-turno__dir"><i data-lucide="map-pin"></i>${U.esc(N.direccion)}</p>` : ""}
      <div class="panel__nav"><button type="button" class="btn btn--text" data-ir-reserva><i data-lucide="plus"></i>Hacer otra reserva</button></div>`;
    U.icons();
  }

  $("#miTurno").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-accion]"); if (!b || !turnoVisto) return;
    const accion = b.dataset.accion;
    if (accion === "cambiar") return iniciarCambio(turnoVisto);
    if (accion === "cancelar" || accion === "cancelar-no") {
      confirmandoCancel = accion === "cancelar";
      renderMiTurno(turnoVisto);
      return $(confirmandoCancel ? "#miTurno [data-accion=cancelar-no]" : "#miTurno [data-accion=cancelar]")?.focus();
    }
    if (accion === "cancelar-si") {
      b.disabled = true; b.classList.add("is-loading");
      try {
        const t = await DB.cancelarTurno(turnoVisto.id);
        confirmandoCancel = false;
        renderMiTurno(t, "cancelado");
        U.toast("Tu turno quedó cancelado.");
      } catch (ex) {
        U.toast(ex.message, "error");
        confirmandoCancel = false;
        abrirMiTurno(turnoVisto.id); // volver a leer cómo quedó
      }
    }
  });

  /* ---------- Cambiar de día u hora: se reusan los pasos 2 a 4 ---------- */
  async function iniciarCambio(t) {
    try { await listo; }
    catch (e) { return U.toast("No pudimos cargar los horarios. Probá de nuevo.", "error"); }
    estado.cambio = t;
    estado.servicios = (t.items || []).map((i) => ({ id: i.servicio_id, nombre: i.nombre, precio: i.precio, duracion: i.duracion }));
    estado.barbero = barberos.some((b) => b.id === t.barbero_id) ? t.barbero_id : null;
    estado.fecha = t.fecha; estado.hora = null;
    $("#recordado").hidden = true;
    mostrar("flujo");
    cabecera();
    irA(3);
  }
  function salirCambio() {
    Object.assign(estado, { cambio: null, servicios: [], barbero: undefined, hora: null });
    cabecera();
    if (servicios.length) renderServicios();
  }
  function volverAMiTurno() {
    const t = estado.cambio;
    salirCambio();
    renderMiTurno(t);
  }

  /* ---------- Buscar con código + celular ---------- */
  $("#formBuscar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, err = $("#buscarError"), btn = $("#btnBuscar");
    err.hidden = true;
    if (!f.checkValidity()) {
      f.querySelector(":invalid").focus();
      err.textContent = "Ingresá tu código de reserva y tu celular.";
      err.hidden = false; return;
    }
    btn.disabled = true; btn.classList.add("is-loading");
    try {
      const t = await DB.miTurno({ codigo: f.codigo.value.trim().toUpperCase(), telefono: f.telefono.value });
      if (!t) throw new Error("No encontramos un turno con ese código y ese celular. Revisá los datos.");
      f.reset(); confirmandoCancel = false;
      renderMiTurno(t);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { btn.disabled = false; btn.classList.remove("is-loading"); }
  });

  init();
})();
