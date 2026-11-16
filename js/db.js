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
        p_servicio_id: r.servicio_id, p_barbero_id: r.barbero_id, p_fecha: r.fecha, p_hora: r.hora,
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
        .select("*, servicio:servicios(nombre,precio), barbero:barberos(nombre)")
        .gte("fecha", desde).lte("fecha", hasta).order("fecha").order("hora");
      fail(error); return data.map(normTurno);
    },
    async crearTurno(t) {
      const { error } = await sb.from("turnos").insert(t); fail(error);
    },
    async actualizarTurno(id, cambios) {
      const { error } = await sb.from("turnos").update(cambios).eq("id", id); fail(error);
    },
  };

  /* ---------------- DEMO (localStorage) ---------------- */
  const KEY = "turnos_barber_demo_v1";
  const seed = () => {
    const servicios = [
      { id: 1, nombre: "Corte clásico", descripcion: "Tijera y máquina, lavado incluido.", duracion: 30, precio: 50000, activo: true, orden: 1 },
      { id: 2, nombre: "Fade / Degradé", descripcion: "Degradé a navaja con terminación prolija.", duracion: 45, precio: 60000, activo: true, orden: 2 },
      { id: 3, nombre: "Barba", descripcion: "Perfilado, toalla caliente y aceites.", duracion: 30, precio: 40000, activo: true, orden: 3 },
      { id: 4, nombre: "Corte + Barba", descripcion: "El combo completo.", duracion: 60, precio: 85000, activo: true, orden: 4 },
      { id: 5, nombre: "Corte niño", descripcion: "Hasta 12 años.", duracion: 30, precio: 40000, activo: true, orden: 5 },
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
      [["10:00", 1, 2], ["11:00", 2, 4], ["15:30", 3, 1], ["17:00", 1, 3], ["18:00", 2, 2]].forEach(([hora, b, s], i) => {
        if ((i + d) % 3 === 0 || U.toMin(hora) + 60 > U.toMin(h[1])) return;
        const sv = servicios.find((x) => x.id === s);
        turnos.push({
          id: crypto.randomUUID(), codigo: Math.random().toString(36).slice(2, 8).toUpperCase(),
          servicio_id: s, barbero_id: b, fecha, hora, duracion: sv.duracion,
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
    const s = st(), sv = s.servicios.find((x) => x.id === t.servicio_id), b = s.barberos.find((x) => x.id === t.barbero_id);
    return { ...t, servicio: sv && { nombre: sv.nombre, precio: sv.precio }, barbero: b && { nombre: b.nombre } };
  };

  const local = {
    servicios: (todos) => wait(st().servicios.filter((s) => todos || s.activo)),
    barberos: (todos) => wait(st().barberos.filter((b) => todos || b.activo)),
    ocupados: (fecha) => wait(st().turnos.filter((t) => t.fecha === fecha && t.estado !== "cancelado")
      .map(({ barbero_id, hora, duracion }) => ({ barbero_id, hora, duracion }))),
    async reservar(r) {
      const s = st(), sv = s.servicios.find((x) => x.id === r.servicio_id && x.activo);
      if (!sv) throw new Error("Servicio no disponible");
      let ids = r.barbero_id ? [r.barbero_id] : s.barberos.filter((b) => b.activo).map((b) => b.id).sort(() => Math.random() - .5);
      const base = { servicio_id: sv.id, fecha: r.fecha, hora: r.hora, duracion: sv.duracion };
      const b = ids.find((id) => libre({ ...base, barbero_id: id }));
      if (!b) throw new Error("Ese horario se acaba de ocupar. Elegí otro.");
      const t = { ...base, id: crypto.randomUUID(), codigo: Math.random().toString(36).slice(2, 8).toUpperCase(),
        barbero_id: b, cliente_nombre: r.nombre.trim(), cliente_telefono: r.telefono.trim(), nota: (r.nota || "").trim(),
        estado: "pendiente", origen: "web", creado_en: new Date().toISOString() };
      s.turnos.push(t); save(s);
      return wait({ codigo: t.codigo, barbero_id: b });
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
      if (!libre(t)) throw new Error("Ese horario ya está ocupado para ese barbero.");
      const s = st();
      s.turnos.push({ ...t, id: crypto.randomUUID(), codigo: Math.random().toString(36).slice(2, 8).toUpperCase(), creado_en: new Date().toISOString() });
      save(s);
    },
    async actualizarTurno(id, cambios) {
      const s = st(), t = s.turnos.find((x) => x.id === id);
      if (!t) throw new Error("Turno no encontrado");
      if (cambios.estado && cambios.estado !== "cancelado" && t.estado === "cancelado" && !libre(t, t.id))
        throw new Error("No se puede reactivar: el horario ya fue tomado.");
      Object.assign(t, cambios); save(s);
    },
    reset() { localStorage.removeItem(KEY); mem = null; },
  };

  return { modo: online ? "online" : "demo", ...(online ? remote : local) };
})();
