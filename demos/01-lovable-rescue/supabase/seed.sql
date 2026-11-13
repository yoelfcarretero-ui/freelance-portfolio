-- Seed data. Runs automatically after migrations on `npx supabase db reset`.
-- For a cloud project, paste it into the SQL editor once.
-- Service ids match src/data/seed.ts so links work the same in local and Supabase mode.

insert into public.services (id, name, description, duration_minutes, price_cents) values
  ('6a1f6c3e-1c1e-4c71-9a51-0d2d6b6f0001', 'Women''s cut & style', 'Consultation, wash, precision cut and blow-dry finish.', 60, 4500),
  ('6a1f6c3e-1c1e-4c71-9a51-0d2d6b6f0002', 'Men''s cut', 'Scissor or clipper cut, wash and styling.', 30, 2200),
  ('6a1f6c3e-1c1e-4c71-9a51-0d2d6b6f0003', 'Colour refresh', 'Root touch-up or gloss to revive colour between full sessions.', 60, 5800),
  ('6a1f6c3e-1c1e-4c71-9a51-0d2d6b6f0004', 'Beard trim', 'Shape, line-up and hot towel finish.', 30, 1500),
  ('6a1f6c3e-1c1e-4c71-9a51-0d2d6b6f0005', 'Blow-dry', 'Wash and blow-dry for an event or just because.', 45, 2800)
on conflict (id) do nothing;

-- Admin accounts are not seeded (that would mean a password in the repo).
-- Sign up through the app, then promote yourself from the SQL editor / psql:
--
--   update public.profiles set role = 'admin' where email = 'you@example.com';
