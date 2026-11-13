import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LocalDataLayer } from '../data/localDataLayer';
import { DEMO_ACCOUNTS } from '../data/seed';
import type { Session } from '../lib/types';
import { MemoryStorage } from '../test/memoryStorage';
import { renderApp } from '../test/renderApp';

/** Local layer whose session restore takes a while, like Supabase reading + refreshing a token. */
class SlowRestoreLayer extends LocalDataLayer {
  async getSession(): Promise<Session | null> {
    await new Promise((r) => setTimeout(r, 50));
    return super.getSession();
  }
}

async function loggedInLayer(email: string, password: string) {
  const layer = new SlowRestoreLayer({ storage: new MemoryStorage() });
  await layer.signIn(email, password);
  return layer;
}

describe('ProtectedRoute (BUG B regression)', () => {
  it('waits for the session instead of bouncing a logged-in user to /login on refresh', async () => {
    const layer = await loggedInLayer(DEMO_ACCOUNTS.customer.email, DEMO_ACCOUNTS.customer.password);
    renderApp(layer, '/bookings');

    // First render: still restoring, must not redirect yet.
    expect(screen.getByRole('status', { name: 'Restoring session' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome back' })).not.toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: 'My bookings' })).toBeInTheDocument();
  });

  it('redirects guests to the login page', async () => {
    renderApp(new SlowRestoreLayer({ storage: new MemoryStorage() }), '/bookings');
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it('blocks customers from the admin page', async () => {
    const layer = await loggedInLayer(DEMO_ACCOUNTS.customer.email, DEMO_ACCOUNTS.customer.password);
    renderApp(layer, '/admin');
    expect(await screen.findByRole('heading', { name: 'Admins only' })).toBeInTheDocument();
  });

  it('lets admins see every booking', async () => {
    const layer = await loggedInLayer(DEMO_ACCOUNTS.admin.email, DEMO_ACCOUNTS.admin.password);
    renderApp(layer, '/admin');
    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    // Bookings from other customers are visible to the admin.
    expect((await screen.findAllByText('pablo@example.com')).length).toBeGreaterThan(0);
  });
});
