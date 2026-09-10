import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
export const RESOURCE_BUNDLE_ROOT = 'Community/_sources/resources';
export interface ResourceBundleEntry { path: string; status: 'available' | 'rejected'; sha256?: string; byteLength?: number; mediaType?: string; reason?: string }
export interface ResourceBundleManifest { version: 1; id: string; origin: string; sourceVersion: string; license: string; licenseFile: string; entries: ResourceBundleEntry[]; execution: 'never' }
export const resourceBundleHash = (manifest: ResourceBundleManifest) => createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
export function safeResourceRelative(path: string): boolean {
  return typeof path === 'string' && path.length > 0 && path.length <= 180 && !path.includes('\\')
    && new PathFilter().isAllowedForListing(path) && path.split('/').every(part => part && !part.startsWith('.')
      && !/[\x00-\x1f\x7f:<>"|?*]/.test(part) && !/[. ]$/.test(part)
      && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) && !/^_(?:scopes|whispers|evolution)$/i.test(part));
}
export function resourceBundleLocation(path: string): { root: string; relative: string; hash: string } | undefined {
  const match = /^(Community\/_sources\/resources\/[a-z0-9][a-z0-9-]{0,99}\/([a-f0-9]{64}))\/(.+)$/i.exec(path.replace(/\\/g, '/'));
  return match ? { root: match[1]!, hash: match[2]!, relative: match[3]! } : undefined;
}
export function parseResourceBundleManifest(raw: string, hash: string): ResourceBundleManifest {
  if (Buffer.byteLength(raw) > 256 * 1024) throw guidanceError(new Error('Resource bundle manifest budget exceeded'), 'guid-91281247fdc2071e');
  const content = new FrontmatterHandler().parse(raw).content;
  const match = /^# Resource bundle\r?\n\r?\n```json\r?\n([\s\S]*)\r?\n```\s*$/.exec(content.trim());
  if (!match) throw guidanceError(new Error('Resource bundle manifest unavailable'), 'guid-39dfffe5719de3a3');
  const m = JSON.parse(match[1]!) as ResourceBundleManifest;
  if (m.version !== 1 || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(m.id) || m.execution !== 'never'
    || typeof m.origin !== 'string' || m.origin.length > 2000 || typeof m.sourceVersion !== 'string' || m.sourceVersion.length > 2000
    || !['MIT', 'Apache-2.0'].includes(m.license) || !safeResourceRelative(m.licenseFile)
    || !Array.isArray(m.entries) || !m.entries.length || m.entries.length > 128 || resourceBundleHash(m) !== hash) throw guidanceError(new Error('Resource bundle manifest hash or schema mismatch'), 'guid-e2546364ac0e35fc');
  const seen = new Set<string>();
  for (const entry of m.entries) {
    if (!safeResourceRelative(entry.path) || seen.has(entry.path.toLowerCase()) || !['available', 'rejected'].includes(entry.status)) throw guidanceError(new Error('Resource bundle entry invalid'), 'guid-5b30a7ed175e4d64');
    seen.add(entry.path.toLowerCase());
    if (entry.status === 'available' && (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || !Number.isSafeInteger(entry.byteLength)
      || entry.byteLength! < 0 || entry.byteLength! > 50 * 1024 * 1024 || typeof entry.mediaType !== 'string' || entry.mediaType.length > 100)) throw guidanceError(new Error('Resource bundle entry hash or size invalid'), 'guid-5e7cd6b3768d99ab');
    if (entry.status === 'rejected' && (typeof entry.reason !== 'string' || entry.reason.length > 200)) throw guidanceError(new Error('Resource bundle rejection reason invalid'), 'guid-efa4f50204f1dca0');
  }
  return m;
}
export function renderResourceBundleManifest(manifest: ResourceBundleManifest): string {
  return `# Resource bundle\n\n\`\`\`json\n${JSON.stringify(manifest, null, 2)}\n\`\`\`\n`;
}
/** Imports are host-only immutable snapshots, including their ancestor moves. */
export function assertResourceBundleMutationBoundary(path: string): void {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(), root = RESOURCE_BUNDLE_ROOT.toLowerCase();
  if (normalized && (normalized === root || normalized.startsWith(root + '/') || root.startsWith(normalized + '/'))) throw guidanceError(new Error('Imported resource bundles are immutable; host-import a new revision'), 'guid-2ef51abb71a90177');
}
