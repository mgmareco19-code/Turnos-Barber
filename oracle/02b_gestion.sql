/* ============================================================
   02b · Correr como TURNOS (después de 02_tablas.sql y ANTES de 03_paquete.sql)
   Gestión del local: timbrado, stock, compras, gastos y ventas.

   ¿Ya tenías la base instalada? Corré este archivo una vez y después
   volvé a correr 03_paquete.sql. Los turnos y locales no se tocan.
   ============================================================ */

-- Numeración de los tickets internos (T-000001…) de cada local
alter table tb_negocios add (ticket_prox number(9) default 1 not null);

-- Datos del timbrado de cada local (los carga el dueño en Ventas → Timbrado)
create table tb_facturacion (
  negocio_id       number        primary key references tb_negocios on delete cascade,
  razon_social     varchar2(100) not null,
  ruc              varchar2(12)  not null,
  actividad        varchar2(120),
  timbrado         varchar2(8)   not null,
  desde            date          not null,
  hasta            date          not null,
  establecimiento  varchar2(3)   not null,
  punto            varchar2(3)   not null,
  proximo          number(8)     not null check (proximo between 1 and 10000000),  -- 10000000 = numeración terminada
  direccion        varchar2(120),
  telefono         varchar2(30)
);

/* ---------------- Stock ---------------- */
create table tb_productos (
  id          number generated always as identity primary key,
  negocio_id  number        not null references tb_negocios on delete cascade,
  nombre      varchar2(60)  not null,
  tipo        varchar2(6)   not null check (tipo in ('venta', 'insumo')),
  unidad      varchar2(15)  default 'unidad' not null,
  precio      number(12)    default 0 not null check (precio >= 0),
  costo       number(12)    default 0 not null check (costo >= 0),
  minimo      number(5)     default 0 not null check (minimo >= 0),
  iva         number(2)     default 10 not null check (iva in (0, 5, 10)),
  stock       number(7)     default 0 not null check (stock >= 0),
  activo      number(1)     default 1 not null check (activo in (0, 1)),
  creado_en   timestamp with time zone default systimestamp not null
);
create unique index tb_productos_nombre_uk on tb_productos (negocio_id, lower(nombre));

-- Cada entrada o salida de stock, con el saldo que quedó
create table tb_movimientos (
  id           number generated always as identity primary key,
  negocio_id   number        not null references tb_negocios on delete cascade,
  producto_id  number        not null references tb_productos on delete cascade,
  fecha        date          not null,
  en           timestamp with time zone default systimestamp not null,
  tipo         varchar2(10)  not null check (tipo in ('inicial', 'compra', 'venta', 'uso', 'perdida', 'ingreso', 'conteo', 'anulacion')),
  cantidad     number(7)     not null,
  saldo        number(7)     not null,
  ref          varchar2(150),
  nota         varchar2(150)
);
create index tb_movimientos_prod_ix on tb_movimientos (producto_id);

/* ---------------- Compras ---------------- */
create table tb_compras (
  id              number generated always as identity primary key,
  negocio_id      number        not null references tb_negocios on delete cascade,
  fecha           date          not null,
  proveedor       varchar2(80)  not null,
  proveedor_ruc   varchar2(12),
  numero          varchar2(20),
  condicion       varchar2(7)   not null check (condicion in ('contado', 'credito')),
  forma_pago      varchar2(13),
  total           number(14)    not null,
  exenta          number(14)    not null,
  grav5           number(14)    not null,
  grav10          number(14)    not null,
  iva5            number(14)    not null,
  iva10           number(14)    not null,
  nota            varchar2(300),
  anulada         number(1)     default 0 not null check (anulada in (0, 1)),
  anulada_motivo  varchar2(200),
  anulada_en      timestamp with time zone,
  creado_en       timestamp with time zone default systimestamp not null
);
create index tb_compras_neg_fecha_ix on tb_compras (negocio_id, fecha);

create table tb_compra_items (
  compra_id    number        not null references tb_compras on delete cascade,
  orden        number(2)     not null,
  producto_id  number        not null references tb_productos on delete cascade,
  descripcion  varchar2(60)  not null,
  cantidad     number(5)     not null,
  precio       number(12)    not null,
  iva          number(2)     not null,
  constraint tb_compra_items_pk primary key (compra_id, orden)
);

/* ---------------- Gastos ---------------- */
create table tb_gastos (
  id           number generated always as identity primary key,
  negocio_id   number        not null references tb_negocios on delete cascade,
  fecha        date          not null,
  categoria    varchar2(40)  not null,
  descripcion  varchar2(120) not null,
  monto        number(12)    not null check (monto > 0),
  condicion    varchar2(7)   default 'contado' not null check (condicion in ('contado', 'credito')),
  forma_pago   varchar2(13),
  proveedor    varchar2(80),
  comprobante  varchar2(30),
  creado_en    timestamp with time zone default systimestamp not null
);
create index tb_gastos_neg_fecha_ix on tb_gastos (negocio_id, fecha);

/* ---------------- Ventas (factura o ticket interno) ---------------- */
create table tb_ventas (
  id                varchar2(32)  default lower(rawtohex(sys_guid())) primary key,
  negocio_id        number        not null references tb_negocios on delete cascade,
  fecha             date          not null,
  hora              varchar2(5)   not null,
  tipo              varchar2(7)   not null check (tipo in ('ticket', 'factura')),
  numero            varchar2(20)  not null,
  timbrado_nro      varchar2(8),
  timbrado          clob          check (timbrado is json),   -- "foto" de los datos fiscales al emitir
  cliente_nombre    varchar2(100) not null,
  cliente_ruc       varchar2(12),
  cliente_telefono  varchar2(30),
  condicion         varchar2(7)   not null check (condicion in ('contado', 'credito')),
  forma_pago        varchar2(13),
  barbero_id        number        references tb_barberos on delete set null,
  barbero_nombre    varchar2(60),
  turno_id          varchar2(32)  references tb_turnos on delete set null,
  total             number(14)    not null,
  exenta            number(14)    not null,
  grav5             number(14)    not null,
  grav10            number(14)    not null,
  iva5              number(14)    not null,
  iva10             number(14)    not null,
  nota              varchar2(300),
  anulada           number(1)     default 0 not null check (anulada in (0, 1)),
  anulada_motivo    varchar2(200),
  anulada_en        timestamp with time zone,
  creado_en         timestamp with time zone default systimestamp not null
);
create index tb_ventas_neg_fecha_ix on tb_ventas (negocio_id, fecha);
create index tb_ventas_turno_ix on tb_ventas (turno_id);
-- Un número de comprobante no se repite (las anuladas también lo conservan)
create unique index tb_ventas_numero_uk on tb_ventas (negocio_id, tipo, numero, nvl(timbrado_nro, '-'));

create table tb_venta_items (
  venta_id     varchar2(32)  not null references tb_ventas on delete cascade,
  orden        number(2)     not null,
  tipo         varchar2(8)   not null check (tipo in ('servicio', 'producto')),
  ref_id       number        not null,
  descripcion  varchar2(60)  not null,
  cantidad     number(5)     not null,
  precio       number(12)    not null,
  iva          number(2)     not null,
  constraint tb_venta_items_pk primary key (venta_id, orden)
);

/* ---------------- Vistas con el JSON que usa la página ----------------
   (no se publican: solo las lee el paquete TB_API) */
create or replace view tb_v_compras as
select c.id, c.negocio_id, c.fecha,
       json_object(
         'id' value c.id, 'negocio_id' value c.negocio_id, 'fecha' value to_char(c.fecha, 'YYYY-MM-DD'),
         'proveedor' value c.proveedor, 'proveedor_ruc' value c.proveedor_ruc, 'numero' value c.numero,
         'condicion' value c.condicion, 'forma_pago' value c.forma_pago,
         'items' value (select json_arrayagg(json_object('producto_id' value i.producto_id, 'descripcion' value i.descripcion,
                                 'cantidad' value i.cantidad, 'precio' value i.precio, 'iva' value i.iva)
                                 order by i.orden returning clob)
                          from tb_compra_items i where i.compra_id = c.id) format json,
         'total' value c.total, 'exenta' value c.exenta, 'grav5' value c.grav5, 'grav10' value c.grav10,
         'iva5' value c.iva5, 'iva10' value c.iva10, 'nota' value c.nota,
         'anulada' value case c.anulada when 1 then 'true' else 'false' end format json,
         'anulada_motivo' value c.anulada_motivo,
         'anulada_en' value to_char(sys_extract_utc(c.anulada_en), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         'creado_en' value to_char(sys_extract_utc(c.creado_en), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
         returning clob) doc
  from tb_compras c;

create or replace view tb_v_ventas as
select v.id, v.negocio_id, v.fecha, v.hora, v.creado_en,
       json_object(
         'id' value v.id, 'negocio_id' value v.negocio_id, 'fecha' value to_char(v.fecha, 'YYYY-MM-DD'), 'hora' value v.hora,
         'tipo' value v.tipo, 'numero' value v.numero, 'timbrado' value v.timbrado format json,
         'cliente_nombre' value v.cliente_nombre, 'cliente_ruc' value v.cliente_ruc, 'cliente_telefono' value v.cliente_telefono,
         'condicion' value v.condicion, 'forma_pago' value v.forma_pago,
         'barbero_id' value v.barbero_id, 'barbero_nombre' value v.barbero_nombre, 'turno_id' value v.turno_id,
         'items' value (select json_arrayagg(json_object('tipo' value i.tipo, 'ref_id' value i.ref_id, 'descripcion' value i.descripcion,
                                 'cantidad' value i.cantidad, 'precio' value i.precio, 'iva' value i.iva)
                                 order by i.orden returning clob)
                          from tb_venta_items i where i.venta_id = v.id) format json,
         'total' value v.total, 'exenta' value v.exenta, 'grav5' value v.grav5, 'grav10' value v.grav10,
         'iva5' value v.iva5, 'iva10' value v.iva10, 'nota' value v.nota,
         'anulada' value case v.anulada when 1 then 'true' else 'false' end format json,
         'anulada_motivo' value v.anulada_motivo,
         'anulada_en' value to_char(sys_extract_utc(v.anulada_en), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         'creado_en' value to_char(sys_extract_utc(v.creado_en), 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
         returning clob) doc
  from tb_ventas v;

create or replace view tb_v_productos as
select p.id, p.negocio_id, p.nombre, p.activo,
       json_object(
         'id' value p.id, 'negocio_id' value p.negocio_id, 'nombre' value p.nombre, 'tipo' value p.tipo, 'unidad' value p.unidad,
         'precio' value p.precio, 'costo' value p.costo, 'minimo' value p.minimo, 'iva' value p.iva, 'stock' value p.stock,
         'activo' value case p.activo when 1 then 'true' else 'false' end format json,
         'creado_en' value to_char(sys_extract_utc(p.creado_en), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
         returning clob) doc
  from tb_productos p;

create or replace view tb_v_gastos as
select g.id, g.negocio_id, g.fecha,
       json_object(
         'id' value g.id, 'negocio_id' value g.negocio_id, 'fecha' value to_char(g.fecha, 'YYYY-MM-DD'),
         'categoria' value g.categoria, 'descripcion' value g.descripcion, 'monto' value g.monto,
         'condicion' value g.condicion, 'forma_pago' value g.forma_pago, 'proveedor' value g.proveedor,
         'comprobante' value g.comprobante,
         'creado_en' value to_char(sys_extract_utc(g.creado_en), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
         returning clob) doc
  from tb_gastos g;
