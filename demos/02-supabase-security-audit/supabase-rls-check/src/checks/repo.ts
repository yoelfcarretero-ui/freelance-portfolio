import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { decodeJwt, JWT_REGEX, redact } from '../jwt.js';
import type { Finding } from '../types.js';
import { emptyOutput, type CheckOutput } from './common.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.svelte-kit', 'coverage', '.turbo', '.vercel', '.cache']);
const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.astro',
  '.json', '.yml', '.yaml', '.toml', '.html', '.htm', '.py', '.rb', '.go', '.php', '.sql', '.sh', '.txt', '.ini', '.cfg', '.conf', '.dart', '.kt', '.swift',
]);
const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.astro', '.html']);
const MAX_FILE_BYTES = 1_000_000;

/** Paths that run on a server, where admin APIs and secrets are legitimate. */
const SERVER_PATH = /(^|\/)(supabase\/functions|functions|server|backend|api|scripts|edge-functions|netlify\/functions|pages\/api|app\/api)\/|\.server\.[jt]sx?$/i;

export interface SecretHit {
  file: string;
  line: number;
  kind: string;
  match: string;
  frontend: boolean;
}

export function isEnvFile(name: string): boolean {
  if (!/^\.env(\..+)?$/i.test(name) && !/\.env$/i.test(name)) return false;
  return !/\.(example|sample|template|dist|defaults)$/i.test(name);
}

export function isFrontendFile(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/');
  if (SERVER_PATH.test(p)) return false;
  return CODE_EXTENSIONS.has(path.extname(p).toLowerCase());
}

/** Very small .gitignore matcher: enough to tell whether `.env` style files are ignored. */
export function gitignoreMatches(gitignore: string, fileName: string): boolean {
  let ignored = false;
  for (const raw of gitignore.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    const pattern = (negate ? line.slice(1) : line).replace(/^\//, '').replace(/\/$/, '');
    if (pattern.includes('/')) continue;
    const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    if (re.test(fileName)) ignored = !negate;
  }
  return ignored;
}

interface Rule {
  kind: string;
  regex: RegExp;
}

const SECRET_RULES: Rule[] = [
  { kind: 'supabase-secret-key', regex: /\bsb_secret_[A-Za-z0-9_-]{16,}/g },
  { kind: 'stripe-live-secret', regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/g },
  { kind: 'stripe-test-secret', regex: /\bsk_test_[A-Za-z0-9]{16,}/g },
  { kind: 'openai-style-secret', regex: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/g },
  { kind: 'public-env-service-role', regex: /\b(?:VITE|NEXT_PUBLIC|REACT_APP|PUBLIC|EXPO_PUBLIC|NUXT_PUBLIC)_[A-Z0-9_]*SERVICE_ROLE[A-Z0-9_]*/g },
  { kind: 'auth-admin-usage', regex: /\.auth\.admin\b/g },
];

/** Test and fixture files are not shipped to the browser. */
export function isTestFile(relPath: string): boolean {
  return /(^|\/)(test|tests|__tests__|__mocks__|spec|e2e|fixtures)\/|\.(test|spec)\.[cm]?[jt]sx?$/i.test(relPath.replace(/\\/g, '/'));
}

/** Rules about code that ships to users; they make no sense in docs or tests. */
const CODE_ONLY_RULES = new Set(['public-env-service-role', 'auth-admin-usage']);
const DOC_FILE = /\.(md|sql|txt)$/i;

/** Add this marker to a line to silence a reviewed false positive. */
export const IGNORE_MARKER = 'rls-check-ignore';

export function scanText(relPath: string, text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  const frontend = isFrontendFile(relPath) && !isTestFile(relPath);
  const codeRulesApply = !isTestFile(relPath) && !DOC_FILE.test(relPath);
  const lines = text.split(/\r?\n/);
  lines.forEach((lineText, i) => {
    if (lineText.includes(IGNORE_MARKER)) return;
    for (const m of lineText.matchAll(JWT_REGEX)) {
      const claims = decodeJwt(m[0]);
      if (!claims) continue;
      const kind = claims.role === 'service_role' ? 'jwt-service-role' : claims.role === 'anon' ? 'jwt-anon' : 'jwt-other';
      hits.push({ file: relPath, line: i + 1, kind, match: m[0], frontend });
    }
    for (const rule of SECRET_RULES) {
      if (CODE_ONLY_RULES.has(rule.kind) && !codeRulesApply) continue;
      for (const m of lineText.matchAll(rule.regex)) {
        hits.push({ file: relPath, line: i + 1, kind: rule.kind, match: m[0], frontend });
      }
    }
  });
  return hits;
}

async function walk(root: string, dir: string, files: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(root, full, files);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (TEXT_EXTENSIONS.has(ext) || isEnvFile(entry.name) || entry.name.startsWith('.env')) files.push(full);
    }
  }
}

function loc(h: SecretHit): string {
  return `${h.file}:${h.line} (${redact(h.match)})`;
}

export function hitsToFindings(hits: SecretHit[], envFiles: { file: string; ignored: boolean }[]): Finding[] {
  const findings: Finding[] = [];
  const by = (kind: string, pred: (h: SecretHit) => boolean = () => true) => hits.filter((h) => h.kind === kind && pred(h));

  const serviceRole = by('jwt-service-role');
  if (serviceRole.length) {
    const inFrontend = serviceRole.some((h) => h.frontend);
    findings.push({
      checkId: 'SECRET-SERVICE-ROLE-JWT',
      severity: 'critical',
      category: 'secrets',
      title: inFrontend ? 'The service_role key is inside your frontend code' : 'The service_role key is hardcoded in the repository',
      description:
        'The service_role key is the master key of your Supabase project: it ignores every Row Level Security rule and can read, change or delete any data and any user. ' +
        (inFrontend
          ? 'It was found in code that is shipped to the browser, so anyone can open the developer tools and copy it.'
          : 'It is written directly into a file in the repository, so anyone with access to the code (or a leaked copy of it) has full control.'),
      evidence: serviceRole.map((h) => `${loc(h)}${h.frontend ? ' [frontend]' : ''} - JWT payload role = "service_role"`),
      impact: 'Total compromise: full database dump, data deletion, account takeover, and abuse billed to your project. Treat it as already leaked.',
      fix: [
        '1. **Rotate the key now**: Project Settings > API (legacy JWT secret rotation, or create new `sb_secret_` keys and delete the old ones).',
        '2. Remove it from the code and from git history (e.g. `git filter-repo`), not only from the latest commit.',
        '3. In the browser use only the anon / publishable key. Move privileged operations to an Edge Function that reads the key from `Deno.env.get(\'SUPABASE_SERVICE_ROLE_KEY\')`.',
      ].join('\n'),
      references: ['https://supabase.com/docs/guides/api/api-keys'],
    });
  }

  const sbSecret = by('supabase-secret-key');
  if (sbSecret.length) {
    findings.push({
      checkId: 'SECRET-SUPABASE-SECRET-KEY',
      severity: 'critical',
      category: 'secrets',
      title: 'A Supabase secret key (sb_secret_) is committed',
      description: 'Supabase secret keys have the same power as the service_role key: they bypass all Row Level Security.',
      evidence: sbSecret.map((h) => `${loc(h)}${h.frontend ? ' [frontend]' : ''}`),
      impact: 'Full read/write access to the whole project for anyone who sees the code.',
      fix: 'Delete this key in **Project Settings > API Keys**, create a new one, and store it only in server-side environment variables / Edge Function secrets.',
      references: ['https://supabase.com/docs/guides/api/api-keys'],
    });
  }

  const publicEnv = by('public-env-service-role');
  if (publicEnv.length) {
    findings.push({
      checkId: 'SECRET-PUBLIC-ENV-SERVICE-ROLE',
      severity: 'critical',
      category: 'secrets',
      title: 'The service_role key is exposed through a public environment variable',
      description:
        'Variables prefixed with VITE_, NEXT_PUBLIC_, REACT_APP_ (and similar) are copied into the JavaScript bundle at build time and sent to every visitor. A variable holding the service_role key with that prefix means the master key is in your public website.',
      evidence: publicEnv.map((h) => `${h.file}:${h.line} uses ${h.match}`),
      impact: 'Same as a leaked service_role key: complete control of the database by any visitor.',
      fix: 'Rename the variable without the public prefix, use it only in server code / Edge Functions, rebuild and redeploy, then rotate the key because previous builds already shipped it.',
    });
  }

  const adminFrontend = by('auth-admin-usage', (h) => h.frontend);
  if (adminFrontend.length) {
    findings.push({
      checkId: 'CODE-AUTH-ADMIN-FRONTEND',
      severity: 'high',
      category: 'secrets',
      title: 'Admin user-management API is called from frontend code',
      description:
        '`supabase.auth.admin` functions (create/delete users, list all users, change passwords) only work with the service_role key. Calling them from browser code means either the feature is broken or, worse, the service_role key is being shipped to the browser to make it work.', // rls-check-ignore
      evidence: adminFrontend.map((h) => `${h.file}:${h.line}`),
      impact: 'If it works in production, any visitor can list, impersonate or delete every user.',
      fix: 'Move these calls into an Edge Function that first checks the caller is an admin (e.g. via a role claim or an `admins` table), and call that function from the app.',
      references: ['https://supabase.com/docs/reference/javascript/admin-api'],
    });
  }

  const stripeLive = by('stripe-live-secret');
  if (stripeLive.length) {
    findings.push({
      checkId: 'SECRET-STRIPE-LIVE',
      severity: 'critical',
      category: 'secrets',
      title: 'A live Stripe secret key is committed',
      description: 'A live payment provider secret key gives full control of your Stripe account: refunds, payouts, customer data.',
      evidence: stripeLive.map(loc),
      impact: 'Direct financial loss and exposure of customer payment metadata.',
      fix: 'Roll the key in the Stripe dashboard immediately, then keep it only in server-side secrets (e.g. `supabase secrets set STRIPE_SECRET_KEY=...`).',
    });
  }

  const otherSecrets = [...by('openai-style-secret'), ...by('stripe-test-secret')];
  if (otherSecrets.length) {
    findings.push({
      checkId: 'SECRET-API-KEY',
      severity: otherSecrets.some((h) => h.kind === 'openai-style-secret') ? 'high' : 'low',
      category: 'secrets',
      title: 'Hardcoded third-party API secret(s)',
      description: 'Secret API keys (for example AI providers) are written directly in the code. Anyone who can see the code or the website bundle can use them on your bill.',
      evidence: otherSecrets.map((h) => `${loc(h)}${h.frontend ? ' [frontend]' : ''}`),
      impact: 'Unexpected bills (AI keys are a favourite target of scrapers) and possible access to data held by that provider.',
      fix: 'Revoke and regenerate the key, store it as a server-side secret, and call the provider from an Edge Function instead of the browser.',
    });
  }

  const otherJwts = by('jwt-other');
  if (otherJwts.length) {
    findings.push({
      checkId: 'SECRET-HARDCODED-JWT',
      severity: 'low',
      category: 'secrets',
      title: 'Hardcoded access token(s) found',
      description: 'JSON Web Tokens that are not the public anon key were found in the code. They may be test tokens, or real user sessions copied during debugging.',
      evidence: otherJwts.map((h) => `${loc(h)} - role = "${String(decodeJwt(h.match)?.role ?? 'none')}"`),
      impact: 'If still valid, they let someone act as that user.',
      fix: 'Remove them and load tokens at runtime instead.',
    });
  }

  const committedEnv = envFiles.filter((e) => !e.ignored);
  if (committedEnv.length) {
    findings.push({
      checkId: 'SECRET-ENV-FILE',
      severity: 'high',
      category: 'secrets',
      title: 'Environment file(s) not covered by .gitignore',
      description:
        '.env files usually hold passwords and API keys. These are present in the project and are not ignored by git, so they are likely committed and visible to anyone with access to the repository.',
      evidence: committedEnv.map((e) => `${e.file} is not matched by the root .gitignore`),
      impact: 'Every secret in the file should be considered exposed, including in old commits.',
      fix: [
        'Add the files to `.gitignore`, remove them from the index and rotate the secrets they contained:',
        '',
        '```bash',
        'echo ".env*" >> .gitignore && echo "!.env.example" >> .gitignore',
        'git rm --cached .env',
        '```',
      ].join('\n'),
    });
  }

  return findings;
}

export async function scanRepo(root: string): Promise<CheckOutput & { filesScanned: number }> {
  const out = { ...emptyOutput(), filesScanned: 0 };
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) throw new Error(`--repo path is not a directory: ${root}`);

  const files: string[] = [];
  await walk(root, root, files);
  const gitignore = await readFile(path.join(root, '.gitignore'), 'utf8').catch(() => '');

  const hits: SecretHit[] = [];
  const envFiles: { file: string; ignored: boolean }[] = [];
  let skipped = 0;

  for (const full of files) {
    const rel = path.relative(root, full).replace(/\\/g, '/');
    const info = await stat(full).catch(() => null);
    if (!info || info.size > MAX_FILE_BYTES) {
      skipped++;
      continue;
    }
    const text = await readFile(full, 'utf8').catch(() => null);
    if (text === null || text.slice(0, 1000).includes('\u0000')) {
      skipped++;
      continue;
    }
    out.filesScanned++;
    const base = path.basename(full);
    const fileHits = scanText(rel, text);
    if (isEnvFile(base)) {
      const ignored = gitignoreMatches(gitignore, base);
      envFiles.push({ file: rel, ignored });
      // Secrets inside an ignored .env file are expected; only public-prefixed service keys matter there.
      hits.push(...(ignored ? fileHits.filter((h) => h.kind === 'public-env-service-role') : fileHits));
    } else {
      hits.push(...fileHits);
    }
  }

  out.findings = hitsToFindings(hits, envFiles);

  const anon = hits.filter((h) => h.kind === 'jwt-anon');
  out.passed.push({
    category: 'secrets',
    title: 'Repository scanned for keys and secrets',
    detail: `${out.filesScanned} files scanned${skipped ? `, ${skipped} skipped (binary or > 1 MB)` : ''}. ${anon.length} anon key reference(s) found, which is expected in frontend code.`,
  });
  out.limitations.push(
    'The repository scan only reads files on disk. Secrets deleted in later commits can still live in git history; run a history scanner (e.g. gitleaks) for full coverage. Build output folders (dist, build, .next) were skipped.',
  );
  return out;
}
