/* ============================================================
   03 · Correr como TURNOS
   Paquete TB_API: toda la lógica de la app.
   La página llama a una sola URL (ver 04_ords.sql) con
     {"fn": "nombre_funcion", "args": {...}, "token": "..."}
   y recibe
     {"ok": true, "data": ...}   o   {"ok": false, "error": "mensaje"}
   Las tablas NO se publican: todo pasa por acá, y cada función
   filtra por el local de la sesión (un dueño nunca ve otro local).
   ============================================================ */

create or replace package tb_api authid definer as
  function  rpc(p_body in clob) return clob;
  /* Crear o cambiar la clave del superadmin (correr a mano, ver 05_inicial.sql) */
  procedure crear_superadmin(p_email in varchar2, p_clave in varchar2);
end tb_api;
/

create or replace package body tb_api as

  /* ---------------- Configuración ---------------- */
  c_tz            constant varchar2(40)  := 'America/Asuncion';
  c_dias_gracia   constant pls_integer   := 5;       -- igual que diasGracia en js/config.js
  c_precio        constant number        := 55000;   -- abono mensual por defecto (Gs.)
  c_max_serv      constant pls_integer   := 6;
  c_max_cambios   constant pls_integer   := 3;       -- veces que el cliente puede cambiar su turno (igual que en js/db.js)
  c_no_editable   constant varchar2(120) := 'Este turno ya no se puede cambiar ni cancelar desde acá. Escribinos por WhatsApp.';
  c_dias_sesion   constant pls_integer   := 30;
  c_formas        constant varchar2(60)  := ',efectivo,debito,credito,transferencia,qr,';  -- formas de pago válidas
  c_horario_base  constant varchar2(200) :=
    '{"0":null,"1":["09:00","20:00"],"2":["09:00","20:00"],"3":["09:00","20:00"],"4":["09:00","20:00"],"5":["09:00","20:00"],"6":["08:00","14:00"]}';

  /* ---------------- Estado de la llamada ---------------- */
  g_negocio   number;     -- local del dueño con sesión
  g_miembro   number;
  g_super     number;
  g_tok_hash  raw(32);

  type t_ids   is table of number index by pls_integer;
  type t_set   is table of number index by varchar2(40);
  type t_item  is record (servicio_id number, nombre varchar2(60), precio number, duracion number);
  type t_items is table of t_item index by pls_integer;

  /* ---------------- Utilidades ---------------- */
  procedure err(p_msg varchar2) is
  begin
    raise_application_error(-20001, p_msg);
  end;

  procedure sin_sesion is
  begin
    raise_application_error(-20002, 'Tu sesión terminó. Volvé a ingresar.');
  end;

  function ahora return date is
  begin
    return cast(systimestamp at time zone c_tz as date);
  end;

  function hoy return date is
  begin
    return trunc(ahora);
  end;

  function iso(p date) return varchar2 is
  begin
    return to_char(p, 'YYYY-MM-DD');
  end;

  function tiene(o json_object_t, k varchar2) return boolean is
  begin
    return o.has(k) and not o.get(k).is_null;
  end;

  function a_txt(o json_object_t, k varchar2, p_max pls_integer default 4000) return varchar2 is
    v varchar2(32767);
  begin
    if not tiene(o, k) then return null; end if;
    v := trim(o.get_string(k));
    if length(v) > p_max then err('Uno de los textos es demasiado largo.'); end if;
    return v;
  end;

  function a_num(o json_object_t, k varchar2) return number is
    e json_element_t;
  begin
    if not tiene(o, k) then return null; end if;
    e := o.get(k);
    if e.is_number then
      return o.get_number(k);
    elsif e.is_string then
      return to_number(o.get_string(k));
    end if;
    err('Dato numérico inválido.');
    return null;
  exception
    when value_error or invalid_number then err('Dato numérico inválido.'); return null;
  end;

  function a_entero(o json_object_t, k varchar2, p_min number, p_max number, p_msg varchar2) return number is
    n number := a_num(o, k);
  begin
    if n is null or n <> trunc(n) or n < p_min or n > p_max then err(p_msg); end if;
    return n;
  end;

  function a_bool(o json_object_t, k varchar2) return number is
  begin
    if not tiene(o, k) then return null; end if;
    if not o.get(k).is_boolean then err('Dato inválido.'); end if;
    return case when o.get_boolean(k) then 1 else 0 end;
  end;

  function a_fecha(o json_object_t, k varchar2) return date is
    v varchar2(20) := a_txt(o, k, 20);
  begin
    if v is null or not regexp_like(v, '^\d{4}-\d{2}-\d{2}$') then err('Fecha inválida.'); end if;
    return to_date(v, 'YYYY-MM-DD');
  exception
    when others then
      if sqlcode = -20001 then raise; end if;
      err('Fecha inválida.'); return null;
  end;

  /* "HH:MI" -> minutos */
  function hmin(p varchar2) return number is
  begin
    if p is null or not regexp_like(p, '^([01][0-9]|2[0-3]):[0-5][0-9]$') then err('Hora inválida.'); end if;
    return to_number(substr(p, 1, 2)) * 60 + to_number(substr(p, 4, 2));
  end;

  /* 31 ene + 1 mes = 28/29 feb (igual que en la página) */
  function sumar_meses(p date, n number) return date is
    t date := add_months(trunc(p, 'MM'), n);
  begin
    return t + least(extract(day from p), extract(day from last_day(t))) - 1;
  end;

  procedure log_error(p_fn varchar2, p_error varchar2, p_pila varchar2) is
    pragma autonomous_transaction;
  begin
    insert into tb_errores (fn, error, pila) values (substr(p_fn, 1, 40), substr(p_error, 1, 4000), substr(p_pila, 1, 4000));
    commit;
  end;

  /* ---------------- Claves y sesiones ---------------- */
  function hash_clave(p_clave varchar2, p_sal raw) return raw is
    h raw(32);
  begin
    h := dbms_crypto.hash(utl_raw.concat(p_sal, utl_i18n.string_to_raw(nvl(p_clave, ' '), 'AL32UTF8')), dbms_crypto.hash_sh256);
    for i in 1 .. 5000 loop
      h := dbms_crypto.hash(utl_raw.concat(h, p_sal), dbms_crypto.hash_sh256);
    end loop;
    return h;
  end;

  procedure validar_clave(p varchar2) is
  begin
    if p is null or length(p) < 8 or length(p) > 100 then
      err('La contraseña tiene que tener al menos 8 caracteres.');
    end if;
  end;

  /* 10 caracteres sin letras confusas (sin l, I, O, 0, 1) */
  function clave_temporal return varchar2 is
    c constant varchar2(60) := 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    r raw(10) := dbms_crypto.randombytes(10);
    v varchar2(10);
  begin
    for i in 1 .. 10 loop
      v := v || substr(c, mod(to_number(rawtohex(utl_raw.substr(r, i, 1)), 'XX'), length(c)) + 1, 1);
    end loop;
    return v;
  end;

  function nuevo_token(p_tipo varchar2, p_miembro number, p_super number) return varchar2 is
    r raw(32) := dbms_crypto.randombytes(32);
    h raw(32) := dbms_crypto.hash(r, dbms_crypto.hash_sh256);
  begin
    delete from tb_sesiones where expira < systimestamp;
    insert into tb_sesiones (token_hash, tipo, miembro_id, super_id, expira)
    values (h, p_tipo, p_miembro, p_super, systimestamp + numtodsinterval(c_dias_sesion, 'DAY'));
    return lower(rawtohex(r));
  end;

  procedure cargar_sesion(p_token varchar2, p_tipo varchar2) is
    h raw(32);
  begin
    g_negocio := null; g_miembro := null; g_super := null; g_tok_hash := null;
    if p_token is null or not regexp_like(p_token, '^[0-9a-f]{64}$') then sin_sesion; end if;
    h := dbms_crypto.hash(hextoraw(p_token), dbms_crypto.hash_sh256);
    if p_tipo = 'dueno' then
      select m.id, m.negocio_id into g_miembro, g_negocio
        from tb_sesiones s join tb_miembros m on m.id = s.miembro_id
       where s.token_hash = h and s.tipo = 'dueno' and s.expira > systimestamp;
    else
      select s.super_id into g_super
        from tb_sesiones s
       where s.token_hash = h and s.tipo = 'super' and s.expira > systimestamp and s.super_id is not null;
    end if;
    g_tok_hash := h;
  exception
    when no_data_found then sin_sesion;
  end;

  procedure cerrar_sesion(p_token varchar2) is
    h raw(32);
  begin
    if p_token is null or not regexp_like(p_token, '^[0-9a-f]{64}$') then return; end if;
    h := dbms_crypto.hash(hextoraw(p_token), dbms_crypto.hash_sh256);
    delete from tb_sesiones where token_hash = h;
  end;

  /* ---------------- Validaciones ---------------- */
  procedure validar_slug(p_slug varchar2, p_excepto number) is
    n number;
  begin
    if p_slug is null or length(p_slug) < 3 or length(p_slug) > 40 or not regexp_like(p_slug, '^[a-z0-9]+(-[a-z0-9]+)*$') then
      err('El link solo puede tener letras minúsculas, números y guiones (3 a 40 caracteres).');
    end if;
    if p_slug in ('admin', 'panel', 'superadmin', 'api', 'www', 'app', 'login', 'demo') then
      err('«' || p_slug || '» es una palabra reservada. Elegí otro link.');
    end if;
    select count(*) into n from tb_negocios where slug = p_slug and id <> nvl(p_excepto, -1);
    if n > 0 then err('Ese link ya lo usa otro local.'); end if;
  end;

  function validar_email(p varchar2) return varchar2 is
    e varchar2(200) := lower(trim(p));
  begin
    if e is null or length(e) > 120 or not regexp_like(e, '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
      err('Ingresá un email válido para el dueño.');
    end if;
    return e;
  end;

  function normalizar_horario(o json_object_t) return clob is
    r        json_object_t := json_object_t();
    arr      json_array_t;
    nuevo    json_array_t;
    ini      number;
    fin      number;
    abiertos pls_integer := 0;
    k        varchar2(1);
  begin
    for d in 0 .. 6 loop
      k := to_char(d);
      if not tiene(o, k) then
        r.put_null(k);
      else
        if not o.get(k).is_array then err('Horario inválido.'); end if;
        arr := o.get_array(k);
        if arr.get_size <> 2 then err('Horario inválido.'); end if;
        ini := hmin(arr.get_string(0));
        fin := hmin(arr.get_string(1));
        if fin <= ini then err('La hora de cierre tiene que ser después de la de apertura.'); end if;
        nuevo := json_array_t();
        nuevo.append(arr.get_string(0));
        nuevo.append(arr.get_string(1));
        r.put(k, nuevo);
        abiertos := abiertos + 1;
      end if;
    end loop;
    if abiertos = 0 then err('Marcá al menos un día abierto.'); end if;
    return r.to_clob;
  end;

  /* Horario de un día (0 = domingo, como en la página). o_ini null = cerrado */
  procedure horario_dia(p_horario clob, p_fecha date, o_ini out number, o_fin out number) is
    o   json_object_t := json_object_t.parse(p_horario);
    k   varchar2(1) := to_char(mod(trunc(p_fecha) - trunc(p_fecha, 'IW') + 1, 7));
    arr json_array_t;
  begin
    o_ini := null; o_fin := null;
    if tiene(o, k) then
      arr := o.get_array(k);
      o_ini := hmin(arr.get_string(0));
      o_fin := hmin(arr.get_string(1));
    end if;
  end;

  /* Mismas reglas que U.estadoNegocio: vencido + días de gracia = sin reservas */
  function puede_reservar(p_activo number, p_vence date) return boolean is
  begin
    if p_activo = 0 then return false; end if;
    if p_vence is null then return true; end if;
    return p_vence - hoy >= -c_dias_gracia;
  end;

  /* ---------------- Clientes y bloqueos (02d_extras.sql) ---------------- */
  /* Últimos 8 dígitos del celular: 0981 123 456 y +595 981 123456 son el mismo. Null si tiene menos de 6 */
  function tel_key(p varchar2) return varchar2 is
    d varchar2(60) := regexp_replace(p, '[^0-9]');
  begin
    if d is null or length(d) < 6 then return null; end if;
    return substr(d, greatest(length(d) - 7, 1));
  end;

  /* Cliente del local con ese celular (o ese RUC). Si no existe, lo crea; si existe, completa lo que le falte */
  function cliente_para(p_neg number, p_nombre varchar2, p_tel varchar2, p_ruc varchar2) return number is
    k     varchar2(8) := tel_key(p_tel);
    l_ruc varchar2(12) := case when p_ruc = '44444401-7' then null else p_ruc end;   -- consumidor final: no es un cliente
    l_id  number;
  begin
    if k is not null then
      begin
        select id into l_id from tb_clientes where negocio_id = p_neg and tel_key = k;
      exception
        when no_data_found then null;
      end;
    end if;
    if l_id is null and l_ruc is not null then
      begin
        select id into l_id from tb_clientes where negocio_id = p_neg and ruc = l_ruc order by id fetch first 1 row only;
      exception
        when no_data_found then null;
      end;
    end if;
    if l_id is null then
      if k is null and (l_ruc is null or p_nombre is null or p_nombre = 'Sin nombre') then return null; end if;
      insert into tb_clientes (negocio_id, nombre, telefono, tel_key, ruc)
      values (p_neg, nvl(p_nombre, 'Sin nombre'), case when k is not null then p_tel end, k, l_ruc)
      returning id into l_id;
    else
      update tb_clientes
         set ruc      = nvl(ruc, l_ruc),
             telefono = case when tel_key is null and k is not null then p_tel else telefono end,
             tel_key  = nvl(tel_key, k)
       where id = l_id;
    end if;
    return l_id;
  end;

  /* Motivo del bloqueo que pisa ese horario de ese barbero (null = libre) */
  function bloqueo_en(p_neg number, p_bar number, p_fecha date, p_ini number, p_fin number) return varchar2 is
    l varchar2(80);
  begin
    select nvl(motivo, 'horario bloqueado') into l
      from tb_bloqueos
     where negocio_id = p_neg and (barbero_id is null or barbero_id = p_bar)
       and p_fecha between desde and hasta
       and (ini_min is null or (ini_min < p_fin and p_ini < fin_min))
     fetch first 1 row only;
    return l;
  exception
    when no_data_found then return null;
  end;

  /* ---------------- JSON de salida ---------------- */
  /* Datos del timbrado del local (null si todavía no los cargó) */
  function factura_json(p_neg number) return clob is
    l clob;
  begin
    select json_object(
             'razon_social' value razon_social, 'ruc' value ruc, 'actividad' value actividad, 'timbrado' value timbrado,
             'desde' value to_char(desde, 'YYYY-MM-DD'), 'hasta' value to_char(hasta, 'YYYY-MM-DD'),
             'establecimiento' value establecimiento, 'punto' value punto, 'proximo' value proximo,
             'direccion' value direccion, 'telefono' value telefono
             returning clob)
      into l
      from tb_facturacion
     where negocio_id = p_neg;
    return l;
  exception
    when no_data_found then return null;
  end;

  function negocio_json(p_id number, p_priv number) return clob is
    l     clob;
    f     clob;
    o     json_object_t;
    l_hoy date := hoy;
  begin
    select json_object(
             'id'                value n.id,
             'slug'              value n.slug,
             'nombre'            value n.nombre,
             'nombre_corto'      value n.nombre_corto,
             'logo'              value n.logo,
             'logo_solo'         value case n.logo_solo when 1 then 'true' else 'false' end format json,
             'whatsapp'          value n.whatsapp,
             'direccion'         value n.direccion,
             'horario'           value n.horario format json,
             'intervalo'         value n.intervalo,
             'dias_anticipacion' value n.dias_anticipacion,
             'margen_minutos'    value n.margen_minutos,
             'activo'            value case n.activo when 1 then 'true' else 'false' end format json,
             'vence_el'          value to_char(n.vence_el, 'YYYY-MM-DD'),
             -- Días en que todo el local está cerrado (vacaciones, feriados): la reserva los muestra como cerrados
             'cierres'           value (select json_arrayagg(json_object('desde' value to_char(k.desde, 'YYYY-MM-DD'),
                                                 'hasta' value to_char(k.hasta, 'YYYY-MM-DD'), 'motivo' value k.motivo)
                                                 order by k.desde returning clob)
                                          from tb_bloqueos k
                                         where k.negocio_id = n.id and k.barbero_id is null and k.ini_min is null
                                           and k.hasta >= l_hoy) format json,
             'precio'            value case when p_priv = 1 then n.precio end,
             'dueno'             value case when p_priv = 1 then
                                         (select m.email from tb_miembros m where m.negocio_id = n.id fetch first 1 row only) end
             returning clob)
      into l
      from tb_negocios n
     where n.id = p_id;
    if p_priv = 1 then
      -- El dueño (y vos) ven además los datos del timbrado
      o := json_object_t.parse(l);
      f := factura_json(p_id);
      if f is null then o.put_null('factura'); else o.put('factura', json_object_t.parse(f)); end if;
      return o.to_clob;
    end if;
    return l;
  end;

  /* ================= PÚBLICO (página de reservas) ================= */
  function f_negocio_por_slug(a json_object_t) return clob is
    l_id   number;
    l_slug varchar2(40) := lower(a_txt(a, 'slug', 40));
  begin
    select id into l_id from tb_negocios where slug = l_slug;
    return negocio_json(l_id, 0);
  exception
    when no_data_found then return 'null';
  end;

  /* todos = true (panel) pide sesión del dueño de ese local */
  procedure chequear_todos(a json_object_t, p_token varchar2, p_neg number) is
  begin
    if nvl(a_bool(a, 'todos'), 0) = 1 then
      cargar_sesion(p_token, 'dueno');
      if g_negocio <> p_neg then sin_sesion; end if;
    end if;
  end;

  function f_servicios(a json_object_t, p_token varchar2) return clob is
    l_neg   number := a_num(a, 'negocio_id');
    l_todos number := nvl(a_bool(a, 'todos'), 0);
    l       clob;
  begin
    chequear_todos(a, p_token, l_neg);
    select json_arrayagg(json_object(
             'id' value id, 'negocio_id' value negocio_id, 'nombre' value nombre, 'descripcion' value descripcion,
             'duracion' value duracion, 'precio' value precio, 'orden' value orden,
             'activo' value case activo when 1 then 'true' else 'false' end format json)
             order by orden, id returning clob)
      into l
      from tb_servicios
     where negocio_id = l_neg and (l_todos = 1 or activo = 1);
    return nvl(l, '[]');
  end;

  function f_barberos(a json_object_t, p_token varchar2) return clob is
    l_neg   number := a_num(a, 'negocio_id');
    l_todos number := nvl(a_bool(a, 'todos'), 0);
    l       clob;
  begin
    chequear_todos(a, p_token, l_neg);
    select json_arrayagg(json_object(
             'id' value id, 'negocio_id' value negocio_id, 'nombre' value nombre,
             'especialidad' value especialidad, 'foto' value foto,
             -- las comisiones solo las ve el dueño
             'comision' value case when l_todos = 1 then comision end,
             'comision_prod' value case when l_todos = 1 then comision_prod end,
             'activo' value case activo when 1 then 'true' else 'false' end format json)
             order by id returning clob)
      into l
      from tb_barberos
     where negocio_id = l_neg and (l_todos = 1 or activo = 1);
    return nvl(l, '[]');
  end;

  /* Solo horarios ocupados: nunca datos de clientes */
  function f_ocupados(a json_object_t) return clob is
    l_neg   number := a_num(a, 'negocio_id');
    l_fecha date := a_fecha(a, 'fecha');
    l_exc   varchar2(40) := a_txt(a, 'excluir', 40);
    l       clob;
  begin
    select json_arrayagg(json_object('barbero_id' value barbero_id, 'hora' value hora, 'duracion' value duracion) returning clob)
      into l
      from (select barbero_id, hora, duracion
              from tb_turnos
             where negocio_id = l_neg and fecha = l_fecha and estado <> 'cancelado'
               and (l_exc is null or id <> l_exc)   -- al cambiar un turno, el propio turno no cuenta como ocupado
            union all
            -- Bloqueos (vacaciones, feriados, un barbero que falta): ocupan el horario de cada barbero afectado
            select b.id,
                   to_char(trunc(nvl(k.ini_min, 0) / 60), 'FM00') || ':' || to_char(mod(nvl(k.ini_min, 0), 60), 'FM00'),
                   nvl(k.fin_min, 1440) - nvl(k.ini_min, 0)
              from tb_bloqueos k
              join tb_barberos b on b.negocio_id = k.negocio_id and (k.barbero_id is null or k.barbero_id = b.id)
             where k.negocio_id = l_neg and l_fecha between k.desde and k.hasta);
    return nvl(l, '[]');
  end;

  /* Crea un turno probando los barberos candidatos en orden. Devuelve {codigo, barbero_id} */
  function nuevo_turno(p_neg number, a json_object_t, p_cand t_ids, p_estado varchar2, p_origen varchar2,
                       p_campo_nombre varchar2, p_campo_tel varchar2) return clob is
    n       tb_negocios%rowtype;
    ids     json_array_t;
    vistos  t_set;
    items   t_items;
    sv      tb_servicios%rowtype;
    sid     number;
    k       pls_integer := 0;
    l_fecha date;
    l_hora  varchar2(5);
    l_ini   number;
    l_dur   number := 0;
    l_prec  number := 0;
    h_ini   number;
    h_fin   number;
    l_dias  number;
    l_nom   varchar2(80);
    l_tel   varchar2(30);
    l_nota  varchar2(300);
    l_bar   number := null;
    l_cnt   number;
    l_id    varchar2(32);
    l_cod   varchar2(8);
    l_mot   varchar2(80);
    l_cli   number;
  begin
    select * into n from tb_negocios where id = p_neg;

    if not tiene(a, 'servicio_ids') or not a.get('servicio_ids').is_array then err('Elegí al menos un servicio.'); end if;
    ids := a.get_array('servicio_ids');
    for i in 0 .. ids.get_size - 1 loop
      sid := ids.get_number(i);
      if sid is not null and not vistos.exists(to_char(sid)) then
        vistos(to_char(sid)) := 1;
        k := k + 1;
        if k > c_max_serv then err('Podés elegir hasta ' || c_max_serv || ' servicios por turno.'); end if;
        begin
          select * into sv from tb_servicios where id = sid and negocio_id = p_neg and activo = 1;
        exception
          when no_data_found then err('Alguno de los servicios elegidos ya no está disponible.');
        end;
        items(k).servicio_id := sv.id;
        items(k).nombre      := sv.nombre;
        items(k).precio      := sv.precio;
        items(k).duracion    := sv.duracion;
        l_dur  := l_dur + sv.duracion;
        l_prec := l_prec + sv.precio;
      end if;
    end loop;
    if k = 0 then err('Elegí al menos un servicio.'); end if;

    l_fecha := a_fecha(a, 'fecha');
    l_hora  := a_txt(a, 'hora', 5);
    l_ini   := hmin(l_hora);
    if l_ini + l_dur > 1440 then err('El turno no puede pasar de la medianoche.'); end if;

    l_nom  := a_txt(a, p_campo_nombre, 80);
    l_tel  := a_txt(a, p_campo_tel, 30);
    l_nota := a_txt(a, 'nota', 300);
    if l_nom is null or length(l_nom) < 2 then err('Ingresá el nombre.'); end if;
    if l_tel is null or length(regexp_replace(l_tel, '[^0-9]')) < 6 then err('Ingresá un número de celular válido.'); end if;

    if p_origen = 'web' then
      -- La reserva pública solo puede caer dentro del horario, del rango de días y con el aviso mínimo
      horario_dia(n.horario, l_fecha, h_ini, h_fin);
      l_dias := l_fecha - hoy;
      if h_ini is null or l_ini < h_ini or l_ini + l_dur > h_fin
         or l_dias < 0 or l_dias >= n.dias_anticipacion
         or (l_dias = 0 and l_ini < (ahora - hoy) * 1440 + n.margen_minutos) then
        err('Ese horario no está disponible. Elegí otro.');
      end if;
    end if;

    for i in 1 .. p_cand.count loop
      begin
        -- Bloquea al barbero: dos reservas al mismo tiempo no pueden tomar el mismo horario
        select id into l_bar
          from tb_barberos
         where id = p_cand(i) and negocio_id = p_neg and (p_origen = 'local' or activo = 1)
           for update;
      exception
        when no_data_found then l_bar := null;
      end;
      if l_bar is not null then
        select count(*) into l_cnt
          from tb_turnos
         where barbero_id = l_bar and fecha = l_fecha and estado <> 'cancelado'
           and ini_min < l_ini + l_dur and l_ini < ini_min + duracion;
        if l_cnt = 0 then
          l_mot := bloqueo_en(p_neg, l_bar, l_fecha, l_ini, l_ini + l_dur);
          exit when l_mot is null;
        end if;
        l_bar := null;
      end if;
    end loop;
    if l_bar is null then
      if p_cand.count = 1 and l_mot is not null then err('Ese horario está bloqueado (' || l_mot || '). Elegí otro.'); end if;
      err(case when p_cand.count > 1 then 'Ese horario se acaba de ocupar. Elegí otro.'
               else 'Ese horario ya está ocupado para ese barbero.' end);
    end if;

    l_cli := cliente_para(p_neg, l_nom, l_tel, null);
    l_cod := dbms_random.string('X', 6);
    insert into tb_turnos (negocio_id, codigo, barbero_id, fecha, hora, ini_min, duracion, precio,
                           cliente_nombre, cliente_telefono, nota, estado, origen, cliente_id)
    values (p_neg, l_cod, l_bar, l_fecha, l_hora, l_ini, l_dur, l_prec, l_nom, l_tel, l_nota, p_estado, p_origen, l_cli)
    returning id into l_id;
    for i in 1 .. items.count loop
      insert into tb_turno_items (turno_id, orden, servicio_id, nombre, precio, duracion)
      values (l_id, i, items(i).servicio_id, items(i).nombre, items(i).precio, items(i).duracion);
    end loop;
    return '{"id":"' || l_id || '","codigo":"' || l_cod || '","barbero_id":' || l_bar || '}';
  end;

  function f_reservar(a json_object_t) return clob is
    l_neg  number := a_num(a, 'negocio_id');
    l_act  number;
    l_ven  date;
    cand   t_ids;
  begin
    begin
      select activo, vence_el into l_act, l_ven from tb_negocios where id = l_neg;
    exception
      when no_data_found then err('Local no encontrado.');
    end;
    if not puede_reservar(l_act, l_ven) then
      err('Este local no está recibiendo reservas online en este momento.');
    end if;
    if tiene(a, 'barbero_id') then
      cand(1) := a_num(a, 'barbero_id');
    else
      select id bulk collect into cand from tb_barberos where negocio_id = l_neg and activo = 1 order by dbms_random.value;
    end if;
    return nuevo_turno(l_neg, a, cand, 'pendiente', 'web', 'nombre', 'telefono');
  end;

  /* ================= MI TURNO (el cliente, con su link o su código) =================
     El link lleva el id del turno (imposible de adivinar). Sin link, se busca con
     código + celular. Nunca devuelve el teléfono ni la nota. */

  /* Se puede cambiar o cancelar si está pendiente o confirmado y falta al menos el aviso mínimo del local */
  function turno_editable(t tb_turnos%rowtype, p_margen number) return boolean is
  begin
    return t.estado in ('pendiente', 'confirmado')
       and (t.fecha > hoy or (t.fecha = hoy and t.ini_min >= (ahora - hoy) * 1440 + nvl(p_margen, 30)));
  end;

  function doc_turno_cliente(p_id varchar2) return clob is
    t      tb_turnos%rowtype;
    l_marg number;
    l_ed   number := 0;
    l_max  number := c_max_cambios;
    l      clob;
  begin
    select * into t from tb_turnos where id = p_id;
    select margen_minutos into l_marg from tb_negocios where id = t.negocio_id;
    if turno_editable(t, l_marg) then l_ed := 1; end if;
    select json_object(
             'id' value t.id, 'negocio_id' value t.negocio_id, 'codigo' value t.codigo, 'barbero_id' value t.barbero_id,
             'fecha' value to_char(t.fecha, 'YYYY-MM-DD'), 'hora' value t.hora, 'duracion' value t.duracion,
             'precio' value t.precio, 'cliente_nombre' value t.cliente_nombre, 'estado' value t.estado,
             'cambios' value t.cambios, 'cancelado_por' value t.cancelado_por, 'max_cambios' value l_max,
             'editable' value case l_ed when 1 then 'true' else 'false' end format json,
             'barbero' value (select json_object('nombre' value b.nombre) from tb_barberos b where b.id = t.barbero_id) format json,
             'items' value (select json_arrayagg(json_object('servicio_id' value i.servicio_id, 'nombre' value i.nombre,
                                    'precio' value i.precio, 'duracion' value i.duracion, 'orden' value i.orden)
                                    order by i.orden returning clob)
                              from tb_turno_items i where i.turno_id = t.id) format json
             returning clob)
      into l
      from dual;
    return l;
  end;

  /* {negocio_id, id} o {negocio_id, codigo, telefono}. Con un id que no existe devuelve null */
  function f_mi_turno(a json_object_t) return clob is
    l_neg number := a_num(a, 'negocio_id');
    l_id  varchar2(40) := lower(a_txt(a, 'id', 40));
    l_cod varchar2(8);
    l_tel varchar2(40);
    l_n   pls_integer;
  begin
    if l_id is not null then
      begin
        select id into l_id from tb_turnos where id = l_id and negocio_id = l_neg;
      exception
        when no_data_found then return 'null';
      end;
    else
      l_cod := upper(a_txt(a, 'codigo', 8));
      l_tel := regexp_replace(a_txt(a, 'telefono', 30), '[^0-9]');
      if l_cod is null or l_tel is null or length(l_tel) < 6 then err('Ingresá tu código de reserva y tu celular.'); end if;
      l_n := least(8, length(l_tel));   -- se comparan los últimos dígitos: 0981… y 595981… son el mismo número
      begin
        select id into l_id
          from tb_turnos
         where negocio_id = l_neg and codigo = l_cod
           and substr(regexp_replace(cliente_telefono, '[^0-9]'), -l_n) = substr(l_tel, -l_n)
         order by fecha desc
         fetch first 1 row only;
      exception
        when no_data_found then err('No encontramos un turno con ese código y ese celular. Revisá los datos.');
      end;
    end if;
    return doc_turno_cliente(l_id);
  end;

  function f_cancelar_turno(a json_object_t) return clob is
    l_neg  number := a_num(a, 'negocio_id');
    l_id   varchar2(40) := lower(a_txt(a, 'id', 40));
    t      tb_turnos%rowtype;
    l_marg number;
  begin
    begin
      select * into t from tb_turnos where id = l_id and negocio_id = l_neg for update;
    exception
      when no_data_found then err('Turno no encontrado.');
    end;
    if t.estado = 'cancelado' then err('Este turno ya está cancelado.'); end if;
    select margen_minutos into l_marg from tb_negocios where id = l_neg;
    if not turno_editable(t, l_marg) then err(c_no_editable); end if;
    update tb_turnos set estado = 'cancelado', cancelado_por = 'cliente' where id = t.id;
    return doc_turno_cliente(t.id);
  end;

  /* Mismos servicios, otro día / hora / barbero. Vuelve a quedar "pendiente" para que el local lo confirme */
  function f_reprogramar_turno(a json_object_t) return clob is
    l_neg   number := a_num(a, 'negocio_id');
    l_id    varchar2(40) := lower(a_txt(a, 'id', 40));
    n       tb_negocios%rowtype;
    t       tb_turnos%rowtype;
    cand    t_ids;
    l_pref  number;
    l_fecha date;
    l_hora  varchar2(5);
    l_ini   number;
    h_ini   number;
    h_fin   number;
    l_dias  number;
    l_bar   number := null;
    l_cnt   number;
  begin
    begin
      select * into n from tb_negocios where id = l_neg;
      select * into t from tb_turnos where id = l_id and negocio_id = l_neg for update;
    exception
      when no_data_found then err('Turno no encontrado.');
    end;
    if not turno_editable(t, n.margen_minutos) then err(c_no_editable); end if;
    if t.cambios >= c_max_cambios then
      err('Ya cambiaste este turno ' || c_max_cambios || ' veces. Para otro cambio, escribinos por WhatsApp.');
    end if;
    if not puede_reservar(n.activo, n.vence_el) then
      err('Este local no está recibiendo cambios online en este momento. Escribinos por WhatsApp.');
    end if;

    l_fecha := a_fecha(a, 'fecha');
    l_hora  := a_txt(a, 'hora', 5);
    l_ini   := hmin(l_hora);
    horario_dia(n.horario, l_fecha, h_ini, h_fin);
    l_dias := l_fecha - hoy;
    if h_ini is null or l_ini < h_ini or l_ini + t.duracion > h_fin
       or l_dias < 0 or l_dias >= n.dias_anticipacion
       or (l_dias = 0 and l_ini < (ahora - hoy) * 1440 + n.margen_minutos) then
      err('Ese horario no está disponible. Elegí otro.');
    end if;

    l_pref := a_num(a, 'barbero_id');
    if l_fecha = t.fecha and l_ini = t.ini_min and (l_pref is null or l_pref = t.barbero_id) then
      err('Elegí un día u horario distinto al que ya tenés.');
    end if;
    if l_pref is not null then
      cand(1) := l_pref;
    else
      -- Sin preferencia: primero su mismo barbero, después los demás al azar
      select id bulk collect into cand
        from tb_barberos
       where negocio_id = l_neg and activo = 1
       order by case when id = t.barbero_id then 0 else 1 end, dbms_random.value;
    end if;

    for i in 1 .. cand.count loop
      begin
        select id into l_bar from tb_barberos where id = cand(i) and negocio_id = l_neg and activo = 1 for update;
      exception
        when no_data_found then l_bar := null;
      end;
      if l_bar is not null then
        select count(*) into l_cnt
          from tb_turnos
         where barbero_id = l_bar and fecha = l_fecha and estado <> 'cancelado' and id <> t.id
           and ini_min < l_ini + t.duracion and l_ini < ini_min + duracion;
        exit when l_cnt = 0 and bloqueo_en(l_neg, l_bar, l_fecha, l_ini, l_ini + t.duracion) is null;
        l_bar := null;
      end if;
    end loop;
    if l_bar is null then
      err(case when cand.count > 1 then 'Ese horario se acaba de ocupar. Elegí otro.'
               else 'Ese horario ya está ocupado para ese barbero. Elegí otro.' end);
    end if;

    update tb_turnos
       set fecha = l_fecha, hora = l_hora, ini_min = l_ini, barbero_id = l_bar,
           estado = 'pendiente', cambios = cambios + 1
     where id = t.id;
    return doc_turno_cliente(t.id);
  end;

  /* ================= DUEÑO DEL LOCAL ================= */
  function f_login(a json_object_t) return clob is
    l_email varchar2(200) := lower(a_txt(a, 'email', 200));
    l_clave varchar2(200);
    r       tb_miembros%rowtype;
  begin
    if tiene(a, 'password') then l_clave := a.get_string('password'); end if;
    begin
      select * into r from tb_miembros where email = l_email for update;
    exception
      when no_data_found then err('Email o contraseña incorrectos.');
    end;
    if r.bloqueado_hasta > systimestamp then err('Demasiados intentos. Probá de nuevo en 15 minutos.'); end if;
    if hash_clave(l_clave, r.clave_sal) <> r.clave_hash then
      update tb_miembros
         set intentos        = case when intentos + 1 >= 5 then 0 else intentos + 1 end,
             bloqueado_hasta = case when intentos + 1 >= 5 then systimestamp + interval '15' minute end
       where id = r.id;
      commit; -- el intento queda guardado aunque después se haga rollback
      err('Email o contraseña incorrectos.');
    end if;
    update tb_miembros set intentos = 0, bloqueado_hasta = null where id = r.id;
    return '{"token":"' || nuevo_token('dueno', r.id, null) || '"}';
  end;

  function f_guardar_negocio(c json_object_t) return clob is
    n      tb_negocios%rowtype;
    l_logo clob;
  begin
    select * into n from tb_negocios where id = g_negocio for update;
    -- El dueño no toca link, abono, precio ni estado
    if c.has('nombre') then
      n.nombre := a_txt(c, 'nombre', 60);
      if n.nombre is null or length(n.nombre) < 2 then err('Ingresá el nombre del local.'); end if;
    end if;
    if c.has('nombre_corto') then n.nombre_corto := a_txt(c, 'nombre_corto', 40); end if;
    if c.has('logo') then
      if tiene(c, 'logo') then
        l_logo := c.get_clob('logo');
        if dbms_lob.getlength(l_logo) > 600000 or dbms_lob.substr(l_logo, 11, 1) <> 'data:image/' then
          err('El logo no es una imagen válida o es muy pesado.');
        end if;
        n.logo := l_logo;
      else
        n.logo := null;
      end if;
    end if;
    if c.has('logo_solo') then n.logo_solo := nvl(a_bool(c, 'logo_solo'), 0); end if;
    if c.has('whatsapp') then
      n.whatsapp := regexp_replace(a_txt(c, 'whatsapp', 30), '[^0-9]');
      if n.whatsapp is not null and length(n.whatsapp) not between 8 and 15 then err('El WhatsApp no parece un número válido.'); end if;
    end if;
    if c.has('direccion') then n.direccion := a_txt(c, 'direccion', 150); end if;
    if c.has('horario') then
      if not tiene(c, 'horario') or not c.get('horario').is_object then err('Horario inválido.'); end if;
      n.horario := normalizar_horario(c.get_object('horario'));
    end if;
    if c.has('intervalo') then n.intervalo := a_entero(c, 'intervalo', 5, 120, 'Intervalo inválido.'); end if;
    if c.has('dias_anticipacion') then n.dias_anticipacion := a_entero(c, 'dias_anticipacion', 1, 365, 'Días de anticipación inválidos.'); end if;
    if c.has('margen_minutos') then n.margen_minutos := a_entero(c, 'margen_minutos', 0, 1440, 'Aviso mínimo inválido.'); end if;

    update tb_negocios
       set nombre = n.nombre, nombre_corto = n.nombre_corto, logo = n.logo, logo_solo = n.logo_solo,
           whatsapp = n.whatsapp, direccion = n.direccion, horario = n.horario, intervalo = n.intervalo,
           dias_anticipacion = n.dias_anticipacion, margen_minutos = n.margen_minutos
     where id = g_negocio;
    return negocio_json(g_negocio, 1);
  end;

  function f_cambiar_clave(a json_object_t) return clob is
    l_clave varchar2(200);
    l_sal   raw(16) := dbms_crypto.randombytes(16);
    l_hash  raw(32);
  begin
    if tiene(a, 'nueva') then l_clave := a.get_string('nueva'); end if;
    validar_clave(l_clave);
    l_hash := hash_clave(l_clave, l_sal);
    update tb_miembros set clave_hash = l_hash, clave_sal = l_sal, intentos = 0, bloqueado_hasta = null where id = g_miembro;
    -- Cierra las otras sesiones (ej. otro celular)
    delete from tb_sesiones where miembro_id = g_miembro and token_hash <> g_tok_hash;
    return 'null';
  end;

  function f_turnos(a json_object_t) return clob is
    l_desde date := a_fecha(a, 'desde');
    l_hasta date := a_fecha(a, 'hasta');
    l       clob;
  begin
    if l_hasta < l_desde or l_hasta - l_desde > 400 then err('Rango de fechas inválido.'); end if;
    select json_arrayagg(json_object(
             'id' value t.id, 'negocio_id' value t.negocio_id, 'codigo' value t.codigo, 'barbero_id' value t.barbero_id,
             'fecha' value to_char(t.fecha, 'YYYY-MM-DD'), 'hora' value t.hora, 'duracion' value t.duracion,
             'precio' value t.precio, 'cliente_nombre' value t.cliente_nombre, 'cliente_telefono' value t.cliente_telefono,
             'nota' value t.nota, 'estado' value t.estado, 'origen' value t.origen,
             'cambios' value t.cambios, 'cancelado_por' value t.cancelado_por, 'cliente_id' value t.cliente_id,
             'creado_en' value to_char(sys_extract_utc(t.creado_en), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'barbero' value json_object('nombre' value b.nombre),
             'cobro' value (select json_object('id' value v.id, 'numero' value v.numero, 'tipo' value v.tipo)
                              from tb_ventas v where v.turno_id = t.id and v.anulada = 0
                             fetch first 1 row only) format json,
             'items' value (select json_arrayagg(json_object('servicio_id' value i.servicio_id, 'nombre' value i.nombre,
                                    'precio' value i.precio, 'duracion' value i.duracion, 'orden' value i.orden)
                                    order by i.orden returning clob)
                              from tb_turno_items i where i.turno_id = t.id) format json
             returning clob)
             order by t.fecha, t.ini_min returning clob)
      into l
      from tb_turnos t
      left join tb_barberos b on b.id = t.barbero_id
     where t.negocio_id = g_negocio and t.fecha between l_desde and l_hasta;
    return nvl(l, '[]');
  end;

  function f_crear_turno(a json_object_t) return clob is
    cand t_ids;
    l    clob;
  begin
    cand(1) := a_num(a, 'barbero_id');
    l := nuevo_turno(g_negocio, a, cand, 'confirmado', 'local', 'cliente_nombre', 'cliente_telefono');
    return 'null';
  end;

  function f_actualizar_turno(a json_object_t) return clob is
    l_id     varchar2(32) := a_txt(a, 'id', 32);
    l_estado varchar2(12) := a_txt(a, 'estado', 12);
    t        tb_turnos%rowtype;
    l_cnt    number;
  begin
    if l_estado not in ('pendiente', 'confirmado', 'completado', 'ausente', 'cancelado') or l_estado is null then
      err('Estado inválido.');
    end if;
    begin
      select * into t from tb_turnos where id = l_id and negocio_id = g_negocio for update;
    exception
      when no_data_found then err('Turno no encontrado');
    end;
    if l_estado <> 'cancelado' and t.estado = 'cancelado' then
      select count(*) into l_cnt
        from tb_turnos
       where barbero_id = t.barbero_id and fecha = t.fecha and estado <> 'cancelado' and id <> t.id
         and ini_min < t.ini_min + t.duracion and t.ini_min < ini_min + duracion;
      if l_cnt > 0 then err('No se puede reactivar: el horario ya fue tomado.'); end if;
    end if;
    update tb_turnos
       set estado        = l_estado,
           cancelado_por = case when l_estado <> 'cancelado' then null
                                when t.estado = 'cancelado' then t.cancelado_por
                                else 'local' end
     where id = t.id;
    return 'null';
  end;

  function f_guardar_barbero(a json_object_t) return clob is
    l_id number := a_num(a, 'id');
    b    tb_barberos%rowtype;
  begin
    if l_id is not null then
      begin
        select * into b from tb_barberos where id = l_id and negocio_id = g_negocio for update;
      exception
        when no_data_found then err('Barbero no encontrado');
      end;
    else
      b.activo := 1;
    end if;
    if a.has('nombre') or l_id is null then
      b.nombre := a_txt(a, 'nombre', 60);
      if b.nombre is null then err('Ingresá el nombre del barbero.'); end if;
    end if;
    if a.has('especialidad') then b.especialidad := a_txt(a, 'especialidad', 80); end if;
    if a.has('foto') then
      b.foto := a_txt(a, 'foto', 500);
      if b.foto is not null and not regexp_like(b.foto, '^https?://') then err('La foto tiene que ser un link que empiece con http.'); end if;
    end if;
    if a.has('activo') then b.activo := nvl(a_bool(a, 'activo'), 1); end if;
    if a.has('comision') then
      b.comision := a_entero(a, 'comision', 0, 100, 'La comisión por servicios tiene que ser un porcentaje entre 0 y 100.');
    end if;
    if a.has('comision_prod') then
      b.comision_prod := a_entero(a, 'comision_prod', 0, 100, 'La comisión por productos tiene que ser un porcentaje entre 0 y 100.');
    end if;

    if l_id is null then
      insert into tb_barberos (negocio_id, nombre, especialidad, foto, activo, comision, comision_prod)
      values (g_negocio, b.nombre, b.especialidad, b.foto, b.activo, nvl(b.comision, 0), nvl(b.comision_prod, 0));
    else
      update tb_barberos set nombre = b.nombre, especialidad = b.especialidad, foto = b.foto, activo = b.activo,
                             comision = b.comision, comision_prod = b.comision_prod
       where id = l_id and negocio_id = g_negocio;
    end if;
    return 'null';
  end;

  function f_eliminar_barbero(a json_object_t) return clob is
    l_id  number := a_num(a, 'id');
    l_cnt number;
  begin
    select count(*) into l_cnt from tb_turnos where barbero_id = l_id;
    if l_cnt > 0 then err('Tiene turnos registrados: desactivalo en lugar de eliminarlo.'); end if;
    delete from tb_barberos where id = l_id and negocio_id = g_negocio;
    return 'null';
  end;

  function f_guardar_servicio(a json_object_t) return clob is
    l_id number := a_num(a, 'id');
    s    tb_servicios%rowtype;
  begin
    if l_id is not null then
      begin
        select * into s from tb_servicios where id = l_id and negocio_id = g_negocio for update;
      exception
        when no_data_found then err('Servicio no encontrado');
      end;
    else
      s.activo := 1; s.orden := 0;
    end if;
    if a.has('nombre') or l_id is null then
      s.nombre := a_txt(a, 'nombre', 60);
      if s.nombre is null then err('Ingresá el nombre del servicio.'); end if;
    end if;
    if a.has('descripcion') then s.descripcion := a_txt(a, 'descripcion', 200); end if;
    if a.has('duracion') or l_id is null then s.duracion := a_entero(a, 'duracion', 5, 600, 'Duración inválida.'); end if;
    if a.has('precio') or l_id is null then s.precio := a_entero(a, 'precio', 0, 100000000, 'Precio inválido.'); end if;
    if a.has('orden') then s.orden := a_entero(a, 'orden', 0, 9999, 'Orden inválido.'); end if;
    if a.has('activo') then s.activo := nvl(a_bool(a, 'activo'), 1); end if;

    if l_id is null then
      insert into tb_servicios (negocio_id, nombre, descripcion, duracion, precio, activo, orden)
      values (g_negocio, s.nombre, s.descripcion, s.duracion, s.precio, s.activo, s.orden);
    else
      update tb_servicios
         set nombre = s.nombre, descripcion = s.descripcion, duracion = s.duracion, precio = s.precio,
             activo = s.activo, orden = s.orden
       where id = l_id and negocio_id = g_negocio;
    end if;
    return 'null';
  end;

  function f_eliminar_servicio(a json_object_t) return clob is
    l_id  number := a_num(a, 'id');
    l_cnt number;
  begin
    select count(*) into l_cnt from tb_turno_items where servicio_id = l_id;
    if l_cnt > 0 then err('Este servicio tiene turnos registrados: desactivalo en lugar de eliminarlo.'); end if;
    delete from tb_servicios where id = l_id and negocio_id = g_negocio;
    return 'null';
  end;

  /* ================= GESTIÓN DEL LOCAL: stock, compras, gastos y ventas =================
     Mismas reglas que js/db.js (modo demo). Todo filtra por g_negocio (el local de la sesión). */

  /* Texto opcional u obligatorio (p_min > 0), con el mensaje que ve el dueño */
  function t_txt(o json_object_t, k varchar2, p_max pls_integer, p_que varchar2, p_min pls_integer default 0) return varchar2 is
    v varchar2(32767);
  begin
    if tiene(o, k) then
      if o.get(k).is_string then v := trim(o.get_string(k)); else v := trim(o.get(k).to_string); end if;
    end if;
    if nvl(length(v), 0) < p_min then err('Completá ' || p_que || '.'); end if;
    if length(v) > p_max then err('Revisá ' || p_que || ': es demasiado largo (máximo ' || p_max || ' caracteres).'); end if;
    return v;
  end;

  /* Monto en Gs. (entero, sin decimales). p_def: valor si no viene */
  function a_monto(o json_object_t, k varchar2, p_def number default null) return number is
  begin
    if p_def is not null and not tiene(o, k) then return p_def; end if;
    return a_entero(o, k, 0, 100000000, 'Ingresá un monto válido en guaraníes (sin puntos ni decimales).');
  end;

  function fecha_ok(o json_object_t, k varchar2, p_que varchar2) return date is
    d date;
  begin
    begin
      d := a_fecha(o, k);
    exception
      when others then err('Revisá la fecha ' || p_que || '.');
    end;
    if d > hoy then err('La fecha ' || p_que || ' no puede ser futura.'); end if;
    return d;
  end;

  function ruc_ok(p varchar2, p_que varchar2 default 'El RUC o la cédula') return varchar2 is
    r varchar2(100) := replace(trim(p), '.');
  begin
    if r is not null and not regexp_like(r, '^[0-9]{3,9}(-[0-9])?$') then
      err(p_que || ': escribilo sin puntos, ej. 1234567-8 (RUC) o 1234567 (cédula).');
    end if;
    return r;
  end;

  /* Devuelve la forma de pago (null si es a crédito) */
  function pago_ok(p_cond varchar2, p_forma varchar2) return varchar2 is
  begin
    if p_cond is null or p_cond not in ('contado', 'credito') then err('Elegí la condición: contado o crédito.'); end if;
    if p_cond = 'credito' then return null; end if;
    if p_forma is null or instr(c_formas, ',' || p_forma || ',') = 0 then err('Elegí la forma de pago.'); end if;
    return p_forma;
  end;

  procedure rango_ok(p_desde date, p_hasta date) is
  begin
    if p_hasta < p_desde or p_hasta - p_desde > 400 then err('Rango de fechas inválido.'); end if;
  end;

  /* Mueve el stock de un producto y deja el registro con el saldo que queda */
  procedure mover(p_prod number, p_tipo varchar2, p_cant number, p_fecha date, p_ref varchar2, p_nota varchar2) is
    l_saldo number;
  begin
    update tb_productos set stock = stock + p_cant where id = p_prod and negocio_id = g_negocio
    returning stock into l_saldo;
    insert into tb_movimientos (negocio_id, producto_id, fecha, tipo, cantidad, saldo, ref, nota)
    values (g_negocio, p_prod, p_fecha, p_tipo, p_cant, l_saldo, substr(p_ref, 1, 150), substr(p_nota, 1, 150));
  end;

  function doc_producto(p_id number) return clob is
    l clob;
  begin
    select doc into l from tb_v_productos where id = p_id and negocio_id = g_negocio;
    return l;
  end;

  /* ---------- Stock ---------- */
  function f_productos(a json_object_t) return clob is
    l_todos number := nvl(a_bool(a, 'todos'), 0);
    l       clob;
  begin
    select json_arrayagg(doc format json order by lower(nombre) returning clob)
      into l
      from tb_v_productos
     where negocio_id = g_negocio and (l_todos = 1 or activo = 1);
    return nvl(l, '[]');
  end;

  function f_guardar_producto(a json_object_t) return clob is
    l_id  number := a_num(a, 'id');
    p     tb_productos%rowtype;
    l_ini number := 0;
    l_cnt number;
  begin
    if l_id is not null then
      begin
        select * into p from tb_productos where id = l_id and negocio_id = g_negocio for update;
      exception
        when no_data_found then err('Producto no encontrado');
      end;
    else
      p.activo := 1;
    end if;
    if l_id is null or a.has('nombre') then p.nombre := t_txt(a, 'nombre', 60, 'el nombre del producto', 2); end if;
    if l_id is null or a.has('tipo') then
      p.tipo := a_txt(a, 'tipo', 10);
      if p.tipo is null or p.tipo not in ('venta', 'insumo') then err('Elegí si el producto es para vender o de uso interno.'); end if;
    end if;
    if l_id is null or a.has('unidad') then p.unidad := nvl(t_txt(a, 'unidad', 15, 'la unidad'), 'unidad'); end if;
    if l_id is null or a.has('precio') then p.precio := a_monto(a, 'precio', 0); end if;
    if l_id is null or a.has('costo') then p.costo := a_monto(a, 'costo', 0); end if;
    if l_id is null or a.has('minimo') then
      p.minimo := case when tiene(a, 'minimo') then a_entero(a, 'minimo', 0, 99999, 'El stock mínimo tiene que ser un número entero.') else 0 end;
    end if;
    if l_id is null or a.has('iva') then
      p.iva := case when tiene(a, 'iva') then a_num(a, 'iva') else 10 end;
      if p.iva not in (0, 5, 10) then err('Elegí el IVA: 10 %, 5 % o exenta.'); end if;
    end if;
    if a.has('activo') then p.activo := nvl(a_bool(a, 'activo'), 1); end if;

    select count(*) into l_cnt
      from tb_productos
     where negocio_id = g_negocio and id <> nvl(l_id, -1) and lower(nombre) = lower(p.nombre);
    if l_cnt > 0 then err('Ya tenés un producto con ese nombre.'); end if;

    if l_id is not null then
      update tb_productos
         set nombre = p.nombre, tipo = p.tipo, unidad = p.unidad, precio = p.precio, costo = p.costo,
             minimo = p.minimo, iva = p.iva, activo = p.activo
       where id = l_id and negocio_id = g_negocio;
    else
      if tiene(a, 'stock') then l_ini := a_entero(a, 'stock', 0, 99999, 'El stock inicial tiene que ser un número entero.'); end if;
      insert into tb_productos (negocio_id, nombre, tipo, unidad, precio, costo, minimo, iva, stock, activo)
      values (g_negocio, p.nombre, p.tipo, p.unidad, p.precio, p.costo, p.minimo, p.iva, 0, p.activo)
      returning id into l_id;
      if l_ini > 0 then mover(l_id, 'inicial', l_ini, hoy, null, 'Stock inicial'); end if;
    end if;
    return doc_producto(l_id);
  end;

  function f_eliminar_producto(a json_object_t) return clob is
    l_id  number := a_num(a, 'id');
    l_cnt number;
  begin
    select count(*) into l_cnt from tb_movimientos where producto_id = l_id and negocio_id = g_negocio and tipo <> 'inicial';
    if l_cnt > 0 then err('Este producto tiene compras, ventas o ajustes registrados: desactivalo en lugar de eliminarlo.'); end if;
    delete from tb_productos where id = l_id and negocio_id = g_negocio;
    return 'null';
  end;

  /* tipo: uso | perdida (descuentan) · ingreso (suma) · conteo (fija el stock contado) */
  function f_ajustar_stock(a json_object_t) return clob is
    l_id    number := a_num(a, 'id');
    l_tipo  varchar2(10) := a_txt(a, 'tipo', 10);
    p       tb_productos%rowtype;
    l_c     number;
    l_delta number;
  begin
    begin
      select * into p from tb_productos where id = l_id and negocio_id = g_negocio for update;
    exception
      when no_data_found then err('Producto no encontrado');
    end;
    if l_tipo is null or l_tipo not in ('uso', 'perdida', 'ingreso', 'conteo') then err('Elegí el tipo de ajuste.'); end if;
    l_c := a_entero(a, 'cantidad', case when l_tipo = 'conteo' then 0 else 1 end, 99999, 'Ingresá una cantidad válida (número entero).');
    l_delta := case l_tipo when 'conteo' then l_c - p.stock when 'ingreso' then l_c else -l_c end;
    if l_tipo = 'conteo' and l_delta = 0 then err('El stock ya es ' || p.stock || ': no hay nada que ajustar.'); end if;
    if p.stock + l_delta < 0 then err('No podés descontar más de lo que hay (' || p.stock || ').'); end if;
    mover(l_id, l_tipo, l_delta, hoy, null, t_txt(a, 'nota', 120, 'la nota'));
    return doc_producto(l_id);
  end;

  function f_movimientos(a json_object_t) return clob is
    l_id number := a_num(a, 'id');
    l    clob;
  begin
    select json_arrayagg(json_object(
             'id' value id, 'negocio_id' value negocio_id, 'producto_id' value producto_id,
             'fecha' value to_char(fecha, 'YYYY-MM-DD'),
             'en' value to_char(sys_extract_utc(en), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'tipo' value tipo, 'cantidad' value cantidad, 'saldo' value saldo, 'ref' value ref, 'nota' value nota)
             order by id desc returning clob)
      into l
      from tb_movimientos
     where producto_id = l_id and negocio_id = g_negocio;
    return nvl(l, '[]');
  end;

  /* ---------- Compras ---------- */
  function f_compras(a json_object_t) return clob is
    l_desde date := a_fecha(a, 'desde');
    l_hasta date := a_fecha(a, 'hasta');
    l       clob;
  begin
    rango_ok(l_desde, l_hasta);
    select json_arrayagg(doc format json order by fecha desc, id desc returning clob)
      into l
      from tb_v_compras
     where negocio_id = g_negocio and fecha between l_desde and l_hasta;
    return nvl(l, '[]');
  end;

  /* Proveedores ya usados en compras y gastos (para autocompletar) */
  /* Proveedores cargados, con lo que se les compró */
  function f_proveedores return clob is
    l clob;
  begin
    select json_arrayagg(json_object(
             'id' value p.id, 'nombre' value p.nombre, 'ruc' value p.ruc, 'telefono' value p.telefono,
             'contacto' value p.contacto, 'nota' value p.nota,
             'compras' value nvl(c.n, 0), 'total' value nvl(c.total, 0), 'ultima' value to_char(c.ult, 'YYYY-MM-DD'))
             order by lower(p.nombre) returning clob)
      into l
      from tb_proveedores p
      left join (select lower(proveedor) k, count(*) n, sum(total) total, max(fecha) ult
                   from tb_compras where negocio_id = g_negocio and anulada = 0
                  group by lower(proveedor)) c on c.k = lower(p.nombre)
     where p.negocio_id = g_negocio;
    return nvl(l, '[]');
  end;

  function f_guardar_proveedor(a json_object_t) return clob is
    l_id    number := a_num(a, 'id');
    p       tb_proveedores%rowtype;
    l_viejo varchar2(80);
    l_tel   varchar2(30);
  begin
    if l_id is not null then
      begin
        select * into p from tb_proveedores where id = l_id and negocio_id = g_negocio for update;
      exception
        when no_data_found then err('Proveedor no encontrado');
      end;
      l_viejo := p.nombre;
    end if;
    p.nombre   := t_txt(a, 'nombre', 80, 'el nombre del proveedor', 2);
    p.ruc      := ruc_ok(a_txt(a, 'ruc', 30), 'El RUC del proveedor');
    l_tel      := t_txt(a, 'telefono', 30, 'el teléfono');
    if l_tel is not null and length(regexp_replace(l_tel, '[^0-9]')) < 6 then err('Revisá el teléfono del proveedor.'); end if;
    p.telefono := l_tel;
    p.contacto := t_txt(a, 'contacto', 80, 'el nombre del contacto');
    p.nota     := t_txt(a, 'nota', 300, 'la nota');
    begin
      if l_id is null then
        insert into tb_proveedores (negocio_id, nombre, ruc, telefono, contacto, nota)
        values (g_negocio, p.nombre, p.ruc, p.telefono, p.contacto, p.nota)
        returning id into l_id;
      else
        update tb_proveedores set nombre = p.nombre, ruc = p.ruc, telefono = p.telefono, contacto = p.contacto, nota = p.nota
         where id = l_id;
        -- Si cambió el nombre, las compras y gastos anteriores pasan a llamarse igual
        if l_viejo <> p.nombre then
          update tb_compras set proveedor = p.nombre where negocio_id = g_negocio and lower(proveedor) = lower(l_viejo);
          update tb_gastos  set proveedor = p.nombre where negocio_id = g_negocio and lower(proveedor) = lower(l_viejo);
        end if;
      end if;
    exception
      when dup_val_on_index then err('Ya tenés un proveedor con ese nombre.');
    end;
    return '{"id":' || l_id || '}';
  end;

  /* Las compras anteriores no se tocan (guardan el nombre del proveedor) */
  function f_eliminar_proveedor(a json_object_t) return clob is
    l_id number := a_num(a, 'id');
  begin
    delete from tb_proveedores where id = l_id and negocio_id = g_negocio;
    if sql%rowcount = 0 then err('Proveedor no encontrado'); end if;
    return 'null';
  end;

  /* Guarda la compra, suma al stock y actualiza el costo de cada producto */
  function f_crear_compra(a json_object_t) return clob is
    type t_lin  is record (producto_id number, descripcion varchar2(60), cantidad number, precio number, iva number);
    type t_lins is table of t_lin index by pls_integer;
    lin     t_lins;
    l_fecha date := fecha_ok(a, 'fecha', 'de la compra');
    l_prov  varchar2(80) := t_txt(a, 'proveedor', 80, 'el proveedor', 2);
    l_forma varchar2(13);
    l_ruc   varchar2(12);
    l_num   varchar2(20);
    l_nota  varchar2(300);
    items   json_array_t;
    it      json_object_t;
    vistos  t_set;
    p       tb_productos%rowtype;
    l_pid   number;
    l_tot   number := 0;
    l_ex    number := 0;
    l_g5    number := 0;
    l_g10   number := 0;
    m       number;
    l_id    number;
    l       clob;
  begin
    l_forma := pago_ok(a_txt(a, 'condicion', 10), a_txt(a, 'forma_pago', 13));
    l_ruc   := ruc_ok(a_txt(a, 'proveedor_ruc', 30), 'El RUC del proveedor');
    l_num   := t_txt(a, 'numero', 20, 'el número de factura del proveedor');
    l_nota  := t_txt(a, 'nota', 300, 'la nota');
    if not tiene(a, 'items') or not a.get('items').is_array then err('Agregá al menos un producto a la compra.'); end if;
    items := a.get_array('items');
    if items.get_size = 0 then err('Agregá al menos un producto a la compra.'); end if;
    if items.get_size > 40 then err('Una compra puede tener hasta 40 productos.'); end if;

    for i in 0 .. items.get_size - 1 loop
      if not items.get(i).is_object then err('Dato inválido.'); end if;
      it := treat(items.get(i) as json_object_t);
      l_pid := a_num(it, 'producto_id');
      begin
        select * into p from tb_productos where id = l_pid and negocio_id = g_negocio for update;
      exception
        when no_data_found then err('Alguno de los productos ya no existe.');
      end;
      if vistos.exists(to_char(p.id)) then err('«' || p.nombre || '» está dos veces: sumá las cantidades en una sola línea.'); end if;
      vistos(to_char(p.id)) := 1;
      lin(i + 1).producto_id := p.id;
      lin(i + 1).descripcion := p.nombre;
      lin(i + 1).cantidad    := a_entero(it, 'cantidad', 1, 99999, 'Revisá las cantidades (números enteros).');
      lin(i + 1).precio      := a_monto(it, 'costo');
      lin(i + 1).iva         := p.iva;
      m := lin(i + 1).cantidad * lin(i + 1).precio;
      l_tot := l_tot + m;
      if p.iva = 10 then l_g10 := l_g10 + m; elsif p.iva = 5 then l_g5 := l_g5 + m; else l_ex := l_ex + m; end if;
    end loop;

    insert into tb_compras (negocio_id, fecha, proveedor, proveedor_ruc, numero, condicion, forma_pago,
                            total, exenta, grav5, grav10, iva5, iva10, nota)
    values (g_negocio, l_fecha, l_prov, l_ruc, l_num, case when l_forma is null then 'credito' else 'contado' end, l_forma,
            l_tot, l_ex, l_g5, l_g10, round(l_g5 / 21), round(l_g10 / 11), l_nota)
    returning id into l_id;
    for i in 1 .. lin.count loop
      insert into tb_compra_items (compra_id, orden, producto_id, descripcion, cantidad, precio, iva)
      values (l_id, i, lin(i).producto_id, lin(i).descripcion, lin(i).cantidad, lin(i).precio, lin(i).iva);
      mover(lin(i).producto_id, 'compra', lin(i).cantidad, l_fecha,
            'Compra a ' || l_prov || case when l_num is not null then ' · ' || l_num end, null);
      update tb_productos set costo = lin(i).precio where id = lin(i).producto_id;   -- último costo de compra
    end loop;
    -- Un proveedor nuevo queda cargado en Proveedores (y al que no tenía RUC se le completa)
    update tb_proveedores set ruc = nvl(ruc, l_ruc) where negocio_id = g_negocio and lower(nombre) = lower(l_prov);
    if sql%rowcount = 0 then
      insert into tb_proveedores (negocio_id, nombre, ruc) values (g_negocio, l_prov, l_ruc);
    end if;

    select doc into l from tb_v_compras where id = l_id;
    return l;
  end;

  /* Anula una compra cargada por error: descuenta del stock lo que había sumado */
  function f_anular_compra(a json_object_t) return clob is
    l_id  number := a_num(a, 'id');
    c     tb_compras%rowtype;
    l_mot varchar2(200);
    l     clob;
  begin
    begin
      select * into c from tb_compras where id = l_id and negocio_id = g_negocio for update;
    exception
      when no_data_found then err('Compra no encontrada');
    end;
    if c.anulada = 1 then err('Esta compra ya está anulada.'); end if;
    l_mot := t_txt(a, 'motivo', 200, 'el motivo');
    for r in (select i.cantidad, p.stock, p.nombre
                from tb_compra_items i join tb_productos p on p.id = i.producto_id
               where i.compra_id = l_id
                 for update of p.stock) loop
      if r.stock < r.cantidad then
        err('No se puede anular: de «' || r.nombre || '» ya se usó o vendió parte (quedan ' || r.stock || ' de ' || r.cantidad || ').');
      end if;
    end loop;
    for r in (select producto_id, cantidad from tb_compra_items where compra_id = l_id) loop
      mover(r.producto_id, 'anulacion', -r.cantidad, hoy, 'Anulación de compra a ' || c.proveedor, null);
    end loop;
    update tb_compras set anulada = 1, anulada_motivo = l_mot, anulada_en = systimestamp where id = l_id;
    select doc into l from tb_v_compras where id = l_id;
    return l;
  end;

  /* ---------- Gastos ---------- */
  function f_gastos(a json_object_t) return clob is
    l_desde date := a_fecha(a, 'desde');
    l_hasta date := a_fecha(a, 'hasta');
    l       clob;
  begin
    rango_ok(l_desde, l_hasta);
    select json_arrayagg(doc format json order by fecha desc, id desc returning clob)
      into l
      from tb_v_gastos
     where negocio_id = g_negocio and fecha between l_desde and l_hasta;
    return nvl(l, '[]');
  end;

  function f_guardar_gasto(a json_object_t) return clob is
    l_id    number := a_num(a, 'id');
    l_cat   varchar2(40) := a_txt(a, 'categoria', 40);
    l_cond  varchar2(10) := nvl(a_txt(a, 'condicion', 10), 'contado');
    l_monto number;
    l_fecha date;
    l_desc  varchar2(120);
    l_forma varchar2(13);
    l_prov  varchar2(80);
    l_comp  varchar2(30);
    l       clob;
  begin
    if l_cat is null then err('Elegí la categoría del gasto.'); end if;
    l_monto := a_monto(a, 'monto');
    if l_monto = 0 then err('Ingresá el monto del gasto.'); end if;
    l_fecha := fecha_ok(a, 'fecha', 'del gasto');
    l_desc  := t_txt(a, 'descripcion', 120, 'la descripción', 2);
    l_forma := pago_ok(l_cond, a_txt(a, 'forma_pago', 13));
    l_prov  := t_txt(a, 'proveedor', 80, 'el proveedor');
    l_comp  := t_txt(a, 'comprobante', 30, 'el comprobante');
    if l_id is not null then
      update tb_gastos
         set fecha = l_fecha, categoria = l_cat, descripcion = l_desc, monto = l_monto, condicion = l_cond,
             forma_pago = l_forma, proveedor = l_prov, comprobante = l_comp
       where id = l_id and negocio_id = g_negocio;
      if sql%rowcount = 0 then err('Gasto no encontrado'); end if;
    else
      insert into tb_gastos (negocio_id, fecha, categoria, descripcion, monto, condicion, forma_pago, proveedor, comprobante)
      values (g_negocio, l_fecha, l_cat, l_desc, l_monto, l_cond, l_forma, l_prov, l_comp)
      returning id into l_id;
    end if;
    select doc into l from tb_v_gastos where id = l_id;
    return l;
  end;

  function f_eliminar_gasto(a json_object_t) return clob is
    l_id number := a_num(a, 'id');
  begin
    delete from tb_gastos where id = l_id and negocio_id = g_negocio;
    if sql%rowcount = 0 then err('Gasto no encontrado'); end if;
    return 'null';
  end;

  /* ---------- Ventas y facturación ---------- */
  function doc_venta(p_id varchar2) return clob is
    l clob;
  begin
    select doc into l from tb_v_ventas where id = p_id and negocio_id = g_negocio;
    return l;
  exception
    when no_data_found then err('Comprobante no encontrado'); return null;
  end;

  function f_ventas(a json_object_t) return clob is
    l_desde date := a_fecha(a, 'desde');
    l_hasta date := a_fecha(a, 'hasta');
    l       clob;
  begin
    rango_ok(l_desde, l_hasta);
    select json_arrayagg(doc format json order by fecha desc, hora desc, creado_en desc returning clob)
      into l
      from tb_v_ventas
     where negocio_id = g_negocio and fecha between l_desde and l_hasta;
    return nvl(l, '[]');
  end;

  /* Cobra servicios y/o productos: descuenta stock y emite factura (con timbrado) o ticket interno.
     Devuelve {venta, factura} (factura = datos del timbrado con el próximo número actualizado) */
  function f_crear_venta(a json_object_t) return clob is
    type t_lin  is record (tipo varchar2(8), ref_id number, descripcion varchar2(60), cantidad number, precio number, iva number);
    type t_lins is table of t_lin index by pls_integer;
    lin      t_lins;
    porp     t_set;                       -- cantidad pedida por producto (puede estar en varias líneas)
    n        tb_negocios%rowtype;
    f        tb_facturacion%rowtype;
    t        tb_turnos%rowtype;
    sv       tb_servicios%rowtype;
    p        tb_productos%rowtype;
    items    json_array_t;
    it       json_object_t;
    tj       json_object_t;
    res      json_object_t := json_object_t();
    l_fecha  date;
    l_tipo   varchar2(10);
    l_ref    number;
    l_k      varchar2(40);
    l_cnt    number;
    l_turno  varchar2(32);
    l_bar    number;
    l_barnom varchar2(60);
    l_cond   varchar2(10) := nvl(a_txt(a, 'condicion', 10), 'contado');
    l_forma  varchar2(13);
    l_doc    varchar2(7) := 'ticket';
    l_num    varchar2(20);
    l_timnro varchar2(8);
    l_tim    clob;
    l_ultima date;
    l_hora   varchar2(5);
    l_min    number;
    l_cli    varchar2(100);
    l_ruc    varchar2(12);
    l_nota   varchar2(300);
    l_tot    number := 0;
    l_ex     number := 0;
    l_g5     number := 0;
    l_g10    number := 0;
    m        number;
    l_id     varchar2(32);
    l_fj     clob;
    l_sub    number;          -- suma de las líneas
    l_desc   number;          -- descuento (Gs.)
    l_prop   number;          -- propina (no se factura)
    d_ex     number;
    d_g5     number;
    d_g10    number;
    l_dif    number;
    l_cliid  number;
    l_tel    varchar2(30);
  begin
    -- Bloquea el local: dos cobros al mismo tiempo no pueden tomar el mismo número
    select * into n from tb_negocios where id = g_negocio for update;
    l_fecha := case when tiene(a, 'fecha') then fecha_ok(a, 'fecha', 'de la venta') else hoy end;

    if not tiene(a, 'items') or not a.get('items').is_array then err('Agregá al menos un servicio o producto.'); end if;
    items := a.get_array('items');
    if items.get_size = 0 then err('Agregá al menos un servicio o producto.'); end if;
    if items.get_size > 30 then err('Un comprobante puede tener hasta 30 líneas.'); end if;

    for i in 0 .. items.get_size - 1 loop
      if not items.get(i).is_object then err('Dato inválido.'); end if;
      it := treat(items.get(i) as json_object_t);
      lin(i + 1).cantidad := a_entero(it, 'cantidad', 1, 999, 'Revisá las cantidades (números enteros).');
      lin(i + 1).precio   := a_monto(it, 'precio');
      l_tipo := a_txt(it, 'tipo', 10);
      l_ref  := a_num(it, 'id');
      if l_tipo = 'servicio' then
        begin
          select * into sv from tb_servicios where id = l_ref and negocio_id = g_negocio;
        exception
          when no_data_found then err('Alguno de los servicios ya no existe.');
        end;
        lin(i + 1).tipo := 'servicio'; lin(i + 1).ref_id := sv.id; lin(i + 1).descripcion := sv.nombre; lin(i + 1).iva := 10;
      elsif l_tipo = 'producto' then
        begin
          select * into p from tb_productos where id = l_ref and negocio_id = g_negocio and tipo = 'venta';
        exception
          when no_data_found then err('Alguno de los productos ya no está disponible.');
        end;
        lin(i + 1).tipo := 'producto'; lin(i + 1).ref_id := p.id; lin(i + 1).descripcion := p.nombre; lin(i + 1).iva := p.iva;
        l_k := to_char(p.id);
        porp(l_k) := case when porp.exists(l_k) then porp(l_k) else 0 end + lin(i + 1).cantidad;
      else
        err('Alguno de los productos ya no está disponible.');
      end if;
      m := lin(i + 1).cantidad * lin(i + 1).precio;
      l_tot := l_tot + m;
      if lin(i + 1).iva = 10 then l_g10 := l_g10 + m; elsif lin(i + 1).iva = 5 then l_g5 := l_g5 + m; else l_ex := l_ex + m; end if;
    end loop;

    -- Descuento: se reparte en proporción entre exentas, 5 % y 10 % (así el IVA sale sobre lo cobrado)
    l_sub  := l_tot;
    l_desc := a_monto(a, 'descuento', 0);
    if l_desc > 0 then
      if l_desc >= l_sub then err('El descuento tiene que ser menor que el total.'); end if;
      d_ex  := round(l_desc * l_ex / l_sub);
      d_g5  := round(l_desc * l_g5 / l_sub);
      d_g10 := round(l_desc * l_g10 / l_sub);
      l_dif := l_desc - d_ex - d_g5 - d_g10;          -- lo que quedó por redondeo va al grupo más grande
      if l_g10 >= l_g5 and l_g10 >= l_ex then d_g10 := d_g10 + l_dif;
      elsif l_g5 >= l_ex then d_g5 := d_g5 + l_dif;
      else d_ex := d_ex + l_dif; end if;
      l_ex := l_ex - d_ex; l_g5 := l_g5 - d_g5; l_g10 := l_g10 - d_g10;
      l_tot := l_sub - l_desc;
    end if;

    -- Stock suficiente (bloqueando cada producto hasta terminar)
    l_k := porp.first;
    while l_k is not null loop
      l_ref := to_number(l_k);
      select * into p from tb_productos where id = l_ref for update;
      if p.stock < porp(l_k) then
        err('No hay stock suficiente de «' || p.nombre || '» (quedan ' || p.stock || '). Cargá la compra o ajustá el stock.');
      end if;
      l_k := porp.next(l_k);
    end loop;

    if tiene(a, 'turno_id') then
      l_turno := a_txt(a, 'turno_id', 32);
      begin
        select * into t from tb_turnos where id = l_turno and negocio_id = g_negocio for update;
      exception
        when no_data_found then err('Turno no encontrado');
      end;
      select count(*) into l_cnt from tb_ventas where turno_id = t.id and anulada = 0;
      if l_cnt > 0 then err('Ese turno ya está cobrado.'); end if;
    end if;

    if tiene(a, 'barbero_id') then
      l_bar := a_num(a, 'barbero_id');
      begin
        select nombre into l_barnom from tb_barberos where id = l_bar and negocio_id = g_negocio;
      exception
        when no_data_found then err('Barbero no encontrado');
      end;
    end if;

    l_forma := pago_ok(l_cond, a_txt(a, 'forma_pago', 13));

    -- Propina: para el barbero, cobrada junto con la venta (no va en la factura)
    l_prop := a_monto(a, 'propina', 0);
    if l_prop > 0 and l_bar is null then err('Elegí el barbero que recibe la propina.'); end if;
    if l_prop > 0 and l_cond = 'credito' then err('La propina se registra solo en ventas al contado.'); end if;

    if nvl(a_bool(a, 'factura'), 0) = 1 then
      begin
        select * into f from tb_facturacion where negocio_id = g_negocio for update;
      exception
        when no_data_found then err('Para emitir facturas, primero cargá los datos de tu timbrado (Ventas → Timbrado).');
      end;
      if l_fecha < f.desde or l_fecha > f.hasta then
        err('La fecha está fuera de la vigencia de tu timbrado (' || to_char(f.desde, 'DD/MM/YYYY') || ' al ' || to_char(f.hasta, 'DD/MM/YYYY') || ').');
      end if;
      select max(fecha) into l_ultima from tb_ventas where negocio_id = g_negocio and tipo = 'factura';
      if l_fecha < l_ultima then err('La fecha de una factura no puede ser anterior a la de la última factura emitida.'); end if;
      if f.proximo > 9999999 then err('Se terminó la numeración de este punto de expedición. Cargá un timbrado nuevo.'); end if;
      l_doc    := 'factura';
      l_num    := f.establecimiento || '-' || f.punto || '-' || lpad(to_char(f.proximo), 7, '0');
      l_timnro := f.timbrado;
      -- "Foto" de los datos fiscales: si mañana cambia el timbrado, esta factura se sigue viendo igual
      tj := json_object_t();
      tj.put('numero', f.timbrado);
      tj.put('desde', iso(f.desde));
      tj.put('hasta', iso(f.hasta));
      tj.put('ruc', f.ruc);
      tj.put('razon_social', f.razon_social);
      tj.put('actividad', f.actividad);
      tj.put('direccion', nvl(f.direccion, n.direccion));
      tj.put('telefono', nvl(f.telefono, n.whatsapp));
      tj.put('nombre_fantasia', n.nombre);
      l_tim := tj.to_clob;
      update tb_facturacion set proximo = proximo + 1 where negocio_id = g_negocio;
    else
      l_num := 'T-' || lpad(to_char(n.ticket_prox), 6, '0');
      update tb_negocios set ticket_prox = ticket_prox + 1 where id = g_negocio;
    end if;

    l_hora := a_txt(a, 'hora', 5);
    if l_hora is null then l_hora := to_char(ahora, 'HH24:MI'); else l_min := hmin(l_hora); end if;
    l_cli  := nvl(t_txt(a, 'cliente_nombre', 100, 'el nombre del cliente'), 'Sin nombre');
    l_ruc  := ruc_ok(a_txt(a, 'cliente_ruc', 30));
    l_nota := t_txt(a, 'nota', 300, 'la nota');

    -- Cliente: el elegido en la lista, el del turno, o uno nuevo si se cargó su RUC
    if tiene(a, 'cliente_id') then
      l_cliid := a_num(a, 'cliente_id');
      select count(*) into l_cnt from tb_clientes where id = l_cliid and negocio_id = g_negocio;
      if l_cnt = 0 then err('Cliente no encontrado.'); end if;
      if l_ruc is not null and l_ruc <> '44444401-7' then update tb_clientes set ruc = nvl(ruc, l_ruc) where id = l_cliid; end if;
    elsif t.id is not null then
      l_cliid := t.cliente_id;
    end if;
    if l_cliid is null and l_ruc is not null then l_cliid := cliente_para(g_negocio, l_cli, null, l_ruc); end if;
    l_tel := t.cliente_telefono;
    if l_tel is null and l_cliid is not null then select telefono into l_tel from tb_clientes where id = l_cliid; end if;

    insert into tb_ventas (negocio_id, fecha, hora, tipo, numero, timbrado_nro, timbrado, cliente_nombre, cliente_ruc,
                           cliente_telefono, condicion, forma_pago, barbero_id, barbero_nombre, turno_id,
                           subtotal, descuento, propina, cliente_id,
                           total, exenta, grav5, grav10, iva5, iva10, nota)
    values (g_negocio, l_fecha, l_hora, l_doc, l_num, l_timnro, l_tim, l_cli, l_ruc,
            l_tel, l_cond, l_forma, l_bar, l_barnom, t.id,
            l_sub, l_desc, l_prop, l_cliid,
            l_tot, l_ex, l_g5, l_g10, round(l_g5 / 21), round(l_g10 / 11), l_nota)
    returning id into l_id;
    for i in 1 .. lin.count loop
      insert into tb_venta_items (venta_id, orden, tipo, ref_id, descripcion, cantidad, precio, iva)
      values (l_id, i, lin(i).tipo, lin(i).ref_id, lin(i).descripcion, lin(i).cantidad, lin(i).precio, lin(i).iva);
      if lin(i).tipo = 'producto' then
        mover(lin(i).ref_id, 'venta', -lin(i).cantidad, l_fecha, case l_doc when 'factura' then 'Factura ' else 'Ticket ' end || l_num, null);
      end if;
    end loop;

    res.put('venta', json_object_t.parse(doc_venta(l_id)));
    l_fj := factura_json(g_negocio);
    if l_fj is null then res.put_null('factura'); else res.put('factura', json_object_t.parse(l_fj)); end if;
    return res.to_clob;
  end;

  /* La factura anulada conserva su número (así lo pide la numeración correlativa); el stock vuelve */
  function f_anular_venta(a json_object_t) return clob is
    l_id  varchar2(32) := a_txt(a, 'id', 32);
    v     tb_ventas%rowtype;
    l_mot varchar2(200);
    l_cnt number;
  begin
    begin
      select * into v from tb_ventas where id = l_id and negocio_id = g_negocio for update;
    exception
      when no_data_found then err('Comprobante no encontrado');
    end;
    if v.anulada = 1 then err('Este comprobante ya está anulado.'); end if;
    l_mot := t_txt(a, 'motivo', 200, 'el motivo de la anulación', 3);
    for r in (select ref_id, cantidad from tb_venta_items where venta_id = l_id and tipo = 'producto') loop
      select count(*) into l_cnt from tb_productos where id = r.ref_id and negocio_id = g_negocio;
      if l_cnt > 0 then
        mover(r.ref_id, 'anulacion', r.cantidad, hoy, 'Anulación ' || v.tipo || ' ' || v.numero, null);
      end if;
    end loop;
    update tb_ventas set anulada = 1, anulada_motivo = l_mot, anulada_en = systimestamp where id = l_id;
    return doc_venta(l_id);
  end;

  /* Datos del timbrado (los carga el dueño desde Ventas → Timbrado) */
  function f_guardar_facturacion(a json_object_t) return clob is
    f      tb_facturacion%rowtype;
    l_pref varchar2(10);
    l_ult  number;
  begin
    f.razon_social    := t_txt(a, 'razon_social', 100, 'la razón social', 2);
    f.ruc             := ruc_ok(a_txt(a, 'ruc', 30), 'El RUC');
    f.actividad       := t_txt(a, 'actividad', 120, 'la actividad económica');
    f.timbrado        := t_txt(a, 'timbrado', 20, 'el número de timbrado');
    f.establecimiento := t_txt(a, 'establecimiento', 10, 'el establecimiento');
    f.punto           := t_txt(a, 'punto', 10, 'el punto de expedición');
    f.proximo         := a_entero(a, 'proximo', 1, 9999999, 'El próximo número de factura tiene que ser un número entre 1 y 9.999.999.');
    f.direccion       := t_txt(a, 'direccion', 120, 'la dirección');
    f.telefono        := t_txt(a, 'telefono', 30, 'el teléfono');
    if f.ruc is null or not regexp_like(f.ruc, '^[0-9]+-[0-9]$') then err('El RUC tiene que tener el dígito verificador, ej. 80012345-6.'); end if;
    if f.timbrado is null or not regexp_like(f.timbrado, '^[0-9]{8}$') then err('El número de timbrado tiene 8 dígitos.'); end if;
    begin
      f.desde := a_fecha(a, 'desde');
      f.hasta := a_fecha(a, 'hasta');
    exception
      when others then err('Revisá la vigencia del timbrado: el fin tiene que ser después del inicio.');
    end;
    if f.hasta < f.desde then err('Revisá la vigencia del timbrado: el fin tiene que ser después del inicio.'); end if;
    if not regexp_like(nvl(f.establecimiento, 'x'), '^[0-9]{3}$') or not regexp_like(nvl(f.punto, 'x'), '^[0-9]{3}$') then
      err('El establecimiento y el punto de expedición tienen 3 dígitos (ej. 001).');
    end if;

    -- No se puede volver atrás en la numeración del mismo timbrado
    l_pref := f.establecimiento || '-' || f.punto || '-';
    select max(to_number(substr(numero, 9))) into l_ult
      from tb_ventas
     where negocio_id = g_negocio and tipo = 'factura' and timbrado_nro = f.timbrado and numero like l_pref || '%';
    if f.proximo <= nvl(l_ult, 0) then
      err('Con este timbrado ya emitiste hasta la ' || l_pref || lpad(to_char(l_ult), 7, '0') || ': el próximo número tiene que ser mayor.');
    end if;

    merge into tb_facturacion x
    using (select g_negocio negocio_id from dual) s
       on (x.negocio_id = s.negocio_id)
     when matched then update
          set razon_social = f.razon_social, ruc = f.ruc, actividad = f.actividad, timbrado = f.timbrado,
              desde = f.desde, hasta = f.hasta, establecimiento = f.establecimiento, punto = f.punto,
              proximo = f.proximo, direccion = f.direccion, telefono = f.telefono
     when not matched then insert (negocio_id, razon_social, ruc, actividad, timbrado, desde, hasta,
                                   establecimiento, punto, proximo, direccion, telefono)
          values (g_negocio, f.razon_social, f.ruc, f.actividad, f.timbrado, f.desde, f.hasta,
                  f.establecimiento, f.punto, f.proximo, f.direccion, f.telefono);
    return factura_json(g_negocio);
  end;

  /* ================= SUPERADMIN ================= */
  function f_super_login(a json_object_t) return clob is
    l_email varchar2(200) := lower(a_txt(a, 'email', 200));
    l_clave varchar2(200);
    r       tb_superadmins%rowtype;
  begin
    if tiene(a, 'password') then l_clave := a.get_string('password'); end if;
    begin
      select * into r from tb_superadmins where email = l_email for update;
    exception
      when no_data_found then err('Email o contraseña incorrectos.');
    end;
    if r.bloqueado_hasta > systimestamp then err('Demasiados intentos. Probá de nuevo en 15 minutos.'); end if;
    if hash_clave(l_clave, r.clave_sal) <> r.clave_hash then
      update tb_superadmins
         set intentos        = case when intentos + 1 >= 5 then 0 else intentos + 1 end,
             bloqueado_hasta = case when intentos + 1 >= 5 then systimestamp + interval '15' minute end
       where id = r.id;
      commit;
      err('Email o contraseña incorrectos.');
    end if;
    update tb_superadmins set intentos = 0, bloqueado_hasta = null where id = r.id;
    return '{"token":"' || nuevo_token('super', null, r.id) || '"}';
  end;

  function f_super_negocios return clob is
    arr    json_array_t := json_array_t();
    o      json_object_t;
    l_hoy  date := hoy;
    l_des  date := hoy - 30;
  begin
    for r in (
      select n.id,
             (select count(*) from tb_barberos b where b.negocio_id = n.id and b.activo = 1) barberos,
             (select count(*) from tb_servicios s where s.negocio_id = n.id and s.activo = 1) servicios,
             (select count(*) from tb_turnos t
               where t.negocio_id = n.id and t.estado <> 'cancelado' and t.fecha between l_des and l_hoy) turnos30,
             (select count(*) from tb_turnos t
               where t.negocio_id = n.id and t.estado <> 'cancelado'
                 and (t.fecha > l_hoy or (t.fecha = l_hoy and t.estado in ('pendiente', 'confirmado')))) proximos
        from tb_negocios n
       order by upper(n.nombre)
    ) loop
      o := json_object_t.parse(negocio_json(r.id, 1));
      o.put('barberos', r.barberos);
      o.put('servicios', r.servicios);
      o.put('turnos30', r.turnos30);
      o.put('proximos', r.proximos);
      arr.append(o);
    end loop;
    return arr.to_clob;
  end;

  function crear_miembro(p_neg number, p_email varchar2) return varchar2 is
    l_clave varchar2(10) := clave_temporal;
    l_sal   raw(16) := dbms_crypto.randombytes(16);
    l_hash  raw(32) := hash_clave(l_clave, l_sal);
  begin
    insert into tb_miembros (negocio_id, email, clave_hash, clave_sal) values (p_neg, p_email, l_hash, l_sal);
    return l_clave;
  end;

  function f_super_crear_negocio(a json_object_t) return clob is
    l_nombre varchar2(60) := a_txt(a, 'nombre', 60);
    l_slug   varchar2(40) := lower(a_txt(a, 'slug', 40));
    l_email  varchar2(120);
    l_vence  date;
    l_precio number := c_precio;
    l_cnt    number;
    l_id     number;
    l_clave  varchar2(10);
    o        json_object_t;
  begin
    if l_nombre is null or length(l_nombre) < 2 then err('Ingresá el nombre del local.'); end if;
    validar_slug(l_slug, null);
    l_email := validar_email(a_txt(a, 'dueno', 200));
    select count(*) into l_cnt from tb_miembros where email = l_email;
    if l_cnt > 0 then err('Ese email ya es dueño de otro local.'); end if;
    if tiene(a, 'vence_el') then l_vence := a_fecha(a, 'vence_el'); end if;
    if tiene(a, 'precio') then
      l_precio := a_entero(a, 'precio', 0, 100000000, 'Ingresá un monto válido en guaraníes (sin puntos ni decimales).');
    end if;

    insert into tb_negocios (slug, nombre, nombre_corto, horario, vence_el, precio)
    values (l_slug, l_nombre, regexp_substr(l_nombre, '^\S+(\s+\S+)?'), c_horario_base, l_vence, l_precio)
    returning id into l_id;
    l_clave := crear_miembro(l_id, l_email);

    o := json_object_t.parse(negocio_json(l_id, 1));
    o.put('clave_temporal', l_clave);
    return o.to_clob;
  end;

  function f_super_guardar_negocio(a json_object_t) return clob is
    l_id    number := a_num(a, 'id');
    c       json_object_t;
    n       tb_negocios%rowtype;
    l_email varchar2(120);
    l_mid   number;
    l_mail0 varchar2(120);
    l_cnt   number;
    l_clave varchar2(10);
    o       json_object_t;
  begin
    if not tiene(a, 'cambios') or not a.get('cambios').is_object then err('Datos inválidos.'); end if;
    c := a.get_object('cambios');
    begin
      select * into n from tb_negocios where id = l_id for update;
    exception
      when no_data_found then err('Local no encontrado');
    end;
    if c.has('nombre') then
      n.nombre := a_txt(c, 'nombre', 60);
      if n.nombre is null or length(n.nombre) < 2 then err('Ingresá el nombre del local.'); end if;
    end if;
    if c.has('slug') then
      n.slug := lower(a_txt(c, 'slug', 40));
      validar_slug(n.slug, l_id);
    end if;
    if c.has('vence_el') then
      n.vence_el := case when tiene(c, 'vence_el') then a_fecha(c, 'vence_el') end;
    end if;
    if c.has('activo') then n.activo := nvl(a_bool(c, 'activo'), 1); end if;
    if c.has('precio') then
      n.precio := a_entero(c, 'precio', 0, 100000000, 'Ingresá un monto válido en guaraníes (sin puntos ni decimales).');
    end if;
    if c.has('dueno') then
      l_email := validar_email(a_txt(c, 'dueno', 200));
      select count(*) into l_cnt from tb_miembros where email = l_email and negocio_id <> l_id;
      if l_cnt > 0 then err('Ese email ya es dueño de otro local.'); end if;
      begin
        select id, email into l_mid, l_mail0 from tb_miembros where negocio_id = l_id fetch first 1 row only;
      exception
        when no_data_found then l_mid := null;
      end;
      if l_mid is null then
        l_clave := crear_miembro(l_id, l_email);
      elsif l_mail0 <> l_email then
        update tb_miembros set email = l_email where id = l_mid;
        delete from tb_sesiones where miembro_id = l_mid;
      end if;
    end if;

    update tb_negocios
       set nombre = n.nombre, slug = n.slug, vence_el = n.vence_el, activo = n.activo, precio = n.precio
     where id = l_id;

    o := json_object_t.parse(negocio_json(l_id, 1));
    if l_clave is not null then o.put('clave_temporal', l_clave); end if;
    return o.to_clob;
  end;

  function f_super_reset_clave(a json_object_t) return clob is
    l_neg   number := a_num(a, 'id');
    l_mid   number;
    l_clave varchar2(10) := clave_temporal;
    l_sal   raw(16) := dbms_crypto.randombytes(16);
    l_hash  raw(32);
  begin
    begin
      select id into l_mid from tb_miembros where negocio_id = l_neg fetch first 1 row only;
    exception
      when no_data_found then err('Ese local no tiene dueño cargado.');
    end;
    l_hash := hash_clave(l_clave, l_sal);
    update tb_miembros set clave_hash = l_hash, clave_sal = l_sal, intentos = 0, bloqueado_hasta = null where id = l_mid;
    delete from tb_sesiones where miembro_id = l_mid;
    return '{"clave":"' || l_clave || '"}';
  end;

  function f_super_registrar_pago(a json_object_t) return clob is
    l_id     number := a_num(a, 'id');
    l_monto  number := a_entero(a, 'monto', 0, 100000000, 'Ingresá un monto válido en guaraníes (sin puntos ni decimales).');
    l_meses  number := a_entero(a, 'meses', 1, 24, 'Elegí cuántos meses paga.');
    l_fecha  date;
    l_desde  date;
    l_hasta  date;
    l_vence  date;
    l_pid    number;
    p        json_object_t := json_object_t();
    o        json_object_t := json_object_t();
  begin
    l_fecha := case when tiene(a, 'fecha') then a_fecha(a, 'fecha') else hoy end;
    if l_fecha > hoy then err('La fecha del pago no puede ser futura.'); end if;
    begin
      select vence_el into l_vence from tb_negocios where id = l_id for update;
    exception
      when no_data_found then err('Local no encontrado');
    end;
    l_desde := case when l_vence is null or l_vence < hoy then hoy else l_vence end;
    l_hasta := sumar_meses(l_desde, l_meses);
    insert into tb_pagos (negocio_id, fecha, monto, meses, desde, hasta)
    values (l_id, l_fecha, l_monto, l_meses, l_desde, l_hasta)
    returning id into l_pid;
    update tb_negocios set vence_el = l_hasta, activo = 1 where id = l_id;

    p.put('id', l_pid); p.put('negocio_id', l_id); p.put('fecha', iso(l_fecha)); p.put('monto', l_monto);
    p.put('meses', l_meses); p.put('desde', iso(l_desde)); p.put('hasta', iso(l_hasta));
    o.put('pago', p);
    o.put('negocio', json_object_t.parse(negocio_json(l_id, 1)));
    return o.to_clob;
  end;

  function f_super_pagos return clob is
    l clob;
  begin
    select json_arrayagg(json_object(
             'id' value p.id, 'negocio_id' value p.negocio_id, 'local' value n.nombre,
             'fecha' value to_char(p.fecha, 'YYYY-MM-DD'), 'monto' value p.monto, 'meses' value p.meses,
             'desde' value to_char(p.desde, 'YYYY-MM-DD'), 'hasta' value to_char(p.hasta, 'YYYY-MM-DD'))
             order by p.fecha desc, p.id desc returning clob)
      into l
      from tb_pagos p
      join tb_negocios n on n.id = p.negocio_id;
    return nvl(l, '[]');
  end;

  function f_super_eliminar_pago(a json_object_t) return clob is
    l_id number := a_num(a, 'id');
  begin
    delete from tb_pagos where id = l_id;
    if sql%rowcount = 0 then err('Pago no encontrado'); end if;
    return 'null';
  end;

  /* ================= CLIENTES ================= */
  /* Lista con lo que hizo cada uno: visitas (turnos atendidos + ventas sin turno), lo gastado y la última visita */
  function f_clientes return clob is
    l     clob;
    l_hoy date := hoy;
  begin
    select json_arrayagg(json_object(
             'id' value c.id, 'nombre' value c.nombre, 'telefono' value c.telefono, 'ruc' value c.ruc, 'nota' value c.nota,
             'visitas' value nvl(tv.n, 0) + nvl(vv.n_sin, 0),
             'gastado' value nvl(vv.total, 0),
             'ultima'  value to_char(case when tv.ult is null then vv.ult when vv.ult is null then tv.ult
                                          else greatest(tv.ult, vv.ult) end, 'YYYY-MM-DD'),
             'proximo' value to_char(tp.prox, 'YYYY-MM-DD'))
             order by lower(c.nombre) returning clob)
      into l
      from tb_clientes c
      left join (select cliente_id, count(*) n, max(fecha) ult from tb_turnos
                  where negocio_id = g_negocio and estado = 'completado' group by cliente_id) tv on tv.cliente_id = c.id
      left join (select cliente_id, sum(total) total, sum(case when turno_id is null then 1 else 0 end) n_sin, max(fecha) ult
                   from tb_ventas where negocio_id = g_negocio and anulada = 0 group by cliente_id) vv on vv.cliente_id = c.id
      left join (select cliente_id, min(fecha) prox from tb_turnos
                  where negocio_id = g_negocio and estado in ('pendiente', 'confirmado') and fecha >= l_hoy
                  group by cliente_id) tp on tp.cliente_id = c.id
     where c.negocio_id = g_negocio;
    return nvl(l, '[]');
  end;

  /* Un cliente con su historial de turnos y comprobantes */
  function f_cliente(a json_object_t) return clob is
    l_id number := a_num(a, 'id');
    l    clob;
  begin
    select json_object(
             'cliente' value json_object('id' value c.id, 'nombre' value c.nombre, 'telefono' value c.telefono,
                                         'ruc' value c.ruc, 'nota' value c.nota,
                                         'creado_en' value to_char(sys_extract_utc(c.creado_en), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
             'turnos' value (select json_arrayagg(json_object(
                                      'id' value t.id, 'fecha' value to_char(t.fecha, 'YYYY-MM-DD'), 'hora' value t.hora,
                                      'estado' value t.estado, 'precio' value t.precio, 'duracion' value t.duracion,
                                      'barbero' value json_object('nombre' value b.nombre),
                                      'items' value (select json_arrayagg(json_object('servicio_id' value i.servicio_id, 'nombre' value i.nombre,
                                                             'precio' value i.precio, 'duracion' value i.duracion, 'orden' value i.orden)
                                                             order by i.orden returning clob)
                                                       from tb_turno_items i where i.turno_id = t.id) format json
                                      returning clob) order by t.fecha desc, t.ini_min desc returning clob)
                               from tb_turnos t
                               left join tb_barberos b on b.id = t.barbero_id
                              where t.cliente_id = c.id and t.negocio_id = g_negocio) format json,
             'ventas' value (select json_arrayagg(v.doc format json order by v.fecha desc, v.hora desc returning clob)
                               from tb_v_ventas v
                              where v.cliente_id = c.id and v.negocio_id = g_negocio) format json
             returning clob)
      into l
      from tb_clientes c
     where c.id = l_id and c.negocio_id = g_negocio;
    return l;
  exception
    when no_data_found then err('Cliente no encontrado'); return null;
  end;

  function f_guardar_cliente(a json_object_t) return clob is
    l_id  number := a_num(a, 'id');
    c     tb_clientes%rowtype;
    l_cnt number;
  begin
    if l_id is not null then
      begin
        select * into c from tb_clientes where id = l_id and negocio_id = g_negocio for update;
      exception
        when no_data_found then err('Cliente no encontrado');
      end;
    end if;
    c.nombre   := t_txt(a, 'nombre', 100, 'el nombre del cliente', 2);
    c.telefono := t_txt(a, 'telefono', 30, 'el celular');
    c.tel_key  := tel_key(c.telefono);
    if c.telefono is not null and c.tel_key is null then err('Revisá el celular: tiene que tener al menos 6 números.'); end if;
    c.ruc      := ruc_ok(a_txt(a, 'ruc', 30));
    c.nota     := t_txt(a, 'nota', 300, 'la nota');
    if c.tel_key is not null then
      select count(*) into l_cnt from tb_clientes
       where negocio_id = g_negocio and tel_key = c.tel_key and id <> nvl(l_id, -1);
      if l_cnt > 0 then err('Ya hay otro cliente con ese celular.'); end if;
    end if;
    if l_id is null then
      insert into tb_clientes (negocio_id, nombre, telefono, tel_key, ruc, nota)
      values (g_negocio, c.nombre, c.telefono, c.tel_key, c.ruc, c.nota)
      returning id into l_id;
    else
      update tb_clientes set nombre = c.nombre, telefono = c.telefono, tel_key = c.tel_key, ruc = c.ruc, nota = c.nota
       where id = l_id;
    end if;
    return '{"id":' || l_id || '}';
  end;

  /* ================= BLOQUEOS DE HORARIOS ================= */
  function bloqueo_doc(p_id number) return clob is
    l clob;
  begin
    select json_object(
             'id' value k.id, 'barbero_id' value k.barbero_id, 'barbero_nombre' value b.nombre,
             'desde' value to_char(k.desde, 'YYYY-MM-DD'), 'hasta' value to_char(k.hasta, 'YYYY-MM-DD'),
             'hora_desde' value case when k.ini_min is not null then
                                  to_char(trunc(k.ini_min / 60), 'FM00') || ':' || to_char(mod(k.ini_min, 60), 'FM00') end,
             'hora_hasta' value case when k.fin_min is not null then
                                  to_char(trunc(k.fin_min / 60), 'FM00') || ':' || to_char(mod(k.fin_min, 60), 'FM00') end,
             'motivo' value k.motivo
             returning clob)
      into l
      from tb_bloqueos k
      left join tb_barberos b on b.id = k.barbero_id
     where k.id = p_id;
    return l;
  end;

  /* Bloqueos que tocan el rango (por defecto, de hoy en adelante) */
  function f_bloqueos(a json_object_t) return clob is
    l_desde date := case when tiene(a, 'desde') then a_fecha(a, 'desde') else hoy end;
    l_hasta date := case when tiene(a, 'hasta') then a_fecha(a, 'hasta') else l_desde + 3650 end;
    l       clob;
  begin
    select json_arrayagg(json_object(
             'id' value k.id, 'barbero_id' value k.barbero_id, 'barbero_nombre' value b.nombre,
             'desde' value to_char(k.desde, 'YYYY-MM-DD'), 'hasta' value to_char(k.hasta, 'YYYY-MM-DD'),
             'hora_desde' value case when k.ini_min is not null then
                                  to_char(trunc(k.ini_min / 60), 'FM00') || ':' || to_char(mod(k.ini_min, 60), 'FM00') end,
             'hora_hasta' value case when k.fin_min is not null then
                                  to_char(trunc(k.fin_min / 60), 'FM00') || ':' || to_char(mod(k.fin_min, 60), 'FM00') end,
             'motivo' value k.motivo)
             order by k.desde, k.ini_min nulls first returning clob)
      into l
      from tb_bloqueos k
      left join tb_barberos b on b.id = k.barbero_id
     where k.negocio_id = g_negocio and k.hasta >= l_desde and k.desde <= l_hasta;
    return nvl(l, '[]');
  end;

  /* Devuelve {bloqueo, turnos}: turnos = cuántos turnos activos quedan dentro (no se cancelan solos) */
  function f_guardar_bloqueo(a json_object_t) return clob is
    l_bar   number := a_num(a, 'barbero_id');
    l_desde date   := a_fecha(a, 'desde');
    l_hasta date   := a_fecha(a, 'hasta');
    l_hd    varchar2(5) := a_txt(a, 'hora_desde', 5);
    l_hh    varchar2(5) := a_txt(a, 'hora_hasta', 5);
    l_ini   number;
    l_fin   number;
    l_mot   varchar2(80) := t_txt(a, 'motivo', 80, 'el motivo');
    l_cnt   number;
    l_id    number;
  begin
    if l_bar is not null then
      select count(*) into l_cnt from tb_barberos where id = l_bar and negocio_id = g_negocio;
      if l_cnt = 0 then err('Barbero no encontrado'); end if;
    end if;
    if l_hasta < l_desde then err('La fecha «hasta» tiene que ser igual o posterior a «desde».'); end if;
    if l_hasta < hoy then err('Ese período ya pasó.'); end if;
    if l_hasta - l_desde > 366 then err('Un bloqueo puede durar hasta un año.'); end if;
    if (l_hd is null) <> (l_hh is null) then err('Poné la hora de inicio y la de fin, o marcá «Todo el día».'); end if;
    if l_hd is not null then
      l_ini := hmin(l_hd);
      l_fin := case when l_hh = '24:00' then 1440 else hmin(l_hh) end;
      if l_fin <= l_ini then err('La hora de fin tiene que ser después de la de inicio.'); end if;
    end if;
    insert into tb_bloqueos (negocio_id, barbero_id, desde, hasta, ini_min, fin_min, motivo)
    values (g_negocio, l_bar, l_desde, l_hasta, l_ini, l_fin, l_mot)
    returning id into l_id;
    select count(*) into l_cnt
      from tb_turnos
     where negocio_id = g_negocio and estado in ('pendiente', 'confirmado')
       and fecha between l_desde and l_hasta
       and (l_bar is null or barbero_id = l_bar)
       and (l_ini is null or (ini_min < l_fin and l_ini < ini_min + duracion));
    return '{"bloqueo":' || bloqueo_doc(l_id) || ',"turnos":' || l_cnt || '}';
  end;

  function f_eliminar_bloqueo(a json_object_t) return clob is
    l_id number := a_num(a, 'id');
  begin
    delete from tb_bloqueos where id = l_id and negocio_id = g_negocio;
    if sql%rowcount = 0 then err('Bloqueo no encontrado'); end if;
    return 'null';
  end;

  /* ================= PUNTO DE ENTRADA ================= */
  function rpc(p_body in clob) return clob is
    req  json_object_t;
    a    json_object_t;
    fn   varchar2(40);
    tok  varchar2(100);
    l_data clob;
    res    json_object_t;
  begin
    begin
      req := json_object_t.parse(p_body);
    exception
      when others then err('Pedido inválido.');
    end;
    fn  := substr(req.get_string('fn'), 1, 40);
    tok := substr(req.get_string('token'), 1, 100);
    if tiene(req, 'args') and req.get('args').is_object then a := req.get_object('args'); else a := json_object_t(); end if;

    -- Sesión requerida
    if fn in ('mi_negocio', 'guardar_negocio', 'cambiar_clave', 'turnos', 'crear_turno', 'actualizar_turno',
              'guardar_barbero', 'eliminar_barbero', 'guardar_servicio', 'eliminar_servicio',
              'productos', 'guardar_producto', 'eliminar_producto', 'ajustar_stock', 'movimientos',
              'compras', 'proveedores', 'crear_compra', 'anular_compra', 'gastos', 'guardar_gasto', 'eliminar_gasto',
              'ventas', 'venta', 'crear_venta', 'anular_venta', 'guardar_facturacion',
              'guardar_proveedor', 'eliminar_proveedor', 'clientes', 'cliente', 'guardar_cliente',
              'bloqueos', 'guardar_bloqueo', 'eliminar_bloqueo') then
      cargar_sesion(tok, 'dueno');
    elsif fn like 'super%' and fn <> 'super_login' then
      cargar_sesion(tok, 'super');
    end if;

    if    fn = 'negocio_por_slug'      then l_data :=f_negocio_por_slug(a);
    elsif fn = 'servicios'             then l_data :=f_servicios(a, tok);
    elsif fn = 'barberos'              then l_data :=f_barberos(a, tok);
    elsif fn = 'ocupados'              then l_data :=f_ocupados(a);
    elsif fn = 'reservar'              then l_data :=f_reservar(a);
    elsif fn = 'mi_turno'              then l_data :=f_mi_turno(a);
    elsif fn = 'cancelar_turno'        then l_data :=f_cancelar_turno(a);
    elsif fn = 'reprogramar_turno'     then l_data :=f_reprogramar_turno(a);
    elsif fn = 'login'                 then l_data :=f_login(a);
    elsif fn = 'logout'                then cerrar_sesion(tok); l_data :='null';
    elsif fn = 'mi_negocio'            then l_data :=negocio_json(g_negocio, 1);
    elsif fn = 'guardar_negocio'       then l_data :=f_guardar_negocio(a);
    elsif fn = 'cambiar_clave'         then l_data :=f_cambiar_clave(a);
    elsif fn = 'turnos'                then l_data :=f_turnos(a);
    elsif fn = 'crear_turno'           then l_data :=f_crear_turno(a);
    elsif fn = 'actualizar_turno'      then l_data :=f_actualizar_turno(a);
    elsif fn = 'guardar_barbero'       then l_data :=f_guardar_barbero(a);
    elsif fn = 'eliminar_barbero'      then l_data :=f_eliminar_barbero(a);
    elsif fn = 'guardar_servicio'      then l_data :=f_guardar_servicio(a);
    elsif fn = 'eliminar_servicio'     then l_data :=f_eliminar_servicio(a);
    elsif fn = 'productos'             then l_data :=f_productos(a);
    elsif fn = 'guardar_producto'      then l_data :=f_guardar_producto(a);
    elsif fn = 'eliminar_producto'     then l_data :=f_eliminar_producto(a);
    elsif fn = 'ajustar_stock'         then l_data :=f_ajustar_stock(a);
    elsif fn = 'movimientos'           then l_data :=f_movimientos(a);
    elsif fn = 'compras'               then l_data :=f_compras(a);
    elsif fn = 'proveedores'           then l_data :=f_proveedores;
    elsif fn = 'crear_compra'          then l_data :=f_crear_compra(a);
    elsif fn = 'anular_compra'         then l_data :=f_anular_compra(a);
    elsif fn = 'gastos'                then l_data :=f_gastos(a);
    elsif fn = 'guardar_gasto'         then l_data :=f_guardar_gasto(a);
    elsif fn = 'eliminar_gasto'        then l_data :=f_eliminar_gasto(a);
    elsif fn = 'ventas'                then l_data :=f_ventas(a);
    elsif fn = 'venta'                 then l_data :=doc_venta(a_txt(a, 'id', 32));
    elsif fn = 'crear_venta'           then l_data :=f_crear_venta(a);
    elsif fn = 'anular_venta'          then l_data :=f_anular_venta(a);
    elsif fn = 'guardar_facturacion'   then l_data :=f_guardar_facturacion(a);
    elsif fn = 'guardar_proveedor'     then l_data :=f_guardar_proveedor(a);
    elsif fn = 'eliminar_proveedor'    then l_data :=f_eliminar_proveedor(a);
    elsif fn = 'clientes'              then l_data :=f_clientes;
    elsif fn = 'cliente'               then l_data :=f_cliente(a);
    elsif fn = 'guardar_cliente'       then l_data :=f_guardar_cliente(a);
    elsif fn = 'bloqueos'              then l_data :=f_bloqueos(a);
    elsif fn = 'guardar_bloqueo'       then l_data :=f_guardar_bloqueo(a);
    elsif fn = 'eliminar_bloqueo'      then l_data :=f_eliminar_bloqueo(a);
    elsif fn = 'super_login'           then l_data :=f_super_login(a);
    elsif fn = 'super_logout'          then cerrar_sesion(tok); l_data :='null';
    elsif fn = 'super_ping'            then l_data :='true';
    elsif fn = 'super_negocios'        then l_data :=f_super_negocios;
    elsif fn = 'super_crear_negocio'   then l_data :=f_super_crear_negocio(a);
    elsif fn = 'super_guardar_negocio' then l_data :=f_super_guardar_negocio(a);
    elsif fn = 'super_reset_clave'     then l_data :=f_super_reset_clave(a);
    elsif fn = 'super_registrar_pago'  then l_data :=f_super_registrar_pago(a);
    elsif fn = 'super_pagos'           then l_data :=f_super_pagos;
    elsif fn = 'super_eliminar_pago'   then l_data :=f_super_eliminar_pago(a);
    else err('Función desconocida.');
    end if;

    commit;
    return '{"ok":true,"data":' || nvl(l_data, 'null') || '}';
  exception
    when others then
      declare
        l_code number         := sqlcode;
        l_msg  varchar2(4000) := sqlerrm;
        l_pila varchar2(4000) := dbms_utility.format_error_backtrace;
      begin
        rollback;
        res := json_object_t();
        res.put('ok', false);
        if l_code = -20002 then
          res.put('sesion', false);
          res.put('error', 'Tu sesión terminó. Volvé a ingresar.');
        elsif l_code = -20001 then
          res.put('error', regexp_replace(regexp_substr(l_msg, '^[^' || chr(10) || ']*'), '^ORA-20001: '));
        elsif l_code = -1 then
          res.put('error', 'Ese dato ya existe (puede que alguien lo haya cargado recién). Probá de nuevo.');
        else
          log_error(fn, l_msg, l_pila);
          res.put('error', 'Ocurrió un error en el servidor. Probá de nuevo en un momento.');
        end if;
        return res.to_clob;
      end;
  end rpc;

  /* ================= MANTENIMIENTO ================= */
  procedure crear_superadmin(p_email in varchar2, p_clave in varchar2) is
    l_email varchar2(120) := lower(trim(p_email));
    l_sal   raw(16) := dbms_crypto.randombytes(16);
    l_hash  raw(32);
  begin
    if l_email is null or not regexp_like(l_email, '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
      raise_application_error(-20001, 'Email inválido');
    end if;
    validar_clave(p_clave);
    l_hash := hash_clave(p_clave, l_sal);
    merge into tb_superadmins s
    using (select l_email email from dual) x
       on (s.email = x.email)
     when matched then update set clave_hash = l_hash, clave_sal = l_sal, intentos = 0, bloqueado_hasta = null
     when not matched then insert (email, clave_hash, clave_sal) values (l_email, l_hash, l_sal);
  end;

end tb_api;
/
