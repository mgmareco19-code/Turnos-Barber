# Control de turnos · Barbería

Una web con dos partes:

| Página | Para quién | Qué hace |
|---|---|---|
| `index.html` | Clientes | Reservan en 4 pasos (servicio → barbero → día y hora → datos) y avisan por WhatsApp |
| `admin.html` | El negocio | Agenda del día por barbero, cambio de estados, carga manual de turnos e ingresos del día |

## Probarlo ya (modo demo)

Abrí `index.html` en el navegador. Sin configurar nada, funciona en **modo demo**: los turnos se guardan solo en ese navegador y viene con datos de ejemplo.
Panel: `admin.html`, contraseña `admin`.

Para borrar los datos demo: en la consola del navegador, `DB.reset()` y recargá.

## Pasarlo a base de datos online (Supabase, gratis)

1. Creá una cuenta en <https://supabase.com> y un proyecto nuevo (región: São Paulo).
2. **SQL Editor → New query**: pegá todo `supabase/schema.sql` y tocá **Run**.
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
- **Servicios y barberos:** en Supabase → Table Editor (`servicios`, `barberos`). Con `activo = false` dejan de aparecer sin que se borre el historial.
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
└── supabase/schema.sql
```
