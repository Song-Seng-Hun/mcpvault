import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';

export type ResearchEvidence = {
  path: string;
  revision: string;
};

export type ResearchSubmission = {
  candidate: string;
  conditions: string;
  failedSearches: string;
  uncertainties: string;
  evidence: ResearchEvidence[];
};

export type ResearchReview = {
  targetAccountId: string;
  targetFingerprint: string;
  disposition: 'support' | 'challenge' | 'alternative';
  rationale: string;
  evidence: ResearchEvidence[];
};

export type ResearchConfig = {
  question: string;
  constraints: string[];
  participants: string[];
  budgetMinutes: number;
};

const accountIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const revisionPattern = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const expected = new Set(keys);
  if (Object.keys(value).some((key) => !expected.has(key)) || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw guidanceError(new TypeError('invalid object shape'), 'guid-dda28a1f78cbe2b6');
  }
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function hasDisallowedControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if ((codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a) || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      return true;
    }
  }
  return false;
}

function prose(value: unknown, name: string, maximum: number, required: boolean): string {
  if (typeof value !== 'string' || hasDisallowedControl(value)) throw guidanceError(new TypeError(`${name} must be prose`), 'guid-17629a6e56864e70');
  const normalized = value.trim();
  if (required && normalized.length === 0) throw guidanceError(new TypeError(`${name} is required`), 'guid-0c6fd33ea1895f5e');
  if (codePointLength(normalized) > maximum) throw guidanceError(new TypeError(`${name} is too long`), 'guid-c6cf9290e5bb8a7c');
  return normalized;
}

function accountId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !accountIdPattern.test(value)) throw guidanceError(new TypeError(`${name} is invalid`), 'guid-1a201ad7225de12d');
  return value;
}

function evidence(value: unknown): ResearchEvidence {
  if (!isRecord(value)) throw guidanceError(new TypeError('evidence must be an object'), 'guid-cc788e208aaaab7f');
  exactKeys(value, ['path', 'revision']);
  if (typeof value.path !== 'string' || hasDisallowedControl(value.path)) throw guidanceError(new TypeError('evidence path is invalid'), 'guid-6df9368a56d7cff5');
  const path = value.path.trim();
  if (path.length === 0 || codePointLength(path) > 500) throw guidanceError(new TypeError('evidence path is invalid'), 'guid-6df9368a56d7cff5');
  if (typeof value.revision !== 'string' || !revisionPattern.test(value.revision)) throw guidanceError(new TypeError('evidence revision is invalid'), 'guid-7793aab06a8a1273');
  return { path, revision: value.revision };
}

function evidenceList(value: unknown): ResearchEvidence[] {
  if (!Array.isArray(value) || value.length > 8) throw guidanceError(new TypeError('evidence list is invalid'), 'guid-5a7d61ecd340464c');
  return value.map(evidence);
}

function participants(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) throw guidanceError(new TypeError('participants are invalid'), 'guid-a16af51bdcdd8f59');
  const result = value.map((item) => accountId(item, 'participant'));
  if (new Set(result).size !== result.length) throw guidanceError(new TypeError('participants must be unique'), 'guid-dea97cfe6a559e54');
  return result;
}

export function validateResearchConfig(value: unknown): ResearchConfig {
  if (!isRecord(value)) throw guidanceError(new TypeError('config must be an object'), 'guid-6178ffefd1982210');
  value = { constraints: [], ...value };
  if (!isRecord(value)) throw guidanceError(new TypeError('config must be an object'), 'guid-6178ffefd1982210');
  exactKeys(value, ['question', 'constraints', 'participants', 'budgetMinutes']);
  if (!Array.isArray(value.constraints) || value.constraints.length > 8) throw guidanceError(new TypeError('constraints are invalid'), 'guid-ca727977c72fdce5');
  const constraints = value.constraints.map((item) => prose(item, 'constraint', 280, false));
  if (typeof value.budgetMinutes !== 'number' || !Number.isInteger(value.budgetMinutes) || value.budgetMinutes < 1 || value.budgetMinutes > 10080) throw guidanceError(new TypeError('budgetMinutes is invalid'), 'guid-98c80939b2a51cbd');
  return {
    question: prose(value.question, 'question', 1000, true),
    constraints,
    participants: participants(value.participants),
    budgetMinutes: value.budgetMinutes,
  };
}

export function validateResearchSubmission(value: unknown): ResearchSubmission {
  if (!isRecord(value)) throw guidanceError(new TypeError('submission must be an object'), 'guid-fa099f8df7a4c3bd');
  exactKeys(value, ['candidate', 'conditions', 'failedSearches', 'uncertainties', 'evidence']);
  const candidate = prose(value.candidate, 'candidate', 1200, true);
  const conditions = prose(value.conditions, 'conditions', 700, false);
  const failedSearches = prose(value.failedSearches, 'failedSearches', 700, false);
  const uncertainties = prose(value.uncertainties, 'uncertainties', 700, false);
  const submittedEvidence = evidenceList(value.evidence);
  if (submittedEvidence.length === 0 && (failedSearches.length === 0 || uncertainties.length === 0)) {
    throw guidanceError(new TypeError('empty evidence requires explicit no-result context'), 'guid-84feb1965f3f348b');
  }
  return { candidate, conditions, failedSearches, uncertainties, evidence: submittedEvidence };
}

export function validateResearchReview(value: unknown): ResearchReview {
  if (!isRecord(value)) throw guidanceError(new TypeError('review must be an object'), 'guid-24df69b8d012053d');
  exactKeys(value, ['targetAccountId', 'targetFingerprint', 'disposition', 'rationale', 'evidence']);
  if (typeof value.targetFingerprint !== 'string' || !revisionPattern.test(value.targetFingerprint)) throw guidanceError(new TypeError('targetFingerprint is invalid'), 'guid-277a894fe32d581e');
  if (value.disposition !== 'support' && value.disposition !== 'challenge' && value.disposition !== 'alternative') throw guidanceError(new TypeError('disposition is invalid'), 'guid-950b6d8f671bbb41');
  return {
    targetAccountId: accountId(value.targetAccountId, 'targetAccountId'),
    targetFingerprint: value.targetFingerprint,
    disposition: value.disposition,
    rationale: prose(value.rationale, 'rationale', 1000, true),
    evidence: evidenceList(value.evidence),
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw guidanceError(new TypeError('fingerprint value must be JSON-compatible'), 'guid-b37b1bd1346e0128');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw guidanceError(new TypeError('fingerprint value must be JSON-compatible'), 'guid-b37b1bd1346e0128');
}

export function researchFingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
