import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStorage } from '../test/memoryStorage';
import { AuthError, ForbiddenError, NotFoundError, SlotTakenError, ValidationError } from './DataLayer';
import { LocalDataLayer } from './localDataLayer';
import { DEMO_ACCOUNTS, SEED_SERVICES } from './seed';

// Wednesday 15 July 2026, 06:00 UTC = 08:00 Madrid, before opening.
const NOW = new Date('2026-07-15T06:00:00Z');
const SLOT = '2026-07-16T09:00:00.000Z'; // Thursday 11:00 Madrid (10:00 is taken by the seed)
const SERVICE = SEED_SERVICES[0].id;

let storage: MemoryStorage;
const makeLayer = () => new LocalDataLayer({ storage, now: () => NOW });

beforeEach(() => {
  storage = new MemoryStorage();
});

async function signUpNewUser(layer: LocalDataLayer, email = 'new@example.com') {
  return layer.signUp({ email, password: 'password123', fullName: 'New Customer' });
}

describe('LocalDataLayer - auth', () => {
  it('logs in with the seeded demo account', async () => {
    const layer = makeLayer();
    const session = await layer.signIn(DEMO_ACCOUNTS.customer.email, DEMO_ACCOUNTS.customer.password);
    expect(session.profile).toMatchObject({ email: DEMO_ACCOUNTS.customer.email, role: 'customer' });
  });

  it('rejects a wrong password', async () => {
    await expect(makeLayer().signIn(DEMO_ACCOUNTS.customer.email, 'nope')).rejects.toBeInstanceOf(AuthError);
  });

  it('signs up new users as customers and rejects duplicate e-mails', async () => {
    const layer = makeLayer();
    const { session } = await signUpNewUser(layer);
    expect(session?.profile.role).toBe('customer');
    await expect(signUpNewUser(layer)).rejects.toBeInstanceOf(AuthError);
  });

  it('validates sign-up input', async () => {
    await expect(
      makeLayer().signUp({ email: 'x@example.com', password: 'short', fullName: 'X' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('restores the session in a new instance, like a page refresh (BUG B)', async () => {
    await makeLayer().signIn(DEMO_ACCOUNTS.customer.email, DEMO_ACCOUNTS.customer.password);
    const afterRefresh = makeLayer();
    expect((await afterRefresh.getSession())?.user.email).toBe(DEMO_ACCOUNTS.customer.email);
  });

  it('notifies auth listeners on sign in and sign out', async () => {
    const layer = makeLayer();
    const events: (string | null)[] = [];
    const unsubscribe = layer.onAuthStateChange((s) => events.push(s?.user.email ?? null));
    await layer.signIn(DEMO_ACCOUNTS.admin.email, DEMO_ACCOUNTS.admin.password);
    await layer.signOut();
    unsubscribe();
    await layer.signIn(DEMO_ACCOUNTS.admin.email, DEMO_ACCOUNTS.admin.password);
    expect(events).toEqual([DEMO_ACCOUNTS.admin.email, null]);
  });
});

describe('LocalDataLayer - bookings', () => {
  it('requires a session to book', async () => {
    await expect(makeLayer().createBooking({ serviceId: SERVICE, startsAt: SLOT })).rejects.toBeInstanceOf(AuthError);
  });

  it('creates a booking and stores it as a UTC instant', async () => {
    const layer = makeLayer();
    await signUpNewUser(layer);
    const booking = await layer.createBooking({ serviceId: SERVICE, startsAt: SLOT });
    expect(booking).toMatchObject({ starts_at: SLOT, ends_at: '2026-07-16T10:00:00.000Z', status: 'confirmed' });
    expect(await layer.getBookedSlots('2026-07-16T00:00:00Z', '2026-07-17T00:00:00Z')).toContain(SLOT);
  });

  it('rejects a double booking of the same slot by another user (BUG C)', async () => {
    const alice = makeLayer();
    await signUpNewUser(alice, 'alice@example.com');
    await alice.createBooking({ serviceId: SERVICE, startsAt: SLOT });

    const bob = makeLayer();
    await signUpNewUser(bob, 'bob@example.com');
    // Same instant written differently must still clash.
    await expect(
      bob.createBooking({ serviceId: SEED_SERVICES[1].id, startsAt: '2026-07-16T11:00:00+02:00' }),
    ).rejects.toBeInstanceOf(SlotTakenError);
  });

  it('frees the slot again when the booking is cancelled', async () => {
    const layer = makeLayer();
    await signUpNewUser(layer);
    const first = await layer.createBooking({ serviceId: SERVICE, startsAt: SLOT });
    await layer.cancelBooking(first.id);
    await expect(layer.createBooking({ serviceId: SERVICE, startsAt: SLOT })).resolves.toMatchObject({
      status: 'confirmed',
    });
  });

  it('rejects slots outside opening hours or in the past', async () => {
    const layer = makeLayer();
    await signUpNewUser(layer);
    await expect(layer.createBooking({ serviceId: SERVICE, startsAt: '2026-07-16T20:00:00.000Z' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(layer.createBooking({ serviceId: SERVICE, startsAt: '2026-07-14T08:00:00.000Z' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("only lists the current user's bookings (RLS parity, BUG A)", async () => {
    const layer = makeLayer();
    const { session } = await signUpNewUser(layer);
    await layer.createBooking({ serviceId: SERVICE, startsAt: SLOT });
    const mine = await layer.listMyBookings();
    expect(mine).toHaveLength(1);
    expect(mine.every((b) => b.user_id === session!.user.id)).toBe(true);
    expect(mine[0]).toMatchObject({ service_name: SEED_SERVICES[0].name, customer_name: 'New Customer' });
  });

  it("does not let a customer cancel somebody else's booking", async () => {
    const alice = makeLayer();
    await signUpNewUser(alice, 'alice@example.com');
    const booking = await alice.createBooking({ serviceId: SERVICE, startsAt: SLOT });

    const bob = makeLayer();
    await signUpNewUser(bob, 'bob@example.com');
    await expect(bob.cancelBooking(booking.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('only admins can list every booking', async () => {
    const layer = makeLayer();
    await layer.signIn(DEMO_ACCOUNTS.customer.email, DEMO_ACCOUNTS.customer.password);
    await expect(layer.listAllBookings()).rejects.toBeInstanceOf(ForbiddenError);

    await layer.signIn(DEMO_ACCOUNTS.admin.email, DEMO_ACCOUNTS.admin.password);
    const all = await layer.listAllBookings();
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all.map((b) => b.user_id)).size).toBeGreaterThan(1);
  });

  it('seeds a few future bookings so the demo is not empty', async () => {
    const booked = await makeLayer().getBookedSlots('2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z');
    expect(booked.length).toBeGreaterThanOrEqual(4);
    expect(booked.every((iso) => new Date(iso) > NOW)).toBe(true);
  });
});
