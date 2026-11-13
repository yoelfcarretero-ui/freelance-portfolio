import type { DataLayer, DataMode } from './DataLayer';
import { LocalDataLayer } from './localDataLayer';
import { SupabaseDataLayer } from './supabaseDataLayer';
import { createBrowserSupabaseClient } from '../lib/supabaseClient';

export * from './DataLayer';

export interface DataEnv {
  VITE_DATA_MODE?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

/**
 * Picks the backend:
 *  - VITE_DATA_MODE=local     -> always local
 *  - VITE_DATA_MODE=supabase  -> Supabase, falling back to local (with a warning) if vars are missing
 *  - unset                    -> Supabase when URL + key are present, otherwise local
 */
export function resolveDataMode(env: DataEnv): DataMode {
  const hasSupabase = Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY);
  const requested = env.VITE_DATA_MODE?.trim().toLowerCase();
  if (requested === 'local') return 'local';
  if (requested === 'supabase') {
    if (!hasSupabase) {
      console.warn('[SlotBook] VITE_DATA_MODE=supabase but Supabase env vars are missing. Using local mode.');
      return 'local';
    }
    return 'supabase';
  }
  return hasSupabase ? 'supabase' : 'local';
}

export function createDataLayer(env: DataEnv = import.meta.env): DataLayer {
  if (resolveDataMode(env) === 'supabase') {
    const client = createBrowserSupabaseClient(env.VITE_SUPABASE_URL!, env.VITE_SUPABASE_ANON_KEY!);
    return new SupabaseDataLayer(client);
  }
  // A little latency makes loading states visible, like a real network would.
  return new LocalDataLayer({ latencyMs: 250 });
}
