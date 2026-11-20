/* ============================================================
   CAPA DE DATOS · MODO ONLINE (Oracle Autonomous Database + ORDS)
   Se usa cuando js/config.js tiene apiUrl. Expone exactamente las
   mismas funciones que el modo demo (js/db.js), así las páginas no
   cambian. Toda la validación y la separación entre locales la hace
   la base (paquete TB_API, ver carpeta oracle/).
   ============================================================ */
window.DB_ORACLE = (() => {
  const cfg = window.APP_CONFIG;
  if (!cfg.apiUrl) return null;

  const MAX_SERVICIOS = 6;
  const TOK_DUENO = "tb_token", TOK_SUPER = "tb_token_super";
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin storage */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* sin storage */ } },
  };

  let actual = null;     // id del local con el que trabaja la página
  let slugs = [];        // links usados (lo llena superNegocios) para validar en vivo

  /** Llama a la API. tokenKey: qué sesión mandar (dueño o superadmin) */
  async function rpc(fn, args = {}, tokenKey = null) {
    const body = { fn, args };
    if (tokenKey) body.token = ls.get(tokenKey);
    let res;
    try {
      // text/plain evita el "preflight" de CORS: una sola llamada por operación
      res = await fetch(cfg.apiUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error("No se pudo conectar con el servidor. Revisá tu conexión a internet.");
    }
    let j;
    try { j = await res.json(); } catch (e) { throw new Error(`El servidor respondió con un error (${res.status}). Probá de nuevo.`); }
    if (!j.ok) {
      if (j.sesion === false && tokenKey) ls.del(tokenKey);
      throw new Error(j.error || "Ocurrió un error. Probá de nuevo.");
    }
    return j.data;
  }

  const req = () => { if (!actual) throw new Error("No hay un local seleccionado."); return actual; };
  const negocio = (n) => n && ({ ...n, estado: U.estadoNegocio(n) });
  const conServicios = (t) => {
    const items = [...(t.items || [])].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    return { ...t, items, servicio: { nombre: items.map((i) => i.nombre).join(" + "), precio: t.precio ?? 0 } };
  };

  const api = {
    modo: "online",
    MAX_SERVICIOS,
    usar: (id) => { actual = id; },

    /* ----- Público ----- */
    negocioPorSlug: async (slug) => negocio(await rpc("negocio_por_slug", { slug: String(slug || "").toLowerCase() })),
    localesDemo: async () => [],
    servicios: (todos) => rpc("servicios", { negocio_id: req(), todos: Boolean(todos) }, todos ? TOK_DUENO : null),
    barberos: (todos) => rpc("barberos", { negocio_id: req(), todos: Boolean(todos) }, todos ? TOK_DUENO : null),
    ocupados: (fecha, excluir) => rpc("ocupados", { negocio_id: req(), fecha, excluir: excluir || null }),
    reservar: (r) => rpc("reservar", {
      negocio_id: req(), servicio_ids: r.servicio_ids, barbero_id: r.barbero_id || null,
      fecha: r.fecha, hora: r.hora, nombre: r.nombre, telefono: r.telefono, nota: r.nota || null,
    }),
    /* Mi turno (el cliente, con su link o con código + celular; ver oracle/02c_turnos_cliente.sql) */
    miTurno: async (q) => { const t = await rpc("mi_turno", { negocio_id: req(), ...q }); return t && conServicios(t); },
    cancelarTurno: async (id) => conServicios(await rpc("cancelar_turno", { negocio_id: req(), id })),
    reprogramarTurno: async (id, { fecha, hora, barbero_id }) =>
      conServicios(await rpc("reprogramar_turno", { negocio_id: req(), id, fecha, hora, barbero_id: barbero_id || null })),

    /* ----- Dueño del local ----- */
    async login(email, password) {
      const { token } = await rpc("login", { email, password });
      ls.set(TOK_DUENO, token);
    },
    async logout() {
      try { await rpc("logout", {}, TOK_DUENO); } catch (e) { /* igual se cierra acá */ }
      ls.del(TOK_DUENO);
    },
    /** El local del dueño con sesión (o null). También lo deja como local activo. */
    async miNegocio() {
      if (!ls.get(TOK_DUENO)) return null;
      try {
        const n = await rpc("mi_negocio", {}, TOK_DUENO);
        actual = n.id;
        return negocio(n);
      } catch (e) {
        if (!ls.get(TOK_DUENO)) return null; // sesión vencida
        throw e;
      }
    },
    guardarNegocio: async (cambios) => negocio(await rpc("guardar_negocio", cambios, TOK_DUENO)),
    cambiarClave: (nueva) => rpc("cambiar_clave", { nueva }, TOK_DUENO),
    turnos: async (desde, hasta) => (await rpc("turnos", { desde, hasta }, TOK_DUENO)).map(conServicios),
    crearTurno: (t) => rpc("crear_turno", t, TOK_DUENO),
    actualizarTurno: (id, cambios) => rpc("actualizar_turno", { id, estado: cambios.estado }, TOK_DUENO),
    guardarBarbero: (b) => rpc("guardar_barbero", b, TOK_DUENO),
    eliminarBarbero: (id) => rpc("eliminar_barbero", { id }, TOK_DUENO),
    guardarServicio: (s) => rpc("guardar_servicio", s, TOK_DUENO),
    eliminarServicio: (id) => rpc("eliminar_servicio", { id }, TOK_DUENO),

    /* ----- Gestión: stock, compras, gastos, ventas (oracle/02b_gestion.sql + TB_API) ----- */
    productos: (todos) => rpc("productos", { todos: Boolean(todos) }, TOK_DUENO),
    guardarProducto: (p) => rpc("guardar_producto", p, TOK_DUENO),
    eliminarProducto: (id) => rpc("eliminar_producto", { id }, TOK_DUENO),
    ajustarStock: (id, a) => rpc("ajustar_stock", { id, ...a }, TOK_DUENO),
    movimientos: (id) => rpc("movimientos", { id }, TOK_DUENO),
    compras: (desde, hasta) => rpc("compras", { desde, hasta }, TOK_DUENO),
    proveedores: () => rpc("proveedores", {}, TOK_DUENO),
    crearCompra: (c) => rpc("crear_compra", c, TOK_DUENO),
    anularCompra: (id, motivo) => rpc("anular_compra", { id, motivo }, TOK_DUENO),
    gastos: (desde, hasta) => rpc("gastos", { desde, hasta }, TOK_DUENO),
    guardarGasto: (g) => rpc("guardar_gasto", g, TOK_DUENO),
    eliminarGasto: (id) => rpc("eliminar_gasto", { id }, TOK_DUENO),
    ventas: (desde, hasta) => rpc("ventas", { desde, hasta }, TOK_DUENO),
    venta: (id) => rpc("venta", { id }, TOK_DUENO),
    crearVenta: (v) => rpc("crear_venta", v, TOK_DUENO),
    anularVenta: (id, motivo) => rpc("anular_venta", { id, motivo }, TOK_DUENO),
    guardarFacturacion: (f) => rpc("guardar_facturacion", f, TOK_DUENO),

    /* ----- Proveedores, clientes y bloqueos (oracle/02d_extras.sql + TB_API) ----- */
    guardarProveedor: (p) => rpc("guardar_proveedor", p, TOK_DUENO),
    eliminarProveedor: (id) => rpc("eliminar_proveedor", { id }, TOK_DUENO),
    clientes: () => rpc("clientes", {}, TOK_DUENO),
    async cliente(id) {
      const r = await rpc("cliente", { id }, TOK_DUENO);
      return { cliente: r.cliente, turnos: (r.turnos || []).map(conServicios), ventas: r.ventas || [] };
    },
    guardarCliente: (c) => rpc("guardar_cliente", c, TOK_DUENO),
    bloqueos: (desde, hasta) => rpc("bloqueos", { desde: desde || null, hasta: hasta || null }, TOK_DUENO),
    guardarBloqueo: (b) => rpc("guardar_bloqueo", b, TOK_DUENO),
    eliminarBloqueo: (id) => rpc("eliminar_bloqueo", { id }, TOK_DUENO),

    /* ----- Superadmin ----- */
    async superLogin(email, password) {
      const { token } = await rpc("super_login", { email, password });
      ls.set(TOK_SUPER, token);
    },
    async superLogout() {
      try { await rpc("super_logout", {}, TOK_SUPER); } catch (e) { /* igual se cierra acá */ }
      ls.del(TOK_SUPER);
    },
    async esSuper() {
      if (!ls.get(TOK_SUPER)) return false;
      try { return await rpc("super_ping", {}, TOK_SUPER); } catch (e) { return false; }
    },
    async superNegocios() {
      const ls_ = (await rpc("super_negocios", {}, TOK_SUPER)).map(negocio);
      slugs = ls_.map((n) => ({ id: n.id, slug: n.slug }));
      return ls_;
    },
    superCrearNegocio: async (datos) => negocio(await rpc("super_crear_negocio", datos, TOK_SUPER)),
    superGuardarNegocio: async (id, cambios) => negocio(await rpc("super_guardar_negocio", { id, cambios }, TOK_SUPER)),
    superResetClave: async (id) => (await rpc("super_reset_clave", { id }, TOK_SUPER)).clave,
    async superRegistrarPago(id, { monto, meses = 1, fecha = U.hoy() }) {
      const r = await rpc("super_registrar_pago", { id, monto, meses, fecha }, TOK_SUPER);
      return { pago: r.pago, negocio: negocio(r.negocio) };
    },
    superPagos: () => rpc("super_pagos", {}, TOK_SUPER),
    superEliminarPago: (id) => rpc("super_eliminar_pago", { id }, TOK_SUPER),
    /** Validación en vivo del link (la definitiva la hace la base al guardar) */
    slugLibre(slug, exceptoId) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 40)
        return "El link solo puede tener letras minúsculas, números y guiones (3 a 40 caracteres).";
      if (["admin", "panel", "superadmin", "api", "www", "app", "login", "demo"].includes(slug))
        return `«${slug}» es una palabra reservada. Elegí otro link.`;
      if (slugs.some((n) => n.slug === slug && n.id !== exceptoId)) return "Ese link ya lo usa otro local.";
      return null;
    },

    reset() { /* solo demo */ },
  };
  return api;
})();
