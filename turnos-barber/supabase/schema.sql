-- ============================================================
--  CONTROL DE TURNOS · BARBERÍA  —  Esquema para Supabase (v2)
--  Instalación nueva: pegalo completo en Supabase > SQL Editor > New query > Run
--  Si ya tenías cargada la versión anterior (un servicio por turno),
--  usá supabase/migrar_v2.sql en lugar de este archivo.
-- ============================================================

create extension if not exists btree_gist;

-- ---------- Tablas ----------
create table if not exists servicios (
  id          bigint generated always as identity primary key,
  nombre      text not null,
  descripcion text,
  duracion    int  not null check (duracion between 5 and 480),  -- minutos
  precio      int  not null default 0 check (precio >= 0),        -- guaraníes
  activo      boolean not null default true,
  orden       int not null default 0
);

create table if not exists barberos (
  id           bigint generated always as identity primary key,
  nombre       text not null,
  especialidad text,
  foto         text,          -- URL opcional
  activo       boolean not null default true
);

create table if not exists turnos (
  id               uuid primary key default gen_random_uuid(),
  codigo           text not null default upper(substr(md5(random()::text), 1, 6)),
  barbero_id     bigint not null references barberos(id),
  fecha            date not null,
  hora             time not null,
  duracion         int  not null check (duracion > 0),        -- suma de los servicios (min)
  precio           int  not null default 0 check (precio >= 0), -- suma al momento de reservar (Gs.)
  cliente_nombre   text not null check (char_length(cliente_nombre) between 2 and 80),
  cliente_telefono text not null check (char_length(cliente_telefono) between 6 and 20),
  nota             text check (char_length(nota) <= 300),
  estado           text not null default 'pendiente'
                   check (estado in ('pendiente','confirmado','completado','ausente','cancelado')),
  origen           text not null default 'web' check (origen in ('web','local')),
  creado_en        timestamptz not null default now(),
  -- La base de datos impide que un barbero tenga dos turnos superpuestos
  constraint sin_superposicion exclude using gist (
    barbero_id with =,
    tsrange(fecha + hora, fecha + hora + make_interval(mins => duracion)) with &&
  ) where (estado <> 'cancelado')
);
create index if not exists turnos_fecha_idx on turnos (fecha);

-- Servicios de cada turno (un turno puede tener varios: ej. corte + manicura).
-- Guarda nombre, precio y duración del momento de la reserva: si después cambia
-- el precio del servicio, los turnos ya hechos no se modifican.
create table if not exists turno_servicios (
  turno_id    uuid   not null references turnos(id) on delete cascade,
  servicio_id bigint not null references servicios(id),
  orden       int    not null default 0,
  nombre      text   not null,
  precio      int    not null default 0,
  duracion    int    not null,
  primary key (turno_id, servicio_id)
);
create index if not exists turno_servicios_servicio_idx on turno_servicios (servicio_id);

-- Usuarios con acceso al panel (se agregan a mano, ver README)
create table if not exists admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- ---------- Funciones ----------
create or replace function es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

-- Horarios tomados de un día (sin datos personales: es lo único que ve el público)
create or replace function horarios_ocupados(p_fecha date)
returns table (barbero_id bigint, hora time, duracion int)
language sql stable security definer set search_path = public as $$
  select t.barbero_id, t.hora, t.duracion
  from turnos t
  where t.fecha = p_fecha and t.estado <> 'cancelado';
$$;

-- Núcleo común: crea un turno con uno o varios servicios (uso interno).
create or replace function _crear_turno(
  p_servicio_ids bigint[], p_barbero_id bigint, p_fecha date, p_hora time,
  p_nombre text, p_telefono text, p_nota text, p_estado text, p_origen text
) returns table (out_codigo text, out_barbero_id bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_dur int; v_precio int; v_cant int; v_barbero bigint; v_codigo text; v_id uuid;
  v_ini timestamp := p_fecha + p_hora;
begin
  if p_servicio_ids is null or cardinality(p_servicio_ids) = 0 then
    raise exception 'Elegí al menos un servicio.';
  end if;
  if cardinality(p_servicio_ids) > 6 then raise exception 'Podés elegir hasta 6 servicios por turno.'; end if;

  select sum(s.duracion), sum(s.precio), count(*) into v_dur, v_precio, v_cant
  from servicios s where s.id = any(p_servicio_ids) and s.activo;
  if v_cant <> (select count(distinct x) from unnest(p_servicio_ids) x) then
    raise exception 'Alguno de los servicios elegidos ya no está disponible.';
  end if;

  if p_barbero_id is null then
    -- "Sin preferencia": se asigna un barbero libre al azar
    select b.id into v_barbero
    from barberos b
    where b.activo and not exists (
      select 1 from turnos t
      where t.barbero_id = b.id and t.estado <> 'cancelado'
        and tsrange(t.fecha + t.hora, t.fecha + t.hora + make_interval(mins => t.duracion))
            && tsrange(v_ini, v_ini + make_interval(mins => v_dur)))
    order by random() limit 1;
    if v_barbero is null then raise exception 'Ese horario se acaba de ocupar. Elegí otro.'; end if;
  else
    select b.id into v_barbero from barberos b where b.id = p_barbero_id and b.activo;
    if v_barbero is null then raise exception 'El barbero elegido no está disponible.'; end if;
  end if;

  insert into turnos (barbero_id, fecha, hora, duracion, precio,
                      cliente_nombre, cliente_telefono, nota, estado, origen)
  values (v_barbero, p_fecha, p_hora, v_dur, v_precio,
          trim(p_nombre), trim(p_telefono), nullif(trim(coalesce(p_nota, '')), ''), p_estado, p_origen)
  returning turnos.id, turnos.codigo into v_id, v_codigo;

  insert into turno_servicios (turno_id, servicio_id, orden, nombre, precio, duracion)
  select v_id, s.id, x.ord, s.nombre, s.precio, s.duracion
  from unnest(p_servicio_ids) with ordinality as x(id, ord)
  join servicios s on s.id = x.id;

  return query select v_codigo, v_barbero;
exception
  when exclusion_violation then
    raise exception 'Ese horario ya está ocupado. Elegí otro.';
  when check_violation then
    raise exception 'Revisá el nombre y el número de celular.';
  when unique_violation then
    raise exception 'Hay un servicio repetido.';
end;
$$;

-- Reserva pública (clientes). Valida fecha y horario del lado del servidor.
create or replace function reservar_turno(
  p_servicio_ids bigint[], p_barbero_id bigint, p_fecha date, p_hora time,
  p_nombre text, p_telefono text, p_nota text default null
) returns table (out_codigo text, out_barbero_id bigint)
language plpgsql security definer set search_path = public as $$
begin
  if p_fecha + p_hora < (now() at time zone 'America/Asuncion') then
    raise exception 'Ese horario ya pasó. Elegí otro.';
  end if;
  if p_fecha > (now() at time zone 'America/Asuncion')::date + 60 then
    raise exception 'Fecha demasiado lejana.';
  end if;
  return query select * from _crear_turno(p_servicio_ids, p_barbero_id, p_fecha, p_hora,
                                          p_nombre, p_telefono, p_nota, 'pendiente', 'web');
end;
$$;

-- Carga manual desde el panel (solo administradores).
create or replace function crear_turno_admin(
  p_servicio_ids bigint[], p_barbero_id bigint, p_fecha date, p_hora time,
  p_nombre text, p_telefono text, p_nota text default null
) returns table (out_codigo text, out_barbero_id bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Sin permiso.'; end if;
  return query select * from _crear_turno(p_servicio_ids, p_barbero_id, p_fecha, p_hora,
                                          p_nombre, p_telefono, p_nota, 'confirmado', 'local');
end;
$$;

revoke all on function _crear_turno(bigint[],bigint,date,time,text,text,text,text,text) from public, anon, authenticated;
revoke all on function reservar_turno(bigint[],bigint,date,time,text,text,text) from public;
revoke all on function crear_turno_admin(bigint[],bigint,date,time,text,text,text) from public;
revoke all on function horarios_ocupados(date) from public;
grant execute on function reservar_turno(bigint[],bigint,date,time,text,text,text) to anon, authenticated;
grant execute on function crear_turno_admin(bigint[],bigint,date,time,text,text,text) to authenticated;
grant execute on function horarios_ocupados(date) to anon, authenticated;
grant execute on function es_admin() to authenticated;

-- ---------- Seguridad (RLS) ----------
alter table servicios enable row level security;
alter table barberos  enable row level security;
alter table turnos    enable row level security;
alter table turno_servicios enable row level security;
alter table admins    enable row level security;

drop policy if exists "publico ve servicios activos" on servicios;
drop policy if exists "admin gestiona servicios"     on servicios;
drop policy if exists "publico ve barberos activos"  on barberos;
drop policy if exists "admin gestiona barberos"      on barberos;
drop policy if exists "admin gestiona turnos"        on turnos;
drop policy if exists "admin gestiona turno_servicios" on turno_servicios;
drop policy if exists "admin se ve a si mismo"       on admins;

create policy "publico ve servicios activos" on servicios for select using (activo);
create policy "admin gestiona servicios"     on servicios for all to authenticated using (es_admin()) with check (es_admin());
create policy "publico ve barberos activos"  on barberos  for select using (activo);
create policy "admin gestiona barberos"      on barberos  for all to authenticated using (es_admin()) with check (es_admin());
-- Turnos: el público NO puede leerlos ni escribirlos directo (solo vía reservar_turno)
create policy "admin gestiona turnos"        on turnos    for all to authenticated using (es_admin()) with check (es_admin());
create policy "admin gestiona turno_servicios" on turno_servicios for all to authenticated using (es_admin()) with check (es_admin());
create policy "admin se ve a si mismo"       on admins    for select to authenticated using (user_id = auth.uid());

-- ---------- Datos iniciales (editalos a gusto) ----------
insert into servicios (nombre, descripcion, duracion, precio, orden)
select * from (values
  ('Corte clásico',      'Tijera y máquina, lavado incluido.',              30, 50000, 1),
  ('Fade / Degradé',     'Degradé a navaja con terminación prolija.',       45, 60000, 2),
  ('Barba',              'Perfilado, toalla caliente y aceites.',           30, 40000, 3),
  ('Corte niño',         'Hasta 12 años.',                                  30, 40000, 4),
  ('Perfilado de cejas', 'Con navaja o pinza.',                             15, 15000, 5),
  ('Lavado y peinado',   'Lavado, masaje capilar y productos de styling.',  15, 20000, 6)
) v where not exists (select 1 from servicios);

insert into barberos (nombre, especialidad)
select * from (values
  ('Diego',  'Fades y diseños'),
  ('Matías', 'Barba y clásicos'),
  ('Lucas',  'Cortes modernos')
) v where not exists (select 1 from barberos);
