/* ============================================================
   GESTIÓN DEL LOCAL (panel del dueño)
   Ventas y facturación · Compras · Gastos · Stock
   La lógica (stock, numeración, validaciones) está en la capa de
   datos (js/db.js); acá solo se muestra y se cargan los formularios.
   ============================================================ */
const Gestion = (() => {
  const cfg = window.APP_CONFIG;
  const N = U.neg;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = U.esc;

  const FORMAS = { efectivo: "Efectivo", debito: "Tarjeta de débito", credito: "Tarjeta de crédito", transferencia: "Transferencia", qr: "QR / billetera" };
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const MOVS = { inicial: "Stock inicial", compra: "Compra", venta: "Venta", uso: "Uso en el local", perdida: "Pérdida / vencido",
    ingreso: "Ingreso", conteo: "Conteo físico", anulacion: "Anulación" };
  const MODULOS = ["agenda", "ventas", "compras", "gastos", "stock", "clientes"];

  const g = { mod: "agenda", mes: U.hoy().slice(0, 7), ventas: [], compras: [], gastos: [], gastosAnt: [], productos: [], catGasto: "" };
  let ctx = { servicios: () => [], barberos: () => [], turnosCambiaron: () => {}, nuevoTurno: () => {}, rol: () => "dueno", miBarbero: () => null };
  const esBarbero = () => ctx.rol() === "barbero";

  /* ---------- Ayudas ---------- */
  const suma = (arr, f) => arr.reduce((a, x) => a + (typeof f === "function" ? f(x) : x[f] || 0), 0);
  const num = (n) => Number(n || 0).toLocaleString("es-PY");
  const dmy = (f) => (f ? f.split("-").reverse().join("/") : "");
  const mesHoy = () => U.hoy().slice(0, 7);
  const rango = (m) => [m + "-01", U.addDays(U.sumarMeses(m + "-01", 1), -1)];
  const mesTxt = (m) => { const [y, mm] = m.split("-"); return `${MESES[Number(mm) - 1]} ${y}`; };
  const plural = (n, s, p = s + "s") => `${n} ${n === 1 ? s : p}`;
  const vacio = (icon, txt) => `<p class="empty"><i data-lucide="${icon}"></i>${txt}</p>`;
  const mostrarError = (el, msg) => { el.textContent = msg || ""; el.hidden = !msg; };
  const opcionesPago = () => Object.entries(FORMAS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  const pagoTxt = (x) => (x.condicion === "credito" ? "Crédito" : FORMAS[x.forma_pago] || "");
  const facturaLista = (f) => Boolean(f && f.razon_social && f.ruc && f.timbrado && f.desde && f.hasta && f.establecimiento && f.punto && f.proximo);
  const vigente = (f, fecha) => facturaLista(f) && fecha >= f.desde && fecha <= f.hasta;
  const nroFactura = (f) => `${f.establecimiento}-${f.punto}-${String(f.proximo).padStart(7, "0")}`;
  const resumenItems = (items) => items.map((i) => (i.cantidad > 1 ? `${i.cantidad} × ` : "") + i.descripcion).join(" + ");
  /** "12" o "3 cajas": la unidad solo se muestra si no es la genérica */
  const cant = (p, n) => (p.unidad && p.unidad !== "unidad" ? `${n} ${esc(p.unidad)}` : String(n));
  const estadoStock = (p) => (p.stock <= 0 ? "sin" : p.stock <= p.minimo ? "bajo" : "ok");
  const entero = (v) => (v === "" || v == null ? NaN : Number(v));
  const kpis = (el, tiles) => {
    el.innerHTML = tiles.map(([i, l, v, s, cls]) => `
      <div class="kpi ${cls || ""}"><span class="kpi__icon"><i data-lucide="${i}"></i></span>
      <div><small>${l}</small><strong>${v}</strong><em>${s}</em></div></div>`).join("");
  };

  /** 150000 -> "ciento cincuenta mil" (para el "total en letras" de la factura) */
  function letras(n) {
    n = Math.floor(Math.abs(n));
    if (!n) return "cero";
    const u = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince",
      "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco",
      "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
    const d = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
    const c = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];
    const dos = (x) => (x < 30 ? u[x] : d[Math.floor(x / 10)] + (x % 10 ? " y " + u[x % 10] : ""));
    const tres = (x) => (x === 100 ? "cien" : [c[Math.floor(x / 100)], dos(x % 100)].filter(Boolean).join(" "));
    const corto = (s) => s.replace(/veintiuno$/, "veintiún").replace(/uno$/, "un");
    const mill = Math.floor(n / 1e6), mil = Math.floor((n % 1e6) / 1000), r = n % 1000, out = [];
    if (mill) out.push(mill === 1 ? "un millón" : corto(tres(mill)) + " millones");
    if (mil) out.push(mil === 1 ? "mil" : corto(tres(mil)) + " mil");
    if (r) out.push(tres(r));
    return out.join(" ");
  }

  /* ---------- Secciones del panel ---------- */
  function irModulo(m) {
    if (!MODULOS.includes(m)) m = "agenda";
    if (esBarbero()) m = "agenda"; // el barbero ve solo su agenda
    g.mod = m;
    $$("[data-mod]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mod === m)));
    $$("[data-modulo]").forEach((s) => { s.hidden = s.dataset.modulo !== m; });
    try { history.replaceState(null, "", m === "agenda" ? location.pathname + location.search : "#" + m); } catch (e) { /* file:// sin history */ }
    pintarMes();
    cargarModulo();
  }
  $$("[data-mod]").forEach((b) => b.addEventListener("click", () => irModulo(b.dataset.mod)));

  async function cargarModulo() {
    try {
      if (g.mod === "ventas") await cargarVentas();
      else if (g.mod === "compras") await cargarCompras();
      else if (g.mod === "gastos") await cargarGastos();
      else if (g.mod === "stock") { await cargarProductos(); renderStock(); }
      else if (g.mod === "clientes") await cargarClientes();
    } catch (e) { U.toast(e.message, "error"); }
  }

  /* ---------- Impresión en la térmica de 80 mm (comprobantes, caja, comisiones) ---------- */
  function imprimirTicket(html) {
    const box = $("#impresion");
    box.innerHTML = html;
    // Página del tamaño exacto del ticket: 80 mm de ancho × su alto (no sale papel en blanco)
    box.style.cssText = "display:block;position:absolute;left:-9999px;top:0;width:72mm";
    const altoMm = Math.ceil(box.getBoundingClientRect().height * 25.4 / 96) + 10;
    box.style.cssText = "";
    let pg = $("#paginaTicket");
    if (!pg) { pg = document.createElement("style"); pg.id = "paginaTicket"; document.head.append(pg); }
    pg.textContent = `@media print{@page{size:80mm ${altoMm}mm;margin:0}}`;
    window.print();
  }
  /** Encabezado común de los tickets internos */
  const cabeceraTicket = () => `<header class="doc__centro">${N.logo ? `<img class="doc__logo" src="${esc(N.logo)}" alt="">` : ""}<strong>${esc(N.nombre)}</strong>
    ${N.direccion ? `<small>${esc(N.direccion)}</small>` : ""}</header>`;
  const filaT = (a, b, cls = "") => `<div class="tk__fila ${cls}"><span>${a}</span><span>${b}</span></div>`;

  /* ---------- Clientes: lista en memoria para autocompletar (turnos y ventas) ---------- */
  let clientesCache = null;
  const clientesAc = async (refrescar = false) => {
    if (!clientesCache || refrescar) clientesCache = await DB.clientes();
    return clientesCache;
  };
  const normal = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const digitos = (s) => String(s || "").replace(/\D/g, "");
  /**
   * Sugerencias de clientes debajo de un campo (por nombre, celular o RUC).
   * alElegir(cliente) completa el formulario.
   */
  function autocompletar(input, alElegir) {
    const box = document.createElement("div");
    box.className = "ac"; box.hidden = true; box.setAttribute("role", "listbox");
    input.closest(".field").classList.add("ac-wrap");
    input.after(box);
    input.setAttribute("aria-autocomplete", "list");
    let items = [], act = -1;
    const cerrar = () => { box.hidden = true; act = -1; };
    const pintar = () => {
      box.innerHTML = items.map((c, i) => `<button type="button" role="option" class="ac__item ${i === act ? "is-act" : ""}" data-i="${i}" tabindex="-1">
        <strong>${esc(c.nombre)}</strong><small>${esc([c.telefono, c.ruc, c.visitas ? plural(c.visitas, "visita") : "cliente nuevo"].filter(Boolean).join(" · "))}</small></button>`).join("");
      box.hidden = !items.length;
    };
    const elegir = (i) => { const c = items[i]; cerrar(); if (c) alElegir(c); };
    input.addEventListener("input", async () => {
      const q = normal(input.value.trim()), dig = digitos(input.value);
      if (q.length < 2) { items = []; return cerrar(); }
      const lista = await clientesAc().catch(() => []);
      items = lista.filter((c) => normal(c.nombre).includes(q) ||
        (dig.length >= 3 && (digitos(c.telefono).includes(dig) || digitos(c.ruc).includes(dig)))).slice(0, 6);
      act = -1; pintar();
    });
    input.addEventListener("keydown", (e) => {
      if (box.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); act = (act + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; pintar(); }
      else if (e.key === "Enter" && act >= 0) { e.preventDefault(); elegir(act); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cerrar(); }
    });
    box.addEventListener("mousedown", (e) => e.preventDefault()); // que no se pierda el foco del campo
    box.addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b) elegir(Number(b.dataset.i)); });
    input.addEventListener("blur", () => setTimeout(cerrar, 150));
    return { cerrar };
  }

  /* Selector de mes (compartido por Ventas, Compras y Gastos) */
  function pintarMes() {
    const actual = g.mes >= mesHoy();
    $$("[data-mesnav]").forEach((el) => {
      el.innerHTML = `
        <button class="icon-btn" data-mes="-1" aria-label="Mes anterior"><i data-lucide="chevron-left"></i></button>
        <label class="datenav__label"><strong>${mesTxt(g.mes)}</strong><input type="month" value="${g.mes}" max="${mesHoy()}" data-mesinput aria-label="Elegir mes"></label>
        <button class="icon-btn" data-mes="1" aria-label="Mes siguiente" ${actual ? "disabled" : ""}><i data-lucide="chevron-right"></i></button>
        ${actual ? "" : '<button class="btn btn--ghost btn--sm" data-mes="0">Este mes</button>'}`;
    });
    U.icons();
  }
  const irMes = (m) => { g.mes = m > mesHoy() ? mesHoy() : m; pintarMes(); cargarModulo(); };
  $("#main").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mes]"); if (!b) return;
    irMes(b.dataset.mes === "0" ? mesHoy() : U.sumarMeses(g.mes + "-01", Number(b.dataset.mes)).slice(0, 7));
  });
  $("#main").addEventListener("change", (e) => { if (e.target.matches("[data-mesinput]") && e.target.value) irMes(e.target.value); });

  /* ---------- Productos (los usan Stock, Ventas y Compras) ---------- */
  async function cargarProductos() {
    g.productos = await DB.productos(true);
    const bajos = g.productos.filter((p) => p.activo && estadoStock(p) !== "ok").length;
    $("#cantBajo").hidden = !bajos; $("#cantBajo").textContent = bajos;
  }

  /* Líneas editables (cantidad y precio) de una venta o compra */
  function lineasEditables(box, lineas, alCambiar, { etiquetaPrecio = "Precio", detalle = () => "" } = {}) {
    const pintar = () => {
      box.innerHTML = lineas.map((l, i) => `
        <div class="linea" data-i="${i}">
          <span class="linea__desc">${esc(l.descripcion)}<small>${detalle(l)}</small></span>
          <label class="linea__cant"><small>Cant.</small><input type="number" inputmode="numeric" min="1" max="99999" step="1" value="${l.cantidad}" data-k="cantidad" aria-label="Cantidad de ${esc(l.descripcion)}"></label>
          <label class="linea__precio"><small>${etiquetaPrecio}</small><input type="number" inputmode="numeric" min="0" max="100000000" step="1" value="${l.precio}" data-k="precio" aria-label="${etiquetaPrecio} de ${esc(l.descripcion)}"></label>
          <strong class="linea__sub">${U.gs(l.cantidad * l.precio)}</strong>
          <button type="button" class="icon-btn icon-btn--danger" data-quitar aria-label="Quitar ${esc(l.descripcion)}"><i data-lucide="x"></i></button>
        </div>`).join("") || `<p class="lineas__vacio">Todavía no agregaste nada.</p>`;
      U.icons(); alCambiar();
    };
    box.oninput = (e) => {
      const fila = e.target.closest(".linea"); if (!fila || !e.target.dataset.k) return;
      const l = lineas[Number(fila.dataset.i)];
      l[e.target.dataset.k] = entero(e.target.value);
      $(".linea__sub", fila).textContent = Number.isFinite(l.cantidad * l.precio) ? U.gs(l.cantidad * l.precio) : "—";
      alCambiar();
    };
    box.onclick = (e) => {
      if (!e.target.closest("[data-quitar]")) return;
      lineas.splice(Number(e.target.closest(".linea").dataset.i), 1); pintar();
    };
    pintar();
    return pintar;
  }
  const lineasOk = (lineas) => lineas.every((l) => Number.isInteger(l.cantidad) && l.cantidad >= 1 && Number.isInteger(l.precio) && l.precio >= 0);
  const totalLineas = (lineas) => suma(lineas, (l) => (Number.isFinite(l.cantidad * l.precio) ? l.cantidad * l.precio : 0));
  const ivaLineas = (lineas) => suma(lineas, (l) => {
    const m = Number.isFinite(l.cantidad * l.precio) ? l.cantidad * l.precio : 0;
    return l.iva === 10 ? Math.round(m / 11) : l.iva === 5 ? Math.round(m / 21) : 0;
  });

  /* ============================================================
     VENTAS Y FACTURACIÓN
     ============================================================ */
  async function cargarVentas() {
    const [d, h] = rango(g.mes);
    [g.ventas, g.compras, g.gastos] = await Promise.all([DB.ventas(d, h), DB.compras(d, h), DB.gastos(d, h)]);
    renderVentas();
  }
  function avisoTimbrado() {
    const f = N.factura, box = $("#timbradoAviso"), hoy = U.hoy();
    let msg = null, tipo = "info";
    if (!facturaLista(f)) msg = "Para emitir <b>facturas</b> cargá los datos de tu timbrado. Mientras tanto, cada venta sale como <b>ticket interno</b> (no válido como factura).";
    else if (f.hasta < hoy) { msg = `Tu timbrado venció el ${U.fechaLarga(f.hasta)}. Cargá el nuevo para seguir facturando.`; tipo = "danger"; }
    else if (f.desde > hoy) { msg = `Tu timbrado empieza a regir el ${U.fechaLarga(f.desde)}. Hasta entonces las ventas salen como ticket interno.`; tipo = "warn"; }
    else if (U.diasEntre(hoy, f.hasta) <= 30) { msg = `Tu timbrado vence el ${U.fechaLarga(f.hasta)}. Acordate de renovarlo en la DNIT.`; tipo = "warn"; }
    box.hidden = !msg;
    if (msg) {
      box.className = `abono abono--${tipo}`;
      box.innerHTML = `<i data-lucide="stamp"></i><span>${msg}</span>
        <button class="btn btn--sm ${tipo === "info" ? "btn--gold" : "btn--ghost"}" data-abrir-timbrado><i data-lucide="stamp"></i>${facturaLista(f) ? "Actualizar timbrado" : "Cargar timbrado"}</button>`;
    }
  }
  function renderVentas() {
    avisoTimbrado();
    const ok = g.ventas.filter((v) => !v.anulada);
    const total = suma(ok, "total");
    const serv = suma(ok, (v) => suma(v.items.filter((i) => i.tipo === "servicio"), (i) => i.cantidad * i.precio));
    const efectivo = suma(ok.filter((v) => v.condicion !== "credito" && v.forma_pago === "efectivo"), "total");
    const nFact = ok.filter((v) => v.tipo === "factura").length;
    const compras = suma(g.compras.filter((c) => !c.anulada), "total"), gastos = suma(g.gastos, "monto");
    const res = total - compras - gastos;
    kpis($("#kpisVentas"), [
      ["receipt", "Ventas del mes", U.gs(total), `${plural(ok.length, "comprobante")} · ${plural(nFact, "factura")}`],
      ["scissors", "Servicios", U.gs(serv), `productos ${U.gs(total - serv)}`],
      ["banknote", "En efectivo", U.gs(efectivo), `otros medios ${U.gs(total - efectivo)}`],
      ["trending-up", "Resultado del mes", U.gs(res), `ventas − compras ${U.gs(compras)} − gastos ${U.gs(gastos)}`, res < 0 ? "kpi--neg" : ""],
    ]);
    const f = $("#ventasFiltro").value;
    const lista = g.ventas.filter((v) => (!f ? true : f === "anulada" ? v.anulada : v.tipo === f && !v.anulada));
    $("#listaVentas").innerHTML = !lista.length
      ? vacio("receipt", g.ventas.length ? "No hay comprobantes con ese filtro." : `No hay ventas en ${mesTxt(g.mes)}. Cobrá un turno atendido o tocá <b>Nueva venta</b>.`)
      : `<table class="tabla tabla--ges">
        <thead><tr><th>Fecha</th><th>Comprobante</th><th>Cliente</th><th>Detalle</th><th>Pago</th><th class="num">Total</th><th><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${lista.map((v) => `
          <tr class="${v.anulada ? "is-anulada" : ""}">
            <td data-l="Fecha">${dmy(v.fecha)}<small>${esc(v.hora)} hs</small></td>
            <td data-l="Comprobante"><strong>${esc(v.numero)}</strong><small>${v.anulada ? '<span class="tag tag--danger">Anulado</span>' : v.tipo === "factura" ? "Factura" : "Ticket interno"}</small></td>
            <td data-l="Cliente">${esc(v.cliente_nombre)}<small>${esc(v.cliente_ruc || "")}</small></td>
            <td data-l="Detalle">${esc(resumenItems(v.items))}<small>${esc(v.barbero_nombre || "")}</small></td>
            <td data-l="Pago">${pagoTxt(v)}</td>
            <td data-l="Total" class="num"><strong>${U.gs(v.total)}</strong>${v.descuento || v.propina ? `<small>${[v.descuento ? `desc. −${num(v.descuento)}` : "", v.propina ? `+ propina ${num(v.propina)}` : ""].filter(Boolean).join(" · ")}</small>` : ""}</td>
            <td class="tabla__acc"><button class="icon-btn" data-ver-venta="${v.id}" aria-label="Ver comprobante ${esc(v.numero)}"><i data-lucide="eye"></i></button></td>
          </tr>`).join("")}</tbody>
      </table>`;
    U.icons();
  }
  $("#ventasFiltro").addEventListener("change", renderVentas);
  $("#listaVentas").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ver-venta]"); if (b) verVenta(g.ventas.find((v) => v.id === b.dataset.verVenta));
  });
  $("#btnNuevaVenta").addEventListener("click", () => abrirVenta());

  /* ---------- Nueva venta / cobrar turno ---------- */
  const fV = $("#formVenta");
  let venta = { lineas: [], turno: null }, pintarVenta = () => {};

  async function abrirVenta(turno = null, cliente = null) {
    try { await cargarProductos(); } catch (e) { /* se puede cobrar solo servicios */ }
    clientesAc(true).catch(() => {});
    venta = { turno, cliente_id: turno?.cliente_id || cliente?.id || null,
      lineas: turno ? turno.items.map((i) => ({ tipo: "servicio", id: i.servicio_id, descripcion: i.nombre, cantidad: 1, precio: i.precio, iva: 10 })) : [] };
    fV.reset(); mostrarError($("#ventaError"));
    $("#ventaTitulo").textContent = turno ? "Cobrar turno" : "Nueva venta";
    $("#ventaSub").hidden = !turno;
    if (turno) $("#ventaSub").textContent = `${U.fechaLarga(turno.fecha)}, ${turno.hora} hs · ${turno.barbero?.nombre || ""}`;
    fV.cliente_nombre.value = turno?.cliente_nombre || cliente?.nombre || "";
    fV.cliente_ruc.value = cliente?.ruc || "";
    venta.nombreElegido = fV.cliente_nombre.value;
    if (turno?.cliente_id && !cliente) {
      // El RUC del cliente del turno (si ya lo tenemos) para la factura
      clientesAc().then((l) => { const c = l.find((x) => x.id === turno.cliente_id); if (c?.ruc && !fV.cliente_ruc.value) fV.cliente_ruc.value = c.ruc; }).catch(() => {});
    }
    fV.forma_pago.innerHTML = opcionesPago(); fV.forma_pago.disabled = false;
    const barbs = ctx.barberos().filter((b) => b.activo || b.id === turno?.barbero_id);
    fV.barbero_id.innerHTML = '<option value="">— Ninguno —</option>' + barbs.map((b) => `<option value="${b.id}">${esc(b.nombre)}</option>`).join("");
    fV.barbero_id.value = turno?.barbero_id || "";
    if (esBarbero()) fV.barbero_id.value = String(ctx.miBarbero()); // cobra a su nombre
    fV.barbero_id.disabled = esBarbero();
    fV.fecha.max = U.hoy();
    fV.fecha.value = turno && turno.fecha <= U.hoy() ? turno.fecha : U.hoy();
    if (esBarbero()) fV.fecha.value = U.hoy();
    fV.fecha.disabled = esBarbero(); // el barbero cobra con la fecha de hoy
    opcionesVenta();
    comprobanteVenta(true);
    pintarVenta = lineasEditables($("#ventaLineas"), venta.lineas, totalVenta, {
      detalle: (l) => (l.tipo === "producto" ? `Producto · stock ${g.productos.find((p) => p.id === l.id)?.stock ?? "?"}` : "Servicio"),
    });
    U.icons();
    $("#modalVenta").showModal();
  }
  function opcionesVenta() {
    const servs = ctx.servicios().filter((s) => s.activo).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    const prods = g.productos.filter((p) => p.activo && p.tipo === "venta");
    $("#ventaAgregar").innerHTML = `<option value="">+ Agregar servicio o producto…</option>
      <optgroup label="Servicios">${servs.map((s) => `<option value="s:${s.id}">${esc(s.nombre)} · ${U.gs(s.precio)}</option>`).join("")}</optgroup>
      ${prods.length ? `<optgroup label="Productos">${prods.map((p) =>
        `<option value="p:${p.id}" ${p.stock <= 0 ? "disabled" : ""}>${esc(p.nombre)} · ${U.gs(p.precio)} · ${p.stock <= 0 ? "sin stock" : "stock " + p.stock}</option>`).join("")}</optgroup>` : ""}`;
  }
  $("#ventaAgregar").addEventListener("change", (e) => {
    const [t, id] = e.target.value.split(":"); e.target.value = "";
    if (!id) return;
    const tipo = t === "s" ? "servicio" : "producto";
    const ya = venta.lineas.find((l) => l.tipo === tipo && l.id === Number(id));
    if (ya) ya.cantidad = (Number.isInteger(ya.cantidad) ? ya.cantidad : 0) + 1;
    else {
      const x = tipo === "servicio" ? ctx.servicios().find((s) => s.id === Number(id)) : g.productos.find((p) => p.id === Number(id));
      if (!x) return;
      venta.lineas.push({ tipo, id: x.id, descripcion: x.nombre, cantidad: 1, precio: x.precio, iva: tipo === "servicio" ? 10 : x.iva });
    }
    pintarVenta();
  });
  /** Descuento en guaraníes (el campo puede estar en Gs. o en %) */
  const descuentoVenta = () => {
    const v = entero(fV.descuento.value);
    if (!Number.isFinite(v) || v <= 0) return 0;
    return fV.desc_tipo.value === "pct" ? Math.round(totalLineas(venta.lineas) * Math.min(v, 100) / 100) : v;
  };
  const propinaVenta = () => { const p = entero(fV.propina.value); return Number.isFinite(p) && p > 0 ? p : 0; };
  function totalVenta() {
    const sub = totalLineas(venta.lineas), d = descuentoVenta(), p = propinaVenta(), t = sub - d;
    const iva = sub ? Math.round(ivaLineas(venta.lineas) * t / sub) : 0;
    $("#ventaTotal").innerHTML = (d ? `<span class="totalbox__linea">Subtotal ${U.gs(sub)} · descuento −${U.gs(d)}</span>` : "") +
      `<span>Total</span><strong>${U.gs(t)}</strong><small>IVA incluido ${U.gs(iva)}${p ? ` · + propina ${U.gs(p)}` : ""}</small>`;
    $("#btnCobrar span").textContent = venta.lineas.length ? `COBRAR ${U.gs(t + p)}` : "COBRAR";
  }
  ["descuento", "desc_tipo", "propina"].forEach((k) => fV[k].addEventListener(k === "desc_tipo" ? "change" : "input", totalVenta));
  // Cliente: sugerencias por nombre o RUC; al elegir uno, la venta queda en su historial
  const elegirClienteVenta = (c) => {
    venta.cliente_id = c.id; venta.nombreElegido = c.nombre;
    fV.cliente_nombre.value = c.nombre;
    if (c.ruc) fV.cliente_ruc.value = c.ruc;
  };
  autocompletar(fV.cliente_nombre, elegirClienteVenta);
  autocompletar(fV.cliente_ruc, elegirClienteVenta);
  fV.cliente_nombre.addEventListener("input", () => {
    // Si cambia el nombre a mano, ya no es el cliente elegido (salvo que venga de un turno)
    if (venta.cliente_id && !venta.turno && fV.cliente_nombre.value.trim() !== venta.nombreElegido) venta.cliente_id = null;
  });
  /** Muestra si va a salir factura (con su número) o ticket */
  function comprobanteVenta(inicio = false) {
    const f = N.factura, ok = vigente(f, fV.fecha.value), chk = fV.factura;
    if (inicio) chk.checked = ok;
    if (!ok) chk.checked = false;
    chk.disabled = !ok;
    $("#ventaComp").innerHTML = ok && chk.checked ? `Factura <b>Nº ${nroFactura(f)}</b>`
      : ok ? "Ticket interno (sin factura)"
      : !facturaLista(f) && esBarbero() ? "Ticket interno (sin factura)"
      : !facturaLista(f) ? 'Ticket interno · <button type="button" class="link" data-abrir-timbrado>cargá tu timbrado</button> para facturar'
      : "Ticket interno · la fecha está fuera de la vigencia del timbrado";
  }
  fV.factura.addEventListener("change", () => comprobanteVenta());
  fV.fecha.addEventListener("change", () => comprobanteVenta());
  fV.condicion.addEventListener("change", () => { fV.forma_pago.disabled = fV.condicion.value === "credito"; });

  fV.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#ventaError"); mostrarError(err);
    if (!venta.lineas.length) return mostrarError(err, "Agregá al menos un servicio o producto.");
    if (!lineasOk(venta.lineas)) return mostrarError(err, "Revisá las cantidades y los precios (números enteros, sin puntos).");
    if (!fV.fecha.value) return mostrarError(err, "Elegí la fecha.");
    const desc = entero(fV.descuento.value || 0), prop = entero(fV.propina.value || 0);
    if (!Number.isInteger(desc) || desc < 0 || (fV.desc_tipo.value === "pct" && desc > 99)) return mostrarError(err, "Revisá el descuento (número entero; en % hasta 99).");
    if (descuentoVenta() >= totalLineas(venta.lineas) && descuentoVenta() > 0) return mostrarError(err, "El descuento tiene que ser menor que el total.");
    if (!Number.isInteger(prop) || prop < 0) return mostrarError(err, "Revisá la propina (número entero, sin puntos).");
    if (prop && !fV.barbero_id.value) return mostrarError(err, "Elegí el barbero que recibe la propina.");
    if (prop && fV.condicion.value === "credito") return mostrarError(err, "La propina se registra solo en ventas al contado.");
    const btn = $("#btnCobrar"); btn.disabled = true;
    try {
      const { venta: v, factura } = await DB.crearVenta({
        fecha: fV.fecha.value, cliente_nombre: fV.cliente_nombre.value, cliente_ruc: fV.cliente_ruc.value, cliente_id: venta.cliente_id || null,
        condicion: fV.condicion.value, forma_pago: fV.forma_pago.value, barbero_id: Number(fV.barbero_id.value) || null,
        turno_id: venta.turno?.id || null, factura: fV.factura.checked, nota: fV.nota.value,
        descuento: descuentoVenta(), propina: propinaVenta(),
        items: venta.lineas.map(({ tipo, id, cantidad, precio }) => ({ tipo, id, cantidad, precio })),
      });
      clientesCache = null; // puede haber un cliente nuevo (por su RUC)
      if (factura) N.factura = factura;
      $("#modalVenta").close();
      U.toast(`${v.tipo === "factura" ? "Factura" : "Ticket"} ${v.numero} · ${U.gs(v.total)}`);
      if (v.items.some((i) => i.tipo === "producto")) cargarProductos().catch(() => {});
      if (venta.turno) ctx.turnosCambiaron();
      if (g.mod === "ventas") cargarVentas().catch(() => {});
      verVenta(v);
    } catch (ex) { mostrarError(err, ex.message); }
    finally { btn.disabled = false; }
  });

  /* ---------- Comprobante: ver, imprimir, WhatsApp, anular ---------- */
  function comprobanteHtml(v) {
    const sello = v.anulada ? `<div class="doc__anulada">ANULADO</div>` : "";
    const logo = N.logo ? `<img class="doc__logo" src="${esc(N.logo)}" alt="">` : "";
    if (v.tipo !== "factura") {
      return `<article class="doc doc--ticket">${sello}
        <header class="doc__centro">${logo}<strong>${esc(N.nombre)}</strong>
          ${N.direccion ? `<small>${esc(N.direccion)}</small>` : ""}${N.whatsapp ? `<small>Tel: ${esc(N.whatsapp)}</small>` : ""}</header>
        <p class="doc__aviso">COMPROBANTE INTERNO Nº ${esc(v.numero)}<br><small>No válido como factura</small></p>
        <p class="doc__meta">Fecha: ${dmy(v.fecha)} ${esc(v.hora)} hs<br>Cliente: ${esc(v.cliente_nombre)}${v.cliente_ruc ? ` · ${esc(v.cliente_ruc)}` : ""}
          ${v.barbero_nombre ? `<br>Atendió: ${esc(v.barbero_nombre)}` : ""}</p>
        <table class="doc__items"><thead><tr><th class="c">Cant.</th><th>Descripción</th><th class="n">Importe</th></tr></thead>
          <tbody>${v.items.map((i) => `<tr><td class="c">${i.cantidad}</td><td>${esc(i.descripcion)}${i.cantidad > 1 ? `<small> (${num(i.precio)} c/u)</small>` : ""}</td><td class="n">${num(i.cantidad * i.precio)}</td></tr>`).join("")}</tbody>
          <tfoot>${v.descuento ? `<tr class="sub"><td colspan="2">Subtotal</td><td class="n">${num(v.subtotal)}</td></tr>
            <tr class="sub"><td colspan="2">Descuento</td><td class="n">−${num(v.descuento)}</td></tr>` : ""}
            <tr><td colspan="2">TOTAL Gs.</td><td class="n">${num(v.total)}</td></tr></tfoot></table>
        ${v.propina ? `<div class="tk__bloque">${filaT(`Propina${v.barbero_nombre ? " para " + esc(v.barbero_nombre) : ""}`, num(v.propina))}
          ${filaT("TOTAL PAGADO Gs.", num(v.total + v.propina), "tk__total")}</div>` : ""}
        <p class="doc__meta">Pago: ${pagoTxt(v)}</p>
        <p class="doc__centro"><small>¡Gracias por tu visita!</small></p>
      </article>`;
    }
    // Factura en formato ticket (impresora térmica de 80 mm)
    const t = v.timbrado;
    const tasa = (iva) => (iva === 10 ? "10%" : iva === 5 ? "5%" : "Ex.");
    const fila = (a, b, cls = "") => `<div class="tk__fila ${cls}"><span>${a}</span><span>${b}</span></div>`;
    return `<article class="doc doc--ticket doc--fticket">${sello}
      <header class="doc__centro">${logo}<strong>${esc(t.razon_social)}</strong>
        ${t.nombre_fantasia && t.nombre_fantasia !== t.razon_social ? `<span>${esc(t.nombre_fantasia)}</span>` : ""}
        ${t.actividad ? `<small>${esc(t.actividad)}</small>` : ""}
        ${t.direccion ? `<small>${esc(t.direccion)}</small>` : ""}${t.telefono ? `<small>Tel: ${esc(t.telefono)}</small>` : ""}</header>
      <div class="doc__aviso">
        <div>RUC: ${esc(t.ruc)}</div>
        <div>TIMBRADO Nº ${esc(t.numero)}</div>
        <small>Vigencia: ${dmy(t.desde)} al ${dmy(t.hasta)}</small>
        <div class="tk__tipo">FACTURA ${v.condicion === "credito" ? "CRÉDITO" : "CONTADO"}</div>
        <div>Nº ${esc(v.numero)}</div>
      </div>
      <p class="doc__meta">Fecha de emisión: ${dmy(v.fecha)}${v.hora ? ` ${esc(v.hora)} hs` : ""}<br>
        Nombre o razón social: ${esc(v.cliente_nombre)}<br>
        RUC / CI: ${esc(v.cliente_ruc || "")}
        ${v.cliente_telefono ? `<br>Teléfono: ${esc(v.cliente_telefono)}` : ""}
        ${v.barbero_nombre ? `<br>Atendió: ${esc(v.barbero_nombre)}` : ""}</p>
      <table class="doc__items"><thead><tr><th class="c">Cant.</th><th>Descripción</th><th class="n">IVA</th><th class="n">Importe</th></tr></thead>
        <tbody>${v.items.map((i) => `<tr><td class="c">${i.cantidad}</td><td>${esc(i.descripcion)}${i.cantidad > 1 ? `<small> (${num(i.precio)} c/u)</small>` : ""}</td>
          <td class="n">${tasa(i.iva)}</td><td class="n">${num(i.cantidad * i.precio)}</td></tr>`).join("")}</tbody></table>
      <div class="tk__bloque">
        ${v.descuento ? fila("Suma de los ítems", num(v.subtotal)) + fila("Descuento", "−" + num(v.descuento)) : ""}
        ${fila("Subtotal exentas", num(v.exenta))}${fila("Subtotal 5 %", num(v.grav5))}${fila("Subtotal 10 %", num(v.grav10))}
        ${fila("TOTAL A PAGAR Gs.", num(v.total), "tk__total")}
        <small>Son guaraníes ${letras(v.total)}.</small>
      </div>
      <div class="tk__bloque">
        <b>LIQUIDACIÓN DEL IVA</b>
        ${fila("IVA 5 %", num(v.iva5))}${fila("IVA 10 %", num(v.iva10))}${fila("<b>Total IVA</b>", `<b>${num(v.iva5 + v.iva10)}</b>`)}
      </div>
      <p class="doc__meta">Forma de pago: ${pagoTxt(v)}${v.propina ? `<br>Propina${v.barbero_nombre ? " para " + esc(v.barbero_nombre) : ""}: Gs. ${num(v.propina)} (no forma parte de la factura)` : ""}</p>
      <p class="doc__centro"><b>ORIGINAL: CLIENTE</b><small>¡Gracias por tu visita!</small></p>
    </article>`;
  }
  let compActual = null;
  function verVenta(v) {
    if (!v) return;
    compActual = v;
    $("#compTitulo").textContent = `${v.tipo === "factura" ? "Factura" : "Ticket"} ${v.numero}`;
    $("#compHoja").innerHTML = comprobanteHtml(v) +
      (v.anulada ? `<p class="note doc__motivo">Anulado: ${esc(v.anulada_motivo || "")}</p>` : "");
    $("#compAnular").hidden = v.anulada || esBarbero(); // anular es solo del dueño
    const txt = `${N.nombre}\n${v.tipo === "factura" ? "Factura" : "Comprobante"} ${v.numero} · ${dmy(v.fecha)}\n` +
      v.items.map((i) => `${i.cantidad} × ${i.descripcion}: ${U.gs(i.cantidad * i.precio)}`).join("\n") +
      (v.descuento ? `\nDescuento: −${U.gs(v.descuento)}` : "") +
      `\nTotal: ${U.gs(v.total)}` + (v.propina ? `\nPropina: ${U.gs(v.propina)}` : "") + "\n¡Gracias por tu visita!";
    $("#compWa").href = v.cliente_telefono ? U.waLink(v.cliente_telefono, txt) : "https://wa.me/?text=" + encodeURIComponent(txt);
    U.icons();
    if (!$("#modalComprobante").open) $("#modalComprobante").showModal();
  }
  $("#compImprimir").addEventListener("click", () => { if (compActual) imprimirTicket(comprobanteHtml(compActual)); });
  $("#compAnular").addEventListener("click", async () => {
    const v = compActual; if (!v) return;
    const motivo = prompt(`Anular ${v.tipo === "factura" ? "la factura" : "el ticket"} ${v.numero}.\n` +
      (v.tipo === "factura" ? "El número queda usado (no se reutiliza). " : "") + "Si tenía productos, vuelven al stock.\n\nMotivo:");
    if (motivo === null) return;
    try {
      const a = await DB.anularVenta(v.id, motivo);
      U.toast(`${v.numero} anulado`);
      verVenta(a);
      if (a.items.some((i) => i.tipo === "producto")) cargarProductos().catch(() => {});
      if (a.turno_id) ctx.turnosCambiaron();
      if (g.mod === "ventas") cargarVentas().catch(() => {});
    } catch (ex) { U.toast(ex.message, "error"); }
  });

  /* ---------- Timbrado ---------- */
  const fT = $("#formTimbrado");
  function abrirTimbrado() {
    const f = N.factura || {};
    mostrarError($("#timbradoError"));
    fT.razon_social.value = f.razon_social || N.nombre || "";
    ["ruc", "actividad", "timbrado", "direccion", "telefono"].forEach((k) => { fT[k].value = f[k] || ""; });
    fT.desde.value = f.desde || U.hoy();
    fT.hasta.value = f.hasta || U.addDays(U.sumarMeses(U.hoy(), 12), -1);
    fT.establecimiento.value = f.establecimiento || "001"; fT.punto.value = f.punto || "001";
    fT.proximo.value = f.proximo || 1;
    previaTimbrado();
    U.icons();
    $("#modalTimbrado").showModal();
  }
  function previaTimbrado() {
    const p = { establecimiento: fT.establecimiento.value.padStart(3, "0"), punto: fT.punto.value.padStart(3, "0"), proximo: Number(fT.proximo.value) || 1 };
    $("#timbradoPrev").innerHTML = `La próxima factura va a ser la <b>Nº ${esc(nroFactura(p))}</b>.`;
  }
  fT.addEventListener("input", previaTimbrado);
  $("#btnTimbrado").addEventListener("click", abrirTimbrado);
  document.addEventListener("click", (e) => { if (e.target.closest("[data-abrir-timbrado]")) abrirTimbrado(); });
  fT.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#timbradoError"); mostrarError(err);
    const d = Object.fromEntries(new FormData(fT));
    d.establecimiento = d.establecimiento.trim().padStart(3, "0"); d.punto = d.punto.trim().padStart(3, "0");
    d.proximo = Number(d.proximo);
    const btn = $("button[type=submit]", fT); btn.disabled = true;
    try {
      N.factura = await DB.guardarFacturacion(d);
      $("#modalTimbrado").close();
      U.toast("Datos de facturación guardados");
      if (g.mod === "ventas") avisoTimbrado(), U.icons();
      if ($("#modalVenta").open) comprobanteVenta(true);
    } catch (ex) { mostrarError(err, ex.message); }
    finally { btn.disabled = false; }
  });

  /* ============================================================
     COMPRAS
     ============================================================ */
  async function cargarCompras() {
    const [d, h] = rango(g.mes);
    g.compras = await DB.compras(d, h);
    renderCompras();
  }
  function renderCompras() {
    const ok = g.compras.filter((c) => !c.anulada);
    const total = suma(ok, "total"), iva = suma(ok, (c) => c.iva5 + c.iva10), credito = suma(ok.filter((c) => c.condicion === "credito"), "total");
    const porProv = {}; ok.forEach((c) => { porProv[c.proveedor] = (porProv[c.proveedor] || 0) + c.total; });
    const top = Object.entries(porProv).sort((a, b) => b[1] - a[1])[0];
    kpis($("#kpisCompras"), [
      ["shopping-cart", "Compras del mes", U.gs(total), plural(ok.length, "compra")],
      ["percent", "IVA incluido", U.gs(iva), "crédito fiscal (para tu contador)"],
      ["truck", "Proveedor principal", top ? esc(top[0]) : "—", top ? U.gs(top[1]) : "sin compras", "kpi--txt"],
      ["clock", "A crédito", U.gs(credito), "compras sin pagar al contado"],
    ]);
    const q = $("#comprasBuscar").value.trim().toLowerCase();
    const lista = g.compras.filter((c) => !q || c.proveedor.toLowerCase().includes(q) || (c.numero || "").includes(q) ||
      c.items.some((i) => i.descripcion.toLowerCase().includes(q)));
    $("#listaCompras").innerHTML = !lista.length
      ? vacio("shopping-cart", g.compras.length ? "Ninguna compra coincide con la búsqueda." : `No hay compras en ${mesTxt(g.mes)}. Cargá una con <b>Nueva compra</b>: suma al stock y actualiza los costos.`)
      : `<table class="tabla tabla--ges">
        <thead><tr><th>Fecha</th><th>Proveedor</th><th>Factura Nº</th><th>Detalle</th><th>Pago</th><th class="num">Total</th><th><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${lista.map((c) => `
          <tr class="${c.anulada ? "is-anulada" : ""}">
            <td data-l="Fecha">${dmy(c.fecha)}</td>
            <td data-l="Proveedor"><strong>${esc(c.proveedor)}</strong><small>${esc(c.proveedor_ruc || "")}</small></td>
            <td data-l="Factura Nº">${esc(c.numero || "—")}${c.anulada ? '<small><span class="tag tag--danger">Anulada</span></small>' : ""}</td>
            <td data-l="Detalle">${esc(resumenItems(c.items))}</td>
            <td data-l="Pago">${pagoTxt(c)}</td>
            <td data-l="Total" class="num"><strong>${U.gs(c.total)}</strong></td>
            <td class="tabla__acc"><button class="icon-btn" data-ver-compra="${c.id}" aria-label="Ver compra"><i data-lucide="eye"></i></button></td>
          </tr>`).join("")}</tbody>
      </table>`;
    U.icons();
  }
  $("#comprasBuscar").addEventListener("input", renderCompras);
  $("#listaCompras").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ver-compra]"); if (b) verCompra(g.compras.find((c) => c.id === Number(b.dataset.verCompra)));
  });

  function verCompra(c) {
    if (!c) return;
    $("#verTitulo").textContent = `Compra a ${c.proveedor}`;
    $("#verSub").textContent = `${U.fechaLarga(c.fecha)}${c.numero ? " · factura " + c.numero : ""}`;
    $("#verCuerpo").innerHTML = `
      ${c.anulada ? `<p class="abono abono--danger"><i data-lucide="ban"></i><span>Compra anulada: ${esc(c.anulada_motivo || "")}</span></p>` : ""}
      <div class="tabla-wrap"><table class="tabla tabla--mini">
        <thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">Costo unit.</th><th class="num">Subtotal</th></tr></thead>
        <tbody>${c.items.map((i) => `<tr><td>${esc(i.descripcion)}</td><td class="num">${i.cantidad}</td><td class="num">${U.gs(i.precio)}</td><td class="num">${U.gs(i.cantidad * i.precio)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="3">Total <small>(IVA incluido ${U.gs(c.iva5 + c.iva10)})</small></td><td class="num"><strong>${U.gs(c.total)}</strong></td></tr></tfoot>
      </table></div>
      <dl class="summary" style="margin-top:1rem">
        <div><dt><i data-lucide="credit-card"></i>Pago</dt><dd>${pagoTxt(c)}</dd></div>
        ${c.proveedor_ruc ? `<div><dt><i data-lucide="hash"></i>RUC</dt><dd>${esc(c.proveedor_ruc)}</dd></div>` : ""}
        ${c.nota ? `<div><dt><i data-lucide="sticky-note"></i>Nota</dt><dd>${esc(c.nota)}</dd></div>` : ""}
      </dl>
      ${c.anulada ? "" : `<div class="modal__actions"><button class="btn btn--danger btn--sm" data-anular-compra="${c.id}"><i data-lucide="ban"></i>Anular compra</button></div>`}`;
    U.icons();
    if (!$("#modalVer").open) $("#modalVer").showModal();
  }
  $("#verCuerpo").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-anular-compra]"); if (!b) return;
    const c = g.compras.find((x) => x.id === Number(b.dataset.anularCompra));
    const motivo = prompt("Anular esta compra: lo que sumó al stock se descuenta.\n\nMotivo:");
    if (motivo === null) return;
    try {
      const a = await DB.anularCompra(c.id, motivo);
      U.toast("Compra anulada");
      Object.assign(c, a); verCompra(c);
      await cargarProductos(); renderCompras();
    } catch (ex) { U.toast(ex.message, "error"); }
  });

  /* ---------- Nueva compra ---------- */
  const fCo = $("#formCompra");
  let compra = { lineas: [] }, pintarCompra = () => {}, proveedores = [];

  async function abrirCompra() {
    try { await cargarProductos(); proveedores = await DB.proveedores(); } catch (e) { U.toast(e.message, "error"); return; }
    compra = { lineas: [] };
    fCo.reset(); mostrarError($("#compraError"));
    $("#proveedoresLista").innerHTML = proveedores.map((p) => `<option value="${esc(p.nombre)}"></option>`).join("");
    fCo.fecha.max = U.hoy(); fCo.fecha.value = U.hoy();
    fCo.forma_pago.innerHTML = opcionesPago(); fCo.forma_pago.disabled = false;
    opcionesCompra();
    pintarCompra = lineasEditables($("#compraLineas"), compra.lineas, totalCompra, {
      etiquetaPrecio: "Costo unit.",
      detalle: (l) => { const p = g.productos.find((x) => x.id === l.id); return p ? `${p.tipo === "insumo" ? "Insumo" : "Para vender"} · stock ${p.stock}` : ""; },
    });
    U.icons();
    $("#modalCompra").showModal();
  }
  function opcionesCompra() {
    const act = g.productos.filter((p) => p.activo);
    const grupo = (tipo, txt) => { const l = act.filter((p) => p.tipo === tipo); return l.length ? `<optgroup label="${txt}">${l.map((p) =>
      `<option value="${p.id}">${esc(p.nombre)} · stock ${p.stock}${p.costo ? " · último costo " + U.gs(p.costo) : ""}</option>`).join("")}</optgroup>` : ""; };
    $("#compraAgregar").innerHTML = `<option value="">${act.length ? "+ Agregar producto…" : "Todavía no hay productos: creá uno →"}</option>` +
      grupo("venta", "Para vender") + grupo("insumo", "Insumos");
  }
  const agregarACompra = (p) => {
    const ya = compra.lineas.find((l) => l.id === p.id);
    if (ya) ya.cantidad = (Number.isInteger(ya.cantidad) ? ya.cantidad : 0) + 1;
    else compra.lineas.push({ id: p.id, descripcion: p.nombre, cantidad: 1, precio: p.costo || 0, iva: p.iva });
    pintarCompra();
  };
  $("#compraAgregar").addEventListener("change", (e) => {
    const p = g.productos.find((x) => x.id === Number(e.target.value)); e.target.value = "";
    if (p) agregarACompra(p);
  });
  $("#compraProdNuevo").addEventListener("click", () => abrirProducto(null, { desdeCompra: true }));
  fCo.proveedor.addEventListener("change", () => {
    const p = proveedores.find((x) => x.nombre.toLowerCase() === fCo.proveedor.value.trim().toLowerCase());
    if (p && p.ruc && !fCo.proveedor_ruc.value) fCo.proveedor_ruc.value = p.ruc;
  });
  fCo.condicion.addEventListener("change", () => { fCo.forma_pago.disabled = fCo.condicion.value === "credito"; });
  function totalCompra() {
    $("#compraTotal").innerHTML = `<span>Total</span><strong>${U.gs(totalLineas(compra.lineas))}</strong><small>IVA incluido ${U.gs(ivaLineas(compra.lineas))}</small>`;
  }
  fCo.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#compraError"); mostrarError(err);
    if (fCo.proveedor.value.trim().length < 2) return mostrarError(err, "Escribí el proveedor.");
    if (!compra.lineas.length) return mostrarError(err, "Agregá al menos un producto.");
    if (!lineasOk(compra.lineas)) return mostrarError(err, "Revisá las cantidades y los costos (números enteros, sin puntos).");
    const btn = $("button[type=submit]", fCo); btn.disabled = true;
    try {
      const d = Object.fromEntries(new FormData(fCo));
      await DB.crearCompra({ ...d, forma_pago: fCo.forma_pago.value, items: compra.lineas.map((l) => ({ producto_id: l.id, cantidad: l.cantidad, costo: l.precio })) });
      $("#modalCompra").close();
      U.toast(`Compra guardada · ${plural(compra.lineas.length, "producto")} sumados al stock`);
      await cargarProductos();
      if (g.mod === "compras") await cargarCompras();
      if (g.mod === "stock") renderStock();
    } catch (ex) { mostrarError(err, ex.message); }
    finally { btn.disabled = false; }
  });
  $("#btnNuevaCompra").addEventListener("click", abrirCompra);

  /* ============================================================
     GASTOS
     ============================================================ */
  async function cargarGastos() {
    const [d, h] = rango(g.mes), [da, ha] = rango(U.sumarMeses(g.mes + "-01", -1).slice(0, 7));
    [g.gastos, g.gastosAnt, g.compras] = await Promise.all([DB.gastos(d, h), DB.gastos(da, ha), DB.compras(d, h)]);
    renderGastos();
  }
  function renderGastos() {
    const sel = $("#gastosCat");
    if (sel.options.length === 1) sel.innerHTML += cfg.categoriasGasto.map((c) => `<option>${esc(c)}</option>`).join("");
    sel.value = g.catGasto;
    const total = suma(g.gastos, "monto"), ant = suma(g.gastosAnt, "monto"), compras = suma(g.compras.filter((c) => !c.anulada), "total");
    const porCat = {}; g.gastos.forEach((x) => { porCat[x.categoria] = (porCat[x.categoria] || 0) + x.monto; });
    const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
    const pct = ant ? Math.round((total / ant) * 100) : null;
    const comparar = pct === null ? "sin datos para comparar"
      : g.mes === mesHoy() ? `este mes llevás el ${pct} % de eso` : `este mes fue el ${pct} % de eso`;
    kpis($("#kpisGastos"), [
      ["wallet", "Gastos del mes", U.gs(total), plural(g.gastos.length, "gasto")],
      ["pie-chart", "Mayor categoría", cats[0] ? esc(cats[0][0]) : "—", cats[0] ? `${U.gs(cats[0][1])} · ${Math.round((cats[0][1] / total) * 100)} %` : "sin gastos", "kpi--txt"],
      ["calendar-clock", "Mes anterior", U.gs(ant), comparar],
      ["arrow-down-up", "Gastos + compras", U.gs(total + compras), `compras ${U.gs(compras)}`],
    ]);
    const max = cats[0]?.[1] || 1;
    $("#gastosPorCat").innerHTML = cats.length ? cats.map(([c, m]) => `
      <li><button type="button" class="cat-bar ${g.catGasto === c ? "is-sel" : ""}" data-cat="${esc(c)}" aria-pressed="${g.catGasto === c}">
        <span class="cat-bar__txt"><span>${esc(c)}</span><b>${U.gs(m)}</b></span>
        <span class="cat-bar__pista"><span style="width:${Math.max(2, (m / max) * 100)}%"></span></span>
        <small>${Math.round((m / total) * 100)} %</small>
      </button></li>`).join("") : `<li class="note">Sin gastos este mes.</li>`;
    const lista = g.gastos.filter((x) => !g.catGasto || x.categoria === g.catGasto);
    $("#listaGastos").innerHTML = !lista.length
      ? vacio("wallet", g.gastos.length ? "No hay gastos en esa categoría." : `No hay gastos en ${mesTxt(g.mes)}. Cargá alquiler, luz, sueldos… con <b>Nuevo gasto</b>.`)
      : `<table class="tabla tabla--ges">
        <thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Pago</th><th class="num">Monto</th><th><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${lista.map((x) => `
          <tr>
            <td data-l="Fecha">${dmy(x.fecha)}</td>
            <td data-l="Categoría">${esc(x.categoria)}</td>
            <td data-l="Descripción">${esc(x.descripcion)}<small>${esc([x.proveedor, x.comprobante].filter(Boolean).join(" · "))}</small></td>
            <td data-l="Pago">${pagoTxt(x)}</td>
            <td data-l="Monto" class="num"><strong>${U.gs(x.monto)}</strong></td>
            <td class="tabla__acc">
              <button class="icon-btn" data-editar-gasto="${x.id}" aria-label="Editar gasto"><i data-lucide="pencil"></i></button>
              <button class="icon-btn icon-btn--danger" data-borrar-gasto="${x.id}" aria-label="Eliminar gasto"><i data-lucide="trash-2"></i></button>
            </td>
          </tr>`).join("")}</tbody>
      </table>`;
    U.icons();
  }
  $("#gastosCat").addEventListener("change", (e) => { g.catGasto = e.target.value; renderGastos(); });
  $("#gastosPorCat").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]"); if (!b) return;
    g.catGasto = g.catGasto === b.dataset.cat ? "" : b.dataset.cat; renderGastos();
  });
  $("#listaGastos").addEventListener("click", async (e) => {
    const ed = e.target.closest("[data-editar-gasto]");
    if (ed) return abrirGasto(g.gastos.find((x) => x.id === Number(ed.dataset.editarGasto)));
    const del = e.target.closest("[data-borrar-gasto]");
    if (!del) return;
    const x = g.gastos.find((y) => y.id === Number(del.dataset.borrarGasto));
    if (!confirm(`¿Eliminar el gasto «${x.descripcion}» de ${U.gs(x.monto)}?`)) return;
    try { await DB.eliminarGasto(x.id); U.toast("Gasto eliminado"); await cargarGastos(); } catch (ex) { U.toast(ex.message, "error"); }
  });

  const fG = $("#formGasto");
  async function abrirGasto(x = null) {
    fG.reset(); mostrarError($("#gastoError"));
    fG.categoria.innerHTML = '<option value="">Elegí…</option>' + cfg.categoriasGasto.map((c) => `<option>${esc(c)}</option>`).join("");
    fG.forma_pago.innerHTML = opcionesPago();
    fG.fecha.max = U.hoy();
    try { $("#proveedoresLista").innerHTML = (await DB.proveedores()).map((p) => `<option value="${esc(p.nombre)}"></option>`).join(""); } catch (e) { /* opcional */ }
    $("#gastoTitulo").textContent = x ? "Editar gasto" : "Nuevo gasto";
    fG.id.value = x?.id || "";
    fG.categoria.value = x?.categoria || g.catGasto || "";
    ["monto", "descripcion", "proveedor", "comprobante"].forEach((k) => { fG[k].value = x?.[k] ?? ""; });
    fG.fecha.value = x?.fecha || (g.mes === mesHoy() ? U.hoy() : rango(g.mes)[1]);
    fG.forma_pago.value = x?.forma_pago || "efectivo";
    U.icons();
    $("#modalGasto").showModal();
  }
  fG.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#gastoError"); mostrarError(err);
    if (!fG.checkValidity()) return mostrarError(err, "Completá la categoría, el monto (sin puntos), la descripción y la fecha.");
    const d = Object.fromEntries(new FormData(fG));
    const btn = $("button[type=submit]", fG); btn.disabled = true;
    try {
      await DB.guardarGasto({ ...d, id: Number(d.id) || null, monto: Number(d.monto), condicion: "contado" });
      $("#modalGasto").close();
      U.toast(d.id ? "Gasto actualizado" : "Gasto guardado");
      if (g.mod === "gastos") { if (d.fecha.slice(0, 7) !== g.mes) irMes(d.fecha.slice(0, 7)); else await cargarGastos(); }
    } catch (ex) { mostrarError(err, ex.message); }
    finally { btn.disabled = false; }
  });
  $("#btnNuevoGasto").addEventListener("click", () => abrirGasto());

  /* ============================================================
     STOCK
     ============================================================ */
  function renderStock() {
    const act = g.productos.filter((p) => p.activo);
    const valor = suma(act, (p) => Math.max(0, p.stock) * p.costo);
    const bajos = act.filter((p) => estadoStock(p) === "bajo").length, sin = act.filter((p) => estadoStock(p) === "sin").length;
    kpis($("#kpisStock"), [
      ["package", "Productos", act.length, `${act.filter((p) => p.tipo === "venta").length} para vender · ${act.filter((p) => p.tipo === "insumo").length} insumos`],
      ["coins", "Valor del stock", U.gs(valor), "a precio de costo"],
      ["triangle-alert", "Stock bajo", bajos, "en el mínimo o debajo", bajos ? "kpi--warn" : ""],
      ["package-x", "Sin stock", sin, "hay que reponer", sin ? "kpi--neg" : ""],
    ]);
    const q = $("#stockBuscar").value.trim().toLowerCase(), f = $("#stockFiltro").value;
    const lista = g.productos.filter((p) => (!q || p.nombre.toLowerCase().includes(q)) && (
      f === "inactivo" ? !p.activo : !p.activo ? false : f === "bajo" ? estadoStock(p) !== "ok" : !f || p.tipo === f));
    const pill = (p) => { const e = estadoStock(p); return `<span class="tag tag--${e === "ok" ? "ok" : e === "bajo" ? "warn" : "danger"}">${cant(p, p.stock)}</span>`; };
    $("#listaStock").innerHTML = !lista.length
      ? vacio("package", g.productos.length ? "Ningún producto coincide." : "Todavía no cargaste productos. Agregá los que vendés (pomadas, shampoo…) y los insumos que usás (navajas, talco…).")
      : `<table class="tabla tabla--ges">
        <thead><tr><th>Producto</th><th>Tipo</th><th>Stock</th><th class="num">Mínimo</th><th class="num">Costo</th><th class="num">Precio</th><th><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${lista.map((p) => `
          <tr class="${p.activo ? "" : "is-off"}">
            <td data-l="Producto"><strong>${esc(p.nombre)}</strong>${p.activo ? "" : "<small>Inactivo</small>"}</td>
            <td data-l="Tipo">${p.tipo === "insumo" ? "Insumo" : "Para vender"}</td>
            <td data-l="Stock">${pill(p)}</td>
            <td data-l="Mínimo" class="num">${p.minimo}</td>
            <td data-l="Costo" class="num">${U.gs(p.costo)}</td>
            <td data-l="Precio" class="num">${p.tipo === "venta" ? U.gs(p.precio) : "—"}</td>
            <td class="tabla__acc">
              <button class="icon-btn" data-ajustar="${p.id}" aria-label="Ajustar stock de ${esc(p.nombre)}" title="Ajustar stock"><i data-lucide="sliders-horizontal"></i></button>
              <button class="icon-btn" data-historial="${p.id}" aria-label="Movimientos de ${esc(p.nombre)}" title="Movimientos"><i data-lucide="history"></i></button>
              <button class="icon-btn" data-editar-prod="${p.id}" aria-label="Editar ${esc(p.nombre)}" title="Editar"><i data-lucide="pencil"></i></button>
              <button class="icon-btn icon-btn--danger" data-borrar-prod="${p.id}" aria-label="Eliminar ${esc(p.nombre)}" title="Eliminar"><i data-lucide="trash-2"></i></button>
            </td>
          </tr>`).join("")}</tbody>
      </table>`;
    U.icons();
  }
  $("#stockBuscar").addEventListener("input", renderStock);
  $("#stockFiltro").addEventListener("change", renderStock);
  $("#btnNuevoProducto").addEventListener("click", () => abrirProducto());
  $("#listaStock").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-ajustar],button[data-historial],button[data-editar-prod],button[data-borrar-prod]"); if (!b) return;
    const p = g.productos.find((x) => x.id === Number(b.dataset.ajustar || b.dataset.historial || b.dataset.editarProd || b.dataset.borrarProd));
    if (!p) return;
    if (b.dataset.ajustar) return abrirAjuste(p);
    if (b.dataset.historial) return verMovimientos(p);
    if (b.dataset.editarProd) return abrirProducto(p);
    if (!confirm(`¿Eliminar «${p.nombre}»? Esta acción no se puede deshacer.`)) return;
    try { await DB.eliminarProducto(p.id); U.toast(`«${p.nombre}» eliminado`); await cargarProductos(); renderStock(); }
    catch (ex) { U.toast(ex.message, "error"); }
  });

  /* ---------- Producto ---------- */
  const fP = $("#formProducto");
  let prodOpts = {};
  function abrirProducto(p = null, opts = {}) {
    prodOpts = opts;
    fP.reset(); mostrarError($("#productoError"));
    $("#productoTitulo").textContent = p ? `Editar «${p.nombre}»` : "Nuevo producto";
    fP.id.value = p?.id || "";
    fP.nombre.value = p?.nombre || "";
    fP.tipo.value = p?.tipo || "venta";
    ["precio", "costo", "minimo"].forEach((k) => { fP[k].value = p ? p[k] : k === "minimo" ? 0 : ""; });
    fP.iva.value = String(p?.iva ?? 10);
    fP.unidad.value = p?.unidad || "unidad";
    fP.stock.value = 0;
    fP.activo.checked = p ? p.activo : true;
    $("#campoStockIni").hidden = Boolean(p);
    $("#campoActivo").hidden = !p;
    tipoProducto();
    U.icons();
    $("#modalProducto").showModal();
    fP.nombre.focus();
  }
  const tipoProducto = () => { $("#campoPrecio").hidden = fP.tipo.value !== "venta"; };
  $$("input[name=tipo]", fP).forEach((r) => r.addEventListener("change", tipoProducto));
  fP.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#productoError"); mostrarError(err);
    const id = Number(fP.id.value) || null, tipo = fP.tipo.value;
    if (fP.nombre.value.trim().length < 2) return mostrarError(err, "Escribí el nombre del producto.");
    const n = (k) => (fP[k].value === "" ? 0 : Number(fP[k].value));
    const datos = { nombre: fP.nombre.value.trim(), tipo, unidad: fP.unidad.value.trim() || "unidad", precio: tipo === "venta" ? n("precio") : 0,
      costo: n("costo"), iva: Number(fP.iva.value), minimo: n("minimo") };
    if (tipo === "venta" && !datos.precio) return mostrarError(err, "Poné el precio de venta.");
    if (id) datos.activo = fP.activo.checked; else datos.stock = n("stock");
    const btn = $("button[type=submit]", fP); btn.disabled = true;
    try {
      const p = await DB.guardarProducto(id ? { id, ...datos } : datos);
      $("#modalProducto").close();
      U.toast(id ? "Producto actualizado" : `«${p.nombre}» agregado`);
      await cargarProductos();
      if (g.mod === "stock") renderStock();
      if (prodOpts.desdeCompra && $("#modalCompra").open) { opcionesCompra(); agregarACompra(p); }
    } catch (ex) { mostrarError(err, ex.message); }
    finally { btn.disabled = false; }
  });

  /* ---------- Ajuste de stock ---------- */
  const fA = $("#formAjuste");
  let ajusteProd = null;
  function abrirAjuste(p) {
    ajusteProd = p;
    fA.reset(); mostrarError($("#ajusteError"));
    fA.id.value = p.id;
    fA.tipo.value = p.tipo === "insumo" ? "uso" : "conteo";
    $("#ajusteProd").textContent = `${p.nombre} · stock actual ${cant(p, p.stock)}`;
    previaAjuste();
    $("#modalAjuste").showModal();
    fA.cantidad.focus();
  }
  function previaAjuste() {
    const p = ajusteProd, t = fA.tipo.value, c = entero(fA.cantidad.value);
    $("#ajusteCantTxt").textContent = t === "conteo" ? "Stock contado (lo que hay en realidad)" : "Cantidad";
    const queda = t === "conteo" ? c : t === "ingreso" ? p.stock + c : p.stock - c;
    $("#ajustePrev").innerHTML = Number.isInteger(c) ? `Stock actual <b>${p.stock}</b> → queda <b>${queda}</b>${queda < 0 ? " (no puede quedar negativo)" : ""}` : "";
  }
  fA.addEventListener("input", previaAjuste);
  fA.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#ajusteError"); mostrarError(err);
    const btn = $("button[type=submit]", fA); btn.disabled = true;
    try {
      const p = await DB.ajustarStock(ajusteProd.id, { tipo: fA.tipo.value, cantidad: entero(fA.cantidad.value), nota: fA.nota.value });
      $("#modalAjuste").close();
      U.toast(`Stock de «${p.nombre}»: ${p.stock}`);
      await cargarProductos(); renderStock();
    } catch (ex) { mostrarError(err, ex.message); }
    finally { btn.disabled = false; }
  });

  /* ---------- Movimientos de un producto ---------- */
  async function verMovimientos(p) {
    let movs;
    try { movs = await DB.movimientos(p.id); } catch (ex) { U.toast(ex.message, "error"); return; }
    $("#verTitulo").textContent = p.nombre;
    $("#verSub").innerHTML = `Stock actual: ${cant(p, p.stock)} · ${plural(movs.length, "movimiento")}`;
    $("#verCuerpo").innerHTML = !movs.length ? vacio("history", "Sin movimientos todavía.") : `
      <div class="tabla-wrap"><table class="tabla tabla--mini">
        <thead><tr><th>Fecha</th><th>Movimiento</th><th class="num">Cant.</th><th class="num">Queda</th><th>Detalle</th></tr></thead>
        <tbody>${movs.map((m) => `<tr>
          <td data-l="Fecha">${dmy(m.fecha)}</td><td data-l="Movimiento">${MOVS[m.tipo] || m.tipo}</td>
          <td data-l="Cant." class="num ${m.cantidad < 0 ? "neg" : "pos"}">${m.cantidad > 0 ? "+" : ""}${m.cantidad}</td>
          <td data-l="Queda" class="num">${m.saldo}</td><td data-l="Detalle">${esc(m.ref || m.nota || "")}</td></tr>`).join("")}</tbody>
      </table></div>`;
    U.icons();
    if (!$("#modalVer").open) $("#modalVer").showModal();
  }

  /* ============================================================
     EXPORTAR A EXCEL (para el contador)
     Un archivo .xlsx con el mes elegido: Resumen, Ventas, Compras y Gastos.
     La librería se carga recién al exportar (con control de integridad).
     ============================================================ */
  const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  const XLSX_SRI = "sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw";
  let xlsxCarga = null;
  const cargarXlsx = () => (xlsxCarga ||= new Promise((ok, mal) => {
    if (window.XLSX) return ok(window.XLSX);
    const s = document.createElement("script");
    Object.assign(s, { src: XLSX_URL, integrity: XLSX_SRI, crossOrigin: "anonymous" });
    s.onload = () => ok(window.XLSX);
    s.onerror = () => { xlsxCarga = null; s.remove(); mal(new Error("No se pudo preparar el Excel. Revisá tu conexión a internet y probá de nuevo.")); };
    document.head.append(s);
  }));
  const fechaXls = (f) => (f ? U.parse(f) : null);
  /** Hoja con encabezado en negrita, anchos de columna y montos con separador de miles */
  function hoja(X, filas, anchos, montos = []) {
    const ws = X.utils.aoa_to_sheet(filas, { cellDates: true, dateNF: "dd/mm/yyyy" });
    ws["!cols"] = anchos.map((wch) => ({ wch }));
    if (filas.length > 1) ws["!autofilter"] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length - 1, c: filas[0].length - 1 } }) };
    for (let r = 1; r < filas.length; r++) {
      montos.forEach((c) => { const cel = ws[X.utils.encode_cell({ r, c })]; if (cel && cel.t === "n") cel.z = "#,##0"; });
      filas[r].forEach((v, c) => { const cel = ws[X.utils.encode_cell({ r, c })]; if (cel && v instanceof Date) cel.z = "dd/mm/yyyy"; });
    }
    return ws;
  }
  async function exportarExcel(btn) {
    const [d, h] = rango(g.mes);
    btn.disabled = true; btn.classList.add("is-loading");
    try {
      const [X, ventas, compras, gastos] = await Promise.all([cargarXlsx(), DB.ventas(d, h), DB.compras(d, h), DB.gastos(d, h)]);
      const asc = (a, b) => (a.fecha + (a.hora || "")).localeCompare(b.fecha + (b.hora || "")) || String(a.numero || "").localeCompare(String(b.numero || ""));
      const vs = [...ventas].sort(asc), cs = [...compras].sort(asc), gs = [...gastos].sort(asc);
      const vOk = vs.filter((v) => !v.anulada), cOk = cs.filter((c) => !c.anulada);
      const sumar = (arr, k) => arr.reduce((a, x) => a + (x[k] || 0), 0);

      const filasV = [["Fecha", "Tipo", "Número", "Timbrado", "Cliente", "RUC / CI", "Condición", "Forma de pago", "Barbero",
        "Gravado 10% (IVA incl.)", "IVA 10%", "Gravado 5% (IVA incl.)", "IVA 5%", "Exento", "Descuento", "Total", "Propina (no facturada)", "Estado", "Motivo de anulación", "Detalle"]];
      vs.forEach((v) => filasV.push([fechaXls(v.fecha), v.tipo === "factura" ? "Factura" : "Ticket interno", v.numero, v.timbrado?.numero || "",
        v.cliente_nombre || "", v.cliente_ruc || "", v.condicion === "credito" ? "Crédito" : "Contado", v.condicion === "credito" ? "" : FORMAS[v.forma_pago] || "",
        v.barbero_nombre || "", v.grav10, v.iva10, v.grav5, v.iva5, v.exenta, v.descuento || 0, v.total, v.propina || 0,
        v.anulada ? "ANULADA" : "Válida", v.anulada_motivo || "", resumenItems(v.items)]));

      const filasC = [["Fecha", "Proveedor", "RUC", "Nº de factura", "Condición", "Forma de pago",
        "Gravado 10% (IVA incl.)", "IVA 10%", "Gravado 5% (IVA incl.)", "IVA 5%", "Exento", "Total", "Estado", "Detalle"]];
      cs.forEach((c) => filasC.push([fechaXls(c.fecha), c.proveedor, c.proveedor_ruc || "", c.numero || "", c.condicion === "credito" ? "Crédito" : "Contado",
        c.condicion === "credito" ? "" : FORMAS[c.forma_pago] || "", c.grav10, c.iva10, c.grav5, c.iva5, c.exenta, c.total,
        c.anulada ? "ANULADA" : "Válida", resumenItems(c.items)]));

      const filasG = [["Fecha", "Categoría", "Descripción", "Proveedor", "Comprobante", "Forma de pago", "Monto"]];
      gs.forEach((x) => filasG.push([fechaXls(x.fecha), x.categoria, x.descripcion, x.proveedor || "", x.comprobante || "",
        x.condicion === "credito" ? "Crédito" : FORMAS[x.forma_pago] || "", x.monto]));

      const fact = vOk.filter((v) => v.tipo === "factura"), tot = sumar(vOk, "total"), totC = sumar(cOk, "total"), totG = sumar(gs, "monto");
      const filasR = [
        ["Concepto", "Monto"],
        [`${N.nombre} · ${mesTxt(g.mes)}`, ""],
        ["", ""],
        ["VENTAS (sin anuladas)", ""],
        ["Total vendido", tot],
        [`Facturas (${fact.length})`, sumar(fact, "total")],
        [`Tickets internos (${vOk.length - fact.length})`, tot - sumar(fact, "total")],
        ["IVA 10% de las facturas (débito fiscal)", sumar(fact, "iva10")],
        ["IVA 5% de las facturas (débito fiscal)", sumar(fact, "iva5")],
        ["Descuentos otorgados", sumar(vOk, "descuento")],
        ["Propinas (no facturadas)", sumar(vOk, "propina")],
        [`Comprobantes anulados (${vs.length - vOk.length})`, ""],
        ["", ""],
        ["COMPRAS (sin anuladas)", ""],
        [`Total comprado (${cOk.length})`, totC],
        ["IVA 10% (crédito fiscal)", sumar(cOk, "iva10")],
        ["IVA 5% (crédito fiscal)", sumar(cOk, "iva5")],
        ["", ""],
        ["GASTOS", ""],
        [`Total gastos (${gs.length})`, totG],
        ["", ""],
        ["RESULTADO (ventas − compras − gastos)", tot - totC - totG],
      ];

      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, hoja(X, filasR, [44, 16], [1]), "Resumen");
      X.utils.book_append_sheet(wb, hoja(X, filasV, [11, 14, 17, 10, 28, 13, 10, 18, 14, 14, 11, 14, 11, 11, 11, 13, 13, 9, 26, 40], [9, 10, 11, 12, 13, 14, 15, 16]), "Ventas");
      X.utils.book_append_sheet(wb, hoja(X, filasC, [11, 30, 13, 18, 10, 18, 14, 11, 14, 11, 11, 13, 9, 40], [6, 7, 8, 9, 10, 11]), "Compras");
      X.utils.book_append_sheet(wb, hoja(X, filasG, [11, 20, 34, 24, 16, 18, 13], [6]), "Gastos");
      const archivo = `${(N.slug || "local").replace(/[^a-z0-9-]/gi, "")}-${g.mes}.xlsx`;
      X.writeFile(wb, archivo);
      U.toast(`Descargado ${archivo}`);
    } catch (ex) { U.toast(ex.message, "error"); }
    finally { btn.disabled = false; btn.classList.remove("is-loading"); }
  }
  $("#main").addEventListener("click", (e) => { const b = e.target.closest("[data-exportar]"); if (b && !esBarbero()) exportarExcel(b); });

  /* ============================================================
     CIERRE DE CAJA DEL DÍA
     Entradas: ventas al contado (por forma de pago) + propinas.
     Salidas: gastos y compras pagados en efectivo ese día.
     Efectivo esperado = fondo inicial + entradas en efectivo − salidas en efectivo.
     ============================================================ */
  const FONDO_KEY = "tb_caja_fondo";
  let caja = null;
  async function abrirCaja() {
    const f = $("#cajaFecha");
    f.max = U.hoy(); f.value = U.hoy();
    try { $("#cajaFondo").value = localStorage.getItem(FONDO_KEY) || ""; } catch (e) { /* sin storage */ }
    U.icons();
    $("#modalCaja").showModal();
    await cargarCaja();
  }
  async function cargarCaja() {
    const f = $("#cajaFecha").value || U.hoy();
    $("#cajaCuerpo").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    try {
      const [ventas, gastos, compras] = await Promise.all([DB.ventas(f, f), DB.gastos(f, f), DB.compras(f, f)]);
      caja = { fecha: f, ventas, gastos, compras, contado: caja?.fecha === f ? caja.contado : null };
      renderCaja();
    } catch (e) { $("#cajaCuerpo").innerHTML = vacio("wifi-off", esc(e.message)); U.icons(); }
  }
  function calcCaja() {
    const ok = caja.ventas.filter((v) => !v.anulada), cont = ok.filter((v) => v.condicion !== "credito");
    const formas = {};
    cont.forEach((v) => {
      const k = v.forma_pago || "efectivo", x = (formas[k] ||= { ventas: 0, propinas: 0, n: 0 });
      x.ventas += v.total; x.propinas += v.propina || 0; x.n++;
    });
    formas.efectivo ||= { ventas: 0, propinas: 0, n: 0 };
    const salidas = [
      ...caja.gastos.filter((x) => x.condicion !== "credito" && x.forma_pago === "efectivo").map((x) => ({ txt: `${x.categoria}: ${x.descripcion}`, monto: x.monto })),
      ...caja.compras.filter((c) => !c.anulada && c.condicion === "contado" && c.forma_pago === "efectivo").map((c) => ({ txt: `Compra a ${c.proveedor}`, monto: c.total })),
    ];
    const propinas = {};
    cont.filter((v) => v.propina).forEach((v) => { const k = v.barbero_nombre || "Sin barbero"; propinas[k] = (propinas[k] || 0) + v.propina; });
    const fondo = Math.max(0, Number($("#cajaFondo").value) || 0);
    const totSal = suma(salidas, "monto");
    return {
      ok, formas, salidas, totSal, propinas, fondo,
      credito: ok.filter((v) => v.condicion === "credito"),
      anuladas: caja.ventas.filter((v) => v.anulada).length,
      ventas: suma(cont, "total"), totProp: suma(cont, (v) => v.propina || 0),
      esperado: fondo + formas.efectivo.ventas + formas.efectivo.propinas - totSal,
    };
  }
  function difCaja(c) {
    const box = $("#cajaDif"); if (!box) return;
    const contado = entero($("#cajaContado")?.value);
    if (!Number.isFinite(contado)) { box.className = "caja__dif"; box.textContent = "Contá el efectivo de la caja y escribilo arriba."; return; }
    const d = contado - c.esperado;
    box.className = "caja__dif " + (d === 0 ? "is-ok" : d > 0 ? "is-mas" : "is-menos");
    box.innerHTML = d === 0 ? '<i data-lucide="check-circle-2"></i>La caja cuadra.'
      : `<i data-lucide="${d > 0 ? "circle-plus" : "circle-minus"}"></i>${d > 0 ? "Sobran" : "Faltan"} <b>${U.gs(Math.abs(d))}</b>`;
    U.icons();
  }
  function renderCaja() {
    const c = calcCaja();
    $("#cajaTitulo").textContent = `Caja · ${caja.fecha === U.hoy() ? "hoy" : dmy(caja.fecha)}`;
    const filas = Object.entries(c.formas).sort((a, b) => (a[0] === "efectivo" ? -1 : b[0] === "efectivo" ? 1 : b[1].ventas - a[1].ventas));
    $("#cajaCuerpo").innerHTML = `
      <div class="tabla-wrap"><table class="tabla tabla--mini tabla--caja">
        <thead><tr><th>Entradas</th><th class="num">Ventas</th><th class="num">Propinas</th><th class="num">Total</th></tr></thead>
        <tbody>${filas.map(([k, x]) => `<tr><td><strong>${FORMAS[k] || esc(k)}</strong> <small>${plural(x.n, "venta")}</small></td>
          <td data-l="Ventas" class="num">${U.gs(x.ventas)}</td><td data-l="Propinas" class="num">${U.gs(x.propinas)}</td><td data-l="Total" class="num"><strong>${U.gs(x.ventas + x.propinas)}</strong></td></tr>`).join("")}</tbody>
        <tfoot><tr><td>Total del día</td><td data-l="Ventas" class="num">${U.gs(c.ventas)}</td><td data-l="Propinas" class="num">${U.gs(c.totProp)}</td><td data-l="Total" class="num"><strong>${U.gs(c.ventas + c.totProp)}</strong></td></tr></tfoot>
      </table></div>
      ${c.credito.length ? `<p class="note caja__nota"><i data-lucide="clock"></i>${plural(c.credito.length, "venta")} a crédito por ${U.gs(suma(c.credito, "total"))} (no entran a la caja).</p>` : ""}
      ${c.anuladas ? `<p class="note caja__nota"><i data-lucide="ban"></i>${plural(c.anuladas, "comprobante anulado", "comprobantes anulados")} (no cuentan).</p>` : ""}
      ${c.salidas.length ? `<h3 class="caja__h">Salidas en efectivo</h3>
        <ul class="caja__salidas">${c.salidas.map((s) => `<li><span>${esc(s.txt)}</span><b>−${U.gs(s.monto)}</b></li>`).join("")}</ul>` : ""}
      ${Object.keys(c.propinas).length ? `<h3 class="caja__h">Propinas para repartir</h3>
        <ul class="caja__salidas">${Object.entries(c.propinas).map(([b, m]) => `<li><span>${esc(b)}</span><b>${U.gs(m)}</b></li>`).join("")}</ul>` : ""}
      <div class="caja__efectivo">
        <div class="caja__calc">
          <span>Fondo inicial</span><b>${U.gs(c.fondo)}</b>
          <span>+ ventas en efectivo</span><b>${U.gs(c.formas.efectivo.ventas)}</b>
          <span>+ propinas en efectivo</span><b>${U.gs(c.formas.efectivo.propinas)}</b>
          <span>− salidas en efectivo</span><b>${U.gs(c.totSal)}</b>
          <span class="caja__esp">Tiene que haber</span><b class="caja__esp">${U.gs(c.esperado)}</b>
        </div>
        <label class="field"><span>Efectivo contado en la caja</span>
          <input type="number" id="cajaContado" inputmode="numeric" min="0" step="1000" placeholder="Ej: ${c.esperado}" value="${caja.contado ?? ""}"></label>
        <p class="caja__dif" id="cajaDif" aria-live="polite"></p>
      </div>
      ${!c.ok.length ? vacio("receipt", "No hay ventas registradas este día.") : ""}`;
    difCaja(c);
    U.icons();
  }
  $("#btnCaja").addEventListener("click", abrirCaja);
  $("#cajaFecha").addEventListener("change", cargarCaja);
  $("#cajaFondo").addEventListener("input", () => {
    try { localStorage.setItem(FONDO_KEY, $("#cajaFondo").value); } catch (e) { /* sin storage */ }
    if (caja) renderCaja();
  });
  $("#cajaCuerpo").addEventListener("input", (e) => {
    if (e.target.id !== "cajaContado") return;
    caja.contado = e.target.value; difCaja(calcCaja());
  });
  $("#cajaImprimir").addEventListener("click", () => {
    if (!caja) return;
    const c = calcCaja(), contado = entero(caja.contado);
    imprimirTicket(`<article class="doc doc--ticket">${cabeceraTicket()}
      <p class="doc__aviso">CIERRE DE CAJA<br><small>${dmy(caja.fecha)} · impreso ${dmy(U.hoy())} ${U.fromMin(new Date().getHours() * 60 + new Date().getMinutes())}</small></p>
      <div class="tk__bloque"><b>ENTRADAS</b>${Object.entries(c.formas).map(([k, x]) => filaT(`${FORMAS[k] || esc(k)} (${x.n})`, num(x.ventas + x.propinas))).join("")}
        ${filaT("Total ventas", num(c.ventas))}${filaT("Total propinas", num(c.totProp))}</div>
      ${c.salidas.length ? `<div class="tk__bloque"><b>SALIDAS EN EFECTIVO</b>${c.salidas.map((s) => filaT(esc(s.txt), "−" + num(s.monto))).join("")}</div>` : ""}
      <div class="tk__bloque"><b>EFECTIVO</b>${filaT("Fondo inicial", num(c.fondo))}${filaT("Tiene que haber", num(c.esperado), "tk__total")}
        ${Number.isFinite(contado) ? filaT("Contado", num(contado)) + filaT(contado - c.esperado >= 0 ? "Sobrante" : "Faltante", num(Math.abs(contado - c.esperado))) : ""}</div>
      ${Object.keys(c.propinas).length ? `<div class="tk__bloque"><b>PROPINAS</b>${Object.entries(c.propinas).map(([b, m]) => filaT(esc(b), num(m))).join("")}</div>` : ""}
      ${c.credito.length ? `<p class="doc__meta">A crédito: ${plural(c.credito.length, "venta")} · Gs. ${num(suma(c.credito, "total"))}</p>` : ""}
      <p class="doc__centro"><br><br>__________________<br><small>Firma</small></p></article>`);
  });

  /* ============================================================
     COMISIONES POR BARBERO
     Sobre lo cobrado en el mes (con IVA y con los descuentos aplicados):
     % de servicios + % de productos, más las propinas (100 % del barbero).
     ============================================================ */
  const com = { mes: mesHoy(), ventas: [] };
  async function abrirComisiones() {
    com.mes = g.mes;
    U.icons();
    $("#modalComisiones").showModal();
    await cargarComisiones();
  }
  async function cargarComisiones() {
    $("#comCuerpo").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    try { const [d, h] = rango(com.mes); com.ventas = await DB.ventas(d, h); renderComisiones(); }
    catch (e) { $("#comCuerpo").innerHTML = vacio("wifi-off", esc(e.message)); U.icons(); }
  }
  function calcComisiones() {
    const barbs = ctx.barberos(), filas = new Map();
    const fila = (id) => {
      if (!filas.has(id)) {
        const b = barbs.find((x) => x.id === id);
        filas.set(id, { id, nombre: b?.nombre || (id ? "Barbero eliminado" : "Sin barbero asignado"), pct: id ? b?.comision || 0 : 0,
          pctProd: id ? b?.comision_prod || 0 : 0, n: 0, serv: 0, prod: 0, propinas: 0 });
      }
      return filas.get(id);
    };
    barbs.filter((b) => b.activo).forEach((b) => fila(b.id));
    com.ventas.filter((v) => !v.anulada).forEach((v) => {
      const f = fila(v.barbero_id || 0), k = v.subtotal ? v.total / v.subtotal : 1; // el descuento se reparte entre las líneas
      f.n++;
      v.items.forEach((i) => { f[i.tipo === "producto" ? "prod" : "serv"] += i.cantidad * i.precio * k; });
      f.propinas += v.propina || 0;
    });
    return [...filas.values()].map((f) => {
      const serv = Math.round(f.serv), prod = Math.round(f.prod);
      const comision = Math.round(serv * f.pct / 100 + prod * f.pctProd / 100);
      return { ...f, serv, prod, comision, pagar: comision + f.propinas };
    }).filter((f) => f.id || f.n).sort((a, b) => (a.id === 0) - (b.id === 0) || b.serv + b.prod - a.serv - a.prod);
  }
  function renderComisiones() {
    const fs = calcComisiones(), conB = fs.filter((f) => f.id);
    const actual = com.mes >= mesHoy();
    $("#comSub").innerHTML = `Sobre lo cobrado (con IVA y descuentos). Los porcentajes se cambian en <b>Barberos</b>.`;
    $("#comCuerpo").innerHTML = `
      <div class="datenav com__mes">
        <button class="icon-btn" data-com-mes="-1" aria-label="Mes anterior"><i data-lucide="chevron-left"></i></button>
        <strong>${mesTxt(com.mes)}</strong>
        <button class="icon-btn" data-com-mes="1" aria-label="Mes siguiente" ${actual ? "disabled" : ""}><i data-lucide="chevron-right"></i></button>
      </div>
      ${!fs.length ? vacio("hand-coins", "No hay barberos ni ventas este mes.") : `
      <div class="tabla-wrap"><table class="tabla tabla--ges">
        <thead><tr><th>Barbero</th><th class="num">Servicios</th><th class="num">Productos</th><th class="num">Comisión</th><th class="num">Propinas</th><th class="num">A pagar</th></tr></thead>
        <tbody>${fs.map((f) => `<tr class="${f.id ? "" : "is-off"}">
          <td data-l="Barbero"><strong>${esc(f.nombre)}</strong><small>${plural(f.n, "venta")}</small><small>${f.id ? `${f.pct} % serv. · ${f.pctProd} % prod.` : "asigná el barbero al cobrar"}</small></td>
          <td data-l="Servicios" class="num">${U.gs(f.serv)}</td>
          <td data-l="Productos" class="num">${U.gs(f.prod)}</td>
          <td data-l="Comisión" class="num">${f.id ? U.gs(f.comision) : "—"}</td>
          <td data-l="Propinas" class="num">${U.gs(f.propinas)}</td>
          <td data-l="A pagar" class="num"><strong>${f.id ? U.gs(f.pagar) : "—"}</strong></td></tr>`).join("")}</tbody>
        <tfoot><tr><td>Total</td><td data-l="Servicios" class="num">${U.gs(suma(fs, "serv"))}</td><td data-l="Productos" class="num">${U.gs(suma(fs, "prod"))}</td>
          <td data-l="Comisión" class="num">${U.gs(suma(conB, "comision"))}</td><td data-l="Propinas" class="num">${U.gs(suma(fs, "propinas"))}</td><td data-l="A pagar" class="num"><strong>${U.gs(suma(conB, "pagar"))}</strong></td></tr></tfoot>
      </table></div>
      ${conB.some((f) => !f.pct && !f.pctProd) ? `<p class="note caja__nota"><i data-lucide="info"></i>Hay barberos sin porcentaje cargado: editalos en <b>Barberos</b>.</p>` : ""}`}`;
    U.icons();
  }
  $("#btnComisiones").addEventListener("click", abrirComisiones);
  $("#comCuerpo").addEventListener("click", (e) => {
    const b = e.target.closest("[data-com-mes]"); if (!b) return;
    const m = U.sumarMeses(com.mes + "-01", Number(b.dataset.comMes)).slice(0, 7);
    com.mes = m > mesHoy() ? mesHoy() : m; cargarComisiones();
  });
  $("#comImprimir").addEventListener("click", () => {
    const fs = calcComisiones().filter((f) => f.id && (f.n || f.propinas));
    imprimirTicket(`<article class="doc doc--ticket">${cabeceraTicket()}
      <p class="doc__aviso">LIQUIDACIÓN DE COMISIONES<br><small>${mesTxt(com.mes)}</small></p>
      ${fs.map((f) => `<div class="tk__bloque"><b>${esc(f.nombre)}</b>
        ${filaT(`Servicios ${num(f.serv)} × ${f.pct} %`, num(Math.round(f.serv * f.pct / 100)))}
        ${f.prod ? filaT(`Productos ${num(f.prod)} × ${f.pctProd} %`, num(Math.round(f.prod * f.pctProd / 100))) : ""}
        ${f.propinas ? filaT("Propinas", num(f.propinas)) : ""}
        ${filaT("A PAGAR Gs.", num(f.pagar), "tk__total")}
        <p class="doc__centro"><br>__________________<br><small>Firma de ${esc(f.nombre)}</small></p></div>`).join("") || '<p class="doc__meta">Sin ventas con barbero asignado.</p>'}
    </article>`);
  });

  /* ============================================================
     PROVEEDORES
     ============================================================ */
  const fPr = $("#formProveedor");
  let provs = [];
  async function abrirProveedores() {
    limpiarProveedor();
    $("#listaProveedores").innerHTML = '<li class="skeleton"></li>';
    U.icons();
    $("#modalProveedores").showModal();
    await cargarProveedores();
  }
  async function cargarProveedores() {
    try { provs = await DB.proveedores(); renderProveedores(); }
    catch (e) { $("#listaProveedores").innerHTML = `<li class="empty">${esc(e.message)}</li>`; }
  }
  function renderProveedores() {
    $("#provResumen").textContent = provs.length ? `${plural(provs.length, "proveedor", "proveedores")} · los nuevos también se agregan solos al cargar una compra` : "";
    $("#listaProveedores").innerHTML = provs.map((p) => `
      <li class="staff__item" data-id="${p.id}">
        <span class="avatar avatar--any"><i data-lucide="truck"></i></span>
        <span class="staff__info"><strong>${esc(p.nombre)}</strong>
          <small>${esc([p.ruc && "RUC " + p.ruc, p.telefono, p.contacto].filter(Boolean).join(" · ") || "Sin datos de contacto")}</small>
          <small>${p.compras ? `${plural(p.compras, "compra")} · ${U.gs(p.total)} · última ${dmy(p.ultima)}` : "Sin compras"}${p.nota ? " · " + esc(p.nota) : ""}</small></span>
        ${p.telefono ? `<a class="icon-btn" href="${U.waLink(p.telefono, `Hola ${p.contacto || p.nombre}, te escribo de ${N.nombre}.`)}" target="_blank" rel="noopener" aria-label="WhatsApp a ${esc(p.nombre)}"><i data-lucide="message-circle"></i></a>` : ""}
        <button class="icon-btn" data-editar aria-label="Editar ${esc(p.nombre)}"><i data-lucide="pencil"></i></button>
        <button class="icon-btn icon-btn--danger" data-borrar aria-label="Eliminar ${esc(p.nombre)}"><i data-lucide="trash-2"></i></button>
      </li>`).join("") || `<li class="empty"><i data-lucide="truck"></i>Todavía no hay proveedores. Agregá el primero abajo.</li>`;
    U.icons();
  }
  function limpiarProveedor() {
    fPr.reset(); fPr.id.value = "";
    $("#provFormTitulo").textContent = "Agregar proveedor";
    $("#btnGuardarProveedor").innerHTML = '<i data-lucide="plus"></i>Agregar';
    $("#btnCancelarProveedor").hidden = true; mostrarError($("#proveedorError"));
    U.icons();
  }
  $("#btnProveedores").addEventListener("click", abrirProveedores);
  $("#btnCancelarProveedor").addEventListener("click", limpiarProveedor);
  $("#listaProveedores").addEventListener("click", async (e) => {
    const li = e.target.closest(".staff__item"); if (!li) return;
    const p = provs.find((x) => x.id === Number(li.dataset.id)); if (!p) return;
    if (e.target.closest("[data-editar]")) {
      ["id", "nombre", "ruc", "telefono", "contacto", "nota"].forEach((k) => { fPr[k].value = p[k] ?? ""; });
      $("#provFormTitulo").textContent = `Editar «${p.nombre}»`;
      $("#btnGuardarProveedor").innerHTML = '<i data-lucide="save"></i>Guardar cambios';
      $("#btnCancelarProveedor").hidden = false; U.icons();
      fPr.nombre.focus();
    }
    if (e.target.closest("[data-borrar]")) {
      if (!confirm(`¿Eliminar a «${p.nombre}» de la lista? Las compras que ya cargaste no se tocan.`)) return;
      try { await DB.eliminarProveedor(p.id); U.toast("Proveedor eliminado"); await cargarProveedores(); }
      catch (ex) { U.toast(ex.message, "error"); }
    }
  });
  fPr.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#proveedorError"); mostrarError(err);
    const d = Object.fromEntries(new FormData(fPr));
    if (d.nombre.trim().length < 2) return mostrarError(err, "Escribí el nombre del proveedor.");
    const btn = $("#btnGuardarProveedor"); btn.disabled = true;
    try {
      await DB.guardarProveedor({ ...d, id: Number(d.id) || null });
      U.toast(d.id ? "Proveedor actualizado" : `«${d.nombre.trim()}» agregado`);
      limpiarProveedor(); await cargarProveedores();
      if (g.mod === "compras") cargarCompras().catch(() => {});
    } catch (ex) { mostrarError(err, ex.message); }
    finally { btn.disabled = false; }
  });

  /* ============================================================
     CLIENTES
     ============================================================ */
  const cli = { lista: [] };
  const haceDias = (f) => (f ? U.diasEntre(f, U.hoy()) : null);
  const haceTxt = (f) => { const d = haceDias(f); return d === null ? "" : d === 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`; };
  async function cargarClientes() {
    cli.lista = await clientesAc(true);
    renderClientes();
  }
  function renderClientes() {
    const l = cli.lista, frec = l.filter((c) => c.visitas >= 3), prox = l.filter((c) => c.proximo);
    const perdidos = l.filter((c) => c.ultima && haceDias(c.ultima) > 60 && !c.proximo);
    const top = [...l].sort((a, b) => b.gastado - a.gastado)[0];
    kpis($("#kpisClientes"), [
      ["contact", "Clientes", l.length, `${plural(frec.length, "frecuente")} (3 visitas o más)`],
      ["calendar-check", "Con turno reservado", prox.length, "vuelven pronto"],
      ["user-round-x", "No vuelven", perdidos.length, "hace más de 60 días", perdidos.length ? "kpi--warn" : ""],
      ["crown", "Mejor cliente", top && top.gastado ? esc(top.nombre) : "—", top && top.gastado ? `${U.gs(top.gastado)} · ${plural(top.visitas, "visita")}` : "sin ventas", "kpi--txt"],
    ]);
    const q = normal($("#clientesBuscar").value.trim()), dig = digitos($("#clientesBuscar").value), f = $("#clientesFiltro").value, o = $("#clientesOrden").value;
    const lista = l.filter((c) => (!q || normal(c.nombre).includes(q) || (dig.length >= 3 && (digitos(c.telefono).includes(dig) || digitos(c.ruc).includes(dig)))) &&
      (!f || (f === "frecuentes" ? c.visitas >= 3 : f === "proximo" ? c.proximo : perdidos.includes(c))))
      .sort((a, b) => o === "nombre" ? a.nombre.localeCompare(b.nombre) : o === "visitas" ? b.visitas - a.visitas || b.gastado - a.gastado
        : o === "gastado" ? b.gastado - a.gastado : (b.ultima || "").localeCompare(a.ultima || ""));
    $("#listaClientes").innerHTML = !lista.length
      ? vacio("contact", l.length ? "Ningún cliente coincide." : "Todavía no hay clientes. Se agregan solos con cada turno (por su celular) o al facturar con RUC.")
      : `<table class="tabla tabla--ges">
        <thead><tr><th>Cliente</th><th class="num">Visitas</th><th>Última visita</th><th class="num">Gastado</th><th>Próximo turno</th><th><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${lista.map((c) => `<tr>
          <td data-l="Cliente"><button type="button" class="link link--fuerte" data-ver-cliente="${c.id}">${esc(c.nombre)}</button><small>${esc([c.telefono, c.ruc].filter(Boolean).join(" · "))}</small></td>
          <td data-l="Visitas" class="num">${c.visitas}${c.visitas >= 3 ? ' <span class="tag tag--ok">frecuente</span>' : ""}</td>
          <td data-l="Última visita">${c.ultima ? `${dmy(c.ultima)}<small>${haceTxt(c.ultima)}</small>` : "—"}</td>
          <td data-l="Gastado" class="num">${U.gs(c.gastado)}</td>
          <td data-l="Próximo turno">${c.proximo ? dmy(c.proximo) : "—"}</td>
          <td class="tabla__acc">
            ${c.telefono ? `<a class="icon-btn" href="${U.waLink(c.telefono, `Hola ${c.nombre.split(" ")[0]}! Te escribimos de ${N.nombre}.`)}" target="_blank" rel="noopener" aria-label="WhatsApp a ${esc(c.nombre)}"><i data-lucide="message-circle"></i></a>` : ""}
            <button class="icon-btn" data-ver-cliente="${c.id}" aria-label="Ver historial de ${esc(c.nombre)}"><i data-lucide="eye"></i></button>
          </td></tr>`).join("")}</tbody>
      </table>`;
    U.icons();
  }
  ["clientesBuscar", "clientesFiltro", "clientesOrden"].forEach((id) => $("#" + id).addEventListener(id === "clientesBuscar" ? "input" : "change", renderClientes));
  $("#listaClientes").addEventListener("click", (e) => { const b = e.target.closest("[data-ver-cliente]"); if (b) abrirCliente(Number(b.dataset.verCliente)); });
  $("#btnNuevoCliente").addEventListener("click", () => abrirCliente(null));

  /* ---------- Ficha del cliente: datos + historial ---------- */
  const fCl = $("#formCliente");
  let fichaCli = null;
  const ESTADO_TXT = { pendiente: "Pendiente", confirmado: "Confirmado", completado: "Atendido", ausente: "No vino", cancelado: "Cancelado" };
  /** El más repetido de una lista de textos */
  const masVeces = (arr) => { const m = {}; arr.forEach((x) => { if (x) m[x] = (m[x] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0] || ""; };
  async function abrirCliente(id) {
    fCl.reset(); mostrarError($("#clienteError"));
    fichaCli = null;
    $("#cliResumen").innerHTML = ""; $("#cliHistorial").innerHTML = id ? '<div class="skeleton"></div>' : "";
    $("#cliTitulo").textContent = id ? "Cliente" : "Nuevo cliente";
    $("#cliSub").textContent = id ? "" : "También se agregan solos con cada turno (por su celular).";
    $("#cliGuardarTxt").textContent = id ? "Guardar cambios" : "Agregar cliente";
    ["cliWa", "cliNuevoTurno", "cliNuevaVenta"].forEach((x) => { $("#" + x).hidden = true; });
    U.icons();
    if (!$("#modalCliente").open) $("#modalCliente").showModal();
    if (!id) return fCl.nombre.focus();
    try { fichaCli = await DB.cliente(id); } catch (e) { $("#cliHistorial").innerHTML = vacio("wifi-off", esc(e.message)); return U.icons(); }
    renderFicha();
  }
  function renderFicha() {
    const { cliente: c, turnos, ventas } = fichaCli;
    ["id", "nombre", "telefono", "ruc", "nota"].forEach((k) => { fCl[k].value = c[k] ?? ""; });
    $("#cliTitulo").textContent = c.nombre;
    const at = turnos.filter((t) => t.estado === "completado"), ok = ventas.filter((v) => !v.anulada);
    const visitas = at.length + ok.filter((v) => !v.turno_id).length, gastado = suma(ok, "total");
    const ultima = [...at.map((t) => t.fecha), ...ok.map((v) => v.fecha)].sort().at(-1);
    const ausentes = turnos.filter((t) => t.estado === "ausente").length;
    $("#cliSub").textContent = [c.telefono, c.ruc && "RUC " + c.ruc].filter(Boolean).join(" · ");
    const servicio = masVeces([...at.flatMap((t) => (t.items || []).map((i) => i.nombre)), ...ok.flatMap((v) => v.items.filter((i) => i.tipo === "servicio").map((i) => i.descripcion))]);
    const barbero = masVeces([...at.map((t) => t.barbero?.nombre), ...ok.filter((v) => !v.turno_id).map((v) => v.barbero_nombre)]);
    $("#cliResumen").innerHTML = `<div class="cli-kpis">
      <div><small>Visitas</small><strong>${visitas}</strong></div>
      <div><small>Gastado</small><strong>${U.gs(gastado)}</strong></div>
      <div><small>Promedio por compra</small><strong>${U.gs(ok.length ? Math.round(gastado / ok.length) : 0)}</strong></div>
      <div><small>Última visita</small><strong>${ultima ? dmy(ultima) : "—"}</strong></div>
    </div>
    ${servicio || barbero || ausentes ? `<p class="note cli-pref">${[servicio && `Suele pedir <b>${esc(servicio)}</b>`, barbero && `con <b>${esc(barbero)}</b>`].filter(Boolean).join(" ")}${ausentes ? `${servicio || barbero ? " · " : ""}<span class="neg">faltó ${plural(ausentes, "vez", "veces")}</span>` : ""}</p>` : ""}`;
    $("#cliWa").hidden = !c.telefono;
    if (c.telefono) $("#cliWa").href = U.waLink(c.telefono, `Hola ${c.nombre.split(" ")[0]}! Te escribimos de ${N.nombre}.`);
    $("#cliNuevoTurno").hidden = !c.telefono; $("#cliNuevaVenta").hidden = false;
    $("#cliHistorial").innerHTML = `
      <h3 class="caja__h">Turnos <small>(${turnos.length})</small></h3>
      ${turnos.length ? `<div class="tabla-wrap"><table class="tabla tabla--mini">
        <thead><tr><th>Fecha</th><th>Servicios</th><th>Barbero</th><th>Estado</th><th class="num">Precio</th></tr></thead>
        <tbody>${turnos.map((t) => `<tr><td data-l="Fecha">${dmy(t.fecha)} <small>${esc(t.hora)}</small></td>
          <td data-l="Servicios">${esc((t.items || []).map((i) => i.nombre).join(" + "))}</td><td data-l="Barbero">${esc(t.barbero?.nombre || "")}</td>
          <td data-l="Estado"><span class="pill pill--${t.estado} pill--mini">${ESTADO_TXT[t.estado] || t.estado}</span></td>
          <td data-l="Precio" class="num">${U.gs(t.precio)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="note">Sin turnos.</p>'}
      <h3 class="caja__h">Comprobantes <small>(${ventas.length})</small></h3>
      ${ventas.length ? `<div class="tabla-wrap"><table class="tabla tabla--mini">
        <thead><tr><th>Fecha</th><th>Comprobante</th><th>Detalle</th><th class="num">Total</th><th><span class="sr-only">Ver</span></th></tr></thead>
        <tbody>${ventas.map((v) => `<tr class="${v.anulada ? "is-anulada" : ""}"><td data-l="Fecha">${dmy(v.fecha)}</td>
          <td data-l="Comprobante">${esc(v.numero)}${v.anulada ? ' <span class="tag tag--danger">Anulado</span>' : ""}</td>
          <td data-l="Detalle">${esc(resumenItems(v.items))}</td><td data-l="Total" class="num">${U.gs(v.total)}</td>
          <td class="tabla__acc"><button class="icon-btn" data-ver-venta-cli="${v.id}" aria-label="Ver ${esc(v.numero)}"><i data-lucide="eye"></i></button></td></tr>`).join("")}</tbody></table></div>` : '<p class="note">Sin compras.</p>'}`;
    U.icons();
  }
  $("#cliHistorial").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ver-venta-cli]"); if (!b) return;
    verVenta(fichaCli.ventas.find((v) => v.id === b.dataset.verVentaCli));
  });
  $("#cliNuevaVenta").addEventListener("click", () => { const c = fichaCli?.cliente; $("#modalCliente").close(); abrirVenta(null, c); });
  $("#cliNuevoTurno").addEventListener("click", () => { const c = fichaCli?.cliente; $("#modalCliente").close(); ctx.nuevoTurno({ cliente: c }); });
  fCl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#clienteError"); mostrarError(err);
    const d = Object.fromEntries(new FormData(fCl));
    if (d.nombre.trim().length < 2) return mostrarError(err, "Escribí el nombre del cliente.");
    const btn = $("button[type=submit]", fCl); btn.disabled = true;
    try {
      const { id } = await DB.guardarCliente({ ...d, id: Number(d.id) || null });
      U.toast(d.id ? "Cliente actualizado" : `«${d.nombre.trim()}» agregado`);
      clientesCache = null;
      if (g.mod === "clientes") cargarClientes().catch(() => {});
      await abrirCliente(id);
    } catch (ex) { mostrarError(err, ex.message); }
    finally { btn.disabled = false; }
  });

  /* ============================================================
     API para el panel (admin.js)
     ============================================================ */
  return {
    /** servicios(), barberos(): catálogos del panel · turnosCambiaron(): refrescar la agenda */
    iniciar(c) { ctx = { ...ctx, ...c }; },
    /** Al entrar al panel: badge de stock y sección del link (#ventas, #stock…) */
    entrar() {
      g.mes = mesHoy();
      cargarProductos().catch(() => {});
      irModulo(location.hash.slice(1));
    },
    cobrarTurno: (t) => abrirVenta(t),
    /** Sugerencias de clientes en un campo (lo usa «Nuevo turno») */
    autocompletar,
    refrescarClientes: () => { clientesCache = null; return clientesAc(true).catch(() => []); },
    async verVentaId(id) { try { verVenta(await DB.venta(id)); } catch (ex) { U.toast(ex.message, "error"); } },
    irModulo,
    modulo: () => g.mod,
    letras, // (para pruebas)
  };
})();

window.Gestion = Gestion;
