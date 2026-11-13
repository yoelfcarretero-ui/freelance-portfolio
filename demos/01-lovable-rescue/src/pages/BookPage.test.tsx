import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlotTakenError } from '../data';
import { LocalDataLayer } from '../data/localDataLayer';
import { DEMO_ACCOUNTS, SEED_SERVICES } from '../data/seed';
import { MemoryStorage } from '../test/memoryStorage';
import { renderApp } from '../test/renderApp';

// Wednesday 15 July 2026, 08:00 in Madrid. Only Date is faked; timers stay real.
const NOW = new Date('2026-07-15T06:00:00Z');
const SERVICE = SEED_SERVICES[0];

let layer: LocalDataLayer;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  layer = new LocalDataLayer({ storage: new MemoryStorage() });
  await layer.signIn(DEMO_ACCOUNTS.customer.email, DEMO_ACCOUNTS.customer.password);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BookPage', () => {
  it('shows taken slots as disabled and books a free one', async () => {
    const user = userEvent.setup();
    renderApp(layer, `/book/${SERVICE.id}`);

    expect(await screen.findByRole('heading', { name: SERVICE.name })).toBeInTheDocument();
    // The seed books the 2nd future slot of the day: 10:00 Madrid.
    expect(await screen.findByRole('button', { name: '10:00 (Booked)' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '11:00' }));
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));

    expect(await screen.findByText(/Booking confirmed/)).toBeInTheDocument();
    expect(screen.getByText('Wed 15 Jul, 11:00')).toBeInTheDocument();
  });

  it('explains a lost race instead of crashing (BUG C)', async () => {
    const user = userEvent.setup();
    vi.spyOn(layer, 'createBooking').mockRejectedValueOnce(new SlotTakenError());
    renderApp(layer, `/book/${SERVICE.id}`);

    await user.click(await screen.findByRole('button', { name: '11:00' }));
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/someone has just booked that slot/i);
    // Selection is cleared so the user must pick again.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm booking' })).toBeDisabled());
  });

  it('asks guests to log in before booking', async () => {
    await layer.signOut();
    const user = userEvent.setup();
    renderApp(layer, `/book/${SERVICE.id}`);

    await user.click(await screen.findByRole('button', { name: '11:00' }));
    await user.click(screen.getByRole('button', { name: 'Log in to book' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });
});
