export type Role = 'customer' | 'admin';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  duration_minutes: number;
  price_cents: number;
}

export type BookingStatus = 'confirmed' | 'cancelled';

/**
 * A booking as stored. `starts_at` / `ends_at` are ISO-8601 strings in UTC
 * (the database column is `timestamptz`). Never store "local" wall-clock strings - see BUG F.
 */
export interface Booking {
  id: string;
  user_id: string;
  service_id: string;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  created_at: string;
}

/** Booking joined with the data the UI needs to render it. */
export interface BookingWithDetails extends Booking {
  service_name: string;
  customer_name: string;
  customer_email: string;
}

export interface Session {
  user: { id: string; email: string };
  profile: Profile;
}
