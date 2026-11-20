/* ============================================================
   02d · Correr como TURNOS (después de 02c_turnos_cliente.sql y ANTES de 03_paquete.sql)
   Clientes frecuentes, proveedores, bloqueos de horarios,
   comisiones de los barberos, descuentos y propinas.

   ¿Ya tenías la base instalada? Corré este archivo una vez y después
   volvé a correr 03_paquete.sql. Arma solo la lista de clientes (con
   los turnos que ya hay) y la de proveedores (con las compras y gastos).
   ============================================================ */

/* ---------------- Comisiones de cada barbero (%) ---------------- */
alter table tb_barberos add (
  comision       number(3) default 0 not null check (comision between 0 and 100),        -- sobre los servicios
  comision_prod  number(3) default 0 not null check (comision_prod between 0 and 100)    -- sobre los productos vendidos
);

/* ---------------- Clientes ----------------
   Se reconocen por el celular (últimos 8 dígitos: 0981… y 595981… son el mismo)
   o, en ventas de mostrador, por el RUC / cédula. */
create table tb_clientes (
  id          number generated always as identity primary key,
  negocio_id  number        not null references tb_negocios on delete cascade,
  nombre      varchar2(100) not null,
  telefono    varchar2(30),
  tel_key     varchar2(8),
  ruc         varchar2(12),
  nota        varchar2(300),
  creado_en   timestamp with time zone default systimestamp not null
);
-- Un celular no se repite dentro del local (los clientes sin celular no cuentan)
create unique index tb_clientes_tel_uk on tb_clientes (case when tel_key is not null then negocio_id end, tel_key);
create index tb_clientes_ruc_ix on tb_clientes (negocio_id, ruc);

alter table tb_turnos add (cliente_id number references tb_clientes on delete set null);
create index tb_turnos_cliente_ix on tb_turnos (cliente_id);

/* ---------------- Ventas: cliente, descuento y propina ----------------
   subtotal = suma de las líneas · total = subtotal − descuento (lo facturado)
   La propina no es parte de la factura: se guarda aparte para la caja y las comisiones. */
alter table tb_ventas add (
  cliente_id  number references tb_clientes on delete set null,
  subtotal    number(14),
  descuento   number(14) default 0 not null check (descuento >= 0),
  propina     number(14) default 0 not null check (propina >= 0)
);
update tb_ventas set subtotal = total;
alter table tb_ventas modify (subtotal not null);
create index tb_ventas_cliente_ix on tb_ventas (cliente_id);

/* ---------------- Proveedores ---------------- */
create table tb_proveedores (
  id          number generated always as identity primary key,
  negocio_id  number        not null references tb_negocios on delete cascade,
  nombre      varchar2(80)  not null,
  ruc         varchar2(12),
  telefono    varchar2(30),
  contacto    varchar2(80),
  nota        varchar2(300),
  creado_en   timestamp with time zone default systimestamp not null
);
create unique index tb_proveedores_nombre_uk on tb_proveedores (negocio_id, lower(nombre));

/* ---------------- Bloqueos de horarios ----------------
   barbero_id null = todo el local · ini_min/fin_min null = todo el día */
create table tb_bloqueos (
  id          number generated always as identity primary key,
  negocio_id  number        not null references tb_negocios on delete cascade,
  barbero_id  number        references tb_barberos on delete cascade,
  desde       date          not null,
  hasta       date          not null,
  ini_min     number(4),
  fin_min     number(4),
  motivo      varchar2(80),
  creado_en   timestamp with time zone default systimestamp not null,
  constraint tb_bloqueos_fechas_ck check (hasta >= desde),
  constraint tb_bloqueos_horas_ck check ((ini_min is null and fin_min is null) or (ini_min >= 0 and fin_min <= 1440 and ini_min < fin_min))
);
create index tb_bloqueos_neg_ix on tb_bloqueos (negocio_id, hasta);

/* ---------------- Vista de ventas (se agregan los campos nuevos) ---------------- */
create or replace view tb_v_ventas as
select v.id, v.negocio_id, v.fecha, v.hora, v.creado_en, v.cliente_id,
       json_object(
         'id' value v.id, 'negocio_id' value v.negocio_id, 'fecha' value to_char(v.fecha, 'YYYY-MM-DD'), 'hora' value v.hora,
         'tipo' value v.tipo, 'numero' value v.numero, 'timbrado' value v.timbrado format json,
         'cliente_id' value v.cliente_id,
         'cliente_nombre' value v.cliente_nombre, 'cliente_ruc' value v.cliente_ruc, 'cliente_telefono' value v.cliente_telefono,
         'condicion' value v.condicion, 'forma_pago' value v.forma_pago,
         'barbero_id' value v.barbero_id, 'barbero_nombre' value v.barbero_nombre, 'turno_id' value v.turno_id,
         'items' value (select json_arrayagg(json_object('tipo' value i.tipo, 'ref_id' value i.ref_id, 'descripcion' value i.descripcion,
                                 'cantidad' value i.cantidad, 'precio' value i.precio, 'iva' value i.iva)
                                 order by i.orden returning clob)
                          from tb_venta_items i where i.venta_id = v.id) format json,
         'subtotal' value v.subtotal, 'descuento' value v.descuento, 'propina' value v.propina,
         'total' value v.total, 'exenta' value v.exenta, 'grav5' value v.grav5, 'grav10' value v.grav10,
         'iva5' value v.iva5, 'iva10' value v.iva10, 'nota' value v.nota,
         'anulada' value case v.anulada when 1 then 'true' else 'false' end format json,
         'anulada_motivo' value v.anulada_motivo,
         'anulada_en' value to_char(sys_extract_utc(v.anulada_en), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         'creado_en' value to_char(sys_extract_utc(v.creado_en), 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
         returning clob) doc
  from tb_ventas v;

/* ================= Datos que ya había ================= */
-- Clientes a partir de los turnos (por celular), con el nombre y el número del turno más reciente
insert into tb_clientes (negocio_id, nombre, telefono, tel_key)
select negocio_id,
       max(cliente_nombre)   keep (dense_rank last order by creado_en),
       max(cliente_telefono) keep (dense_rank last order by creado_en),
       k
  from (select t.negocio_id, t.cliente_nombre, t.cliente_telefono, t.creado_en,
               substr(d, greatest(length(d) - 7, 1)) k
          from (select x.*, regexp_replace(x.cliente_telefono, '[^0-9]') d from tb_turnos x) t
         where length(d) >= 6)
 group by negocio_id, k;

update tb_turnos t
   set cliente_id = (select c.id from tb_clientes c
                      where c.negocio_id = t.negocio_id
                        and c.tel_key = substr(regexp_replace(t.cliente_telefono, '[^0-9]'),
                                               greatest(length(regexp_replace(t.cliente_telefono, '[^0-9]')) - 7, 1)));

update tb_ventas v
   set cliente_id = (select t.cliente_id from tb_turnos t where t.id = v.turno_id)
 where v.turno_id is not null;

-- Proveedores a partir de las compras y los gastos
insert into tb_proveedores (negocio_id, nombre, ruc)
select negocio_id,
       max(proveedor) keep (dense_rank last order by creado_en),
       max(proveedor_ruc)
  from (select negocio_id, proveedor, proveedor_ruc, creado_en from tb_compras
        union all
        select negocio_id, proveedor, null, creado_en from tb_gastos where proveedor is not null)
 group by negocio_id, lower(proveedor);

commit;
