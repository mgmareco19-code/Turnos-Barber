/* ============================================================
   02e · Correr como TURNOS (después de 02d_extras.sql y ANTES de 03_paquete.sql)
   Usuarios para los barberos: cada barbero entra con su email y su
   contraseña, y solo ve su agenda y cobra sus turnos.

   ¿Ya tenías la base instalada? Corré este archivo una vez y después
   volvé a correr 03_paquete.sql. Los dueños que ya existen no cambian.
   ============================================================ */

alter table tb_miembros add (
  rol         varchar2(7) default 'dueno' not null,
  barbero_id  number references tb_barberos on delete cascade
);
alter table tb_miembros add constraint tb_miembros_rol_ck
  check ((rol = 'dueno' and barbero_id is null) or (rol = 'barbero' and barbero_id is not null));
-- Un barbero tiene a lo sumo un acceso
create unique index tb_miembros_barbero_uk on tb_miembros (barbero_id);
