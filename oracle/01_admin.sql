/* ============================================================
   01 · Correr como ADMIN (Database Actions → SQL, usuario ADMIN)
   Crea el esquema TURNOS, le da permisos y lo publica en ORDS.
   >>> Cambiá la contraseña antes de correrlo. <<<
   ============================================================ */

create user turnos identified by "CambiaEstaClave#2026";

grant create session, create table, create sequence, create procedure, create view to turnos;
alter user turnos quota unlimited on data;

-- Contraseñas encriptadas y tokens de sesión
grant execute on dbms_crypto to turnos;

-- Publicar el esquema en ORDS: la API queda en  https://<tu-host>/ords/turnos/...
begin
  ords_admin.enable_schema(
    p_enabled             => true,
    p_schema              => 'TURNOS',
    p_url_mapping_type    => 'BASE_PATH',
    p_url_mapping_pattern => 'turnos',
    p_auto_rest_auth      => true   -- nada se publica solo: únicamente lo que define 04_ords.sql
  );
  commit;
end;
/
