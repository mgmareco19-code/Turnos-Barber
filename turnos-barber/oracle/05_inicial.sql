/* ============================================================
   05 · Correr como TURNOS
   Tu usuario de superadmin (con este entrás a superadmin.html).
   >>> Cambiá el email y la contraseña (mínimo 8 caracteres). <<<
   Si te olvidás la contraseña, volvé a correr esto con una nueva.
   ============================================================ */

begin
  tb_api.crear_superadmin('tu-email@ejemplo.com', 'UnaClaveLarga2026');
  commit;
end;
/

/* Prueba rápida: en la salida tiene que aparecer {"ok":true,"data":null} */
set serveroutput on
begin
  dbms_output.put_line(tb_api.rpc('{"fn":"negocio_por_slug","args":{"slug":"no-existe"}}'));
end;
/
