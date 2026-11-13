import { describe, expect, it } from 'vitest';
import { classifyApiKey, decodeJwt, redact } from '../src/jwt.js';
import { ANON_KEY, fakeJwt, SERVICE_KEY } from './helpers.js';

describe('decodeJwt', () => {
  it('decodes the payload without verifying the signature', () => {
    expect(decodeJwt(SERVICE_KEY)?.role).toBe('service_role');
    expect(decodeJwt(ANON_KEY)?.role).toBe('anon');
  });

  it('returns null for malformed tokens', () => {
    expect(decodeJwt('not-a-jwt')).toBeNull();
    expect(decodeJwt('a.b')).toBeNull();
    expect(decodeJwt('eyJhbGciOiJIUzI1NiJ9.!!!.sig')).toBeNull();
    expect(decodeJwt(`x.${Buffer.from('[1,2]').toString('base64url')}.y`)).toBeNull();
  });
});

describe('classifyApiKey', () => {
  it('recognises legacy and new key formats', () => {
    expect(classifyApiKey(ANON_KEY)).toBe('anon-jwt');
    expect(classifyApiKey(SERVICE_KEY)).toBe('service-role-jwt');
    expect(classifyApiKey('sb_publishable_abc123')).toBe('publishable');
    expect(classifyApiKey('sb_secret_abc123')).toBe('secret');
    expect(classifyApiKey(fakeJwt({ role: 'authenticated' }))).toBe('unknown');
    expect(classifyApiKey('whatever')).toBe('unknown');
  });
});

describe('redact', () => {
  it('never returns the full secret', () => {
    const r = redact(SERVICE_KEY);
    expect(r).not.toBe(SERVICE_KEY);
    expect(r.length).toBeLessThan(20);
    expect(redact('short')).toBe('shor...');
  });
});
