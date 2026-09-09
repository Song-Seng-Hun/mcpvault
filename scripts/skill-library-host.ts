/** Host-only explicit source admission. Never expose this as an MCP file reader. */
import { readFile } from 'node:fs/promises';
import { FileSystemService } from '../src/filesystem.js';
import { applySkills, previewSkills, projectSkill, readSkillSource, type SkillHostEntry } from '../src/skill-library.js';

const [vault, manifestPath, fingerprint] = process.argv.slice(2);
if (!vault || !manifestPath) throw new Error('Usage: tsx scripts/skill-library-host.ts VAULT PRIVATE_MANIFEST [PREVIEW_FINGERPRINT]');
const bytes = await readFile(manifestPath);
if (bytes.length > 1048576) throw new Error('Host manifest limit');
const manifest = JSON.parse(bytes.toString('utf8')) as { entries: SkillHostEntry[] };
if (!Array.isArray(manifest.entries) || !manifest.entries.length || manifest.entries.length > 256) throw new Error('Host manifest must contain 1..256 explicitly registered entries');
const notes = [], skipped: Array<{ id: string; reason: string }> = [];
let accepted = 0;
for (const entry of manifest.entries) {
  try { notes.push(...projectSkill(await readSkillSource(entry))); accepted++; }
  catch (error) {
    // Never emit raw filesystem errors/source bodies/absolute paths into shared reports.
    const msg = error instanceof Error ? error.message : '';
    skipped.push({ id: /^[a-z0-9-]{1,100}$/.test(entry.id) ? entry.id : 'invalid-id', reason: /sensitive/.test(msg) ? 'sensitive-source-review' : /license/i.test(msg) ? 'sharing-license-unconfirmed' : 'source-unavailable-or-outside-limits' });
  }
}
if (!notes.length) throw new Error('No sources admitted; no Vault writes');
const fs = new FileSystemService(vault);
const preview = await previewSkills(fs, notes);
if (fingerprint) {
  const result = await applySkills(fs, notes, fingerprint);
  console.log(JSON.stringify({ registered: manifest.entries.length, accepted, skipped, ...result }));
} else console.log(JSON.stringify({ registered: manifest.entries.length, accepted, skipped, ...preview }));
