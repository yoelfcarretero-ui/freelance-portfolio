import { HttpError, mapLimit, type Getter } from '../http.js';
import { describeError, emptyOutput, isPermissionDenied, type CheckOutput } from './common.js';

export type TableStatus = 'readable' | 'empty' | 'denied' | 'not-found' | 'error';

export interface TableProbe {
  table: string;
  status: TableStatus;
  httpStatus?: number;
  /** Column names of the sampled row. We never keep the values. */
  columns?: string[];
  detail?: string;
}

const SENSITIVE_COLUMN = /(email|phone|password|token|secret|address|dni|nif|passport|iban|card|birth|ssn|salary|note)/i;

export async function probeTable(get: Getter, table: string): Promise<TableProbe> {
  try {
    // Read-only: a single GET limited to one row. Never insert/update/delete.
    const res = await get(`/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`);
    if (res.ok && Array.isArray(res.body)) {
      if (res.body.length === 0) return { table, status: 'empty', httpStatus: res.status };
      const first = res.body[0];
      const columns = first && typeof first === 'object' ? Object.keys(first as object) : [];
      return { table, status: 'readable', httpStatus: res.status, columns };
    }
    if (isPermissionDenied(res.status, res.body)) {
      return { table, status: 'denied', httpStatus: res.status, detail: describeError(res.body) };
    }
    if (res.status === 404) {
      return { table, status: 'not-found', httpStatus: res.status, detail: describeError(res.body) };
    }
    return { table, status: 'error', httpStatus: res.status, detail: describeError(res.body) };
  } catch (err) {
    const detail = err instanceof HttpError ? err.message : String(err);
    return { table, status: 'error', detail };
  }
}

export function tableProbesToOutput(probes: TableProbe[], publicTables: string[] = []): CheckOutput {
  const out = emptyOutput();
  const intentional = new Set(publicTables);

  for (const p of probes) {
    switch (p.status) {
      case 'readable': {
        const sensitive = (p.columns ?? []).filter((c) => SENSITIVE_COLUMN.test(c));
        if (intentional.has(p.table)) {
          out.findings.push({
            checkId: 'DB-READABLE-INTENTIONAL',
            severity: sensitive.length ? 'medium' : 'info',
            category: 'database',
            title: `Table "${p.table}" is publicly readable (marked as intentional)`,
            description:
              `You told the tool that "${p.table}" is meant to be public (for example a product or service catalogue). ` +
              'Make sure it only contains information you would happily publish on your website, and that write operations are still restricted.',
            evidence: [
              `GET /rest/v1/${p.table}?select=*&limit=1 returned HTTP ${p.httpStatus} with at least 1 row.`,
              `Columns exposed: ${(p.columns ?? []).join(', ') || '(none listed)'}`,
              ...(sensitive.length ? [`Columns that look sensitive, please double-check: ${sensitive.join(', ')}`] : []),
            ],
            impact: sensitive.length ? 'Possible exposure of private fields inside a public table.' : 'None if the content is genuinely public.',
            fix: [
              'Keep a read-only policy for visitors and no write policies for `anon`:',
              '',
              '```sql',
              `create policy "${p.table}: public read" on public.${p.table} for select to anon, authenticated using (true);`,
              `revoke insert, update, delete on public.${p.table} from anon;`,
              '```',
            ].join('\n'),
          });
          break;
        }
        out.findings.push({
          checkId: 'DB-READABLE',
          severity: 'critical',
          category: 'database',
          title: `Table "${p.table}" can be read by anyone on the internet`,
          description:
            `Using only the public key that ships inside your website, we were able to read rows from "${p.table}". ` +
            'This usually means Row Level Security (RLS) is turned off for this table, or a policy allows everyone to read it. ' +
            'Anyone can copy this key from the browser and download the whole table with a single request.',
          evidence: [
            `GET /rest/v1/${p.table}?select=*&limit=1 returned HTTP ${p.httpStatus} with at least 1 row.`,
            `Columns exposed: ${(p.columns ?? []).join(', ') || '(none listed)'}`,
            ...(sensitive.length ? [`Potentially sensitive columns: ${sensitive.join(', ')}`] : []),
            'Row values were not stored in this report.',
          ],
          impact:
            'Data breach. Customer personal data can be scraped in bulk, which can trigger GDPR notification duties, fines and loss of trust. ' +
            'If write policies are also missing, the data may be modifiable too.',
          fix: [
            'Enable RLS and add explicit policies for each operation. Example for a table owned by a user:',
            '',
            '```sql',
            `alter table public.${p.table} enable row level security;`,
            '',
            `create policy "${p.table}: owner can read"`,
            `  on public.${p.table} for select`,
            '  to authenticated',
            '  using ((select auth.uid()) = user_id);',
            '',
            `create policy "${p.table}: owner can insert"`,
            `  on public.${p.table} for insert`,
            '  to authenticated',
            '  with check ((select auth.uid()) = user_id);',
            '```',
            '',
            'Adjust `user_id` to your ownership column. If the data is genuinely public (e.g. a product catalogue), keep a `for select to anon` policy but make sure no private columns live in that table.',
          ].join('\n'),
          references: [
            'https://supabase.com/docs/guides/database/postgres/row-level-security',
            'https://supabase.com/docs/guides/database/database-advisors?lint=0013_rls_disabled_in_public',
          ],
        });
        break;
      }
      case 'empty':
        out.findings.push({
          checkId: 'DB-EMPTY-RESULT',
          severity: 'info',
          category: 'database',
          title: `Table "${p.table}" returned no rows to the public key`,
          description:
            `The public key got an empty result from "${p.table}". Either RLS is enabled and hides every row from anonymous visitors (good), ` +
            'or the table is simply empty right now (in which case it could become readable as soon as data arrives).',
          evidence: [`GET /rest/v1/${p.table}?select=*&limit=1 returned HTTP ${p.httpStatus} with an empty array.`],
          impact: 'Unknown from the outside. Needs a quick manual confirmation.',
          fix: [
            'Confirm in the SQL editor that RLS is on and that policies exist for every operation:',
            '',
            '```sql',
            "select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = '" + p.table + "';",
            "select policyname, cmd, roles, qual, with_check from pg_policies where tablename = '" + p.table + "';",
            '```',
          ].join('\n'),
        });
        break;
      case 'denied':
        out.passed.push({
          category: 'database',
          title: `Table "${p.table}" refuses anonymous reads`,
          detail: `HTTP ${p.httpStatus}: ${p.detail ?? 'permission denied'}`,
        });
        break;
      case 'not-found':
        out.limitations.push(`Table "${p.table}" was not found at /rest/v1/${p.table} (HTTP 404). It may be in a non-exposed schema or misspelled.`);
        break;
      case 'error':
        out.limitations.push(`Could not determine access for table "${p.table}": ${p.detail ?? 'unknown error'}${p.httpStatus ? ` (HTTP ${p.httpStatus})` : ''}.`);
        break;
    }
  }
  return out;
}

export async function checkTables(get: Getter, tables: string[], concurrency: number, publicTables: string[] = []): Promise<CheckOutput> {
  const probes = await mapLimit(tables, concurrency, (t) => probeTable(get, t));
  return tableProbesToOutput(probes, publicTables);
}
