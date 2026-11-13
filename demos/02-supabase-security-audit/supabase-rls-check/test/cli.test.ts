import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EXIT_ERROR, EXIT_FINDINGS, EXIT_OK, main, type CliIO } from '../src/cli.js';
import { ANON_KEY, INSECURE_ROUTES, SECURE_ROUTES, SERVICE_KEY, startMockSupabase, type MockSupabase } from './helpers.js';

function captureIO(env: Record<string, string | undefined> = {}, isTTY = false) {
  const io = { out: '', err: '' };
  const cli: CliIO = {
    stdout: (t) => (io.out += t),
    stderr: (t) => (io.err += t),
    env,
    isTTY,
  };
  return { io, cli };
}

let mock: MockSupabase | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

describe('cli', () => {
  it('prints help and version', async () => {
    const a = captureIO();
    expect(await main(['--help'], a.cli)).toBe(EXIT_OK);
    expect(a.io.out).toMatch(/Usage:/);
    const b = captureIO();
    expect(await main(['-v'], b.cli)).toBe(EXIT_OK);
    expect(b.io.out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('rejects unknown flags and bad values', async () => {
    expect(await main(['--nope'], captureIO().cli)).toBe(EXIT_ERROR);
    expect(await main(['--fail-on', 'extreme', '--repo', '.'], captureIO().cli)).toBe(EXIT_ERROR);
    expect(await main(['--timeout', '-5', '--repo', '.'], captureIO().cli)).toBe(EXIT_ERROR);
    const c = captureIO();
    expect(await main([], c.cli)).toBe(EXIT_ERROR);
    expect(c.io.err).toMatch(/Nothing to audit/);
  });

  it('refuses a service_role key passed via env', async () => {
    const c = captureIO({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: SERVICE_KEY });
    expect(await main([], c.cli)).toBe(EXIT_ERROR);
    expect(c.io.err).toMatch(/service_role/);
  });

  it('exits 1 on critical findings and writes a Markdown report', async () => {
    mock = await startMockSupabase(INSECURE_ROUTES);
    const dir = await mkdtemp(path.join(tmpdir(), 'rls-check-cli-'));
    try {
      const outFile = path.join(dir, 'report.md');
      const c = captureIO({ SUPABASE_URL: mock.url, SUPABASE_ANON_KEY: ANON_KEY });
      const code = await main(['--out', outFile, '--timeout', '2000'], c.cli);
      expect(code).toBe(EXIT_FINDINGS);
      expect(c.io.out).toMatch(/\[CRITICAL\]\s+Table "bookings" can be read by anyone/);
      expect(c.io.out).not.toMatch(/\x1b\[/); // not a TTY: no colours
      const md = await readFile(outFile, 'utf8');
      expect(md).toMatch(/^# Supabase Security Audit Report/);
      expect(md).toMatch(/\| Critical \| 2 \|/);
      expect(md).toContain('### F-01 [Critical]');
      expect(md).toContain('## Limitations');
      expect(md).toContain('alter table public.bookings enable row level security;');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses colours on a TTY unless NO_COLOR is set', async () => {
    mock = await startMockSupabase(SECURE_ROUTES);
    const args = ['--url', mock.url, '--anon-key', ANON_KEY, '--tables', 'bookings'];
    const tty = captureIO({}, true);
    await main(args, tty.cli);
    expect(tty.io.out).toMatch(/\x1b\[/);
    const noColor = captureIO({ NO_COLOR: '1' }, true);
    await main(args, noColor.cli);
    expect(noColor.io.out).not.toMatch(/\x1b\[/);
  });

  it('--json prints machine-readable output and --fail-on controls the exit code', async () => {
    mock = await startMockSupabase(SECURE_ROUTES);
    const base = ['--url', mock.url, '--anon-key', ANON_KEY, '--tables', 'bookings', '--json'];

    const ok = captureIO();
    expect(await main(base, ok.cli)).toBe(EXIT_OK);
    const parsed = JSON.parse(ok.io.out);
    expect(parsed.tool.name).toBe('supabase-rls-check');
    expect(Array.isArray(parsed.findings)).toBe(true);

    // The secure mock still has Info findings, so --fail-on info must fail.
    expect(await main([...base, '--fail-on', 'info'], captureIO().cli)).toBe(EXIT_FINDINGS);
    expect(await main([...base, '--fail-on', 'none'], captureIO().cli)).toBe(EXIT_OK);
  });

  it('scans a repo without a project URL and can write JSON to a file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'rls-check-cli-repo-'));
    try {
      await writeFile(path.join(dir, 'app.ts'), `const admin = createClient(u, "${SERVICE_KEY}");\n`);
      const outFile = path.join(dir, 'out.json');
      const c = captureIO();
      expect(await main(['--repo', dir, '--out', outFile], c.cli)).toBe(EXIT_FINDINGS);
      const json = JSON.parse(await readFile(outFile, 'utf8'));
      expect(json.findings[0].checkId).toBe('SECRET-SERVICE-ROLE-JWT');
      expect(json.inventory.filesScanned).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
