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

  const horarioDe = (fecha) => cfg.horario[parse(fecha).getDay()] || null;

  /**
   * Calcula los horarios de un día.
   * @returns [{hora, libres:[barberoIds]}]
   */
  function slots(fecha, duracion, ocupados, barberoIds) {
    const h = horarioDe(fecha);
    if (!h) return [];
    const abre = toMin(h[0]), cierra = toMin(h[1]);
    const ahora = new Date();
    const minAhora = fecha === hoy() ? ahora.getHours() * 60 + ahora.getMinutes() + cfg.margenMinutos : -1;
    const out = [];
    for (let t = abre; t + duracion <= cierra; t += cfg.intervalo) {
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

  return { iso, parse, addDays, hoy, toMin, fromMin, hhmm, overlap, gs, durTxt, fechaLarga, fechaCorta,
    horarioDe, slots, esc, telWa, waLink, toast, icons, DIAS };
})();
