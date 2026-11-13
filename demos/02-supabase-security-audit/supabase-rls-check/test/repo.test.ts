import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gitignoreMatches, IGNORE_MARKER, isEnvFile, isFrontendFile, isTestFile, scanRepo, scanText } from '../src/checks/repo.js';
import { ANON_KEY, SERVICE_KEY } from './helpers.js';

// Secret-shaped strings are assembled at runtime so the repository itself never
// contains anything a secret scanner (or a human) could mistake for a real key.
const STRIPE_LIVE = ['sk', 'live', 'FAKEFAKEFAKEFAKEFAKE1234'].join('_');
const OPENAI_LIKE = 'sk-' + 'proj-' + 'FAKE'.repeat(6);
const SB_SECRET = 'sb_' + 'secret_' + 'FAKE'.repeat(5);

let root: string;

async function put(rel: string, content: string) {
  const full = path.join(root, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rls-check-repo-'));
  // Fixture: a typical insecure Lovable / Vite + Supabase app.
  await put('.gitignore', 'node_modules\ndist\n');
  await put('.env', `VITE_SUPABASE_URL=https://demo.supabase.co\nVITE_SUPABASE_ANON_KEY=${ANON_KEY}\n`);
  await put('.env.example', 'VITE_SUPABASE_URL=\nVITE_SUPABASE_ANON_KEY=\n');
  await put(
    'src/integrations/supabase/client.ts',
    `import { createClient } from '@supabase/supabase-js';\nexport const supabase = createClient('https://demo.supabase.co', '${ANON_KEY}');\n`,
  );
  await put(
    'src/lib/adminClient.ts',
    `// "temporary" admin client\nexport const admin = createClient(url, "${SERVICE_KEY}");\nconst k = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;\n`,
  );
  await put('src/pages/AdminUsers.tsx', 'const { data } = await supabase.auth.admin.listUsers();\n');
  await put('src/ai/chat.ts', `const OPENAI_KEY = "${OPENAI_LIKE}";\n`);
  await put('supabase/functions/delete-user/index.ts', 'await supabaseAdmin.auth.admin.deleteUser(id);\n');
  await put('server/payments.js', `const stripe = new Stripe("${STRIPE_LIVE}");\nconst s = "${SB_SECRET}";\n`);
  await put('node_modules/some-lib/index.js', `const k = "${SERVICE_KEY}";\n`);
  await put('dist/assets/index.js', `const k = "${SERVICE_KEY}";\n`);
  await put('public/logo.png', '\u0000\u0001binary');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('helpers', () => {
  it('detects env files but not templates', () => {
    expect(isEnvFile('.env')).toBe(true);
    expect(isEnvFile('.env.local')).toBe(true);
    expect(isEnvFile('.env.production')).toBe(true);
    expect(isEnvFile('.env.example')).toBe(false);
    expect(isEnvFile('.env.sample')).toBe(false);
    expect(isEnvFile('environment.ts')).toBe(false);
  });

  it('separates frontend from server code', () => {
    expect(isFrontendFile('src/pages/Admin.tsx')).toBe(true);
    expect(isFrontendFile('supabase/functions/x/index.ts')).toBe(false);
    expect(isFrontendFile('app/api/route.ts')).toBe(false);
    expect(isFrontendFile('server/index.js')).toBe(false);
    expect(isFrontendFile('README.md')).toBe(false);
  });

  it('understands simple .gitignore patterns', () => {
    expect(gitignoreMatches('.env\n', '.env')).toBe(true);
    expect(gitignoreMatches('.env*\n!.env.example\n', '.env.local')).toBe(true);
    expect(gitignoreMatches('.env*\n!.env.example\n', '.env.example')).toBe(false);
    expect(gitignoreMatches('*.local\n', '.env.local')).toBe(true);
    expect(gitignoreMatches('node_modules\n', '.env')).toBe(false);
  });

  it('does not apply shipped-code rules to tests and docs, but still flags real keys there', () => {
    expect(isTestFile('test/repo.test.ts')).toBe(true);
    expect(isTestFile('src/__tests__/a.ts')).toBe(true);
    expect(isTestFile('src/App.spec.tsx')).toBe(true);
    expect(isTestFile('src/App.tsx')).toBe(false);

    const sample = 'supabase.auth.admin.listUsers(); VITE_SUPABASE_SERVICE_ROLE_KEY';
    expect(scanText('test/a.test.ts', sample)).toEqual([]);
    expect(scanText('docs/notes.md', sample)).toEqual([]);
    expect(scanText('src/a.ts', sample).map((h) => h.kind).sort()).toEqual(['auth-admin-usage', 'public-env-service-role']);
    expect(scanText('test/a.test.ts', `"${SERVICE_KEY}"`)[0]?.kind).toBe('jwt-service-role');
  });

  it('honours the rls-check-ignore marker', () => {
    expect(scanText('src/a.ts', `const k = "${SERVICE_KEY}"; // ${IGNORE_MARKER}`)).toEqual([]);
  });

  it('reports line numbers in scanText', () => {
    const hits = scanText('src/a.ts', `line1\nconst k = "${SERVICE_KEY}";`);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'jwt-service-role', line: 2, frontend: true });
  });
});

describe('scanRepo', () => {
  it('finds the expected issues and skips vendor/build folders', async () => {
    const out = await scanRepo(root);
    const ids = out.findings.map((f) => f.checkId);

    expect(ids).toContain('SECRET-SERVICE-ROLE-JWT');
    expect(ids).toContain('SECRET-PUBLIC-ENV-SERVICE-ROLE');
    expect(ids).toContain('SECRET-SUPABASE-SECRET-KEY');
    expect(ids).toContain('CODE-AUTH-ADMIN-FRONTEND');
    expect(ids).toContain('SECRET-STRIPE-LIVE');
    expect(ids).toContain('SECRET-API-KEY');
    expect(ids).toContain('SECRET-ENV-FILE');

    const serviceRole = out.findings.find((f) => f.checkId === 'SECRET-SERVICE-ROLE-JWT')!;
    expect(serviceRole.severity).toBe('critical');
    expect(serviceRole.title).toMatch(/frontend/);
    // Only the source file, not node_modules or dist.
    expect(serviceRole.evidence).toHaveLength(1);
    expect(serviceRole.evidence[0]).toMatch(/^src\/lib\/adminClient\.ts:2 /);
    // Evidence must be redacted.
    expect(serviceRole.evidence.join(' ')).not.toContain(SERVICE_KEY);

    const admin = out.findings.find((f) => f.checkId === 'CODE-AUTH-ADMIN-FRONTEND')!;
    expect(admin.evidence).toEqual(['src/pages/AdminUsers.tsx:1']);

    const env = out.findings.find((f) => f.checkId === 'SECRET-ENV-FILE')!;
    expect(env.evidence).toHaveLength(1);
    expect(env.evidence[0]).toMatch(/^\.env /);

    const allEvidence = JSON.stringify(out.findings);
    expect(allEvidence).not.toContain(STRIPE_LIVE);
    expect(allEvidence).not.toContain(OPENAI_LIKE);
    expect(allEvidence).not.toContain(SB_SECRET);

    expect(out.filesScanned).toBeGreaterThanOrEqual(8);
  });

  it('does not flag an ignored .env file that only holds public values', async () => {
    const clean = await mkdtemp(path.join(tmpdir(), 'rls-check-clean-'));
    try {
      await writeFile(path.join(clean, '.gitignore'), '.env*\n!.env.example\n');
      await writeFile(path.join(clean, '.env.local'), `VITE_SUPABASE_ANON_KEY=${ANON_KEY}\nSUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}\n`);
      await writeFile(path.join(clean, 'main.ts'), `createClient(url, "${ANON_KEY}")\n`);
      const out = await scanRepo(clean);
      expect(out.findings).toEqual([]);
      expect(out.passed[0]?.detail).toMatch(/1 anon key reference/);
    } finally {
      await rm(clean, { recursive: true, force: true });
    }
  });

  it('rejects a path that is not a directory', async () => {
    await expect(scanRepo(path.join(root, 'does-not-exist'))).rejects.toThrow(/not a directory/);
  });
});
