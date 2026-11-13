import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | undefined;

/**
 * Server-only Supabase client using the SERVICE ROLE key.
 * This key bypasses Row Level Security, so it must never be sent to the browser:
 * it only lives in Vercel environment variables and is used inside /api functions.
 */
export function getSupabaseAdmin(url: string, serviceRoleKey: string): SupabaseClient {
  if (!cached) {
    cached = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
