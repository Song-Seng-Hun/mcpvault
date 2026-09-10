import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { LocalPdfProvider, loadPdfHostConfig } from '../src/document-pdf-host.js';

// Explicit host/operator-only smoke test. Input is an operator-selected synthetic
// fixture, never a path passed from an MCP caller. All parsing stays sandboxed.
const [configPath, input] = process.argv.slice(2);
if (!configPath || !input || process.argv.length !== 4) throw new Error('Usage: verify-document-pdf-host.ts CONFIG_JSON SYNTHETIC_PDF');
const metadata = await stat(input);
if (!metadata.isFile() || metadata.size > 50 * 1024 * 1024) throw new Error('Fixture byte budget exceeded');
const bytes = await readFile(input), revision = createHash('sha256').update(bytes).digest('hex');
const provider = new LocalPdfProvider(await loadPdfHostConfig(configPath));
const started = performance.now();
const document = await provider.extract({ path: basename(input), mediaType: 'application/pdf', bytes, revision });
console.log(JSON.stringify({ fixture: basename(input), revision, profile: document.profile, pages: document.pdfPages?.map(p => ({ page: p.page, status: p.status,
  characters: p.endOffset - p.startOffset, regions: p.regions.length })), fragments: document.fragments.length, gaps: document.gaps,
  elapsedMs: Math.round(performance.now() - started), cleanupCompleted: true }));
