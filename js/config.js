/* ============================================================
   CONFIGURACIÓN DEL NEGOCIO
   Editá estos valores para adaptar el sistema a cada barbería.
   ============================================================ */
window.APP_CONFIG = {
  negocio: {
    nombre: "Black Label",
    nombreCompleto: "Black Label Barber Club",
    whatsapp: "595981000000",          // sin "+" ni espacios
    direccion: "Av. Mcal. López 1234, Asunción",
  },

  /* --- Base de datos online (Supabase) ---------------------
     Dejalos vacíos para usar el MODO DEMO (datos en el navegador).
     Los encontrás en Supabase > Project Settings > API.            */
  supabaseUrl: "",
  supabaseAnonKey: "",

  /* --- Horario de atención ---------------------------------
     0 = domingo … 6 = sábado. null = cerrado.                      */
  horario: {
    0: null,
    1: ["09:00", "20:00"],
    2: ["09:00", "20:00"],
    3: ["09:00", "20:00"],
    4: ["09:00", "20:00"],
    5: ["09:00", "20:00"],
    6: ["08:00", "14:00"],
  },
  intervalo: 30,          // minutos entre cada horario ofrecido
  diasAnticipacion: 21,   // hasta cuántos días adelante se puede reservar
  margenMinutos: 30,      // no ofrecer horarios que empiezan en menos de X min

  /* Solo para el modo demo (en modo online se usa email + contraseña) */
  demoAdminPassword: "admin",
};
