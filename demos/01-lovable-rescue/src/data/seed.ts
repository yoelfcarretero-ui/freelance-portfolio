import type { Service } from '../lib/types';

/**
 * Seed data for local (offline) mode. Mirrors supabase/seed.sql so both modes look the same.
 * Service ids are fixed UUIDs so deep links like /book/<id> work in both modes.
 */
export const SEED_SERVICES: Service[] = [
  {
    id: '6a1f6c3e-1c1e-4c71-9a51-0d2d6b6f0001',
    name: "Women's cut & style",
    description: 'Consultation, wash, precision cut and blow-dry finish.',
    duration_minutes: 60,
    price_cents: 4500,
  },
  {
    id: '6a1f6c3e-1c1e-4c71-9a51-0d2d6b6f0002',
    name: "Men's cut",
    description: 'Scissor or clipper cut, wash and styling.',
    duration_minutes: 30,
    price_cents: 2200,
  },
  {
    id: '6a1f6c3e-1c1e-4c71-9a51-0d2d6b6f0003',
    name: 'Colour refresh',
    description: 'Root touch-up or gloss to revive colour between full sessions.',
    duration_minutes: 60,
    price_cents: 5800,
  },
  {
    id: '6a1f6c3e-1c1e-4c71-9a51-0d2d6b6f0004',
    name: 'Beard trim',
    description: 'Shape, line-up and hot towel finish.',
    duration_minutes: 30,
    price_cents: 1500,
  },
  {
    id: '6a1f6c3e-1c1e-4c71-9a51-0d2d6b6f0005',
    name: 'Blow-dry',
    description: 'Wash and blow-dry for an event or just because.',
    duration_minutes: 45,
    price_cents: 2800,
  },
];

/**
 * Demo accounts for LOCAL MODE ONLY. They exist only in the visitor's browser and
 * are printed on the login screen on purpose; they are not credentials for any real system.
 */
export const DEMO_ACCOUNTS = {
  customer: { email: 'demo@slotbook.app', password: 'demo1234', fullName: 'Lucia Romero' },
  admin: { email: 'admin@slotbook.app', password: 'admin1234', fullName: 'Marta Salon Admin' },
} as const;

/** Other fake customers so the admin view and the slot grid are not empty. */
export const SEED_EXTRA_CUSTOMERS = [
  { email: 'pablo@example.com', fullName: 'Pablo Garcia' },
  { email: 'sofia@example.com', fullName: 'Sofia Martin' },
] as const;
