import type { Finding, PassedCheck } from '../types.js';

export interface CheckOutput {
  findings: Finding[];
  passed: PassedCheck[];
  limitations: string[];
}

export function emptyOutput(): CheckOutput {
  return { findings: [], passed: [], limitations: [] };
}

/** PostgREST and Postgres error codes that mean "you are not allowed". */
export function isPermissionDenied(status: number, body: unknown): boolean {
  if (status === 401 || status === 403) return true;
  if (body && typeof body === 'object') {
    const code = (body as { code?: unknown }).code;
    const message = String((body as { message?: unknown }).message ?? '');
    if (code === '42501' || /permission denied/i.test(message)) return true;
  }
  return false;
}

export function describeError(body: unknown): string {
  if (body && typeof body === 'object') {
    const b = body as { message?: unknown; error?: unknown; msg?: unknown; code?: unknown };
    const msg = b.message ?? b.msg ?? b.error;
    if (msg) return `${b.code ? `[${String(b.code)}] ` : ''}${String(msg)}`.slice(0, 200);
  }
  if (typeof body === 'string' && body.length > 0) return body.slice(0, 200);
  return 'no error message';
}
