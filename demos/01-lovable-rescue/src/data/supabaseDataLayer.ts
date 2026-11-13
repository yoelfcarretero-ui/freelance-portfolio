import type { PostgrestError, SupabaseClient, User } from '@supabase/supabase-js';
import type { Booking, BookingWithDetails, Profile, Service, Session } from '../lib/types';
import { slotEnd } from '../lib/slots';
import {
  AuthError,
  DataLayerError,
  ForbiddenError,
  NotFoundError,
  SlotTakenError,
  ValidationError,
  type DataLayer,
  type SignUpInput,
  type SignUpResult,
} from './DataLayer';

/** Postgres error codes we translate into user-facing errors. */
export const PG_UNIQUE_VIOLATION = '23505';
const PG_INSUFFICIENT_PRIVILEGE = '42501';
const PG_INVALID_TEXT_REPRESENTATION = '22P02';
const PG_CHECK_VIOLATION = '23514';

interface BookingRow extends Booking {
  services: { name: string } | null;
  profiles: { full_name: string; email: string } | null;
}

const BOOKING_COLUMNS = 'id, user_id, service_id, starts_at, ends_at, status, created_at';
const BOOKING_SELECT = `${BOOKING_COLUMNS}, services(name), profiles(full_name, email)`;
const SERVICE_COLUMNS = 'id, name, description, duration_minutes, price_cents';

function toDetails(row: BookingRow): BookingWithDetails {
  const { services, profiles, ...booking } = row;
  return {
    ...booking,
    service_name: services?.name ?? 'Unknown service',
    customer_name: profiles?.full_name ?? 'Unknown',
    customer_email: profiles?.email ?? '',
  };
}

function fail(error: PostgrestError | { message: string }): never {
  throw new DataLayerError(error.message);
}

export class SupabaseDataLayer implements DataLayer {
  readonly mode = 'supabase' as const;

  constructor(private readonly client: SupabaseClient) {}

  // ---------------------------------------------------------------- auth

  private async toSession(user: User): Promise<Session> {
    const { data } = await this.client
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('id', user.id)
      .maybeSingle<Profile>();
    // The profile row is created by a database trigger on signup. If it is somehow
    // missing we still return a usable, least-privileged session.
    const profile: Profile = data ?? {
      id: user.id,
      email: user.email ?? '',
      full_name: (user.user_metadata?.full_name as string | undefined) ?? '',
      role: 'customer',
    };
    return { user: { id: user.id, email: user.email ?? '' }, profile };
  }

  async getSession(): Promise<Session | null> {
    const { data, error } = await this.client.auth.getSession();
    if (error || !data.session) return null;
    return this.toSession(data.session.user);
  }

  onAuthStateChange(callback: (session: Session | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      // Supabase docs: do not await other Supabase calls inside this callback, it runs
      // while the auth lock is held and can dead-lock. Defer the profile fetch instead.
      setTimeout(() => {
        if (!session) {
          callback(null);
          return;
        }
        void this.toSession(session.user).then(callback);
      }, 0);
    });
    return () => data.subscription.unsubscribe();
  }

  async signUp({ email, password, fullName }: SignUpInput): Promise<SignUpResult> {
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      // Read by the handle_new_user() trigger to fill profiles.full_name.
      options: { data: { full_name: fullName }, emailRedirectTo: window.location.origin },
    });
    if (error) throw new AuthError(error.message);
    if (!data.session || !data.user) return { session: null, needsEmailConfirmation: true };
    return { session: await this.toSession(data.user), needsEmailConfirmation: false };
  }

  async signIn(email: string, password: string): Promise<Session> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error || !data.user) throw new AuthError(error?.message ?? 'Invalid e-mail or password.');
    return this.toSession(data.user);
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) throw new AuthError(error.message);
  }

  // ----------------------------------------------------------- catalogue

  async listServices(): Promise<Service[]> {
    const { data, error } = await this.client.from('services').select(SERVICE_COLUMNS).order('price_cents');
    if (error) fail(error);
    return (data ?? []) as Service[];
  }

  async getService(id: string): Promise<Service | null> {
    const { data, error } = await this.client
      .from('services')
      .select(SERVICE_COLUMNS)
      .eq('id', id)
      .maybeSingle<Service>();
    if (error) {
      if (error.code === PG_INVALID_TEXT_REPRESENTATION) return null; // not a uuid
      fail(error);
    }
    return data;
  }

  // ------------------------------------------------------------ bookings

  async getBookedSlots(fromIso: string, toIso: string): Promise<string[]> {
    // SECURITY DEFINER function: returns only start times, never who booked them,
    // because RLS (correctly) hides other people's bookings from this user.
    const { data, error } = await this.client.rpc('get_booked_slots', { p_from: fromIso, p_to: toIso });
    if (error) fail(error);
    return (data ?? []) as string[];
  }

  async createBooking({ serviceId, startsAt }: { serviceId: string; startsAt: string }): Promise<Booking> {
    const { data, error } = await this.client
      .from('bookings')
      // user_id is filled by the column default auth.uid() and enforced by RLS.
      // starts_at is a full ISO instant with "Z", stored in a timestamptz column (BUG F fix).
      .insert({ service_id: serviceId, starts_at: startsAt, ends_at: slotEnd(startsAt) })
      .select(BOOKING_COLUMNS)
      .single<Booking>();
    if (error) {
      // BUG C fix: the partial unique index is the single source of truth. If two people
      // click at the same moment, exactly one insert wins and the other gets 23505.
      if (error.code === PG_UNIQUE_VIOLATION) throw new SlotTakenError();
      if (error.code === PG_INSUFFICIENT_PRIVILEGE || error.code === PG_CHECK_VIOLATION) {
        throw new ValidationError('That time is not available for booking.');
      }
      fail(error);
    }
    return data;
  }

  async listMyBookings(): Promise<BookingWithDetails[]> {
    const { data: auth } = await this.client.auth.getUser();
    if (!auth.user) throw new AuthError('Please log in first.');
    const { data, error } = await this.client
      .from('bookings')
      .select(BOOKING_SELECT)
      .eq('user_id', auth.user.id)
      .order('starts_at');
    if (error) fail(error);
    return ((data ?? []) as unknown as BookingRow[]).map(toDetails);
  }

  async cancelBooking(bookingId: string): Promise<void> {
    const { data, error } = await this.client
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('id', bookingId)
      .select('id');
    if (error) fail(error);
    // RLS turns "not yours" into "0 rows updated" rather than an error.
    if (!data || data.length === 0) throw new NotFoundError('Booking not found.');
  }

  async listAllBookings(): Promise<BookingWithDetails[]> {
    const session = await this.getSession();
    // UX check only. The real guard is the RLS policy using public.is_admin().
    if (session?.profile.role !== 'admin') throw new ForbiddenError();
    const { data, error } = await this.client.from('bookings').select(BOOKING_SELECT).order('starts_at');
    if (error) fail(error);
    return ((data ?? []) as unknown as BookingRow[]).map(toDetails);
  }
}
