import type { RpcInfo } from './openapi.js';
import { emptyOutput, type CheckOutput } from './common.js';

/**
 * RPC functions are listed, never called: calling an unknown function could have side effects.
 * Whether a function is SECURITY DEFINER cannot be seen through the API, so we turn the list
 * into a review item with the exact SQL to check it.
 */
export function checkRpcFunctions(functions: RpcInfo[]): CheckOutput {
  const out = emptyOutput();
  if (functions.length === 0) {
    out.passed.push({ category: 'rpc', title: 'No RPC functions exposed through the API', detail: 'The OpenAPI schema lists no /rpc/ endpoints.' });
    return out;
  }

  out.findings.push({
    checkId: 'RPC-REVIEW',
    severity: 'medium',
    category: 'rpc',
    title: functions.length === 1 ? `1 database function can be called from the browser` : `${functions.length} database functions can be called from the browser`,
    description:
      'These Postgres functions are exposed as API endpoints. Any visitor with the public key can call them unless execute permission was revoked. ' +
      'If a function is declared SECURITY DEFINER it runs with the privileges of its owner (often a superuser-like role) and skips Row Level Security entirely, ' +
      'so a single careless function can undo all your table policies. These were listed only, not executed.',
    evidence: functions.map((f) => `rpc/${f.name}(${f.params.join(', ')})`),
    impact:
      'A SECURITY DEFINER function that reads or writes by an ID passed in from the client lets attackers read or change other users\' data. ' +
      'Functions without a fixed search_path can also be hijacked by objects created in another schema.',
    fix: [
      'Review each function. List the risky ones with:',
      '',
      '```sql',
      'select p.proname, p.prosecdef as security_definer, p.proconfig as settings,',
      "       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute",
      'from pg_proc p join pg_namespace n on n.oid = p.pronamespace',
      "where n.nspname = 'public';",
      '```',
      '',
      'Then, for each function:',
      '',
      '```sql',
      '-- Prefer SECURITY INVOKER so RLS applies (Postgres 15+ default for new functions).',
      'alter function public.my_function(uuid) security invoker;',
      '',
      '-- If it really must be SECURITY DEFINER, pin the search_path and check auth.uid() inside it.',
      "alter function public.my_function(uuid) set search_path = '';",
      '',
      '-- Remove access for roles that do not need it.',
      'revoke execute on function public.my_function(uuid) from anon, public;',
      '```',
    ].join('\n'),
    references: [
      'https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker',
      'https://supabase.com/docs/guides/database/database-advisors?lint=0011_function_search_path_mutable',
    ],
  });
  return out;
}
