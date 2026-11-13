-- =============================================================================
-- SlotBook - initial schema (fixed version)
--
-- Fixes applied compared to the original AI-generated schema
-- (see docs/BEFORE_AFTER.md for the full story):
--   BUG A  RLS was disabled on bookings  -> RLS enabled on every table + policies below
--   BUG C  double booking race           -> partial unique index bookings_one_per_slot
--   BUG F  "timestamp" + local strings   -> timestamptz everywhere
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------
create type public.user_role as enum ('customer', 'admin');
create type public.booking_status as enum ('confirmed', 'cancelled');

-- -----------------------------------------------------------------------------
-- profiles: one row per auth user, created by trigger on signup
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        public.user_role not null default 'customer',
  created_at  timestamptz not null default now()
);

comment on table public.profiles is 'Public profile for each auth user. role is changed only by admins / SQL.';

-- -----------------------------------------------------------------------------
-- services: the salon catalogue, publicly readable
-- -----------------------------------------------------------------------------
create table public.services (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  description       text not null default '',
  duration_minutes  integer not null check (duration_minutes between 5 and 240),
  price_cents       integer not null check (price_cents >= 0),
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- bookings
-- -----------------------------------------------------------------------------
create table public.bookings (
  id          uuid primary key default gen_random_uuid(),
  -- Defaults to the caller, so the client never has to (and cannot usefully) send it.
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  service_id  uuid not null references public.services (id),
  -- BUG F fix: timestamptz stores an absolute instant. The browser sends ISO strings
  -- with an explicit offset ("...Z"), so the value no longer depends on anyone's timezone.
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  status      public.booking_status not null default 'confirmed',
  created_at  timestamptz not null default now(),
  constraint bookings_valid_range check (ends_at > starts_at)
);

-- BUG C fix: at most ONE confirmed booking per slot (the salon has one chair).
-- A partial unique index (rather than a plain UNIQUE constraint) lets a cancelled
-- booking free the slot again. Postgres enforces it atomically, so two simultaneous
-- inserts cannot both succeed: the loser gets error 23505, which the app turns into
-- a friendly "slot just taken" message.
create unique index bookings_one_per_slot
  on public.bookings (starts_at)
  where status = 'confirmed';

create index bookings_user_id_idx on public.bookings (user_id);
create index bookings_starts_at_idx on public.bookings (starts_at);

-- -----------------------------------------------------------------------------
-- Helper: is the current user an admin?
-- SECURITY DEFINER so it can read profiles without triggering profiles' own RLS
-- (calling a policy-protected table from inside its own policy causes infinite recursion).
-- -----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- -----------------------------------------------------------------------------
-- Trigger: create a profile automatically when someone signs up
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  -- role is NOT read from user metadata: metadata is writable by the user at signup.
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Availability without leaking personal data.
-- Customers cannot SELECT other people's bookings (RLS), but they need to know which
-- slots are taken. This function returns start times only.
-- -----------------------------------------------------------------------------
create or replace function public.get_booked_slots(p_from timestamptz, p_to timestamptz)
returns setof timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select b.starts_at
  from public.bookings b
  where b.status = 'confirmed'
    and b.starts_at >= p_from
    and b.starts_at < p_to
    and p_to - p_from <= interval '31 days'   -- no full-table dumps
  order by b.starts_at;
$$;

-- =============================================================================
-- Row Level Security (BUG A fix)
-- With RLS enabled and no matching policy, the default is DENY.
-- =============================================================================
alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.bookings enable row level security;

-- ---- profiles ---------------------------------------------------------------
create policy "profiles: read own or admin reads all"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Column-level privilege: users may change their name, never their role.
revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;

-- ---- services ---------------------------------------------------------------
create policy "services: anyone can read active services"
  on public.services for select
  to anon, authenticated
  using (active or (select public.is_admin()));

create policy "services: admins insert"
  on public.services for insert
  to authenticated
  with check ((select public.is_admin()));

create policy "services: admins update"
  on public.services for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---- bookings ---------------------------------------------------------------
create policy "bookings: read own or admin reads all"
  on public.bookings for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy "bookings: create own future confirmed booking"
  on public.bookings for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'confirmed'
    and starts_at > now()
  );

create policy "bookings: update own or admin updates any"
  on public.bookings for update
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_admin()));

-- Customers can only change the status column (i.e. cancel). They cannot move a booking
-- onto another slot or hand it to another user by editing other columns.
revoke update on public.bookings from authenticated, anon;
grant update (status) on public.bookings to authenticated;

-- No DELETE policy on purpose: bookings are cancelled (soft delete), keeping history.

-- Anonymous visitors get nothing from bookings, not even via the API.
revoke all on public.bookings from anon;

-- ---- functions --------------------------------------------------------------
revoke execute on function public.get_booked_slots(timestamptz, timestamptz) from public;
grant execute on function public.get_booked_slots(timestamptz, timestamptz) to anon, authenticated;
revoke execute on function public.is_admin() from public;
-- anon needs it too: the services read policy calls it (it simply returns false for anon).
grant execute on function public.is_admin() to anon, authenticated;
