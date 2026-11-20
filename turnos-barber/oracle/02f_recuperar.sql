/* ============================================================
   02f · Correr como TURNOS (después de 02e_accesos.sql y ANTES de 03_paquete.sql)
   «Olvidé mi contraseña»: links de un solo uso que llegan por correo,
   y los datos del servidor de correo (Email Delivery de Oracle Cloud).

   ¿Ya tenías la base instalada? Corré este archivo una vez y después
   volvé a correr 03_paquete.sql.
   ============================================================ */

-- Pedidos de cambio de contraseña: la base guarda solo el hash del link (vence en 1 hora)
create table tb_resets (
  token_hash  raw(32)      primary key,
  miembro_id  number       not null references tb_miembros on delete cascade,
  expira      timestamp with time zone not null,
  creado_en   timestamp with time zone default systimestamp not null
);
create index tb_resets_miembro_ix on tb_resets (miembro_id);

-- Servidor de correo y dirección de la página (la carga 06b_correo.sql).
-- Una sola fila. No se publica: solo la lee el paquete TB_API.
create table tb_correo (
  id                number(1)      default 1 primary key check (id = 1),
  smtp_host         varchar2(200)  not null,
  smtp_puerto       number(5)      default 587 not null,
  smtp_usuario      varchar2(300)  not null,
  smtp_clave        varchar2(300)  not null,
  remitente         varchar2(200)  not null,   -- un "approved sender" de Email Delivery
  nombre_remitente  varchar2(100),
  url_panel         varchar2(400)  not null    -- ej. https://…/o/admin.html (los links de los correos van acá)
);
