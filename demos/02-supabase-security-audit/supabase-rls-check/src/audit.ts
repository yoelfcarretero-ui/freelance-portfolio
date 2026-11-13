import { checkAuth } from './checks/auth.js';
import type { CheckOutput } from './checks/common.js';
import { fetchSchemaInventory } from './checks/openapi.js';
import { scanRepo } from './checks/repo.js';
import { checkRpcFunctions } from './checks/rpc.js';
import { checkStorage } from './checks/storage.js';
import { checkTables } from './checks/tables.js';
import { createGetter, HttpError, normalizeBaseUrl } from './http.js';
import { classifyApiKey } from './jwt.js';
import { sortFindings, type AuditOptions, type AuditResult } from './types.js';
import { TOOL_NAME, VERSION } from './version.js';

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

function merge(result: AuditResult, part: CheckOutput): void {
  result.findings.push(...part.findings);
  result.passed.push(...part.passed);
  result.limitations.push(...part.limitations);
}

export async function runAudit(options: AuditOptions): Promise<AuditResult> {
  if (!options.url && !options.repo) {
    throw new UsageError('Nothing to audit: pass --url and --anon-key, and/or --repo <path>.');
  }

  const result: AuditResult = {
    tool: { name: TOOL_NAME, version: VERSION },
    target: { url: options.url, repo: options.repo },
    startedAt: new Date().toISOString(),
    finishedAt: '',
    findings: [],
    passed: [],
    limitations: [],
    inventory: { tables: [], rpcFunctions: [], buckets: [], filesScanned: 0 },
  };

  if (options.url) {
    if (!options.anonKey) throw new UsageError('Missing anon key: pass --anon-key or set SUPABASE_ANON_KEY.');
    const kind = classifyApiKey(options.anonKey);
    if (kind === 'service-role-jwt' || kind === 'secret') {
      throw new UsageError(
        'The key you passed is a service_role / secret key. This tool must run with the PUBLIC anon or publishable key: ' +
          'it measures what an anonymous visitor can do, and a privileged key would bypass RLS and give misleading results.',
      );
    }

    let baseUrl: string;
    try {
      baseUrl = normalizeBaseUrl(options.url);
    } catch (err) {
      throw new UsageError(`Invalid --url: ${err instanceof Error ? err.message : String(err)}`);
    }
    result.target.url = baseUrl;

    const get = createGetter({ baseUrl, apiKey: options.anonKey, timeoutMs: options.timeoutMs ?? 10_000, fetchImpl: options.fetchImpl });

    if (kind === 'unknown') {
      result.limitations.push('The API key format was not recognised as an anon JWT or sb_publishable_ key. Results assume it is a public key.');
    }

    // 1. Discover what the API exposes. A network failure here means the project is unreachable: fail loudly.
    let schema;
    try {
      schema = await fetchSchemaInventory(get);
    } catch (err) {
      if (err instanceof HttpError) throw new Error(`Could not reach ${baseUrl}: ${err.message}`);
      throw err;
    }
    merge(result, schema);

    const tables = [...new Set([...schema.tables, ...(options.tables ?? [])])].sort();
    result.inventory.tables = tables;
    result.inventory.rpcFunctions = schema.rpcFunctions.map((f) => f.name);

    // 2. Probe tables, 3. list RPCs, 4. storage, 5. auth settings. Independent, so run in parallel.
    const [tableOut, storageOut, authOut] = await Promise.all([
      checkTables(get, tables, options.concurrency ?? 4, options.publicTables),
      checkStorage(get),
      checkAuth(get),
    ]);
    merge(result, tableOut);
    if (schema.available) merge(result, checkRpcFunctions(schema.rpcFunctions));
    merge(result, storageOut);
    result.inventory.buckets = storageOut.buckets;
    merge(result, authOut);

    result.limitations.push(
      'Table checks are read-only (one SELECT of at most 1 row per table). Missing INSERT/UPDATE/DELETE policies are not tested, because doing so would require writing data. Review policies per operation in the SQL editor.',
      'Results reflect the anonymous role only. Data visible to any logged-in user (policies such as `to authenticated using (true)`) requires a test with a normal user session.',
      'An empty result cannot distinguish "RLS enabled" from "table currently empty".',
    );
  }

  if (options.repo) {
    const repoOut = await scanRepo(options.repo);
    merge(result, repoOut);
    result.inventory.filesScanned = repoOut.filesScanned;
  }

  result.findings = sortFindings(result.findings);
  result.finishedAt = new Date().toISOString();
  return result;
}
