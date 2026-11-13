-- RLS / grants / trigger checks. Each line says what to expect; lines marked "expect ... error" MUST fail.
-- Run through scripts/verify-db.sh (plain Postgres in Docker, no Supabase account needed).
\set ON_ERROR_STOP 0
\pset footer off
-- users
insert into auth.users values
 ('11111111-1111-1111-1111-111111111111','alice@example.com','{"full_name":"Alice","role":"admin"}'),
 ('22222222-2222-2222-2222-222222222222','bob@example.com','{"full_name":"Bob"}'),
 ('33333333-3333-3333-3333-333333333333','admin@example.com','{"full_name":"Admin"}');
update public.profiles set role='admin' where email='admin@example.com';
select '1 trigger created profiles, metadata role ignored' as check, email, full_name, role from public.profiles order by email;

-- alice books
begin; set local role authenticated; set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.bookings (service_id, starts_at, ends_at) values ('6a1f6c3e-1c1e-4c71-9a51-0d2d6b6f0001', now() + interval '2 days', now() + interval '2 days 1 hour') returning '2 alice booked' as check, user_id;
commit;
-- bob cannot see alice's booking, but can see that the slot is taken
begin; set local role authenticated; set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select '3 bob sees bookings (expect 0)' as check, count(*) from public.bookings;
select '4 bob sees availability via rpc (expect 1)' as check, count(*) from public.get_booked_slots(now(), now() + interval '7 days');
rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\echo '5 bob tries booking on behalf of alice (expect RLS error)'
insert into public.bookings (user_id, service_id, starts_at, ends_at) values ('11111111-1111-1111-1111-111111111111','6a1f6c3e-1c1e-4c71-9a51-0d2d6b6f0001', now() + interval '3 days', now() + interval '3 days 1 hour');
rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\echo '6 bob books in the past (expect RLS error)'
insert into public.bookings (service_id, starts_at, ends_at) values ('6a1f6c3e-1c1e-4c71-9a51-0d2d6b6f0001', now() - interval '1 day', now() - interval '23 hours');
rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
with u as (update public.bookings set status='cancelled' returning id) select '7 bob cancels alice booking (expect 0 rows)' as check, count(*) from u;
rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\echo '8 bob promotes himself to admin (expect permission denied)'
update public.profiles set role='admin' where id='22222222-2222-2222-2222-222222222222';
rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
\echo '9 alice moves her booking (expect permission denied, only status is updatable)'
update public.bookings set starts_at = starts_at + interval '1 hour';
rollback;
begin; set local role anon;
select '10 anon reads services (expect 5)' as check, count(*) from public.services;
\echo '11 anon reads bookings (expect permission denied)'
select count(*) from public.bookings;
rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select '12 admin sees all bookings (expect 1)' as check, count(*) from public.bookings;
rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
with u as (update public.bookings set status='cancelled' returning id) select '13 alice cancels own (expect 1)' as check, count(*) from u;
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
rollback;
-- re-book the cancelled slot as bob: run as superuser lookup then as bob
select starts_at as freed from public.bookings \gset
begin; set local role authenticated; set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into public.bookings (service_id, starts_at, ends_at) values ('6a1f6c3e-1c1e-4c71-9a51-0d2d6b6f0002', :'freed', (:'freed')::timestamptz + interval '1 hour') returning '14 bob re-books freed slot (expect ok)' as check;
commit;
\echo '15 timezone: same instant, different offsets'
select '15 tz' as check, '2026-07-15T10:00:00+02:00'::timestamptz = '2026-07-15T08:00:00Z'::timestamptz as same_instant;
