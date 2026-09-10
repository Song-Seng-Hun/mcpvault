import { guidanceError } from './guidance-runtime.js';
import { integer, type Properties, type WorkPage } from './work-model.js';
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
  params: { limit?: number; maxChars?: number; cursor?: string }, kind: string): WorkPage {
  const limit = integer(params.limit, 20, 100, 'limit'), maxChars = integer(params.maxChars, 4000, 12000, 'maxChars');
  let offset = 0;
  if (params.cursor) {
    try {
      if (params.cursor.length > 1000) throw new Error();
      const value = JSON.parse(Buffer.from(params.cursor, 'base64url').toString('utf8'));
      if (value.f !== signature || value.k !== kind || !Number.isSafeInteger(value.o) || value.o < 0 || value.o >= rows.length) throw new Error();
      offset = value.o;
    } catch { throw guidanceError(new Error('Cursor invalidated by changed document generation or context'), 'guid-32c2dc90208f32a4'); }
  }
  const result: WorkPage = { ...context, items: [], total: rows.length, truncated: false };
  const update = () => {
    result.truncated = offset + result.items.length < rows.length;
    if (result.truncated) result.cursor = Buffer.from(JSON.stringify({ k: kind, f: signature, o: offset + result.items.length })).toString('base64url');
    else delete result.cursor;
  };
  update();
  for (let i = offset; i < Math.min(rows.length, offset + limit); i++) {
    result.items.push(project(rows[i]!)); update();
    if (JSON.stringify(result).length > maxChars) { result.items.pop(); update(); break; }
  }
  if (JSON.stringify(result).length > maxChars || (!result.items.length && result.truncated)) throw guidanceError(new Error('maxChars is too small for the next document metadata item'), 'guid-091f4d87a1c234e0');
  return result;
}
