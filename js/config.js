/* ============================================================
   CONFIGURACIÓN DE LA PLATAFORMA
   Los datos de cada barbería (nombre, WhatsApp, horario…) ya no van
   acá: cada dueño los edita desde su panel → Configuración.
   ============================================================ */
window.APP_CONFIG = {
  plataforma: {
    nombre: "Turnos Barber",        // tu marca (se ve en el panel superadmin)
    soporteWhatsapp: "595981000000", // a dónde te escriben los dueños (sin "+")
  },

  /* --- Base de datos online (Oracle Autonomous Database) ------
     URL de la API publicada con oracle/04_ords.sql, por ejemplo:
     "https://abc123-turnos.adb.sa-saopaulo-1.oraclecloudapps.com/ords/turnos/api/rpc"
     Vacío = MODO DEMO (los datos quedan solo en el navegador). */
  apiUrl: "",

  /* Días que un local sigue recibiendo reservas después de vencido el abono */
  diasGracia: 5,

  /* Precio del abono por mes (Gs.). A cada local le podés poner otro precio desde el superadmin */
  precioMensual: 55000,

  /* Categorías de gastos del local (panel → Gastos) */
  categoriasGasto: ["Alquiler", "Luz (ANDE)", "Agua", "Internet y teléfono", "Sueldos y comisiones", "Mantenimiento",
    "Limpieza", "Publicidad", "Impuestos", "Contador", "Otros"],

  /* Solo para el modo demo */
  demoPasswordDueno: "admin",
  demoPasswordSuper: "super",
};
