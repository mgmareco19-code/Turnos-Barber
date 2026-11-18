/* Página pública: flujo de reserva en 4 pasos */
(() => {
  const cfg = window.APP_CONFIG;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const estado = { paso: 1, servicios: [] /* elegidos, en el orden de la lista */, barbero: null /* null = sin preferencia */, fecha: null, hora: null };
  let servicios = [], barberos = [];
  let pedidoHorarios = 0;

  /* ---------- Inicio ---------- */
  $("#direccion").textContent = cfg.negocio.direccion;
  $("#waTop").href = U.waLink(cfg.negocio.whatsapp, `Hola ${cfg.negocio.nombreCompleto}, tengo una consulta.`);
  $("#demoBadge").hidden = DB.modo !== "demo";

  async function init() {
    try {
      [servicios, barberos] = await Promise.all([DB.servicios(), DB.barberos()]);
      renderServicios();
    } catch (e) {
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
    $$("#steps li").forEach((li) => {
      const n = Number(li.dataset.step);
      li.classList.toggle("is-active", n === paso);
      li.classList.toggle("is-done", n < paso);
      li.querySelector("button").disabled = n > maxPaso();
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
  $$("[data-back]").forEach((b) => b.addEventListener("click", () => irA(estado.paso - 1)));

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
    for (let i = 0; i < cfg.diasAnticipacion; i++) dias.push(U.addDays(U.hoy(), i));
    const abiertos = dias.filter((d) => U.horarioDe(d));
    if (!estado.fecha || !abiertos.includes(estado.fecha)) estado.fecha = abiertos[0];
    $("#dias").innerHTML = dias.map((d) => {
      const f = U.fechaCorta(d), cerrado = !U.horarioDe(d);
      return `<button type="button" role="option" class="day ${d === estado.fecha ? "is-selected" : ""}" data-fecha="${d}"
        ${cerrado ? 'disabled aria-label="Cerrado"' : ""} aria-selected="${d === estado.fecha}">
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

  async function renderHorarios() {
    const id = ++pedidoHorarios;
    const box = $("#horarios");
    $("#diaTitulo").textContent = estado.fecha ? U.fechaLarga(estado.fecha) : "";
    if (!estado.fecha) { box.innerHTML = `<p class="empty">No hay días disponibles.</p>`; return; }
    box.innerHTML = Array(8).fill('<span class="skeleton skeleton--time"></span>').join("");
    try {
      const ocupados = await DB.ocupados(estado.fecha);
      if (id !== pedidoHorarios) return; // llegó una respuesta vieja
      const ids = estado.barbero ? [estado.barbero] : barberos.map((b) => b.id);
      const lista = U.slots(estado.fecha, totalDur(), ocupados, ids).filter((s) => !s.pasado);
      const libres = lista.filter((s) => s.libres.length);
      if (!libres.length) {
        box.innerHTML = `<p class="empty"><i data-lucide="calendar-x"></i>No quedan horarios este día. Probá con otro.</p>`;
      } else {
        box.innerHTML = lista.map((s) => `<button type="button" class="time ${s.hora === estado.hora ? "is-selected" : ""}"
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

  /* ---------- Paso 4: datos ---------- */
  const nombreBarbero = (id) => (id ? barberos.find((b) => b.id === id)?.nombre : "Sin preferencia");
  const filasResumen = (barberoId) => `
    <div><dt><i data-lucide="scissors"></i>${estado.servicios.length > 1 ? "Servicios" : "Servicio"}</dt>
      <dd>${estado.servicios.map((s) => `<span class="dd-line">${U.esc(s.nombre)}${estado.servicios.length > 1 ? ` <small>${U.gs(s.precio)}</small>` : ""}</span>`).join("")}</dd></div>
    <div><dt><i data-lucide="user"></i>Barbero</dt><dd>${U.esc(nombreBarbero(barberoId))}</dd></div>
    <div><dt><i data-lucide="calendar"></i>Día</dt><dd>${U.fechaLarga(estado.fecha)}</dd></div>
    <div><dt><i data-lucide="clock"></i>Hora</dt><dd>${estado.hora} hs · ${U.durTxt(totalDur())}</dd></div>
    <div><dt><i data-lucide="wallet"></i>${estado.servicios.length > 1 ? "Total" : "Precio"}</dt><dd class="gold">${U.gs(totalPrecio())}</dd></div>`;
  function renderResumen() { $("#resumen").innerHTML = filasResumen(estado.barbero); U.icons(); }

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
      const datos = Object.fromEntries(new FormData(f));
      const r = await DB.reservar({ servicio_ids: estado.servicios.map((s) => s.id), barbero_id: estado.barbero, fecha: estado.fecha, hora: estado.hora, ...datos });
      mostrarExito(r, datos);
      f.reset();
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
    } finally {
      btn.disabled = false; btn.classList.remove("is-loading");
    }
  });

  function mostrarExito(r, datos) {
    $$("[data-panel]").forEach((p) => (p.hidden = true));
    $("#steps").hidden = true;
    $("#exito").hidden = false;
    $("#codigo").textContent = r.codigo;
    $("#resumenFinal").innerHTML = filasResumen(r.barbero_id);
    const msg = `Hola! Reservé un turno en ${cfg.negocio.nombreCompleto}:\n` +
      `• ${nombresServicios()} con ${nombreBarbero(r.barbero_id)}\n` +
      `• ${U.fechaLarga(estado.fecha)} a las ${estado.hora} hs\n` +
      `• A nombre de ${datos.nombre.trim()}\nCódigo: ${r.codigo}`;
    $("#waConfirmar").href = U.waLink(cfg.negocio.whatsapp, msg);
    U.icons();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $("#nuevaReserva").addEventListener("click", () => {
    Object.assign(estado, { servicios: [], barbero: undefined, hora: null });
    renderServicios(); irA(1);
  });

  estado.barbero = undefined;
  irA(1);
  init();
})();
