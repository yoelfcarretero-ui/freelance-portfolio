# Security Audit Report: SlotBook

> **Sample deliverable.** SlotBook is a fictional company created for this portfolio. All names, figures, project references and keys in this document are invented. The structure, methodology and fixes are exactly what a real client receives.

| | |
|---|---|
| **Client** | SlotBook (salon booking web app) |
| **Application** | React + Vite frontend (built with Lovable), Supabase backend |
| **Supabase project** | `abcd1234efgh` (production), `wxyz9876stuv` (staging) |
| **Auditor** | Yoel Carretero, yoelf.carretero@gmail.com |
| **Audit window** | 2026-10-05 to 2026-10-07 |
| **Retest** | 2026-10-09 |
| **Report version** | 1.1 (final, includes retest) |
| **Classification** | Confidential: client and auditor only |

---

## 1. Executive summary

SlotBook lets salon customers book appointments online and lets staff manage the calendar. The app works well, but at the start of the audit **anyone on the internet could download every booking (names, phone numbers and private notes), every ID document uploaded by customers, and could take full control of the database** using information that is visible in the website itself.

None of this required hacking skills. The problems came from settings that are easy to miss when an app is generated quickly: database tables without access rules, a master key placed in the website code, and a file folder left public.

**What we found:** 9 issues: 3 Critical, 2 High, 2 Medium, 1 Low, 1 Informational.

**What we fixed:** all Critical, High and Medium issues were fixed during the engagement and verified in a retest. The Low issue was fixed too. One informational item (backups) needs a plan upgrade and is left as a recommendation.

| Risk level | Before | After retest |
|---|---:|---:|
| Critical | 3 | 0 |
| High | 2 | 0 |
| Medium | 2 | 0 |
| Low | 1 | 0 |
| Info | 1 | 1 (accepted, see SB-09) |

**Most important actions for the founder, in plain words:**

1. The old master key (service_role) was **rotated** on 2026-10-06. Any copy of it that someone may have taken is now useless. Done.
2. Customers' ID scans are **no longer public**. Since there is evidence they were reachable for about 5 months, talk to your data protection advisor about whether a GDPR breach assessment and notification (Art. 33/34) is needed. Server logs showed no mass download, but absence of evidence is not proof.
3. Upgrade to a plan with daily backups / Point-in-Time Recovery before the busy season (SB-09).

---

## 2. Scope and authorisation

**Authorisation.** This audit was performed at the request of the owner of SlotBook, who confirmed in writing (email of 2026-10-03) that they own the Supabase projects and the code repository listed below, and authorised a configuration and code review including read-only requests against the production API. Write tests were performed **only on the staging project**. No denial-of-service, social engineering or third-party systems were in scope.

**In scope**

- Supabase projects `abcd1234efgh` (production, read-only access) and `wxyz9876stuv` (staging, full access).
- Database schema `public` and `storage`, Row Level Security policies, functions, triggers, grants.
- Supabase Auth configuration, Storage buckets and policies, Edge Functions (`send-reminder`).
- GitHub repository `slotbook-web` (main branch and history) and the production JavaScript bundle.

**Out of scope**

- Hosting provider configuration (DNS, CDN), payment provider dashboard, email provider.
- Penetration testing of the Supabase platform itself.

**Access used.** Read-only collaborator access to the repository; "Developer" role on the Supabase organisation; the public anon key as any visitor would see it. The auditor never stored customer data: where evidence required looking at data, only counts and column names were recorded.

---

## 3. Methodology

The audit follows the checklist in [`docs/CHECKLIST.md`](../docs/CHECKLIST.md), in four phases:

1. **Outside-in (attacker's view).** Using only what the public website exposes (URL and anon key from the JS bundle) we ran the open source tool [`supabase-rls-check`](../supabase-rls-check) to list exposed tables, functions, buckets and auth settings with read-only requests.
2. **Inside review.** With dashboard access: RLS status and every policy per table and per operation, function definitions (`SECURITY DEFINER`, `search_path`, grants), storage policies, Auth settings, Edge Function code and secrets, Supabase Security Advisor output.
3. **Code review.** Repository and git history scanned for keys (`supabase-rls-check --repo`, `gitleaks`), review of how the frontend talks to Supabase, review of the production bundle.
4. **Fix and retest.** Fixes were written as a SQL migration ([`fixes.sql`](./fixes.sql)), applied to staging, tested with three test accounts (anonymous visitor, customer A, customer B, staff), then applied to production after client approval. Finally, phase 1 was repeated.

**Risk rating.** Each finding is rated by *likelihood* (how easy it is to exploit) and *impact* (what happens to the business):

| Rating | Meaning |
|---|---|
| Critical | Exploitable today by anyone with a browser; leads to a data breach or loss of control. Fix immediately. |
| High | Exploitable by any registered user, or requires little effort; serious impact. Fix within days. |
| Medium | Requires specific conditions or has limited impact. Fix within weeks. |
| Low | Defence in depth / hardening. |
| Info | Good practice or business decision; no direct vulnerability. |

---

## 4. Findings overview

| ID | Risk | Finding | Area | Status |
|---|---|---|---|---|
| SB-01 | **Critical** | Service role (master) key shipped in the website code | Secrets | Fixed, key rotated |
| SB-02 | **Critical** | `bookings` table has no Row Level Security: all bookings readable and editable by anyone | Database | Fixed |
| SB-03 | **Critical** | Public storage bucket `id-documents` contains customers' ID scans | Storage | Fixed |
| SB-04 | **High** | `get_bookings_for_day` is `SECURITY DEFINER`, has no fixed `search_path` and is callable by anonymous users | Database functions | Fixed |
| SB-05 | **High** | Any customer can make themselves staff by editing `profiles.role` | Database | Fixed |
| SB-06 | **Medium** | Email confirmation disabled: accounts can be created with someone else's email | Auth | Fixed |
| SB-07 | **Medium** | No effective rate limiting or CAPTCHA on sign-up | Auth | Fixed |
| SB-08 | **Low** | Weak password policy, leaked-password protection off | Auth | Fixed |
| SB-09 | Info | No Point-in-Time Recovery; Free plan without downloadable backups | Resilience | Recommendation |

---

## 5. Detailed findings

### SB-01 [Critical] Service role (master) key shipped in the website code

**What this means.** Supabase gives every project two kinds of keys. The *anon* key is meant to be public: it only allows what your access rules allow. The *service_role* key is the master key: it ignores every rule. SlotBook's website contained the master key, so any visitor could open the browser developer tools, copy it, and read, change or delete anything, including all user accounts.

**Evidence**

- `src/lib/supabaseAdmin.ts:3` creates a client with `import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY`. Variables starting with `VITE_` are embedded in the public bundle at build time.
- The production bundle `assets/index-4f2a9c.js` contains a JWT whose payload decodes to `"role": "service_role"` (value redacted: `eyJhbGciOi...Q8xM`).
- It was used to let staff cancel bookings and delete customers through `supabase.auth.admin.deleteUser()` called from `src/pages/staff/Customers.tsx:88`.
- Git history: present since commit `9be1c04` (2026-05-12), roughly 5 months.
- Tool output: `[CRITICAL] The service_role key is inside your frontend code` and `[CRITICAL] The service_role key is exposed through a public environment variable`.

**Business impact.** Complete loss of control: full database export, deletion of all bookings and users, account takeover, defacement. Every customer's personal data was effectively public for 5 months.

**Fix applied**

1. The client rotated the key on 2026-10-06 (Project Settings > API: migrated to the new API keys, created a new `sb_secret_` key for server use and **disabled the legacy JWT-based keys**). Old copies of the key no longer work.
2. Removed `supabaseAdmin.ts` and `VITE_SUPABASE_SERVICE_ROLE_KEY` from the frontend.
3. Staff-only actions moved to an Edge Function `staff-actions` that verifies the caller's JWT, checks `public.is_staff()`, and only then uses the secret key stored with `supabase secrets set`.
4. The key was purged from git history with `git filter-repo`; collaborators re-cloned.

**Retest.** New bundle and repository scanned: no `service_role` or `sb_secret_` keys. Calling the old key returns `401 Invalid API key`. Customer B calling `staff-actions` receives `403`. **Closed.**

---

### SB-02 [Critical] `bookings` table has no Row Level Security

**What this means.** Row Level Security (RLS) is the set of rules that decides which rows each user can see or change. The `bookings` table had it switched off, so the public anon key had full access to it: anyone could list every appointment and also change or delete them.

**Evidence**

- `GET /rest/v1/bookings?select=*&limit=1` with the anon key returned HTTP 200 and one row. Columns exposed: `id, service_id, customer_id, customer_name, customer_phone, starts_at, ends_at, status, notes, created_at`.
- SQL editor: `select relrowsecurity from pg_class where oid = 'public.bookings'::regclass;` returned `false`. The table holds 1,214 rows (count only, no data exported).
- On **staging**, an anonymous `PATCH /rest/v1/bookings?id=eq.<test id>` changed a test booking status: write access confirmed.
- The `notes` column contains free text written by staff, in some cases health information relevant to treatments (allergies), which is special category data under GDPR Art. 9.

**Business impact.** Data breach of every customer's name, phone and appointment history; anyone could cancel or move other people's appointments, causing lost revenue and reputational damage.

**Fix applied** (see `fixes.sql`, section 2)

- `alter table public.bookings enable row level security;`
- Policies per operation: customers see and create only their own bookings, can cancel (not edit) their own future bookings; staff see and manage all bookings; nobody can delete except staff.
- Anonymous visitors get no access to `bookings` at all. Free slots are now provided by a narrow function (`get_busy_slots`, see SB-04).
- Added an index on `bookings(customer_id)` so the policies stay fast.

**Retest.**

| Actor | select | insert | update | delete |
|---|---|---|---|---|
| Anonymous | denied (`42501 permission denied`) | denied | denied | denied |
| Customer A | own 3 bookings only | own only | cancel own only | denied |
| Customer B trying A's booking | 0 rows | denied (`with check`) | 0 rows affected | denied |
| Staff | all | all | all | allowed |

**Closed.**

---

### SB-03 [Critical] Public storage bucket `id-documents` contains customers' ID scans

**What this means.** Some treatments require age verification, so customers upload a photo of their ID. Those files were stored in a bucket marked *public*, which means any file can be downloaded by anyone who has the link, without logging in. File names followed the pattern `<user id>/dni.jpg`, and user IDs were visible through SB-02, so the links could be built easily.

**Evidence**

- `select id, public from storage.buckets;` returned `id-documents | true` (312 objects).
- Tool output: `[CRITICAL] Bucket "id-documents" is public`.
- A test file uploaded by the auditor's test account on staging was downloadable from a private browser window via `/storage/v1/object/public/id-documents/...`.
- The frontend used `getPublicUrl()` to display the image in the staff panel.

**Business impact.** Identity documents are among the most sensitive personal data a small business can hold: risk of identity fraud for customers and a reportable GDPR incident.

**Fix applied** (`fixes.sql`, section 5)

- Bucket set to private. Storage policies: a customer can upload and read only files inside their own folder (`<auth.uid()>/...`); staff can read all; nobody can update or delete except staff.
- Staff panel switched to `createSignedUrl(path, 60)` (links valid 60 seconds).
- Recommendation accepted by the client: delete ID scans 30 days after verification (data minimisation), implemented as a scheduled Edge Function.

**Retest.** The old public URLs return `400 Bucket not found` / not public. Customer B cannot read Customer A's folder. **Closed.**

---

### SB-04 [High] `get_bookings_for_day` is `SECURITY DEFINER`, without fixed `search_path`, callable by anonymous users

**What this means.** The booking page needs to know which time slots are taken. A database function was written for that, but it was declared `SECURITY DEFINER` (it runs with the owner's privileges and skips RLS), returned *every column* of the bookings (including phone numbers and notes), and anyone could call it. Even after fixing SB-02, this function alone would have kept all bookings public. It also did not set a `search_path`, a known weakness that lets a malicious object in another schema hijack the function.

**Evidence**

```sql
create function public.get_bookings_for_day(day date)
returns setof public.bookings
language sql security definer
as $$ select * from bookings where starts_at::date = day $$;
```

- `has_function_privilege('anon', 'public.get_bookings_for_day(date)', 'execute')` returned `true`.
- Supabase Security Advisor: `function_search_path_mutable` warning for this function.
- Tool output: `[MEDIUM] 1 database function can be called from the browser` (escalated to High after reading its definition).

**Business impact.** Same data exposure as SB-02 through a side door; possible privilege escalation via `search_path`.

**Fix applied** (`fixes.sql`, section 4)

- Function dropped and replaced with `get_busy_slots(day date)` that returns **only** `starts_at, ends_at`. It stays `SECURITY DEFINER` on purpose (customers must see that a slot is taken without seeing whose it is), with `set search_path = ''`, fully qualified table names, and `execute` granted explicitly.
- `revoke execute on all functions in schema public from anon, public` followed by explicit grants, and default privileges changed so new functions are not executable by `anon` automatically.

**Retest.** `rpc/get_bookings_for_day` returns 404. `rpc/get_busy_slots` returns only time ranges. Security Advisor shows no function warnings. **Closed.**

---

### SB-05 [High] Any customer can make themselves staff by editing `profiles.role`

**What this means.** Staff permissions depend on the `role` column in each user's profile. The rule that lets users edit their own profile (name, phone) did not restrict *which* columns can be edited, so any customer could send one request setting their own role to `staff` and gain access to the staff panel and every booking.

**Evidence**

- Policy `"Users can update own profile"`: `for update using (auth.uid() = id)` with no `with check` and no column restriction.
- On staging, test customer B ran `supabase.from('profiles').update({ role: 'staff' }).eq('id', B)` and then could read all bookings.

**Business impact.** Privilege escalation from any free account to full staff access.

**Fix applied** (`fixes.sql`, section 3)

- Column-level privileges: `authenticated` may only update `full_name, phone, avatar_url`. The `role` column can only be changed by the service role (via the `staff-actions` Edge Function used by the owner).
- Added `with check (auth.uid() = id)` to the update policy so a row cannot be reassigned to another user.

**Retest.** The same request now fails with `42501 permission denied for table profiles`. **Closed.**

---

### SB-06 [Medium] Email confirmation disabled

**What this means.** New accounts were active immediately without proving they own the email address. Someone could register with a real customer's email, book under their name, or create accounts in bulk.

**Evidence.** `GET /auth/v1/settings` returned `"mailer_autoconfirm": true`. 23 accounts in `auth.users` used obviously fake or mistyped domains.

**Business impact.** Fake bookings blocking real slots (no-shows), impersonation, emails sent to people who never signed up (spam complaints hurt email deliverability).

**Fix applied.** *Authentication > Sign In / Providers > Email > Confirm email* enabled; custom SMTP configured (the built-in email service is rate limited and not meant for production). Email templates translated to Spanish.

**Retest.** `mailer_autoconfirm: false`. A new test account cannot log in before confirming. **Closed.**

---

### SB-07 [Medium] No effective rate limiting or CAPTCHA on sign-up

**What this means.** During development, the sign-up rate limit had been raised to a very high value to make testing easier, and no CAPTCHA was configured. A script could create thousands of accounts and fake bookings.

**Evidence.** *Authentication > Rate Limits*: sign-ups and sign-ins set to 1,000 per 5 minutes per IP. On 2026-09-14, 412 accounts were created within 40 minutes from the same IP range, all with unconfirmed throwaway emails (possible because of SB-06).

**Business impact.** Calendar flooding (denial of service for real customers), email sending costs, polluted marketing data.

**Fix applied.** Rate limits restored to conservative values (sign-up/sign-in 30 per 5 minutes per IP), Cloudflare Turnstile CAPTCHA enabled for sign-up and password reset, and a database constraint limiting each customer to 3 future pending bookings. The 412 spam accounts were removed by the client.

**Retest.** Sign-up without a CAPTCHA token returns `400 captcha verification process failed`. **Closed.**

---

### SB-08 [Low] Weak password policy, leaked-password protection off

**Evidence.** Minimum password length 6, no character requirements, leaked password protection (HaveIBeenPwned check) disabled.

**Impact.** Easier credential stuffing against staff accounts.

**Fix applied.** Minimum length 10, letters and digits required, leaked password protection enabled. Staff accounts enrolled in MFA (TOTP), and a restrictive policy requires `aal2` for staff actions (`fixes.sql`, section 6). **Closed.**

---

### SB-09 [Info] No Point-in-Time Recovery; Free plan without downloadable backups

**Observation.** The project is on the Free plan, which does not include downloadable daily backups or Point-in-Time Recovery. With SB-02 open, a single malicious `DELETE` would have wiped all bookings with no way back.

**Recommendation.** Upgrade to Pro (daily backups) and consider the PITR add-on before the December peak. Until then, a nightly `supabase db dump` to private storage was set up by the client as a stop-gap. **Accepted by the client; pending budget approval.**

---

## 6. Fixes applied

All database changes are in [`fixes.sql`](./fixes.sql), applied as migration `20261006120000_security_hardening.sql`:

1. Staging: migration applied, full test matrix run with anon / customer A / customer B / staff accounts. The same matrix is automated in [`verify-fixes/`](./verify-fixes): it rebuilds the insecure schema in an in-process Postgres, proves the vulnerabilities, applies `fixes.sql` and checks 34 expectations (`npm install && npm run verify`).
2. Production: applied 2026-10-07 at 07:30 (low traffic), after client approval and a manual `pg_dump`.
3. Frontend: PR "Security hardening" (removes admin client, uses signed URLs, CAPTCHA, calls `staff-actions` Edge Function), reviewed and deployed by the client.
4. Dashboard changes (Auth, rate limits, keys) done by the client during a screen-sharing session, documented step by step.

## 7. Retest results (2026-10-09)

Outside-in rerun of `supabase-rls-check` against production. After the fixes, the anon role only has privileges on the public `services` catalogue and on `get_busy_slots`, so the API schema no longer lists `bookings` or `profiles`; they were passed explicitly with `--tables`:

```
$ npx supabase-rls-check --url https://abcd1234efgh.supabase.co --anon-key $ANON \
    --tables bookings,profiles --public-tables services --out retest.md

supabase-rls-check v1.0.0  (read-only audit)
  project: https://abcd1234efgh.supabase.co

  Critical: 0   High: 0   Medium: 1   Low: 1   Info: 3

  [MEDIUM]    1 database function can be called from the browser
  [LOW]       Your full database schema is visible with the public key
  [INFO]      Table "services" is publicly readable (marked as intentional)
  [INFO]      Anyone can create an account
  [INFO]      2 sign-in methods enabled

  [PASS]      Table "bookings" refuses anonymous reads
  [PASS]      Table "profiles" refuses anonymous reads
  [PASS]      Email confirmation is required
  [PASS]      Bucket list is not visible to the public key

  No critical issues detected by the automated checks.
```

How to read the remaining items:

- **Medium, 1 function callable:** this is `get_busy_slots`, reviewed by hand. It is exposed on purpose, returns only time ranges and has a fixed `search_path`. Accepted.
- **Low, schema visible:** the schema now only shows `services` and `get_busy_slots`, both public by design. Accepted.
- **Info items:** `services` is a public price list (columns `id, name, duration_min, price_cents, is_active`); sign-up is open because SlotBook is a consumer app (now with email confirmation, CAPTCHA and rate limits); email and Google sign-in are both in use.

Repository and production bundle scan: 0 findings. Supabase Security Advisor: 0 errors, 0 warnings.

| ID | Before | After |
|---|---|---|
| SB-01 | Critical | Closed |
| SB-02 | Critical | Closed |
| SB-03 | Critical | Closed |
| SB-04 | High | Closed |
| SB-05 | High | Closed |
| SB-06 | Medium | Closed |
| SB-07 | Medium | Closed |
| SB-08 | Low | Closed |
| SB-09 | Info | Open (accepted) |

## 8. Recommendations going forward

1. **Make RLS the default.** Add a CI step that fails if any table in `public` has RLS disabled (query in `fixes.sql`, section 7) and run `supabase-rls-check --fail-on high` against staging on every deploy.
2. **Never put privileged keys in `VITE_` variables.** Anything prefixed `VITE_` is public. Privileged operations belong in Edge Functions.
3. **Review policies per operation** (`select`, `insert`, `update`, `delete`) whenever a table or column is added; Lovable and other AI tools often generate permissive `using (true)` policies.
4. **Data minimisation.** Delete ID scans after verification; avoid health information in free-text `notes`, or move it to a separate table readable only by staff.
5. **Backups.** Upgrade plan and test a restore at least once per quarter (SB-09).
6. **Monitoring.** Enable log drains or review Auth and API logs weekly for spikes in sign-ups or 401/403 errors.
7. **Re-audit** after major features (payments, multi-salon support) or at least once a year.

---

*Prepared by Yoel Carretero. This report reflects the state of the systems during the audit window. Security is a process: new code can introduce new issues.*
