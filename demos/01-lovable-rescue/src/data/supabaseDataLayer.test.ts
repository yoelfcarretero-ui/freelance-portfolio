import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { SlotTakenError, ValidationError } from './DataLayer';
import { SupabaseDataLayer } from './supabaseDataLayer';

/**
 * We do not hit a real database here (the SQL is verified separately, see README).
 * These tests pin down how Postgres errors are translated for the UI.
 */
function clientReturningInsert(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  return { client: { from } as unknown as SupabaseClient, insert };
}

const input = { serviceId: 'svc', startsAt: '2026-07-16T08:00:00.000Z' };

describe('SupabaseDataLayer.createBooking', () => {
  it('sends a full UTC instant and computed end time (BUG F)', async () => {
    const { client, insert } = clientReturningInsert({ data: { id: 'b1' }, error: null });
    await new SupabaseDataLayer(client).createBooking(input);
    expect(insert).toHaveBeenCalledWith({
      service_id: 'svc',
      starts_at: '2026-07-16T08:00:00.000Z',
      ends_at: '2026-07-16T09:00:00.000Z',
    });
  });

  it('maps a unique violation (23505) to SlotTakenError (BUG C)', async () => {
    const { client } = clientReturningInsert({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "bookings_one_per_slot"' },
    });
    await expect(new SupabaseDataLayer(client).createBooking(input)).rejects.toBeInstanceOf(SlotTakenError);
  });

  it('maps an RLS rejection (42501) to a validation error', async () => {
    const { client } = clientReturningInsert({
      data: null,
      error: { code: '42501', message: 'new row violates row-level security policy' },
    });
    await expect(new SupabaseDataLayer(client).createBooking(input)).rejects.toBeInstanceOf(ValidationError);
  });
});
