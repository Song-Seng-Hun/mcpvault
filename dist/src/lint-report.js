/** Presentation only: never change the internal lint/commit-validation totals. */
export function packLintReport(input, maxChars, endpointId = 'mcp.lint_wiki') {
    const ordered = [...input.issues].sort((a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'));
    const first = ordered[0];
    const nextAction = first ? { endpointId: 'notes.read', arguments: { path: first.path, maxChars: 3000 } } : undefined;
    const base = { healthy: input.healthy, errors: input.errors, warnings: input.warnings,
        advisory: true, basis: 'known_source_snapshot', ...(nextAction && { nextAction }) };
    const full = { ...base, issues: ordered, truncated: input.truncated };
    if (JSON.stringify(full).length <= maxChars)
        return full;
    const issues = ordered.map(({ detail: _detail, ...issue }) => issue);
    const pack = () => ({ ...base, issues, truncated: true });
    while (issues.length > 1 && JSON.stringify(pack()).length > maxChars)
        issues.pop();
    if (JSON.stringify(pack()).length <= maxChars)
        return pack();
    return { advisory: true, basis: 'known_source_snapshot', truncated: true,
        retry: { endpointId, reuseOriginalArguments: true, overrides: { maxChars: 16000 } } };
}
