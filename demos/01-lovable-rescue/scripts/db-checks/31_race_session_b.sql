begin; set local role authenticated; set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\echo 'B inserting same slot while A is still open...'
insert into public.bookings (service_id, starts_at, ends_at) values ('6a1f6c3e-1c1e-4c71-9a51-0d2d6b6f0002', '2030-01-10T10:00:00+01:00', '2030-01-10T11:00:00+01:00');
commit;
