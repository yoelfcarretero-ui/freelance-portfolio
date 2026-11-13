# Supabase / Lovable Security Audit Checklist

This is the checklist I follow on every audit. Each item has a way to verify it. Items marked **(tool)** are covered automatically by [`supabase-rls-check`](../supabase-rls-check); the rest need dashboard, SQL or code access.

Severity hints: **C** = usually Critical, **H** = High, **M** = Medium, **L** = Low.

---

## 0. Before starting

- [ ] Written authorisation from the project owner (email or signed scope) naming the Supabase project refs, repositories and environments in scope.
- [ ] Agree what can be tested with writes: **staging only**, never production data.
- [ ] Access level agreed: Developer/Read-only on the org, read access to the repo. No sharing of passwords; use invites.
- [ ] Confirm a recent backup exists before any fix is applied.
- [ ] Note plan (Free / Pro / Team), Postgres version, region, and whether the project uses the new API keys (`sb_publishable_` / `sb_secret_`) or legacy JWT keys.
- [ ] Create test accounts on staging: customer A, customer B, staff/admin. Keep their IDs handy.

## 1. Outside-in view (what any visitor sees)

- [ ] **(tool)** Extract the project URL and anon key from the live JS bundle (DevTools > Sources / Network).
- [ ] **(tool)** `GET /rest/v1/` with the anon key: is the OpenAPI schema exposed? List tables, views and RPC functions.
- [ ] **(tool)** For each table/view: `GET /rest/v1/<table>?select=*&limit=1`. Rows returned = **C** unless the table is genuinely public.
- [ ] **(tool)** `GET /storage/v1/bucket`: are buckets listable? Any public bucket?
- [ ] **(tool)** `GET /auth/v1/settings`: autoconfirm, open sign-up, providers, anonymous sign-ins.
- [ ] Check the production bundle for `service_role` JWTs, `sb_secret_` keys and other secrets (search for `eyJ` and decode the payload).

## 2. Row Level Security, table by table

For **every** table in every exposed schema (Settings > API > Exposed schemas, usually `public`):

- [ ] RLS is enabled: `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','p');` (**C** if off and anon has grants).
- [ ] Policies exist for **each operation** that the app needs: `select`, `insert`, `update`, `delete`. RLS on with no policy = no access (safe but may break the app).
- [ ] No `using (true)` / `with check (true)` on non-public data, especially not `to public` or `to anon`.
- [ ] Policies check **ownership** (`(select auth.uid()) = user_id`), not merely "is logged in" (`to authenticated using (true)`). Any stranger can sign up. **H**
- [ ] `update` policies have both `using` (which rows) and `with check` (what the new row may look like), so a row cannot be reassigned to another user.
- [ ] Sensitive columns (`role`, `is_admin`, `plan`, `credits`, `verified`, `price`) cannot be changed by the user: column-level grants or a trigger. **H**
- [ ] Policy roles are explicit (`to authenticated`, `to anon`) instead of the default `public`.
- [ ] Policies do not trust `auth.jwt() -> 'user_metadata'` (users can edit their own metadata). Use `app_metadata` or a table for roles. **H**
- [ ] Policies using helper functions avoid recursion (helper is `security definer` with pinned `search_path`).
- [ ] Performance: `auth.uid()` wrapped as `(select auth.uid())`; indexes on columns used in policies (`user_id`, `org_id`).
- [ ] Multi-tenant apps: every policy filters by tenant (`org_id in (select org_id from memberships where user_id = auth.uid())`).
- [ ] Views: created with `security_invoker = true` (Postgres 15+), otherwise they bypass RLS of the underlying tables. **H**
- [ ] Materialized views and foreign tables are not exposed through the API (they do not support RLS).
- [ ] Anonymous sign-ins: policies that should require a real account check `(auth.jwt() ->> 'is_anonymous')::boolean is false`.
- [ ] Test the matrix: anon / user A / user B / admin for each operation. Record results in the report.

## 3. Keys: anon vs service_role

- [ ] Only the anon / publishable key is used in the browser and mobile apps.
- [ ] **(tool)** No `service_role` JWT or `sb_secret_` key in the repo, the bundle, or `VITE_` / `NEXT_PUBLIC_` / `EXPO_PUBLIC_` variables. **C**
- [ ] **(tool)** No `supabase.auth.admin.*` calls in client code. **H**
- [ ] Server code (Edge Functions, API routes) reads secrets from environment variables, never hardcoded.
- [ ] If a privileged key was ever exposed: rotate it (new API keys or JWT secret rotation) and purge git history.
- [ ] JWT expiry is reasonable (default 3600 s); refresh token reuse detection is on.
- [ ] If migrated to new API keys, legacy JWT-based keys are disabled once nothing uses them.

## 4. Auth settings

- [ ] **(tool)** Email confirmation enabled (`mailer_autoconfirm = false`). **M**
- [ ] **(tool)** Sign-up open only if the product needs it; invite-only apps disable it. **M/H**
- [ ] Custom SMTP configured (the built-in email service is rate limited and for testing).
- [ ] Rate limits (Authentication > Rate Limits) not raised to "testing" values. **M**
- [ ] CAPTCHA (Turnstile / hCaptcha) on sign-up, sign-in and password reset for public apps. **M**
- [ ] Password policy: minimum length >= 8 (10+ recommended), character requirements, leaked password protection on. **L**
- [ ] MFA available, and enforced for admins/staff via `aal2` restrictive policies. **M**
- [ ] Site URL and redirect URL allow-list contain only real domains (no `*` wildcards on production, no `localhost`).
- [ ] OAuth providers: only the ones in use are enabled; client secrets stored only in the dashboard.
- [ ] Email templates do not leak data and use the correct domain; OTP expiry is short.
- [ ] Custom access token hook / auth hooks reviewed if used (they run with elevated privileges).

## 5. Storage

- [ ] **(tool)** List buckets and their `public` flag: `select id, public, file_size_limit, allowed_mime_types from storage.buckets;`
- [ ] Public buckets only contain content meant for everyone (logos, product images). Private documents in public buckets = **C**.
- [ ] Policies on `storage.objects` restrict by `bucket_id` **and** by owner folder (`(storage.foldername(name))[1] = auth.uid()::text`) or `owner_id`.
- [ ] Separate policies for `select`, `insert`, `update` (upsert), `delete`.
- [ ] No policy on `storage.buckets` lets anon list or create buckets.
- [ ] `file_size_limit` and `allowed_mime_types` set (prevents HTML/SVG upload used for phishing / XSS, and storage abuse).
- [ ] App uses `createSignedUrl` with short expiry for private files, not `getPublicUrl`.
- [ ] Retention: sensitive uploads (IDs, contracts) deleted when no longer needed (GDPR data minimisation).

## 6. Database functions (RPC) and triggers

- [ ] **(tool)** List functions exposed through `/rest/v1/rpc/`.
- [ ] Find `SECURITY DEFINER` functions: `select oid::regprocedure, prosecdef, proconfig from pg_proc where pronamespace = 'public'::regnamespace and prosecdef;`
- [ ] Every `SECURITY DEFINER` function has `set search_path = ''` (or a fixed safe path) and schema-qualified names. **M/H**
- [ ] `SECURITY DEFINER` functions validate the caller (`auth.uid()`) and never act on a user ID passed in as a parameter without checking it. **H**
- [ ] Functions return only the columns needed (no `returns setof <table>` with personal data to anon).
- [ ] `execute` revoked from `anon` / `public` where not needed; default privileges adjusted for future functions.
- [ ] Prefer `security invoker` so RLS applies.
- [ ] Triggers on `auth.users` (e.g. `handle_new_user`) do not copy `role`/permissions from `raw_user_meta_data`. **H**
- [ ] Functions in non-exposed schemas used for internal logic (e.g. `private` schema).
- [ ] Database webhooks / `pg_net` calls do not send secrets or personal data to third parties unexpectedly.

## 7. Edge Functions

- [ ] `verify_jwt` is on (default) unless the function is a public webhook; public webhooks verify signatures (Stripe, GitHub...).
- [ ] The function checks **authorisation**, not only authentication: is this user allowed to do this action / on this resource?
- [ ] When using the service role inside a function, user input is validated and queries are scoped to the caller.
- [ ] Secrets come from `Deno.env.get()` / `supabase secrets`, none hardcoded; `.env` files not committed.
- [ ] CORS: `Access-Control-Allow-Origin` restricted to the app's domains for sensitive endpoints.
- [ ] Input validation (zod or similar), size limits, and no raw SQL built from strings.
- [ ] Errors do not leak stack traces or internal data.
- [ ] Rate limiting for expensive or abusable endpoints (AI calls, emails, SMS).

## 8. Secrets in the repository

- [ ] **(tool)** Scan working tree for JWTs (decode, flag `service_role`), `sb_secret_`, `sk_live_`, `sk-`, private keys.
- [ ] **(tool)** `.env` files not committed; `.gitignore` covers `.env*` with `!.env.example`.
- [ ] Scan full git history (`gitleaks detect`, `trufflehog git`). Deleted secrets are still in history.
- [ ] CI/CD secrets stored in the platform's secret store; logs do not print them.
- [ ] Lovable / Bolt / v0 projects: check the generated `src/integrations/supabase/client.ts` and any "admin" helpers.

## 9. API surface and network

- [ ] Exposed schemas limited to what the frontend needs (Settings > API).
- [ ] `max_rows` (API settings) set to a sensible value to limit bulk extraction.
- [ ] Network restrictions / SSL enforcement enabled for direct database connections where possible.
- [ ] Database password is strong and not reused; connection strings not in the frontend.
- [ ] GraphQL (`pg_graphql`) disabled if not used, or reviewed with the same RLS logic.
- [ ] Realtime: channels/tables published to Realtime respect RLS; broadcast/presence authorisation configured for private channels.

## 10. Abuse and rate limits

- [ ] Auth rate limits and CAPTCHA (section 4).
- [ ] Business-level limits in the database (e.g. max pending bookings per user, max invitations per day).
- [ ] Edge Functions that send email/SMS or call paid APIs are rate limited per user.
- [ ] Spend cap / usage alerts configured on the Supabase organisation.

## 11. Backups and resilience

- [ ] Plan includes daily backups; PITR considered for business-critical data.
- [ ] A restore has been tested at least once (to a separate project).
- [ ] Migrations are in version control (`supabase/migrations`) and applied through CI, not by hand in production.
- [ ] Staging project exists and mirrors production schema.

## 12. Monitoring and advisors

- [ ] Supabase **Security Advisor** and **Performance Advisor**: zero errors; warnings explained.
- [ ] Logs reviewed for spikes of 401/403, sign-ups, or unusual RPC calls.
- [ ] Log drains / alerts configured for production (Team plan and above), or a weekly manual review.

## 13. Privacy / compliance (EU clients)

- [ ] Personal data inventory: which tables hold personal or special-category data (health, ID documents).
- [ ] Data minimisation and retention rules implemented (scheduled deletion).
- [ ] Project region appropriate (EU region for EU users when required); DPA with Supabase accepted.
- [ ] If an exposure is found: tell the client to assess GDPR Art. 33/34 notification with their advisor (I do not give legal advice).

## 14. Delivery

- [ ] Every finding has: plain-English description, evidence (no personal data, secrets redacted), business impact, fix, references.
- [ ] Fixes delivered as a migration file, tested on staging with the access matrix.
- [ ] Dashboard changes documented step by step (or done together on a call).
- [ ] Retest after fixes; before/after table in the report.
- [ ] Remove my access (collaborator, org member) at the end and confirm in writing. Delete any local copies of client data or keys.
