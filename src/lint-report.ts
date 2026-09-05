export interface LintDiagnostic {
  path: string;
  code: string;
  severity: 'error' | 'warning';
  revision?: string;
  detail: string;
}

export interface LintReportInput {
  healthy: boolean;
  errors: number;
  warnings: number;
  issues: LintDiagnostic[];
  truncated: boolean;
}

export interface LintReport {
  advisory: true;
  basis: 'known_source_snapshot';
  truncated: boolean;
  healthy?: boolean;
  errors?: number;
  warnings?: number;
  issues?: Array<Omit<LintDiagnostic, 'detail'> & { detail?: string }>;
  nextAction?: { endpointId: 'notes.read'; arguments: { path: string; maxChars: number } };
  retry?: { endpointId: string; reuseOriginalArguments: true; overrides: { maxChars: number } };
}

/** Presentation only: never change the internal lint/commit-validation totals. */
export function packLintReport(input: LintReportInput, maxChars: number, endpointId = 'mcp.lint_wiki'): LintReport {
  const ordered = [...input.issues].sort((a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'));
  const first = ordered[0];
  const nextAction = first ? { endpointId: 'notes.read' as const, arguments: { path: first.path, maxChars: 3000 } } : undefined;
  const base = { healthy: input.healthy, errors: input.errors, warnings: input.warnings,
    advisory: true as const, basis: 'known_source_snapshot' as const, ...(nextAction && { nextAction }) };
  const full = { ...base, issues: ordered, truncated: input.truncated };
  if (JSON.stringify(full).length <= maxChars) return full;
  const issues: Array<Omit<LintDiagnostic, 'detail'> & { detail?: string }> = ordered.map(({ detail: _detail, ...issue }) => issue);
  const pack = () => ({ ...base, issues, truncated: true });
  while (issues.length > 1 && JSON.stringify(pack()).length > maxChars) issues.pop();
  if (JSON.stringify(pack()).length <= maxChars) return pack();
  return { advisory: true, basis: 'known_source_snapshot', truncated: true,
    retry: { endpointId, reuseOriginalArguments: true, overrides: { maxChars: 16000 } } };
}
