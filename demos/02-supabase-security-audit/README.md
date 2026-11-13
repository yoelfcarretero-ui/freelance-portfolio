# Supabase Security Audit

A read-only security checker for Supabase projects, plus a complete sample audit deliverable for a fictional app. Together they show how I review the security of Supabase and Lovable apps: what I check, how I explain it to non-technical founders, and how I fix it.

## The problem

Supabase makes it easy to ship an app quickly, and tools like Lovable, Bolt and v0 make it even faster. The catch is that Supabase exposes your database directly to the browser through an auto-generated API. The only things standing between your customers' data and the internet are your **Row Level Security (RLS) policies** and **which key you put in your frontend**.

The same handful of mistakes show up again and again:

- tables created without RLS, so anyone with the public key can read (and often modify) every row;
- the `service_role` master key pasted into a `VITE_` variable "just to make it work";
- storage buckets marked public that hold invoices or ID documents;
- `SECURITY DEFINER` functions that quietly bypass every policy;
- email confirmation and rate limits switched off during development and never switched back.

None of these need a hacker to exploit. They need someone curious with browser developer tools.

## What is in this folder

| Path | What it is |
|---|---|
| [`supabase-rls-check/`](./supabase-rls-check) | TypeScript CLI that audits a project from the outside, read-only, and scans a local repo for leaked keys. |
| [`sample-report/AUDIT_REPORT.md`](./sample-report/AUDIT_REPORT.md) | A full audit report as a client receives it, for the fictional salon booking app "SlotBook". |
| [`sample-report/fixes.sql`](./sample-report/fixes.sql) | The commented SQL migration that fixes SlotBook's database findings. |
| [`sample-report/verify-fixes/`](./sample-report/verify-fixes) | Script that applies `fixes.sql` to a real Postgres engine (PGlite) and checks 34 access rules. |
| [`docs/CHECKLIST.md`](./docs/CHECKLIST.md) | The checklist I follow on every audit. |

## What the tool checks

`supabase-rls-check` looks at your project the way an anonymous visitor would, using only the public anon key that is already in your website:

| Area | Check | How |
|---|---|---|
| Database | Which tables, views and RPC functions the API exposes | Reads the PostgREST OpenAPI document at `/rest/v1/` |
| Database | Whether each table can be read anonymously | One `GET ?select=*&limit=1` per table. Rows returned = Critical, empty = needs confirmation, 401/403 = pass |
| RPC | Functions callable from the browser (possible `SECURITY DEFINER` bypass) | Listed with their parameters, **never called** |
| Storage | Listable and public buckets, with extra weight for names like `id-documents` or `invoices` | `GET /storage/v1/bucket` |
| Auth | Email autoconfirm, open sign-up, anonymous sign-ins, enabled providers | `GET /auth/v1/settings` |
| Repo | `service_role` JWTs (payload decoded locally), `sb_secret_` keys, `sk_live_` / `sk-` keys, service keys in `VITE_` / `NEXT_PUBLIC_` variables, `auth.admin` in frontend code, `.env` files not covered by `.gitignore` | Local file scan, skipping `node_modules`, `.git`, `dist` |

Every finding in the report has a plain-English explanation, the evidence, the business impact, and a concrete fix with SQL where it applies. The report also lists the checks that passed and, just as important, what the tool **could not** verify.

## Safety

- **Read-only.** The tool only sends `GET` requests. There is no code path for `POST`, `PATCH` or `DELETE`, RPC functions are never executed, and the tests assert that only `GET` requests reach the mock server.
- **No data kept.** When a table is readable, the report records the column names and the fact that rows came back, never the row values. Secrets found in a repo are redacted (`eyJhbGciOi...Q8xM`).
- **Public key only.** If you pass a `service_role` or `sb_secret_` key, the tool refuses to run. A privileged key bypasses RLS and would make the results meaningless.
- **Gentle.** At most 4 requests in flight, with a timeout on each one.
- **Low noise in the repo scan.** Rules about shipped code (`auth.admin`, public env variables) are not applied to tests and docs, while real-looking keys are flagged everywhere. A reviewed false positive can be silenced by adding `rls-check-ignore` to that line. Running the scanner on this folder returns zero findings.
- **Only for projects you own or are authorised to test.** Probing someone else's project without permission is not a grey area. Do not do it.

## Usage

Requires Node.js 20 or newer.

```bash
cd supabase-rls-check
npm install
npm run build
```

Audit a project (use the **anon / publishable** key, never the service role):

```bash
node dist/bin.js --url https://your-ref.supabase.co --anon-key "$SUPABASE_ANON_KEY" --out report.md
```

Or with environment variables and `tsx`, no build needed:

```bash
export SUPABASE_URL=https://your-ref.supabase.co
export SUPABASE_ANON_KEY=your-anon-key
npx tsx src/bin.ts --repo ../my-lovable-app --out report.md
```

Other useful options:

```bash
# Only scan a local repository for leaked keys (no network)
node dist/bin.js --repo ../my-app

# Schema hidden from anon? Name the tables to probe. Mark intentional public tables.
node dist/bin.js --url ... --anon-key ... --tables bookings,profiles --public-tables services

# Machine-readable output for CI; fail the job on High or worse
node dist/bin.js --url ... --anon-key ... --json --fail-on high > audit.json
```

Exit codes: `0` no blocking findings, `1` findings at or above `--fail-on` (default `critical`), `2` usage or runtime error. Run `node dist/bin.js --help` for every option.

### Try it without a Supabase project

```bash
npm run demo
```

This starts a local mock of an insecure Supabase project (the SlotBook schema) and runs the real CLI against it. It writes [`examples/demo-report.md`](./supabase-rls-check/examples/demo-report.md).

## Sample output

```
supabase-rls-check v1.0.0  (read-only audit)
  project: http://127.0.0.1:63228

  Critical: 2   High: 1   Medium: 2   Low: 2   Info: 3

  [CRITICAL]  Table "bookings" can be read by anyone on the internet
  [CRITICAL]  Bucket "id-documents" is public
  [HIGH]      Bucket "avatars" is public
  [MEDIUM]    1 database function can be called from the browser
  [MEDIUM]    Email confirmation is turned off
  [LOW]       Your full database schema is visible with the public key
  [LOW]       Anyone can list your storage buckets
  [INFO]      Table "profiles" returned no rows to the public key
  [INFO]      Anyone can create an account
  [INFO]      2 sign-in methods enabled

  [PASS]      Table "services" refuses anonymous reads

  2 critical issue(s) found. Fix these before anything else.
```

And an excerpt of the Markdown report for the first finding:

> **F-01 [Critical] Table "bookings" can be read by anyone on the internet**
>
> Using only the public key that ships inside your website, we were able to read rows from "bookings". This usually means Row Level Security (RLS) is turned off for this table, or a policy allows everyone to read it.
>
> **Evidence:** `GET /rest/v1/bookings?select=*&limit=1` returned HTTP 200 with at least 1 row. Columns exposed: id, customer_name, customer_phone, starts_at, user_id. Row values were not stored in this report.
>
> **Recommended fix:** `alter table public.bookings enable row level security;` plus one policy per operation, for example `create policy ... for select to authenticated using ((select auth.uid()) = user_id);`

## Sample audit report

The automated check is the first hour of an audit, not the audit. [`sample-report/AUDIT_REPORT.md`](./sample-report/AUDIT_REPORT.md) shows the full deliverable for SlotBook: executive summary for the founder, scope and authorisation, methodology, nine findings ranked by risk (service role key in the bundle, `bookings` without RLS, public ID documents, a `SECURITY DEFINER` function without `search_path`, self-promotion to staff, email confirmation off, no sign-up rate limiting, weak passwords, no backups), fixes, retest results and next steps.

The fixes in [`fixes.sql`](./sample-report/fixes.sql) are tested, not just written. `sample-report/verify-fixes` builds the insecure schema in PGlite with stand-ins for Supabase's roles and `auth.uid()`, shows the vulnerabilities, applies the migration and replays the access matrix:

```bash
cd sample-report/verify-fixes
npm install
npm run verify     # 34 checks: anon, customer A, customer B, staff with and without MFA
```

## Development

```bash
cd supabase-rls-check
npm test           # Vitest: 35 tests, mock PostgREST/Storage/Auth server + repo fixtures
npm run typecheck  # type-checks sources and tests
npm run build      # compiles to dist/
```

The tests run the real HTTP code against a local `node:http` server that imitates PostgREST, Storage and GoTrue responses (readable table, RLS-protected table, permission denied, timeouts, unreachable host, public buckets, auth settings). Repo-scan fixtures are generated at test time in a temp folder, so this repository never contains anything that looks like a real key.

## Tech stack

- TypeScript (strict), Node.js built-ins only at runtime: `fetch`, `node:util` `parseArgs`, `node:fs`. Zero runtime dependencies.
- Vitest for tests, tsx for running TypeScript directly.
- PGlite (Postgres compiled to WebAssembly) to verify the SQL fixes.

## Limitations

The tool is honest about what an outside-in, read-only check cannot see. It does not test `INSERT` / `UPDATE` / `DELETE` policies (that would mean writing data), it cannot tell "RLS on" from "table empty" when a query returns nothing, it only tests the anonymous role (not what any logged-in stranger can do), and it does not read git history. Those gaps are why the [checklist](./docs/CHECKLIST.md) exists, and each report lists them explicitly.

## Author

Yoel Carretero. I audit and fix security issues in Supabase and Lovable apps.

- Email: yoelf.carretero@gmail.com
- GitHub: [yoelfcarretero-ui](https://github.com/yoelfcarretero-ui)

## License

MIT. See the `LICENSE` file at the root of the repository.
