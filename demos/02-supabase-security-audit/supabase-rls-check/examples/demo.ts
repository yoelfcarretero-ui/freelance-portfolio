/**
 * Offline demo: starts a local mock of an insecure Supabase project (the fictional
 * "SlotBook" app) and runs the real CLI against it. No account or network needed.
 *
 *   npm run demo
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';
import { ANON_KEY, INSECURE_ROUTES, startMockSupabase } from '../test/helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const mock = await startMockSupabase(INSECURE_ROUTES);
try {
  const code = await main(['--url', mock.url, '--anon-key', ANON_KEY, '--out', path.join(here, 'demo-report.md')], {
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
    env: process.env,
    isTTY: Boolean(process.stdout.isTTY),
  });
  process.stdout.write(`  Exit code would be ${code} (1 = critical findings, useful to fail a CI job).\n`);
  process.stdout.write(`  HTTP methods sent to the mock project: ${[...new Set(mock.requests.map((r) => r.method))].join(', ')}\n\n`);
} finally {
  await mock.close();
}
