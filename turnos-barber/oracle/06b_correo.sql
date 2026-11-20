/* ============================================================
   06b · Correr como TURNOS (después de 06a_correo_admin.sql)
   Datos del correo para «Olvidé mi contraseña». Se sacan de la consola
   de Oracle Cloud → Developer Services → Email Delivery:
     - SMTP host: en «Configuration» (ej. smtp.email.sa-santiago-1.oci.oraclecloud.com)
     - Usuario y contraseña SMTP: Perfil → «SMTP credentials» → Generate
     - Remitente: un «Approved sender» (ej. no-responder@tudominio.com)
   Si cambiás algo, volvé a correr este archivo (reemplaza los datos).
   ============================================================ */

merge into tb_correo c
using (select 1 id from dual) x on (c.id = x.id)
 when matched then update set
      smtp_host = 'smtp.email.sa-santiago-1.oci.oraclecloud.com',
      smtp_puerto = 587,
      smtp_usuario = 'PEGAR-ACA-EL-USUARIO-SMTP',
      smtp_clave = 'PEGAR-ACA-LA-CONTRASENA-SMTP',
      remitente = 'no-responder@tudominio.com',
      nombre_remitente = 'Turnos Barber',
      url_panel = 'https://objectstorage.sa-santiago-1.oraclecloud.com/n/axo4ubkyzpu5/b/turnos-web/o/admin.html'
 when not matched then insert (id, smtp_host, smtp_puerto, smtp_usuario, smtp_clave, remitente, nombre_remitente, url_panel)
      values (1, 'smtp.email.sa-santiago-1.oci.oraclecloud.com', 587, 'PEGAR-ACA-EL-USUARIO-SMTP', 'PEGAR-ACA-LA-CONTRASENA-SMTP',
              'no-responder@tudominio.com', 'Turnos Barber',
              'https://objectstorage.sa-santiago-1.oraclecloud.com/n/axo4ubkyzpu5/b/turnos-web/o/admin.html');
commit;

/* Prueba: mandate un correo a vos mismo (cambiá el email). Tiene que llegar en unos minutos. */
begin
  tb_api.probar_correo('tu-email@ejemplo.com');
end;
/
