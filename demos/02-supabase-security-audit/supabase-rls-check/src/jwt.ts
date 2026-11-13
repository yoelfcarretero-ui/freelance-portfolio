/**
 * Minimal JWT helpers. We only ever DECODE (base64url -> JSON) to read claims such as
 * `role`. Signatures are never verified because we do not have, and must not need,
 * the project's JWT secret.
 */

export interface JwtClaims {
  role?: string;
  iss?: string;
  ref?: string;
  exp?: number;
  [key: string]: unknown;
}

export const JWT_REGEX = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

export function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

export function decodeJwt(token: string): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = JSON.parse(base64UrlDecode(parts[1]));
    return json && typeof json === 'object' && !Array.isArray(json) ? (json as JwtClaims) : null;
  } catch {
    return null;
  }
}

/** Show enough of a secret to recognise it, never enough to use it. */
export function redact(secret: string): string {
  if (secret.length <= 14) return `${secret.slice(0, 4)}...`;
  return `${secret.slice(0, 10)}...${secret.slice(-4)}`;
}

export type KeyKind = 'anon-jwt' | 'service-role-jwt' | 'publishable' | 'secret' | 'unknown';

/** Classify the key the user passed in, so we can refuse privileged keys. */
export function classifyApiKey(key: string): KeyKind {
  if (key.startsWith('sb_publishable_')) return 'publishable';
  if (key.startsWith('sb_secret_')) return 'secret';
  const claims = decodeJwt(key);
  if (!claims) return 'unknown';
  if (claims.role === 'service_role') return 'service-role-jwt';
  if (claims.role === 'anon') return 'anon-jwt';
  return 'unknown';
}
