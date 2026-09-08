import { resolve } from 'node:path';
import { GuidanceCatalog } from './src/guidance-catalog.js';
import { GuidanceSync } from './src/guidance-sync.js';
import { GUIDANCE_DEFINITIONS } from './src/guidance-defaults.generated.js';

// Host-only CLI; no credentials, no raw response collection, no automatic timer.
const args = process.argv.slice(2);
const vaultArg = args[0];
if (!vaultArg || args.some((a, i) => i > 0 && !['--apply', '--offset'].includes(args[i - 1]!) && !['--apply', '--offset'].includes(a))) throw new Error('Usage: guidance-host <vault> [--apply <preview-fingerprint>] [--offset <number>]');
const vault = resolve(vaultArg);
const catalog = new GuidanceCatalog(vault, () => ({ root: '_wiki/Interface', editors: [] }), GUIDANCE_DEFINITIONS);
const sync = new GuidanceSync(vault, catalog);
const offsetAt = args.indexOf('--offset'), offset = offsetAt < 0 ? 0 : Number(args[offsetAt + 1]);
if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid report offset');
const preview = await sync.preview();
const applyAt = args.indexOf('--apply');
if (applyAt >= 0) await sync.apply(args[applyAt + 1] ?? '');
console.log(JSON.stringify({ applied: applyAt >= 0, vault, fingerprint: preview.fingerprint,
  total: preview.changes.length, counts: Object.fromEntries([...new Set(preview.changes.map(c => c.action))].map(a => [a, preview.changes.filter(c => c.action === a).length])),
  changes: preview.changes.slice(offset, offset + 20), ...(offset + 20 < preview.changes.length && { nextOffset: offset + 20 }),
  warning: 'Host-only explicit sync. Review counts/conflicts; original edits are preserved. Not an atomic multi-file operation. Activate the collection in the private notice configuration after checking path collisions.' }, null, 2));
