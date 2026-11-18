/* ============================================================
   CAPA DE DATOS
   - Modo ONLINE: Supabase (si config.js tiene URL y clave)
   - Modo DEMO:   localStorage del navegador
   Ambas exponen exactamente las mismas funciones.
   ============================================================ */
const DB = (() => {
  const cfg = window.APP_CONFIG;
  const online = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const sb = online ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

  const fail = (error, fallback = "Ocurrió un error. Probá de nuevo.") => {
    if (!error) return;
    if (error.code === "23P01") throw new Error("Ese horario ya está ocupado para ese barbero.");
    throw new Error(error.message || fallback);
  };
  const normTurno = (t) => ({ ...t, hora: U.hhmm(t.hora) });
  /** Agrega a un turno el resumen de sus servicios: t.servicio = { nombre: "A + B", precio: total } */
  const conServicios = (t) => {
    const items = [...(t.items || [])].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    return { ...t, items, servicio: { nombre: items.map((i) => i.nombre).join(" + "), precio: t.precio ?? 0 } };
  };
  const MAX_SERVICIOS = 6;

  /* ---------------- ONLINE (Supabase) ---------------- */
  const remote = {
    async servicios(todos = false) {
      let q = sb.from("servicios").select("*").order("orden").order("id");
      if (!todos) q = q.eq("activo", true);
      const { data, error } = await q; fail(error); return data;
    },
    async barberos(todos = false) {
      let q = sb.from("barberos").select("*").order("id");
      if (!todos) q = q.eq("activo", true);
      const { data, error } = await q; fail(error); return data;
    },
    async ocupados(fecha) {
      const { data, error } = await sb.rpc("horarios_ocupados", { p_fecha: fecha });
      fail(error); return data.map(normTurno);
    },
    async reservar(r) {
      const { data, error } = await sb.rpc("reservar_turno", {
        p_servicio_ids: r.servicio_ids, p_barbero_id: r.barbero_id, p_fecha: r.fecha, p_hora: r.hora,
        p_nombre: r.nombre, p_telefono: r.telefono, p_nota: r.nota || null,
      });
      fail(error);
      return { codigo: data[0].out_codigo, barbero_id: data[0].out_barbero_id };
    },
    async login(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error("Email o contraseña incorrectos.");
      if (!(await remote.esAdmin())) { await sb.auth.signOut(); throw new Error("Este usuario no tiene permisos de administrador."); }
    },
    async logout() { await sb.auth.signOut(); },
    async esAdmin() {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return false;
      const { data, error } = await sb.rpc("es_admin");
      return !error && data === true;
    },
    async turnos(desde, hasta) {
      const { data, error } = await sb.from("turnos")
        .select("*, items:turno_servicios(servicio_id,nombre,precio,duracion,orden), barbero:barberos(nombre)")
        .gte("fecha", desde).lte("fecha", hasta).order("fecha").order("hora");
      fail(error); return data.map((t) => conServicios(normTurno(t)));
    },
    async crearTurno(t) {
      const { error } = await sb.rpc("crear_turno_admin", {
        p_servicio_ids: t.servicio_ids, p_barbero_id: t.barbero_id, p_fecha: t.fecha, p_hora: t.hora,
        p_nombre: t.cliente_nombre, p_telefono: t.cliente_telefono, p_nota: t.nota || null,
      });
      fail(error);
    },
    async actualizarTurno(id, cambios) {
      const { error } = await sb.from("turnos").update(cambios).eq("id", id); fail(error);
    },
    async guardarBarbero({ id, ...datos }) {
      const { error } = id
        ? await sb.from("barberos").update(datos).eq("id", id)
        : await sb.from("barberos").insert(datos);
      fail(error);
    },
    async eliminarBarbero(id) {
      const { error } = await sb.from("barberos").delete().eq("id", id);
      if (error?.code === "23503") throw new Error("Tiene turnos registrados: desactivalo en lugar de eliminarlo.");
      fail(error);
    },
    async guardarServicio({ id, ...datos }) {
      const { error } = id
        ? await sb.from("servicios").update(datos).eq("id", id)
        : await sb.from("servicios").insert(datos);
      fail(error);
    },
    async eliminarServicio(id) {
      const { error } = await sb.from("servicios").delete().eq("id", id);
      if (error?.code === "23503") throw new Error("Este servicio tiene turnos registrados: desactivalo en lugar de eliminarlo.");
      fail(error);
    },
  };

  /* ---------------- DEMO (localStorage) ---------------- */
  const KEY = "turnos_barber_demo_v2"; // v2: turnos con varios servicios
  const seed = () => {
    const servicios = [
      { id: 1, nombre: "Corte clásico", descripcion: "Tijera y máquina, lavado incluido.", duracion: 30, precio: 50000, activo: true, orden: 1 },
      { id: 2, nombre: "Fade / Degradé", descripcion: "Degradé a navaja con terminación prolija.", duracion: 45, precio: 60000, activo: true, orden: 2 },
      { id: 3, nombre: "Barba", descripcion: "Perfilado, toalla caliente y aceites.", duracion: 30, precio: 40000, activo: true, orden: 3 },
      { id: 4, nombre: "Corte niño", descripcion: "Hasta 12 años.", duracion: 30, precio: 40000, activo: true, orden: 4 },
      { id: 5, nombre: "Perfilado de cejas", descripcion: "Con navaja o pinza.", duracion: 15, precio: 15000, activo: true, orden: 5 },
      { id: 6, nombre: "Lavado y peinado", descripcion: "Lavado, masaje capilar y productos de styling.", duracion: 15, precio: 20000, activo: true, orden: 6 },
    ];
    const barberos = [
      { id: 1, nombre: "Diego", especialidad: "Fades y diseños", activo: true },
      { id: 2, nombre: "Matías", especialidad: "Barba y clásicos", activo: true },
      { id: 3, nombre: "Lucas", especialidad: "Cortes modernos", activo: true },
    ];
    const nombres = ["Juan Benítez", "Carlos Ruiz", "Pedro Giménez", "Ale Duarte", "Fede Ortiz", "Nico Acosta", "Rodrigo Vera", "Hugo Cabrera"];
    const turnos = [];
    let k = 0;
    for (let d = -1; d <= 3; d++) {
      const fecha = U.addDays(U.hoy(), d);
      const h = U.horarioDe(fecha); if (!h) continue;
      [["10:00", 1, [2]], ["11:00", 2, [1, 3]], ["15:30", 3, [1]], ["17:00", 1, [2, 3, 5]], ["18:00", 2, [3]]].forEach(([hora, b, ids], i) => {
        const items = ids.map((id, n) => { const sv = servicios.find((x) => x.id === id);
          return { servicio_id: id, nombre: sv.nombre, precio: sv.precio, duracion: sv.duracion, orden: n + 1 }; });
        const duracion = items.reduce((a, x) => a + x.duracion, 0);
        if ((i + d) % 3 === 0 || U.toMin(hora) + duracion > U.toMin(h[1])) return;
        turnos.push({
          id: crypto.randomUUID(), codigo: Math.random().toString(36).slice(2, 8).toUpperCase(),
          items, barbero_id: b, fecha, hora, duracion, precio: items.reduce((a, x) => a + x.precio, 0),
          cliente_nombre: nombres[k++ % nombres.length], cliente_telefono: "0981" + (100000 + k * 7919).toString().slice(0, 6),
          nota: "", estado: d < 0 ? "completado" : (i % 2 ? "confirmado" : "pendiente"), origen: "web",
          creado_en: new Date().toISOString(),
        });
      });
    }
    return { servicios, barberos, turnos };
  };
  const load = () => {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) return s; } catch (e) { /* sin storage */ }
    const s = seed(); save(s); return s;
  };
  let mem = null;
  const save = (s) => { mem = s; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* sin storage */ } };
  const st = () => (mem ??= load());
  const wait = (v) => new Promise((r) => setTimeout(() => r(v), 150));
  const libre = (t, ignorarId) => !st().turnos.some((o) =>
    o.id !== ignorarId && o.barbero_id === t.barbero_id && o.fecha === t.fecha && o.estado !== "cancelado" &&
    U.overlap(U.toMin(t.hora), U.toMin(t.hora) + t.duracion, U.toMin(o.hora), U.toMin(o.hora) + o.duracion));
  const join = (t) => {
    const b = st().barberos.find((x) => x.id === t.barbero_id);
    return conServicios({ ...t, barbero: b && { nombre: b.nombre } });
  };
  /** Valida los servicios elegidos y arma la "foto" de nombre/precio/duración de cada uno */
  const armarItems = (servicio_ids) => {
    const ids = [...new Set((servicio_ids || []).map(Number))];
    if (!ids.length) throw new Error("Elegí al menos un servicio.");
    if (ids.length > MAX_SERVICIOS) throw new Error(`Podés elegir hasta ${MAX_SERVICIOS} servicios por turno.`);
    return ids.map((id, n) => {
      const sv = st().servicios.find((x) => x.id === id && x.activo);
      if (!sv) throw new Error("Alguno de los servicios elegidos ya no está disponible.");
      return { servicio_id: sv.id, nombre: sv.nombre, precio: sv.precio, duracion: sv.duracion, orden: n + 1 };
    });
  };
  /** Crea el turno (con una o varias barberos candidatas) y lo guarda */
  const nuevoTurno = (r, candidatas, estado, origen) => {
    const s = st(), items = armarItems(r.servicio_ids);
    const base = { items, fecha: r.fecha, hora: r.hora,
      duracion: items.reduce((a, x) => a + x.duracion, 0), precio: items.reduce((a, x) => a + x.precio, 0) };
    const b = candidatas.find((id) => libre({ ...base, barbero_id: id }));
    if (!b) throw new Error(candidatas.length > 1 ? "Ese horario se acaba de ocupar. Elegí otro." : "Ese horario ya está ocupado para ese barbero.");
    const t = { ...base, id: crypto.randomUUID(), codigo: Math.random().toString(36).slice(2, 8).toUpperCase(),
      barbero_id: b, cliente_nombre: r.cliente_nombre.trim(), cliente_telefono: r.cliente_telefono.trim(),
      nota: (r.nota || "").trim(), estado, origen, creado_en: new Date().toISOString() };
    s.turnos.push(t); save(s);
    return t;
  };

  const local = {
    servicios: (todos) => wait(st().servicios.filter((s) => todos || s.activo)),
    barberos: (todos) => wait(st().barberos.filter((b) => todos || b.activo)),
    ocupados: (fecha) => wait(st().turnos.filter((t) => t.fecha === fecha && t.estado !== "cancelado")
      .map(({ barbero_id, hora, duracion }) => ({ barbero_id, hora, duracion }))),
    async reservar(r) {
      const s = st();
      const candidatas = r.barbero_id ? [r.barbero_id]
        : s.barberos.filter((b) => b.activo).map((b) => b.id).sort(() => Math.random() - .5);
      const t = nuevoTurno({ ...r, cliente_nombre: r.nombre, cliente_telefono: r.telefono }, candidatas, "pendiente", "web");
      return wait({ codigo: t.codigo, barbero_id: t.barbero_id });
    },
    async login(_email, password) {
      if (password !== cfg.demoAdminPassword) throw new Error("Contraseña incorrecta.");
      sessionStorage.setItem("demo_admin", "1");
    },
    async logout() { sessionStorage.removeItem("demo_admin"); },
    async esAdmin() { try { return sessionStorage.getItem("demo_admin") === "1"; } catch (e) { return false; } },
    turnos: (desde, hasta) => wait(st().turnos.filter((t) => t.fecha >= desde && t.fecha <= hasta)
      .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora)).map(join)),
    async crearTurno(t) {
      nuevoTurno(t, [t.barbero_id], "confirmado", "local");
      return wait();
    },
    async actualizarTurno(id, cambios) {
      const s = st(), t = s.turnos.find((x) => x.id === id);
      if (!t) throw new Error("Turno no encontrado");
      if (cambios.estado && cambios.estado !== "cancelado" && t.estado === "cancelado" && !libre(t, t.id))
        throw new Error("No se puede reactivar: el horario ya fue tomado.");
      Object.assign(t, cambios); save(s);
    },
    async guardarBarbero({ id, ...datos }) {
      const s = st();
      if (id) Object.assign(s.barberos.find((b) => b.id === id), datos);
      else s.barberos.push({ activo: true, ...datos, id: Math.max(0, ...s.barberos.map((b) => b.id)) + 1 });
      save(s); return wait();
    },
    async eliminarBarbero(id) {
      const s = st();
      if (s.turnos.some((t) => t.barbero_id === id)) throw new Error("Tiene turnos registrados: desactivalo en lugar de eliminarlo.");
      s.barberos = s.barberos.filter((b) => b.id !== id); save(s); return wait();
    },
    async guardarServicio({ id, ...datos }) {
      const s = st();
      if (id) Object.assign(s.servicios.find((x) => x.id === id), datos);
      else s.servicios.push({ activo: true, ...datos, id: Math.max(0, ...s.servicios.map((x) => x.id)) + 1 });
      save(s); return wait();
    },
    async eliminarServicio(id) {
      const s = st();
      if (s.turnos.some((t) => (t.items || []).some((i) => i.servicio_id === id))) throw new Error("Este servicio tiene turnos registrados: desactivalo en lugar de eliminarlo.");
      s.servicios = s.servicios.filter((x) => x.id !== id); save(s); return wait();
    },
    reset() { localStorage.removeItem(KEY); mem = null; },
  };

  return { modo: online ? "online" : "demo", MAX_SERVICIOS, ...(online ? remote : local) };
})();
