import { guidanceError } from './guidance-runtime.js';
import { integer, type Properties, type WorkPage } from './work-model.js';
// A signed anchor may include a 500 UTF-16-unit path encoded as UTF-8/Base64URL.
export const DOCUMENT_CURSOR_MAX_CHARS = 4096;
export function boundedHeadingLabel(parts: readonly string[], max = 240): string {
  let label = '';
  for (const part of parts) {
    if (label.length >= max) break;
    label += (label ? ' / ' : '').slice(0, max - label.length);
    label += part.slice(0, max - label.length);
  }
  return label;
}
/** Only lightweight rows are collected by callers; descriptors are produced for
 * the requested page. Cursor binding is a source-generation fingerprint. */
export function documentPage<T>(rows: readonly T[], project: (row: T) => Properties, context: Properties, signature: string,
  params: { limit?: number; maxChars?: number; cursor?: string }, kind: string,
  window?: { offset: number; total: number; cursorFields: (row: T, nextOffset: number) => Properties }): WorkPage {
  const limit = integer(params.limit, 20, 100, 'limit'), maxChars = integer(params.maxChars, 4000, 12000, 'maxChars');
  const total = window?.total ?? rows.length;
  let offset = 0;
  if (params.cursor) {
    try {
      if (params.cursor.length > DOCUMENT_CURSOR_MAX_CHARS) throw new Error();
      const value = JSON.parse(Buffer.from(params.cursor, 'base64url').toString('utf8'));
      if (value.f !== signature || value.k !== kind || !Number.isSafeInteger(value.o) || value.o < 0 || value.o >= total
        || (window && value.o !== window.offset)) throw new Error();
      offset = value.o;
    } catch { throw guidanceError(new Error('Cursor invalidated by changed document generation or context'), 'guid-32c2dc90208f32a4'); }
  }
  const localOffset = offset - (window?.offset ?? 0);
  const result: WorkPage = { ...context, items: [], total, truncated: false };
  const update = () => {
    const nextOffset = offset + result.items.length;
    result.truncated = nextOffset < total;
    const last = rows[localOffset + result.items.length - 1];
    if (result.truncated) result.cursor = Buffer.from(JSON.stringify({ k: kind, f: signature, o: nextOffset,
      ...(window && last !== undefined && result.items.length > 0 ? window.cursorFields(last, nextOffset) : {}) })).toString('base64url');
    else delete result.cursor;
  };
  update();
  for (let i = localOffset; i < Math.min(rows.length, localOffset + limit); i++) {
    result.items.push(project(rows[i]!)); update();
    if (JSON.stringify(result).length > maxChars) { result.items.pop(); update(); break; }
  }
  if (JSON.stringify(result).length > maxChars || (!result.items.length && result.truncated)) throw guidanceError(new Error('maxChars is too small for the next document metadata item'), 'guid-091f4d87a1c234e0');
  return result;
}
