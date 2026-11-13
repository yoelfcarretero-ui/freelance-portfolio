import { afterEach, describe, expect, it } from 'vitest';
import { runAudit, UsageError } from '../src/audit.js';
import { parseOpenApi } from '../src/checks/openapi.js';
import { analyzeAuthSettings } from '../src/checks/auth.js';
import { ANON_KEY, INSECURE_ROUTES, SECURE_ROUTES, SERVICE_KEY, SLOTBOOK_SPEC, startMockSupabase, type MockSupabase } from './helpers.js';

let mock: MockSupabase | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

describe('parseOpenApi', () => {
  it('extracts tables and RPC functions with their parameters', () => {
    const { tables, rpcFunctions } = parseOpenApi(SLOTBOOK_SPEC);
    expect(tables).toEqual(['bookings', 'profiles', 'services']);
    expect(rpcFunctions).toEqual([{ name: 'get_bookings_for_day', params: ['day', 'salon_id'] }]);
  });

  it('tolerates garbage input', () => {
    expect(parseOpenApi(null)).toEqual({ tables: [], rpcFunctions: [] });
    expect(parseOpenApi('html page')).toEqual({ tables: [], rpcFunctions: [] });
  });
});

describe('analyzeAuthSettings', () => {
  it('flags autoconfirm, open signup, anonymous users and lists providers', () => {
    const out = analyzeAuthSettings({
      external: { email: true, phone: true, google: true, github: false },
      disable_signup: false,
      mailer_autoconfirm: true,
      phone_autoconfirm: true,
      anonymous_users: true,
    });
    const ids = out.findings.map((f) => f.checkId).sort();
    expect(ids).toEqual(['AUTH-ANONYMOUS-USERS', 'AUTH-EMAIL-AUTOCONFIRM', 'AUTH-PHONE-AUTOCONFIRM', 'AUTH-PROVIDERS', 'AUTH-SIGNUP-OPEN']);
    expect(out.findings.find((f) => f.checkId === 'AUTH-PROVIDERS')?.evidence[0]).toBe('Enabled providers: email, google, phone');
  });

  it('passes a hardened configuration', () => {
    const out = analyzeAuthSettings({ external: {}, disable_signup: true, mailer_autoconfirm: false });
    expect(out.findings).toEqual([]);
    expect(out.passed.map((p) => p.title)).toContain('Email confirmation is required');
  });
});

describe('runAudit against a mock Supabase (insecure SlotBook)', () => {
  it('classifies tables, storage, rpc and auth correctly', async () => {
    mock = await startMockSupabase(INSECURE_ROUTES);
    const result = await runAudit({ url: mock.url, anonKey: ANON_KEY, timeoutMs: 2000 });

    expect(result.inventory.tables).toEqual(['bookings', 'profiles', 'services']);
    expect(result.inventory.rpcFunctions).toEqual(['get_bookings_for_day']);
    expect(result.inventory.buckets).toEqual(['avatars', 'id-documents', 'invoices']);

    const byId = (id: string) => result.findings.filter((f) => f.checkId === id);

    const readable = byId('DB-READABLE');
    expect(readable).toHaveLength(1);
    expect(readable[0]?.severity).toBe('critical');
    expect(readable[0]?.title).toContain('bookings');
    expect(readable[0]?.evidence.join('\n')).toContain('customer_phone');
    expect(readable[0]?.fix).toContain('alter table public.bookings enable row level security;');
    // Row values must never end up in the report.
    expect(JSON.stringify(result)).not.toContain('2026-01-01T10:00:00Z');

    expect(byId('DB-EMPTY-RESULT').map((f) => f.title)).toEqual(['Table "profiles" returned no rows to the public key']);
    expect(result.passed.some((p) => p.title === 'Table "services" refuses anonymous reads')).toBe(true);

    expect(byId('RPC-REVIEW')[0]?.evidence).toEqual(['rpc/get_bookings_for_day(day, salon_id)']);

    const publicBuckets = byId('STORAGE-PUBLIC-BUCKET');
    expect(publicBuckets.map((f) => [f.title, f.severity])).toEqual([
      ['Bucket "id-documents" is public', 'critical'],
      ['Bucket "avatars" is public', 'high'],
    ]);

    expect(byId('AUTH-EMAIL-AUTOCONFIRM')).toHaveLength(1);
    expect(byId('API-SCHEMA-PUBLIC')).toHaveLength(1);

    // Sorted by severity, criticals first.
    expect(result.findings[0]?.severity).toBe('critical');
    expect(result.findings.at(-1)?.severity).toBe('info');
  });

  it('only ever sends GET requests with the anon key in both headers', async () => {
    mock = await startMockSupabase(INSECURE_ROUTES);
    await runAudit({ url: mock.url, anonKey: ANON_KEY, timeoutMs: 2000 });
    expect(mock.requests.length).toBeGreaterThanOrEqual(6);
    expect(new Set(mock.requests.map((r) => r.method))).toEqual(new Set(['GET']));
    expect(mock.requests.every((r) => r.apikey === ANON_KEY && r.authorization === `Bearer ${ANON_KEY}`)).toBe(true);
    // RPC functions are listed, never called.
    expect(mock.requests.some((r) => r.path.includes('/rpc/'))).toBe(false);
  });

  it('sends publishable keys only in the apikey header', async () => {
    const key = 'sb_publishable_demo123';
    mock = await startMockSupabase(SECURE_ROUTES, key);
    await runAudit({ url: mock.url, anonKey: key, tables: ['bookings'], timeoutMs: 2000 });
    expect(mock.requests.every((r) => r.apikey === key && r.authorization === undefined)).toBe(true);
  });
});

describe('runAudit with intentionally public tables', () => {
  it('downgrades a declared public catalogue to Info, but not a sensitive one', async () => {
    mock = await startMockSupabase({
      ...INSECURE_ROUTES,
      '/rest/v1/services?select=*&limit=1': { status: 200, body: [{ id: 1, name: 'Haircut', duration_min: 30, price_cents: 2500 }] },
    });
    const result = await runAudit({ url: mock.url, anonKey: ANON_KEY, publicTables: ['services', 'bookings'], timeoutMs: 2000 });
    const intentional = result.findings.filter((f) => f.checkId === 'DB-READABLE-INTENTIONAL');
    expect(intentional.map((f) => [f.title, f.severity])).toEqual([
      ['Table "bookings" is publicly readable (marked as intentional)', 'medium'], // has customer_phone
      ['Table "services" is publicly readable (marked as intentional)', 'info'],
    ]);
    expect(result.findings.some((f) => f.checkId === 'DB-READABLE')).toBe(false);
  });
});

describe('runAudit against a hardened project', () => {
  it('reports no critical findings and explains limitations', async () => {
    mock = await startMockSupabase(SECURE_ROUTES);
    const result = await runAudit({ url: mock.url, anonKey: ANON_KEY, tables: ['bookings', 'ghost_table'], timeoutMs: 2000 });

    expect(result.findings.filter((f) => f.severity === 'critical' || f.severity === 'high')).toEqual([]);
    expect(result.passed.map((p) => p.title)).toEqual(
      expect.arrayContaining(['Schema introspection is not available to the public key', 'Table "bookings" refuses anonymous reads']),
    );
    expect(result.limitations.join('\n')).toMatch(/OpenAPI schema could not be read/);
    expect(result.limitations.join('\n')).toMatch(/ghost_table" was not found/);
  });
});

describe('runAudit safety and errors', () => {
  it('refuses to run with a service_role key', async () => {
    await expect(runAudit({ url: 'https://x.supabase.co', anonKey: SERVICE_KEY })).rejects.toBeInstanceOf(UsageError);
    await expect(runAudit({ url: 'https://x.supabase.co', anonKey: 'sb_secret_abc' })).rejects.toThrow(/service_role/);
  });

  it('requires a target and a key', async () => {
    await expect(runAudit({})).rejects.toThrow(/Nothing to audit/);
    await expect(runAudit({ url: 'https://x.supabase.co' })).rejects.toThrow(/Missing anon key/);
    await expect(runAudit({ url: 'not a url', anonKey: ANON_KEY })).rejects.toThrow(/Invalid --url/);
  });

  it('times out instead of hanging', async () => {
    mock = await startMockSupabase({ '/rest/v1/': { status: 200, body: SLOTBOOK_SPEC, delayMs: 1500 } });
    await expect(runAudit({ url: mock.url, anonKey: ANON_KEY, timeoutMs: 200 })).rejects.toThrow(/timed out after 200 ms/);
  });

  it('reports an unreachable project clearly', async () => {
    await expect(runAudit({ url: 'http://127.0.0.1:9', anonKey: ANON_KEY, timeoutMs: 2000 })).rejects.toThrow(/Could not reach/);
  });

  it('records per-table errors as limitations instead of crashing', async () => {
    mock = await startMockSupabase({
      ...INSECURE_ROUTES,
      '/rest/v1/bookings?select=*&limit=1': { status: 500, body: { message: 'boom' } },
    });
    const result = await runAudit({ url: mock.url, anonKey: ANON_KEY, timeoutMs: 2000 });
    expect(result.limitations.join('\n')).toMatch(/Could not determine access for table "bookings": boom \(HTTP 500\)/);
  });

  it('works with an injected fetch implementation (no network)', async () => {
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/rest/v1/')) return new Response(JSON.stringify({ paths: { '/notes': {} } }), { status: 200 });
      if (url.includes('/rest/v1/notes')) return new Response('[]', { status: 200 });
      if (url.endsWith('/storage/v1/bucket')) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 400 });
      return new Response(JSON.stringify({ disable_signup: true, mailer_autoconfirm: false }), { status: 200 });
    }) as typeof fetch;
    const result = await runAudit({ url: 'https://demo.supabase.co', anonKey: ANON_KEY, fetchImpl: fakeFetch });
    expect(result.findings.map((f) => f.checkId)).toEqual(['API-SCHEMA-PUBLIC', 'DB-EMPTY-RESULT']);
  });
});
