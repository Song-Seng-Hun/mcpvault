import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, getServerRuntime } from './createServer.js';
import { VaultIoCoordinator } from './vault-io.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
test('shared index initialization never reads protected bodies or metadata, including before policy startup resolves', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shared-index-authority-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '_wiki', '_policies'), { recursive: true });
  await writeFile(join(root, '_wiki', '_policies', 'documents.md'), '---\ntype: protected-document-policy\nversion: 1\nrules:\n  - path: Secret.md\n    confidential: true\n---\n');
  await writeFile(join(root, 'Secret.md'), '---\ntitle: PRIVATE_TITLE\n---\n# SECRET_BODY');
  await writeFile(join(root, 'Public.md'), '# Public content');
  const reads = [vi.spyOn(VaultIoCoordinator.prototype, 'readUtf8'), vi.spyOn(VaultIoCoordinator.prototype, 'readUtf8Metadata'), vi.spyOn(VaultIoCoordinator.prototype, 'readUtf8Header')];
  const server = createServer(root); cleanup.push(() => server.close());
  const result = await getServerRuntime(server)!.dispatchTool('call_endpoint', { endpointId: 'wiki.search', arguments: { query: 'Public', maxChars: 3000 } });
  expect(result.isError).not.toBe(true); expect(result.content[0].text).toContain('Public');
  for (const read of reads) expect(read.mock.calls.filter(args => String(args[0]).replace(/\\/g, '/').endsWith('/Secret.md'))).toEqual([]);
});
