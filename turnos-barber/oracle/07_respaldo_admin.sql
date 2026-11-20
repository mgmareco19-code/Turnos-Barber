/* ============================================================
   07 · Correr como ADMIN (una vez)
   Respaldo semanal: todos los domingos a la madrugada exporta el
   esquema TURNOS (locales, turnos, ventas, facturas, clientes…) a un
   archivo .dmp y lo guarda en el bucket privado «turnos-respaldos».

   Antes de correrlo:
   1. Creá el bucket privado (en Cloud Shell):
        oci os bucket create --name turnos-respaldos --compartment-id "$OCI_TENANCY"
   2. Creá un «Auth token»: arriba a la derecha → tu perfil → Auth tokens
      → Generate token. Copialo (se muestra una sola vez).
   3. Completá abajo tu usuario de Oracle Cloud (el que figura en tu perfil,
      normalmente tu email) y el token.
   ============================================================ */

-- 1) Credencial para escribir en el bucket
begin
  dbms_cloud.create_credential(
    credential_name => 'RESPALDO_CRED',
    username        => 'TU-USUARIO-DE-ORACLE-CLOUD',
    password        => 'PEGAR-ACA-EL-AUTH-TOKEN'
  );
end;
/

-- 2) El respaldo: exporta TURNOS, lo sube al bucket y borra la copia local
create or replace procedure respaldo_turnos authid current_user as
  c_bucket constant varchar2(300) := 'https://objectstorage.sa-santiago-1.oraclecloud.com/n/axo4ubkyzpu5/b/turnos-respaldos/o/';
  l_base   varchar2(60) := 'turnos_' || to_char(systimestamp at time zone 'America/Asuncion', 'YYYYMMDD_HH24MI');
  h        number;
  l_estado varchar2(30);
begin
  h := dbms_datapump.open(operation => 'EXPORT', job_mode => 'SCHEMA', job_name => upper(l_base));
  dbms_datapump.add_file(h, l_base || '.dmp', 'DATA_PUMP_DIR');
  dbms_datapump.add_file(h, l_base || '.log', 'DATA_PUMP_DIR', filetype => dbms_datapump.ku$_file_type_log_file);
  dbms_datapump.metadata_filter(h, 'SCHEMA_EXPR', 'IN (''TURNOS'')');
  dbms_datapump.start_job(h);
  dbms_datapump.wait_for_job(h, l_estado);
  if l_estado <> 'COMPLETED' then
    raise_application_error(-20001, 'El respaldo terminó con estado ' || l_estado || '. Revisá ' || l_base || '.log');
  end if;
  dbms_cloud.put_object(credential_name => 'RESPALDO_CRED', object_uri => c_bucket || l_base || '.dmp',
                        directory_name => 'DATA_PUMP_DIR', file_name => l_base || '.dmp');
  dbms_cloud.put_object(credential_name => 'RESPALDO_CRED', object_uri => c_bucket || l_base || '.log',
                        directory_name => 'DATA_PUMP_DIR', file_name => l_base || '.log');
  dbms_cloud.delete_file('DATA_PUMP_DIR', l_base || '.dmp');
  dbms_cloud.delete_file('DATA_PUMP_DIR', l_base || '.log');
end;
/

-- 3) Todos los domingos a las 3:00 (hora de Paraguay)
begin
  dbms_scheduler.create_job(
    job_name        => 'RESPALDO_TURNOS_SEMANAL',
    job_type        => 'STORED_PROCEDURE',
    job_action      => 'RESPALDO_TURNOS',
    start_date      => systimestamp at time zone 'America/Asuncion',
    repeat_interval => 'FREQ=WEEKLY;BYDAY=SUN;BYHOUR=3;BYMINUTE=0;BYSECOND=0',
    enabled         => true,
    comments        => 'Respaldo semanal del esquema TURNOS al bucket turnos-respaldos'
  );
end;
/

-- 4) Probalo ahora: tiene que aparecer un turnos_AAAAMMDD_HHMM.dmp en el bucket
begin
  respaldo_turnos;
end;
/

/* ---------- Para revisar ----------
   Últimas ejecuciones del respaldo semanal:
     select log_date, status, additional_info from user_scheduler_job_run_details
      where job_name = 'RESPALDO_TURNOS_SEMANAL' order by log_date desc;

   ---------- Para restaurar (solo si pasa algo grave) ----------
   No lo hagas solo: avisame y lo hacemos juntos. Se baja el .dmp del
   bucket a DATA_PUMP_DIR con dbms_cloud.get_object y se importa con
   dbms_datapump (operation => 'IMPORT') sobre un esquema nuevo, para
   comparar antes de reemplazar nada. */
