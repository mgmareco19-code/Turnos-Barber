# Control de turnos · Barberías (varios locales)

Un solo sistema para muchas barberías. Cada local tiene su link de reservas y su panel, y no ve los datos de los demás.

| Página | Para quién | Qué hace |
|---|---|---|
| `index.html?local=SLUG` | Clientes de cada barbería | Reservan en 4 pasos (servicios → barbero → día y hora → datos) y avisan por WhatsApp. Con su link personal ven, cambian o cancelan su turno |
| `admin.html` | Dueño de cada barbería | Agenda por barbero, estados y carga manual · **Ventas y facturación** · **Compras** · **Gastos** · **Stock** · barberos, servicios y **Configuración** del local (logo, nombre, WhatsApp, dirección, horario, reglas de reserva) |
| `superadmin.html` | Vos | Alta de locales, link, email del dueño, vencimiento del abono, renovar +1 mes, suspender y **Accesos** (link de reservas + acceso del staff para copiar o mandar por WhatsApp) |

## Probarlo (modo demo)

Abrí `index.html`: muestra los locales de ejemplo. Los datos se guardan solo en ese navegador.

| Local | Link | Dueño (contraseña `admin`) | Estado del abono |
|---|---|---|---|
| Black Label Barber Club | `?local=black-label` | dueno@blacklabel.demo | Activo |
| Barbería El Patrón | `?local=el-patron` | dueno@elpatron.demo | Vence en 3 días |
| Studio 21 Barbershop | `?local=studio-21` | dueno@studio21.demo | Vencido (reservas pausadas) |

Barbero de ejemplo (ve solo su agenda): `diego@blacklabel.demo`, contraseña `diego123`.

Superadmin: `superadmin.html`, contraseña `super`.

Para borrar los datos demo: en la consola del navegador, `DB.reset()` y recargá.

## Logo de cada local

El dueño lo sube en **Configuración → Logo** (PNG, JPG, WEBP o SVG). Se achica a 320 px manteniendo la transparencia y aparece en:
la barra y la portada de su página de reservas, la pestaña del navegador, su panel y tu superadmin.
Si el logo ya incluye el nombre, puede marcar "Mi logo ya tiene el nombre" para no repetirlo al lado.
Sin logo se muestra la tijera y el nombre, como antes.

En modo demo la imagen se guarda en el navegador; en el modo online va a ir a Supabase Storage.

## Abonos

- Cada local tiene una fecha de vencimiento (`vence_el`). Al crear uno se proponen 30 días de prueba.
- 7 días antes, el dueño ve un aviso en su panel con un botón para escribirte por WhatsApp (`plataforma.soporteWhatsapp` en `js/config.js`).
- Vencido: sigue recibiendo reservas durante `diasGracia` días (5). Después la página de reservas muestra "Reservas online pausadas" con el WhatsApp del local. **El panel del dueño sigue funcionando.**
- Suspendido: igual que vencido, pero lo decidís vos.
- Precio: `precioMensual` en `js/config.js` (55.000 Gs.). A un local puntual le podés poner otro precio al editarlo.
- En el superadmin, **Cobrar** registra el pago (1, 2, 3, 6 o 12 meses), suma esos meses desde el vencimiento (o desde hoy si ya venció) y reactiva el local.
- Pestaña **Ingresos**: cobrado este mes, ingreso mensual esperado, lo que falta cobrar este mes, total del año, gráfico de los últimos 12 meses (tocá un mes para ver sus pagos) e historial de pagos. Un pago cargado por error se puede borrar (el vencimiento no cambia solo: corregilo editando el local).

## El cliente cambia o cancela su turno

Cada turno tiene su **link personal** (`index.html?local=SLUG&turno=…`). Desde ahí el cliente ve su turno y puede:
- **Cambiar día u hora**: mismos servicios, y puede elegir otro barbero. El turno vuelve a quedar *Pendiente* para que el local lo confirme.
- **Cancelar**: el horario queda libre y se le ofrece avisarle al local por WhatsApp.

Reglas (las controla la base, no la página):
- Solo turnos *Pendientes* o *Confirmados*, y hasta el **aviso mínimo** del local antes de la hora (Configuración → reglas de reserva; 30 min por defecto). Más cerca, se le pide que escriba por WhatsApp.
- Hasta **3 cambios** por turno (`c_max_cambios` en `oracle/03_paquete.sql` y `MAX_CAMBIOS` en `js/db.js`).
- Los horarios nuevos siguen las mismas reglas que una reserva: horario del local, días de anticipación y sin choques.

Cómo le llega el link al cliente:
- Al reservar, en la pantalla final (con botón **Copiar**).
- En el **recordatorio** que le manda el local (ver abajo).
- Si perdió el link: en la página de reservas, **«¿Ya tenés turno? Cambialo o cancelalo acá»**, con su **código de reserva + celular**. El celular se compara por los últimos dígitos, así `0981 123 456` y `+595 981 123456` son el mismo.
- Si reservó desde ese mismo celular, la página de reservas le muestra «Tenés un turno el…».

En el panel, la lista y el detalle del turno muestran **«El cliente lo cambió»** o **«Lo canceló el cliente»**.

## Recordatorios por WhatsApp

En la Agenda, botón **Recordatorios**: lista los turnos pendientes y confirmados de **mañana** (o lo que queda de **hoy**). **Enviar** abre WhatsApp con el mensaje listo para ese cliente: día, hora, servicios, barbero, dirección y el link para confirmar, cambiar o cancelar.

WhatsApp no permite mandar mensajes en masa desde un link, así que se manda uno por uno (un toque por cliente). Los ya enviados quedan marcados en ese navegador; si el cliente cambia el turno, vuelve a aparecer sin enviar. El botón de WhatsApp de cada turno (lista y detalle) manda el mismo mensaje.

## Gestión del local (panel del dueño)

Debajo de la barra del panel hay seis secciones: **Agenda · Ventas · Compras · Gastos · Stock · Clientes**. Ventas, Compras y Gastos se ven por mes (flechas o tocando el nombre del mes).

**Bloquear horarios** (Agenda → **Bloqueos**): vacaciones, feriados o un barbero que falta, por días o por un rango de horas.
- **Todo el local, todo el día**: en la página de reservas esos días aparecen *cerrados* (con el motivo) y en la agenda se ve «Local cerrado».
- **Un barbero o unas horas**: esos horarios dejan de ofrecerse y en la agenda se ven rayados.
- Nadie puede reservar ni cambiar un turno a un horario bloqueado (tampoco desde el panel). Los turnos que ya estaban reservados **no se cancelan solos**: al bloquear, el panel avisa cuántos hay para que les escribas.

**Ventas y facturación**
- **Nueva venta**: servicios y/o productos (cantidad y precio editables), cliente con RUC o cédula, forma de pago, condición (contado o crédito) y barbero.
- **Cobrar un turno**: al marcar un turno como *Atendido*, se abre «Cobrar turno» con sus servicios ya cargados. En el detalle del turno queda «Cobrado · Factura Nº…».
- **Factura con timbrado**: en **Timbrado** el local carga razón social, RUC, número de timbrado, vigencia, establecimiento, punto de expedición y el próximo número. Cada factura toma el número siguiente (001-001-0000001…), con columnas exentas/5 %/10 %, total en letras y liquidación del IVA. Se imprime en formato ticket (impresora térmica de 80 mm, la misma del ticket interno) o se manda por WhatsApp.
- Sin timbrado, o con la fecha fuera de la vigencia, la venta sale como **ticket interno** (T-000001, formato de impresora térmica, «no válido como factura»).
- **Anular**: el comprobante queda marcado ANULADO y conserva su número; los productos vuelven al stock.
- **Descuento y propina**: el descuento (en Gs. o %) baja el total facturado y el IVA se calcula sobre lo cobrado. La propina es para el barbero elegido: se cobra junto con la venta pero **no forma parte de la factura** (en el comprobante sale aparte). Solo en ventas al contado.
- **Cliente**: al escribir el nombre o el RUC aparecen los clientes que ya vinieron; al elegir uno, la venta queda en su historial.
- Arriba: ventas del mes, servicios y productos, efectivo y otros medios, y el **resultado del mes** (ventas − compras − gastos).
- **Caja del día**: lo que entró por cada forma de pago (ventas + propinas), las ventas a crédito (no entran a la caja) y las salidas en efectivo (gastos y compras pagados en efectivo ese día). Con el **fondo inicial** calcula cuánto efectivo tiene que haber; escribís lo que contaste y te dice si sobra, falta o cuadra. Se imprime en la térmica.
- **Comisiones**: por barbero y por mes, sobre lo cobrado (con IVA y con los descuentos ya aplicados): % de servicios + % de productos, más sus propinas (100 % del barbero) = **a pagar**. Los porcentajes se cargan en **Barberos**. Las ventas sin barbero asignado no generan comisión. Se imprime la liquidación con espacio para la firma.
- Esto **no es factura electrónica (SIFEN)**: sirve para el régimen de facturas con timbrado preimpreso o autoimpresor. Para SIFEN hace falta la base online y un certificado digital; se puede agregar más adelante.

**Proveedores** (Compras → **Proveedores**): nombre, RUC, teléfono / WhatsApp, contacto y una nota, con lo que se les compró. Un proveedor nuevo también se agrega solo al cargar una compra. Si le cambiás el nombre, las compras anteriores pasan a llamarse igual.

**Clientes**: se arman solos, sin cargar nada.
- Cada turno los reconoce por el **celular** (0981… y +595 981… son el mismo); una venta de mostrador, por el **RUC o cédula**.
- La lista muestra visitas (turnos atendidos + compras sin turno), cuánto gastó, la última visita y si tiene turno reservado. Hay filtros para los **frecuentes** (3 visitas o más) y los que **no vuelven hace 60 días**.
- La ficha de cada cliente tiene su historial de turnos y comprobantes, qué suele pedir y con quién, cuántas veces faltó, y una nota (preferencias, alergias…). Desde ahí: WhatsApp, nuevo turno o nueva venta.
- Al cargar un **turno** o una **venta**, escribiendo el nombre, el celular o el RUC aparecen sus datos para completarlos con un toque.

**Compras**: proveedor (se autocompleta con los de Proveedores), RUC, número de factura y productos con su costo. Al guardar, **suma al stock** y actualiza el costo de cada producto. Desde la misma compra se puede crear un producto nuevo. Una compra cargada por error se anula y descuenta lo que había sumado, siempre que ese stock todavía esté.

**Gastos**: alquiler, luz, sueldos, etc. Las categorías están en `categoriasGasto` de `js/config.js`. Hay un resumen por categoría (tocá una para filtrar) y una comparación con el mes anterior. Se pueden editar y borrar.

**Stock**
- Productos **para vender** (bajan al venderlos) e **insumos** de uso interno.
- Cada producto tiene costo, precio, IVA, unidad y stock mínimo. El número de la pestaña Stock muestra cuántos están en el mínimo o sin stock.
- **Ajustar**: uso en el local, pérdida o vencimiento, ingreso sin compra, o **conteo físico**, que fija el stock real.
- **Movimientos**: el historial de cada producto, con lo que quedó después de cada uno.
- No se puede vender más de lo que hay. Un producto con movimientos no se borra: se desactiva.

**Exportar a Excel** (botón **Excel** en Ventas, Compras o Gastos): descarga un `.xlsx` del mes elegido para tu contador, con cuatro hojas:
- **Resumen**: total vendido (facturas y tickets), IVA débito, descuentos, propinas, compras con su IVA crédito, gastos y resultado.
- **Ventas**: fecha, tipo, número, timbrado, cliente y RUC, condición, forma de pago, barbero, gravado 10 % / 5 % con su IVA, exento, descuento, total, propina y si está anulada.
- **Compras**: proveedor, RUC, número de factura, gravados, IVA y total.
- **Gastos**: categoría, descripción, proveedor, comprobante y monto.

Necesita internet: la primera vez descarga la librería que arma el archivo.

## Usuarios para los barberos

En **Barberos**, el botón de la llave de cada barbero crea su usuario (su email) y genera una **contraseña temporal**, que se muestra una sola vez para copiarla o mandarla por WhatsApp junto con el link. Desde ahí también se genera una contraseña nueva o se quita el acceso.

Con su usuario, el barbero:
- **Ve:** solo su agenda (sus turnos), y puede cargarle turnos a sus clientes, cambiar estados, mandar recordatorios y **cobrar sus turnos** (la venta queda a su nombre y con la fecha de hoy).
- **No ve:** ventas, caja, comisiones, compras, gastos, stock, clientes, la configuración ni los turnos de los demás. Tampoco puede anular comprobantes.
- **Contraseña:** la cambia él mismo con el botón **Contraseña**.

Si desactivás al barbero, su usuario deja de funcionar al instante. Todo esto lo controla la base de datos, no solo la pantalla.

## Qué controla la capa de datos

Aunque alguien manipule la página, `js/db.js` no deja:
- reservar con barberos o servicios de otro local, fuera del horario del local o en un local pausado;
- que un dueño vea o toque turnos, barberos o servicios de otro local;
- que un dueño cambie su link, su vencimiento o su estado (eso solo lo hace el superadmin);
- que un barbero vea o toque algo que no sea su agenda y sus cobros;
- que un mismo celular tenga más de 3 turnos reservados por la página al mismo tiempo (freno a reservas falsas).

En el modo online estas mismas reglas las aplica la base de datos (paquete `TB_API` en Oracle).

## Seguridad

**Lo que ya está hecho**
- **Toda la lógica y los permisos viven en la base de datos.** La página solo muestra; las tablas no están publicadas y cada función filtra por el local y, si es un barbero, por su barbero.
- **Contraseñas:** se guardan con sal y hash repetido, nunca en texto. Después de 5 intentos fallidos, la cuenta se bloquea 15 minutos. Las sesiones usan un token aleatorio que la base guarda solo como hash y que vence a los 30 días.
- **Datos de los clientes:** la reserva pública nunca devuelve nombres ni teléfonos de otros clientes (solo los horarios ocupados). El link de «Mi turno» lleva un identificador imposible de adivinar y no muestra el teléfono.
- **Contenido de la página:** todo texto que carga un usuario (nombres, notas, motivos…) se muestra escapado, así no se puede inyectar código.
- **Política de seguridad de contenido (CSP):** cada página solo acepta scripts propios y de las dos librerías externas, verificadas con su huella (SRI). Si alguien las modifica en el servidor de origen, el navegador no las ejecuta.
- **Links privados:** las páginas no envían su dirección a otros sitios (`no-referrer`), así el link de «Mi turno» o el usuario del panel no se filtran.
- **Excel:** los textos se guardan como texto, nunca como fórmulas.

**Antes de publicar**
1. Subí la página con **https** (los hostings gratuitos lo dan solo).
2. El archivo `_headers` agrega encabezados de seguridad: impide que otro sitio meta tu panel dentro del suyo y fuerza https. Netlify y Cloudflare Pages lo leen solo; en otro hosting configurá esos mismos encabezados.
3. En `oracle/04_ords.sql`, poné tu dominio en `l_origenes` y volvé a correrlo.
4. **El modo demo no es para datos reales:** guarda todo en el navegador y sus contraseñas son fijas. Con `apiUrl` cargado, el modo demo se desactiva solo.
5. Usá contraseñas largas para el superadmin y los dueños, y generá una nueva para cada barbero que se vaya.

## Base de datos online (Oracle Autonomous Database)

La página sigue igual; solo cambia de dónde salen los datos. Con `apiUrl` vacío en `js/config.js` funciona en modo demo; con `apiUrl` cargado usa Oracle.

**Cómo funciona:** las tablas no se publican. ORDS publica una sola URL (`/ords/turnos/api/rpc`) que llama al paquete PL/SQL `TB_API`, y ahí está toda la lógica: valida cada dato, controla el horario y los choques de turnos, y cada dueño solo ve lo de su local (el local sale de su sesión, no de lo que manda la página).

### Instalación (una sola vez)

1. En Oracle Cloud creá una **Autonomous Database** tipo **Transaction Processing** (Always Free).
2. Abrí **Database Actions → SQL** con el usuario **ADMIN** y corré `oracle/01_admin.sql` (antes cambiá la contraseña de TURNOS).
3. Entrá a Database Actions con el usuario **TURNOS** y corré, en orden:
   - `oracle/02_tablas.sql`
   - `oracle/02b_gestion.sql` (ventas, facturas, compras, gastos y stock)
   - `oracle/02c_turnos_cliente.sql` (el cliente cambia o cancela su turno)
   - `oracle/02d_extras.sql` (clientes, proveedores, bloqueos, comisiones, descuentos y propinas)
   - `oracle/02e_accesos.sql` (usuarios para los barberos)
   - `oracle/02f_recuperar.sql` («Olvidé mi contraseña»)
   - `oracle/03_paquete.sql` (tiene que compilar sin errores; si aparece alguno, revisá *Compilation errors* o `select * from user_errors`)
   - `oracle/04_ords.sql`
   - `oracle/05_inicial.sql` (antes poné tu email y tu contraseña de superadmin)
4. Copiá la URL de la API: es la de tu base + `/ords/turnos/api/rpc`. La base la ves en Database Actions (la parte de la dirección hasta `/ords/`).
5. Pegala en `apiUrl` de `js/config.js` y subí la carpeta a tu hosting (cualquiera que sirva archivos estáticos con https).
6. Entrá a `superadmin.html` con tu email y contraseña, y creá el primer local.

### Contraseñas en modo online

- Al crear un local se genera una **contraseña temporal** para el dueño. Aparece en «Local creado» y en el mensaje para WhatsApp.
- Las contraseñas se guardan encriptadas. Por eso en **Accesos** no se puede ver la actual: con **Generar nueva** creás otra (la anterior deja de andar y se cierran sus sesiones).
- El dueño la cambia en **Configuración → Cambiar contraseña**.
- Después de 5 intentos fallidos, ese usuario queda bloqueado 15 minutos.
- Tu contraseña de superadmin: si te la olvidás, volvé a correr `oracle/05_inicial.sql` con una nueva.
- **¿Olvidaste tu contraseña?** (en el login del panel): el dueño o el barbero escribe su email y le llega un link de un solo uso que vence en 1 hora. La respuesta es siempre la misma, exista o no el email (no revela quién está registrado), y hay un máximo de 3 pedidos por hora. El link siempre apunta a `url_panel` (lo define la base, no la página).

### Correo para «Olvidé mi contraseña» (Email Delivery de Oracle Cloud)

1. En la consola de Oracle Cloud: **Developer Services → Email Delivery**.
   - **Approved Senders:** agregá la dirección que va a mandar los correos. Lo ideal es una de tu dominio (ej. `no-responder@tudominio.com`); con una de Gmail los correos suelen terminar en spam o rechazados.
   - **Configuration:** anotá el **SMTP host** (en Santiago: `smtp.email.sa-santiago-1.oci.oraclecloud.com`).
2. Tu perfil (arriba a la derecha) → **SMTP credentials → Generate**: anotá el usuario y la contraseña SMTP (se muestran una sola vez).
3. Corré `oracle/06a_correo_admin.sql` como **ADMIN**: le da permiso a TURNOS para conectarse al servidor de correo.
4. Completá `oracle/06b_correo.sql` (usuario y contraseña SMTP, remitente y tu email para la prueba) y corrélo como **TURNOS**. Tiene que llegarte el correo de prueba.

Hasta que lo configures, «Olvidé mi contraseña» responde lo mismo pero no llega nada (queda anotado en `tb_errores`), y la contraseña se sigue reseteando desde el superadmin.

### Respaldo semanal

`oracle/07_respaldo_admin.sql` (correr como **ADMIN**, una vez) exporta todo el esquema TURNOS los domingos a las 3:00 (hora de Paraguay) y lo guarda en el bucket privado `turnos-respaldos`. El archivo explica cómo crear el bucket y el *Auth token*. Ese respaldo es tuyo, aparte de las copias que haga Oracle.

## Publicar la página (Object Storage de Oracle Cloud)

La página está en el bucket público `turnos-web` (solo lectura, sin listar archivos). Links:
- **Página de ventas:** `…/o/ventas.html`. La dirección principal sin `?local=` lleva ahí.
- **Reservas de un local:** `…/o/index.html?local=SLUG`.
- **Panel:** `…/o/admin.html`.
- **Términos y privacidad:** `…/o/terminos.html` y `…/o/privacidad.html`. Son **borradores**: completá lo que está entre corchetes y hacelos revisar por un abogado.

El **superadmin no se publica**: usalo desde tu computadora (Live Server). Los links que arma (reservas, accesos) igual apuntan a la página publicada, porque salen de `urlPublica` en `js/config.js`.

**Para actualizar la página:**
1. En la carpeta del proyecto, ejecutá `armar-zip.ps1` (clic derecho → *Ejecutar con PowerShell*). Arma `..\turnos-web.zip` sin el superadmin ni los scripts de Oracle.
2. En **Cloud Shell** (región Santiago): engranaje → **Upload** → `turnos-web.zip`, y después:
   ```bash
   unzip -o turnos-web.zip -d turnos-web
   oci os object bulk-upload --bucket-name turnos-web --src-dir turnos-web --content-type auto --cache-control "no-cache" --overwrite
   ```

### A tener en cuenta

- **Dominio permitido (CORS):** cuando tengas el dominio definitivo, ponelo en `l_origenes` de `oracle/04_ords.sql` y volvé a correrlo.
- **Zona horaria y días de gracia:** el paquete usa la hora de Paraguay (`America/Asuncion`) y 5 días de gracia. Si cambiás `diasGracia` o `precioMensual` en `js/config.js`, cambiá también `c_dias_gracia` / `c_precio` al principio de `oracle/03_paquete.sql`.
- **Base gratuita:** Oracle apaga la base si pasa 7 días sin uso. Con locales reservando no pasa, pero mientras probás tenelo en cuenta.
- **Errores inesperados** quedan en la tabla `tb_errores` (`select * from tb_errores order by en desc`).

- **¿Ya tenías la base instalada de antes?** Corré una sola vez los scripts nuevos que te falten, en orden: `oracle/02b_gestion.sql` (Ventas, Compras, Gastos y Stock), `oracle/02c_turnos_cliente.sql` (cambiar o cancelar desde el link), `oracle/02d_extras.sql` (clientes, proveedores, bloqueos, comisiones, descuentos y propinas: arma la lista de clientes con los turnos que ya había), `oracle/02e_accesos.sql` (usuarios para los barberos) y `oracle/02f_recuperar.sql` («Olvidé mi contraseña»). Después volvé a correr `oracle/03_paquete.sql`. Los locales y turnos que ya tenés no se tocan.
- **Lo que se guarda en Oracle:** turnos, locales y abonos, y también ventas (facturas y tickets, con la numeración asignada por la base para que no se repita), timbrado, compras, gastos, productos y movimientos de stock. Las facturas no se borran: se anulan y conservan su número.

La carpeta `supabase/` es de una versión anterior y ya no se usa.

## Estructura

```
turnos-barber/
├── index.html          reserva pública (?local=slug)
├── admin.html          panel del dueño
├── superadmin.html     panel de la plataforma (vos)
├── css/styles.css
├── js/config.js        nombre de la plataforma, WhatsApp de soporte, días de gracia
├── js/utils.js         fechas, horarios, estado del abono, formato Gs., WhatsApp
├── js/db.js            datos en modo demo (navegador), con aislamiento por local
├── js/db-oracle.js     datos en modo online (llama a la API de Oracle)
├── js/reserva.js
├── js/admin.js         agenda, barberos, servicios, configuración
├── js/gestion.js       ventas y facturación, compras, gastos y stock
├── js/superadmin.js
└── oracle/             scripts para la Autonomous Database (correr en orden 01, 02, 02b–02f, 03, 04, 05; opcionales: 06a/06b correo, 07 respaldo)
```
