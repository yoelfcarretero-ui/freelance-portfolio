-- =============================================================================
-- SlotBook: security hardening migration
-- Migration name: 20261006120000_security_hardening.sql
-- Author:         Yoel Carretero (security audit, October 2026)
--
-- Sample deliverable. SlotBook is a fictional company; this script is written
-- for the schema described in AUDIT_REPORT.md:
--
--   public.profiles (id uuid pk -> auth.users, full_name, phone, avatar_url,
--                    role text check (role in ('customer','staff','owner')))
--   public.services (id, name, duration_min, price_cents, is_active)
--   public.bookings (id, service_id, customer_id uuid -> profiles, customer_name,
--                    customer_phone, starts_at, ends_at, status, notes, created_at)
--
-- How to apply:
--   1. Take a backup first (pg_dump or the dashboard backup).
--   2. Apply on STAGING:   supabase db push   (or paste into the SQL editor)
--   3. Run the test matrix in AUDIT_REPORT.md (anon / customer A / customer B / staff).
--   4. Apply on PRODUCTION in a low-traffic window.
--
-- Findings covered: SB-02, SB-03, SB-04, SB-05, SB-07 (booking cap), SB-08 (MFA).
-- SB-01 (service_role key), SB-06/07/08 (Auth settings) are dashboard / code
-- changes; see the notes at the end of this file.
--
-- The whole migration runs in one transaction: either everything applies or nothing.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Section 1. Helper function and function privilege baseline
-- -----------------------------------------------------------------------------

-- By default Postgres lets PUBLIC (and therefore anon) execute every new function.
-- Revoke that for existing functions and for functions created in the future,
-- then grant execute explicitly only where it is needed.
-- NOTE: on Supabase, extensions live in the "extensions" schema, so this only
-- touches the application's own functions in "public".
revoke execute on all functions in schema public from public, anon;
-- Supabase grants EXECUTE to anon through schema-level default privileges...
alter default privileges for role postgres in schema public revoke execute on functions from anon;
-- ...while the PUBLIC grant is a global Postgres default, so it must be revoked
-- without "in schema" (a schema-level revoke cannot remove a global default).
alter default privileges for role postgres revoke execute on functions from public;

-- is_staff(): used by many policies below.
-- SECURITY DEFINER on purpose: it reads public.profiles while being called from
-- profiles' own policies, which would otherwise recurse. It is safe because:
--   * search_path is pinned to '' and every object is schema-qualified,
--   * it only answers a yes/no question about the CURRENT user (auth.uid()),
--   * anon cannot execute it.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('staff', 'owner')
  );
$$;

revoke execute on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;


-- -----------------------------------------------------------------------------
-- Section 2. Tables: bookings (SB-02) and services
-- -----------------------------------------------------------------------------

-- SB-02: the root cause. Without this, every policy below is ignored.
alter table public.bookings enable row level security;

-- Visitors who are not logged in have no business touching bookings at all.
-- (Free slots are served by get_busy_slots(), section 4.)
revoke all on public.bookings from anon;

-- Remove the permissive policies generated during prototyping, if present.
drop policy if exists "Enable read access for all users" on public.bookings;
drop policy if exists "Enable insert for all users"      on public.bookings;
drop policy if exists "Allow all"                        on public.bookings;

-- Indexes so that policy checks stay fast as the table grows.
create index if not exists bookings_customer_id_idx on public.bookings (customer_id);
create index if not exists bookings_starts_at_idx   on public.bookings (starts_at);

-- One policy per operation and audience. Permissive policies are OR-ed together.
-- (select auth.uid()) is wrapped in a sub-select so Postgres evaluates it once
-- per query instead of once per row.

-- SELECT
create policy "bookings: customers read own"
  on public.bookings for select
  to authenticated
  using ((select auth.uid()) = customer_id);

create policy "bookings: staff read all"
  on public.bookings for select
  to authenticated
  using ((select public.is_staff()));

-- INSERT: customers can only book for themselves, in the future, as 'pending'.
create policy "bookings: customers create own"
  on public.bookings for insert
  to authenticated
  with check (
    (select auth.uid()) = customer_id
    and status = 'pending'
    and starts_at > now()
  );

create policy "bookings: staff create"
  on public.bookings for insert
  to authenticated
  with check ((select public.is_staff()));

-- UPDATE: customers may only cancel their own future bookings.
-- USING decides which rows can be targeted, WITH CHECK validates the new row.
create policy "bookings: customers cancel own future"
  on public.bookings for update
  to authenticated
  using ((select auth.uid()) = customer_id and starts_at > now())
  with check ((select auth.uid()) = customer_id and status = 'cancelled');

create policy "bookings: staff update"
  on public.bookings for update
  to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

-- DELETE: staff only. Customers cancel instead of deleting (keeps history).
create policy "bookings: staff delete"
  on public.bookings for delete
  to authenticated
  using ((select public.is_staff()));

-- Policies cannot restrict WHICH columns change, and column grants cannot tell
-- customers from staff (both use the "authenticated" role). A trigger closes
-- the gap: a customer's update may change the status column and nothing else.
create or replace function public.bookings_guard_customer_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Service role, migrations and staff are not restricted by this guard.
  if current_user <> 'authenticated' or public.is_staff() then
    return new;
  end if;

  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'Customers can only change the status of a booking'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_guard_customer_update on public.bookings;
create trigger bookings_guard_customer_update
  before update on public.bookings
  for each row execute function public.bookings_guard_customer_update();

-- SB-07 (database side): cap each customer at 3 future pending bookings,
-- so a single account cannot flood the calendar.
create or replace function public.bookings_limit_pending()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and not public.is_staff() then
    if (
      select count(*)
      from public.bookings b
      where b.customer_id = new.customer_id
        and b.status = 'pending'
        and b.starts_at > now()
    ) >= 3 then
      raise exception 'You already have 3 pending bookings'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_limit_pending on public.bookings;
create trigger bookings_limit_pending
  before insert on public.bookings
  for each row execute function public.bookings_limit_pending();

-- services: a public price list. Readable by everyone, writable by staff only.
alter table public.services enable row level security;
revoke insert, update, delete on public.services from anon;

drop policy if exists "Enable read access for all users" on public.services;

create policy "services: anyone can read active services"
  on public.services for select
  to anon, authenticated
  using (is_active);

create policy "services: staff read all"
  on public.services for select
  to authenticated
  using ((select public.is_staff()));

create policy "services: staff write"
  on public.services for all
  to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));


-- -----------------------------------------------------------------------------
-- Section 3. profiles: stop self-promotion to staff (SB-05)
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
revoke all on public.profiles from anon;

drop policy if exists "Users can update own profile"              on public.profiles;
drop policy if exists "Public profiles are viewable by everyone." on public.profiles;

create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "profiles: staff read all"
  on public.profiles for select
  to authenticated
  using ((select public.is_staff()));

create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- The actual fix for SB-05: column-level privileges.
-- Logged-in users may edit their name, phone and avatar, never their role.
-- Profiles are created by the handle_new_user() trigger and deleted with the
-- auth user, so the API does not need insert/delete on this table.
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name, phone, avatar_url) on public.profiles to authenticated;

-- Harden the sign-up trigger generated by the starter template:
--   * pinned search_path,
--   * the role is NEVER taken from raw_user_meta_data (the user controls it).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;  -- role falls back to its column default: 'customer'
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- Section 4. RPC functions (SB-04)
-- -----------------------------------------------------------------------------

-- The old function returned every column of every booking, ran as its owner
-- (bypassing RLS), had a mutable search_path and was executable by anon.
drop function if exists public.get_bookings_for_day(date);

-- Replacement: returns ONLY the busy time ranges for a day, nothing personal.
-- SECURITY DEFINER is deliberate here (a visitor must see that 10:00 is taken
-- without being able to read whose booking it is), so it follows the rules:
-- pinned search_path, qualified names, minimal output, explicit grants.
create or replace function public.get_busy_slots(day date)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.starts_at, b.ends_at
  from public.bookings b
  where b.starts_at >= (day::timestamp at time zone 'Europe/Madrid')
    and b.starts_at <  ((day + 1)::timestamp at time zone 'Europe/Madrid')
    and b.status in ('pending', 'confirmed')
  order by b.starts_at;
$$;

revoke execute on function public.get_busy_slots(date) from public;
grant execute on function public.get_busy_slots(date) to anon, authenticated;


-- -----------------------------------------------------------------------------
-- Section 5. Storage: private ID documents (SB-03)
-- -----------------------------------------------------------------------------

-- Make the bucket private and restrict what can be uploaded to it.
update storage.buckets
set public = false,
    file_size_limit = 5242880,  -- 5 MB
    allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf']
where id = 'id-documents';

-- Remove the catch-all policies created while prototyping.
drop policy if exists "Public Access"                     on storage.objects;
drop policy if exists "Anyone can upload an id document"  on storage.objects;
drop policy if exists "Public bucket listing"             on storage.buckets;

-- Files live under <user id>/<file name>. Customers only touch their own folder.
create policy "id-documents: customers upload to own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'id-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "id-documents: customers read own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'id-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "id-documents: staff read all"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'id-documents' and (select public.is_staff()));

create policy "id-documents: staff delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'id-documents' and (select public.is_staff()));

-- No update policy: an uploaded ID cannot be silently replaced.
-- The app now uses createSignedUrl(path, 60) instead of getPublicUrl().


-- -----------------------------------------------------------------------------
-- Section 6. Staff must use MFA (SB-08, defence in depth)
-- -----------------------------------------------------------------------------

-- RESTRICTIVE policies are AND-ed with the permissive ones above.
-- Customers are unaffected; staff sessions need Authenticator Assurance Level 2.
create policy "bookings: staff require mfa"
  on public.bookings as restrictive for all
  to authenticated
  using (not (select public.is_staff()) or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (not (select public.is_staff()) or (select auth.jwt() ->> 'aal') = 'aal2');

create policy "profiles: staff require mfa"
  on public.profiles as restrictive for all
  to authenticated
  using ((select auth.uid()) = id or (select auth.jwt() ->> 'aal') = 'aal2');

commit;


-- =============================================================================
-- Section 7. Verification queries (run after the migration; read-only)
-- =============================================================================

-- 7.1 Tables in the exposed schema WITHOUT RLS. Expected: no rows.
--     Use this as a CI check: fail the pipeline if it returns anything.
select n.nspname as schema, c.relname as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and n.nspname = 'public'
  and not c.relrowsecurity;

-- 7.2 Every policy, per operation. Review "qual" (USING) and "with_check".
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, cmd, policyname;

-- 7.3 SECURITY DEFINER functions without a pinned search_path. Expected: no rows.
select p.oid::regprocedure as function, p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and not exists (
    select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%'
  );

-- 7.4 Functions anon can execute. Expected: only get_busy_slots(date).
select p.oid::regprocedure as function
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and has_function_privilege('anon', p.oid, 'execute');

-- 7.5 Public buckets. Expected: only buckets meant to be public (none for SlotBook).
select id, public, file_size_limit, allowed_mime_types from storage.buckets;

-- 7.6 Simulate an anonymous visitor (rolled back, changes nothing).
begin;
  set local role anon;
  select count(*) as anon_visible_services from public.services;  -- > 0, by design
  -- select count(*) from public.bookings;                        -- ERROR 42501, expected
rollback;

-- 7.7 Simulate a logged-in customer (replace the UUID with a test user's id).
begin;
  set local role authenticated;
  select set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
  select count(*) as my_bookings from public.bookings;            -- only own rows
  -- update public.profiles set role = 'staff'
  --   where id = '00000000-0000-0000-0000-00000000000a';         -- ERROR 42501, expected
rollback;


-- =============================================================================
-- Changes that are NOT SQL (done in the dashboard / code, listed for completeness)
-- =============================================================================
--
-- SB-01  Service role key in the frontend
--        * Project Settings > API Keys: create new secret key, disable legacy
--          JWT-based anon/service_role keys after the frontend uses the new
--          publishable key.
--        * Remove VITE_SUPABASE_SERVICE_ROLE_KEY and src/lib/supabaseAdmin.ts.
--        * Staff actions -> Edge Function "staff-actions" (verifies JWT + is_staff()).
--        * supabase secrets set SUPABASE_SECRET_KEY=...   (never in the repo)
--        * git filter-repo to purge the key from history.
--
-- SB-06  Authentication > Sign In / Providers > Email > Confirm email = ON
--        Custom SMTP configured.
--
-- SB-07  Authentication > Rate Limits: sign-ups and sign-ins 30 / 5 min / IP.
--        Authentication > Attack Protection: CAPTCHA (Cloudflare Turnstile) ON.
--
-- SB-08  Authentication > Attack Protection: minimum password length 10,
--        letters + digits required, leaked password protection ON.
--        MFA (TOTP) enabled and enrolled for all staff accounts.
--
-- Local development equivalent (supabase/config.toml):
--
--   [auth]
--   minimum_password_length = 10
--   password_requirements = "letters_digits"
--
--   [auth.email]
--   enable_confirmations = true
--
--   [auth.rate_limit]
--   sign_in_sign_ups = 30
--
--   [auth.mfa.totp]
--   enroll_enabled = true
--   verify_enabled = true
-- =============================================================================
