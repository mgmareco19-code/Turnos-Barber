/* Panel de administración: agenda, estados y carga manual */
(() => {
  const cfg = window.APP_CONFIG;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const ESTADOS = {
    pendiente: { txt: "Pendiente", icon: "hourglass" },
    confirmado: { txt: "Confirmado", icon: "badge-check" },
    completado: { txt: "Atendido", icon: "check-circle-2" },
    ausente: { txt: "No vino", icon: "user-x" },
    cancelado: { txt: "Cancelado", icon: "x-circle" },
  };
  const ROW_H = 56; // px por intervalo en la agenda

  const st = { fecha: U.hoy(), barbero: "", vista: "agenda", turnos: [], servicios: [], barberos: [] };
  let timer = null;

  /* ---------- Sesión ---------- */
  async function arrancar() {
    const demo = DB.modo === "demo";
    $("#campoEmail").hidden = demo;
    $("#loginHint").hidden = !demo;
    if (await DB.esAdmin()) mostrarPanel(); else mostrarLogin();
  }
  function mostrarLogin() {
    $("#vistaPanel").hidden = true; $("#vistaLogin").hidden = false;
    clearInterval(timer); U.icons();
    $(DB.modo === "demo" ? "[name=password]" : "[name=email]", $("#formLogin")).focus();
  }
  async function mostrarPanel() {
    $("#vistaLogin").hidden = true; $("#vistaPanel").hidden = false;
    $("#modoBadge").textContent = DB.modo === "demo" ? "Modo demo" : "En línea";
    $("#modoBadge").className = "badge " + (DB.modo === "demo" ? "badge--warn" : "badge--ok");
    try {
      [st.servicios, st.barberos] = await Promise.all([DB.servicios(true), DB.barberos(true)]);
    } catch (e) { U.toast(e.message, "error"); }
    renderFiltro();
    await cargar();
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden && !$("dialog[open]")) cargar(true); }, 60000);
  }

  $("#formLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, err = $("#loginError"), btn = $("button[type=submit]", f);
    err.hidden = true; btn.disabled = true;
    try {
      await DB.login(f.email.value.trim(), f.password.value);
      f.reset(); mostrarPanel();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { btn.disabled = false; }
  });
  $("#btnSalir").addEventListener("click", async () => { await DB.logout(); mostrarLogin(); });

  /* ---------- Carga de datos ---------- */
  async function cargar(silencioso = false) {
    $("#diaTexto").textContent = (st.fecha === U.hoy() ? "Hoy, " : "") + U.fechaLarga(st.fecha);
    $("#diaInput").value = st.fecha;
    if (!silencioso) $("#agenda").classList.add("is-loading");
    try {
      st.turnos = await DB.turnos(st.fecha, st.fecha);
      render();
    } catch (e) { U.toast(e.message, "error"); }
    finally { $("#agenda").classList.remove("is-loading"); }
  }
  const activos = () => st.barberos.filter((b) => b.activo);
  function renderFiltro() {
    if (st.barbero && !st.barberos.some((b) => b.id === Number(st.barbero))) st.barbero = "";
    $("#filtroBarbero").innerHTML = '<option value="">Todos los barberos</option>' +
      st.barberos.map((b) => `<option value="${b.id}">${U.esc(b.nombre)}${b.activo ? "" : " (inactivo)"}</option>`).join("");
    $("#filtroBarbero").value = st.barbero;
    $("#cantBarberos").textContent = activos().length;
  }
  const visibles = () => st.turnos.filter((t) => !st.barbero || t.barbero_id === Number(st.barbero));

  function render() { renderKpis(); renderAgenda(); renderLista(); U.icons(); }

  /* ---------- KPIs ---------- */
  function renderKpis() {
    const ts = visibles(), activos = ts.filter((t) => t.estado !== "cancelado");
    const suma = (arr) => arr.reduce((a, t) => a + (t.servicio?.precio || 0), 0);
    const atendidos = ts.filter((t) => t.estado === "completado");
    const tiles = [
      ["calendar", "Turnos", activos.length, `${ts.length - activos.length} cancelados`],
      ["hourglass", "Por confirmar", ts.filter((t) => t.estado === "pendiente").length, "reservas web nuevas"],
      ["check-circle-2", "Atendidos", atendidos.length, `${ts.filter((t) => t.estado === "ausente").length} no vinieron`],
      ["wallet", "Ingresos", U.gs(suma(atendidos)), `estimado del día ${U.gs(suma(activos.filter((t) => t.estado !== "ausente")))}`],
    ];
    $("#kpis").innerHTML = tiles.map(([i, l, v, s]) => `
      <div class="kpi"><span class="kpi__icon"><i data-lucide="${i}"></i></span>
      <div><small>${l}</small><strong>${v}</strong><em>${s}</em></div></div>`).join("");
  }

  /* ---------- Agenda (columnas por barbero) ---------- */
  function renderAgenda() {
    const h = U.horarioDe(st.fecha) || ["09:00", "20:00"];
    const ts = visibles().filter((t) => t.estado !== "cancelado");
    let abre = U.toMin(h[0]), cierra = U.toMin(h[1]);
    ts.forEach((t) => { abre = Math.min(abre, U.toMin(t.hora)); cierra = Math.max(cierra, U.toMin(t.hora) + t.duracion); });
    abre = Math.floor(abre / cfg.intervalo) * cfg.intervalo;
    st.abre = abre;
    const filas = Math.ceil((cierra - abre) / cfg.intervalo);
    // Columnas: barberos activos + inactivos que igual tengan turnos ese día
    const cols = st.barberos.filter((b) => (b.activo || ts.some((t) => t.barbero_id === b.id)) &&
      (!st.barbero || b.id === Number(st.barbero)));
    if (!cols.length) {
      $("#agenda").innerHTML = `<p class="empty"><i data-lucide="users"></i>No hay barberos activos. Agregalos desde el botón <b>Barberos</b>.</p>`;
      return;
    }
    const px = (min) => ((min - abre) / cfg.intervalo) * ROW_H;

    const horas = Array.from({ length: filas }, (_, i) => `<span style="top:${i * ROW_H}px">${U.fromMin(abre + i * cfg.intervalo)}</span>`).join("");
    const ahora = new Date(), minAhora = ahora.getHours() * 60 + ahora.getMinutes();
    const lineaAhora = st.fecha === U.hoy() && minAhora >= abre && minAhora <= abre + filas * cfg.intervalo
      ? `<div class="now" style="top:${px(minAhora)}px"></div>` : "";

    $("#agenda").innerHTML = `
      ${!U.horarioDe(st.fecha) ? '<p class="agenda__closed"><i data-lucide="moon"></i>Día cerrado según el horario configurado</p>' : ""}
      <div class="agenda__scroll">
        <div class="agenda__grid" style="--cols:${cols.length};--h:${filas * ROW_H}px;--row:${ROW_H}px">
          <div class="agenda__corner"></div>
          ${cols.map((b) => `<div class="agenda__barber">${U.esc(b.nombre)}<small>${ts.filter((t) => t.barbero_id === b.id).length} turnos</small></div>`).join("")}
          <div class="agenda__hours">${horas}</div>
          ${cols.map((b) => `<div class="agenda__col" data-barbero="${b.id}">${lineaAhora}
            ${ts.filter((t) => t.barbero_id === b.id).map((t) => `
              <button class="appt appt--${t.estado} ${(t.duracion / cfg.intervalo) * ROW_H < 80 ? "appt--corto" : ""}" data-id="${t.id}"
                title="${t.hora} · ${U.esc(t.cliente_nombre)} — ${U.esc(t.servicio?.nombre || "")} (${ESTADOS[t.estado].txt})"
                style="top:${px(U.toMin(t.hora))}px;height:${(t.duracion / cfg.intervalo) * ROW_H - 4}px">
                <strong>${t.hora} · ${U.esc(t.cliente_nombre)}</strong>
                <span>${U.esc(t.servicio?.nombre || "")}</span>
                <em><i data-lucide="${ESTADOS[t.estado].icon}"></i>${ESTADOS[t.estado].txt}</em>
              </button>`).join("")}
          </div>`).join("")}
        </div>
      </div>`;
  }
  $("#agenda").addEventListener("click", (e) => {
    const b = e.target.closest(".appt"); if (b) return abrirDetalle(b.dataset.id);
    const col = e.target.closest(".agenda__col"); if (!col) return;
    // clic en un hueco vacío -> nuevo turno precargado con ese barbero y hora
    const y = e.clientY - col.getBoundingClientRect().top;
    const min = st.abre + Math.floor(y / ROW_H) * cfg.intervalo;
    abrirNuevo({ barbero_id: Number(col.dataset.barbero), hora: U.fromMin(min) });
  });

  /* ---------- Lista ---------- */
  function renderLista() {
    const ts = visibles();
    $("#lista").innerHTML = !ts.length ? `<p class="empty"><i data-lucide="calendar-x"></i>No hay turnos este día.</p>` : `
      <table class="tabla">
        <thead><tr><th>Hora</th><th>Cliente</th><th>Servicio</th><th>Barbero</th><th>Estado</th><th><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${ts.map((t) => `
          <tr class="${t.estado === "cancelado" ? "is-cancel" : ""}">
            <td data-l="Hora"><strong>${t.hora}</strong> <small>${U.durTxt(t.duracion)}</small></td>
            <td data-l="Cliente">${U.esc(t.cliente_nombre)}<small>${U.esc(t.cliente_telefono)}</small></td>
            <td data-l="Servicio">${U.esc(t.servicio?.nombre || "")}<small>${U.gs(t.servicio?.precio)}</small></td>
            <td data-l="Barbero">${U.esc(t.barbero?.nombre || "")}</td>
            <td data-l="Estado"><select class="select select--sm estado estado--${t.estado}" data-id="${t.id}" aria-label="Estado">
              ${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}" ${k === t.estado ? "selected" : ""}>${v.txt}</option>`).join("")}
            </select></td>
            <td class="tabla__acc">
              <a class="icon-btn" href="${waCliente(t)}" target="_blank" rel="noopener" aria-label="WhatsApp a ${U.esc(t.cliente_nombre)}"><i data-lucide="message-circle"></i></a>
              <button class="icon-btn" data-ver="${t.id}" aria-label="Ver detalle"><i data-lucide="eye"></i></button>
            </td>
          </tr>`).join("")}</tbody>
      </table>`;
  }
  $("#lista").addEventListener("change", (e) => {
    const s = e.target.closest("select.estado"); if (s) cambiarEstado(s.dataset.id, s.value);
  });
  $("#lista").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ver]"); if (b) abrirDetalle(b.dataset.ver);
  });

  /* ---------- Detalle ---------- */
  const waCliente = (t) => U.waLink(t.cliente_telefono,
    `Hola ${t.cliente_nombre.split(" ")[0]}! Te recordamos tu turno en ${cfg.negocio.nombreCompleto}: ` +
    `${t.servicio?.nombre || ""} el ${U.fechaLarga(t.fecha)} a las ${t.hora} hs con ${t.barbero?.nombre || ""}. ¿Nos confirmás?`);

  function abrirDetalle(id) {
    const t = st.turnos.find((x) => x.id === id); if (!t) return;
    $("#detTitulo").textContent = `${t.hora} · ${t.cliente_nombre}`;
    const acciones = {
      pendiente: [["confirmado", "Confirmar", "btn--gold"], ["cancelado", "Cancelar", "btn--danger"]],
      confirmado: [["completado", "Marcar atendido", "btn--gold"], ["ausente", "No vino", "btn--ghost"], ["cancelado", "Cancelar", "btn--danger"]],
      completado: [["confirmado", "Deshacer", "btn--ghost"]],
      ausente: [["confirmado", "Deshacer", "btn--ghost"]],
      cancelado: [["pendiente", "Reactivar", "btn--ghost"]],
    }[t.estado];
    $("#detCuerpo").innerHTML = `
      <span class="pill pill--${t.estado}"><i data-lucide="${ESTADOS[t.estado].icon}"></i>${ESTADOS[t.estado].txt}</span>
      <dl class="summary">
        <div><dt><i data-lucide="scissors"></i>Servicio</dt><dd>${U.esc(t.servicio?.nombre || "")} · ${U.gs(t.servicio?.precio)}</dd></div>
        <div><dt><i data-lucide="user"></i>Barbero</dt><dd>${U.esc(t.barbero?.nombre || "")}</dd></div>
        <div><dt><i data-lucide="calendar"></i>Fecha</dt><dd>${U.fechaLarga(t.fecha)}, ${t.hora} hs (${U.durTxt(t.duracion)})</dd></div>
        <div><dt><i data-lucide="phone"></i>Celular</dt><dd><a href="tel:${U.esc(t.cliente_telefono)}">${U.esc(t.cliente_telefono)}</a></dd></div>
        ${t.nota ? `<div><dt><i data-lucide="sticky-note"></i>Nota</dt><dd>${U.esc(t.nota)}</dd></div>` : ""}
        <div><dt><i data-lucide="hash"></i>Código</dt><dd>${U.esc(t.codigo)} · ${t.origen === "web" ? "reserva web" : "cargado en local"}</dd></div>
      </dl>
      <div class="modal__actions">
        <a class="btn btn--ghost btn--sm" href="${waCliente(t)}" target="_blank" rel="noopener"><i data-lucide="message-circle"></i>WhatsApp</a>
        ${acciones.map(([e, txt, cls]) => `<button class="btn ${cls} btn--sm" data-estado="${e}">${txt}</button>`).join("")}
      </div>`;
    $("#detCuerpo").dataset.id = id;
    U.icons();
    $("#modalDetalle").showModal();
  }
  $("#detCuerpo").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-estado]"); if (!b) return;
    if (b.dataset.estado === "cancelado" && !confirm("¿Cancelar este turno? El horario queda libre.")) return;
    await cambiarEstado($("#detCuerpo").dataset.id, b.dataset.estado);
    $("#modalDetalle").close();
  });

  async function cambiarEstado(id, estado) {
    try {
      await DB.actualizarTurno(id, { estado });
      U.toast(`Turno: ${ESTADOS[estado].txt.toLowerCase()}`);
    } catch (e) { U.toast(e.message, "error"); }
    await cargar(true);
  }

  /* ---------- Nuevo turno ---------- */
  const fN = $("#formNuevo");
  function abrirNuevo(pre = {}) {
    fN.reset(); $("#nuevoError").hidden = true;
    fN.servicio_id.innerHTML = st.servicios.filter((s) => s.activo)
      .map((s) => `<option value="${s.id}">${U.esc(s.nombre)} · ${U.durTxt(s.duracion)}</option>`).join("");
    fN.barbero_id.innerHTML = activos().map((b) => `<option value="${b.id}">${U.esc(b.nombre)}</option>`).join("");
    if (!activos().length) { U.toast("Primero agregá al menos un barbero activo.", "error"); return; }
    if (pre.barbero_id && activos().some((b) => b.id === pre.barbero_id)) fN.barbero_id.value = pre.barbero_id;
    else if (st.barbero && activos().some((b) => b.id === Number(st.barbero))) fN.barbero_id.value = st.barbero;
    fN.fecha.value = st.fecha;
    U.icons();
    $("#modalNuevo").showModal();
    horasNuevo(pre.hora);
  }
  async function horasNuevo(preHora) {
    const sel = fN.hora, sv = st.servicios.find((s) => s.id === Number(fN.servicio_id.value));
    if (!sv || !fN.fecha.value) { sel.innerHTML = ""; return; }
    sel.innerHTML = "<option>Cargando…</option>";
    try {
      const oc = await DB.ocupados(fN.fecha.value);
      const lista = U.slots(fN.fecha.value, sv.duracion, oc, [Number(fN.barbero_id.value)]);
      const libres = lista.filter((s) => s.libres.length);
      sel.innerHTML = libres.length
        ? libres.map((s) => `<option value="${s.hora}">${s.hora}${s.pasado ? " (ya pasó)" : ""}</option>`).join("")
        : `<option value="">${U.horarioDe(fN.fecha.value) ? "Sin horarios libres" : "Día cerrado"}</option>`;
      if (preHora && libres.some((s) => s.hora === preHora)) sel.value = preHora;
      else if (libres.length) sel.value = (libres.find((s) => !s.pasado) || libres[0]).hora;
    } catch (e) { sel.innerHTML = `<option value="">Error al cargar</option>`; }
  }
  ["servicio_id", "barbero_id", "fecha"].forEach((n) => fN[n].addEventListener("change", () => horasNuevo()));
  $("#btnNuevo").addEventListener("click", () => abrirNuevo());

  fN.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#nuevoError");
    if (!fN.checkValidity() || !fN.hora.value) {
      err.textContent = "Revisá los datos: falta la hora, el nombre o un celular válido."; err.hidden = false; return;
    }
    const d = Object.fromEntries(new FormData(fN));
    const sv = st.servicios.find((s) => s.id === Number(d.servicio_id));
    const btn = $("button[type=submit]", fN); btn.disabled = true;
    try {
      await DB.crearTurno({
        servicio_id: sv.id, barbero_id: Number(d.barbero_id), fecha: d.fecha, hora: d.hora, duracion: sv.duracion,
        cliente_nombre: d.cliente_nombre.trim(), cliente_telefono: d.cliente_telefono.trim(), nota: d.nota.trim() || null,
        estado: "confirmado", origen: "local",
      });
      $("#modalNuevo").close();
      U.toast("Turno guardado");
      if (d.fecha !== st.fecha) st.fecha = d.fecha;
      cargar();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { btn.disabled = false; }
  });

  /* ---------- Barberos del local ---------- */
  const fB = $("#formBarbero");
  const iniciales = (n) => n.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  function renderStaff() {
    const act = activos().length, inact = st.barberos.length - act;
    $("#barberosResumen").textContent = `${act} activo${act === 1 ? "" : "s"}` + (inact ? ` · ${inact} inactivo${inact === 1 ? "" : "s"}` : "") +
      " · los activos aparecen en la reserva online";
    $("#listaStaff").innerHTML = st.barberos.map((b) => `
      <li class="staff__item ${b.activo ? "" : "is-off"}" data-id="${b.id}">
        <span class="avatar">${b.foto ? `<img src="${U.esc(b.foto)}" alt="">` : U.esc(iniciales(b.nombre))}</span>
        <span class="staff__info"><strong>${U.esc(b.nombre)}</strong><small>${U.esc(b.especialidad || "Sin especialidad")}</small></span>
        <label class="switch" title="${b.activo ? "Activo: recibe reservas" : "Inactivo: no recibe reservas"}">
          <input type="checkbox" data-toggle ${b.activo ? "checked" : ""} aria-label="${U.esc(b.nombre)} activo"><span></span>
        </label>
        <button class="icon-btn" data-editar aria-label="Editar ${U.esc(b.nombre)}"><i data-lucide="pencil"></i></button>
        <button class="icon-btn icon-btn--danger" data-borrar aria-label="Eliminar ${U.esc(b.nombre)}"><i data-lucide="trash-2"></i></button>
      </li>`).join("") || `<li class="empty"><i data-lucide="users"></i>Todavía no hay barberos. Agregá el primero abajo.</li>`;
    U.icons();
  }
  function limpiarFormBarbero() {
    fB.reset(); fB.id.value = "";
    $("#formBarberoTitulo").textContent = "Agregar barbero";
    $("#btnGuardarBarbero").innerHTML = '<i data-lucide="user-plus"></i>Agregar';
    $("#btnCancelarEdicion").hidden = true; $("#barberoError").hidden = true;
    U.icons();
  }
  async function refrescarBarberos() {
    st.barberos = await DB.barberos(true);
    renderStaff(); renderFiltro(); render();
  }

  $("#btnBarberos").addEventListener("click", () => { limpiarFormBarbero(); renderStaff(); $("#modalBarberos").showModal(); });
  $("#btnCancelarEdicion").addEventListener("click", limpiarFormBarbero);

  $("#listaStaff").addEventListener("click", async (e) => {
    const li = e.target.closest(".staff__item"); if (!li) return;
    const b = st.barberos.find((x) => x.id === Number(li.dataset.id));
    if (e.target.closest("[data-editar]")) {
      fB.id.value = b.id; fB.nombre.value = b.nombre; fB.especialidad.value = b.especialidad || ""; fB.foto.value = b.foto || "";
      $("#formBarberoTitulo").textContent = `Editar a ${b.nombre}`;
      $("#btnGuardarBarbero").innerHTML = '<i data-lucide="save"></i>Guardar cambios';
      $("#btnCancelarEdicion").hidden = false; U.icons();
      fB.nombre.focus();
    }
    if (e.target.closest("[data-borrar]")) {
      if (!confirm(`¿Eliminar a ${b.nombre}? Esta acción no se puede deshacer.`)) return;
      try { await DB.eliminarBarbero(b.id); U.toast(`${b.nombre} eliminado`); await refrescarBarberos(); }
      catch (ex) { U.toast(ex.message, "error"); }
    }
  });

  $("#listaStaff").addEventListener("change", async (e) => {
    const chk = e.target.closest("[data-toggle]"); if (!chk) return;
    const b = st.barberos.find((x) => x.id === Number(chk.closest(".staff__item").dataset.id));
    if (!chk.checked) {
      try {
        const futuros = (await DB.turnos(U.hoy(), U.addDays(U.hoy(), 120)))
          .filter((t) => t.barbero_id === b.id && ["pendiente", "confirmado"].includes(t.estado)).length;
        if (futuros && !confirm(`${b.nombre} tiene ${futuros} turno${futuros === 1 ? "" : "s"} próximo${futuros === 1 ? "" : "s"}. ` +
          "Si lo desactivás, esos turnos se mantienen pero ya no recibirá reservas nuevas. ¿Continuar?")) { chk.checked = true; return; }
      } catch (ex) { /* si falla la consulta, seguimos igual */ }
    }
    try {
      await DB.guardarBarbero({ id: b.id, activo: chk.checked });
      U.toast(`${b.nombre} ${chk.checked ? "activado" : "desactivado"}`);
      await refrescarBarberos();
    } catch (ex) { chk.checked = !chk.checked; U.toast(ex.message, "error"); }
  });

  fB.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#barberoError"); err.hidden = true;
    if (!fB.checkValidity()) { err.textContent = "Ingresá un nombre (y una URL válida si cargás foto)."; err.hidden = false; return; }
    const id = Number(fB.id.value) || null;
    const datos = { nombre: fB.nombre.value.trim(), especialidad: fB.especialidad.value.trim() || null, foto: fB.foto.value.trim() || null };
    const btn = $("#btnGuardarBarbero"); btn.disabled = true;
    try {
      await DB.guardarBarbero(id ? { id, ...datos } : datos);
      U.toast(id ? "Cambios guardados" : `${datos.nombre} agregado`);
      limpiarFormBarbero(); await refrescarBarberos();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { btn.disabled = false; }
  });

  /* ---------- Controles ---------- */
  const irDia = (f) => { st.fecha = f; cargar(); };
  $("#diaPrev").addEventListener("click", () => irDia(U.addDays(st.fecha, -1)));
  $("#diaNext").addEventListener("click", () => irDia(U.addDays(st.fecha, 1)));
  $("#diaHoy").addEventListener("click", () => irDia(U.hoy()));
  $("#diaInput").addEventListener("change", (e) => e.target.value && irDia(e.target.value));
  $("#filtroBarbero").addEventListener("change", (e) => { st.barbero = e.target.value; render(); });
  $$(".segmented button").forEach((b) => b.addEventListener("click", () => {
    st.vista = b.dataset.vista;
    $$(".segmented button").forEach((x) => x.setAttribute("aria-selected", x === b));
    $("#agenda").hidden = st.vista !== "agenda"; $("#lista").hidden = st.vista !== "lista";
  }));
  $$("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  $$("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

  arrancar();
})();
