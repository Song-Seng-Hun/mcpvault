import { createHash } from 'node:crypto';
export const VERSION = '6.0.0';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const LIMITS = Object.freeze({ timeoutMs: 5000, maxFiles: 512, maxFileBytes: 1048576,
  maxTotalBytes: 16777216, maxDepth: 24, maxFindings: 128 });
export function limits(options = {}) {
  const result = { ...LIMITS };
  for (const key of Object.keys(result)) if (options[key] !== undefined) {
    if (!Number.isSafeInteger(options[key]) || options[key] < 1 || options[key] > LIMITS[key]) throw Error('INVALID_LIMIT');
    result[key] = options[key];
  }
  return result;
}
export function failure(status, rule) {
  return { schemaVersion: 1, ruleEngineVersion: VERSION, status, executionAuthorized: false,
    coverage: { complete: false }, filesCount: 0, riskScore: 0,
    findings: [{ rule, severity: 'HIGH', fileId: null }],
    summary: { critical: 0, high: 1, medium: 0, total: 1 } };
}
