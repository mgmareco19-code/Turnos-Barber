/* ============================================================
   06a · Correr como ADMIN (una vez)
   Deja que el usuario TURNOS se conecte al servidor de correo de
   Oracle Cloud (Email Delivery) para mandar los links de
   «Olvidé mi contraseña».

   >>> Si tu base no está en Santiago, cambiá sa-santiago-1 por tu región. <<<
   ============================================================ */

begin
  dbms_network_acl_admin.append_host_ace(
    host       => 'smtp.email.sa-santiago-1.oci.oraclecloud.com',
    lower_port => 587,
    upper_port => 587,
    ace        => xs$ace_type(privilege_list => xs$name_list('SMTP'),
                              principal_name => 'TURNOS',
                              principal_type => xs_acl.ptype_db)
  );
  commit;
end;
/

grant execute on utl_smtp to turnos;
