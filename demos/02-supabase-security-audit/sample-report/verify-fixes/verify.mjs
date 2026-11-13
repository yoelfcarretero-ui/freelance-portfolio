// Verifies ../fixes.sql against a real Postgres engine (PGlite, Postgres compiled to WASM)
// with minimal stand-ins for Supabase's roles, auth.uid()/auth.jwt() and storage schema.
//
//   cd sample-report/verify-fixes && npm install && npm run verify
//
// It builds SlotBook in its INSECURE state, proves the vulnerabilities exist, applies the
// migration, then replays the access matrix from AUDIT_REPORT.md as anon, two customers
// and a staff member. Exit code 0 = every expectation met.
//
// Limitation: these are stubs, not the real Supabase stack (no PostgREST, GoTrue or
// Storage API). They model the SQL-level behaviour that RLS depends on.

import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixesPath = fileURLToPath(new URL('../fixes.sql', import.meta.url));
const db = new PGlite();

const A = '00000000-0000-0000-0000-00000000000a'; // customer A
const B = '00000000-0000-0000-0000-00000000000b'; // customer B
const S = '00000000-0000-0000-0000-00000000000c'; // staff member

await db.exec(`
  -- Supabase-like roles and helpers -------------------------------------------
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (id text primary key, name text, public boolean default false,
                                file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id serial primary key, bucket_id text references storage.buckets, name text);
  alter table storage.objects enable row level security;
  alter table storage.buckets enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
  grant usage on all sequences in schema storage to anon, authenticated;

  -- Supabase's default privileges on the public schema
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

  -- SlotBook, INSECURE state as found during the audit -------------------------
  create table public.profiles (
    id uuid primary key references auth.users, full_name text, phone text, avatar_url text,
    role text not null default 'customer' check (role in ('customer', 'staff', 'owner')));
  alter table public.profiles enable row level security;
  create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
  create policy "Public profiles are viewable by everyone." on public.profiles for select using (true);

  create table public.services (id bigint generated always as identity primary key, name text,
    duration_min int, price_cents int, is_active boolean default true);
  create table public.bookings (id bigint generated always as identity primary key,
    service_id bigint references public.services, customer_id uuid references public.profiles,
    customer_name text, customer_phone text, starts_at timestamptz, ends_at timestamptz,
    status text default 'pending', notes text, created_at timestamptz default now());

  create function public.get_bookings_for_day(day date) returns setof public.bookings
    language sql security definer as $$ select * from bookings where starts_at::date = day $$;
  create function public.handle_new_user() returns trigger language plpgsql security definer as
    $$ begin insert into profiles (id) values (new.id); return new; end $$;

  insert into storage.buckets values ('id-documents', 'id-documents', true, null, null);
  insert into auth.users values ('${A}', '{}'), ('${B}', '{}'), ('${S}', '{}');
  insert into public.profiles (id, full_name, role) values
    ('${A}', 'Customer A', 'customer'), ('${B}', 'Customer B', 'customer'), ('${S}', 'Staff', 'staff');
  insert into public.services (name, duration_min, price_cents) values ('Haircut', 30, 2500);
  insert into public.bookings (service_id, customer_id, customer_name, starts_at, ends_at) values
    (1, '${A}', 'A', now() + interval '2 days', now() + interval '2 days 30 min'),
    (1, '${B}', 'B', now() + interval '3 days', now() + interval '3 days 30 min');
  insert into storage.objects (bucket_id, name) values
    ('id-documents', '${A}/dni.jpg'), ('id-documents', '${B}/dni.jpg');
`);

/** Run one statement as a given role/user inside a rolled-back transaction. */
async function as(role, sub, aal, sql) {
  const claims = sub ? JSON.stringify({ sub, role, aal }) : '';
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    const res = await db.query(sql);
    return { rows: res.rows, affected: res.affectedRows ?? 0 };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec('rollback');
  }
}

let failures = 0;
function expect(label, result, predicate) {
  const ok = predicate(result);
  if (!ok) failures++;
  const shown = result.error ? `error: ${result.error}` : `rows=${JSON.stringify(result.rows)}${result.affected ? ` affected=${result.affected}` : ''}`;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n      ${shown.slice(0, 160)}`);
}
const denied = (r) => !!r.error && /permission denied|row-level security|only change the status|pending bookings/.test(r.error);
const count = (n) => (r) => !r.error && Number(r.rows[0]?.count) === n;
const affected = (n) => (r) => !r.error && r.affected === n;

console.log('\n== Before fixes: the vulnerabilities are real ==');
expect('SB-02 anon can read every booking', await as('anon', null, null, 'select count(*) from public.bookings'), count(2));
expect('SB-04 anon can call get_bookings_for_day', await as('anon', null, null, 'select count(*) from public.get_bookings_for_day(current_date + 2)'), (r) => !r.error);
expect('SB-05 customer can promote themselves to staff', await as('authenticated', A, 'aal1', `update public.profiles set role = 'staff' where id = '${A}'`), affected(1));

console.log('\n== Applying fixes.sql ==');
const fixes = readFileSync(fixesPath, 'utf8');
const [migration, verification] = fixes.split('\ncommit;');
await db.exec(migration + '\ncommit;');
console.log('Migration applied in a single transaction.');

console.log('\n== After fixes: access matrix ==');
// Anonymous visitor
expect('anon cannot read bookings', await as('anon', null, null, 'select count(*) from public.bookings'), denied);
expect('anon cannot read profiles', await as('anon', null, null, 'select count(*) from public.profiles'), denied);
expect('anon can read the public services catalogue', await as('anon', null, null, 'select count(*) from public.services'), count(1));
expect('anon gets only time ranges from get_busy_slots', await as('anon', null, null, 'select * from public.get_busy_slots(current_date + 2)'),
  (r) => !r.error && r.rows.length === 1 && Object.keys(r.rows[0]).join() === 'starts_at,ends_at');
expect('old get_bookings_for_day is gone', await as('anon', null, null, 'select * from public.get_bookings_for_day(current_date)'), (r) => /does not exist/.test(r.error ?? ''));
expect('anon cannot execute is_staff()', await as('anon', null, null, 'select public.is_staff()'), denied);

// Customers
expect('customer A sees only own booking', await as('authenticated', A, 'aal1', 'select customer_name from public.bookings'), (r) => !r.error && r.rows.length === 1 && r.rows[0].customer_name === 'A');
expect('customer B cannot cancel A\'s booking', await as('authenticated', B, 'aal1', `update public.bookings set status = 'cancelled' where customer_id = '${A}'`), affected(0));
expect('customer A can cancel own booking', await as('authenticated', A, 'aal1', `update public.bookings set status = 'cancelled' where customer_id = '${A}'`), affected(1));
expect('customer A cannot confirm own booking', await as('authenticated', A, 'aal1', `update public.bookings set status = 'confirmed' where customer_id = '${A}'`), denied);
expect('customer A cannot edit other columns while cancelling', await as('authenticated', A, 'aal1', `update public.bookings set notes = 'x', status = 'cancelled' where customer_id = '${A}'`), denied);
expect('customer A cannot book on behalf of B', await as('authenticated', A, 'aal1', `insert into public.bookings (service_id, customer_id, starts_at, ends_at) values (1, '${B}', now() + interval '5 days', now() + interval '5 days 30 min')`), denied);
expect('customer A can book for themselves', await as('authenticated', A, 'aal1', `insert into public.bookings (service_id, customer_id, starts_at, ends_at) values (1, '${A}', now() + interval '5 days', now() + interval '5 days 30 min')`), affected(1));
expect('customer A is capped at 3 pending bookings', await as('authenticated', A, 'aal1', `insert into public.bookings (service_id, customer_id, starts_at, ends_at) select 1, '${A}', now() + make_interval(days => g), now() + make_interval(days => g, mins => 30) from generate_series(10, 12) g`), denied);
expect('customer A cannot delete bookings', await as('authenticated', A, 'aal1', 'delete from public.bookings'), affected(0));
expect('customer A cannot change own role (SB-05)', await as('authenticated', A, 'aal1', `update public.profiles set role = 'staff' where id = '${A}'`), denied);
expect('customer A can still edit own name', await as('authenticated', A, 'aal1', `update public.profiles set full_name = 'New name' where id = '${A}'`), affected(1));
expect('customer A sees only own profile', await as('authenticated', A, 'aal1', 'select count(*) from public.profiles'), count(1));

// Staff
expect('staff without MFA (aal1) sees no bookings', await as('authenticated', S, 'aal1', 'select count(*) from public.bookings'), count(0));
expect('staff with MFA (aal2) sees all bookings', await as('authenticated', S, 'aal2', 'select count(*) from public.bookings'), count(2));
expect('staff with MFA can update any booking', await as('authenticated', S, 'aal2', `update public.bookings set notes = 'VIP'`), affected(2));
expect('staff with MFA sees all profiles', await as('authenticated', S, 'aal2', 'select count(*) from public.profiles'), count(3));

// Storage
expect('bucket id-documents is now private', { rows: (await db.query(`select public from storage.buckets where id = 'id-documents'`)).rows }, (r) => r.rows[0].public === false);
expect('customer A reads only own ID document', await as('authenticated', A, 'aal1', `select name from storage.objects where bucket_id = 'id-documents'`), (r) => !r.error && r.rows.length === 1 && r.rows[0].name.startsWith(A));
expect('customer B cannot upload into A\'s folder', await as('authenticated', B, 'aal1', `insert into storage.objects (bucket_id, name) values ('id-documents', '${A}/evil.jpg')`), denied);
expect('customer B can upload into own folder', await as('authenticated', B, 'aal1', `insert into storage.objects (bucket_id, name) values ('id-documents', '${B}/dni2.jpg')`), affected(1));
expect('anon cannot list ID documents', await as('anon', null, null, `select count(*) from storage.objects where bucket_id = 'id-documents'`), count(0));

console.log('\n== Verification queries from fixes.sql section 7 ==');
const [noRls, , mutableDefiner, anonFns, buckets] = await db.exec(verification.split('-- 7.6')[0]);
expect('7.1 no table without RLS', noRls, (r) => r.rows.length === 0);
expect('7.3 no SECURITY DEFINER function with mutable search_path', mutableDefiner, (r) => r.rows.length === 0);
expect('7.4 anon can execute only get_busy_slots', anonFns, (r) => r.rows.length === 1 && r.rows[0].function === 'get_busy_slots(date)');
expect('7.5 no public bucket', buckets, (r) => r.rows.every((b) => b.public === false));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
