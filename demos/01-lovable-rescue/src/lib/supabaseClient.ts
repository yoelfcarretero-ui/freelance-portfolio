import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * BUG D fix: the original app shipped the service_role key in a VITE_ variable.
 * Anything prefixed with VITE_ is inlined into the public JS bundle, and the service_role
 * key bypasses Row Level Security entirely. We now refuse to boot with such a key, so
 * the mistake cannot silently reach production again.
 */
export class InsecureKeyError extends Error {
  constructor() {
    super(
      'Refusing to start: VITE_SUPABASE_ANON_KEY contains a service_role / secret key. ' +
        'Use the anon (public) or publishable key in the browser and keep the secret key on a server.',
    );
    this.name = 'InsecureKeyError';
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Throws if `key` is a privileged key that must never reach a browser. */
export function assertBrowserSafeKey(key: string): void {
  // New-style keys: "sb_publishable_..." is fine, "sb_secret_..." is not.
  if (key.startsWith('sb_secret_')) throw new InsecureKeyError();
  // Legacy JWT keys carry their role in the payload.
  const payload = decodeJwtPayload(key);
  if (payload?.role === 'service_role') throw new InsecureKeyError();
}

export function createBrowserSupabaseClient(url: string, anonKey: string): SupabaseClient {
  assertBrowserSafeKey(anonKey);
  return createClient(url, anonKey, {
    auth: {
      // BUG B fix (part 1): persist the session in localStorage and refresh tokens, so a
      // page reload restores the user instead of logging them out.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
