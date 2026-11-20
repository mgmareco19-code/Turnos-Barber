/* ============================================================
   02 · Correr como TURNOS
   Tablas. Todo lo de cada barbería cuelga de tb_negocios (negocio_id).
   ============================================================ */

create table tb_negocios (
  id                 number generated always as identity primary key,
  slug               varchar2(40)  not null constraint tb_negocios_slug_uk unique,
  nombre             varchar2(60)  not null,
  nombre_corto       varchar2(40),
  logo               clob,                         -- imagen chica en data URL (webp, ~10-40 KB)
  logo_solo          number(1)     default 0  not null check (logo_solo in (0, 1)),
  whatsapp           varchar2(20),
  direccion          varchar2(150),
  horario            clob          not null check (horario is json),  -- {"0":null,"1":["09:00","20:00"],...} 0 = domingo
  intervalo          number(3)     default 30 not null,
  dias_anticipacion  number(3)     default 21 not null,
  margen_minutos     number(4)     default 30 not null,
  activo             number(1)     default 1  not null check (activo in (0, 1)),
  vence_el           date,
  precio             number(12)    not null check (precio >= 0),        -- abono mensual en Gs.
  creado_en          timestamp with time zone default systimestamp not null
);

-- Dueño de cada local (con este email entra al panel)
create table tb_miembros (
  id               number generated always as identity primary key,
  negocio_id       number        not null references tb_negocios on delete cascade,
  email            varchar2(120) not null constraint tb_miembros_email_uk unique,
  clave_hash       raw(32)       not null,
  clave_sal        raw(16)       not null,
  intentos         number(3)     default 0 not null,
  bloqueado_hasta  timestamp with time zone,
  creado_en        timestamp with time zone default systimestamp not null
);
create index tb_miembros_neg_ix on tb_miembros (negocio_id);

-- Vos (la plataforma)
create table tb_superadmins (
  id               number generated always as identity primary key,
  email            varchar2(120) not null constraint tb_superadmins_email_uk unique,
  clave_hash       raw(32)       not null,
  clave_sal        raw(16)       not null,
  intentos         number(3)     default 0 not null,
  bloqueado_hasta  timestamp with time zone
);

-- Sesiones abiertas (se guarda el hash del token, nunca el token)
create table tb_sesiones (
  token_hash  raw(32)      primary key,
  tipo        varchar2(6)  not null check (tipo in ('dueno', 'super')),
  miembro_id  number       references tb_miembros on delete cascade,
  super_id    number       references tb_superadmins on delete cascade,
  expira      timestamp with time zone not null,
  creado_en   timestamp with time zone default systimestamp not null
);
create index tb_sesiones_exp_ix on tb_sesiones (expira);

create table tb_barberos (
  id            number generated always as identity primary key,
  negocio_id    number        not null references tb_negocios on delete cascade,
  nombre        varchar2(60)  not null,
  especialidad  varchar2(80),
  foto          varchar2(500),
  activo        number(1)     default 1 not null check (activo in (0, 1)),
  creado_en     timestamp with time zone default systimestamp not null
);
create index tb_barberos_neg_ix on tb_barberos (negocio_id);

create table tb_servicios (
  id           number generated always as identity primary key,
  negocio_id   number        not null references tb_negocios on delete cascade,
  nombre       varchar2(60)  not null,
  descripcion  varchar2(200),
  duracion     number(4)     not null check (duracion between 5 and 600),
  precio       number(12)    not null check (precio >= 0),
  activo       number(1)     default 1 not null check (activo in (0, 1)),
  orden        number(4)     default 0 not null
);
create index tb_servicios_neg_ix on tb_servicios (negocio_id);

create table tb_turnos (
  id                varchar2(32)  default lower(rawtohex(sys_guid())) primary key,
  negocio_id        number        not null references tb_negocios on delete cascade,
  codigo            varchar2(8)   not null,
  barbero_id        number        not null references tb_barberos,
  fecha             date          not null,
  hora              varchar2(5)   not null,               -- "HH:MI"
  ini_min           number(4)     not null,               -- minutos desde las 00:00 (para buscar choques)
  duracion          number(4)     not null,
  precio            number(12)    not null,
  cliente_nombre    varchar2(80)  not null,
  cliente_telefono  varchar2(30)  not null,
  nota              varchar2(300),
  estado            varchar2(12)  default 'pendiente' not null
                    check (estado in ('pendiente', 'confirmado', 'completado', 'ausente', 'cancelado')),
  origen            varchar2(6)   not null check (origen in ('web', 'local')),
  creado_en         timestamp with time zone default systimestamp not null
);
create index tb_turnos_neg_fecha_ix on tb_turnos (negocio_id, fecha);
create index tb_turnos_bar_fecha_ix on tb_turnos (barbero_id, fecha);

-- Servicios de cada turno ("foto" del nombre/precio/duración al momento de reservar)
create table tb_turno_items (
  turno_id     varchar2(32)  not null references tb_turnos on delete cascade,
  orden        number(2)     not null,
  servicio_id  number        not null references tb_servicios,
  nombre       varchar2(60)  not null,
  precio       number(12)    not null,
  duracion     number(4)     not null,
  constraint tb_turno_items_pk primary key (turno_id, orden)
);
create index tb_turno_items_serv_ix on tb_turno_items (servicio_id);

-- Cobros del abono
create table tb_pagos (
  id          number generated always as identity primary key,
  negocio_id  number      not null references tb_negocios on delete cascade,
  fecha       date        not null,
  monto       number(12)  not null check (monto >= 0),
  meses       number(2)   not null check (meses between 1 and 24),
  desde       date        not null,
  hasta       date        not null,
  creado_en   timestamp with time zone default systimestamp not null
);
create index tb_pagos_neg_ix on tb_pagos (negocio_id);
create index tb_pagos_fecha_ix on tb_pagos (fecha);

-- Errores inesperados de la API (para revisar vos)
create table tb_errores (
  id      number generated always as identity primary key,
  fn      varchar2(40),
  error   varchar2(4000),
  pila    varchar2(4000),
  en      timestamp with time zone default systimestamp not null
);
