export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

export type Category = 'database' | 'rpc' | 'storage' | 'auth' | 'secrets' | 'tool';

export interface Finding {
  /** Stable check identifier, e.g. "DB-READABLE". Useful for filtering in CI. */
  checkId: string;
  severity: Severity;
  category: Category;
  title: string;
  /** Plain-English explanation aimed at a non-technical founder. */
  description: string;
  /** What we actually observed. Never contains row data or full secrets. */
  evidence: string[];
  /** What could happen to the business if this is left as is. */
  impact: string;
  /** Recommended fix, Markdown allowed (SQL snippets etc.). */
  fix: string;
  references?: string[];
}

export interface PassedCheck {
  category: Category;
  title: string;
  detail: string;
}

export interface AuditOptions {
  url?: string;
  anonKey?: string;
  repo?: string;
  /** Extra table names to probe when the OpenAPI spec is not available. */
  tables?: string[];
  /** Tables that are public on purpose (e.g. a catalogue): readable rows become Info instead of Critical. */
  publicTables?: string[];
  timeoutMs?: number;
  concurrency?: number;
  fetchImpl?: typeof fetch;
}

export interface AuditResult {
  tool: { name: string; version: string };
  target: { url?: string; repo?: string };
  startedAt: string;
  finishedAt: string;
  findings: Finding[];
  passed: PassedCheck[];
  /** Things the tool could not check, stated honestly in the report. */
  limitations: string[];
  inventory: {
    tables: string[];
    rpcFunctions: string[];
    buckets: string[];
    filesScanned: number;
  };
}

export function severityRank(s: Severity): number {
  return SEVERITIES.indexOf(s);
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 } as Record<Severity, number>;
  for (const f of findings) counts[f.severity]++;
  return counts;
}
