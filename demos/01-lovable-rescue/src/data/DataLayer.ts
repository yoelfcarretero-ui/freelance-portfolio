import type { Booking, BookingWithDetails, Service, Session } from '../lib/types';

export type DataMode = 'local' | 'supabase';

export interface SignUpInput {
  email: string;
  password: string;
  fullName: string;
}

export interface SignUpResult {
  session: Session | null;
  /** True when the backend requires e-mail confirmation before the first login. */
  needsEmailConfirmation: boolean;
}

/**
 * Everything the UI needs from a backend. Pages and components only talk to this
 * interface, so the app runs the same against Supabase or against localStorage.
 */
export interface DataLayer {
  readonly mode: DataMode;

  // --- Auth -------------------------------------------------------------
  /** Restores a persisted session (e.g. after a page refresh). */
  getSession(): Promise<Session | null>;
  /** Subscribes to sign-in / sign-out / token refresh. Returns an unsubscribe function. */
  onAuthStateChange(callback: (session: Session | null) => void): () => void;
  signUp(input: SignUpInput): Promise<SignUpResult>;
  signIn(email: string, password: string): Promise<Session>;
  signOut(): Promise<void>;

  // --- Catalogue --------------------------------------------------------
  listServices(): Promise<Service[]>;
  getService(id: string): Promise<Service | null>;

  // --- Bookings ---------------------------------------------------------
  /**
   * Start instants of confirmed bookings in [fromIso, toIso). Returns no personal data,
   * so any visitor can see which slots are taken without seeing who took them.
   */
  getBookedSlots(fromIso: string, toIso: string): Promise<string[]>;
  /** @throws SlotTakenError when someone else already holds that slot. */
  createBooking(input: { serviceId: string; startsAt: string }): Promise<Booking>;
  listMyBookings(): Promise<BookingWithDetails[]>;
  cancelBooking(bookingId: string): Promise<void>;
  /** Admin only. @throws ForbiddenError for non-admins. */
  listAllBookings(): Promise<BookingWithDetails[]>;
}

/** Base class so the UI can show friendly messages for expected failures. */
export class DataLayerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class SlotTakenError extends DataLayerError {
  constructor() {
    super('Sorry, someone has just booked that slot. Please pick another time.');
  }
}

export class AuthError extends DataLayerError {}
export class ForbiddenError extends DataLayerError {
  constructor(message = 'You do not have permission to do that.') {
    super(message);
  }
}
export class ValidationError extends DataLayerError {}
export class NotFoundError extends DataLayerError {}
