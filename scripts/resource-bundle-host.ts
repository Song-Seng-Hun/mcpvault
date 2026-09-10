/** Explicit host-only resource admission. This CLI is never an MCP endpoint. */
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readSkillResourceBundle, previewResourceBundle, applyResourceBundle, type ResourceBundleHostEntry } from '../src/resource-bundle-host.js';

const [vault, manifestPath, expectedFingerprint] = process.argv.slice(2);
if (!vault || !manifestPath) throw new Error('Usage: tsx scripts/resource-bundle-host.ts VAULT PRIVATE_MANIFEST [PREVIEW_FINGERPRINT]');
if ((await stat(manifestPath)).size > 1024 * 1024) throw new Error('Host manifest budget exceeded');
const bytes = await readFile(manifestPath);
if (bytes.length > 1024 * 1024) throw new Error('Host manifest budget exceeded');
const manifest = JSON.parse(bytes.toString('utf8')) as { entries: ResourceBundleHostEntry[] };
if (!Array.isArray(manifest.entries) || !manifest.entries.length || manifest.entries.length > 32) throw new Error('Provide 1..32 explicitly admitted host entries');
// Fail the whole preview on unadmitted sources. Never print source bytes/host paths.
const sources = [];
for (const entry of manifest.entries) {
  try { sources.push(await readSkillResourceBundle(entry)); }
  catch (error) {
    const message = error instanceof Error ? error.message : '';
    throw new Error(/sensitive|quarantine/.test(message) ? 'Host source requires confidential-content review' : 'Host source admission, license, availability or resource limits failed');
  }
}
const previews = [];
for (const source of sources) previews.push(await previewResourceBundle(vault, source));
const fingerprint = createHash('sha256').update(JSON.stringify(previews)).digest('hex');
if (expectedFingerprint) {
  if (fingerprint !== expectedFingerprint) throw new Error('Resource import fingerprint changed; preview again');
  const results = [];
  for (let i = 0; i < sources.length; i++) results.push(await applyResourceBundle(vault, sources[i]!, previews[i]!.fingerprint));
  console.log(JSON.stringify({ results }));
} else console.log(JSON.stringify({ fingerprint, previews, execution: 'never', visibility: 'Community; explicit host admission required' }));
