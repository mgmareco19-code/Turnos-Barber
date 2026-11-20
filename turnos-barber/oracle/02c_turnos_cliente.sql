/* ============================================================
   02c · Correr como TURNOS (después de 02b_gestion.sql y ANTES de 03_paquete.sql)
   El cliente puede cambiar o cancelar su turno desde su link.

   ¿Ya tenías la base instalada? Corré este archivo una vez y después
   volvé a correr 03_paquete.sql. Los turnos que ya tenés no se tocan.
   ============================================================ */

alter table tb_turnos add (
  cambios        number(2)   default 0 not null,                                  -- veces que el cliente lo cambió de día u hora
  cancelado_por  varchar2(7) check (cancelado_por in ('cliente', 'local'))        -- quién lo canceló (null si no está cancelado)
);
