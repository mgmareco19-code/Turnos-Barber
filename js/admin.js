/* Panel de administración: agenda, estados y carga manual */
(() => {
  const cfg = window.APP_CONFIG;
  const N = U.neg; // el local del dueño (se carga al iniciar sesión)
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
    $("#loginLogo").innerHTML = U.logoHtml(cfg.plataforma.nombre);
    if (DB.modo === "demo") {
      const pw = U.esc(cfg.demoPasswordDueno);
      $("#loginHint").hidden = false;
      $("#loginHint").innerHTML = `<b>Modo demo</b> · contraseña <b>${pw}</b>. Tocá un local para completar:
        ${["dueno@blacklabel.demo", "dueno@elpatron.demo", "dueno@studio21.demo"].map((e) =>
          `<button type="button" class="chip" data-demo="${e}">${e}</button>`).join("")}`;
    }
    if (await DB.miNegocio()) mostrarPanel(); else mostrarLogin();
  }
  $("#loginHint").addEventListener("click", (e) => {
    const b = e.target.closest("[data-demo]"); if (!b) return;
    const f = $("#formLogin"); f.email.value = b.dataset.demo; f.password.value = cfg.demoPasswordDueno; f.password.focus();
  });
  function mostrarLogin() {
    $("#vistaPanel").hidden = true; $("#vistaLogin").hidden = false;
    document.title = "Panel de turnos";
    U.setFavicon(null);
    clearInterval(timer); U.icons();
    const f = $("#formLogin"), u = new URLSearchParams(location.search).get("u");
    if (u && !f.email.value) f.email.value = u; // link de acceso del staff: usuario precargado
    $(u ? "[name=password]" : "[name=email]", f).focus();
  }
  /** Muestra en el panel los datos del local (nombre, link, aviso del abono) */
  function aplicarNegocio(n) {
    U.setNegocio(n);
    document.title = `Panel | ${n.nombre}`;
    $("#logoLink").innerHTML = U.marcaHtml(n);
    U.setFavicon(n.logo);
    U.icons();
    // el logo del panel lleva siempre a la Agenda (la página de reservas se abre desde Configuración)
    const e = n.estado, box = $("#abonoAviso");
    const soporte = U.waLink(cfg.plataforma.soporteWhatsapp, `Hola, quiero renovar el abono de ${n.nombre} (${n.slug}).`);
    const msg = {
      por_vencer: `Tu abono ${e.txt.toLowerCase()} (${U.fechaLarga(n.vence_el)}). Renovalo para no cortar las reservas online.`,
      gracia: `Tu abono venció el ${U.fechaLarga(n.vence_el)}. Las reservas online siguen activas unos días más: renovalo para no cortarlas.`,
      vencido: `Tu abono venció el ${U.fechaLarga(n.vence_el)} y <b>las reservas online están pausadas</b>. El panel sigue funcionando.`,
      suspendido: `Las <b>reservas online de tu local están pausadas</b>. El panel sigue funcionando.`,
    }[e.clave];
    box.hidden = !msg;
    if (msg) {
      box.className = `abono abono--${e.reserva ? "warn" : "danger"}`;
      box.innerHTML = `<i data-lucide="${e.reserva ? "clock-alert" : "pause-circle"}"></i><span>${msg}</span>
        <a class="btn btn--sm ${e.reserva ? "btn--ghost" : "btn--gold"}" href="${soporte}" target="_blank" rel="noopener"><i data-lucide="message-circle"></i>Renovar</a>`;
    }
    if (!n.whatsapp && !msg) {
      box.hidden = false; box.className = "abono abono--info";
      box.innerHTML = `<i data-lucide="info"></i><span>Completá el WhatsApp y la dirección de tu local para que aparezcan en la página de reservas.</span>
        <button class="btn btn--sm btn--ghost" data-abrir-config><i data-lucide="settings"></i>Configurar</button>`;
    }
  }
  async function mostrarPanel() {
    const n = await DB.miNegocio();
    if (!n) return mostrarLogin();
    aplicarNegocio(n);
    $("#vistaLogin").hidden = true; $("#vistaPanel").hidden = false;
    $("#modoBadge").textContent = DB.modo === "demo" ? "Modo demo" : "En línea";
    $("#modoBadge").className = "badge " + (DB.modo === "demo" ? "badge--warn" : "badge--ok");
    st.fecha = U.hoy(); st.barbero = "";
    try {
      [st.servicios, st.barberos] = await Promise.all([DB.servicios(true), DB.barberos(true)]);
    } catch (e) { U.toast(e.message, "error"); }
    renderFiltro(); contarServicios();
    await cargar();
    Gestion.entrar();
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
      [st.turnos, st.bloqueos] = await Promise.all([DB.turnos(st.fecha, st.fecha), DB.bloqueos(st.fecha, st.fecha).catch(() => [])]);
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
    abre = Math.floor(abre / N.intervalo) * N.intervalo;
    st.abre = abre;
    const filas = Math.ceil((cierra - abre) / N.intervalo);
    // Columnas: barberos activos + inactivos que igual tengan turnos ese día
    const cols = st.barberos.filter((b) => (b.activo || ts.some((t) => t.barbero_id === b.id)) &&
      (!st.barbero || b.id === Number(st.barbero)));
    if (!cols.length) {
      $("#agenda").innerHTML = `<p class="empty"><i data-lucide="users"></i>No hay barberos activos. Agregalos desde el botón <b>Barberos</b>.</p>`;
      return;
    }
    const px = (min) => ((min - abre) / N.intervalo) * ROW_H;

    const horas = Array.from({ length: filas }, (_, i) => `<span style="top:${i * ROW_H}px">${U.fromMin(abre + i * N.intervalo)}</span>`).join("");
    const ahora = new Date(), minAhora = ahora.getHours() * 60 + ahora.getMinutes();
    const lineaAhora = st.fecha === U.hoy() && minAhora >= abre && minAhora <= abre + filas * N.intervalo
      ? `<div class="now" style="top:${px(minAhora)}px"></div>` : "";

    // Bloqueos del día dentro de lo que se ve de la agenda
    const finAgenda = abre + filas * N.intervalo;
    const bloqDe = (b) => (st.bloqueos || []).filter((k) => k.barbero_id == null || k.barbero_id === b.id).map((k) => {
      const ini = Math.max(abre, k.hora_desde ? U.toMin(k.hora_desde) : abre), fin = Math.min(finAgenda, k.hora_hasta ? U.toMin(k.hora_hasta) : finAgenda);
      return fin > ini ? `<div class="bloq" data-bloq style="top:${px(ini)}px;height:${px(fin) - px(ini) - 4}px"
        title="Bloqueado${k.motivo ? ": " + U.esc(k.motivo) : ""}"><i data-lucide="ban"></i><span>${U.esc(k.motivo || "Bloqueado")}${k.hora_desde ? ` · ${k.hora_desde}–${k.hora_hasta}` : ""}</span></div>` : "";
    }).join("");
    const cierre = U.cierreDe(st.fecha);
    $("#agenda").innerHTML = `
      ${cierre ? `<p class="agenda__closed"><i data-lucide="calendar-off"></i>Local cerrado${cierre.motivo ? `: ${U.esc(cierre.motivo)}` : ""} · no se toman reservas</p>`
        : !U.horarioDe(st.fecha) ? '<p class="agenda__closed"><i data-lucide="moon"></i>Día cerrado según el horario configurado</p>' : ""}
      <div class="agenda__scroll">
        <div class="agenda__grid" style="--cols:${cols.length};--h:${filas * ROW_H}px;--row:${ROW_H}px">
          <div class="agenda__corner"></div>
          ${cols.map((b) => `<div class="agenda__barber">${U.esc(b.nombre)}<small>${((n) => n + (n === 1 ? " turno" : " turnos"))(ts.filter((t) => t.barbero_id === b.id).length)}</small></div>`).join("")}
          <div class="agenda__hours">${horas}</div>
          ${cols.map((b) => `<div class="agenda__col" data-barbero="${b.id}">${lineaAhora}${bloqDe(b)}
            ${ts.filter((t) => t.barbero_id === b.id).map((t) => `
              <button class="appt appt--${t.estado} ${(t.duracion / N.intervalo) * ROW_H < 80 ? "appt--corto" : ""}" data-id="${t.id}"
                title="${t.hora} · ${U.esc(t.cliente_nombre)} — ${U.esc(t.servicio?.nombre || "")} (${ESTADOS[t.estado].txt})"
                style="top:${px(U.toMin(t.hora))}px;height:${(t.duracion / N.intervalo) * ROW_H - 4}px">
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
    if (e.target.closest("[data-bloq]")) return abrirBloqueos();
    const col = e.target.closest(".agenda__col"); if (!col) return;
    // clic en un hueco vacío -> nuevo turno precargado con ese barbero y hora
    const y = e.clientY - col.getBoundingClientRect().top;
    const min = st.abre + Math.floor(y / ROW_H) * N.intervalo;
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
            <td data-l="Cliente">${U.esc(t.cliente_nombre)}<small>${U.esc(t.cliente_telefono)}</small>${tagCliente(t)}</td>
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
  /** Recordatorio para el cliente, con el link de su turno (desde ahí lo ve, lo cambia o lo cancela) */
  function mensajeRecordatorio(t) {
    const dif = U.diasEntre(U.hoy(), t.fecha);
    const cuando = (dif === 0 ? "Hoy, " : dif === 1 ? "Mañana, " : "El ") + U.fechaLarga(t.fecha);
    return [
      `Hola ${t.cliente_nombre.trim().split(/\s+/)[0]}! Te recordamos tu turno en ${N.nombre}:`,
      `📅 ${cuando} a las ${t.hora} hs`,
      `✂️ ${t.servicio?.nombre || ""}${t.barbero?.nombre ? ` con ${t.barbero.nombre}` : ""}`,
      N.direccion ? `📍 ${N.direccion}` : null,
      "",
      "¿Nos confirmás si venís? Si necesitás cambiar o cancelar el turno, podés hacerlo acá:",
      U.linkTurno(N.slug, t.id),
    ].filter((l) => l !== null).join("\n");
  }
  const waCliente = (t) => U.waLink(t.cliente_telefono, mensajeRecordatorio(t));
  /** Lo que hizo el cliente desde su link (cambiarlo o cancelarlo) */
  const tagCliente = (t) => t.estado === "cancelado" && t.cancelado_por === "cliente"
    ? `<small class="cliente-tag"><i data-lucide="user-x"></i>Lo canceló el cliente</small>`
    : t.cambios ? `<small class="cliente-tag"><i data-lucide="calendar-clock"></i>El cliente lo cambió</small>` : "";

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
        <div><dt><i data-lucide="scissors"></i>${t.items.length > 1 ? "Servicios" : "Servicio"}</dt><dd>${t.items.map((i) =>
          `<span class="dd-line">${U.esc(i.nombre)} <small>${U.gs(i.precio)}</small></span>`).join("")}</dd></div>
        ${t.items.length > 1 ? `<div><dt><i data-lucide="wallet"></i>Total</dt><dd class="gold">${U.gs(t.precio)}</dd></div>` : ""}
        <div><dt><i data-lucide="user"></i>Barbero</dt><dd>${U.esc(t.barbero?.nombre || "")}</dd></div>
        <div><dt><i data-lucide="calendar"></i>Fecha</dt><dd>${U.fechaLarga(t.fecha)}, ${t.hora} hs (${U.durTxt(t.duracion)})</dd></div>
        <div><dt><i data-lucide="phone"></i>Celular</dt><dd><a href="tel:${U.esc(t.cliente_telefono)}">${U.esc(t.cliente_telefono)}</a></dd></div>
        ${t.nota ? `<div><dt><i data-lucide="sticky-note"></i>Nota</dt><dd>${U.esc(t.nota)}</dd></div>` : ""}
        <div><dt><i data-lucide="hash"></i>Código</dt><dd>${U.esc(t.codigo)} · ${t.origen === "web" ? "reserva web" : "cargado en local"}</dd></div>
        ${t.cambios ? `<div><dt><i data-lucide="calendar-clock"></i>Cambios</dt><dd>El cliente lo cambió de día u hora ${t.cambios === 1 ? "1 vez" : `${t.cambios} veces`}</dd></div>` : ""}
        ${t.estado === "cancelado" && t.cancelado_por ? `<div><dt><i data-lucide="x-circle"></i>Cancelado por</dt><dd>${t.cancelado_por === "cliente" ? "El cliente, desde su link" : "El local"}</dd></div>` : ""}
        ${t.cobro ? `<div><dt><i data-lucide="receipt"></i>Cobrado</dt><dd>${t.cobro.tipo === "factura" ? "Factura" : "Ticket"} ${U.esc(t.cobro.numero)}</dd></div>` : ""}
      </dl>
      <div class="modal__actions">
        <a class="btn btn--ghost btn--sm" href="${waCliente(t)}" target="_blank" rel="noopener"><i data-lucide="message-circle"></i>WhatsApp</a>
        ${t.cobro ? `<button class="btn btn--ghost btn--sm" data-ver-cobro="${t.cobro.id}"><i data-lucide="receipt"></i>Ver comprobante</button>`
          : t.estado === "completado" ? `<button class="btn btn--gold btn--sm" data-cobrar><i data-lucide="wallet"></i>Cobrar</button>` : ""}
        ${acciones.filter(([e]) => !(t.cobro && t.estado === "completado" && e === "confirmado"))
          .map(([e, txt, cls]) => `<button class="btn ${cls} btn--sm" data-estado="${e}">${txt}</button>`).join("")}
      </div>`;
    $("#detCuerpo").dataset.id = id;
    U.icons();
    $("#modalDetalle").showModal();
  }
  $("#detCuerpo").addEventListener("click", async (e) => {
    const t = st.turnos.find((x) => x.id === $("#detCuerpo").dataset.id);
    const ver = e.target.closest("[data-ver-cobro]");
    if (ver) { $("#modalDetalle").close(); return Gestion.verVentaId(ver.dataset.verCobro); }
    if (e.target.closest("[data-cobrar]")) { $("#modalDetalle").close(); return Gestion.cobrarTurno(t); }
    const b = e.target.closest("[data-estado]"); if (!b) return;
    if (b.dataset.estado === "cancelado" && !confirm("¿Cancelar este turno? El horario queda libre.")) return;
    $("#modalDetalle").close();
    await cambiarEstado(t.id, b.dataset.estado);
  });

  /** Cambia el estado; si quedó "atendido" y no está cobrado, abre «Cobrar» con sus servicios */
  async function cambiarEstado(id, estado) {
    let ok = false;
    try {
      await DB.actualizarTurno(id, { estado });
      U.toast(`Turno: ${ESTADOS[estado].txt.toLowerCase()}`);
      ok = true;
    } catch (e) { U.toast(e.message, "error"); }
    await cargar(true);
    const t = st.turnos.find((x) => x.id === id);
    if (ok && estado === "completado" && t && !t.cobro && !$("dialog[open]")) Gestion.cobrarTurno(t);
  }

  /* ---------- Nuevo turno ---------- */
  const fN = $("#formNuevo");
  function abrirNuevo(pre = {}) {
    fN.reset(); $("#nuevoError").hidden = true;
    const disponibles = st.servicios.filter((s) => s.activo).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    if (!disponibles.length) { U.toast("Primero agregá al menos un servicio activo.", "error"); return; }
    $("#nuevoServicios").innerHTML = disponibles.map((s, i) => `
      <label><input type="checkbox" name="servicio" value="${s.id}" ${i === 0 ? "checked" : ""}>
        <span>${U.esc(s.nombre)}</span><small>${U.durTxt(s.duracion)} · ${U.gs(s.precio)}</small></label>`).join("");
    totalNuevo();
    fN.barbero_id.innerHTML = activos().map((b) => `<option value="${b.id}">${U.esc(b.nombre)}</option>`).join("");
    if (!activos().length) { U.toast("Primero agregá al menos un barbero activo.", "error"); return; }
    if (pre.barbero_id && activos().some((b) => b.id === pre.barbero_id)) fN.barbero_id.value = pre.barbero_id;
    else if (st.barbero && activos().some((b) => b.id === Number(st.barbero))) fN.barbero_id.value = st.barbero;
    fN.fecha.value = st.fecha;
    if (pre.cliente) { fN.cliente_nombre.value = pre.cliente.nombre || ""; fN.cliente_telefono.value = pre.cliente.telefono || ""; }
    Gestion.refrescarClientes();
    U.icons();
    $("#modalNuevo").showModal();
    horasNuevo(pre.hora);
  }
  // Clientes que ya vinieron: al escribir el nombre o el celular, se completan los dos
  const elegirClienteNuevo = (c) => { fN.cliente_nombre.value = c.nombre; if (c.telefono) fN.cliente_telefono.value = c.telefono; };
  Gestion.autocompletar(fN.cliente_nombre, elegirClienteNuevo);
  Gestion.autocompletar(fN.cliente_telefono, elegirClienteNuevo);
  const elegidosNuevo = () => $$("#nuevoServicios input:checked").map((c) => st.servicios.find((s) => s.id === Number(c.value))).filter(Boolean);
  function totalNuevo() {
    const el = elegidosNuevo();
    $("#nuevoTotal").textContent = el.length
      ? `${el.length} servicio${el.length === 1 ? "" : "s"} · ${U.durTxt(el.reduce((a, s) => a + s.duracion, 0))} · ${U.gs(el.reduce((a, s) => a + s.precio, 0))}`
      : "Elegí al menos un servicio.";
  }
  $("#nuevoServicios").addEventListener("change", (e) => {
    if (elegidosNuevo().length > DB.MAX_SERVICIOS) { e.target.checked = false; U.toast(`Hasta ${DB.MAX_SERVICIOS} servicios por turno.`, "error"); }
    totalNuevo(); horasNuevo(fN.hora.value);
  });
  async function horasNuevo(preHora) {
    const sel = fN.hora, el = elegidosNuevo();
    const sv = el.length ? { duracion: el.reduce((a, s) => a + s.duracion, 0) } : null;
    if (!sv || !fN.fecha.value) { sel.innerHTML = `<option value="">${sv ? "" : "Elegí servicios"}</option>`; return; }
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
  ["barbero_id", "fecha"].forEach((n) => fN[n].addEventListener("change", () => horasNuevo()));
  $("#btnNuevo").addEventListener("click", () => abrirNuevo());

  fN.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#nuevoError");
    const servicio_ids = elegidosNuevo().map((s) => s.id);
    if (!servicio_ids.length) { err.textContent = "Elegí al menos un servicio."; err.hidden = false; return; }
    if (!fN.checkValidity() || !fN.hora.value) {
      err.textContent = "Revisá los datos: falta la hora, el nombre o un celular válido."; err.hidden = false; return;
    }
    const d = Object.fromEntries(new FormData(fN));
    const btn = $("button[type=submit]", fN); btn.disabled = true;
    try {
      await DB.crearTurno({
        servicio_ids, barbero_id: Number(d.barbero_id), fecha: d.fecha, hora: d.hora,
        cliente_nombre: d.cliente_nombre.trim(), cliente_telefono: d.cliente_telefono.trim(), nota: d.nota.trim() || null,
      });
      $("#modalNuevo").close();
      U.toast("Turno guardado");
      Gestion.refrescarClientes();
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
        <span class="staff__info"><strong>${U.esc(b.nombre)}</strong><small>${U.esc(b.especialidad || "Sin especialidad")}</small>
          <small>Comisión: ${b.comision || 0} % servicios · ${b.comision_prod || 0} % productos</small></span>
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
      fB.comision.value = b.comision ?? ""; fB.comision_prod.value = b.comision_prod ?? "";
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
    const pct = (v) => (v === "" ? 0 : Number(v));
    const datos = { nombre: fB.nombre.value.trim(), especialidad: fB.especialidad.value.trim() || null, foto: fB.foto.value.trim() || null,
      comision: pct(fB.comision.value), comision_prod: pct(fB.comision_prod.value) };
    if (![datos.comision, datos.comision_prod].every((n) => Number.isInteger(n) && n >= 0 && n <= 100)) {
      err.textContent = "La comisión es un porcentaje entero entre 0 y 100."; err.hidden = false; return;
    }
    const btn = $("#btnGuardarBarbero"); btn.disabled = true;
    try {
      await DB.guardarBarbero(id ? { id, ...datos } : datos);
      U.toast(id ? "Cambios guardados" : `${datos.nombre} agregado`);
      limpiarFormBarbero(); await refrescarBarberos();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { btn.disabled = false; }
  });

  /* ---------- Servicios ---------- */
  const fS = $("#formServicio");
  const ordenados = () => [...st.servicios].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.id - b.id);
  const contarServicios = () => { $("#cantServicios").textContent = st.servicios.filter((s) => s.activo).length; };

  function opcionesDuracion(actual) {
    const mins = []; for (let m = 15; m <= 480; m += 15) mins.push(m);
    if (actual && !mins.includes(actual)) mins.push(actual), mins.sort((a, b) => a - b);
    fS.duracion.innerHTML = mins.map((m) => `<option value="${m}">${U.durTxt(m)}</option>`).join("");
    fS.duracion.value = actual || 60;
  }

  function renderServ() {
    const lista = ordenados(), act = lista.filter((s) => s.activo).length, inact = lista.length - act;
    $("#serviciosResumen").textContent = `${act} activo${act === 1 ? "" : "s"}` + (inact ? ` · ${inact} inactivo${inact === 1 ? "" : "s"}` : "") +
      " · los activos aparecen en la reserva online";
    $("#listaServ").innerHTML = lista.map((s, i) => `
      <li class="staff__item ${s.activo ? "" : "is-off"}" data-id="${s.id}">
        <span class="orden">
          <button class="orden__btn" data-mover="-1" ${i === 0 ? "disabled" : ""} aria-label="Subir ${U.esc(s.nombre)}"><i data-lucide="chevron-up"></i></button>
          <button class="orden__btn" data-mover="1" ${i === lista.length - 1 ? "disabled" : ""} aria-label="Bajar ${U.esc(s.nombre)}"><i data-lucide="chevron-down"></i></button>
        </span>
        <span class="staff__info"><strong>${U.esc(s.nombre)}</strong>
          <small>${U.durTxt(s.duracion)} · ${U.gs(s.precio)}${s.descripcion ? " · " + U.esc(s.descripcion) : ""}</small></span>
        <label class="switch" title="${s.activo ? "Activo: se puede reservar" : "Inactivo: no aparece en la reserva"}">
          <input type="checkbox" data-toggle ${s.activo ? "checked" : ""} aria-label="${U.esc(s.nombre)} activo"><span></span>
        </label>
        <button class="icon-btn" data-editar aria-label="Editar ${U.esc(s.nombre)}"><i data-lucide="pencil"></i></button>
        <button class="icon-btn icon-btn--danger" data-borrar aria-label="Eliminar ${U.esc(s.nombre)}"><i data-lucide="trash-2"></i></button>
      </li>`).join("") || `<li class="empty"><i data-lucide="sparkles"></i>Todavía no hay servicios. Agregá el primero abajo.</li>`;
    U.icons();
  }
  function limpiarFormServicio() {
    fS.reset(); fS.id.value = ""; opcionesDuracion(60);
    $("#formServicioTitulo").textContent = "Agregar servicio";
    $("#btnGuardarServicio").innerHTML = '<i data-lucide="plus"></i>Agregar';
    $("#btnCancelarServicio").hidden = true; $("#servicioError").hidden = true;
    U.icons();
  }
  async function refrescarServicios() {
    st.servicios = await DB.servicios(true);
    renderServ(); contarServicios();
    await cargar(true); // la agenda muestra nombres y precios de los servicios
  }

  $("#btnServicios").addEventListener("click", () => { limpiarFormServicio(); renderServ(); $("#modalServicios").showModal(); });
  $("#btnCancelarServicio").addEventListener("click", limpiarFormServicio);

  $("#listaServ").addEventListener("click", async (e) => {
    const li = e.target.closest(".staff__item"); if (!li) return;
    const s = st.servicios.find((x) => x.id === Number(li.dataset.id));

    const mover = e.target.closest("[data-mover]");
    if (mover) {
      const lista = ordenados(), i = lista.indexOf(s), j = i + Number(mover.dataset.mover);
      if (j < 0 || j >= lista.length) return;
      [lista[i], lista[j]] = [lista[j], lista[i]];
      $$("#listaServ button").forEach((b) => (b.disabled = true));
      try {
        // Renumera 1..n y guarda solo los que cambiaron
        await Promise.all(lista.map((x, k) => (x.orden === k + 1 ? null : DB.guardarServicio({ id: x.id, orden: k + 1 }))));
      } catch (ex) { U.toast(ex.message, "error"); }
      await refrescarServicios();
      return;
    }
    if (e.target.closest("[data-editar]")) {
      fS.id.value = s.id; fS.nombre.value = s.nombre; fS.descripcion.value = s.descripcion || "";
      opcionesDuracion(s.duracion); fS.precio.value = s.precio;
      $("#formServicioTitulo").textContent = `Editar «${s.nombre}»`;
      $("#btnGuardarServicio").innerHTML = '<i data-lucide="save"></i>Guardar cambios';
      $("#btnCancelarServicio").hidden = false; $("#servicioError").hidden = true; U.icons();
      fS.nombre.focus();
    }
    if (e.target.closest("[data-borrar]")) {
      if (!confirm(`¿Eliminar el servicio «${s.nombre}»? Esta acción no se puede deshacer.`)) return;
      try {
        await DB.eliminarServicio(s.id);
        U.toast(`«${s.nombre}» eliminado`);
        if (Number(fS.id.value) === s.id) limpiarFormServicio();
        await refrescarServicios();
      } catch (ex) { U.toast(ex.message, "error"); }
    }
  });

  $("#listaServ").addEventListener("change", async (e) => {
    const chk = e.target.closest("[data-toggle]"); if (!chk) return;
    const s = st.servicios.find((x) => x.id === Number(chk.closest(".staff__item").dataset.id));
    try {
      await DB.guardarServicio({ id: s.id, activo: chk.checked });
      U.toast(`«${s.nombre}» ${chk.checked ? "activado" : "desactivado"}`);
      await refrescarServicios();
    } catch (ex) { chk.checked = !chk.checked; U.toast(ex.message, "error"); }
  });

  fS.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#servicioError"); err.hidden = true;
    if (!fS.checkValidity()) { err.textContent = "Completá el nombre, la duración y un precio válido."; err.hidden = false; return; }
    const id = Number(fS.id.value) || null;
    const datos = {
      nombre: fS.nombre.value.trim(), descripcion: fS.descripcion.value.trim() || null,
      duracion: Number(fS.duracion.value), precio: Math.round(Number(fS.precio.value)),
    };
    if (!id) datos.orden = Math.max(0, ...st.servicios.map((x) => x.orden ?? 0)) + 1;
    const btn = $("#btnGuardarServicio"); btn.disabled = true;
    try {
      await DB.guardarServicio(id ? { id, ...datos } : datos);
      U.toast(id ? "Cambios guardados" : `«${datos.nombre}» agregado`);
      limpiarFormServicio(); await refrescarServicios();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { btn.disabled = false; }
  });

  /* ---------- Configuración del local ---------- */
  const fC = $("#formConfig");
  const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0]; // lunes primero
  function horasOpciones(sel) {
    const out = [];
    for (let m = 5 * 60; m <= 24 * 60; m += 30) { const h = m === 1440 ? "23:59" : U.fromMin(m); out.push(`<option ${h === sel ? "selected" : ""}>${h}</option>`); }
    return out.join("");
  }
  let logoCfg = null; // logo elegido en el modal (data URL) o null
  function pintarLogoCfg() {
    $("#cfgLogoPrev").innerHTML = logoCfg ? `<img src="${U.esc(logoCfg)}" alt="Logo del local">` : '<i data-lucide="image"></i><small>Sin logo</small>';
    $("#cfgLogoQuitar").hidden = !logoCfg;
    $("#cfgLogoTxt").textContent = logoCfg ? "Cambiar logo" : "Subir logo";
    U.icons();
  }
  $("#cfgLogoFile").addEventListener("change", async (e) => {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    try { logoCfg = await U.achicarImagen(file); pintarLogoCfg(); $("#configError").hidden = true; }
    catch (ex) { $("#configError").textContent = ex.message; $("#configError").hidden = false; }
  });
  $("#cfgLogoQuitar").addEventListener("click", () => { logoCfg = null; pintarLogoCfg(); });

  function abrirConfig() {
    const n = N;
    $("#configError").hidden = true;
    $("#cfgClave").hidden = DB.modo === "demo"; fC.clave_nueva.value = ""; fC.clave_repetir.value = "";
    logoCfg = n.logo || null; fC.logo_solo.checked = Boolean(n.logo_solo); pintarLogoCfg();
    $("#cfgLink").value = U.linkReserva(n.slug);
    $("#btnAbrirLink").href = U.linkReserva(n.slug);
    ["nombre", "nombre_corto", "whatsapp", "direccion"].forEach((k) => (fC[k].value = n[k] || ""));
    ["intervalo", "dias_anticipacion", "margen_minutos"].forEach((k) => {
      const s = fC[k];
      if (![...s.options].some((o) => Number(o.value) === n[k])) s.add(new Option(String(n[k]), n[k]));
      s.value = String(n[k]);
    });
    $("#cfgHorario").innerHTML = ORDEN_DIAS.map((d) => {
      const h = (n.horario || {})[d];
      return `<div class="horario__dia ${h ? "" : "is-off"}" data-dia="${d}">
        <label class="switch" title="Abierto"><input type="checkbox" data-abierto ${h ? "checked" : ""} aria-label="Abierto el ${U.DIAS_LARGO[d]}"><span></span></label>
        <strong>${U.DIAS_LARGO[d]}</strong>
        <span class="horario__horas">
          <select class="select select--sm" data-desde aria-label="${U.DIAS_LARGO[d]}: abre">${horasOpciones(h?.[0] || "09:00")}</select>
          <span class="muted">a</span>
          <select class="select select--sm" data-hasta aria-label="${U.DIAS_LARGO[d]}: cierra">${horasOpciones(h?.[1] || "20:00")}</select>
        </span>
        <em class="horario__cerrado">Cerrado</em>
      </div>`;
    }).join("");
    const e = n.estado;
    $("#cfgAbono").innerHTML = `<i data-lucide="badge-check"></i><span><b>Abono:</b> <span class="estado-neg estado-neg--${e.clave}">${e.txt}</span>` +
      (n.vence_el ? ` · vence el ${U.fechaLarga(n.vence_el)}` : "") + `</span>`;
    U.icons();
    $("#modalConfig").showModal();
  }
  $("#cfgHorario").addEventListener("change", (e) => {
    const fila = e.target.closest(".horario__dia");
    if (e.target.matches("[data-abierto]")) fila.classList.toggle("is-off", !e.target.checked);
  });
  $("#btnCopiarLink").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#cfgLink").value); U.toast("Link copiado"); }
    catch (e) { $("#cfgLink").select(); document.execCommand?.("copy"); U.toast("Link copiado"); }
  });
  $("#btnConfig").addEventListener("click", abrirConfig);
  $("#abonoAviso").addEventListener("click", (e) => { if (e.target.closest("[data-abrir-config]")) abrirConfig(); });

  fC.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#configError"); err.hidden = true;
    const fallo = (m) => { err.textContent = m; err.hidden = false; };
    if (!fC.checkValidity()) return fallo("Revisá el nombre y que el WhatsApp sea un número válido.");
    const horario = {};
    for (const fila of $$("#cfgHorario .horario__dia")) {
      const d = Number(fila.dataset.dia);
      if (!$("[data-abierto]", fila).checked) { horario[d] = null; continue; }
      const a = $("[data-desde]", fila).value, b = $("[data-hasta]", fila).value;
      if (U.toMin(b) <= U.toMin(a)) return fallo(`El ${U.DIAS_LARGO[d]} la hora de cierre tiene que ser después de la de apertura.`);
      horario[d] = [a, b];
    }
    if (!Object.values(horario).some(Boolean)) return fallo("Marcá al menos un día abierto.");
    const clave = DB.modo === "demo" ? "" : fC.clave_nueva.value;
    if (clave && clave.length < 8) return fallo("La contraseña nueva tiene que tener al menos 8 caracteres.");
    if (clave !== (DB.modo === "demo" ? "" : fC.clave_repetir.value)) return fallo("Las dos contraseñas no coinciden.");
    const wa = fC.whatsapp.value.trim();
    const datos = {
      nombre: fC.nombre.value.trim(), nombre_corto: fC.nombre_corto.value.trim() || null,
      logo: logoCfg, logo_solo: Boolean(logoCfg && fC.logo_solo.checked),
      whatsapp: wa ? U.telWa(wa) : "", direccion: fC.direccion.value.trim(), horario,
      intervalo: Number(fC.intervalo.value), dias_anticipacion: Number(fC.dias_anticipacion.value), margen_minutos: Number(fC.margen_minutos.value),
    };
    const btn = $("button[type=submit]", fC); btn.disabled = true;
    try {
      const n = await DB.guardarNegocio(datos);
      aplicarNegocio({ ...N, ...n });
      if (clave) await DB.cambiarClave(clave);
      $("#modalConfig").close();
      U.toast(clave ? "Configuración y contraseña guardadas" : "Configuración guardada");
      render(); U.icons();
    } catch (ex) { fallo(ex.message); }
    finally { btn.disabled = false; }
  });

  /* ---------- Controles ---------- */
  const irDia = (f) => { st.fecha = f; cargar(); };
  $("#diaPrev").addEventListener("click", () => irDia(U.addDays(st.fecha, -1)));
  $("#diaNext").addEventListener("click", () => irDia(U.addDays(st.fecha, 1)));
  $("#diaHoy").addEventListener("click", () => irDia(U.hoy()));
  $("#diaInput").addEventListener("change", (e) => e.target.value && irDia(e.target.value));
  $("#filtroBarbero").addEventListener("change", (e) => { st.barbero = e.target.value; render(); });
  $$(".segmented button[data-vista]").forEach((b) => b.addEventListener("click", () => {
    st.vista = b.dataset.vista;
    $$(".segmented button[data-vista]").forEach((x) => x.setAttribute("aria-selected", x === b));
    $("#agenda").hidden = st.vista !== "agenda"; $("#lista").hidden = st.vista !== "lista";
  }));
  Gestion.iniciar({ servicios: () => st.servicios, barberos: () => st.barberos, turnosCambiaron: () => cargar(true),
    nuevoTurno: (pre) => { Gestion.irModulo("agenda"); abrirNuevo(pre); } });

  /* ---------- Bloqueos de horarios (vacaciones, feriados, un barbero que falta) ---------- */
  const fBl = $("#formBloqueo");
  let bloqueos = [];
  async function abrirBloqueos() {
    fBl.reset(); $("#bloqueoError").hidden = true;
    fBl.barbero_id.innerHTML = '<option value="">Todo el local (cierra)</option>' +
      activos().map((b) => `<option value="${b.id}">${U.esc(b.nombre)}</option>`).join("");
    fBl.desde.min = fBl.hasta.min = U.hoy();
    fBl.desde.value = fBl.hasta.value = st.fecha >= U.hoy() ? st.fecha : U.hoy();
    horasBloqueo();
    $("#listaBloqueos").innerHTML = '<li class="skeleton"></li>';
    U.icons();
    if (!$("#modalBloqueos").open) $("#modalBloqueos").showModal();
    await cargarBloqueos();
  }
  async function cargarBloqueos() {
    try { bloqueos = await DB.bloqueos(); } catch (e) { $("#listaBloqueos").innerHTML = `<li class="empty">${U.esc(e.message)}</li>`; return; }
    const fecha = (k) => (k.desde === k.hasta ? U.fechaLarga(k.desde) : `${U.fechaLarga(k.desde)} al ${U.fechaLarga(k.hasta)}`);
    $("#listaBloqueos").innerHTML = bloqueos.map((k) => `
      <li class="bloq-item">
        <span class="bloq-item__icon ${k.barbero_id ? "" : "is-local"}"><i data-lucide="${k.barbero_id ? "user-x" : "store"}"></i></span>
        <span class="bloq-item__info"><strong>${k.barbero_id ? U.esc(k.barbero_nombre || "Barbero") : "Todo el local"}${k.motivo ? ` · ${U.esc(k.motivo)}` : ""}</strong>
          <small>${fecha(k)} · ${k.hora_desde ? `${k.hora_desde} a ${k.hora_hasta}` : "todo el día"}</small></span>
        <button class="icon-btn icon-btn--danger" data-quitar-bloq="${k.id}" aria-label="Quitar bloqueo"><i data-lucide="trash-2"></i></button>
      </li>`).join("") || `<li class="note">No hay bloqueos próximos. Los horarios se toman del horario semanal del local.</li>`;
    U.icons();
  }
  const horasBloqueo = () => {
    const todo = fBl.todo_dia.checked;
    $("#bloqHoras").hidden = todo;
    fBl.hora_desde.required = fBl.hora_hasta.required = !todo;
  };
  fBl.todo_dia.addEventListener("change", horasBloqueo);
  fBl.desde.addEventListener("change", () => { if (fBl.hasta.value < fBl.desde.value) fBl.hasta.value = fBl.desde.value; });
  $("#btnBloqueos").addEventListener("click", abrirBloqueos);
  /** Los días cerrados del local viven en los datos del negocio: se vuelven a leer */
  async function bloqueosCambiaron() {
    try { const n = await DB.miNegocio(); if (n) U.setNegocio({ ...N, ...n }); } catch (e) { /* se ve al recargar */ }
    await cargarBloqueos(); cargar(true);
  }
  $("#listaBloqueos").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-quitar-bloq]"); if (!b) return;
    if (!confirm("¿Quitar este bloqueo? Esos horarios vuelven a estar disponibles para reservar.")) return;
    try { await DB.eliminarBloqueo(Number(b.dataset.quitarBloq)); U.toast("Bloqueo quitado"); await bloqueosCambiaron(); }
    catch (ex) { U.toast(ex.message, "error"); }
  });
  fBl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#bloqueoError"); err.hidden = true;
    const todo = fBl.todo_dia.checked;
    if (!fBl.desde.value || !fBl.hasta.value) { err.textContent = "Elegí desde y hasta qué día."; err.hidden = false; return; }
    if (!todo && (!fBl.hora_desde.value || !fBl.hora_hasta.value)) { err.textContent = "Poné la hora de inicio y la de fin, o marcá «Todo el día»."; err.hidden = false; return; }
    const btn = $("button[type=submit]", fBl); btn.disabled = true;
    try {
      const r = await DB.guardarBloqueo({ barbero_id: Number(fBl.barbero_id.value) || null, desde: fBl.desde.value, hasta: fBl.hasta.value,
        hora_desde: todo ? null : fBl.hora_desde.value, hora_hasta: todo ? null : fBl.hora_hasta.value, motivo: fBl.motivo.value.trim() || null });
      U.toast("Horario bloqueado");
      if (r.turnos) alert(`Ojo: hay ${r.turnos} turno${r.turnos === 1 ? "" : "s"} reservado${r.turnos === 1 ? "" : "s"} en ese horario. ` +
        "No se cancelan solos: avisales a los clientes y cancelalos o cambialos desde la agenda.");
      fBl.motivo.value = "";
      await bloqueosCambiaron();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { btn.disabled = false; }
  });
  // Logo: vuelve siempre a la Agenda (pantalla principal) sin recargar
  $("#logoLink").addEventListener("click", (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return; // abrir en otra pestaña sigue funcionando
    e.preventDefault();
    Gestion.irModulo("agenda");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  /* ---------- Recordatorios por WhatsApp ----------
     wa.me no permite mandar en masa: se abre un chat por cliente con el mensaje listo.
     Los ya enviados se marcan en este navegador (si el turno cambia de hora, vuelve a quedar sin enviar). */
  const REC_KEY = "tb_recordatorios";
  const rec = { dia: 1, turnos: [] };
  const recLeer = () => { try { return JSON.parse(localStorage.getItem(REC_KEY)) || {}; } catch (e) { return {}; } };
  const recEnviado = (m, t) => Boolean(m[t.id] && m[t.id].f === t.fecha && m[t.id].h === t.hora);
  function recMarcar(t) {
    const m = recLeer(), viejo = U.addDays(U.hoy(), -3);
    Object.keys(m).forEach((k) => { if (!m[k] || m[k].f < viejo) delete m[k]; });
    m[t.id] = { f: t.fecha, h: t.hora };
    try { localStorage.setItem(REC_KEY, JSON.stringify(m)); } catch (e) { /* sin storage: no queda marcado */ }
  }
  async function cargarRec() {
    const fecha = U.addDays(U.hoy(), rec.dia);
    $$("[data-rec-dia]").forEach((b) => b.setAttribute("aria-selected", String(Number(b.dataset.recDia) === rec.dia)));
    $("#recTitulo").textContent = `Recordatorios · ${rec.dia ? "mañana" : "hoy"}`;
    $("#recResumen").textContent = "";
    $("#recLista").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    try {
      const ahora = new Date(), min = ahora.getHours() * 60 + ahora.getMinutes();
      rec.turnos = (await DB.turnos(fecha, fecha))
        .filter((t) => ["pendiente", "confirmado"].includes(t.estado) && (rec.dia || U.toMin(t.hora) >= min));
    } catch (e) {
      rec.turnos = [];
      $("#recLista").innerHTML = `<p class="empty"><i data-lucide="wifi-off"></i>${U.esc(e.message)}</p>`;
      return U.icons();
    }
    renderRec();
  }
  function renderRec() {
    const m = recLeer(), fecha = U.addDays(U.hoy(), rec.dia), ts = rec.turnos;
    const listos = ts.filter((t) => recEnviado(m, t)).length;
    $("#recResumen").textContent = ts.length ? `${listos} de ${ts.length} enviado${ts.length === 1 ? "" : "s"}` : "";
    $(".rec__vista").hidden = !ts.length;
    $("#recLista").innerHTML = !ts.length
      ? `<p class="empty"><i data-lucide="bell-off"></i>No hay turnos ${rec.dia ? "para mañana" : "por delante hoy"} (${U.fechaLarga(fecha)}).</p>`
      : ts.map((t) => {
        const ok = recEnviado(m, t);
        return `<div class="rec__item ${ok ? "is-enviado" : ""}">
          <span class="rec__hora">${t.hora}</span>
          <span class="rec__info"><strong>${U.esc(t.cliente_nombre)}</strong>
            <small>${U.esc(t.servicio?.nombre || "")} · ${U.esc(t.barbero?.nombre || "")} · ${ESTADOS[t.estado].txt}</small></span>
          <span class="rec__acc">
            ${ok ? '<span class="rec__ok"><i data-lucide="check-check"></i>Enviado</span>' : ""}
            <a class="btn ${ok ? "btn--ghost" : "btn--gold"} btn--sm" href="${waCliente(t)}" target="_blank" rel="noopener" data-rec="${t.id}"
              aria-label="${ok ? "Reenviar" : "Enviar"} recordatorio a ${U.esc(t.cliente_nombre)}"><i data-lucide="message-circle"></i>${ok ? "Reenviar" : "Enviar"}</a>
          </span></div>`;
      }).join("");
    if (ts.length) $("#recEjemplo").textContent = mensajeRecordatorio(ts.find((t) => !recEnviado(m, t)) || ts[0]);
    U.icons();
  }
  $("#btnRecordatorios").addEventListener("click", () => {
    rec.dia = 1;
    $("#modalRecordatorios").showModal();
    cargarRec();
  });
  $$("[data-rec-dia]").forEach((b) => b.addEventListener("click", () => { rec.dia = Number(b.dataset.recDia); cargarRec(); }));
  $("#recLista").addEventListener("click", (e) => {
    const a = e.target.closest("[data-rec]"); if (!a) return;
    const t = rec.turnos.find((x) => x.id === a.dataset.rec);
    if (t) { recMarcar(t); setTimeout(renderRec, 400); } // después de que se abra WhatsApp
  });

  $$("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  $$("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

  arrancar();
})();
