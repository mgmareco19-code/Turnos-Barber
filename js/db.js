/* ============================================================
   CAPA DE DATOS · varios locales (multi-negocio)
   - Si js/config.js tiene apiUrl → MODO ONLINE (js/db-oracle.js).
   - Si no → MODO DEMO: todo se guarda en el localStorage del navegador.
   Los dos exponen las mismas funciones, así las páginas no cambian.

   Cada barbero, servicio y turno pertenece a un local (negocio_id).
   Las páginas eligen el local con DB.usar(id):
   - la reserva pública, a partir del link (?local=slug)
   - el panel, a partir del dueño que inició sesión
   ============================================================ */
const DB = window.DB_ORACLE || (() => {
  const cfg = window.APP_CONFIG;
  const MAX_SERVICIOS = 6;
  const RESERVADOS = ["admin", "panel", "superadmin", "api", "www", "app", "login", "demo"];
  const CAMPOS_DUENO = ["nombre", "nombre_corto", "logo", "logo_solo", "whatsapp", "direccion", "horario", "intervalo", "dias_anticipacion", "margen_minutos"];

  /** Agrega a un turno el resumen de sus servicios: t.servicio = { nombre: "A + B", precio: total } */
  const conServicios = (t) => {
    const items = [...(t.items || [])].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    return { ...t, items, servicio: { nombre: items.map((i) => i.nombre).join(" + "), precio: t.precio ?? 0 } };
  };
  const horarioN = (n, fecha) => (n.horario || {})[U.parse(fecha).getDay()] || null;
  const codigo = () => Math.random().toString(36).slice(2, 8).toUpperCase();
  const nextId = (arr) => Math.max(0, ...arr.map((x) => x.id)) + 1;

  /* ---------------- Datos de ejemplo ---------------- */
  const KEY = "turnos_barber_demo_v3"; // v3: varios locales
  function seed() {
    const ahora = new Date().toISOString();
    const negocios = [
      { id: 1, slug: "black-label", nombre: "Black Label Barber Club", nombre_corto: "Black Label", whatsapp: "595981000000",
        direccion: "Av. Mcal. López 1234, Asunción", horario: U.HORARIO_BASE, intervalo: 30, dias_anticipacion: 21,
        margen_minutos: 30, activo: true, vence_el: U.addDays(U.hoy(), 18), creado_en: ahora },
      { id: 2, slug: "el-patron", nombre: "Barbería El Patrón", nombre_corto: "El Patrón", whatsapp: "595982000000",
        direccion: "Av. España 850, San Lorenzo",
        horario: { 0: null, 1: null, 2: ["10:00", "21:00"], 3: ["10:00", "21:00"], 4: ["10:00", "21:00"], 5: ["10:00", "21:00"], 6: ["09:00", "18:00"] },
        intervalo: 30, dias_anticipacion: 14, margen_minutos: 60, activo: true, vence_el: U.addDays(U.hoy(), 3), creado_en: ahora },
      { id: 3, slug: "studio-21", nombre: "Studio 21 Barbershop", nombre_corto: "Studio 21", whatsapp: "595983000000",
        direccion: "Ruta Mcal. Estigarribia km 12, Luque", horario: U.HORARIO_BASE, intervalo: 30, dias_anticipacion: 21,
        margen_minutos: 30, activo: true, vence_el: U.addDays(U.hoy(), -12), creado_en: ahora },
    ];
    const miembros = [
      { email: "dueno@blacklabel.demo", negocio_id: 1 },
      { email: "dueno@elpatron.demo", negocio_id: 2 },
      { email: "dueno@studio21.demo", negocio_id: 3 },
    ];
    let sid = 0, bid = 0;
    const S = (negocio_id, nombre, descripcion, duracion, precio) => ({ id: ++sid, negocio_id, nombre, descripcion, duracion, precio, activo: true, orden: sid });
    const B = (negocio_id, nombre, especialidad) => ({ id: ++bid, negocio_id, nombre, especialidad, activo: true });
    const servicios = [
      S(1, "Corte clásico", "Tijera y máquina, lavado incluido.", 30, 50000),
      S(1, "Fade / Degradé", "Degradé a navaja con terminación prolija.", 45, 60000),
      S(1, "Barba", "Perfilado, toalla caliente y aceites.", 30, 40000),
      S(1, "Corte niño", "Hasta 12 años.", 30, 40000),
      S(1, "Perfilado de cejas", "Con navaja o pinza.", 15, 15000),
      S(1, "Lavado y peinado", "Lavado, masaje capilar y productos de styling.", 15, 20000),
      S(2, "Corte", "Máquina y tijera.", 30, 45000),
      S(2, "Barba", "Navaja y toalla caliente.", 30, 35000),
      S(2, "Corte + barba", "El combo completo.", 60, 75000),
      S(3, "Corte", "", 30, 40000),
      S(3, "Barba", "", 30, 30000),
    ];
    const barberos = [
      B(1, "Diego", "Fades y diseños"), B(1, "Matías", "Barba y clásicos"), B(1, "Lucas", "Cortes modernos"),
      B(2, "Rodrigo", "Clásicos"), B(2, "Iván", "Degradés"),
      B(3, "Fabián", ""),
    ];
    const nombres = ["Juan Benítez", "Carlos Ruiz", "Pedro Giménez", "Ale Duarte", "Fede Ortiz", "Nico Acosta", "Rodrigo Vera", "Hugo Cabrera"];
    // [hora, barbero, servicios] por local
    const patrones = {
      1: [["10:00", 1, [2]], ["11:00", 2, [1, 3]], ["15:30", 3, [1]], ["17:00", 1, [2, 3, 5]], ["18:00", 2, [3]]],
      2: [["10:30", 4, [7]], ["12:00", 5, [9]], ["16:00", 4, [8]], ["18:30", 5, [7]]],
      3: [],
    };
    const turnos = [];
    let k = 0;
    negocios.forEach((n) => {
      for (let d = -1; d <= 3; d++) {
        const fecha = U.addDays(U.hoy(), d);
        const h = horarioN(n, fecha); if (!h) continue;
        patrones[n.id].forEach(([hora, b, ids], i) => {
          const items = ids.map((id, o) => { const sv = servicios.find((x) => x.id === id);
            return { servicio_id: id, nombre: sv.nombre, precio: sv.precio, duracion: sv.duracion, orden: o + 1 }; });
          const duracion = items.reduce((a, x) => a + x.duracion, 0);
          if ((i + d) % 3 === 0 || U.toMin(hora) < U.toMin(h[0]) || U.toMin(hora) + duracion > U.toMin(h[1])) return;
          turnos.push({
            id: crypto.randomUUID(), negocio_id: n.id, codigo: codigo(),
            items, barbero_id: b, fecha, hora, duracion, precio: items.reduce((a, x) => a + x.precio, 0),
            cliente_nombre: nombres[k % nombres.length], cliente_telefono: "0981" + (100000 + (k++ % nombres.length + 1) * 7919).toString().slice(0, 6),
            nota: "", estado: d < 0 ? "completado" : (i % 2 ? "confirmado" : "pendiente"), origen: "web", creado_en: ahora,
          });
        });
      }
    });
    const s = { negocios, miembros, servicios, barberos, turnos, pagos: pagosDemo(negocios) };
    extrasDemo(s);      // clientes (de los turnos) y comisiones: antes de las ventas, que los usan
    gestionDemo(s);
    ejemplosExtras(s);  // propinas y bloqueos de ejemplo
    s.extras_ok = true;
    return s;
  }

  /* ---------------- Clientes, proveedores y bloqueos ---------------- */
  const CONSUMIDOR_FINAL = "44444401-7";
  /** Últimos 8 dígitos del celular: 0981 123 456 y +595 981 123456 son el mismo. null si tiene menos de 6 */
  const telKey = (t) => { const d = String(t || "").replace(/\D/g, ""); return d.length >= 6 ? d.slice(-8) : null; };
  /** Cliente del local con ese celular (o ese RUC). Si no existe, lo crea; si existe, completa lo que le falte */
  function clienteDe(s, nid, nombre, tel, ruc) {
    const k = telKey(tel), r = ruc && ruc !== CONSUMIDOR_FINAL ? ruc : null;
    let c = (k && s.clientes.find((x) => x.negocio_id === nid && x.tel_key === k)) ||
      (r && s.clientes.find((x) => x.negocio_id === nid && x.ruc === r));
    if (!c) {
      if (!k && (!r || !nombre || nombre === "Sin nombre")) return null;
      c = { id: nextId(s.clientes), negocio_id: nid, nombre: nombre || "Sin nombre", telefono: k ? String(tel).trim() : null, tel_key: k,
        ruc: r, nota: "", creado_en: new Date().toISOString() };
      s.clientes.push(c);
    } else {
      c.ruc = c.ruc || r;
      if (!c.tel_key && k) Object.assign(c, { tel_key: k, telefono: String(tel).trim() });
    }
    return c.id;
  }
  /** Un proveedor nuevo queda cargado en Proveedores (y al que no tenía RUC se le completa) */
  function registrarProveedor(s, nid, nombre, ruc) {
    const p = s.proveedores.find((x) => x.negocio_id === nid && x.nombre.toLowerCase() === nombre.toLowerCase());
    if (p) { p.ruc = p.ruc || ruc || ""; return; }
    s.proveedores.push({ id: nextId(s.proveedores), negocio_id: nid, nombre, ruc: ruc || "", telefono: "", contacto: "", nota: "", creado_en: new Date().toISOString() });
  }
  /** Motivo del bloqueo que pisa ese horario de ese barbero (null = libre) */
  const bloqueoEn = (s, nid, barbero_id, fecha, ini, fin) => {
    const k = (s.bloqueos || []).find((x) => x.negocio_id === nid && (x.barbero_id == null || x.barbero_id === barbero_id) &&
      fecha >= x.desde && fecha <= x.hasta && (x.ini_min == null || (x.ini_min < fin && ini < x.fin_min)));
    return k ? k.motivo || "horario bloqueado" : null;
  };
  const docBloqueo = (k) => ({ id: k.id, barbero_id: k.barbero_id, barbero_nombre: st().barberos.find((b) => b.id === k.barbero_id)?.nombre || null,
    desde: k.desde, hasta: k.hasta, hora_desde: k.ini_min == null ? null : U.fromMin(k.ini_min),
    hora_hasta: k.fin_min == null ? null : k.fin_min === 1440 ? "24:00" : U.fromMin(k.fin_min), motivo: k.motivo || null });
  /** Datos guardados antes de clientes/proveedores/bloqueos: se completan (igual que 02d_extras.sql) */
  function extrasDemo(s) {
    s.clientes ??= []; s.proveedores ??= []; s.bloqueos ??= [];
    const pct = { 1: 40, 2: 40, 3: 35, 4: 45, 5: 40, 6: 50 };
    s.barberos.forEach((b) => { b.comision ??= pct[b.id] ?? 40; b.comision_prod ??= 10; });
    s.turnos.forEach((t) => { if (t.cliente_id === undefined) t.cliente_id = clienteDe(s, t.negocio_id, t.cliente_nombre, t.cliente_telefono, null); });
    (s.ventas || []).forEach((v) => {
      v.subtotal ??= v.total; v.descuento ??= 0; v.propina ??= 0;
      if (v.cliente_id === undefined)
        v.cliente_id = (v.turno_id && s.turnos.find((t) => t.id === v.turno_id)?.cliente_id) || clienteDe(s, v.negocio_id, v.cliente_nombre, null, v.cliente_ruc);
    });
    [...(s.compras || []), ...(s.gastos || [])].forEach((x) => { if (x.proveedor) registrarProveedor(s, x.negocio_id, x.proveedor, x.proveedor_ruc); });
  }
  function ejemplosExtras(s) {
    // Propinas en algunas ventas de contado con barbero
    (s.ventas || []).filter((v) => !v.anulada && v.barbero_id && v.condicion === "contado").forEach((v, i) => { if (i % 4 === 0) v.propina = i % 8 ? 5000 : 10000; });
    // Teléfonos de los proveedores de ejemplo
    s.proveedores.forEach((p, i) => { if (!p.telefono && /Distribuidora|Insumos/.test(p.nombre)) Object.assign(p, { telefono: `021 6${i}0 ${100 + i * 37}`, contacto: ["Marcos", "Liliana", "Óscar"][i % 3] }); });
    // Bloqueos: un barbero en un curso, un trámite de dos horas y un feriado de todo el local
    const hoy = U.hoy(), b1 = s.barberos.filter((b) => b.negocio_id === 1);
    if (b1.length > 2) {
      s.bloqueos.push(
        { id: 1, negocio_id: 1, barbero_id: b1[2].id, desde: U.addDays(hoy, 4), hasta: U.addDays(hoy, 4), ini_min: null, fin_min: null, motivo: "Curso de capacitación" },
        { id: 2, negocio_id: 1, barbero_id: b1[0].id, desde: U.addDays(hoy, 2), hasta: U.addDays(hoy, 2), ini_min: 13 * 60, fin_min: 15 * 60, motivo: "Trámite personal" },
        { id: 3, negocio_id: 1, barbero_id: null, desde: U.addDays(hoy, 12), hasta: U.addDays(hoy, 12), ini_min: null, fin_min: null, motivo: "Feriado" });
    }
  }
  /** Historial de cobros de ejemplo: un pago por mes hasta el vencimiento actual de cada local */
  function pagosDemo(negocios) {
    const meses = { 1: 7, 2: 4, 3: 3 }, pagos = [];
    negocios.forEach((n) => {
      let hasta = n.vence_el;
      for (let i = 0; i < (meses[n.id] || 0) && hasta; i++) {
        const desde = U.sumarMeses(hasta, -1);
        pagos.push({ id: 0, negocio_id: n.id, fecha: U.addDays(desde, -(i % 3)), monto: cfg.precioMensual, meses: 1, desde, hasta, creado_en: new Date().toISOString() });
        hasta = desde;
      }
    });
    return pagos.sort((a, b) => a.fecha.localeCompare(b.fecha)).map((p, i) => ({ ...p, id: i + 1 }));
  }

  /* ---------------- Almacenamiento ---------------- */
  let mem = null;
  const save = (s) => {
    mem = s;
    try { localStorage.setItem(KEY, JSON.stringify(s)); }
    catch (e) { if (e.name === "QuotaExceededError") throw new Error("No hay espacio en el navegador para guardar esto (modo demo). Probá con una imagen más chica."); }
  };
  const load = () => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s) {
        if (!s.pagos) { s.pagos = pagosDemo(s.negocios); save(s); }   // datos guardados antes de los cobros
        if (!s.clientes) { extrasDemo(s); }                           // ...antes de clientes, proveedores y bloqueos
        if (!s.productos) { gestionDemo(s); save(s); }                // ...y antes de ventas, compras, gastos y stock
        if (s.bloqueos && !s.extras_ok) { extrasDemo(s); if (!s.bloqueos.length) ejemplosExtras(s); s.extras_ok = true; save(s); }
        return s;
      }
    } catch (e) { /* sin storage */ }
    const s = seed(); save(s); return s;
  };
  const st = () => (mem ??= load());
  // Otra pestaña (ej. el superadmin) cambió los datos: releer
  window.addEventListener("storage", (e) => { if (e.key === KEY) mem = null; });
  const wait = (v) => new Promise((r) => setTimeout(() => r(v), 120));
  const ss = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* sin storage */ } },
    del: (k) => { try { sessionStorage.removeItem(k); } catch (e) { /* sin storage */ } },
  };

  /* ---------------- Local activo ---------------- */
  let actual = null; // id del local con el que trabaja la página
  const usar = (id) => { actual = id; };
  const req = () => { if (!actual) throw new Error("No hay un local seleccionado."); return actual; };
  const negocioActual = () => st().negocios.find((n) => n.id === req());
  const deLocal = (x) => x.negocio_id === req();

  const libre = (t, ignorarId) => !st().turnos.some((o) =>
    o.id !== ignorarId && o.barbero_id === t.barbero_id && o.fecha === t.fecha && o.estado !== "cancelado" &&
    U.overlap(U.toMin(t.hora), U.toMin(t.hora) + t.duracion, U.toMin(o.hora), U.toMin(o.hora) + o.duracion));
  const join = (t) => {
    const b = st().barberos.find((x) => x.id === t.barbero_id);
    const v = (st().ventas || []).find((x) => x.turno_id === t.id && !x.anulada);
    return conServicios({ ...t, barbero: b && { nombre: b.nombre }, cobro: v ? { id: v.id, numero: v.numero, tipo: v.tipo } : null });
  };
  /** Valida los servicios elegidos (del local activo) y arma la "foto" de nombre/precio/duración */
  const armarItems = (servicio_ids) => {
    const ids = [...new Set((servicio_ids || []).map(Number))];
    if (!ids.length) throw new Error("Elegí al menos un servicio.");
    if (ids.length > MAX_SERVICIOS) throw new Error(`Podés elegir hasta ${MAX_SERVICIOS} servicios por turno.`);
    return ids.map((id, o) => {
      const sv = st().servicios.find((x) => x.id === id && x.activo && deLocal(x));
      if (!sv) throw new Error("Alguno de los servicios elegidos ya no está disponible.");
      return { servicio_id: sv.id, nombre: sv.nombre, precio: sv.precio, duracion: sv.duracion, orden: o + 1 };
    });
  };
  const minAhora = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  /** La reserva (o el cambio) del cliente solo puede caer dentro del horario, del rango de días y con el aviso mínimo */
  const horarioWeb = (fecha, hora, duracion) => {
    const n = negocioActual(), h = /^\d{4}-\d{2}-\d{2}$/.test(fecha || "") && horarioN(n, fecha);
    const ini = /^\d{2}:\d{2}$/.test(hora || "") ? U.toMin(hora) : -1;
    const dias = h ? U.diasEntre(U.hoy(), fecha) : -1;
    if (!h || ini < U.toMin(h[0]) || ini + duracion > U.toMin(h[1]) || dias < 0 || dias >= n.dias_anticipacion ||
        (dias === 0 && ini < minAhora() + (n.margen_minutos ?? 30)))
      throw new Error("Ese horario no está disponible. Elegí otro.");
  };

  /* ----- Mi turno (el cliente): ver, cambiar o cancelar con su link o su código ----- */
  const MAX_CAMBIOS = 3;
  const NO_EDITABLE = "Este turno ya no se puede cambiar ni cancelar desde acá. Escribinos por WhatsApp.";
  /** Pendiente o confirmado, y falta al menos el aviso mínimo del local */
  const editable = (t) => {
    if (!["pendiente", "confirmado"].includes(t.estado)) return false;
    const n = st().negocios.find((x) => x.id === t.negocio_id);
    return t.fecha > U.hoy() || (t.fecha === U.hoy() && U.toMin(t.hora) >= minAhora() + (n?.margen_minutos ?? 30));
  };
  /** Lo que ve el cliente: sin teléfono ni nota */
  const turnoCliente = (t) => {
    const b = st().barberos.find((x) => x.id === t.barbero_id);
    const { cliente_telefono, nota, origen, creado_en, ...resto } = conServicios(t);
    return { ...resto, cambios: t.cambios || 0, cancelado_por: t.cancelado_por || null, max_cambios: MAX_CAMBIOS,
      barbero: b && { nombre: b.nombre }, editable: editable(t) };
  };
  const turnoDelCliente = (id) => {
    const t = st().turnos.find((x) => x.id === id && deLocal(x));
    if (!t) throw new Error("Turno no encontrado.");
    return t;
  };
  /** Últimos dígitos del celular: 0981 123 456 y +595 981 123456 son el mismo número */
  const mismoCelular = (a, b) => {
    const x = String(a || "").replace(/\D/g, ""), y = String(b || "").replace(/\D/g, ""), k = Math.min(8, y.length);
    return k >= 6 && x.slice(-k) === y.slice(-k);
  };

  /** Crea el turno (con uno o varios barberos candidatos) y lo guarda */
  const nuevoTurno = (r, candidatos, estado, origen) => {
    const s = st(), items = armarItems(r.servicio_ids);
    const base = { items, fecha: r.fecha, hora: r.hora,
      duracion: items.reduce((a, x) => a + x.duracion, 0), precio: items.reduce((a, x) => a + x.precio, 0) };
    if (origen === "web") horarioWeb(r.fecha, r.hora, base.duracion);
    const validos = candidatos.filter((id) => s.barberos.some((b) => b.id === id && deLocal(b)));
    const ini = U.toMin(base.hora), fin = ini + base.duracion;
    const b = validos.find((id) => libre({ ...base, barbero_id: id }) && !bloqueoEn(s, req(), id, base.fecha, ini, fin));
    if (!b) {
      const mot = validos.length === 1 && libre({ ...base, barbero_id: validos[0] }) && bloqueoEn(s, req(), validos[0], base.fecha, ini, fin);
      if (mot) throw new Error(`Ese horario está bloqueado (${mot}). Elegí otro.`);
      throw new Error(candidatos.length > 1 ? "Ese horario se acaba de ocupar. Elegí otro." : "Ese horario ya está ocupado para ese barbero.");
    }
    const t = { ...base, id: crypto.randomUUID(), negocio_id: req(), codigo: codigo(),
      barbero_id: b, cliente_nombre: r.cliente_nombre.trim(), cliente_telefono: r.cliente_telefono.trim(),
      cliente_id: clienteDe(s, req(), r.cliente_nombre.trim(), r.cliente_telefono.trim(), null),
      nota: (r.nota || "").trim(), estado, origen, creado_en: new Date().toISOString() };
    s.turnos.push(t); save(s);
    return t;
  };
  /** Días en que todo el local está cerrado (vacaciones, feriados): la reserva los muestra como cerrados */
  const cierresDe = (nid) => (st().bloqueos || []).filter((k) => k.negocio_id === nid && k.barbero_id == null && k.ini_min == null && k.hasta >= U.hoy())
    .sort((a, b) => a.desde.localeCompare(b.desde)).map(({ desde, hasta, motivo }) => ({ desde, hasta, motivo: motivo || null }));
  const publico = (n) => n && ({ ...n, estado: U.estadoNegocio(n), cierres: cierresDe(n.id) });
  const precioDe = (n) => n.precio ?? cfg.precioMensual;
  const validarMonto = (v) => {
    const m = Number(v);
    if (!Number.isInteger(m) || m < 0 || m > 100000000) throw new Error("Ingresá un monto válido en guaraníes (sin puntos ni decimales).");
    return m;
  };

  /* ---------------- Sesión del dueño ---------------- */
  const sesionNegocio = () => {
    const id = Number(ss.get("demo_sesion"));
    return id && st().negocios.some((n) => n.id === id) ? id : null;
  };
  const soloDueno = () => {
    const id = sesionNegocio();
    if (!id || id !== actual) throw new Error("Tu sesión terminó. Volvé a ingresar.");
  };

  /* ---------------- Superadmin ---------------- */
  const soloSuper = () => { if (ss.get("demo_super") !== "1") throw new Error("Tu sesión terminó. Volvé a ingresar."); };
  function validarSlug(slug, exceptoId) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 40)
      throw new Error("El link solo puede tener letras minúsculas, números y guiones (3 a 40 caracteres).");
    if (RESERVADOS.includes(slug)) throw new Error(`«${slug}» es una palabra reservada. Elegí otro link.`);
    if (st().negocios.some((n) => n.slug === slug && n.id !== exceptoId)) throw new Error("Ese link ya lo usa otro local.");
  }
  function validarEmail(email) {
    const e = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error("Ingresá un email válido para el dueño.");
    return e;
  }
  function asignarDueno(s, negocio_id, email) {
    const otro = s.miembros.find((m) => m.email === email && m.negocio_id !== negocio_id);
    if (otro) throw new Error("Ese email ya es dueño de otro local.");
    s.miembros = s.miembros.filter((m) => m.negocio_id !== negocio_id);
    s.miembros.push({ email, negocio_id });
  }

  /* ================= Gestión del local: stock, compras, gastos y ventas =================
     Toda la lógica vive acá (y en el modo online, en la base): la página solo muestra. */
  const FORMAS_PAGO = ["efectivo", "debito", "credito", "transferencia", "qr"];
  const AJUSTES = { uso: -1, perdida: -1, ingreso: 1, conteo: 0 };
  const texto = (v, max, que, min = 0) => {
    const s = String(v ?? "").trim();
    if (s.length < min) throw new Error(`Completá ${que}.`);
    if (s.length > max) throw new Error(`Revisá ${que}: es demasiado largo (máximo ${max} caracteres).`);
    return s;
  };
  const entero = (v, min, max, msg) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(msg);
    return n;
  };
  const fechaOk = (f, que) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f || "") || isNaN(U.parse(f))) throw new Error(`Revisá la fecha ${que}.`);
    if (f > U.hoy()) throw new Error(`La fecha ${que} no puede ser futura.`);
    return f;
  };
  const rucOk = (v, que = "El RUC o la cédula") => {
    const r = String(v ?? "").trim().replace(/\./g, "");
    if (r && !/^\d{3,9}(-\d)?$/.test(r)) throw new Error(`${que}: escribilo sin puntos, ej. 1234567-8 (RUC) o 1234567 (cédula).`);
    return r;
  };
  const pagoOk = (condicion, forma) => {
    if (!["contado", "credito"].includes(condicion)) throw new Error("Elegí la condición: contado o crédito.");
    if (condicion === "contado" && !FORMAS_PAGO.includes(forma)) throw new Error("Elegí la forma de pago.");
    return condicion === "contado" ? forma : null;
  };
  /** IVA incluido en un monto (Paraguay: los precios ya incluyen IVA) */
  const ivaDe = (monto, tasa) => (tasa === 10 ? Math.round(monto / 11) : tasa === 5 ? Math.round(monto / 21) : 0);
  /** Totales por tasa. El descuento se reparte en proporción entre exentas, 5 % y 10 % (el IVA sale sobre lo cobrado) */
  const totales = (lineas, descuento = 0) => {
    const t = { total: 0, exenta: 0, grav5: 0, grav10: 0 };
    lineas.forEach((l) => { const m = l.cantidad * l.precio; t.total += m; t[l.iva === 10 ? "grav10" : l.iva === 5 ? "grav5" : "exenta"] += m; });
    const subtotal = t.total;
    if (descuento > 0) {
      const d = { exenta: Math.round(descuento * t.exenta / subtotal), grav5: Math.round(descuento * t.grav5 / subtotal), grav10: Math.round(descuento * t.grav10 / subtotal) };
      const mayor = t.grav10 >= t.grav5 && t.grav10 >= t.exenta ? "grav10" : t.grav5 >= t.exenta ? "grav5" : "exenta";
      d[mayor] += descuento - d.exenta - d.grav5 - d.grav10; // lo que quedó por redondeo
      ["exenta", "grav5", "grav10"].forEach((k) => { t[k] -= d[k]; });
      t.total = subtotal - descuento;
    }
    return { ...t, subtotal, descuento, iva5: ivaDe(t.grav5, 5), iva10: ivaDe(t.grav10, 10) };
  };
  /** Mueve el stock de un producto y deja el registro (con el saldo que queda) */
  const mover = (s, p, tipo, cantidad, fecha, ref, nota) => {
    p.stock += cantidad;
    s.movimientos.push({ id: nextId(s.movimientos), negocio_id: p.negocio_id, producto_id: p.id, fecha, en: new Date().toISOString(),
      tipo, cantidad, saldo: p.stock, ref: ref || null, nota: nota || null });
  };
  const ahoraHora = () => { const d = new Date(); return U.fromMin(d.getHours() * 60 + d.getMinutes()); };
  /** El local tiene todos los datos del timbrado para emitir facturas */
  const facturaLista = (f) => Boolean(f && f.razon_social && f.ruc && f.timbrado && f.desde && f.hasta && f.establecimiento && f.punto && f.proximo);

  function _producto(s, nid, id, d) {
    const datos = {};
    if (!id || "nombre" in d) datos.nombre = texto(d.nombre, 60, "el nombre del producto", 2);
    if (!id || "tipo" in d) { if (!["venta", "insumo"].includes(d.tipo)) throw new Error("Elegí si el producto es para vender o de uso interno."); datos.tipo = d.tipo; }
    if (!id || "unidad" in d) datos.unidad = texto(d.unidad || "unidad", 15, "la unidad");
    if (!id || "precio" in d) datos.precio = validarMonto(d.precio ?? 0);
    if (!id || "costo" in d) datos.costo = validarMonto(d.costo ?? 0);
    if (!id || "minimo" in d) datos.minimo = entero(d.minimo ?? 0, 0, 99999, "El stock mínimo tiene que ser un número entero.");
    if (!id || "iva" in d) { datos.iva = Number(d.iva ?? 10); if (![0, 5, 10].includes(datos.iva)) throw new Error("Elegí el IVA: 10 %, 5 % o exenta."); }
    if ("activo" in d) datos.activo = Boolean(d.activo);
    if (datos.nombre && s.productos.some((p) => p.negocio_id === nid && p.id !== id && p.nombre.toLowerCase() === datos.nombre.toLowerCase()))
      throw new Error("Ya tenés un producto con ese nombre.");
    if (id) {
      const p = s.productos.find((x) => x.id === id && x.negocio_id === nid);
      if (!p) throw new Error("Producto no encontrado");
      return Object.assign(p, datos);
    }
    const inicial = entero(d.stock ?? 0, 0, 99999, "El stock inicial tiene que ser un número entero.");
    const p = { activo: true, ...datos, id: nextId(s.productos), negocio_id: nid, stock: 0, creado_en: new Date().toISOString() };
    s.productos.push(p);
    if (inicial) mover(s, p, "inicial", inicial, d.fecha || U.hoy(), null, "Stock inicial");
    return p;
  }

  function _compra(s, nid, c) {
    const fecha = fechaOk(c.fecha, "de la compra");
    const proveedor = texto(c.proveedor, 80, "el proveedor", 2);
    const forma_pago = pagoOk(c.condicion, c.forma_pago);
    const items = c.items || [];
    if (!items.length) throw new Error("Agregá al menos un producto a la compra.");
    if (items.length > 40) throw new Error("Una compra puede tener hasta 40 productos.");
    const vistos = new Set();
    const lineas = items.map((i) => {
      const p = s.productos.find((x) => x.id === Number(i.producto_id) && x.negocio_id === nid);
      if (!p) throw new Error("Alguno de los productos ya no existe.");
      if (vistos.has(p.id)) throw new Error(`«${p.nombre}» está dos veces: sumá las cantidades en una sola línea.`);
      vistos.add(p.id);
      return { producto_id: p.id, descripcion: p.nombre, cantidad: entero(i.cantidad, 1, 99999, "Revisá las cantidades (números enteros)."),
        precio: validarMonto(i.costo), iva: p.iva };
    });
    const compra = { id: nextId(s.compras), negocio_id: nid, fecha, proveedor, proveedor_ruc: rucOk(c.proveedor_ruc, "El RUC del proveedor"),
      numero: texto(c.numero, 20, "el número de factura del proveedor"), condicion: c.condicion, forma_pago, items: lineas, ...totales(lineas),
      nota: texto(c.nota, 300, "la nota"), anulada: false, creado_en: new Date().toISOString() };
    s.compras.push(compra);
    lineas.forEach((l) => {
      const p = s.productos.find((x) => x.id === l.producto_id);
      mover(s, p, "compra", l.cantidad, fecha, `Compra a ${proveedor}${compra.numero ? " · " + compra.numero : ""}`);
      p.costo = l.precio; // último costo de compra
    });
    registrarProveedor(s, nid, proveedor, compra.proveedor_ruc);
    return compra;
  }

  function _venta(s, nid, v) {
    const n = s.negocios.find((x) => x.id === nid);
    const fecha = fechaOk(v.fecha || U.hoy(), "de la venta");
    const items = v.items || [];
    if (!items.length) throw new Error("Agregá al menos un servicio o producto.");
    if (items.length > 30) throw new Error("Un comprobante puede tener hasta 30 líneas.");
    const lineas = items.map((i) => {
      const cantidad = entero(i.cantidad, 1, 999, "Revisá las cantidades (números enteros).");
      const precio = validarMonto(i.precio);
      if (i.tipo === "servicio") {
        const sv = s.servicios.find((x) => x.id === Number(i.id) && x.negocio_id === nid);
        if (!sv) throw new Error("Alguno de los servicios ya no existe.");
        return { tipo: "servicio", ref_id: sv.id, descripcion: sv.nombre, cantidad, precio, iva: 10 };
      }
      const p = s.productos.find((x) => x.id === Number(i.id) && x.negocio_id === nid && x.tipo === "venta");
      if (i.tipo !== "producto" || !p) throw new Error("Alguno de los productos ya no está disponible.");
      return { tipo: "producto", ref_id: p.id, descripcion: p.nombre, cantidad, precio, iva: p.iva };
    });
    const subtotal = lineas.reduce((a, l) => a + l.cantidad * l.precio, 0);
    const descuento = v.descuento ? validarMonto(v.descuento) : 0;
    if (descuento && descuento >= subtotal) throw new Error("El descuento tiene que ser menor que el total.");
    // Stock suficiente (sumando si un producto aparece en varias líneas)
    const porProducto = {};
    lineas.filter((l) => l.tipo === "producto").forEach((l) => { porProducto[l.ref_id] = (porProducto[l.ref_id] || 0) + l.cantidad; });
    Object.entries(porProducto).forEach(([pid, cant]) => {
      const p = s.productos.find((x) => x.id === Number(pid));
      if (p.stock < cant) throw new Error(`No hay stock suficiente de «${p.nombre}» (quedan ${p.stock}). Cargá la compra o ajustá el stock.`);
    });
    let turno = null;
    if (v.turno_id) {
      turno = s.turnos.find((t) => t.id === v.turno_id && t.negocio_id === nid);
      if (!turno) throw new Error("Turno no encontrado");
      if (s.ventas.some((x) => x.turno_id === turno.id && !x.anulada)) throw new Error("Ese turno ya está cobrado.");
    }
    let barbero = null;
    if (v.barbero_id) {
      barbero = s.barberos.find((b) => b.id === Number(v.barbero_id) && b.negocio_id === nid);
      if (!barbero) throw new Error("Barbero no encontrado");
    }
    const forma_pago = pagoOk(v.condicion || "contado", v.forma_pago);
    // Propina: para el barbero, cobrada junto con la venta (no va en la factura)
    const propina = v.propina ? validarMonto(v.propina) : 0;
    if (propina && !barbero) throw new Error("Elegí el barbero que recibe la propina.");
    if (propina && (v.condicion || "contado") === "credito") throw new Error("La propina se registra solo en ventas al contado.");
    // Cliente: el elegido en la lista, el del turno, o uno nuevo si se cargó su RUC
    const cliente_nombre = texto(v.cliente_nombre, 100, "el nombre del cliente") || "Sin nombre", cliente_ruc = rucOk(v.cliente_ruc);
    let cliente_id = null;
    if (v.cliente_id) {
      const c = s.clientes.find((x) => x.id === Number(v.cliente_id) && x.negocio_id === nid);
      if (!c) throw new Error("Cliente no encontrado.");
      if (cliente_ruc && cliente_ruc !== CONSUMIDOR_FINAL) c.ruc = c.ruc || cliente_ruc;
      cliente_id = c.id;
    } else if (turno) cliente_id = turno.cliente_id || null;
    if (!cliente_id && cliente_ruc) cliente_id = clienteDe(s, nid, cliente_nombre, null, cliente_ruc);
    let tipo = "ticket", numero, timbrado = null;
    if (v.factura) {
      const f = n.factura;
      if (!facturaLista(f)) throw new Error("Para emitir facturas, primero cargá los datos de tu timbrado (Ventas → Timbrado).");
      if (fecha < f.desde || fecha > f.hasta) throw new Error(`La fecha está fuera de la vigencia de tu timbrado (${U.fechaLarga(f.desde)} al ${U.fechaLarga(f.hasta)}).`);
      const ultima = s.ventas.filter((x) => x.negocio_id === nid && x.tipo === "factura").reduce((m, x) => (x.fecha > m ? x.fecha : m), "");
      if (fecha < ultima) throw new Error("La fecha de una factura no puede ser anterior a la de la última factura emitida.");
      if (f.proximo > 9999999) throw new Error("Se terminó la numeración de este punto de expedición. Cargá un timbrado nuevo.");
      tipo = "factura";
      numero = `${f.establecimiento}-${f.punto}-${String(f.proximo).padStart(7, "0")}`;
      // Foto de los datos fiscales: si mañana cambia el timbrado, esta factura se sigue viendo igual
      timbrado = { numero: f.timbrado, desde: f.desde, hasta: f.hasta, ruc: f.ruc, razon_social: f.razon_social, actividad: f.actividad || "",
        direccion: f.direccion || n.direccion || "", telefono: f.telefono || n.whatsapp || "", nombre_fantasia: n.nombre };
      f.proximo++;
    } else {
      n.ticket_prox = n.ticket_prox || 1;
      numero = "T-" + String(n.ticket_prox++).padStart(6, "0");
    }
    const venta = {
      id: crypto.randomUUID(), negocio_id: nid, fecha, hora: v.hora || ahoraHora(), tipo, numero, timbrado,
      cliente_id, cliente_nombre, cliente_ruc,
      cliente_telefono: turno?.cliente_telefono || s.clientes.find((c) => c.id === cliente_id)?.telefono || null,
      condicion: v.condicion || "contado", forma_pago,
      barbero_id: barbero?.id || null, barbero_nombre: barbero?.nombre || null, turno_id: turno?.id || null,
      items: lineas, ...totales(lineas, descuento), propina, nota: texto(v.nota, 300, "la nota"), anulada: false, creado_en: new Date().toISOString(),
    };
    s.ventas.push(venta);
    lineas.filter((l) => l.tipo === "producto").forEach((l) =>
      mover(s, s.productos.find((x) => x.id === l.ref_id), "venta", -l.cantidad, fecha, `${tipo === "factura" ? "Factura" : "Ticket"} ${numero}`));
    return venta;
  }

  /** Datos de ejemplo de ventas, compras, gastos y stock (locales 1 y 2) */
  function gestionDemo(s) {
    Object.assign(s, { productos: [], movimientos: [], compras: [], gastos: [], ventas: [] });
    const hoy = U.hoy(), mes = hoy.slice(0, 8), mesAnt = U.sumarMeses(mes + "01", -1).slice(0, 8);
    const dia = (m, d) => { const f = m + String(d).padStart(2, "0"); return f > hoy ? hoy : f; };
    const catalogo = {
      1: [["Pomada mate", "venta", 85000, 50000, 4, 10], ["Cera brillo", "venta", 75000, 42000, 4, 10], ["Aceite para barba", "venta", 90000, 55000, 3, 10],
        ["Shampoo anticaspa", "venta", 60000, 35000, 2, 10], ["Hojas de navaja (caja x100)", "insumo", 0, 45000, 1, 10],
        ["Talco", "insumo", 0, 15000, 2, 10], ["Alcohol 70 % (1 L)", "insumo", 0, 18000, 2, 10], ["Capas descartables (x50)", "insumo", 0, 60000, 1, 10]],
      2: [["Pomada", "venta", 70000, 40000, 3, 10], ["Gel fijador", "venta", 35000, 18000, 3, 10], ["Hojas de navaja (caja x100)", "insumo", 0, 45000, 1, 10]],
    };
    const compras = {
      1: [[mesAnt, 6, "Distribuidora Capilar S.A.", "80012345-6", [[0, 24], [1, 16], [2, 12], [3, 8]]], [mesAnt, 8, "Insumos Barber PY", "80098765-1", [[4, 2], [5, 6], [6, 4], [7, 2]]],
        [mes, 3, "Distribuidora Capilar S.A.", "80012345-6", [[0, 12], [1, 8], [2, 6], [3, 6]]]],
      2: [[mesAnt, 10, "Distribuidora Capilar S.A.", "80012345-6", [[0, 15], [1, 20], [2, 1]]]],
    };
    Object.entries(catalogo).forEach(([nid, prods]) => {
      nid = Number(nid);
      const ids = prods.map(([nombre, tipo, precio, costo, minimo, iva]) => _producto(s, nid, null, { nombre, tipo, precio, costo, minimo, iva, unidad: "unidad" }).id);
      (compras[nid] || []).forEach(([m, d, proveedor, ruc, its], k) => _compra(s, nid, { fecha: dia(m, d), proveedor, proveedor_ruc: ruc,
        numero: `001-001-00${String(4521 + k * 37).padStart(5, "0")}`, condicion: "contado", forma_pago: k % 2 ? "transferencia" : "efectivo",
        items: its.map(([i, cantidad]) => ({ producto_id: ids[i], cantidad, costo: prods[i][3] })) }));
      // Consumo de insumos en el local
      ids.forEach((id, i) => { if (prods[i][1] === "insumo") { const p = s.productos.find((x) => x.id === id); if (p.stock > 1) mover(s, p, "uso", -1, dia(mes, 2), null, "Uso en el local"); } });
    });
    // Timbrado de ejemplo (Black Label emite facturas; El Patrón todavía no lo cargó)
    const n1 = s.negocios.find((n) => n.id === 1);
    if (n1) n1.factura = { razon_social: "Black Label S.R.L.", ruc: "80123456-7", actividad: "Peluquería y otros tratamientos de belleza",
      timbrado: "17654321", desde: U.addDays(hoy, -300), hasta: U.addDays(hoy, 65), establecimiento: "001", punto: "001", proximo: 101, direccion: "", telefono: "" };
    // Ventas: los turnos atendidos (cobrados) y algunas ventas de mostrador de días anteriores
    const pagos = ["efectivo", "efectivo", "transferencia", "debito", "qr"];
    [1, 2].forEach((nid) => {
      const servs = s.servicios.filter((x) => x.negocio_id === nid), barbs = s.barberos.filter((b) => b.negocio_id === nid);
      const prods = s.productos.filter((p) => p.negocio_id === nid && p.tipo === "venta");
      if (!servs.length || !barbs.length) return;
      let k = 0;
      for (let d = -45; d <= -2; d += 1) {
        const fecha = U.addDays(hoy, d);
        if (!(s.negocios.find((n) => n.id === nid).horario || {})[U.parse(fecha).getDay()]) continue;
        const cuantas = 7 + ((d * 7 + nid) % 4 + 4) % 4;
        for (let j = 0; j < cuantas; j++, k++) {
          const sv = servs[k % servs.length], p = prods[k % prods.length];
          const items = [{ tipo: "servicio", id: sv.id, cantidad: 1, precio: sv.precio }];
          if (k % 6 === 0 && p && p.stock > 2) items.push({ tipo: "producto", id: p.id, cantidad: 1, precio: p.precio });
          try {
            _venta(s, nid, { fecha, hora: U.fromMin(540 + j * 60), items, barbero_id: barbs[k % barbs.length].id, forma_pago: pagos[k % pagos.length],
              factura: nid === 1 && k % 3 === 0, cliente_nombre: k % 3 === 0 ? ["Juan Benítez", "Carlos Ruiz", "Pedro Giménez"][k % 3 === 0 ? (k / 3) % 3 : 0] : "",
              cliente_ruc: k % 3 === 0 ? ["4512367", "3897451-2", "5123987"][(k / 3) % 3] : "" });
          } catch (e) { /* sin stock o fuera de vigencia: se saltea */ }
        }
      }
      s.turnos.filter((t) => t.negocio_id === nid && t.estado === "completado").forEach((t, i) => {
        try {
          _venta(s, nid, { fecha: t.fecha, hora: t.hora, turno_id: t.id, barbero_id: t.barbero_id, cliente_nombre: t.cliente_nombre, forma_pago: pagos[i % pagos.length],
            factura: nid === 1 && i % 2 === 0, items: t.items.map((it) => ({ tipo: "servicio", id: it.servicio_id, cantidad: 1, precio: it.precio })) });
        } catch (e) { /* se saltea */ }
      });
    });
    // Gastos fijos del mes anterior y del actual
    const gastos = [["Alquiler", "Alquiler del local", 2500000, 1, "transferencia"], ["Luz (ANDE)", "Factura de luz", 480000, 8, "efectivo"],
      ["Agua", "ESSAP", 95000, 8, "efectivo"], ["Internet y teléfono", "Fibra 300 MB", 180000, 10, "debito"], ["Publicidad", "Promoción en Instagram", 150000, 12, "credito"],
      ["Limpieza", "Artículos de limpieza", 75000, 15, "efectivo"], ["Sueldos y comisiones", "Comisiones de barberos", 2800000, 28, "transferencia"]];
    [1, 2].forEach((nid) => {
      [mesAnt, mes].forEach((m) => gastos.forEach(([categoria, descripcion, monto, d, forma_pago]) => {
        const fecha = m + String(d).padStart(2, "0");
        if (fecha > hoy) return;
        s.gastos.push({ id: nextId(s.gastos), negocio_id: nid, fecha, categoria, descripcion, monto: nid === 1 ? monto : Math.round(monto * 0.7 / 1000) * 1000,
          condicion: "contado", forma_pago, proveedor: "", comprobante: "", creado_en: new Date().toISOString() });
      }));
    });
  }

  const api = {
    modo: "demo",
    MAX_SERVICIOS,
    usar,

    /* ----- Público ----- */
    /** Datos públicos de un local por su link. null si no existe. */
    negocioPorSlug: (slug) => wait(publico(st().negocios.find((n) => n.slug === String(slug || "").toLowerCase()) || null)),
    /** Solo demo: lista de locales para elegir cuando el link no trae ninguno */
    localesDemo: () => wait(st().negocios.map(({ slug, nombre, logo }) => ({ slug, nombre, logo }))),
    servicios: (todos) => wait(st().servicios.filter((s) => deLocal(s) && (todos || s.activo))),
    barberos: (todos) => wait(st().barberos.filter((b) => deLocal(b) && (todos || b.activo))),
    /** excluir: id del turno que se está cambiando (no cuenta como ocupado) */
    ocupados(fecha, excluir) {
      const s = st();
      const oc = s.turnos.filter((t) => deLocal(t) && t.fecha === fecha && t.estado !== "cancelado" && t.id !== excluir)
        .map(({ barbero_id, hora, duracion }) => ({ barbero_id, hora, duracion }));
      // Bloqueos (vacaciones, feriados, un barbero que falta): ocupan el horario de cada barbero afectado
      (s.bloqueos || []).filter((k) => deLocal(k) && fecha >= k.desde && fecha <= k.hasta).forEach((k) =>
        s.barberos.filter((b) => deLocal(b) && (k.barbero_id == null || k.barbero_id === b.id)).forEach((b) =>
          oc.push({ barbero_id: b.id, hora: U.fromMin(k.ini_min ?? 0), duracion: (k.fin_min ?? 1440) - (k.ini_min ?? 0) })));
      return wait(oc);
    },
    async reservar(r) {
      if (!U.estadoNegocio(negocioActual()).reserva) throw new Error("Este local no está recibiendo reservas online en este momento.");
      const candidatos = r.barbero_id ? [r.barbero_id]
        : st().barberos.filter((b) => b.activo && deLocal(b)).map((b) => b.id).sort(() => Math.random() - .5);
      const t = nuevoTurno({ ...r, cliente_nombre: r.nombre, cliente_telefono: r.telefono }, candidatos, "pendiente", "web");
      return wait({ id: t.id, codigo: t.codigo, barbero_id: t.barbero_id });
    },
    /** { id } (link) o { codigo, telefono }. Con un id que no existe devuelve null */
    async miTurno({ id, codigo: cod, telefono }) {
      if (id) { const t = st().turnos.find((x) => x.id === id && deLocal(x)); return wait(t ? turnoCliente(t) : null); }
      const c = String(cod || "").trim().toUpperCase();
      if (!c || String(telefono || "").replace(/\D/g, "").length < 6) throw new Error("Ingresá tu código de reserva y tu celular.");
      const t = st().turnos.filter((x) => deLocal(x) && x.codigo === c && mismoCelular(x.cliente_telefono, telefono))
        .sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
      if (!t) { await wait(); throw new Error("No encontramos un turno con ese código y ese celular. Revisá los datos."); }
      return wait(turnoCliente(t));
    },
    async cancelarTurno(id) {
      const s = st(), t = turnoDelCliente(id);
      if (t.estado === "cancelado") throw new Error("Este turno ya está cancelado.");
      if (!editable(t)) throw new Error(NO_EDITABLE);
      Object.assign(t, { estado: "cancelado", cancelado_por: "cliente" }); save(s);
      return wait(turnoCliente(t));
    },
    /** Mismos servicios, otro día / hora / barbero. Vuelve a quedar "pendiente" para que el local lo confirme */
    async reprogramarTurno(id, { fecha, hora, barbero_id }) {
      const s = st(), t = turnoDelCliente(id);
      if (!editable(t)) throw new Error(NO_EDITABLE);
      if ((t.cambios || 0) >= MAX_CAMBIOS) throw new Error(`Ya cambiaste este turno ${MAX_CAMBIOS} veces. Para otro cambio, escribinos por WhatsApp.`);
      if (!U.estadoNegocio(negocioActual()).reserva) throw new Error("Este local no está recibiendo cambios online en este momento. Escribinos por WhatsApp.");
      horarioWeb(fecha, hora, t.duracion);
      if (fecha === t.fecha && hora === t.hora && (!barbero_id || barbero_id === t.barbero_id)) throw new Error("Elegí un día u horario distinto al que ya tenés.");
      const activosLocal = s.barberos.filter((b) => b.activo && deLocal(b)).map((b) => b.id);
      // Sin preferencia: primero su mismo barbero, después los demás al azar
      const cand = barbero_id ? [barbero_id].filter((x) => activosLocal.includes(x))
        : activosLocal.sort(() => Math.random() - .5).sort((a, b) => (b === t.barbero_id) - (a === t.barbero_id));
      const ini = U.toMin(hora);
      const b = cand.find((bid) => libre({ ...t, fecha, hora, barbero_id: bid }, t.id) && !bloqueoEn(s, req(), bid, fecha, ini, ini + t.duracion));
      if (!b) throw new Error(cand.length > 1 ? "Ese horario se acaba de ocupar. Elegí otro." : "Ese horario ya está ocupado para ese barbero. Elegí otro.");
      Object.assign(t, { fecha, hora, barbero_id: b, estado: "pendiente", cambios: (t.cambios || 0) + 1 }); save(s);
      return wait(turnoCliente(t));
    },

    /* ----- Dueño del local ----- */
    async login(email, password) {
      const e = String(email || "").trim().toLowerCase();
      const m = st().miembros.find((x) => x.email === e);
      if (!m || password !== cfg.demoPasswordDueno) throw new Error("Email o contraseña incorrectos.");
      ss.set("demo_sesion", String(m.negocio_id));
      await wait();
    },
    async logout() { ss.del("demo_sesion"); },
    /** El local del dueño con sesión iniciada (o null). También lo deja como local activo. */
    async miNegocio() {
      const id = sesionNegocio();
      if (!id) return wait(null);
      usar(id);
      const n = st().negocios.find((x) => x.id === id);
      return wait({ ...publico(n), dueno: st().miembros.find((m) => m.negocio_id === id)?.email || "" });
    },
    async guardarNegocio(cambios) {
      soloDueno();
      const s = st(), n = s.negocios.find((x) => x.id === actual);
      CAMPOS_DUENO.forEach((k) => { if (k in cambios) n[k] = cambios[k]; }); // el dueño no toca link, abono ni estado
      save(s); return wait(publico(n));
    },
    turnos(desde, hasta) {
      soloDueno();
      return wait(st().turnos.filter((t) => deLocal(t) && t.fecha >= desde && t.fecha <= hasta)
        .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora)).map(join));
    },
    async crearTurno(t) {
      soloDueno();
      nuevoTurno(t, [t.barbero_id], "confirmado", "local");
      return wait();
    },
    async actualizarTurno(id, cambios) {
      soloDueno();
      const s = st(), t = s.turnos.find((x) => x.id === id && deLocal(x));
      if (!t) throw new Error("Turno no encontrado");
      if (cambios.estado && cambios.estado !== "cancelado" && t.estado === "cancelado" && !libre(t, t.id))
        throw new Error("No se puede reactivar: el horario ya fue tomado.");
      const estado = cambios.estado ?? t.estado;
      const cancelado_por = estado !== "cancelado" ? null : t.estado === "cancelado" ? t.cancelado_por || null : "local";
      Object.assign(t, { estado, cancelado_por }); save(s);
    },
    async guardarBarbero({ id, ...datos }) {
      soloDueno();
      const s = st();
      if ("comision" in datos) datos.comision = entero(datos.comision, 0, 100, "La comisión por servicios tiene que ser un porcentaje entre 0 y 100.");
      if ("comision_prod" in datos) datos.comision_prod = entero(datos.comision_prod, 0, 100, "La comisión por productos tiene que ser un porcentaje entre 0 y 100.");
      if (!id) datos.comision ??= 0, datos.comision_prod ??= 0;
      if (id) { const b = s.barberos.find((x) => x.id === id && deLocal(x)); if (!b) throw new Error("Barbero no encontrado"); Object.assign(b, datos); }
      else s.barberos.push({ activo: true, ...datos, id: nextId(s.barberos), negocio_id: actual });
      save(s); return wait();
    },
    async eliminarBarbero(id) {
      soloDueno();
      const s = st();
      if (s.turnos.some((t) => t.barbero_id === id)) throw new Error("Tiene turnos registrados: desactivalo en lugar de eliminarlo.");
      s.barberos = s.barberos.filter((b) => !(b.id === id && deLocal(b))); save(s); return wait();
    },
    async guardarServicio({ id, ...datos }) {
      soloDueno();
      const s = st();
      if (id) { const x = s.servicios.find((v) => v.id === id && deLocal(v)); if (!x) throw new Error("Servicio no encontrado"); Object.assign(x, datos); }
      else s.servicios.push({ activo: true, ...datos, id: nextId(s.servicios), negocio_id: actual });
      save(s); return wait();
    },
    async eliminarServicio(id) {
      soloDueno();
      const s = st();
      if (s.turnos.some((t) => (t.items || []).some((i) => i.servicio_id === id))) throw new Error("Este servicio tiene turnos registrados: desactivalo en lugar de eliminarlo.");
      s.servicios = s.servicios.filter((x) => !(x.id === id && deLocal(x))); save(s); return wait();
    },

    /* ----- Stock (productos para vender e insumos) ----- */
    productos(todos) {
      soloDueno();
      return wait(st().productos.filter((p) => deLocal(p) && (todos || p.activo)).map((p) => ({ ...p }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre)));
    },
    async guardarProducto({ id, ...datos }) {
      soloDueno();
      const s = st(), p = _producto(s, actual, id || null, datos);
      save(s); return wait({ ...p });
    },
    async eliminarProducto(id) {
      soloDueno();
      const s = st();
      if (s.movimientos.some((m) => m.producto_id === id && m.tipo !== "inicial"))
        throw new Error("Este producto tiene compras, ventas o ajustes registrados: desactivalo en lugar de eliminarlo.");
      s.productos = s.productos.filter((p) => !(p.id === id && deLocal(p)));
      s.movimientos = s.movimientos.filter((m) => m.producto_id !== id);
      save(s); await wait();
    },
    /** tipo: uso | perdida (descuentan) · ingreso (suma) · conteo (fija el stock contado) */
    async ajustarStock(id, { tipo, cantidad, nota }) {
      soloDueno();
      const s = st(), p = s.productos.find((x) => x.id === id && deLocal(x));
      if (!p) throw new Error("Producto no encontrado");
      if (!(tipo in AJUSTES)) throw new Error("Elegí el tipo de ajuste.");
      const c = entero(cantidad, tipo === "conteo" ? 0 : 1, 99999, "Ingresá una cantidad válida (número entero).");
      const delta = tipo === "conteo" ? c - p.stock : AJUSTES[tipo] * c;
      if (tipo === "conteo" && delta === 0) throw new Error(`El stock ya es ${p.stock}: no hay nada que ajustar.`);
      if (p.stock + delta < 0) throw new Error(`No podés descontar más de lo que hay (${p.stock}).`);
      mover(s, p, tipo, delta, U.hoy(), null, texto(nota, 120, "la nota"));
      save(s); return wait({ ...p });
    },
    /** Historial de movimientos de un producto (más nuevos primero) */
    movimientos(id) {
      soloDueno();
      return wait(st().movimientos.filter((m) => m.producto_id === id && deLocal(m)).sort((a, b) => b.id - a.id));
    },

    /* ----- Compras ----- */
    compras(desde, hasta) {
      soloDueno();
      return wait(st().compras.filter((c) => deLocal(c) && c.fecha >= desde && c.fecha <= hasta)
        .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id));
    },
    /* ----- Proveedores ----- */
    /** Proveedores cargados, con lo que se les compró */
    proveedores() {
      soloDueno();
      const s = st();
      return wait(s.proveedores.filter(deLocal).map((p) => {
        const cs = s.compras.filter((c) => deLocal(c) && !c.anulada && c.proveedor.toLowerCase() === p.nombre.toLowerCase());
        return { ...p, compras: cs.length, total: cs.reduce((a, c) => a + c.total, 0), ultima: cs.map((c) => c.fecha).sort().at(-1) || null };
      }).sort((a, b) => a.nombre.localeCompare(b.nombre)));
    },
    async guardarProveedor({ id, ...d }) {
      soloDueno();
      const s = st();
      const datos = { nombre: texto(d.nombre, 80, "el nombre del proveedor", 2), ruc: rucOk(d.ruc, "El RUC del proveedor"),
        telefono: texto(d.telefono, 30, "el teléfono"), contacto: texto(d.contacto, 80, "el nombre del contacto"), nota: texto(d.nota, 300, "la nota") };
      if (datos.telefono && datos.telefono.replace(/\D/g, "").length < 6) throw new Error("Revisá el teléfono del proveedor.");
      if (s.proveedores.some((p) => deLocal(p) && p.id !== id && p.nombre.toLowerCase() === datos.nombre.toLowerCase())) throw new Error("Ya tenés un proveedor con ese nombre.");
      let p;
      if (id) {
        p = s.proveedores.find((x) => x.id === id && deLocal(x));
        if (!p) throw new Error("Proveedor no encontrado");
        // Si cambió el nombre, las compras y gastos anteriores pasan a llamarse igual
        if (p.nombre !== datos.nombre) [...s.compras, ...s.gastos].filter((x) => deLocal(x) && (x.proveedor || "").toLowerCase() === p.nombre.toLowerCase())
          .forEach((x) => { x.proveedor = datos.nombre; });
        Object.assign(p, datos);
      } else {
        p = { ...datos, id: nextId(s.proveedores), negocio_id: actual, creado_en: new Date().toISOString() };
        s.proveedores.push(p);
      }
      save(s); return wait({ id: p.id });
    },
    /** Las compras anteriores no se tocan (guardan el nombre del proveedor) */
    async eliminarProveedor(id) {
      soloDueno();
      const s = st();
      if (!s.proveedores.some((p) => p.id === id && deLocal(p))) throw new Error("Proveedor no encontrado");
      s.proveedores = s.proveedores.filter((p) => p.id !== id); save(s); await wait();
    },

    /* ----- Clientes ----- */
    /** Lista con lo que hizo cada uno: visitas (turnos atendidos + ventas sin turno), lo gastado y la última visita */
    clientes() {
      soloDueno();
      const s = st(), hoy = U.hoy();
      return wait(s.clientes.filter(deLocal).map((c) => {
        const ts = s.turnos.filter((t) => t.cliente_id === c.id), vs = s.ventas.filter((v) => v.cliente_id === c.id && !v.anulada);
        const at = ts.filter((t) => t.estado === "completado");
        return { id: c.id, nombre: c.nombre, telefono: c.telefono, ruc: c.ruc, nota: c.nota,
          visitas: at.length + vs.filter((v) => !v.turno_id).length, gastado: vs.reduce((a, v) => a + v.total, 0),
          ultima: [...at.map((t) => t.fecha), ...vs.map((v) => v.fecha)].sort().at(-1) || null,
          proximo: ts.filter((t) => ["pendiente", "confirmado"].includes(t.estado) && t.fecha >= hoy).map((t) => t.fecha).sort()[0] || null };
      }).sort((a, b) => a.nombre.localeCompare(b.nombre)));
    },
    /** Un cliente con su historial de turnos y comprobantes */
    cliente(id) {
      soloDueno();
      const s = st(), c = s.clientes.find((x) => x.id === id && deLocal(x));
      if (!c) throw new Error("Cliente no encontrado");
      return wait({
        cliente: { ...c },
        turnos: s.turnos.filter((t) => t.cliente_id === c.id).sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora)).map(join),
        ventas: s.ventas.filter((v) => v.cliente_id === c.id).sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora)),
      });
    },
    async guardarCliente({ id, ...d }) {
      soloDueno();
      const s = st();
      const datos = { nombre: texto(d.nombre, 100, "el nombre del cliente", 2), telefono: texto(d.telefono, 30, "el celular"),
        ruc: rucOk(d.ruc), nota: texto(d.nota, 300, "la nota") };
      datos.tel_key = telKey(datos.telefono);
      if (datos.telefono && !datos.tel_key) throw new Error("Revisá el celular: tiene que tener al menos 6 números.");
      if (datos.tel_key && s.clientes.some((c) => deLocal(c) && c.id !== id && c.tel_key === datos.tel_key)) throw new Error("Ya hay otro cliente con ese celular.");
      let c;
      if (id) { c = s.clientes.find((x) => x.id === id && deLocal(x)); if (!c) throw new Error("Cliente no encontrado"); Object.assign(c, datos); }
      else { c = { ...datos, id: nextId(s.clientes), negocio_id: actual, creado_en: new Date().toISOString() }; s.clientes.push(c); }
      save(s); return wait({ id: c.id });
    },

    /* ----- Bloqueos de horarios ----- */
    /** Bloqueos que tocan el rango (por defecto, de hoy en adelante) */
    bloqueos(desde = U.hoy(), hasta = "9999-12-31") {
      soloDueno();
      return wait((st().bloqueos || []).filter((k) => deLocal(k) && k.hasta >= desde && k.desde <= hasta)
        .sort((a, b) => a.desde.localeCompare(b.desde) || (a.ini_min ?? -1) - (b.ini_min ?? -1)).map(docBloqueo));
    },
    /** Devuelve { bloqueo, turnos }: turnos = cuántos turnos activos quedan dentro (no se cancelan solos) */
    async guardarBloqueo(d) {
      soloDueno();
      const s = st(), f = /^\d{4}-\d{2}-\d{2}$/;
      const barbero_id = d.barbero_id ? Number(d.barbero_id) : null;
      if (barbero_id && !s.barberos.some((b) => b.id === barbero_id && deLocal(b))) throw new Error("Barbero no encontrado");
      if (!f.test(d.desde || "") || !f.test(d.hasta || "")) throw new Error("Fecha inválida.");
      if (d.hasta < d.desde) throw new Error("La fecha «hasta» tiene que ser igual o posterior a «desde».");
      if (d.hasta < U.hoy()) throw new Error("Ese período ya pasó.");
      if (U.diasEntre(d.desde, d.hasta) > 366) throw new Error("Un bloqueo puede durar hasta un año.");
      if (!d.hora_desde !== !d.hora_hasta) throw new Error("Poné la hora de inicio y la de fin, o marcá «Todo el día».");
      let ini_min = null, fin_min = null;
      if (d.hora_desde) {
        if (!/^\d{2}:\d{2}$/.test(d.hora_desde) || !/^\d{2}:\d{2}$/.test(d.hora_hasta)) throw new Error("Hora inválida.");
        ini_min = U.toMin(d.hora_desde); fin_min = U.toMin(d.hora_hasta);
        if (fin_min <= ini_min) throw new Error("La hora de fin tiene que ser después de la de inicio.");
      }
      const k = { id: nextId(s.bloqueos), negocio_id: actual, barbero_id, desde: d.desde, hasta: d.hasta, ini_min, fin_min,
        motivo: texto(d.motivo, 80, "el motivo") || null, creado_en: new Date().toISOString() };
      s.bloqueos.push(k); save(s);
      const turnos = s.turnos.filter((t) => deLocal(t) && ["pendiente", "confirmado"].includes(t.estado) && t.fecha >= k.desde && t.fecha <= k.hasta &&
        (!barbero_id || t.barbero_id === barbero_id) && (ini_min == null || (U.toMin(t.hora) < fin_min && ini_min < U.toMin(t.hora) + t.duracion))).length;
      return wait({ bloqueo: docBloqueo(k), turnos });
    },
    async eliminarBloqueo(id) {
      soloDueno();
      const s = st();
      if (!s.bloqueos.some((k) => k.id === id && deLocal(k))) throw new Error("Bloqueo no encontrado");
      s.bloqueos = s.bloqueos.filter((k) => k.id !== id); save(s); await wait();
    },
    async crearCompra(c) {
      soloDueno();
      const s = st(), compra = _compra(s, actual, c);
      save(s); return wait(compra);
    },
    /** Anula una compra cargada por error: descuenta del stock lo que había sumado */
    async anularCompra(id, motivo) {
      soloDueno();
      const s = st(), c = s.compras.find((x) => x.id === id && deLocal(x));
      if (!c) throw new Error("Compra no encontrada");
      if (c.anulada) throw new Error("Esta compra ya está anulada.");
      c.items.forEach((l) => {
        const p = s.productos.find((x) => x.id === l.producto_id);
        if (p && p.stock < l.cantidad) throw new Error(`No se puede anular: de «${p.nombre}» ya se usó o vendió parte (quedan ${p.stock} de ${l.cantidad}).`);
      });
      c.items.forEach((l) => { const p = s.productos.find((x) => x.id === l.producto_id); if (p) mover(s, p, "anulacion", -l.cantidad, U.hoy(), `Anulación de compra a ${c.proveedor}`); });
      Object.assign(c, { anulada: true, anulada_motivo: texto(motivo, 200, "el motivo"), anulada_en: new Date().toISOString() });
      save(s); return wait(c);
    },

    /* ----- Gastos ----- */
    gastos(desde, hasta) {
      soloDueno();
      return wait(st().gastos.filter((g) => deLocal(g) && g.fecha >= desde && g.fecha <= hasta)
        .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id));
    },
    async guardarGasto({ id, ...d }) {
      soloDueno();
      const s = st();
      if (!cfg.categoriasGasto.includes(d.categoria)) throw new Error("Elegí la categoría del gasto.");
      const monto = validarMonto(d.monto);
      if (!monto) throw new Error("Ingresá el monto del gasto.");
      const datos = { fecha: fechaOk(d.fecha, "del gasto"), categoria: d.categoria, descripcion: texto(d.descripcion, 120, "la descripción", 2), monto,
        condicion: d.condicion || "contado", forma_pago: pagoOk(d.condicion || "contado", d.forma_pago),
        proveedor: texto(d.proveedor, 80, "el proveedor"), comprobante: texto(d.comprobante, 30, "el comprobante") };
      let g;
      if (id) { g = s.gastos.find((x) => x.id === id && deLocal(x)); if (!g) throw new Error("Gasto no encontrado"); Object.assign(g, datos); }
      else { g = { ...datos, id: nextId(s.gastos), negocio_id: actual, creado_en: new Date().toISOString() }; s.gastos.push(g); }
      save(s); return wait(g);
    },
    async eliminarGasto(id) {
      soloDueno();
      const s = st();
      if (!s.gastos.some((g) => g.id === id && deLocal(g))) throw new Error("Gasto no encontrado");
      s.gastos = s.gastos.filter((g) => g.id !== id); save(s); await wait();
    },

    /* ----- Ventas y facturación ----- */
    ventas(desde, hasta) {
      soloDueno();
      return wait(st().ventas.filter((v) => deLocal(v) && v.fecha >= desde && v.fecha <= hasta)
        .sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora) || b.creado_en.localeCompare(a.creado_en)));
    },
    venta(id) {
      soloDueno();
      const v = st().ventas.find((x) => x.id === id && deLocal(x));
      if (!v) throw new Error("Comprobante no encontrado");
      return wait(v);
    },
    /** Cobra servicios y/o productos: descuenta stock y emite factura (con timbrado) o ticket interno */
    async crearVenta(v) {
      soloDueno();
      const s = st(), venta = _venta(s, actual, v);
      save(s); return wait({ venta, factura: negocioActual().factura || null });
    },
    /** La factura anulada conserva su número (así lo pide la numeración correlativa); el stock vuelve */
    async anularVenta(id, motivo) {
      soloDueno();
      const s = st(), v = s.ventas.find((x) => x.id === id && deLocal(x));
      if (!v) throw new Error("Comprobante no encontrado");
      if (v.anulada) throw new Error("Este comprobante ya está anulado.");
      const m = texto(motivo, 200, "el motivo de la anulación", 3);
      v.items.filter((l) => l.tipo === "producto").forEach((l) => {
        const p = s.productos.find((x) => x.id === l.ref_id);
        if (p) mover(s, p, "anulacion", l.cantidad, U.hoy(), `Anulación ${v.tipo === "factura" ? "factura" : "ticket"} ${v.numero}`);
      });
      Object.assign(v, { anulada: true, anulada_motivo: m, anulada_en: new Date().toISOString() });
      save(s); return wait(v);
    },
    /** Datos del timbrado (los carga el dueño desde Ventas → Timbrado) */
    async guardarFacturacion(f) {
      soloDueno();
      const s = st(), n = negocioActual();
      const datos = {
        razon_social: texto(f.razon_social, 100, "la razón social", 2),
        ruc: rucOk(f.ruc, "El RUC"),
        actividad: texto(f.actividad, 120, "la actividad económica"),
        timbrado: String(f.timbrado || "").trim(),
        desde: f.desde, hasta: f.hasta,
        establecimiento: String(f.establecimiento || "").trim(), punto: String(f.punto || "").trim(),
        proximo: entero(f.proximo, 1, 9999999, "El próximo número de factura tiene que ser un número entre 1 y 9.999.999."),
        direccion: texto(f.direccion, 120, "la dirección"), telefono: texto(f.telefono, 30, "el teléfono"),
      };
      if (!/^\d+-\d$/.test(datos.ruc)) throw new Error("El RUC tiene que tener el dígito verificador, ej. 80012345-6.");
      if (!/^\d{8}$/.test(datos.timbrado)) throw new Error("El número de timbrado tiene 8 dígitos.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.desde || "") || !/^\d{4}-\d{2}-\d{2}$/.test(datos.hasta || "") || datos.hasta < datos.desde)
        throw new Error("Revisá la vigencia del timbrado: el fin tiene que ser después del inicio.");
      if (!/^\d{3}$/.test(datos.establecimiento) || !/^\d{3}$/.test(datos.punto)) throw new Error("El establecimiento y el punto de expedición tienen 3 dígitos (ej. 001).");
      const pref = `${datos.establecimiento}-${datos.punto}-`;
      const ultimo = s.ventas.filter((v) => v.negocio_id === actual && v.tipo === "factura" && v.timbrado?.numero === datos.timbrado && v.numero.startsWith(pref))
        .reduce((m, v) => Math.max(m, Number(v.numero.slice(8))), 0);
      if (datos.proximo <= ultimo) throw new Error(`Con este timbrado ya emitiste hasta la ${pref}${String(ultimo).padStart(7, "0")}: el próximo número tiene que ser mayor.`);
      n.factura = datos;
      save(s); return wait(datos);
    },

    /* ----- Superadmin (vos) ----- */
    async superLogin(_email, password) {
      if (password !== cfg.demoPasswordSuper) throw new Error("Contraseña incorrecta.");
      ss.set("demo_super", "1"); await wait();
    },
    async superLogout() { ss.del("demo_super"); },
    esSuper: async () => ss.get("demo_super") === "1",
    /** Todos los locales con su dueño y números para el resumen */
    async superNegocios() {
      soloSuper();
      const s = st(), desde = U.addDays(U.hoy(), -30);
      return wait(s.negocios.map((n) => {
        const ts = s.turnos.filter((t) => t.negocio_id === n.id && t.estado !== "cancelado");
        return {
          ...publico(n),
          dueno: s.miembros.find((m) => m.negocio_id === n.id)?.email || "",
          precio: precioDe(n),
          barberos: s.barberos.filter((b) => b.negocio_id === n.id && b.activo).length,
          servicios: s.servicios.filter((x) => x.negocio_id === n.id && x.activo).length,
          turnos30: ts.filter((t) => t.fecha >= desde && t.fecha <= U.hoy()).length,
          proximos: ts.filter((t) => t.fecha > U.hoy() || (t.fecha === U.hoy() && ["pendiente", "confirmado"].includes(t.estado))).length,
        };
      }).sort((a, b) => a.nombre.localeCompare(b.nombre)));
    },
    async superCrearNegocio({ nombre, slug, dueno, vence_el, precio }) {
      soloSuper();
      const s = st();
      nombre = String(nombre || "").trim();
      if (nombre.length < 2) throw new Error("Ingresá el nombre del local.");
      validarSlug(slug);
      const email = validarEmail(dueno);
      const n = { id: nextId(s.negocios), slug, nombre, nombre_corto: nombre.split(/\s+/).slice(0, 2).join(" "),
        whatsapp: "", direccion: "", horario: U.HORARIO_BASE, intervalo: 30, dias_anticipacion: 21, margen_minutos: 30,
        activo: true, vence_el: vence_el || null, precio: validarMonto(precio ?? cfg.precioMensual), creado_en: new Date().toISOString() };
      asignarDueno(s, n.id, email);
      s.negocios.push(n); save(s);
      return wait(publico(n));
    },
    async superGuardarNegocio(id, cambios) {
      soloSuper();
      const s = st(), n = s.negocios.find((x) => x.id === id);
      if (!n) throw new Error("Local no encontrado");
      if ("slug" in cambios && cambios.slug !== n.slug) validarSlug(cambios.slug, id);
      if ("dueno" in cambios) asignarDueno(s, id, validarEmail(cambios.dueno));
      if ("precio" in cambios) cambios.precio = validarMonto(cambios.precio);
      ["nombre", "slug", "activo", "vence_el", "precio"].forEach((k) => { if (k in cambios) n[k] = cambios[k]; });
      save(s); return wait(publico(n));
    },

    /* ----- Cobros del abono ----- */
    /** Registra un pago y extiende el vencimiento (desde el vencimiento actual, o desde hoy si ya venció) */
    async superRegistrarPago(id, { monto, meses = 1, fecha = U.hoy() }) {
      soloSuper();
      const s = st(), n = s.negocios.find((x) => x.id === id);
      if (!n) throw new Error("Local no encontrado");
      meses = Number(meses);
      if (!Number.isInteger(meses) || meses < 1 || meses > 24) throw new Error("Elegí cuántos meses paga.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || "") || fecha > U.hoy()) throw new Error("La fecha del pago no puede ser futura.");
      const desde = !n.vence_el || n.vence_el < U.hoy() ? U.hoy() : n.vence_el;
      const pago = { id: nextId(s.pagos), negocio_id: id, fecha, monto: validarMonto(monto), meses, desde,
        hasta: U.sumarMeses(desde, meses), creado_en: new Date().toISOString() };
      s.pagos.push(pago);
      n.vence_el = pago.hasta; n.activo = true;
      save(s); return wait({ pago, negocio: publico(n) });
    },
    /** Todos los pagos (más nuevos primero) con el nombre del local */
    async superPagos() {
      soloSuper();
      const s = st();
      return wait(s.pagos.map((p) => ({ ...p, local: s.negocios.find((n) => n.id === p.negocio_id)?.nombre || "(local borrado)" }))
        .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id));
    },
    /** Borra un pago cargado por error. No cambia el vencimiento (se corrige editando el local) */
    async superEliminarPago(id) {
      soloSuper();
      const s = st(), i = s.pagos.findIndex((p) => p.id === id);
      if (i < 0) throw new Error("Pago no encontrado");
      s.pagos.splice(i, 1); save(s); await wait();
    },
    slugLibre: (slug, exceptoId) => { try { validarSlug(slug, exceptoId); return null; } catch (e) { return e.message; } },

    /** Borra los datos demo (desde la consola: DB.reset() y recargar) */
    reset() { try { localStorage.removeItem(KEY); } catch (e) { /* sin storage */ } mem = null; },
  };
  return api;
})();
