import { describe, expect, it, vi } from 'vitest';
import { assertBrowserSafeKey, InsecureKeyError } from '../lib/supabaseClient';
import { resolveDataMode } from './index';

/** Builds an unsigned JWT-shaped string with the given payload (enough for role detection). */
function fakeJwt(payload: object) {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}

describe('resolveDataMode', () => {
  const supabaseVars = { VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'key' };

  it('defaults to local when Supabase vars are missing', () => {
    expect(resolveDataMode({})).toBe('local');
  });

  it('uses Supabase automatically when vars are present', () => {
    expect(resolveDataMode(supabaseVars)).toBe('supabase');
  });

  it('respects an explicit local mode', () => {
    expect(resolveDataMode({ ...supabaseVars, VITE_DATA_MODE: 'local' })).toBe('local');
  });

  it('falls back to local if supabase mode is requested without vars', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveDataMode({ VITE_DATA_MODE: 'supabase' })).toBe('local');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('assertBrowserSafeKey (BUG D)', () => {
  it('accepts anon and publishable keys', () => {
    expect(() => assertBrowserSafeKey(fakeJwt({ role: 'anon' }))).not.toThrow();
    expect(() => assertBrowserSafeKey('sb_publishable_abc123')).not.toThrow();
  });

  it('refuses service_role and secret keys', () => {
    expect(() => assertBrowserSafeKey(fakeJwt({ role: 'service_role' }))).toThrow(InsecureKeyError);
    expect(() => assertBrowserSafeKey('sb_secret_abc123')).toThrow(InsecureKeyError);
  });
});
