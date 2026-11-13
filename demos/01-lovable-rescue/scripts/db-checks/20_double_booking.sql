\echo 'R1 sequential double booking (expect duplicate key error 23505)'
select starts_at as taken from public.bookings where status = 'confirmed' limit 1 \gset
begin; set local role authenticated; set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.bookings (service_id, starts_at, ends_at) values ('6a1f6c3e-1c1e-4c71-9a51-0d2d6b6f0001', :'taken', (:'taken')::timestamptz + interval '1 hour');
rollback;
