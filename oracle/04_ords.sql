/* ============================================================
   04 · Correr como TURNOS
   Publica UNA sola URL:  POST https://<tu-host>/ords/turnos/api/rpc
   Esa URL es la que va en apiUrl de js/config.js.

   Orígenes permitidos (CORS): poné el dominio donde vas a subir la
   página, por ejemplo 'https://turnos.tudominio.com'. Mientras probás
   podés dejar null (acepta cualquier origen).
   ============================================================ */

begin
  ords.define_module(
    p_module_name     => 'turnos.api',
    p_base_path       => '/api/',
    p_items_per_page  => 0,
    p_status          => 'PUBLISHED',
    p_origins_allowed => null,
    p_comments        => 'API de Turnos Barber'
  );

  ords.define_template(
    p_module_name => 'turnos.api',
    p_pattern     => 'rpc'
  );

  ords.define_handler(
    p_module_name    => 'turnos.api',
    p_pattern        => 'rpc',
    p_method         => 'POST',
    p_source_type    => ords.source_type_plsql,
    p_items_per_page => 0,
    p_source         => q'[
declare
  l_res clob;
  l_len pls_integer;
  l_pos pls_integer := 1;
begin
  l_res := tb_api.rpc(:body_text);
  owa_util.mime_header('application/json', false, 'UTF-8');
  htp.p('Cache-Control: no-store');
  owa_util.http_header_close;
  l_len := dbms_lob.getlength(l_res);
  while l_pos <= l_len loop
    htp.prn(dbms_lob.substr(l_res, 4000, l_pos));
    l_pos := l_pos + 4000;
  end loop;
end;]'
  );
  commit;
end;
/
