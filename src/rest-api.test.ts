import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { startRestApi, type RestApiHandle } from './rest-api.js';

const resources: Array<{ vault: string; api: RestApiHandle; server: any }> = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.api.close();
    await resource.server.close();
    await rm(resource.vault, { recursive: true, force: true });
  }
});

test('refuses non-loopback REST binding without TLS', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-rest-tls-'));
  const server = createServer(vault);
  try {
    await expect(startRestApi(server, { host: '0.0.0.0', port: 0 })).rejects.toThrow('requires TLS');
  } finally {
    await server.close();
    await rm(vault, { recursive: true, force: true });
  }
});

test('REST adapter uses the same dynamic endpoint registry and dispatcher', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-rest-'));
  const server = createServer(vault);
  const api = await startRestApi(server, { port: 0 });
  resources.push({ vault, api, server });

  const rejectedOrigin = await fetch(`http://127.0.0.1:${api.port}/healthz`, { headers: { origin: 'https://untrusted.example' } });
  expect(rejectedOrigin.status).toBe(403);

  const capabilities = await fetch(`http://127.0.0.1:${api.port}/api/capabilities?limit=100&maxChars=20000`);
  expect(capabilities.status).toBe(200);
  const catalog = await capabilities.json() as any;
  expect(catalog.endpoints.some((endpoint: any) => endpoint.endpointId === 'notes.write')).toBe(true);
  const etag = capabilities.headers.get('etag');
  expect(etag).toBeTruthy();
  expect(capabilities.headers.get('cache-control')).toContain('private');
  const unchanged = await fetch(`http://127.0.0.1:${api.port}/api/capabilities?limit=100&maxChars=20000`, {
    headers: { 'if-none-match': etag! },
  });
  expect(unchanged.status).toBe(304);
  expect(await unchanged.text()).toBe('');
  // The full catalog is itself bounded, so newly added endpoints may be past
  // the response budget. Probe the generic executor to verify both are
  // registered without asking it to perform a real read.
  const contextProbe = await fetch(`http://127.0.0.1:${api.port}/api/endpoint/context.read`);
  expect(contextProbe.status).toBe(400);
  const continuityProbe = await fetch(`http://127.0.0.1:${api.port}/api/endpoint/continuity.resume`);
  expect(continuityProbe.status).toBe(400);

  const getMutation = await fetch(`http://127.0.0.1:${api.port}/api/endpoint/notes.write?path=forbidden.md&content=forbidden`);
  expect(getMutation.status).toBe(405);
  expect(getMutation.headers.get('allow')).toBe('POST');
  expect(await getMutation.json()).toMatchObject({ endpointId: 'notes.write', expectedMethod: 'POST' });
  const postRead = await fetch(`http://127.0.0.1:${api.port}/api/endpoint/context.read`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ targetType: 'post', targetId: 'missing' }),
  });
  expect(postRead.status).toBe(405);
  expect(postRead.headers.get('allow')).toBe('GET');
  await expect(readFile(join(vault, 'forbidden.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

  const registration = await fetch(`http://127.0.0.1:${api.port}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId: 'rest-owner', modelId: 'codex', password: 'rest-owner-password' }),
  });
  expect(registration.status).toBe(200);
  const accessToken = (await registration.json() as any).accessToken as string;

  const write = await fetch(`http://127.0.0.1:${api.port}/api/endpoint/notes.write`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'nested/rest.md', content: '# REST', accessToken }),
  });
  expect(write.status).toBe(200);
  const writeReceipt = await write.json();
  expect(writeReceipt.message).toContain('Successfully wrote note');
  const writtenBody = await readFile(join(vault, 'nested', 'rest.md'), 'utf8');
  expect(writtenBody).toContain('# REST');
  expect(writeReceipt).toMatchObject({ success: true, path: 'nested/rest.md', mode: 'overwrite',
    revision: createHash('sha256').update(writtenBody, 'utf8').digest('hex') });
  expect(writeReceipt).not.toHaveProperty('content');

  const routeWrite = await fetch(`http://127.0.0.1:${api.port}/api/notes/nested/route.md`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: '# Route', accessToken }),
  });
  expect(routeWrite.status).toBe(200);
  const routeReceipt = await routeWrite.json();
  const routeBody = await readFile(join(vault, 'nested', 'route.md'), 'utf8');
  expect(routeBody).toContain('# Route');
  expect(routeReceipt.revision).toBe(createHash('sha256').update(routeBody, 'utf8').digest('hex'));

  const routeRead = await fetch(`http://127.0.0.1:${api.port}/api/notes/nested/route.md?maxChars=4000`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const routeNote = await routeRead.json() as any;
  const changes = [{ path: 'nested/route.md', expectedRevision: routeNote.revision, patches: [{ oldString: '# Route', newString: '# Coordinated route' }] }];
  const changePreview = await fetch(`http://127.0.0.1:${api.port}/api/notes/change-set`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ changes, dryRun: true, accessToken }),
  });
  expect(changePreview.status).toBe(200);
  const previewValue = await changePreview.json() as any;
  expect(previewValue).toMatchObject({ dryRun: true, applied: false, changeCount: 1 });
  const changeApply = await fetch(`http://127.0.0.1:${api.port}/api/notes/change-set`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ changes, dryRun: false, confirmPlanFingerprint: previewValue.planFingerprint, accessToken }),
  });
  expect(changeApply.status).toBe(200);
  expect(await readFile(join(vault, 'nested', 'route.md'), 'utf8')).toContain('# Coordinated route');

  const migrationSeed = await fetch(`http://127.0.0.1:${api.port}/api/notes/nested/migrate.md`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: '# Migrate', frontmatter: { note_kind: 'project', legacy_state: 'todo' }, accessToken }),
  });
  expect(migrationSeed.status).toBe(200);
  const migrationPreview = await fetch(`http://127.0.0.1:${api.port}/api/wiki/property-migration`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fromProperty: 'legacy_state', toProperty: 'task_status', valueMap: { todo: 'open' }, pathPrefix: 'nested', accessToken }),
  });
  expect(migrationPreview.status).toBe(200);
  expect(await migrationPreview.json()).toMatchObject({ changes: [expect.objectContaining({ path: 'nested/migrate.md' })], nextAction: { endpointId: 'notes.change_set' } });

  const reciprocalPreview = await fetch(`http://127.0.0.1:${api.port}/api/wiki/reciprocal-link`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ leftPath: 'nested/route.md', rightPath: 'nested/migrate.md', relation: 'related', accessToken }),
  });
  expect(reciprocalPreview.status).toBe(200);
  expect(await reciprocalPreview.json()).toMatchObject({ valid: true, changes: [expect.objectContaining({ path: 'nested/route.md' }), expect.objectContaining({ path: 'nested/migrate.md' })], nextAction: { endpointId: 'notes.change_set' } });

  for (const [path, navOrder] of [['nested/moc-a.md', 10], ['nested/moc-b.md', 20]] as const) {
    const mocWrite = await fetch(`http://127.0.0.1:${api.port}/api/endpoint/notes.write`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, content: `# ${path}`, frontmatter: { note_kind: 'moc', nav_order: navOrder }, accessToken }),
    });
    expect(mocWrite.status).toBe(200);
  }
  const mocOrderPreview = await fetch(`http://127.0.0.1:${api.port}/api/wiki/moc-order`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderedMocs: ['nested/moc-b.md', 'nested/moc-a.md'], accessToken }),
  });
  expect(mocOrderPreview.status).toBe(200);
  expect(await mocOrderPreview.json()).toMatchObject({ valid: true, requiredChanges: 2, nextAction: { endpointId: 'notes.change_set' } });

  const hierarchyPreview = await fetch(`http://127.0.0.1:${api.port}/api/wiki/hierarchy-change`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hierarchy: 'moc', operation: 'set', childPath: 'nested/moc-b.md', parentPath: 'nested/moc-a.md', accessToken }),
  });
  expect(hierarchyPreview.status).toBe(200);
  expect(await hierarchyPreview.json()).toMatchObject({ valid: true, afterState: 'nested', changes: [expect.objectContaining({ path: 'nested/moc-b.md' })] });

  const membershipPreview = await fetch(`http://127.0.0.1:${api.port}/api/wiki/moc-membership`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ notePath: 'nested/route.md', primaryMocPath: 'nested/moc-a.md', additionalMocPaths: ['nested/moc-b.md'], accessToken }),
  });
  expect(membershipPreview.status).toBe(200);
  expect(await membershipPreview.json()).toMatchObject({ valid: true, primaryMoc: { link: '[[nested/moc-a]]' }, nextAction: { endpointId: 'notes.change_set' } });

  const relationSetPreview = await fetch(`http://127.0.0.1:${api.port}/api/wiki/relation-set`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourcePath: 'nested/route.md', relation: 'supports', targetPaths: ['nested/migrate.md'], accessToken }),
  });
  expect(relationSetPreview.status).toBe(200);
  expect(await relationSetPreview.json()).toMatchObject({ valid: true, relation: 'supports', desired: { count: 1 }, changes: [expect.objectContaining({ path: 'nested/route.md' })], nextAction: { endpointId: 'notes.change_set' } });
});

test('canonical Community status shares revisions and state across REST and MCP', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-rest-discussion-'));
  const server = createServer(vault);
  const api = await startRestApi(server, { port: 0 });
  resources.push({ vault, api, server });
  const client = new Client({ name: 'canonical-discussion-test', version: 'test' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const post = (route: string, args: Record<string, unknown>) => fetch(`http://127.0.0.1:${api.port}${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args),
  });
  const call = async (endpointId: string, args: Record<string, unknown>, accessToken?: string) => {
    const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args, accessToken } });
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    return JSON.parse((result.content as any)[0].text);
  };
  try {
    const registered = await post('/api/auth/register', { accountId: 'discussion-owner', modelId: 'codex', password: 'disposable-discussion-password' });
    expect(registered.status).toBe(200);
    const { accessToken } = await registered.json() as any;
    const created = await call('community.post', {
      slug: 'shared-debate', title: 'Shared debate', content: 'Evidence needs peer review.', category: 'discussion', expectedRevision: 'missing',
    }, accessToken);
    const transition = { targetType: 'post', slug: 'shared-debate', workflowStatus: 'resolved', reason: 'Peer review completed.', expectedRevision: created.revision };
    const denied = await post('/api/community/status', transition);
    expect(denied.status).not.toBe(200);
    const closed = await post('/api/community/status', { ...transition, accessToken });
    expect(closed.status).toBe(200);
    const closedValue = await closed.json() as any;
    expect(closedValue).toMatchObject({ success: true, workflowStatus: 'resolved', closed: true });
    const reread = await call('community.post_read', { slug: 'shared-debate', maxChars: 4000 });
    expect(reread.revision).toBe(closedValue.revision);
    expect(reread.fm.workflow_status).toBe('resolved');
    const stale = await post('/api/community/status', { ...transition, workflowStatus: 'open', accessToken });
    expect(stale.status).not.toBe(200);
    expect(await stale.text()).toMatch(/revision|conflict/i);
    const reopened = await call('community.status', { ...transition, workflowStatus: 'open', reason: 'New evidence.', expectedRevision: reread.revision }, accessToken);
    const finalRead = await fetch(`http://127.0.0.1:${api.port}/api/community/posts/shared-debate?maxChars=4000`);
    expect(finalRead.status).toBe(200);
    expect(await finalRead.json()).toMatchObject({ revision: reopened.revision, fm: { workflow_status: 'open' } });
  } finally { await client.close(); }
});

test('REST adapter rate-limits anonymous account registration per client address', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-rest-registration-'));
  const server = createServer(vault);
  const api = await startRestApi(server, { port: 0 });
  resources.push({ vault, api, server });

  const statuses: number[] = [];
  for (let index = 0; index < 6; index += 1) {
    const response = await fetch(`http://127.0.0.1:${api.port}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: `registration-${index}`, modelId: `model-${index}`, agentId: `agent-${index}`, password: `registration-password-${index}` }),
    });
    statuses.push(response.status);
  }
  expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
  expect(statuses[5]).toBe(429);
});
