/* Utilidades compartidas entre la página pública y el panel */
const U = (() => {
  const cfg = window.APP_CONFIG;
  const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const DIAS_LARGO = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  const pad = (n) => String(n).padStart(2, "0");

  /** Date -> "YYYY-MM-DD" en hora local */
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  /** "YYYY-MM-DD" -> Date local (mediodía, evita saltos de zona horaria) */
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const hoy = () => iso(new Date());

  /** "HH:MM[:SS]" -> minutos */
  const toMin = (h) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
  const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const hhmm = (h) => h.slice(0, 5);

  const overlap = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

  const gs = (n) => "Gs. " + Number(n || 0).toLocaleString("es-PY");
  const durTxt = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? " " + (m % 60) + " min" : ""}`);

  const fechaLarga = (s) => { const d = parse(s); return `${DIAS_LARGO[d.getDay()]} ${d.getDate()} de ${MESES_LARGO[d.getMonth()]}`; };
  const fechaCorta = (s) => { const d = parse(s); return { dia: DIAS[d.getDay()], num: d.getDate(), mes: MESES[d.getMonth()] }; };

  /* ---------- Local (negocio) activo ----------
     La página pública y el panel cargan el local desde la base y lo
     guardan acá; los horarios se calculan con estos datos. */
  const neg = {};
  const setNegocio = (n) => { Object.keys(neg).forEach((k) => delete neg[k]); Object.assign(neg, n); return neg; };
  const HORARIO_BASE = { 0: null, 1: ["09:00", "20:00"], 2: ["09:00", "20:00"], 3: ["09:00", "20:00"],
    4: ["09:00", "20:00"], 5: ["09:00", "20:00"], 6: ["08:00", "14:00"] };

  /** Cierre de todo el local ese día (vacaciones, feriado): { desde, hasta, motivo } o null */
  const cierreDe = (fecha) => (neg.cierres || []).find((c) => fecha >= c.desde && fecha <= c.hasta) || null;
  const horarioDe = (fecha) => (cierreDe(fecha) ? null : (neg.horario || {})[parse(fecha).getDay()] || null);

  /** "Black Label Barber" -> "BLACK LABEL <b>BARBER</b>" (la última palabra en dorado) */
  const logoHtml = (nombre) => {
    const p = String(nombre || "").trim().toUpperCase().split(/\s+/);
    return p.length > 1 ? `${esc(p.slice(0, -1).join(" "))} <b>${esc(p.at(-1))}</b>` : `<b>${esc(p[0] || "")}</b>`;
  };
  /** Contenido del logo de la barra: imagen del local (si tiene) + nombre */
  const marcaHtml = (n) => {
    const img = n.logo ? `<img class="logo__img${n.logo_solo ? " logo__img--solo" : ""}" src="${esc(n.logo)}" alt="">` : `<i data-lucide="scissors"></i>`;
    return img + (n.logo && n.logo_solo ? `<span class="sr-only">${esc(n.nombre)}</span>` : `<span>${logoHtml(n.nombre_corto || n.nombre)}</span>`);
  };
  /** Usa el logo del local como ícono de la pestaña */
  const setFavicon = (url) => {
    let l = document.querySelector('link[rel="icon"]');
    if (!url) { l?.remove(); return; }
    if (!l) { l = document.createElement("link"); l.rel = "icon"; document.head.append(l); }
    l.href = url;
  };
  /**
   * Achica una imagen subida (máx. `lado` px) y la devuelve como data URL.
   * Mantiene la transparencia (WEBP, o PNG si el navegador no soporta WEBP).
   */
  function achicarImagen(file, lado = 320) {
    return new Promise((ok, mal) => {
      if (!file || !/^image\/(png|jpeg|webp|svg\+xml|gif)$/.test(file.type)) return mal(new Error("Elegí una imagen PNG, JPG, WEBP o SVG."));
      if (file.size > 8 * 1024 * 1024) return mal(new Error("La imagen pesa más de 8 MB. Probá con una más liviana."));
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const w0 = img.naturalWidth || lado, h0 = img.naturalHeight || lado;
        const k = Math.min(1, lado / Math.max(w0, h0));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(c.toDataURL("image/webp", 0.9));
      };
      img.onerror = () => { URL.revokeObjectURL(url); mal(new Error("No se pudo leer la imagen.")); };
      img.src = url;
    });
  }
  /** "Barbería El Patrón" -> "barberia-el-patron" */
  const slugify = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  /** Link de reservas de un local (funciona en el hosting y abriendo los archivos) */
  /** Dirección de una página del sistema: la publicada (urlPublica en js/config.js) o, si no está, la actual */
  const urlPagina = (p) => new URL(p, cfg.urlPublica || location.href).href;
  const linkReserva = (slug) => urlPagina(`index.html?local=${encodeURIComponent(slug)}`);
  /** Link personal de un turno: el cliente lo ve, lo cambia o lo cancela */
  const linkTurno = (slug, id) => urlPagina(`index.html?local=${encodeURIComponent(slug)}&turno=${encodeURIComponent(id)}`);

  const diasEntre = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  /**
   * Estado del abono de un local.
   * activo · por_vencer (≤7 días) · gracia (vencido, sigue andando) · vencido · suspendido
   */
  function estadoNegocio(n) {
    if (!n.activo) return { clave: "suspendido", txt: "Suspendido", reserva: false };
    if (!n.vence_el) return { clave: "activo", txt: "Activo", reserva: true };
    const d = diasEntre(hoy(), n.vence_el), gracia = cfg.diasGracia ?? 0;
    if (d > 7) return { clave: "activo", txt: "Activo", reserva: true, dias: d };
    if (d >= 0) return { clave: "por_vencer", txt: d === 0 ? "Vence hoy" : `Vence en ${d} día${d === 1 ? "" : "s"}`, reserva: true, dias: d };
    if (-d <= gracia) return { clave: "gracia", txt: `Vencido hace ${-d} día${d === -1 ? "" : "s"}`, reserva: true, dias: d };
    return { clave: "vencido", txt: "Vencido", reserva: false, dias: d };
  }

  /**
   * Calcula los horarios de un día.
   * @returns [{hora, libres:[barberoIds]}]
   */
  function slots(fecha, duracion, ocupados, barberoIds) {
    const h = horarioDe(fecha);
    if (!h) return [];
    const abre = toMin(h[0]), cierra = toMin(h[1]);
    const ahora = new Date();
    const minAhora = fecha === hoy() ? ahora.getHours() * 60 + ahora.getMinutes() + (neg.margen_minutos ?? 30) : -1;
    const out = [];
    for (let t = abre; t + duracion <= cierra; t += neg.intervalo || 30) {
      const libres = barberoIds.filter((b) =>
        !ocupados.some((o) => o.barbero_id === b &&
          overlap(t, t + duracion, toMin(o.hora), toMin(o.hora) + o.duracion)));
      out.push({ hora: fromMin(t), libres, pasado: t < minAhora });
    }
    return out;
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const telWa = (t) => {
    let n = String(t).replace(/\D/g, "");
    if (n.startsWith("0")) n = "595" + n.slice(1);   // 0981… -> 595981…
    return n;
  };
  const waLink = (numero, texto) => `https://wa.me/${telWa(numero)}?text=${encodeURIComponent(texto)}`;

  function toast(msg, tipo = "ok") {
    let box = document.getElementById("toasts");
    if (!box) { box = document.createElement("div"); box.id = "toasts"; box.className = "toasts"; document.body.append(box); }
    const el = document.createElement("div");
    el.className = `toast toast--${tipo}`;
    el.setAttribute("role", tipo === "error" ? "alert" : "status");
    el.textContent = msg;
    box.append(el);
    setTimeout(() => { el.classList.add("is-out"); setTimeout(() => el.remove(), 300); }, 3800);
  }

  const icons = () => window.lucide && window.lucide.createIcons();

  /* ---------- Modo claro / oscuro ----------
     El <head> ya aplica el tema antes de dibujar (sin parpadeo).
     Acá se conectan los botones [data-theme-toggle] y se guarda la elección. */
  const TEMA_KEY = "tema";
  const temaGuardado = () => { try { return localStorage.getItem(TEMA_KEY); } catch (e) { return null; } };
  function aplicarTema(t) {
    document.documentElement.dataset.theme = t;
    const txt = t === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
    document.querySelectorAll("[data-theme-toggle]").forEach((b) => { b.setAttribute("aria-label", txt); b.title = txt; });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === "dark" ? "#111111" : "#F5F3EE";
  }
  aplicarTema(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-theme-toggle]")) return;
    const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    aplicarTema(t);
    try { localStorage.setItem(TEMA_KEY, t); } catch (err) { /* sin storage: dura hasta recargar */ }
  });
  // Si el usuario nunca eligió, sigue los cambios del sistema
  window.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change", (e) => {
    if (!temaGuardado()) aplicarTema(e.matches ? "light" : "dark");
  });

  /** Suma meses a una fecha ISO (31 ene + 1 mes = 28/29 feb) */
  const sumarMeses = (s, n) => {
    const d = parse(s), dia = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(dia, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return iso(d);
  };

  return { iso, parse, addDays, sumarMeses, hoy, toMin, fromMin, hhmm, overlap, gs, durTxt, fechaLarga, fechaCorta,
    horarioDe, cierreDe, slots, esc, telWa, waLink, toast, icons, DIAS, DIAS_LARGO,
    neg, setNegocio, HORARIO_BASE, logoHtml, marcaHtml, setFavicon, achicarImagen, slugify, urlPagina, linkReserva, linkTurno, diasEntre, estadoNegocio };
})();

window.U = U;
