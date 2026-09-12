// Isolated V8 storage diagnostic: only synthetic data is printed, never heap
// snapshots or user document strings. Run with --allow-natives-syntax --import tsx.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInThisContext } from 'node:vm';
import { FileSystemService } from '../src/filesystem.ts';
import { PathFilter } from '../src/pathfilter.ts';
import { ScopeAccessPolicy } from '../src/scope-access.ts';
import { DocumentResourceReader } from '../src/document-resource.ts';
import { DocumentIndex } from '../src/document-index.ts';
import { DocumentSearch } from '../src/document-search.ts';

const root = await mkdtemp(join(tmpdir(), 'mcpvault-string-ownership-'));
const index = new DocumentIndex(new DocumentResourceReader(new FileSystemService(root), new PathFilter(), new ScopeAccessPolicy()));
const search = new DocumentSearch(index);
try {
  const target = 'synthetic-reference-for-source-storage-retention';
  const raw = `needle [[${target}]]\n\n${'x'.repeat(512 * 1024)}\n\nneedle last`;
  await writeFile(join(root, 'note.md'), raw);
  await search.search({ path: 'note.md', query: 'needle', limit: 1 });
  const debug = runInThisContext('(value) => %DebugPrint(value)');
  console.log('BASELINE_REFERENCE');
  debug(raw.slice(raw.indexOf(target), raw.indexOf(target) + target.length));
  console.log('CACHE_REFERENCE');
  const entry = [...search.pages.values()][0];
  const ref = entry.rows.flatMap(row => row.value.references)[0];
  if (ref !== target) throw new Error('Missing projected reference');
  debug(ref);
} finally {
  search.close(); await index.close(); await rm(root, { recursive: true, force: true });
}
