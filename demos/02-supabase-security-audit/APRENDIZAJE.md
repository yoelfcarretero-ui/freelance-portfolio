# APRENDIZAJE: auditoría de seguridad en Supabase

Guía de estudio de este demo. La idea es que puedas explicar cada línea del proyecto a un cliente o en una entrevista, y que sepas hacer una auditoría real tú solo.

---

## 1. Qué hay en este proyecto

Hay dos piezas que se apoyan mutuamente:

1. **`supabase-rls-check`**: una herramienta de línea de comandos (CLI) en TypeScript que mira un proyecto de Supabase "desde fuera", como lo haría un visitante anónimo, y detecta los fallos más típicos. También escanea un repositorio local buscando claves filtradas.
2. **`sample-report/`**: el entregable que recibiría un cliente: un informe completo de auditoría (`AUDIT_REPORT.md`) para una app ficticia ("SlotBook"), la migración SQL que arregla los problemas (`fixes.sql`) y un script (`verify-fixes/`) que demuestra que esa migración funciona.

Además: `docs/CHECKLIST.md` (tu lista de comprobación en cada auditoría) y el `README.md` en inglés para el portfolio.

Lo importante que tienes que transmitir al cliente: **la herramienta es solo la primera hora de la auditoría**. Lo que vendes es el criterio para revisar políticas, explicar el riesgo en lenguaje de negocio y dejar los arreglos aplicados y probados.

---

## 2. Arquitectura

```
                         supabase-rls-check (Node.js)
 ┌──────────────────────────────────────────────────────────────────────┐
 │ bin.ts ──> cli.ts (parseArgs, códigos de salida, --json/--out)       │
 │              │                                                       │
 │              v                                                       │
 │           audit.ts (orquestador)                                     │
 │              │  rechaza claves service_role / sb_secret_             │
 │              │                                                       │
 │   ┌──────────┼──────────────┬───────────────┬──────────────┐         │
 │   v          v              v               v              v         │
 │ openapi.ts tables.ts      rpc.ts        storage.ts     auth.ts       │
 │ GET        GET por tabla  solo lista    GET buckets    GET settings  │
 │ /rest/v1/  ?limit=1       funciones                                  │
 │                                                                      │
 │ repo.ts (escaneo local de ficheros, sin red)                         │
 │              │                                                       │
 │              v                                                       │
 │   Finding[] ordenados por severidad                                  │
 │       ├── report/markdown.ts  -> informe .md para el cliente         │
 │       └── report/console.ts   -> resumen con colores en terminal     │
 └──────────────────────────────────────────────────────────────────────┘
                 │ solo GET, con la clave anon
                 v
 ┌─────────────────────────── Proyecto Supabase ────────────────────────┐
 │  /rest/v1     PostgREST  -> Postgres (RLS decide qué filas ves)      │
 │  /storage/v1  Storage API -> tabla storage.objects (también con RLS) │
 │  /auth/v1     GoTrue (Auth)                                          │
 └──────────────────────────────────────────────────────────────────────┘
```

Decisiones de diseño que debes saber defender:

- **Todo pasa por `http.ts`, que solo sabe hacer GET.** Así es imposible, por diseño, modificar datos del cliente por error.
- **Cada comprobación devuelve `findings`, `passed` y `limitations`.** El informe dice lo que está mal, lo que está bien y lo que *no se pudo comprobar*. Ser honesto con las limitaciones da más confianza que fingir que la herramienta lo ve todo.
- **Sin dependencias en tiempo de ejecución.** Node 20+ ya trae `fetch` y `parseArgs`. Menos dependencias = menos superficie de ataque, algo coherente en una herramienta de seguridad.
- **`main(argv, io)` recibe la entrada/salida como parámetro.** Eso permite testear la CLI entera sin lanzar procesos.

---

## 3. Tecnologías y por qué

| Tecnología | Para qué | Por qué esta y no otra |
|---|---|---|
| TypeScript (strict) | Todo el código | Los tipos (`Finding`, `Severity`...) evitan errores al construir informes; `noUncheckedIndexedAccess` obliga a comprobar accesos a arrays. |
| Node.js `fetch` + `AbortController` | Peticiones HTTP con timeout | Nativo desde Node 18; el `AbortController` corta peticiones colgadas. |
| `node:util` `parseArgs` | Leer flags de la CLI | Nativo, sin instalar `commander` o `yargs`. |
| `tsc` | Compilar a `dist/` | Es el compilador oficial; para una CLI pequeña no hace falta un bundler. |
| `tsx` | Ejecutar `.ts` directamente | Útil para desarrollo y para el `npm run demo`. |
| Vitest | Tests | Rápido, compatible con ESM y TypeScript sin configuración. |
| `node:http` (en los tests) | Servidor falso que imita Supabase | Prueba el código HTTP real (cabeceras, timeouts, errores) sin internet ni cuentas. |
| PGlite | Verificar `fixes.sql` | Es Postgres real compilado a WebAssembly, se instala con npm y no necesita Docker. |

---

## 4. Conceptos clave (lo que tienes que dominar)

### 4.1 PostgREST: la API automática de Supabase

Supabase no tiene un backend escrito a mano: **PostgREST** lee el esquema de Postgres y crea una API REST automáticamente. Cada tabla del esquema `public` se convierte en un endpoint:

```
GET  /rest/v1/bookings?select=*&limit=1     -> select * from bookings limit 1
POST /rest/v1/rpc/get_busy_slots            -> select get_busy_slots(...)
GET  /rest/v1/                              -> documento OpenAPI con todas las tablas y funciones
```

Cada petición lleva la clave en la cabecera `apikey` (y, con las claves antiguas, también en `Authorization: Bearer ...`). PostgREST mira el JWT, hace `set role anon` o `set role authenticated` en Postgres y ejecuta la consulta **con ese rol**. Por eso la seguridad no está en la API: está en Postgres (permisos y RLS).

Consecuencia para auditar: si con la clave anon puedes leer una tabla, cualquier visitante puede. La clave anon está en el JavaScript de la web; no es secreta.

### 4.2 Roles de Postgres en Supabase

| Rol | Quién lo usa | Ve los datos según... |
|---|---|---|
| `anon` | Visitante sin sesión (clave anon/publishable) | RLS + permisos (GRANT) |
| `authenticated` | Usuario con sesión iniciada | RLS + permisos |
| `service_role` | Tu backend con la clave secreta | **Se salta RLS** (`BYPASSRLS`) |
| `postgres` | Tú en el SQL editor, migraciones | Dueño de las tablas |

Ojo: `authenticated` no significa "de confianza". Si el registro está abierto, cualquiera puede ser `authenticated` en 10 segundos. Por eso una política `to authenticated using (true)` es casi tan mala como no tener RLS.

### 4.3 Row Level Security (RLS)

RLS es una función de Postgres: con ella activada, cada consulta se filtra automáticamente con las **políticas** de la tabla.

```sql
alter table public.bookings enable row level security;

create policy "bookings: customers read own"
  on public.bookings for select          -- operación
  to authenticated                       -- rol
  using ((select auth.uid()) = customer_id);  -- qué filas se pueden ver/tocar
```

Reglas que tienes que tener clarísimas:

- **RLS desactivado** + permisos por defecto de Supabase = el rol `anon` puede leer y escribir todo. Es el fallo número uno.
- **RLS activado sin políticas** = nadie (salvo `service_role`) puede hacer nada. Es seguro, pero la app "deja de funcionar", y ahí es donde los desarrolladores meten `using (true)` para salir del paso.
- **`using`** filtra las filas existentes (select, update, delete). **`with check`** valida la fila nueva (insert, update). En un `update` necesitas los dos, o un usuario podría "regalar" su fila a otro usuario.
- Las políticas permisivas se combinan con **OR**; las `as restrictive` con **AND**. En `fixes.sql` se usa una restrictiva para exigir MFA (`aal2`) al personal.
- Las políticas filtran **filas**, no **columnas**. Para impedir que un usuario cambie su propio `role` hay que usar permisos por columna (`grant update (full_name, phone) ...`) o un trigger. Es el hallazgo SB-05 del informe.
- `(select auth.uid())` en vez de `auth.uid()`: Postgres lo calcula una vez por consulta y no una vez por fila. Rendimiento.
- Las **vistas** se saltan RLS de las tablas que leen salvo que se creen con `security_invoker = true`.

### 4.4 Claves: anon vs service_role (y las nuevas claves)

Supabase tiene dos generaciones de claves:

| | Antiguas (JWT) | Nuevas |
|---|---|---|
| Pública (para el navegador) | `anon` key, un JWT con `"role": "anon"` | `sb_publishable_...` |
| Secreta (solo servidor) | `service_role` key, un JWT con `"role": "service_role"` | `sb_secret_...` |

La secreta se salta RLS. Si aparece en el frontend, el proyecto entero está comprometido: hay que **rotarla** (no basta con borrarla del código, porque ya está en builds antiguos, en el historial de git y quizá en la caché de alguien).

Error típico en Vite/Lovable: `VITE_SUPABASE_SERVICE_ROLE_KEY`. Todo lo que empieza por `VITE_` (o `NEXT_PUBLIC_`, `REACT_APP_`, `EXPO_PUBLIC_`) se mete en el JavaScript público al compilar. La herramienta detecta ese patrón.

Detalle técnico implementado en `http.ts`: las claves `sb_publishable_` no son JWT, así que solo se envían en la cabecera `apikey`, no como `Bearer`.

### 4.5 JWT: decodificar no es verificar

Un JWT tiene tres partes separadas por puntos: `cabecera.payload.firma`, cada una en base64url.

```
eyJhbGciOiJIUzI1NiJ9 . eyJyb2xlIjoic2VydmljZV9yb2xlIn0 . firma
   {"alg":"HS256"}          {"role":"service_role"}
```

- **Decodificar** (lo que hace `jwt.ts`) es solo leer el base64: cualquiera puede hacerlo, no hace falta ningún secreto. Sirve para saber si una clave encontrada es `anon` o `service_role`.
- **Verificar** es comprobar la firma con el secreto del proyecto. Eso lo hace Supabase; nosotros no lo necesitamos ni debemos tenerlo.

Por eso la herramienta puede rechazar una clave `service_role` sin conocer el secreto del proyecto: le basta con leer `role` en el payload.

### 4.6 Funciones `SECURITY DEFINER` y `search_path`

Una función de Postgres puede ejecutarse:

- `security invoker` (por defecto): con los permisos de quien la llama. RLS se aplica.
- `security definer`: con los permisos de **quien la creó** (normalmente `postgres`). **RLS no se aplica.**

Además, cualquier función del esquema `public` es invocable desde la API (`/rest/v1/rpc/nombre`) y, por defecto, `anon` tiene permiso `execute`. Una función `security definer` que devuelve `select * from bookings` deshace todas tus políticas (hallazgo SB-04).

El `search_path` es la lista de esquemas donde Postgres busca los nombres sin esquema. Si una función `security definer` no lo fija, alguien que pueda crear objetos en otro esquema podría hacer que la función use *su* tabla o función. Regla:

```sql
create function public.f() ... security definer set search_path = '' as $$
  select ... from public.bookings ...   -- nombres siempre con esquema
$$;
revoke execute on function public.f() from public, anon;
```

A veces `security definer` es correcto: en `fixes.sql`, `get_busy_slots` lo usa a propósito para que un visitante vea que las 10:00 están ocupadas **sin** ver de quién es la reserva. La clave es devolver solo lo mínimo.

### 4.7 Storage

Los ficheros se guardan en *buckets*. Los metadatos están en la tabla `storage.objects`, que también usa RLS.

- **Bucket público**: cualquiera con la URL descarga el fichero, sin políticas. Bien para logos; fatal para DNIs (hallazgo SB-03).
- **Bucket privado**: el acceso depende de las políticas en `storage.objects`. El patrón típico es una carpeta por usuario: `(storage.foldername(name))[1] = auth.uid()::text`.
- Para mostrar ficheros privados: `createSignedUrl(path, 60)` (URL temporal), no `getPublicUrl`.

### 4.8 Ajustes de Auth

`GET /auth/v1/settings` es público y devuelve, entre otros: `mailer_autoconfirm` (si es `true`, no se confirma el email), `disable_signup`, `external` (proveedores activos) y `anonymous_users`. Otros ajustes (rate limits, CAPTCHA, longitud de contraseña, protección de contraseñas filtradas, MFA) **no** salen ahí: se revisan en el panel. La herramienta lo indica en "Limitations".

---

## 5. Recorrido por los archivos

### `supabase-rls-check/src/`

| Archivo | Qué hace | Qué mirar |
|---|---|---|
| `bin.ts` | Punto de entrada ejecutable. Llama a `main` y fija `process.exitCode`. | Por qué usar `exitCode` en vez de `process.exit()`: deja terminar de escribir la salida. |
| `cli.ts` | Lee flags con `parseArgs`, variables de entorno, escribe el informe, decide el código de salida (0/1/2). | `--fail-on`, `--json`, `--public-tables`; la interfaz `CliIO` para tests. |
| `audit.ts` | Orquesta todo. Valida entrada, rechaza claves privilegiadas, lanza las comprobaciones (en paralelo las independientes) y ordena los hallazgos. | `UsageError` vs error de red; `Promise.all`. |
| `http.ts` | `createGetter`: GET con timeout y cabeceras; `mapLimit`: concurrencia limitada. | Cómo se detecta el timeout con `AbortController`. |
| `jwt.ts` | Decodificar JWT, clasificar claves, redactar secretos. | `redact()` nunca devuelve la clave entera. |
| `types.ts` | `Finding`, `Severity`, `AuditResult`, orden por severidad. | El contrato que comparten todas las comprobaciones. |
| `checks/openapi.ts` | Lee `/rest/v1/` y saca tablas y funciones RPC del documento OpenAPI. | Qué pasa si el esquema no es accesible (se añade una limitación y se usa `--tables`). |
| `checks/tables.ts` | Una petición por tabla y clasificación: legible, vacía, denegada, no existe, error. | Solo guarda nombres de columnas, nunca valores. |
| `checks/rpc.ts` | Convierte la lista de funciones en un hallazgo con el SQL para revisarlas. | Por qué no se llaman nunca (podrían tener efectos). |
| `checks/storage.ts` | Lista buckets; buckets públicos con nombre sensible = Critical. | Heurística por nombre (`id`, `invoice`, `passport`...). |
| `checks/auth.ts` | Analiza los ajustes de Auth. | `analyzeAuthSettings` es una función pura, fácil de testear. |
| `checks/repo.ts` | Recorre ficheros, busca JWT, `sb_secret_`, `sk_live_`, `sk-`, variables públicas con service role, `auth.admin` en frontend, `.env` no ignorados. | Distinción frontend/servidor por ruta; mini-intérprete de `.gitignore`. |
| `report/markdown.ts` | Genera el informe para el cliente. | Estructura: resumen, tabla, detalle, lo que pasó, limitaciones. |
| `report/console.ts` | Resumen con colores ANSI. | Respeta `NO_COLOR` y desactiva colores si no hay TTY. |

### `supabase-rls-check/test/`

| Archivo | Qué prueba |
|---|---|
| `helpers.ts` | Servidor HTTP falso que imita PostgREST/Storage/Auth, JWT falsos generados en tiempo de ejecución, escenarios "inseguro" y "seguro". |
| `jwt.test.ts` | Decodificación, clasificación de claves, redacción. |
| `repo.test.ts` | Escaneo de un repo de ejemplo generado en una carpeta temporal (se salta `node_modules` y `dist`, no marca `.env` ignorados). |
| `audit.test.ts` | Auditoría completa contra el servidor falso: clasificación, solo GET, timeouts, host caído, claves publishable, tablas públicas intencionadas. |
| `cli.test.ts` | Flags, códigos de salida, informe Markdown/JSON, colores. |

Detalle importante: **las claves de los tests se construyen en tiempo de ejecución** (`fakeJwt(...)`, `['sk','live',...].join('_')`). Si escribieras una clave con forma real en un fichero, GitHub (push protection) o un escáner la marcaría, y además darías mal ejemplo en un repo de seguridad.

### `sample-report/`

- `AUDIT_REPORT.md`: estúdialo como plantilla de entregable. Fíjate en el tono: primero negocio, luego técnica.
- `fixes.sql`: cada sección corresponde a un hallazgo. Léelo con el apartado 4 de esta guía al lado.
- `verify-fixes/verify.mjs`: crea en PGlite el esquema inseguro con "imitaciones" de los roles de Supabase y de `auth.uid()`, demuestra los fallos, aplica `fixes.sql` y comprueba 34 reglas actuando como anónimo, cliente A, cliente B y personal (con y sin MFA). La técnica clave es esta:

```sql
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true);
  select count(*) from public.bookings;   -- lo que vería ese usuario
rollback;
```

Puedes usar exactamente lo mismo en el SQL editor de un cliente (en staging) para probar políticas sin crear usuarios.

---

## 6. Cómo ejecutarla y testearla

```bash
cd supabase-rls-check
npm install
npm run build        # compila a dist/
npm test             # 35 tests con Vitest
npm run typecheck    # comprueba tipos también en los tests
npm run demo         # auditoría contra un Supabase falso local, genera examples/demo-report.md
```

Contra un proyecto real **tuyo**:

```bash
node dist/bin.js --url https://TU-REF.supabase.co --anon-key "TU_ANON_KEY" --out informe.md
node dist/bin.js --repo ../mi-app-lovable          # solo escaneo de código
node dist/bin.js --url ... --anon-key ... --json   # salida JSON
```

Verificar el SQL:

```bash
cd sample-report/verify-fixes
npm install
npm run verify
```

Probarlo contra un Supabase local (recomendado para practicar, necesita Docker Desktop arrancado):

```bash
npx supabase init
npx supabase start       # muestra la API URL (http://127.0.0.1:54321) y la anon key
# crea una tabla sin RLS desde Studio (http://127.0.0.1:54323), inserta una fila y:
node dist/bin.js --url http://127.0.0.1:54321 --anon-key "<anon key local>"
npx supabase stop
```

---

## 7. Cómo hacer una auditoría real, paso a paso

1. **Autorización por escrito antes de tocar nada.** Email del dueño indicando: proyectos (refs), repositorios, entornos, qué se puede probar con escritura (solo staging) y fechas. Sin esto, no empiezas. Nunca auditas un proyecto que el cliente no controla.
2. **Accesos mínimos.** Que te inviten a la organización de Supabase con rol Developer o de solo lectura y como colaborador de solo lectura en el repo. Nunca pidas contraseñas ni la clave `service_role` por chat.
3. **Vista desde fuera (30 min).** Abre la web, saca URL y anon key del bundle (DevTools > Network, busca `supabase.co`). Ejecuta `supabase-rls-check`. Busca `eyJ` en el bundle y decodifica cada JWT.
4. **Revisión interna (2-4 h).** En el SQL editor, con las consultas de la sección 7 de `fixes.sql`: tablas sin RLS, todas las políticas por operación, funciones `security definer`, funciones ejecutables por `anon`, buckets públicos. Abre el **Security Advisor** del panel. Revisa Auth (confirmación de email, rate limits, CAPTCHA, contraseñas, URLs de redirección) y las Edge Functions.
5. **Revisión de código.** `supabase-rls-check --repo`, más `gitleaks` para el historial. Busca `auth.admin`, `service_role`, `getPublicUrl`, políticas generadas por IA con `using (true)`.
6. **Pruebas en staging.** Matriz de acceso con usuarios de prueba (anon, A, B, admin) para cada tabla y operación. Apunta resultados, no datos personales.
7. **Clasificar y redactar.** Cada hallazgo con: qué significa en lenguaje sencillo, evidencia (sin datos personales, secretos redactados), impacto de negocio, arreglo concreto, referencias. Ordena por riesgo.
8. **Si hay algo crítico, avisa ya**, no esperes al informe final. Una clave `service_role` expuesta se rota el mismo día.
9. **Arreglos.** Escríbelos como migración (`supabase/migrations/...sql`), aplícalos en staging, repite la matriz, y luego en producción con backup previo y aprobación del cliente. Los cambios de panel, documentados paso a paso o hechos juntos en videollamada.
10. **Retest.** Repite el paso 3 y 4. Tabla antes/después en el informe.
11. **Cierre.** Entrega el informe, quita tus accesos, borra tus copias locales de cualquier dato o clave, y confírmalo por escrito.

Frases útiles con clientes no técnicos:

- "La clave anon es como la dirección de tu tienda: es pública. Las políticas RLS son las cerraduras de cada habitación."
- "La clave service_role es la llave maestra del edificio. Si está en tu web, hay que cambiar todas las cerraduras hoy."
- Sobre RGPD: tú no das asesoramiento legal. Di "te recomiendo que tu asesor valore si hay que notificar (artículos 33/34 del RGPD)".

---

## 8. Orden de estudio recomendado

Estudia en este orden; cada paso se apoya en el anterior. Haz los ejercicios de la sección 9 a medida que avances.

1. **Cómo funciona la API de Supabase**
   - https://supabase.com/docs/guides/api
   - https://docs.postgrest.org/en/stable/ (sobre todo "API" y "Authentication")
2. **Roles y permisos en Postgres**
   - https://supabase.com/docs/guides/database/postgres/roles
   - https://www.postgresql.org/docs/current/ddl-priv.html
   - https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html
3. **Row Level Security** (lo más importante de todo)
   - https://supabase.com/docs/guides/database/postgres/row-level-security
   - https://www.postgresql.org/docs/current/ddl-rowsecurity.html
   - https://www.postgresql.org/docs/current/sql-createpolicy.html
4. **Claves de API y JWT**
   - https://supabase.com/docs/guides/api/api-keys
   - https://supabase.com/docs/guides/auth/jwts
   - https://jwt.io/introduction
5. **Asegurar la API**
   - https://supabase.com/docs/guides/api/securing-your-api
   - https://supabase.com/docs/guides/database/database-advisors
6. **Funciones y SECURITY DEFINER**
   - https://supabase.com/docs/guides/database/functions
   - https://www.postgresql.org/docs/current/sql-createfunction.html (apartado "Writing SECURITY DEFINER Functions Safely")
7. **Storage**
   - https://supabase.com/docs/guides/storage/security/access-control
   - https://supabase.com/docs/guides/storage/buckets/fundamentals
8. **Auth**
   - https://supabase.com/docs/guides/auth
   - https://supabase.com/docs/guides/auth/rate-limits
   - https://supabase.com/docs/guides/auth/auth-mfa
   - https://supabase.com/docs/guides/auth/password-security
9. **Edge Functions**
   - https://supabase.com/docs/guides/functions
   - https://supabase.com/docs/guides/functions/auth
10. **Producción y backups**
    - https://supabase.com/docs/guides/deployment/going-into-prod
    - https://supabase.com/docs/guides/platform/backups
11. **Desarrollo local**
    - https://supabase.com/docs/guides/local-development
12. **Contexto general de seguridad de APIs**
    - https://owasp.org/API-Security/ (OWASP API Security Top 10, sobre todo "Broken Object Level Authorization")

Para el código de la herramienta:

- `parseArgs`: https://nodejs.org/api/util.html#utilparseargsconfig
- `fetch` y `AbortController` en Node: https://nodejs.org/api/globals.html#fetch
- Vitest: https://vitest.dev/guide/
- PGlite: https://pglite.dev/docs/

---

## 9. Ejercicios

Hazlos en orden. Los primeros son de entender, los últimos de construir.

1. **Decodifica una clave a mano.** Crea un proyecto local (`npx supabase start`), copia la anon key y decodifica su payload con `node -e "console.log(Buffer.from('<parte del medio>','base64url').toString())"`. ¿Qué campos tiene? Haz lo mismo con la service_role key. ¿Qué cambia?
2. **Rompe y arregla RLS.** En el proyecto local, crea `notes(id, user_id, text)` sin RLS, inserta una fila y ejecuta `supabase-rls-check`. Debe salir Critical. Activa RLS sin políticas: ¿qué sale ahora? Añade una política `for select to authenticated using ((select auth.uid()) = user_id)` y vuelve a ejecutar.
3. **`using` vs `with check`.** Escribe una política de `update` solo con `using`. Con el truco de `set local role` + `request.jwt.claims` (sección 5), demuestra que el usuario A puede cambiar el `user_id` de su nota al del usuario B. Añade `with check` y demuestra que ya no.
4. **Escalada de privilegios.** Reproduce SB-05: tabla `profiles` con columna `role` y política de update "propia". Demuestra la escalada y arréglala con permisos por columna.
5. **SECURITY DEFINER.** Crea una función `security definer` que devuelva todas las notas. Llámala como `anon` vía `POST /rest/v1/rpc/...` (en tu proyecto local). Luego: `revoke execute ... from anon`, `set search_path = ''`, y reescríbela para devolver solo lo necesario.
6. **Lee los tests.** En `test/audit.test.ts`, encuentra el test que garantiza que solo se envían GET. Rompe a propósito `http.ts` cambiando `method: 'GET'` por `'POST'` y comprueba que el test falla. Deshaz el cambio.
7. **Añade una comprobación nueva a la herramienta.** Por ejemplo: avisar (Low) si `external.phone` está activo sin proveedor SMS (`sms_provider` vacío). Pasos: añade la lógica en `checks/auth.ts`, un test en `audit.test.ts`, y ejecuta `npm test`.
8. **Añade un patrón de secreto al escáner.** Por ejemplo claves de Resend (`re_...`) o de SendGrid (`SG.` + ...). Recuerda construir el valor de prueba en tiempo de ejecución, nunca escribirlo literal.
9. **Amplía `verify-fixes`.** Añade una comprobación: "el cliente A no puede crear una reserva en el pasado". ¿Qué parte de `fixes.sql` la cubre?
10. **Escribe un informe.** Audita tu proyecto local del ejercicio 2-5 como si fuera de un cliente y redacta un `AUDIT_REPORT.md` siguiendo la estructura del de SlotBook. Léeselo a alguien no técnico: si no entiende el resumen ejecutivo, reescríbelo.

---

## 10. Preguntas que te pueden hacer (y respuestas cortas)

- **"¿La clave anon en mi web es un problema?"** No, está pensada para ser pública. El problema es lo que esa clave puede hacer, y eso lo deciden RLS y los permisos.
- **"¿Por qué no pruebas los INSERT/UPDATE/DELETE automáticamente?"** Porque implicaría escribir datos en producción. Esas pruebas se hacen en staging con usuarios de prueba.
- **"Si la tabla devuelve vacío, ¿está bien?"** No necesariamente: puede tener RLS o puede estar vacía hoy. Se confirma con `relrowsecurity` en el SQL editor.
- **"Ya borré la clave del código, ¿suficiente?"** No. Sigue en el historial de git y en builds antiguos. Hay que rotarla.
- **"¿Esto es hacking?"** No. Es una revisión de configuración y código de *tu* app, con tu permiso, sin ataques de denegación de servicio ni ingeniería social.
