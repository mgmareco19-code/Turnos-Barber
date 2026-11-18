# Control de turnos · Barbería

Una web con dos partes:

| Página | Para quién | Qué hace |
|---|---|---|
| `index.html` | Clientes | Reservan en 4 pasos (uno o varios servicios → barbero → día y hora → datos) y avisan por WhatsApp |
| `admin.html` | El negocio | Agenda del día por barbero, cambio de estados, carga manual de turnos, ingresos del día y administración de barberos y servicios |

## Probarlo ya (modo demo)

Abrí `index.html` en el navegador. Sin configurar nada, funciona en **modo demo**: los turnos se guardan solo en ese navegador y viene con datos de ejemplo.
Panel: `admin.html`, contraseña `admin`.

Para borrar los datos demo: en la consola del navegador, `DB.reset()` y recargá.

## Pasarlo a base de datos online (Supabase, gratis)

1. Creá una cuenta en <https://supabase.com> y un proyecto nuevo (región: São Paulo).
2. **SQL Editor → New query**: pegá todo `supabase/schema.sql` y tocá **Run**.
   *¿Ya tenías cargada la versión anterior (un servicio por turno)?* Corré `supabase/migrar_v2.sql` en su lugar: actualiza la base y conserva tus turnos.
3. **Authentication → Users → Add user**: creá el usuario del dueño (email + contraseña, marcá *Auto confirm*).
4. Dale permiso de admin a ese usuario (SQL Editor):
   ```sql
   insert into admins (user_id)
   select id from auth.users where email = 'EL_EMAIL_DEL_DUEÑO';
   ```
5. **Authentication → Sign In / Providers**: desactivá *Allow new users to sign up* (nadie más puede crear cuentas).
6. **Project Settings → API**: copiá la *Project URL* y la clave *anon public* en `js/config.js`:
   ```js
   supabaseUrl: "https://xxxx.supabase.co",
   supabaseAnonKey: "eyJhbGciOi...",
   ```
7. Subí la carpeta a cualquier hosting estático (Netlify, Vercel, GitHub Pages).

La clave *anon* puede ir en el código: la seguridad la dan las políticas RLS del `schema.sql`. El público solo puede ver servicios, barberos y los horarios ocupados (sin nombres) y reservar a través de la función `reservar_turno`. Los datos de los clientes solo los ve un usuario que esté en la tabla `admins`.

## Personalizar

- **Nombre, WhatsApp, dirección, horario de atención, intervalo entre turnos:** `js/config.js`
- **Servicios y barberos:** desde el panel (`admin.html`), con los botones **Servicios** y **Barberos**: agregar, modificar, ordenar, activar/desactivar y eliminar. Lo que tiene turnos registrados no se puede eliminar (para no perder el historial): se desactiva y deja de aparecer en la reserva.

## Varios servicios en un turno

El cliente puede elegir varios servicios en la misma reserva (por ejemplo corte + barba + cejas), hasta 6.
Los hace **el mismo barbero, uno después del otro**: el turno dura la suma de los servicios y el precio es la suma de los precios.

Cada turno guarda el nombre, el precio y la duración de sus servicios **en el momento de la reserva** (tabla `turno_servicios`).
Si después cambiás un precio, los turnos ya reservados y los ingresos de días anteriores no cambian.
- **Colores y tipografía:** variables al principio de `css/styles.css`

## Cómo evita turnos dobles

La tabla `turnos` tiene una restricción (`sin_superposicion`) que no deja que un barbero tenga dos turnos que se pisen, aunque dos clientes reserven en el mismo segundo. Si pasa, el segundo cliente ve "Ese horario se acaba de ocupar".

## Estructura

```
turnos-barber/
├── index.html          reserva pública
├── admin.html          panel del negocio
├── css/styles.css
├── js/config.js        ← lo único que hay que editar
├── js/utils.js         fechas, horarios, formato Gs., WhatsApp
├── js/db.js            Supabase o modo demo (misma interfaz)
├── js/reserva.js
├── js/admin.js
├── supabase/schema.sql      instalación nueva
└── supabase/migrar_v2.sql   actualizar una base de la versión anterior
```
