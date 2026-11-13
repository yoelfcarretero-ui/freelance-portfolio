import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runAudit, UsageError } from './audit.js';
import { renderConsoleSummary } from './report/console.js';
import { renderMarkdown } from './report/markdown.js';
import { SEVERITIES, severityRank, type AuditOptions, type Severity } from './types.js';
import { TOOL_NAME, VERSION } from './version.js';

export const EXIT_OK = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_ERROR = 2;

export const HELP = `${TOOL_NAME} v${VERSION}
Read-only security audit for a Supabase project you own or are authorised to test.

Usage:
  ${TOOL_NAME} --url <project-url> --anon-key <key> [options]
  ${TOOL_NAME} --repo <path> [options]

Target:
  --url <url>            Supabase project URL (or env SUPABASE_URL)
  --anon-key <key>       Public anon / publishable key (or env SUPABASE_ANON_KEY)
  --repo <path>          Also scan a local source folder for leaked keys
  --tables <a,b,c>       Extra table names to probe (useful if the schema is hidden)
  --public-tables <a,b>  Tables that are public on purpose (e.g. a catalogue):
                         readable rows are reported as Info instead of Critical

Output:
  --out <file>           Write the report (.md, or .json if the name ends in .json)
  --json                 Print the result as JSON to stdout instead of the summary
  --no-color             Disable colours (also respects NO_COLOR)

Behaviour:
  --fail-on <severity>   Exit 1 when a finding at or above this level exists
                         (critical|high|medium|low|info|none, default: critical)
  --timeout <ms>         Per-request timeout in milliseconds (default: 10000)
  -h, --help             Show this help
  -v, --version          Show the version

Exit codes: 0 = no blocking findings, 1 = blocking findings, 2 = usage or runtime error.
The tool only sends GET requests and never writes data. Never pass a service_role key.
`;

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
  isTTY: boolean;
  fetchImpl?: typeof fetch;
}

export const defaultIO: CliIO = {
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
  env: process.env,
  isTTY: Boolean(process.stdout.isTTY),
};

function splitList(value: string | undefined): string[] | undefined {
  return value ? value.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
}

export async function main(argv: string[], io: CliIO = defaultIO): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        url: { type: 'string' },
        'anon-key': { type: 'string' },
        repo: { type: 'string' },
        tables: { type: 'string' },
        'public-tables': { type: 'string' },
        out: { type: 'string' },
        json: { type: 'boolean', default: false },
        'no-color': { type: 'boolean', default: false },
        'fail-on': { type: 'string', default: 'critical' },
        timeout: { type: 'string', default: '10000' },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    }));
  } catch (err) {
    io.stderr(`Error: ${err instanceof Error ? err.message : String(err)}\n\n${HELP}`);
    return EXIT_ERROR;
  }

  if (values.help) {
    io.stdout(HELP);
    return EXIT_OK;
  }
  if (values.version) {
    io.stdout(`${VERSION}\n`);
    return EXIT_OK;
  }

  const failOn = values['fail-on'] as string;
  if (failOn !== 'none' && !(SEVERITIES as readonly string[]).includes(failOn)) {
    io.stderr(`Error: --fail-on must be one of ${SEVERITIES.join(', ')}, none\n`);
    return EXIT_ERROR;
  }
  const timeoutMs = Number(values.timeout);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    io.stderr('Error: --timeout must be a positive number of milliseconds\n');
    return EXIT_ERROR;
  }

  const options: AuditOptions = {
    url: values.url ?? io.env.SUPABASE_URL,
    anonKey: values['anon-key'] ?? io.env.SUPABASE_ANON_KEY,
    repo: values.repo ? path.resolve(values.repo) : undefined,
    tables: splitList(values.tables),
    publicTables: splitList(values['public-tables']),
    timeoutMs,
    fetchImpl: io.fetchImpl,
  };

  let result;
  try {
    result = await runAudit(options);
  } catch (err) {
    const prefix = err instanceof UsageError ? 'Usage error' : 'Error';
    io.stderr(`${prefix}: ${err instanceof Error ? err.message : String(err)}\n`);
    if (err instanceof UsageError) io.stderr(`Run with --help for usage.\n`);
    return EXIT_ERROR;
  }

  if (values.out) {
    const outPath = path.resolve(values.out);
    const content = outPath.toLowerCase().endsWith('.json') ? JSON.stringify(result, null, 2) : renderMarkdown(result);
    try {
      await writeFile(outPath, content, 'utf8');
    } catch (err) {
      io.stderr(`Error: could not write report to ${outPath}: ${err instanceof Error ? err.message : String(err)}\n`);
      return EXIT_ERROR;
    }
  }

  if (values.json) {
    io.stdout(JSON.stringify(result, null, 2) + '\n');
  } else {
    const useColor = io.isTTY && !values['no-color'] && !io.env.NO_COLOR;
    io.stdout(renderConsoleSummary(result, useColor));
    if (values.out) io.stdout(`  Report written to ${path.resolve(values.out)}\n\n`);
  }

  if (failOn === 'none') return EXIT_OK;
  const threshold = severityRank(failOn as Severity);
  return result.findings.some((f) => severityRank(f.severity) <= threshold) ? EXIT_FINDINGS : EXIT_OK;
}
