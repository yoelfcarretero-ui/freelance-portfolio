import { countBySeverity, SEVERITIES, SEVERITY_LABEL, type AuditResult, type Severity } from '../types.js';

const CODES = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  brightRed: '\x1b[91m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  gray: '\x1b[90m',
};

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: CODES.brightRed + CODES.bold,
  high: CODES.red,
  medium: CODES.yellow,
  low: CODES.blue,
  info: CODES.gray,
};

export function renderConsoleSummary(result: AuditResult, useColor: boolean): string {
  const c = (code: string, text: string) => (useColor ? `${code}${text}${CODES.reset}` : text);
  const counts = countBySeverity(result.findings);
  const out: string[] = [];

  out.push('');
  out.push(c(CODES.bold, `${result.tool.name} v${result.tool.version}`) + c(CODES.dim, '  (read-only audit)'));
  if (result.target.url) out.push(c(CODES.dim, `  project: ${result.target.url}`));
  if (result.target.repo) out.push(c(CODES.dim, `  repo:    ${result.target.repo}`));
  out.push('');

  out.push(
    '  ' +
      SEVERITIES.map((s) => c(counts[s] > 0 ? SEVERITY_COLOR[s] : CODES.dim, `${SEVERITY_LABEL[s]}: ${counts[s]}`)).join('   '),
  );
  out.push('');

  for (const f of result.findings) {
    const tag = c(SEVERITY_COLOR[f.severity], `[${SEVERITY_LABEL[f.severity].toUpperCase()}]`.padEnd(11));
    out.push(`  ${tag} ${f.title}`);
  }
  if (result.passed.length) {
    if (result.findings.length) out.push('');
    for (const p of result.passed) out.push(`  ${c(CODES.green, '[PASS]'.padEnd(11))} ${p.title}`);
  }
  out.push('');
  if (counts.critical > 0) {
    out.push(c(CODES.brightRed + CODES.bold, `  ${counts.critical} critical issue(s) found. Fix these before anything else.`));
  } else {
    out.push(c(CODES.green, '  No critical issues detected by the automated checks.'));
  }
  out.push('');
  return out.join('\n');
}
