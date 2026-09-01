export interface ClientPatchHunk {
  oldString: string;
  newString: string;
}

export interface ClientNoteUpdatePlan {
  changed: boolean;
  expectedRevision: string;
  mode: 'patch' | 'write';
  patches: ClientPatchHunk[];
  /** Present for a full-write fallback; never contains a password or token. */
  content?: string;
  reason?: 'empty_original' | 'insertion_only' | 'patch_larger_than_write' | 'input_too_large';
}

export interface ClientDiffOptions {
  /** Do not build a patch larger than this many Unicode characters. */
  maxPatchChars?: number;
  /** Protect the client from converting an extremely large document to code-point arrays. */
  maxInputChars?: number;
}

const DEFAULT_MAX_PATCH_CHARS = 20_000;
const DEFAULT_MAX_INPUT_CHARS = 200_000;

/**
 * Builds a safe client-side note mutation plan. A patch is only proposed for
 * a non-empty replacement/deletion; insertions fall back to a full write so a
 * missing oldString can never be applied ambiguously. The server must still
 * enforce expectedRevision, authorization, and path policy.
 */
export function createNoteUpdatePlan(
  original: string,
  updated: string,
  expectedRevision: string,
  options: ClientDiffOptions = {},
): ClientNoteUpdatePlan {
  const before = String(original);
  const after = String(updated);
  const revision = String(expectedRevision || '').trim();
  if (!revision) throw new Error('expectedRevision is required');
  if (before === after) return { changed: false, expectedRevision: revision, mode: 'patch', patches: [] };

  const maxPatchChars = options.maxPatchChars ?? DEFAULT_MAX_PATCH_CHARS;
  const maxInputChars = options.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;
  if (!Number.isInteger(maxPatchChars) || maxPatchChars < 1) throw new Error('maxPatchChars must be a positive integer');
  if (!Number.isInteger(maxInputChars) || maxInputChars < 1) throw new Error('maxInputChars must be a positive integer');
  if (Array.from(before).length > maxInputChars || Array.from(after).length > maxInputChars) return fullWrite(after, revision, 'input_too_large');
  if (!before) return fullWrite(after, revision, 'empty_original');

  const beforeChars = Array.from(before);
  const afterChars = Array.from(after);
  let prefix = 0;
  while (prefix < beforeChars.length && prefix < afterChars.length && beforeChars[prefix] === afterChars[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < beforeChars.length - prefix && suffix < afterChars.length - prefix
    && beforeChars[beforeChars.length - suffix - 1] === afterChars[afterChars.length - suffix - 1]) suffix += 1;

  const oldString = beforeChars.slice(prefix, beforeChars.length - suffix).join('');
  const newString = afterChars.slice(prefix, afterChars.length - suffix).join('');
  if (!oldString) return fullWrite(after, revision, 'insertion_only');
  if (Array.from(oldString).length + Array.from(newString).length >= Array.from(after).length) return fullWrite(after, revision, 'patch_larger_than_write');
  if (Array.from(oldString).length + Array.from(newString).length > maxPatchChars) return fullWrite(after, revision, 'patch_larger_than_write');
  return { changed: true, expectedRevision: revision, mode: 'patch', patches: [{ oldString, newString }] };
}

function fullWrite(content: string, expectedRevision: string, reason: ClientNoteUpdatePlan['reason']): ClientNoteUpdatePlan {
  return { changed: true, expectedRevision, mode: 'write', patches: [], content, ...(reason && { reason }) };
}
