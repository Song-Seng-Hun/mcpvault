import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
const MAX_ID_LENGTH = 128;
const MAX_CONTENT_LENGTH = 32_768;
const MAX_CASES = 32;
function isBoundedId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH && value.trim() === value;
}
function isValidProfile(profile) {
    if (!isBoundedId(profile.id) || !isBoundedId(profile.revision) || !isBoundedId(profile.skillId)
        || typeof profile.evaluate !== 'function'
        || !Number.isInteger(profile.maxDurationMs) || profile.maxDurationMs < 1 || profile.maxDurationMs > 30_000
        || !Array.isArray(profile.caseIds) || !Array.isArray(profile.targetCaseIds)
        || profile.caseIds.length === 0 || profile.caseIds.length > MAX_CASES || profile.targetCaseIds.length === 0) {
        return false;
    }
    const caseIds = new Set();
    for (const id of profile.caseIds) {
        if (!isBoundedId(id) || caseIds.has(id))
            return false;
        caseIds.add(id);
    }
    const targets = new Set();
    for (const id of profile.targetCaseIds) {
        if (!isBoundedId(id) || !caseIds.has(id) || targets.has(id))
            return false;
        targets.add(id);
    }
    return true;
}
function snapshotProfile(profile) {
    try {
        const snapshot = Object.freeze({
            id: profile.id,
            revision: profile.revision,
            skillId: profile.skillId,
            caseIds: Object.freeze([...profile.caseIds]),
            targetCaseIds: Object.freeze([...profile.targetCaseIds]),
            maxDurationMs: profile.maxDurationMs,
            evaluate: profile.evaluate,
        });
        return isValidProfile(snapshot) ? snapshot : undefined;
    }
    catch {
        return undefined;
    }
}
function isValidInput(input) {
    if (!input || typeof input !== 'object')
        return false;
    const value = input;
    return isBoundedId(value.skillId)
        && typeof value.baseline === 'string' && value.baseline.length <= MAX_CONTENT_LENGTH
        && typeof value.candidate === 'string' && value.candidate.length <= MAX_CONTENT_LENGTH;
}
/** Returns an identity-binding digest, or undefined when the profile cannot safely be used. */
export function profileFingerprint(profile) {
    if (!profile || !isValidProfile(profile))
        return undefined;
    const canonical = JSON.stringify({
        id: profile.id,
        revision: profile.revision,
        skillId: profile.skillId,
        caseIds: [...profile.caseIds],
        targetCaseIds: [...profile.targetCaseIds],
        maxDurationMs: profile.maxDurationMs,
        evaluate: Function.prototype.toString.call(profile.evaluate),
    });
    return createHash('sha256').update(canonical).digest('hex');
}
function result(status, reason, profileFingerprint, cases = []) {
    return profileFingerprint === undefined
        ? { status, reason, cases }
        : { status, reason, profileFingerprint, cases };
}
function normalizeCases(profile, value) {
    if (!Array.isArray(value) || value.length !== profile.caseIds.length)
        return undefined;
    const expected = new Set(profile.caseIds);
    const observed = new Set();
    const normalized = [];
    for (const item of value) {
        if (!item || typeof item !== 'object')
            return undefined;
        const candidate = item;
        if (!isBoundedId(candidate.id) || !expected.has(candidate.id) || observed.has(candidate.id)
            || typeof candidate.baseline !== 'boolean' || typeof candidate.candidate !== 'boolean')
            return undefined;
        observed.add(candidate.id);
        normalized.push({ id: candidate.id, baseline: candidate.baseline, candidate: candidate.candidate });
    }
    if (observed.size !== expected.size)
        return undefined;
    return profile.caseIds.map((id) => normalized.find((item) => item.id === id));
}
function timeoutSignal(duration) {
    const controller = new AbortController();
    let timer;
    const timedOut = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(guidanceError(new Error('timeout'), 'guid-8ecbb4d0e4b66803'));
        }, duration);
    });
    return {
        signal: controller.signal,
        timedOut,
        clear: () => { if (timer !== undefined)
            clearTimeout(timer); },
    };
}
/**
 * Invokes only the pre-registered trusted host callback. Candidate strings are
 * immutable input data; they are never parsed as code, imported, or executed.
 */
export async function evaluateSkill(profile, input) {
    if (!profile)
        return result('review_required', 'evaluation profile unavailable', undefined);
    const snapshot = snapshotProfile(profile);
    const fingerprint = snapshot ? profileFingerprint(snapshot) : undefined;
    if (!snapshot || !fingerprint)
        return result('review_required', 'evaluation profile is invalid', undefined);
    if (!isValidInput(input))
        return result('review_required', 'evaluation input is invalid', fingerprint);
    if (snapshot.skillId !== input.skillId)
        return result('review_required', 'evaluation profile does not match skill', fingerprint);
    const clonedInput = Object.freeze({ skillId: input.skillId, baseline: input.baseline, candidate: input.candidate });
    const timeout = timeoutSignal(snapshot.maxDurationMs);
    const evaluatorInput = Object.freeze({ ...clonedInput, signal: timeout.signal });
    let response;
    try {
        response = await Promise.race([snapshot.evaluate(evaluatorInput), timeout.timedOut]);
    }
    catch (error) {
        timeout.clear();
        return result('review_required', error instanceof Error && error.message === 'timeout'
            ? 'evaluation timed out'
            : 'evaluation could not be completed', fingerprint);
    }
    timeout.clear();
    try {
        if (profileFingerprint(profile) !== fingerprint) {
            return result('review_required', 'evaluation profile changed', fingerprint);
        }
        const cases = normalizeCases(snapshot, response.cases);
        const risk = response.risk;
        if (!cases || (risk !== 'low' && risk !== 'approval_required' && risk !== 'unknown')) {
            return result('review_required', 'evaluator returned invalid cases', fingerprint);
        }
        if (risk !== 'low')
            return result('review_required', 'evaluator risk requires review', fingerprint, cases);
        const targets = new Set(snapshot.targetCaseIds);
        if (cases.some((item) => targets.has(item.id) && item.baseline && !item.candidate)) {
            return result('failed', 'target case regressed', fingerprint, cases);
        }
        if (cases.some((item) => item.baseline && !item.candidate)) {
            return result('review_required', 'case regressed', fingerprint, cases);
        }
        if (cases.some((item) => targets.has(item.id) && !item.candidate)) {
            return result('review_required', 'target case did not pass', fingerprint, cases);
        }
        if (!cases.some((item) => targets.has(item.id) && !item.baseline && item.candidate)) {
            return result('review_required', 'no target case improved', fingerprint, cases);
        }
        return result('passed', 'evaluation passed', fingerprint, cases);
    }
    catch {
        return result('review_required', 'evaluator returned invalid cases', fingerprint);
    }
}
/** Returns visible procedure lines, suppressing complete and unterminated Markdown fence blocks. */
export function proceduralLines(content) {
    if (typeof content !== 'string')
        return [];
    const lines = content.split(/\r?\n/);
    const visible = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const opening = /^(?: {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
        if (!opening) {
            visible.push(line);
            continue;
        }
        const marker = opening[1];
        const info = opening[2];
        if (marker[0] === '`' && info.includes('`')) {
            visible.push(line);
            continue;
        }
        const closing = new RegExp(`^(?: {0,3})${marker[0]}{${marker.length},}[ \\t]*$`);
        let closeAt = -1;
        for (let scan = index + 1; scan < lines.length; scan += 1) {
            if (closing.test(lines[scan])) {
                closeAt = scan;
                break;
            }
        }
        if (closeAt === -1) {
            break;
        }
        index = closeAt;
    }
    return visible;
}
