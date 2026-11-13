import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Build an UNSIGNED, fake JWT for tests. Keys are generated at runtime so that no
 * secret-looking string is ever committed to the repository.
 */
export function fakeJwt(payload: Record<string, unknown>): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.${'fake-signature-for-tests'}`;
}

export const ANON_KEY = fakeJwt({ iss: 'supabase', ref: 'demo', role: 'anon', exp: 4102444800 });
export const SERVICE_KEY = fakeJwt({ iss: 'supabase', ref: 'demo', role: 'service_role', exp: 4102444800 });

export interface MockResponse {
  status: number;
  body?: unknown;
  delayMs?: number;
}

export type Routes = Record<string, MockResponse | ((req: IncomingMessage) => MockResponse)>;

export interface MockSupabase {
  url: string;
  requests: { method: string; path: string; apikey?: string; authorization?: string }[];
  close: () => Promise<void>;
}

/**
 * Local HTTP server that imitates the parts of Supabase the CLI talks to
 * (PostgREST at /rest/v1, Storage at /storage/v1, GoTrue at /auth/v1).
 * Routes are matched on the path including the query string, then on the bare path.
 */
export async function startMockSupabase(routes: Routes, expectedKey = ANON_KEY): Promise<MockSupabase> {
  const requests: MockSupabase['requests'] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const fullPath = req.url ?? '/';
    const barePath = fullPath.split('?')[0] ?? '/';
    requests.push({
      method: req.method ?? '',
      path: fullPath,
      apikey: req.headers.apikey as string | undefined,
      authorization: req.headers.authorization,
    });

    const send = (r: MockResponse) => {
      const write = () => {
        if (res.destroyed) return;
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        res.end(r.body === undefined ? '' : JSON.stringify(r.body));
      };
      if (r.delayMs) setTimeout(write, r.delayMs);
      else write();
    };

    if (req.headers.apikey !== expectedKey) {
      return send({ status: 401, body: { message: 'Invalid API key' } });
    }
    const route = routes[fullPath] ?? routes[barePath];
    if (!route) return send({ status: 404, body: { code: 'PGRST205', message: `Could not find ${barePath}` } });
    send(typeof route === 'function' ? route(req) : route);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** PostgREST-style OpenAPI document for the fictional SlotBook app. */
export const SLOTBOOK_SPEC = {
  swagger: '2.0',
  info: { title: 'PostgREST API', version: '12' },
  paths: {
    '/': { get: {} },
    '/profiles': { get: {}, post: {}, patch: {}, delete: {} },
    '/services': { get: {}, post: {}, patch: {}, delete: {} },
    '/bookings': { get: {}, post: {}, patch: {}, delete: {} },
    '/rpc/get_bookings_for_day': {
      post: { parameters: [{ in: 'body', name: 'args', schema: { properties: { day: {}, salon_id: {} } } }] },
      get: { parameters: [{ in: 'query', name: 'day' }, { in: 'query', name: 'salon_id' }] },
    },
  },
};

export const INSECURE_ROUTES: Routes = {
  '/rest/v1/': { status: 200, body: SLOTBOOK_SPEC },
  '/rest/v1/bookings?select=*&limit=1': {
    status: 200,
    body: [{ id: 1, customer_name: 'Test', customer_phone: '000', starts_at: '2026-01-01T10:00:00Z', user_id: 'x' }],
  },
  '/rest/v1/profiles?select=*&limit=1': { status: 200, body: [] },
  '/rest/v1/services?select=*&limit=1': {
    status: 401,
    body: { code: '42501', message: 'permission denied for table services' },
  },
  '/storage/v1/bucket': {
    status: 200,
    body: [
      { id: 'avatars', name: 'avatars', public: true },
      { id: 'id-documents', name: 'id-documents', public: true },
      { id: 'invoices', name: 'invoices', public: false },
    ],
  },
  '/auth/v1/settings': {
    status: 200,
    body: {
      external: { email: true, google: true, github: false, phone: false },
      disable_signup: false,
      mailer_autoconfirm: true,
      phone_autoconfirm: false,
      sms_provider: '',
    },
  },
};

export const SECURE_ROUTES: Routes = {
  '/rest/v1/': { status: 401, body: { message: 'Access to schema is forbidden' } },
  '/rest/v1/bookings?select=*&limit=1': { status: 401, body: { code: '42501', message: 'permission denied for table bookings' } },
  '/storage/v1/bucket': { status: 200, body: [] },
  '/auth/v1/settings': {
    status: 200,
    body: { external: { email: true }, disable_signup: true, mailer_autoconfirm: false, phone_autoconfirm: false },
  },
};
