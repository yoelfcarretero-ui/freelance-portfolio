begin; set local role authenticated; set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.bookings (service_id, starts_at, ends_at) values ('6a1f6c3e-1c1e-4c71-9a51-0d2d6b6f0001', '2030-01-10T09:00:00Z', '2030-01-10T10:00:00Z');
select pg_sleep(3);
commit;
\echo 'A committed'
