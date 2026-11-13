import type { Getter } from '../http.js';
import { describeError, emptyOutput, isPermissionDenied, type CheckOutput } from './common.js';

export interface RpcInfo {
  name: string;
  params: string[];
}

export interface SchemaInventory extends CheckOutput {
  available: boolean;
  tables: string[];
  rpcFunctions: RpcInfo[];
}

interface OpenApiSpec {
  paths?: Record<string, Record<string, { parameters?: Array<{ name?: string; in?: string; schema?: { properties?: Record<string, unknown> } }> }>>;
}

/** Extract tables/views and RPC functions from a PostgREST OpenAPI (Swagger 2.0) document. */
export function parseOpenApi(spec: unknown): { tables: string[]; rpcFunctions: RpcInfo[] } {
  const paths = (spec as OpenApiSpec | null)?.paths ?? {};
  const tables: string[] = [];
  const rpcFunctions: RpcInfo[] = [];

  for (const [path, ops] of Object.entries(paths)) {
    if (path === '/' || !path.startsWith('/')) continue;
    if (path.startsWith('/rpc/')) {
      const name = path.slice('/rpc/'.length);
      const params = new Set<string>();
      for (const op of Object.values(ops ?? {})) {
        for (const p of op?.parameters ?? []) {
          if (p.in === 'body' && p.schema?.properties) {
            Object.keys(p.schema.properties).forEach((k) => params.add(k));
          } else if (p.in === 'query' && p.name) {
            params.add(p.name);
          }
        }
      }
      rpcFunctions.push({ name, params: [...params] });
    } else {
      tables.push(path.slice(1));
    }
  }
  tables.sort();
  rpcFunctions.sort((a, b) => a.name.localeCompare(b.name));
  return { tables, rpcFunctions };
}

export async function fetchSchemaInventory(get: Getter): Promise<SchemaInventory> {
  const out: SchemaInventory = { ...emptyOutput(), available: false, tables: [], rpcFunctions: [] };
  const res = await get('/rest/v1/', { Accept: 'application/openapi+json, application/json' });

  if (res.ok && res.body && typeof res.body === 'object') {
    const parsed = parseOpenApi(res.body);
    out.available = true;
    out.tables = parsed.tables;
    out.rpcFunctions = parsed.rpcFunctions;
    out.findings.push({
      checkId: 'API-SCHEMA-PUBLIC',
      severity: 'low',
      category: 'database',
      title: 'Your full database schema is visible with the public key',
      description:
        'Anyone holding the public (anon) key, which is shipped inside your website, can download a machine-readable list of every table, column and function exposed by the API. This is not a leak of data by itself, but it gives an attacker a free map of where to look.',
      evidence: [
        `GET /rest/v1/ returned HTTP ${res.status} with ${parsed.tables.length} tables/views and ${parsed.rpcFunctions.length} RPC functions.`,
      ],
      impact: 'Makes reconnaissance trivial. Combined with a missing RLS policy, an attacker knows exactly which table to read.',
      fix: [
        'Keep internal tables out of the `public` schema (use a private schema that is not listed under *Exposed schemas* in API settings).',
        'Newer Supabase projects can restrict OpenAPI access to the secret key; check **Project Settings > API**.',
        'Most importantly, make sure every exposed table has RLS enabled (see the other findings).',
      ].join('\n'),
      references: ['https://supabase.com/docs/guides/api/securing-your-api'],
    });
    return out;
  }

  if (isPermissionDenied(res.status, res.body)) {
    out.passed.push({
      category: 'database',
      title: 'Schema introspection is not available to the public key',
      detail: `GET /rest/v1/ returned HTTP ${res.status}.`,
    });
  }
  out.limitations.push(
    `The OpenAPI schema could not be read with the public key (HTTP ${res.status}: ${describeError(res.body)}). ` +
      'Table discovery was limited to names passed with --tables. Pass the full table list from the dashboard for complete coverage.',
  );
  return out;
}
