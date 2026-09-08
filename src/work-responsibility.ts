import { guidanceError } from './guidance-runtime.js';
import { posix } from 'node:path';
import { listField, textField, type Properties } from './work-model.js';

export interface WorkResource { path?: string; repository?: string; file?: string }
export interface WorkResponsibility {
  question?: string; perspective?: string;
  mode?: 'exclusive_write' | 'advice' | 'alternative';
  deliverables?: string[]; conditions?: string[]; coversCriteria?: string[];
  resources?: WorkResource[];
}

/** Literal, finite resource declarations, never glob patterns or executable rules. */
export function responsibility(value: unknown): WorkResponsibility {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw guidanceError(new Error('responsibility must be an object'), 'guid-ceb3f9ac5ce5202b');
  const input = value as Properties;
  const allowed = ['question', 'perspective', 'mode', 'deliverables', 'conditions', 'coversCriteria', 'resources'];
  if (Object.keys(input).some(k => !allowed.includes(k))) throw guidanceError(new Error('Unknown responsibility field'), 'guid-8c70af218665545d');
  const result: WorkResponsibility = {};
  for (const key of ['question', 'perspective'] as const) if (input[key] !== undefined) result[key] = textField(input[key], key, key === 'perspective' ? 80 : 500, true);
  if (input.mode !== undefined) {
    if (!['exclusive_write', 'advice', 'alternative'].includes(input.mode)) throw guidanceError(new Error('Invalid responsibility mode'), 'guid-32173491c8bd0ad7');
    result.mode = input.mode;
  }
  for (const key of ['deliverables', 'conditions', 'coversCriteria'] as const) if (input[key] !== undefined) result[key] = listField(input[key], key, 20);
  if (input.resources !== undefined) {
    if (!Array.isArray(input.resources) || input.resources.length > 20) throw guidanceError(new Error('resources must contain at most 20 exact locators'), 'guid-30711a68c775865c');
    result.resources = input.resources.map((r: Properties) => {
      if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some(k => !['path', 'repository', 'file'].includes(k))) throw guidanceError(new Error('Invalid resource locator'), 'guid-b56497f185640d1a');
      if (r.path !== undefined) {
        if (r.repository !== undefined || r.file !== undefined) throw guidanceError(new Error('Use a vault path or repository/file, not both'), 'guid-58e3df7727b818fd');
        return { path: canonicalFile(textField(r.path, 'resource.path', 500, true)) };
      }
      const repository = textField(r.repository, 'resource.repository', 300, true);
      let url: URL;
      try { url = new URL(repository); } catch { throw guidanceError(new Error('Repository resource requires a canonical HTTPS URL'), 'guid-16306d978744d4f9'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw guidanceError(new Error('Repository resource requires a credential-free HTTPS URL'), 'guid-23041d04da83c441');
      // Normalized URL + case-preserving repository path; refs/commits deliberately
      // do not partition a reservation over the same shared file.
      return { repository: url.href.replace(/\/$/, '').replace(/\.git$/, ''), file: canonicalFile(textField(r.file, 'resource.file', 500, true)) };
    });
  }
  if (result.mode === 'exclusive_write' && !result.resources?.length) throw guidanceError(new Error('Exclusive responsibility requires exact resources'), 'guid-4e169ef16e889aed');
  return result;
}

function canonicalFile(value: string): string {
  const normalized = value.replace(/\\/g, '/').normalize('NFC');
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || /[\x00-\x1f*?#[\]]/.test(normalized)
    || normalized.split('/').some(s => !s || s === '.' || s === '..' || /[. ]$/.test(s))) throw guidanceError(new Error('Resource must be an exact canonical relative file'), 'guid-f0fbdbd0b7c18d4b');
  return posix.normalize(normalized);
}

export function resourceKeys(value: WorkResponsibility): string[] {
  return (value.resources || []).map(r => JSON.stringify(r.path ? ['vault', r.path.toLowerCase()] : ['repository', r.repository, r.file]));
}

export function assignmentShape(value?: WorkResponsibility) {
  return { perspective: value?.perspective, mode: value?.mode, resources: value?.resources };
}
