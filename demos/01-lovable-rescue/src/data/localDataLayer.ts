/**
 * Offline implementation of DataLayer backed by localStorage.
 *
 * Purpose: the app can be deployed as a static demo (no backend, no keys) and still be
 * fully clickable. It deliberately enforces the SAME rules as the Supabase backend:
 *   - a slot can only hold one confirmed booking (like the partial unique index),
 *   - users only see and cancel their own bookings (like the RLS policies),
 *   - only admins can list every booking.
 *
 * This is NOT a security boundary - everything lives in the visitor's own browser.
 * The real protection is in supabase/migrations.
 */
import type { Booking, BookingWithDetails, Profile, Role, Service, Session } from '../lib/types';
import { isBookableSlot, getBookableDays, generateDaySlots, slotEnd, toEpoch } from '../lib/slots';
import {
  AuthError,
  ForbiddenError,
  NotFoundError,
  SlotTakenError,
  ValidationError,
  type DataLayer,
  type SignUpInput,
  type SignUpResult,
} from './DataLayer';
import { DEMO_ACCOUNTS, SEED_EXTRA_CUSTOMERS, SEED_SERVICES } from './seed';

export const DB_KEY = 'slotbook:v1:db';
export const SESSION_KEY = 'slotbook:v1:session';

interface LocalUser {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  password_hash: string;
}

interface LocalDb {
  version: 1;
  users: LocalUser[];
  services: Service[];
  bookings: Booking[];
}

export interface LocalDataLayerOptions {
  /** Defaults to window.localStorage. Tests pass an in-memory Storage. */
  storage?: Storage;
  /** Injectable clock so tests are deterministic. */
  now?: () => Date;
  /** Artificial latency so loading states are visible in the demo. 0 in tests. */
  latencyMs?: number;
}

/**
 * FNV-1a hash. Only used so demo passwords are not stored verbatim in localStorage.
 * NOT a password hashing algorithm - real auth is handled by Supabase (bcrypt, server side).
 */
function demoHash(input: string): string {
  let hash = 0x811c9dc5;
  const salted = `slotbook-demo:${input}`;
  for (let i = 0; i < salted.length; i++) {
    hash ^= salted.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (plain http on a LAN IP, old browsers).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const normaliseEmail = (email: string) => email.trim().toLowerCase();

export class LocalDataLayer implements DataLayer {
  readonly mode = 'local' as const;

  private readonly storage: Storage;
  private readonly now: () => Date;
  private readonly latencyMs: number;
  private readonly listeners = new Set<(session: Session | null) => void>();

  constructor(options: LocalDataLayerOptions = {}) {
    this.storage = options.storage ?? window.localStorage;
    this.now = options.now ?? (() => new Date());
    this.latencyMs = options.latencyMs ?? 0;
    this.ensureSeeded();

    // Keep several open tabs in sync, like supabase-js does.
    if (typeof window !== 'undefined' && this.storage === window.localStorage) {
      window.addEventListener('storage', (event) => {
        if (event.key === SESSION_KEY) this.emit(this.readSession());
      });
    }
  }

  // ---------------------------------------------------------------- auth

  async getSession(): Promise<Session | null> {
    await this.delay();
    return this.readSession();
  }

  onAuthStateChange(callback: (session: Session | null) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  async signUp({ email, password, fullName }: SignUpInput): Promise<SignUpResult> {
    await this.delay();
    const cleanEmail = normaliseEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new ValidationError('Please enter a valid e-mail address.');
    }
    if (password.length < 8) throw new ValidationError('Password must be at least 8 characters.');
    if (!fullName.trim()) throw new ValidationError('Please tell us your name.');

    const db = this.read();
    if (db.users.some((u) => u.email === cleanEmail)) {
      throw new AuthError('An account with this e-mail already exists. Try logging in.');
    }
    const user: LocalUser = {
      id: uuid(),
      email: cleanEmail,
      full_name: fullName.trim(),
      role: 'customer', // never trust a role coming from the client
      password_hash: demoHash(password),
    };
    db.users.push(user);
    this.write(db);
    const session = this.startSession(user);
    return { session, needsEmailConfirmation: false };
  }

  async signIn(email: string, password: string): Promise<Session> {
    await this.delay();
    const user = this.read().users.find((u) => u.email === normaliseEmail(email));
    if (!user || user.password_hash !== demoHash(password)) {
      throw new AuthError('Invalid e-mail or password.');
    }
    return this.startSession(user);
  }

  async signOut(): Promise<void> {
    // Clear first: signing out must take effect even if the user navigates away immediately.
    this.storage.removeItem(SESSION_KEY);
    await this.delay();
    this.emit(null);
  }

  // ----------------------------------------------------------- catalogue

  async listServices(): Promise<Service[]> {
    await this.delay();
    return [...this.read().services].sort((a, b) => a.price_cents - b.price_cents);
  }

  async getService(id: string): Promise<Service | null> {
    await this.delay();
    return this.read().services.find((s) => s.id === id) ?? null;
  }

  // ------------------------------------------------------------ bookings

  async getBookedSlots(fromIso: string, toIso: string): Promise<string[]> {
    await this.delay();
    const from = toEpoch(fromIso);
    const to = toEpoch(toIso);
    return this.read()
      .bookings.filter((b) => {
        const start = toEpoch(b.starts_at);
        return b.status === 'confirmed' && start >= from && start < to;
      })
      .map((b) => b.starts_at);
  }

  async createBooking({ serviceId, startsAt }: { serviceId: string; startsAt: string }): Promise<Booking> {
    await this.delay();
    const user = this.requireUser();
    // Read, check and write happen synchronously after this point, so two clicks in the
    // same tab cannot interleave. Across real users the database index does this job.
    const db = this.read();
    if (!db.services.some((s) => s.id === serviceId)) throw new NotFoundError('Service not found.');
    if (!isBookableSlot(startsAt, this.now())) {
      throw new ValidationError('That time is not available for booking.');
    }
    const start = toEpoch(startsAt);
    const clash = db.bookings.some((b) => b.status === 'confirmed' && toEpoch(b.starts_at) === start);
    if (clash) throw new SlotTakenError();

    const booking: Booking = {
      id: uuid(),
      user_id: user.id,
      service_id: serviceId,
      starts_at: new Date(start).toISOString(),
      ends_at: slotEnd(startsAt),
      status: 'confirmed',
      created_at: this.now().toISOString(),
    };
    db.bookings.push(booking);
    this.write(db);
    return booking;
  }

  async listMyBookings(): Promise<BookingWithDetails[]> {
    await this.delay();
    const user = this.requireUser();
    const db = this.read();
    return this.withDetails(
      db,
      db.bookings.filter((b) => b.user_id === user.id),
    );
  }

  async cancelBooking(bookingId: string): Promise<void> {
    await this.delay();
    const user = this.requireUser();
    const db = this.read();
    const booking = db.bookings.find((b) => b.id === bookingId);
    // Same behaviour as RLS: a booking you are not allowed to see simply "does not exist".
    if (!booking || (booking.user_id !== user.id && user.role !== 'admin')) {
      throw new NotFoundError('Booking not found.');
    }
    booking.status = 'cancelled';
    this.write(db);
  }

  async listAllBookings(): Promise<BookingWithDetails[]> {
    await this.delay();
    const user = this.requireUser();
    if (user.role !== 'admin') throw new ForbiddenError();
    const db = this.read();
    return this.withDetails(db, db.bookings);
  }

  // ------------------------------------------------------------- helpers

  private withDetails(db: LocalDb, bookings: Booking[]): BookingWithDetails[] {
    return bookings
      .map((b) => {
        const customer = db.users.find((u) => u.id === b.user_id);
        return {
          ...b,
          service_name: db.services.find((s) => s.id === b.service_id)?.name ?? 'Unknown service',
          customer_name: customer?.full_name ?? 'Unknown',
          customer_email: customer?.email ?? '',
        };
      })
      .sort((a, b) => toEpoch(a.starts_at) - toEpoch(b.starts_at));
  }

  private requireUser(): LocalUser {
    const userId = this.storage.getItem(SESSION_KEY);
    const user = userId ? this.read().users.find((u) => u.id === userId) : undefined;
    if (!user) throw new AuthError('Please log in first.');
    return user;
  }

  private startSession(user: LocalUser): Session {
    this.storage.setItem(SESSION_KEY, user.id);
    const session = toSession(user);
    this.emit(session);
    return session;
  }

  private readSession(): Session | null {
    const userId = this.storage.getItem(SESSION_KEY);
    if (!userId) return null;
    const user = this.read().users.find((u) => u.id === userId);
    return user ? toSession(user) : null;
  }

  private emit(session: Session | null) {
    for (const listener of this.listeners) listener(session);
  }

  private delay() {
    return this.latencyMs > 0 ? new Promise((r) => setTimeout(r, this.latencyMs)) : Promise.resolve();
  }

  private read(): LocalDb {
    const raw = this.storage.getItem(DB_KEY);
    if (!raw) throw new Error('Local database not initialised');
    return JSON.parse(raw) as LocalDb;
  }

  private write(db: LocalDb) {
    this.storage.setItem(DB_KEY, JSON.stringify(db));
  }

  private ensureSeeded() {
    const raw = this.storage.getItem(DB_KEY);
    if (raw) {
      try {
        if ((JSON.parse(raw) as LocalDb).version === 1) return;
      } catch {
        // Corrupted data: fall through and reseed.
      }
    }
    this.write(buildSeedDb(this.now()));
  }
}

function toSession(user: LocalUser): Session {
  const profile: Profile = { id: user.id, email: user.email, full_name: user.full_name, role: user.role };
  return { user: { id: user.id, email: user.email }, profile };
}

/** Seed users plus a few bookings in the coming days, relative to `now`. */
export function buildSeedDb(now: Date): LocalDb {
  const mkUser = (email: string, fullName: string, role: Role, password: string): LocalUser => ({
    id: uuid(),
    email,
    full_name: fullName,
    role,
    password_hash: demoHash(password),
  });
  const demo = mkUser(DEMO_ACCOUNTS.customer.email, DEMO_ACCOUNTS.customer.fullName, 'customer', DEMO_ACCOUNTS.customer.password);
  const admin = mkUser(DEMO_ACCOUNTS.admin.email, DEMO_ACCOUNTS.admin.fullName, 'admin', DEMO_ACCOUNTS.admin.password);
  // Extra customers cannot log in (random password); they only populate the calendar.
  const extras = SEED_EXTRA_CUSTOMERS.map((c) => mkUser(c.email, c.fullName, 'customer', uuid()));

  const bookings: Booking[] = [];
  const owners = [extras[0], extras[1], demo, extras[0], extras[1]];
  const days = getBookableDays(now).slice(0, 4);
  let n = 0;
  for (const day of days) {
    const future = generateDaySlots(day).filter((s) => toEpoch(s.startsAt) > now.getTime());
    // Take a couple of spread-out slots per day so the grid looks realistic.
    for (const index of [1, 4]) {
      const slot = future[index];
      if (!slot) continue;
      const owner = owners[n % owners.length];
      bookings.push({
        id: uuid(),
        user_id: owner.id,
        service_id: SEED_SERVICES[n % SEED_SERVICES.length].id,
        starts_at: slot.startsAt,
        ends_at: slot.endsAt,
        status: 'confirmed',
        created_at: now.toISOString(),
      });
      n++;
    }
  }

  return { version: 1, users: [demo, admin, ...extras], services: SEED_SERVICES, bookings };
}
