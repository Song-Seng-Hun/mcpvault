import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer, getServerRuntime } from './createServer.js';
import { createHash } from 'node:crypto';
import { getWikiPolicyTopic, WIKI_POLICY_TOPICS, WIKI_POLICY_VERSION } from './wiki-policy.js';

let vault: string;

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-llm-wiki-'));
});

test('compact onboarding retains one usable first action without preloading signup or dashboards', async () => {
  const { server, client } = await setup();
  try {
    await writeFile(join(vault, '환영합니다!.md'), '# Welcome\nRead before registering.');
    for (const maxChars of [512, 1024, 4500, 12000]) {
      const { result, value } = await callJson(client, 'orient_wiki', { maxChars, prettyPrint: true });
      expect(result.isError).toBeFalsy();
      expect(result.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('').length).toBeLessThanOrEqual(maxChars);
      expect(value.nextActions).toEqual([expect.objectContaining({ tool: 'notes.read', arguments: { path: '환영합니다!.md', maxChars: 3000 } })]);
      expect(value.nextActions.some((item: any) => item.tool === 'auth.register')).toBe(false);
      expect(JSON.stringify(value)).toContain('host-only');
      expect(JSON.stringify(value)).not.toContain('commit_changes');
      expect(JSON.stringify(value)).not.toContain('review_queue');
      if (value.primaryAction) expect(value.actionBudget).toMatchObject({ endpointCalls: 1, stopAfterAction: true });
    }
    const defaultOrientation = await callJson(client, 'orient_wiki', {});
    const defaultText = defaultOrientation.result.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('');
    expect(defaultText.length).toBeLessThanOrEqual(3000);
    expect(defaultOrientation.value.nextActions).toHaveLength(1);
    expect(defaultOrientation.value.access.mode).toBe('public-global-and-community');
    expect(defaultOrientation.value.access.commandCenterId).toBe('local');
    expect(defaultOrientation.value).not.toHaveProperty('catalog');
    expect(defaultOrientation.value).not.toHaveProperty('lint');
  } finally { await client.close(); await server.close(); }
});

test('MOC context packs follow authored links with revisions and exclude example and hidden targets', async () => {
  const { server, client } = await setup();
  try {
    await mkdir(join(vault, 'Maps'), { recursive: true });
    await mkdir(join(vault, 'Knowledge'), { recursive: true });
    await writeFile(join(vault, 'Maps', 'Root.md'), '---\nnote_kind: moc\n---\n# Root\n\n## Read this way\n~~~md\n[[Knowledge/Example]]\n~~~\n[Z first](../Knowledge/Z.md#Start) [[Knowledge/A#^claim]]\n[[Knowledge/Hidden]]\n');
    await writeFile(join(vault, 'Knowledge', 'Z.md'), '---\nnote_kind: atomic\n---\n# Z\n## Start\nGrounded context.');
    await writeFile(join(vault, 'Knowledge', 'A.md'), '---\nnote_kind: atomic\n---\n# A\nA claim. ^claim');
    await writeFile(join(vault, 'Knowledge', 'Example.md'), '# Not a real entry');
    await writeFile(join(vault, 'Knowledge', 'Hidden.md'), '---\nmoderation_status: quarantined\n---\nHidden content');
    const read = await callJson(client, 'read_note', { path: 'Knowledge/Z.md' });
    const pack = await callJson(client, 'get_wiki_context_pack', { path: 'Maps/Root.md', maxChars: 16000, includeSemantic: false });
    expect(pack.result.isError).toBeFalsy();
    expect(pack.value.readOrder.slice(0, 3)).toEqual(['Maps/Root.md', 'Knowledge/Z.md', 'Knowledge/A.md']);
    expect(pack.value.entrypoints.find((item: any) => item.path === 'Knowledge/Z.md')).toMatchObject({ revision: read.value.revision, section: 'Read this way', line: 7, targetHeading: 'Start' });
    expect(pack.value.entrypoints.find((item: any) => item.path === 'Knowledge/A.md')).toMatchObject({ targetBlockId: 'claim' });
    expect(pack.value.readOrder).not.toContain('Knowledge/Example.md');
    expect(pack.value.readOrder).not.toContain('Knowledge/Hidden.md');
    for (const maxChars of [1024, 2200]) {
      const small = await callJson(client, 'get_wiki_context_pack', { path: 'Maps/Root.md', maxChars, includeSemantic: false });
      expect(small.result.isError).toBeFalsy();
      expect(JSON.stringify(small.value).length).toBeLessThanOrEqual(maxChars);
      expect(small.value.readOrder).toEqual(small.value.entrypoints.map((item: any) => item.path));
      expect(small.value.entrypoints.every((item: any) => typeof item.revision === 'string' && item.revision.length === 64)).toBe(true);
    }
  } finally { await client.close(); await server.close(); }
});

test('Obsidian Canvas projections preserve spatial order, scope boundaries, and source revisions', async () => {
  await mkdir(join(vault, 'Knowledge'), { recursive: true });
  await mkdir(join(vault, 'Community'), { recursive: true });
  await writeFile(join(vault, 'Knowledge', 'Spatial map.md'), [
    '---', 'llm_wiki_type: knowledge', 'note_kind: moc', 'lifecycle: evergreen', '---',
    '# Spatial map', '', '[[Knowledge/Basics]]', '[[Knowledge/Advanced]]', '[[Community/Local only]]',
  ].join('\n'));
  await writeFile(join(vault, 'Knowledge', 'Basics.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: evergreen\n---\n# Basics\n\nA body that must not be copied into Canvas.\n');
  await writeFile(join(vault, 'Knowledge', 'Advanced.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: evergreen\ndepends_on:\n  - "[[Knowledge/Basics]]"\n---\n# Advanced\n');
  await writeFile(join(vault, 'Community', 'Local only.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: evergreen\n---\n# Command-center-only note\n');
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'canvas-owner', modelId: 'codex', password: 'canvas-owner-secret' });
    const accessToken = registration.value.accessToken;
    const discovery = await callJson(client, 'search_capabilities', { query: 'Obsidian spatial Canvas knowledge map', limit: 4, maxChars: 8000, accessToken });
    expect(discovery.value.endpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ endpointId: 'wiki.canvas_view', available: true }),
      expect.objectContaining({ endpointId: 'wiki.canvas_export', available: true, method: 'POST' }),
    ]));
    const healthDiscovery = await callJson(client, 'search_capabilities', { query: 'stale Canvas health repair', limit: 3, maxChars: 6000, accessToken });
    expect(healthDiscovery.value.endpoints).toEqual(expect.arrayContaining([expect.objectContaining({ endpointId: 'wiki.canvas_health', available: true })]));

    const preview = await callJson(client, 'get_wiki_canvas_view', { path: 'Knowledge/Spatial map.md', mode: 'auto', maxDepth: 2, limit: 20, maxChars: 16000, accessToken });
    expect(preview.value).toMatchObject({
      mode: 'moc_canvas', standard: 'JSON Canvas 1.0', suggestedPath: 'Views/Spatial map Spatial.canvas', outputRevision: 'missing',
      root: { path: 'Knowledge/Spatial map.md', revision: expect.stringMatching(/^[a-f0-9]{64}$/) },
      exportAction: { endpointId: 'wiki.canvas_export', arguments: { expectedRevision: 'missing', expectedSourceRevision: expect.any(String) } },
      counts: { excludedCrossScope: 1 },
    });
    const canvasText = JSON.stringify(preview.value.canvas);
    expect(canvasText).toContain('Knowledge/Basics.md');
    expect(canvasText).toContain('Knowledge/Advanced.md');
    expect(canvasText).not.toContain('Community/Local only.md');
    expect(canvasText).not.toContain('A body that must not be copied');
    expect(preview.value.canvas.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: expect.stringMatching(/^curates/) }),
      expect.objectContaining({ label: 'depends_on', color: '2' }),
    ]));
    expect(JSON.stringify(preview.value).length).toBeLessThanOrEqual(16000);

    const compact = await callJson(client, 'get_wiki_canvas_view', { path: 'Knowledge/Spatial map.md', mode: 'moc', maxDepth: 2, limit: 20, maxChars: 2400, prettyPrint: true, accessToken });
    expect(String((compact.result.content as any)[0]?.text).length).toBeLessThanOrEqual(2400);
    expect(compact.value.root).toMatchObject({ path: 'Knowledge/Spatial map.md', revision: preview.value.root.revision });
    expect(compact.value.canvas.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'file', file: 'Knowledge/Spatial map.md' })]));
    expect(compact.value.truncated).toBe(true);

    const wrongScope = await client.callTool({ name: 'export_wiki_canvas', arguments: {
      path: 'Knowledge/Spatial map.md', mode: 'moc', outputPath: 'Community/Views/Leaked.canvas',
      expectedSourceRevision: preview.value.root.revision, expectedRevision: 'missing', accessToken,
    } });
    expect(wrongScope.isError).toBe(true);
    expect(String((wrongScope.content as any)[0]?.text)).toContain('same Global, Community, model, or agent scope');

    const saved = await callJson(client, 'export_wiki_canvas', {
      path: 'Knowledge/Spatial map.md', mode: 'moc', maxDepth: 2, limit: 20, maxChars: 16000,
      expectedSourceRevision: preview.value.root.revision, expectedRevision: 'missing', accessToken,
    });
    expect(saved.value).toMatchObject({ persisted: true, path: 'Views/Spatial map Spatial.canvas', previousRevision: 'missing', snapshotFingerprint: preview.value.snapshotFingerprint });
    const persisted = JSON.parse(await readFile(join(vault, 'Views', 'Spatial map Spatial.canvas'), 'utf8'));
    expect(persisted).toMatchObject({ nodes: expect.any(Array), edges: expect.any(Array) });
    expect(JSON.stringify(persisted)).not.toContain('A body that must not be copied');
    expect(JSON.stringify(persisted)).toContain('mcpvault-canvas:');
    await callJson(client, 'export_wiki_canvas', {
      path: 'Knowledge/Spatial map.md', mode: 'moc', outputPath: 'Views/Spatial map Copy.canvas',
      maxDepth: 2, limit: 20, maxChars: 16000, expectedSourceRevision: preview.value.root.revision, expectedRevision: 'missing', accessToken,
    });
    const sharedSourceHealth = await callJson(client, 'get_wiki_canvas_health', { limit: 10, maxChars: 12000, accessToken });
    expect(sharedSourceHealth.value.counts).toMatchObject({ total: 2, fresh: 2, sourceChecks: 3 });
    await rm(join(vault, 'Views', 'Spatial map Copy.canvas'));
    const freshHealth = await callJson(client, 'get_wiki_canvas_health', { limit: 10, maxChars: 8000, accessToken });
    expect(freshHealth.value.counts).toMatchObject({ total: 1, fresh: 1 });
    expect(freshHealth.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Views/Spatial map Spatial.canvas', state: 'fresh', root: expect.objectContaining({ path: 'Knowledge/Spatial map.md' }) })]));
    const compactHealth = await callJson(client, 'get_wiki_canvas_health', { limit: 10, maxChars: 1024, prettyPrint: true, accessToken });
    expect(String((compactHealth.result.content as any)[0]?.text).length).toBeLessThanOrEqual(1024);
    expect(compactHealth.value.counts.total).toBe(1);

    const tampered = structuredClone(persisted);
    const hiddenTarget = tampered.nodes.find((node: any) => node.type === 'file' && node.file === 'Knowledge/Advanced.md');
    hiddenTarget.file = '_scopes/models/other/Secret.md';
    await writeFile(join(vault, 'Views', 'Spatial map Spatial.canvas'), JSON.stringify(tampered));
    const guardedHealth = await callJson(client, 'get_wiki_canvas_health', { limit: 10, maxChars: 8000, accessToken });
    expect(guardedHealth.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ state: 'invalid', detail: expect.stringContaining('identity does not match') })]));
    expect(JSON.stringify(guardedHealth.value)).not.toContain('_scopes/models/other/Secret.md');
    await writeFile(join(vault, 'Views', 'Spatial map Spatial.canvas'), `${JSON.stringify(persisted, null, 2)}\n`);

    const root = await callJson(client, 'read_note', { path: 'Knowledge/Spatial map.md', accessToken });
    const changed = await client.callTool({ name: 'patch_note', arguments: { path: 'Knowledge/Spatial map.md', oldString: '# Spatial map', newString: '# Spatial map updated', expectedRevision: root.value.revision, accessToken } });
    expect(changed.isError).toBeFalsy();
    const staleHealth = await callJson(client, 'get_wiki_canvas_health', { limit: 10, maxChars: 8000, accessToken });
    expect(staleHealth.value.counts).toMatchObject({ stale: 1 });
    expect(staleHealth.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ state: 'stale', nextAction: expect.objectContaining({ endpointId: 'wiki.canvas_view' }) })]));
    expect(staleHealth.value.items[0].changed).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Spatial map.md', expectedRevision: preview.value.root.revision })]));
    const repairBoard = await callJson(client, 'get_wiki_exception_board', { limit: 30, maxChars: 16000, accessToken });
    expect(repairBoard.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Views/Spatial map Spatial.canvas', code: 'canvas_stale', category: 'freshness' })]));
    const stale = await client.callTool({ name: 'export_wiki_canvas', arguments: {
      path: 'Knowledge/Spatial map.md', mode: 'moc', maxChars: 16000,
      expectedSourceRevision: preview.value.root.revision, expectedRevision: saved.value.revision, accessToken,
    } });
    expect(stale.isError).toBe(true);
    expect(String((stale.content as any)[0]?.text)).toContain('source revision conflict');
  } finally { await client.close(); await server.close(); }
});

test('triage exposes execution capacity and tags without rebasing stale summaries or accepting stale revisions', async () => {
  const { server, client } = await setup();
  try {
    const account = await callJson(client, 'register_scope_account', { accountId: 'capacity-owner', modelId: 'codex', password: 'capacity-owner-secret' });
    const accessToken = account.value.accessToken;
    const created = await client.callTool({ name: 'write_note', arguments: { path: 'Tasks/Next.md', content: '# Next\nCurrent body', expectedRevision: 'missing', frontmatter: { note_kind: 'task', lifecycle: 'active', task_status: 'next_action', next_action: 'Run the selected regression test', task_context: '@computer', summary: 'Outdated summary', summary_of_content_sha256: 'a'.repeat(64) }, accessToken } });
    expect(created.isError).toBeFalsy();
    const before = await callJson(client, 'read_note', { path: 'Tasks/Next.md', accessToken });
    const updated = await callJson(client, 'triage_wiki_note', { path: 'Tasks/Next.md', tags: ['testing', 'testing'], timeEstimateMinutes: 15, energy: 'low', effort: 'medium', expectedRevision: before.value.revision, accessToken });
    expect(updated.result.isError).toBeFalsy();
    expect(updated.value.frontmatter).toMatchObject({ tags: ['testing'], timeEstimateMinutes: 15, energy: 'low', effort: 'medium' });
    const after = await callJson(client, 'read_note', { path: 'Tasks/Next.md', accessToken });
    expect(after.value.content).toBe(before.value.content);
    expect(after.value.fm.summary_of_content_sha256).toBe('a'.repeat(64));
    const selected = await callJson(client, 'get_wiki_next_actions', { context: '@computer', maxMinutes: 20, energy: 'low', effort: 'medium', accessToken });
    expect(selected.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Tasks/Next.md', estimatedMinutes: 15 })]));
    const conflict = await client.callTool({ name: 'triage_wiki_note', arguments: { path: 'Tasks/Next.md', tags: ['overwrite'], expectedRevision: before.value.revision, accessToken } });
    expect(conflict.isError).toBe(true);
    const cleared = await callJson(client, 'triage_wiki_note', { path: 'Tasks/Next.md', tags: [], expectedRevision: after.value.revision, accessToken });
    expect(cleared.value.frontmatter.tags).toEqual([]);
  } finally { await client.close(); await server.close(); }
});

test('MOC navigation preserves explicit sibling order, body link order, and multi-MOC neighborhoods', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'moc-navigation-owner', modelId: 'codex', password: 'moc-navigation-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };
    await write('Knowledge/MOCs/Root.md', '# Root\n\n## Reading order\n[[Knowledge/Z note]]\n[[Knowledge/A note]]\n', { note_kind: 'moc', lifecycle: 'evergreen', nav_order: 0 });
    await write('Knowledge/MOCs/Z.md', '# Z\n', { note_kind: 'moc', lifecycle: 'evergreen', moc_parent: '[[Knowledge/MOCs/Root]]', nav_order: 20 });
    await write('Knowledge/MOCs/A.md', '# A\n', { note_kind: 'moc', lifecycle: 'evergreen', moc_parent: '[[Knowledge/MOCs/Root]]', nav_order: 10 });
    await write('Knowledge/Z note.md', '# Z note\n', { note_kind: 'atomic', lifecycle: 'evergreen' });
    await write('Knowledge/A note.md', '# A note\n', { note_kind: 'atomic', lifecycle: 'evergreen' });
    await write('Knowledge/Multi.md', '# Multi\n', { note_kind: 'atomic', lifecycle: 'evergreen', mocs: ['[[Knowledge/MOCs/A]]'] });
    await write('Knowledge/Source.md', '# Source\n', { note_kind: 'atomic', lifecycle: 'evergreen', mocs: ['[[Knowledge/MOCs/A]]'] });

    const home = await callJson(client, 'get_wiki_home', { accessToken, limit: 10 });
    expect(home.value.mocs.map((item: any) => item.path)).toEqual(['Knowledge/MOCs/Root.md', 'Knowledge/MOCs/A.md', 'Knowledge/MOCs/Z.md']);
    expect(home.value.mocs.map((item: any) => item.navOrder)).toEqual([0, 10, 20]);
    expect(home.value.mocs.every((item: any) => typeof item.revision === 'string' && item.revision.length === 64)).toBe(true);
    expect(home.value.routingRule).toContain('exactly one');
    expect(home.value.workflowRoutes).toEqual(expect.arrayContaining([
      expect.objectContaining({ intent: 'find', endpointId: 'wiki.search', requiredArguments: ['query'] }),
      expect.objectContaining({ intent: 'understand_or_decide', endpointId: 'wiki.answer_packet', requiredArguments: ['path'] }),
      expect.objectContaining({ intent: 'follow_curated_sequence', endpointId: 'wiki.learning_path', requiredArguments: ['path'] }),
      expect.objectContaining({ intent: 'execute_in_context', endpointId: 'wiki.next_actions', arguments: expect.objectContaining({ context: '<exact context>' }), requiredArguments: ['context'] }),
      expect.objectContaining({ intent: 'review_one', endpointId: 'wiki.review_packet' }),
      expect.objectContaining({ intent: 'maintain_vocabulary', endpointId: 'wiki.vocabulary_health' }),
      expect.objectContaining({ intent: 'migrate_contract', endpointId: 'wiki.organization_manifest' }),
    ]));
    expect(home.value.nextAction.endpointId).toBe('wiki.search');
    const tinyHome = await callJson(client, 'get_wiki_home', { accessToken, limit: 10, maxChars: 512, prettyPrint: true });
    expect(String((tinyHome.result.content as any)[0].text).length).toBeLessThanOrEqual(512);
    expect(tinyHome.value.nextAction).toMatchObject({ endpointId: 'wiki.search', requiredArguments: ['query'] });

    const graph = await callJson(client, 'get_wiki_graph_health', { accessToken, limit: 20, maxChars: 12000 });
    expect(graph.value.mocHierarchy.items.map((item: any) => item.path)).toEqual(['Knowledge/MOCs/Root.md', 'Knowledge/MOCs/A.md', 'Knowledge/MOCs/Z.md']);
    const rootCoverage = graph.value.mocCoverage.mocs.find((item: any) => item.path === 'Knowledge/MOCs/Root.md');
    expect(rootCoverage.orderedEntries).toEqual([
      expect.objectContaining({ target: 'Knowledge/Z note', line: 4, section: 'Reading order' }),
      expect.objectContaining({ target: 'Knowledge/A note', line: 5, section: 'Reading order' }),
    ]);

    await write('Knowledge/MOCs/A child.md', '# Child\n', { note_kind: 'moc', lifecycle: 'evergreen', moc_parent: '[[Knowledge/MOCs/A]]', nav_order: 900 });
    await write('Knowledge/MOCs/Other root.md', '# Other\n', { note_kind: 'moc', lifecycle: 'evergreen', nav_order: 1 });
    await write('Knowledge/MOCs/Hidden root.md', '# Hidden\n', { note_kind: 'moc', lifecycle: 'evergreen', moderation_status: 'quarantined' });
    await write('Knowledge/Huge property.md', '# Compact body\n', { note_kind: 'atomic', lifecycle: 'evergreen', stable_id: 'huge-property', retrieval_cues: ['x'.repeat(20_000)] });
    const privateMoc = await client.callTool({ name: 'write_note', arguments: { path: 'scope://model/codex/Private MOC.md', content: '# Private MOC\n', frontmatter: { note_kind: 'moc', lifecycle: 'evergreen' }, expectedRevision: 'missing', accessToken } });
    expect(privateMoc.isError).toBeFalsy();
    const treeHome = await callJson(client, 'get_wiki_home', { accessToken, limit: 10 });
    expect(treeHome.value.mocs.map((item: any) => item.path)).toEqual(['Knowledge/MOCs/Root.md', 'Knowledge/MOCs/A.md', 'Knowledge/MOCs/A child.md', 'Knowledge/MOCs/Z.md', 'Knowledge/MOCs/Other root.md', 'scope://model/codex/Private MOC.md']);
    expect(JSON.stringify(treeHome.value)).not.toContain('Hidden root');
    expect(JSON.stringify(treeHome.value)).not.toContain('x'.repeat(100));
    const publicHome = await callJson(client, 'get_wiki_home', { limit: 10, maxChars: 16000 });
    expect(JSON.stringify(publicHome.value)).not.toContain('Private MOC');

    const rootBefore = treeHome.value.mocs.find((item: any) => item.path === 'Knowledge/MOCs/Root.md').revision;
    const rootPath = join(vault, 'Knowledge', 'MOCs', 'Root.md');
    const externallyEdited = (await readFile(rootPath, 'utf8')).replace('# Root', '# Root externally edited');
    await writeFile(rootPath, externallyEdited);
    await new Promise(resolve => setTimeout(resolve, 150));
    const refreshedHome = await callJson(client, 'get_wiki_home', { accessToken, limit: 10, maxChars: 16000 });
    const rootAfter = refreshedHome.value.mocs.find((item: any) => item.path === 'Knowledge/MOCs/Root.md').revision;
    expect(rootAfter).toMatch(/^[a-f0-9]{64}$/);
    expect(rootAfter).not.toBe(rootBefore);

    const neighborhood = await callJson(client, 'get_wiki_neighborhood', { path: 'Knowledge/Source.md', accessToken, limit: 10, maxChars: 5000 });
    expect(neighborhood.value.neighbors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Multi.md', reasons: expect.arrayContaining(['shared_moc']), mocs: ['[[Knowledge/MOCs/A]]'] }),
    ]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('claim argument maps preserve Obsidian block links, revisions, scope, and bounded repair signals', async () => {
  const { server, client } = await setup();
  try {
    const account = await callJson(client, 'register_scope_account', { accountId: 'argument-owner', modelId: 'codex', password: 'argument-owner-secret' });
    const accessToken = account.value.accessToken;
    const source = await callJson(client, 'ingest_source', {
      sourceId: 'argument-source', title: 'Argument source', content: '# Evidence\n\nThe premise and objection are independently inspectable.\n', capturedBy: 'codex', accessToken,
    });
    const conclusion = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Conclusion.md', content: '# Conclusion\n\nThe proposed policy should be adopted. ^c1\n', evidencePaths: [source.value.path],
      claims: [{ id: 'c1', text: 'The proposed policy should be adopted.', evidencePaths: [source.value.path], claimRole: 'conclusion', dependsOnClaims: ['[[premises-stable#^p1]]'] }],
      reviewPolicy: 'on_upstream_change', author: 'codex', expectedRevision: 'missing', accessToken,
    });
    const premises = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Premises.md', content: '# Premises\n\nThe policy reduces duplicated work. ^p1\n\nThe measured workflow explains that reduction. ^w1\n\nThe policy may hide minority concerns.\n', evidencePaths: [source.value.path],
      claims: [
        { id: 'p1', text: 'The policy reduces duplicated work.', evidencePaths: [source.value.path], claimRole: 'premise', supportsClaims: ['[[Knowledge/Conclusion#^c1]]'], dependsOnClaims: ['[[Knowledge/Conclusion#^c1]]'] },
        { id: 'w1', text: 'The measured workflow explains that reduction.', evidencePaths: [source.value.path], claimRole: 'warrant', supportsClaims: ['[[#^p1]]'] },
        { id: 'o1', text: 'The policy may hide minority concerns.', evidencePaths: [source.value.path], claimRole: 'objection', contradictsClaims: ['[[Knowledge/Conclusion#^c1]]'] },
      ],
      aliases: ['Core premises'], stableId: 'premises-stable', author: 'codex', expectedRevision: 'missing', accessToken,
    });
    await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Dependent.md', content: '# Dependent\n\nA separate conclusion depends on the premise. ^d1\n', evidencePaths: [source.value.path],
      claims: [{ id: 'd1', text: 'A separate conclusion depends on the premise.', evidencePaths: [source.value.path], claimRole: 'conclusion', dependsOnClaims: ['[[Core premises#^p1]]'] }],
      author: 'codex', expectedRevision: 'missing', accessToken,
    });

    const capability = await callJson(client, 'search_capabilities', { query: 'argument premise objection block link', limit: 5, maxChars: 5000, accessToken });
    expect(capability.value.endpoints).toEqual(expect.arrayContaining([expect.objectContaining({ endpointId: 'wiki.argument_map', available: true })]));
    const map = await callJson(client, 'call_endpoint', { endpointId: 'wiki.argument_map', arguments: { path: 'Knowledge/Conclusion.md', claimId: 'c1', maxDepth: 2, limit: 20, maxChars: 12000, accessToken } });
    expect(map.result.isError).toBeFalsy();
    expect(map.value).toMatchObject({ mode: 'bounded_argument_map', path: 'Knowledge/Conclusion.md', revision: conclusion.value.revision, selectedClaimId: 'c1' });
    expect(map.value.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'Knowledge/Conclusion.md#^c1', role: 'conclusion', locator: expect.objectContaining({ blockId: 'c1', navigable: true }) }),
      expect.objectContaining({ id: 'Knowledge/Premises.md#^p1', role: 'premise', locator: expect.objectContaining({ blockId: 'p1', navigable: true }) }),
      expect.objectContaining({ id: 'Knowledge/Premises.md#^w1', role: 'warrant', locator: expect.objectContaining({ blockId: 'w1', navigable: true }) }),
      expect.objectContaining({ id: 'Knowledge/Premises.md#^o1', role: 'objection', locator: expect.objectContaining({ blockId: 'o1', navigable: false }) }),
    ]));
    expect(map.value.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'Knowledge/Premises.md#^p1', to: 'Knowledge/Conclusion.md#^c1', relation: 'supports', navigable: true }),
      expect.objectContaining({ from: 'Knowledge/Premises.md#^w1', to: 'Knowledge/Premises.md#^p1', relation: 'supports', authoredLink: '[[#^p1]]', navigable: true }),
      expect.objectContaining({ from: 'Knowledge/Premises.md#^o1', to: 'Knowledge/Conclusion.md#^c1', relation: 'contradicts', navigable: true }),
      expect.objectContaining({ from: 'Knowledge/Conclusion.md#^c1', to: 'Knowledge/Premises.md#^p1', relation: 'depends_on' }),
    ]));
    expect(map.value.cycles).toEqual(expect.arrayContaining([expect.objectContaining({ relation: 'depends_on' })]));
    expect(map.value.issues.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_claim_block_anchor', source: 'Knowledge/Premises.md#^o1' }),
      expect.objectContaining({ code: 'claim_relation_cycle' }),
    ]));

    const reviewed = await callJson(client, 'review_wiki_claim', {
      path: 'Knowledge/Conclusion.md', claimId: 'c1', status: 'supported', confidence: 'high', reviewedBy: 'codex', expectedRevision: conclusion.value.revision, accessToken,
    });
    const projection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Conclusion.md', view: 'summary', accessToken });
    expect(projection.value.claims).toEqual([expect.objectContaining({ id: 'c1', role: 'conclusion', dependsOnClaims: ['[[premises-stable#^p1]]'], status: 'supported' })]);
    expect(reviewed.value.success).toBe(true);

    const baseline = await callJson(client, 'review_wiki_note', {
      path: 'Knowledge/Conclusion.md', reviewOutcome: 'confirmed', reviewedBy: 'codex', nextLifecycle: 'evergreen', expectedRevision: reviewed.value.revision, accessToken,
    });
    expect(baseline.value.success).toBe(true);
    const unrelatedClaimReview = await callJson(client, 'review_wiki_claim', {
      path: 'Knowledge/Premises.md', claimId: 'o1', status: 'disputed', reviewedBy: 'codex', expectedRevision: premises.value.revision, accessToken,
    });
    const unchangedQueue = await callJson(client, 'get_wiki_review_queue', { limit: 30, maxChars: 12000, accessToken });
    expect(unchangedQueue.value.items.find((item: any) => item.path === 'Knowledge/Conclusion.md')).toBeUndefined();
    const disputedPremise = await callJson(client, 'review_wiki_claim', {
      path: 'Knowledge/Premises.md', claimId: 'p1', status: 'disputed', reviewedBy: 'codex', expectedRevision: unrelatedClaimReview.value.revision, accessToken,
    });
    expect(disputedPremise.value).toMatchObject({ impactedDownstreamCount: 2, impactedDownstreamPaths: ['Knowledge/Conclusion.md', 'Knowledge/Dependent.md'] });
    const changedQueue = await callJson(client, 'get_wiki_review_queue', { limit: 30, maxChars: 12000, accessToken });
    expect(changedQueue.value.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Conclusion.md', reviewTriggers: expect.arrayContaining(['upstream_changed']), upstreamChanges: expect.arrayContaining([expect.stringContaining('#^p1')]) }),
    ]));
    const supportedObjection = await callJson(client, 'review_wiki_claim', {
      path: 'Knowledge/Premises.md', claimId: 'o1', status: 'supported', reviewedBy: 'codex', expectedRevision: disputedPremise.value.revision, accessToken,
    });
    expect(supportedObjection.value.success).toBe(true);
    const statusMap = await callJson(client, 'get_wiki_argument_map', { path: 'Knowledge/Conclusion.md', claimId: 'c1', maxDepth: 2, limit: 20, maxChars: 12000, accessToken });
    expect(statusMap.value.issues.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'claim_dependency_status_risk' }),
      expect.objectContaining({ code: 'claim_support_status_risk' }),
      expect.objectContaining({ code: 'supported_claim_contradiction' }),
    ]));

    const compact = await callJson(client, 'get_wiki_argument_map', { path: 'Knowledge/Conclusion.md', maxDepth: 2, limit: 20, maxChars: 1024, accessToken });
    expect(compact.result.isError).toBeFalsy();
    expect(JSON.stringify(compact.value).length).toBeLessThanOrEqual(1024);
    const nodeLimited = await callJson(client, 'get_wiki_argument_map', { path: 'Knowledge/Premises.md', maxDepth: 2, limit: 1, maxChars: 4000, accessToken });
    expect(nodeLimited.value.nodes).toHaveLength(1);
    expect(nodeLimited.value.truncated).toBe(true);
    const depthZero = await callJson(client, 'get_wiki_argument_map', { path: 'Knowledge/Conclusion.md', claimId: 'c1', maxDepth: 0, limit: 20, maxChars: 4000, accessToken });
    expect(depthZero.value.maxDepth).toBe(0);
    expect(depthZero.value.nodes).toHaveLength(1);

    const other = await callJson(client, 'register_scope_account', { accountId: 'argument-outsider', modelId: 'gemini', password: 'argument-outsider-secret' });
    const privateNote = await callJson(client, 'publish_knowledge', {
      path: 'scope://model/codex/Knowledge/Private argument.md', content: '# Private argument\n\nA private conclusion. ^private-claim\n', evidencePaths: [source.value.path],
      claims: [{ id: 'private-claim', text: 'A private conclusion.', evidencePaths: [source.value.path], claimRole: 'conclusion' }],
      author: 'codex', expectedRevision: 'missing', accessToken,
    });
    expect(privateNote.result.isError).toBeFalsy();
    const denied = await client.callTool({ name: 'get_wiki_argument_map', arguments: { path: 'scope://model/codex/Knowledge/Private argument.md', accessToken: other.value.accessToken } });
    expect(denied.isError).toBe(true);

    const malformed = await client.callTool({ name: 'publish_knowledge', arguments: {
      path: 'Knowledge/Malformed.md', content: '# Malformed\n\nBad relation. ^bad\n', evidencePaths: [source.value.path],
      claims: [{ id: 'bad', text: 'Bad relation.', evidencePaths: [source.value.path], claimRole: 'premise', supportsClaims: ['Knowledge/Conclusion#^c1'] }],
      expectedRevision: 'missing', accessToken,
    } });
    expect(malformed.isError).toBe(true);
    expect(JSON.stringify(malformed.content)).toContain('Obsidian block link');
    const reservedTraversal = await client.callTool({ name: 'publish_knowledge', arguments: {
      path: 'Knowledge/Reserved traversal.md', content: '# Reserved traversal\n\nBad private-path relation. ^bad-private\n', evidencePaths: [source.value.path],
      claims: [{ id: 'bad-private', text: 'Bad private-path relation.', evidencePaths: [source.value.path], claimRole: 'premise', supportsClaims: ['[[../_scopes/models/codex/Private argument#^private-claim]]'] }],
      expectedRevision: 'missing', accessToken,
    } });
    expect(reservedTraversal.isError).toBe(true);
    expect(JSON.stringify(reservedTraversal.content)).toContain('scope URI');

    await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Missing target.md', content: '# Missing target\n\nThis premise points to a claim that does not exist. ^missing-source\n', evidencePaths: [source.value.path],
      claims: [{ id: 'missing-source', text: 'This premise points to a claim that does not exist.', evidencePaths: [source.value.path], claimRole: 'premise', supportsClaims: ['[[Knowledge/Conclusion#^absent]]'] }],
      expectedRevision: 'missing', accessToken,
    });
    const missingTarget = await callJson(client, 'get_wiki_argument_map', { path: 'Knowledge/Missing target.md', maxChars: 5000, accessToken });
    expect(missingTarget.value.issues.items).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'missing_claim_target' })]));

    await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Scope leak.md', content: '# Scope leak\n\nA public claim must not resolve into a private model note. ^scope-source\n', evidencePaths: [source.value.path],
      claims: [{ id: 'scope-source', text: 'A public claim must not resolve into a private model note.', evidencePaths: [source.value.path], claimRole: 'premise', supportsClaims: ['[[Private argument#^private-claim]]'] }],
      expectedRevision: 'missing', accessToken,
    });
    const lint = await callJson(client, 'lint_wiki', { limit: 200, accessToken });
    expect(lint.value.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'claim_relation_cycle' }),
      expect.objectContaining({ code: 'missing_claim_block_anchor', path: 'Knowledge/Premises.md' }),
      expect.objectContaining({ code: 'missing_claim_target', path: 'Knowledge/Missing target.md' }),
      expect.objectContaining({ code: 'claim_scope_violation', path: 'Knowledge/Scope leak.md', severity: 'error' }),
      expect.objectContaining({ code: 'claim_dependency_status_risk', path: 'Knowledge/Conclusion.md' }),
      expect.objectContaining({ code: 'claim_support_status_risk', path: 'Knowledge/Premises.md' }),
      expect.objectContaining({ code: 'supported_claim_contradiction', path: 'Knowledge/Premises.md' }),
    ]));
    const organization = await callJson(client, 'get_wiki_organization_health', { limit: 100, maxChars: 16000, accessToken });
    expect(organization.value.byCode).toMatchObject({ claim_relation_cycle: expect.any(Number), missing_claim_target: 1, claim_scope_violation: 1 });
    expect(organization.value.recommendations).toEqual(expect.arrayContaining([expect.stringContaining('wiki.argument_map')]));
    const board = await callJson(client, 'get_wiki_exception_board', { limit: 60, maxChars: 16000, accessToken });
    expect(board.value.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'Knowledge/Missing target.md',
        code: 'missing_claim_target',
        category: 'argument_integrity',
        suggestedAction: 'call_wiki_argument_map_then_edit_with_current_revision',
        nextAction: expect.objectContaining({ endpointId: 'wiki.argument_map', arguments: expect.objectContaining({ path: 'Knowledge/Missing target.md' }) }),
      }),
    ]));
    const packet = await callJson(client, 'get_wiki_review_packet', { limit: 30, maxChars: 16000, accessToken });
    expect(packet.value.counts.claimArgumentIssues).toBeGreaterThan(0);
    expect(packet.value.priorities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'Knowledge/Missing target.md',
        reasons: expect.arrayContaining(['claim_argument_needs_repair']),
        suggestedTools: expect.arrayContaining(['wiki.argument_map']),
      }),
    ]));
  } finally {
    await client.close();
    await server.close();
  }
}, 10_000);

test('Decision Records preserve structured state and expose a bounded conflict-aware register', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'decision-register-owner', modelId: 'codex', password: 'decision-register-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', {
      sourceId: 'decision-register-source', title: 'Decision register evidence', content: 'A successor must retain an auditable link to the decision it replaces.', capturedBy: 'codex', accessToken,
    });
    const original = await callJson(client, 'publish_decision_record', {
      path: 'Knowledge/Decisions/Original.md', title: 'Original policy', context: 'The first policy is in force.', decision: 'Use the original policy.', status: 'accepted',
      evidencePaths: [source.value.path], expectedRevision: 'missing', accessToken,
    });
    expect(original.value).toMatchObject({ decisionStatus: 'accepted' });
    const originalRead = await callJson(client, 'read_note', { path: original.value.path, accessToken });
    expect(originalRead.value.fm).toMatchObject({ note_kind: 'decision', decision_status: 'accepted', lifecycle: 'evergreen', knowledge_status: 'verified' });

    await callJson(client, 'publish_decision_record', {
      path: 'Knowledge/Decisions/Successor.md', title: 'Successor policy', context: 'New evidence changes the preferred policy.', decision: 'Use the successor policy.', status: 'accepted',
      supersedes: ['[[Knowledge/Decisions/Original]]'], evidencePaths: [source.value.path], expectedRevision: 'missing', accessToken,
    });
    const conflicted = await callJson(client, 'get_wiki_decision_register', { limit: 20, maxChars: 12000, accessToken });
    expect(conflicted.value.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Decisions/Successor.md', issues: expect.arrayContaining([expect.objectContaining({ code: 'superseded_target_still_active', target: 'Knowledge/Decisions/Original.md' })]) }),
    ]));

    const directSupersede = await client.callTool({ name: 'publish_decision_record', arguments: {
      path: 'Knowledge/Decisions/Original.md', title: 'Original policy', context: 'The first policy was in force.', decision: 'Use the original policy.', status: 'superseded', replacedBy: '[[Knowledge/Decisions/Successor]]',
      evidencePaths: [source.value.path], expectedRevision: originalRead.value.revision, accessToken,
    } });
    expect(directSupersede.isError).toBe(true);
    expect(String((directSupersede.content as any)[0].text)).toContain('wiki.lifecycle_transition');
    const rejectedWithLineage = await client.callTool({ name: 'publish_decision_record', arguments: {
      path: 'Knowledge/Decisions/Rejected-with-lineage.md', title: 'Rejected policy', context: 'The proposal was evaluated.', decision: 'Do not adopt it.', status: 'rejected',
      replacedBy: '[[Knowledge/Decisions/Successor]]', evidencePaths: [source.value.path], expectedRevision: 'missing', accessToken,
    } });
    expect(rejectedWithLineage.isError).toBe(true);
    expect(String((rejectedWithLineage.content as any)[0].text)).toContain('cannot create replacement lineage');
    const transition = await callJson(client, 'call_endpoint', { endpointId: 'wiki.lifecycle_transition', arguments: {
      path: 'Knowledge/Decisions/Original.md', operation: 'supersede', replacementPath: 'Knowledge/Decisions/Successor.md',
      reason: 'The successor policy replaces this decision.', accessToken,
    } });
    const transitionDryRun = await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: { changes: transition.value.changes, dryRun: true, accessToken } });
    const transitionApplied = await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: {
      changes: transition.value.changes, dryRun: false, confirmPlanFingerprint: transitionDryRun.value.planFingerprint, accessToken,
    } });
    const transitionedOriginal = transitionApplied.value.changes.find((item: any) => item.path === 'Knowledge/Decisions/Original.md');

    const successorAfterTransition = await callJson(client, 'read_note', { path: 'Knowledge/Decisions/Successor.md', accessToken });
    const removeReverseChanges = [{
      path: 'Knowledge/Decisions/Successor.md', expectedRevision: successorAfterTransition.value.revision,
      frontmatter: { remove: ['supersedes'] },
    }];
    const removeReverseDryRun = await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: {
      changes: removeReverseChanges, dryRun: true, accessToken,
    } });
    await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: {
      changes: removeReverseChanges, dryRun: false, confirmPlanFingerprint: removeReverseDryRun.value.planFingerprint, accessToken,
    } });
    const incompleteLineage = await client.callTool({ name: 'publish_decision_record', arguments: {
      path: 'Knowledge/Decisions/Original.md', title: 'Original policy', context: 'The first policy was in force.', decision: 'Use the original policy.', status: 'superseded', replacedBy: '[[Knowledge/Decisions/Successor]]',
      evidencePaths: [source.value.path], expectedRevision: transitionedOriginal.revision, accessToken,
    } });
    expect(incompleteLineage.isError).toBe(true);
    expect(String((incompleteLineage.content as any)[0].text)).toContain('supersession lineage is incomplete');

    const lineageRepair = await callJson(client, 'call_endpoint', { endpointId: 'wiki.lifecycle_transition', arguments: {
      path: 'Knowledge/Decisions/Original.md', operation: 'supersede', replacementPath: 'Knowledge/Decisions/Successor.md',
      reason: 'The successor policy replaces this decision.', accessToken,
    } });
    expect(lineageRepair.value).toMatchObject({ valid: true, alreadyApplied: false, changes: [expect.objectContaining({ path: 'Knowledge/Decisions/Successor.md' })] });
    const lineageRepairDryRun = await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: {
      changes: lineageRepair.value.changes, dryRun: true, accessToken,
    } });
    await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: {
      changes: lineageRepair.value.changes, dryRun: false, confirmPlanFingerprint: lineageRepairDryRun.value.planFingerprint, accessToken,
    } });
    await callJson(client, 'publish_decision_record', {
      path: 'Knowledge/Decisions/Original.md', title: 'Original policy', context: 'The first policy was in force.', decision: 'Use the original policy.', status: 'superseded', replacedBy: '[[Knowledge/Decisions/Successor]]',
      evidencePaths: [source.value.path], expectedRevision: transitionedOriginal.revision, accessToken,
    });
    const repaired = await callJson(client, 'get_wiki_decision_register', { limit: 20, maxChars: 12000, accessToken });
    expect(repaired.value.counts.statuses).toMatchObject({ accepted: 1, superseded: 1 });
    expect(repaired.value.counts.issueCodes.superseded_target_still_active || 0).toBe(0);
    expect(repaired.value.items.find((item: any) => item.path === 'Knowledge/Decisions/Original.md')).toMatchObject({ decisionStatus: 'superseded', statusSource: 'property', successors: ['Knowledge/Decisions/Successor.md'] });

    const legacyWrite = await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Decisions/Legacy.md', content: '# Legacy decision\n\nDecision status: **proposed**\n', expectedRevision: 'missing', accessToken,
      frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'decision', lifecycle: 'review', knowledge_status: 'draft', evidence_paths: [source.value.path] },
    } });
    expect(legacyWrite.isError).toBeFalsy();
    const legacy = await callJson(client, 'read_note', { path: 'Knowledge/Decisions/Legacy.md', accessToken });
    const migration = await callJson(client, 'get_wiki_decision_register', { limit: 20, maxChars: 12000, accessToken });
    expect(migration.value.items.find((item: any) => item.path === 'Knowledge/Decisions/Legacy.md')).toMatchObject({ decisionStatus: 'proposed', statusSource: 'body_legacy', issues: expect.arrayContaining([expect.objectContaining({ code: 'decision_status_migration_required' })]) });
    await callJson(client, 'triage_wiki_note', { path: 'Knowledge/Decisions/Legacy.md', decisionStatus: 'proposed', expectedRevision: legacy.value.revision, accessToken });
    const migrated = await callJson(client, 'get_wiki_decision_register', { limit: 20, maxChars: 12000, accessToken });
    expect(migrated.value.items.find((item: any) => item.path === 'Knowledge/Decisions/Legacy.md')).toMatchObject({ decisionStatus: 'proposed', statusSource: 'property' });

    const bases = await callJson(client, 'get_wiki_bases_view', { view: 'decisions', maxChars: 12000, accessToken });
    expect(bases.value).toMatchObject({ view: 'decisions', matchingNotes: 3, matchingNotesExact: true });
    expect(bases.value.content).toContain('note.decision_status');
    const capabilities = await callJson(client, 'search_capabilities', { query: 'decision register', limit: 3, maxChars: 5000, accessToken });
    expect(capabilities.value.endpoints).toEqual(expect.arrayContaining([expect.objectContaining({ endpointId: 'wiki.decision_register' })]));
    const bounded = await callJson(client, 'get_wiki_decision_register', { limit: 2, maxChars: 1200, accessToken });
    expect(JSON.stringify(bounded.value).length).toBeLessThanOrEqual(1200);
    expect(bounded.value.truncated).toBe(true);
    const tiny = await callJson(client, 'get_wiki_decision_register', { limit: 2, maxChars: 512, accessToken });
    expect(JSON.stringify(tiny.value).length).toBeLessThanOrEqual(512);
    expect(tiny.value.truncated).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});

test('drillable facets and synthesis candidates close the authored Distill to Express loop', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'synthesis-owner', modelId: 'codex', password: 'synthesis-owner-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };
    const shared = { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', project: '[[Projects/Search]]', methods: ['Benchmark'], audience: ['Agents'], tags: ['Retrieval'] };
    await write('Knowledge/Latency evidence.md', '# Latency evidence\n', { ...shared, primary_moc: '[[Knowledge/MOCs/Retrieval]]', knowledge_role: 'observation', aliases: ['Latency fact'], stable_id: 'latency-fact', evidence_paths: ['_sources/latency.md'], nav_order: 10 });
    await write('Knowledge/Recall caveat.md', '# Recall caveat\n', { ...shared, mocs: ['[[Knowledge/MOCs/Retrieval]]'], knowledge_role: 'counterargument', aliases: ['Recall warning'], contradicts: ['[[Latency fact]]'], evidence_paths: ['_sources/recall.md'], open_questions: ['When does the tradeoff reverse?'], nav_order: 20 });

    const catalog = await callJson(client, 'get_wiki_catalog', { moc: '[[knowledge/mocs/retrieval]]', project: '[[projects/search]]', method: 'benchmark', audience: 'agents', tag: 'retrieval', includeFacets: true, limit: 10, maxChars: 8000, accessToken });
    expect(catalog.value).toMatchObject({ total: 2, facets: { moc: { '[[Knowledge/MOCs/Retrieval]]': 2 }, project: { '[[Projects/Search]]': 2 }, method: { Benchmark: 2 }, audience: { Agents: 2 }, tag: { Retrieval: 2 } } });
    expect(catalog.value.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Latency evidence.md', methods: ['Benchmark'], audience: ['Agents'], tags: ['Retrieval'] }),
      expect.objectContaining({ path: 'Knowledge/Recall caveat.md' }),
    ]));

    const discovery = await callJson(client, 'search_capabilities', { query: 'synthesize related notes into an argument', limit: 3, maxChars: 4000, accessToken });
    expect(discovery.value.endpoints).toEqual(expect.arrayContaining([expect.objectContaining({ endpointId: 'wiki.synthesis_candidates', method: 'GET', url: '/api/wiki/synthesis-candidates' })]));
    const candidates = await callJson(client, 'call_endpoint', { endpointId: 'wiki.synthesis_candidates', arguments: { limit: 5, maxChars: 12000, accessToken } });
    expect(candidates.value).toMatchObject({ total: 1, groupingRule: expect.stringContaining('primary authored cue') });
    expect(candidates.value.items[0]).toMatchObject({
      basis: { kind: 'moc', value: 'Knowledge/MOCs/Retrieval' },
      mode: 'create_synthesis',
      inputTotal: 2,
      suggestedPath: 'Knowledge/Syntheses/Retrieval synthesis.md',
      counterpointPaths: ['Knowledge/Recall caveat.md'],
      tensionPairs: [['Knowledge/Latency evidence.md', 'Knowledge/Recall caveat.md']],
      synthesisPlan: { mode: 'create_synthesis', guard: { autoFix: false, preserveInputs: true, inspectCounterpoints: true } },
    });
    expect(candidates.value.items[0].readOrder.map((item: any) => item.path)).toEqual(['Knowledge/Latency evidence.md', 'Knowledge/Recall caveat.md']);
    expect(candidates.value.items[0].readOrder.every((item: any) => /^[a-f0-9]{64}$/.test(item.revision))).toBe(true);
    const tiny = await callJson(client, 'call_endpoint', { endpointId: 'wiki.synthesis_candidates', arguments: { limit: 5, maxChars: 768, accessToken } });
    expect(JSON.stringify(tiny.value).length).toBeLessThanOrEqual(768);
    expect(tiny.value).toMatchObject({ total: 1, items: [], truncated: true });

    await write('Knowledge/Retrieval synthesis.md', '# Retrieval synthesis\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'review', interpretation_status: 'synthesized', primary_moc: '[[Knowledge/MOCs/Retrieval]]', derived_from: ['[[latency-fact]]', '[[Recall warning]]'] });
    const covered = await callJson(client, 'call_endpoint', { endpointId: 'wiki.synthesis_candidates', arguments: { limit: 5, maxChars: 12000, accessToken } });
    expect(covered.value).toMatchObject({ total: 0, items: [] });

    await write('Knowledge/Memory pressure.md', '# Memory pressure\n', { ...shared, primary_moc: '[[Knowledge/MOCs/Retrieval]]', knowledge_role: 'observation', evidence_paths: ['_sources/memory.md'], nav_order: 30 });
    const extension = await callJson(client, 'call_endpoint', { endpointId: 'wiki.synthesis_candidates', arguments: { limit: 5, maxChars: 12000, accessToken } });
    expect(extension.value.items[0]).toMatchObject({ mode: 'extend_existing_synthesis', uncoveredInputTotal: 1, existingSynthesis: { path: 'Knowledge/Retrieval synthesis.md', revision: expect.any(String) }, synthesisPlan: { then: { endpointId: 'notes.patch', arguments: { path: 'Knowledge/Retrieval synthesis.md', expectedRevision: expect.any(String), dryRun: true } } } });

    const home = await callJson(client, 'get_wiki_home', { limit: 20, maxChars: 12000, accessToken });
    expect(home.value.workflowRoutes).toEqual(expect.arrayContaining([expect.objectContaining({ intent: 'synthesize_or_express', endpointId: 'wiki.synthesis_candidates' })]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('dependency-aware MOC learning paths preserve authorship and diagnose prerequisite order safely', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'learning-path-owner', userId: 'learning-path-family', modelId: 'codex', agentId: 'learning-path-worker', password: 'learning-path-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };
    await write('Knowledge/MOCs/Curriculum.md', [
      '# Curriculum', '', '## Authored route',
      '[[Knowledge/Advanced]]',
      '[[Basics concept]]',
      '[[Knowledge/MOCs/Nested]]',
      '[[Knowledge/Independent]]',
      '[Relative note](../Relative.md)',
      '[[Knowledge/Claim Dependent]]',
      '[[Knowledge/Claim Prerequisite]]',
      '[[Knowledge/Redundant Base]]',
      '[[Knowledge/Redundant Middle]]',
      '[[Knowledge/Redundant Top]]',
      '[[Knowledge/Cycle A]]',
      '[[Knowledge/Cycle B]]',
      '[[Knowledge/Cycle Follower]]',
    ].join('\n'), { note_kind: 'moc', lifecycle: 'evergreen', moc_purpose: 'Teach a bounded topic.' });
    await write('Knowledge/MOCs/Nested.md', '# Nested\n\n[[Knowledge/Nested Topic]]\n', { note_kind: 'moc', lifecycle: 'evergreen' });
    await write('Knowledge/Advanced.md', '# Advanced\n', { note_kind: 'atomic', lifecycle: 'evergreen', depends_on: ['[[basics-stable]]', '[[Knowledge/Unavailable prerequisite]]'] });
    await write('Knowledge/Basics.md', '# Basics\n', { note_kind: 'atomic', lifecycle: 'evergreen', aliases: ['Basics concept'], stable_id: 'basics-stable', depends_on: ['[[Knowledge/External Primer]]'] });
    await write('Knowledge/Nested Topic.md', '# Nested Topic\n', { note_kind: 'atomic', lifecycle: 'evergreen', depends_on: ['[[Knowledge/Independent]]'] });
    await write('Knowledge/Independent.md', '# Independent\n', { note_kind: 'atomic', lifecycle: 'evergreen' });
    await write('Knowledge/Relative.md', '# Relative\n', { note_kind: 'atomic', lifecycle: 'evergreen' });
    await write('Knowledge/Claim Dependent.md', '# Claim Dependent\n\nThe advanced result relies on a prior claim. ^claim-dependent\n', {
      note_kind: 'atomic', lifecycle: 'evergreen',
      claims: [{ id: 'claim-dependent', text: 'The advanced result relies on a prior claim.', claim_role: 'conclusion', depends_on_claims: ['[[./Claim Prerequisite#^claim-base]]', '[[./Claim Prerequisite#^absent-claim]]'] }],
    });
    await write('Knowledge/Claim Prerequisite.md', '# Claim Prerequisite\n\nThe foundational claim comes first. ^claim-base\n', {
      note_kind: 'atomic', lifecycle: 'evergreen',
      claims: [{ id: 'claim-base', text: 'The foundational claim comes first.' }],
    });
    await write('Knowledge/Redundant Base.md', '# Redundant Base\n', { note_kind: 'atomic', lifecycle: 'evergreen' });
    await write('Knowledge/Redundant Middle.md', '# Redundant Middle\n', { note_kind: 'atomic', lifecycle: 'evergreen', depends_on: ['[[Knowledge/Redundant Base]]'] });
    await write('Knowledge/Redundant Top.md', '# Redundant Top\n', { note_kind: 'atomic', lifecycle: 'evergreen', depends_on: ['[[Knowledge/Redundant Base]]', '[[Knowledge/Redundant Middle]]'] });
    await write('Knowledge/External Primer.md', '# External Primer\n', { note_kind: 'atomic', lifecycle: 'evergreen' });
    await write('Knowledge/Cycle A.md', '# Cycle A\n', { note_kind: 'atomic', lifecycle: 'evergreen', depends_on: ['[[Knowledge/Cycle B]]'] });
    await write('Knowledge/Cycle B.md', '# Cycle B\n', { note_kind: 'atomic', lifecycle: 'evergreen', depends_on: ['[[Knowledge/Cycle A]]'] });
    await write('Knowledge/Cycle Follower.md', '# Cycle Follower\n', { note_kind: 'atomic', lifecycle: 'evergreen', depends_on: ['[[Knowledge/Cycle A]]'] });

    const discovery = await callJson(client, 'search_capabilities', { query: 'MOC prerequisite learning path', limit: 3 });
    expect(discovery.value.endpoints).toEqual(expect.arrayContaining([expect.objectContaining({ endpointId: 'wiki.learning_path' })]));
    const path = await callJson(client, 'get_wiki_learning_path', { path: 'Knowledge/MOCs/Curriculum.md', maxDepth: 2, limit: 20, maxChars: 16000, accessToken });
    expect(path.value.mode).toBe('dependency_aware_moc_learning_path');
    expect(path.value.checkpointAction).toMatchObject({ endpointId: 'continuity.save', learningProgress: { rootPath: 'Knowledge/MOCs/Curriculum.md', order: 'authored', maxDepth: 2 } });
    expect(path.value.authoredOrder.map((item: any) => item.path)).toEqual([
      'Knowledge/Advanced.md',
      'Knowledge/Basics.md',
      'Knowledge/MOCs/Nested.md',
      'Knowledge/Nested Topic.md',
      'Knowledge/Independent.md',
      'Knowledge/Relative.md',
      'Knowledge/Claim Dependent.md',
      'Knowledge/Claim Prerequisite.md',
      'Knowledge/Redundant Base.md',
      'Knowledge/Redundant Middle.md',
      'Knowledge/Redundant Top.md',
      'Knowledge/Cycle A.md',
      'Knowledge/Cycle B.md',
      'Knowledge/Cycle Follower.md',
    ]);
    expect(path.value.authoredOrder.every((item: any) => /^[a-f0-9]{64}$/.test(item.revision))).toBe(true);
    expect(path.value.recommendedOrder.slice(0, 5)).toEqual([
      'Knowledge/Basics.md',
      'Knowledge/Advanced.md',
      'Knowledge/MOCs/Nested.md',
      'Knowledge/Independent.md',
      'Knowledge/Nested Topic.md',
    ]);
    expect(path.value).toMatchObject({ orderChanged: true, authoredOrderConsistent: false, prerequisiteCoverageComplete: false });
    expect(path.value.summary).toMatchObject({ claimDependencyEdges: 1, noteDependencyEdges: expect.any(Number), recommendedStages: 3, parallelStages: 2, stagedEntries: 11, redundantPrerequisiteEdges: 1, unlockPoints: expect.any(Number) });
    expect(path.value.recommendedStages.map((stage: any) => ({ stage: stage.stage, paths: stage.entries.map((item: any) => item.path) }))).toEqual([
      { stage: 1, paths: ['Knowledge/Basics.md', 'Knowledge/MOCs/Nested.md', 'Knowledge/Independent.md', 'Knowledge/Relative.md', 'Knowledge/Claim Prerequisite.md', 'Knowledge/Redundant Base.md'] },
      { stage: 2, paths: ['Knowledge/Advanced.md', 'Knowledge/Nested Topic.md', 'Knowledge/Claim Dependent.md', 'Knowledge/Redundant Middle.md'] },
      { stage: 3, paths: ['Knowledge/Redundant Top.md'] },
    ]);
    expect(path.value.recommendedStages.flatMap((stage: any) => stage.entries).every((item: any) => /^[a-f0-9]{64}$/.test(item.revision))).toBe(true);
    expect(path.value.recommendedStages[0].entries.find((item: any) => item.path === 'Knowledge/Basics.md')).toMatchObject({ internalPrerequisiteCount: 0, externalPrerequisiteCount: 1 });
    expect(path.value.prerequisiteEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({ prerequisite: 'Knowledge/Basics.md', dependent: 'Knowledge/Advanced.md', dependencyType: 'note', authoredOrderState: 'late', prerequisitePosition: 2, dependentPosition: 1 }),
      expect.objectContaining({ prerequisite: 'Knowledge/Independent.md', dependent: 'Knowledge/Nested Topic.md', dependencyType: 'note', authoredOrderState: 'late' }),
      expect.objectContaining({ prerequisite: 'Knowledge/Claim Prerequisite.md', dependent: 'Knowledge/Claim Dependent.md', dependencyType: 'claim', sourceClaimId: 'claim-dependent', targetClaimId: 'claim-base', authoredOrderState: 'late' }),
    ]));
    expect(path.value.prerequisiteEdges.every((item: any) => /^[a-f0-9]{64}$/.test(item.prerequisiteRevision) && /^[a-f0-9]{64}$/.test(item.dependentRevision))).toBe(true);
    expect(path.value.redundantPrerequisiteEdges).toEqual([
      expect.objectContaining({
        prerequisite: 'Knowledge/Redundant Base.md',
        dependent: 'Knowledge/Redundant Top.md',
        directDependencyTypes: ['note'],
        alternatePath: [
          expect.objectContaining({ path: 'Knowledge/Redundant Base.md', revision: expect.any(String) }),
          expect.objectContaining({ path: 'Knowledge/Redundant Middle.md', revision: expect.any(String) }),
          expect.objectContaining({ path: 'Knowledge/Redundant Top.md', revision: expect.any(String) }),
        ],
      }),
    ]);
    expect(path.value.unlockPoints[0]).toMatchObject({ path: 'Knowledge/Redundant Base.md', stage: 1, directDependents: 2, downstreamDependents: 2, revision: expect.any(String) });
    expect(path.value.recommendedOrder.indexOf('Knowledge/Claim Prerequisite.md')).toBeLessThan(path.value.recommendedOrder.indexOf('Knowledge/Claim Dependent.md'));
    expect(path.value.orderIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'prerequisite_after_dependent', path: 'Knowledge/Advanced.md', prerequisite: 'Knowledge/Basics.md' }),
      expect.objectContaining({ type: 'prerequisite_after_dependent', path: 'Knowledge/Claim Dependent.md', prerequisite: 'Knowledge/Claim Prerequisite.md', dependencyType: 'claim', sourceClaimId: 'claim-dependent', targetClaimId: 'claim-base' }),
      expect.objectContaining({ type: 'missing_claim_prerequisite_target', path: 'Knowledge/Claim Dependent.md', prerequisite: 'Knowledge/Claim Prerequisite.md', sourceClaimId: 'claim-dependent', targetClaimId: 'absent-claim' }),
      expect.objectContaining({ type: 'unresolved_or_inaccessible_prerequisite', path: 'Knowledge/Advanced.md' }),
      expect.objectContaining({ type: 'dependency_cycle_or_cycle_blocked_path', cyclePaths: ['Knowledge/Cycle A.md', 'Knowledge/Cycle B.md'], blockedPaths: ['Knowledge/Cycle Follower.md'] }),
    ]));
    expect(path.value.dependencyCycles).toEqual([
      expect.objectContaining({
        cycleId: 'cycle-1',
        notes: [
          expect.objectContaining({ path: 'Knowledge/Cycle A.md', revision: expect.any(String) }),
          expect.objectContaining({ path: 'Knowledge/Cycle B.md', revision: expect.any(String) }),
        ],
        edges: expect.arrayContaining([
          expect.objectContaining({ prerequisite: 'Knowledge/Cycle B.md', dependent: 'Knowledge/Cycle A.md' }),
          expect.objectContaining({ prerequisite: 'Knowledge/Cycle A.md', dependent: 'Knowledge/Cycle B.md' }),
        ]),
      }),
    ]);
    expect(path.value.cycleBlockedDependents).toEqual([
      expect.objectContaining({ path: 'Knowledge/Cycle Follower.md', revision: expect.any(String), blockedByCycleIds: ['cycle-1'] }),
    ]);
    expect(path.value.summary).toMatchObject({ dependencyCycles: 1, cyclicEntries: 2, cycleBlockedDependents: 1 });
    expect(path.value.externalPrerequisites).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/External Primer.md', requiredBy: 'Knowledge/Basics.md', revision: expect.any(String) }),
    ]));
    const graph = await callJson(client, 'get_wiki_graph_health', { limit: 20, maxChars: 12000, accessToken });
    expect(graph.value.mocSequenceHealth).toMatchObject({ needsAttention: 1, latePrerequisites: 3, externalPrerequisites: 2, unresolved: 2, cycleOrBlockedEntries: 3, dependencyCycles: 1, cyclicEntries: 2, blockedByCycleEntries: 1, redundantPrerequisiteEdges: 1, claimDependencyEdges: 1 });
    expect(graph.value.mocSequenceHealth.items[0]).toMatchObject({
      path: 'Knowledge/MOCs/Curriculum.md',
      revision: expect.any(String),
      state: 'cyclic_or_cycle_blocked',
      dependencyCycles: expect.objectContaining({ total: 1, entries: 2 }),
      blockedByCycles: expect.objectContaining({ total: 1, paths: ['Knowledge/Cycle Follower.md'] }),
      redundantPrerequisites: expect.objectContaining({ total: 1, items: [expect.objectContaining({ prerequisite: 'Knowledge/Redundant Base.md', dependent: 'Knowledge/Redundant Top.md', alternatePath: ['Knowledge/Redundant Base.md', 'Knowledge/Redundant Middle.md', 'Knowledge/Redundant Top.md'] })] }),
      nextAction: { endpointId: 'wiki.learning_path' },
    });
    const coverage = graph.value.mocCoverage.mocs.find((item: any) => item.path === 'Knowledge/MOCs/Curriculum.md');
    expect(coverage).toMatchObject({ directKnowledge: 12, indirectKnowledge: 1, linkedKnowledge: 13, revision: expect.any(String) });
    const organization = await callJson(client, 'get_wiki_organization_health', { limit: 20, maxChars: 12000, accessToken });
    expect(organization.value.mocSequenceHealth.needsAttention).toBe(1);
    expect(organization.value.recommendations).toEqual(expect.arrayContaining([expect.stringContaining('wiki.learning_path')]));
    const exceptionBoard = await callJson(client, 'get_wiki_exception_board', { limit: 30, maxChars: 12000, accessToken });
    expect(exceptionBoard.value.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/MOCs/Curriculum.md', code: 'moc_dependency_cycle', suggestedAction: 'call_wiki_learning_path_then_edit_with_current_revision' }),
    ]));
    const dashboard = await callJson(client, 'get_wiki_review_dashboard', { limit: 20, maxChars: 16000, accessToken });
    expect(dashboard.value.sections.graph.mocSequenceHealth).toMatchObject({ needsAttention: 1 });
    const reviewPacket = await callJson(client, 'get_wiki_review_packet', { limit: 20, maxChars: 12000, accessToken });
    expect(reviewPacket.value.counts.mocSequenceNeedsAttention).toBe(1);
    const sequencePriorities = reviewPacket.value.priorities.filter((item: any) => item.path === 'Knowledge/MOCs/Curriculum.md');
    expect(sequencePriorities).toHaveLength(1);
    expect(sequencePriorities[0]).toMatchObject({ reason: 'moc_sequence_needs_repair', reasons: expect.arrayContaining(['moc_sequence_needs_repair']), suggestedTool: 'wiki.learning_path' });
    expect(reviewPacket.value.curationPlan).toMatchObject({
      selected: { path: 'Knowledge/MOCs/Curriculum.md', revision: expect.any(String), reason: 'moc_sequence_needs_repair' },
      inspect: { endpointId: 'wiki.learning_path' },
      then: { endpointId: 'notes.patch', arguments: { path: 'Knowledge/MOCs/Curriculum.md', dryRun: true, expectedRevision: expect.any(String) } },
      guard: { oneNotePerPlan: true, expectedRevisionRequired: true, autoFix: false },
    });
    const medium = await callJson(client, 'get_wiki_learning_path', { path: 'Knowledge/MOCs/Curriculum.md', maxDepth: 2, limit: 20, maxChars: 12000, accessToken, prettyPrint: true });
    expect(String((medium.result.content as any)[0].text).length).toBeLessThanOrEqual(12000);
    expect(medium.value.authoredOrder.map((item: any) => item.path)).toEqual(path.value.authoredOrder.map((item: any) => item.path));
    expect(medium.value.authoredOrder.every((item: any) => /^[a-f0-9]{64}$/.test(item.revision))).toBe(true);
    const tiny = await callJson(client, 'get_wiki_learning_path', { path: 'Knowledge/MOCs/Curriculum.md', maxDepth: 2, limit: 20, maxChars: 1024, accessToken, prettyPrint: true });
    expect(String((tiny.result.content as any)[0].text).length).toBeLessThanOrEqual(1024);
    expect(tiny.value.root).toMatchObject({ path: 'Knowledge/MOCs/Curriculum.md', revision: expect.any(String) });

    const checkpoint = await callJson(client, 'save_work_state', {
      topic: 'Curriculum reading', summary: 'The authored first entry was read.', nextAction: 'Resume only after validating the saved path.',
      learningProgress: { rootPath: 'Knowledge/MOCs/Curriculum.md', order: 'authored', maxDepth: 2, completedThrough: 'Knowledge/Advanced.md' },
      accessToken,
    });
    expect(checkpoint.value.learningProgress).toMatchObject({ state: 'ready', completedCount: 1, next: { path: 'Knowledge/Basics.md', endpointId: 'notes.read' } });
    const resumed = await callJson(client, 'resume_work_state', { accessToken });
    expect(resumed.value.learningProgress).toMatchObject({ state: 'ready', canResume: true, completedCount: 1, next: { path: 'Knowledge/Basics.md', revision: expect.any(String) } });

    const basics = path.value.authoredOrder.find((item: any) => item.path === 'Knowledge/Basics.md');
    await callJson(client, 'patch_note', { path: 'Knowledge/Basics.md', oldString: '# Basics', newString: '# Basics\n\nCheckpoint drift probe.', expectedRevision: basics.revision, accessToken });
    const staleCheckpoint = await callJson(client, 'resume_work_state', { accessToken });
    expect(staleCheckpoint.value.learningProgress).toMatchObject({
      state: 'stale', canResume: false,
      drift: { structureChanged: false, revisionsChanged: true, changedEntries: expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Basics.md', state: 'revised' })]) },
      nextAction: { endpointId: 'wiki.learning_path' },
    });

    const notMoc = await client.callTool({ name: 'get_wiki_learning_path', arguments: { path: 'Knowledge/Basics.md', accessToken } });
    expect(notMoc.isError).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});

test('review packet promotes every actionable graph repair class without duplicate path slots', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'repair-coverage-owner', modelId: 'codex', password: 'repair-coverage-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };
    await write('Knowledge/MOCs/Broken child.md', '# Broken child\n\n[[Knowledge/Typed broken]]\n', { note_kind: 'moc', lifecycle: 'evergreen', moc_parent: '[[Knowledge/MOCs/Missing parent]]' });
    await write('Areas/Focus broken.md', '# Focus broken\n', { note_kind: 'area', lifecycle: 'active', focus_horizon: 'area', focus_parent: '[[Goals/Missing goal]]' });
    await write('Knowledge/Typed broken.md', '# Typed broken\n', { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', summary: 'A deliberately malformed relation fixture.', related: ['[[Knowledge/Typed broken]]'] });
    await write('Knowledge/Settled question.md', '# Settled question\n', { llm_wiki_type: 'knowledge', note_kind: 'question', lifecycle: 'active', epistemic_status: 'answered' });
    await write('Knowledge/Unprocessed literature.md', '# Unprocessed literature\n', { llm_wiki_type: 'knowledge', note_kind: 'literature', lifecycle: 'active', interpretation_status: 'unprocessed' });

    const packet = await callJson(client, 'get_wiki_review_packet', { limit: 30, maxChars: 16000, accessToken });
    for (const key of ['mocHierarchyIssues', 'focusHierarchyIssues', 'connectivityIssues', 'epistemicIssues', 'knowledgeFlowIssues', 'typedRelationIssues']) {
      expect(packet.value.counts[key]).toBeGreaterThan(0);
    }
    const priorityPaths = packet.value.priorities.map((item: any) => item.path);
    expect(new Set(priorityPaths).size).toBe(priorityPaths.length);
    expect(packet.value.priorities).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/MOCs/Broken child.md', reasons: expect.arrayContaining(['moc_parent_unresolved']) }),
      expect.objectContaining({ path: 'Areas/Focus broken.md', reasons: expect.arrayContaining(['focus_relation_unresolved']) }),
      expect.objectContaining({ path: 'Knowledge/Typed broken.md', reasons: expect.arrayContaining(['typed_relation_self_link']), suggestedTools: expect.arrayContaining(['wiki.neighborhood']) }),
      expect.objectContaining({ path: 'Knowledge/Settled question.md', reasons: expect.arrayContaining(['epistemic_state_needs_evidence']) }),
      expect.objectContaining({ path: 'Knowledge/Unprocessed literature.md', reasons: expect.arrayContaining(['literature_source_missing']) }),
    ]));
    expect(packet.value.curationPlan).toMatchObject({
      selected: { path: 'Knowledge/Typed broken.md', reason: 'knowledge_needs_review', reasons: expect.arrayContaining(['knowledge_needs_review', 'typed_relation_self_link']), revision: expect.any(String) },
      inspect: { endpointId: 'wiki.answer_packet' },
      then: { endpointId: 'wiki.review', arguments: { path: 'Knowledge/Typed broken.md', expectedRevision: expect.any(String) } },
      guard: { autoFix: false },
    });
    expect(JSON.stringify(packet.value).length).toBeLessThanOrEqual(16000);
  } finally {
    await client.close();
    await server.close();
  }
});

test('weekly review separates schedule from deadline and exposes reverse focus context', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'focus-review-owner', modelId: 'codex', password: 'focus-review-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };
    await write('Goals/Launch.md', '# Launch goal\n', { note_kind: 'knowledge', lifecycle: 'evergreen', focus_horizon: 'goal' });
    await write('Projects/Build.md', '# Build project\n', { llm_wiki_type: 'knowledge', note_kind: 'project', lifecycle: 'active', focus_horizon: 'project', focus_parent: '[[Goals/Launch]]' });
    await write('Tasks/Run.md', '# Run task\n', { llm_wiki_type: 'knowledge', note_kind: 'task', lifecycle: 'active', focus_horizon: 'ground', focus_parent: '[[Projects/Build]]', task_status: 'next_action', next_action: 'Run the test', scheduled_at: '2030-01-02T10:00:00.000Z', due_at: '2030-01-03T10:00:00.000Z' });
    await write('Knowledge/Reason.md', '# Reason\n', { note_kind: 'atomic', lifecycle: 'evergreen', focus_horizon: 'ground', focus_supports: ['[[Projects/Build]]'], summary: 'The test has a reusable rationale.' });

    const dashboard = await callJson(client, 'get_wiki_review_dashboard', { limit: 20, accessToken });
    expect(dashboard.value.sections.scheduled).toMatchObject({ total: 1, items: [expect.objectContaining({ path: 'Tasks/Run.md', scheduledAt: '2030-01-02T10:00:00.000Z', dueAt: '2030-01-03T10:00:00.000Z', readiness: 'ready' })] });
    expect(dashboard.value.sections.projectReadiness.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Tasks/Run.md', readiness: 'ready' })]));

    const graph = await callJson(client, 'get_wiki_graph_health', { limit: 20, accessToken });
    expect(graph.value.focusHealth.reverseMap.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Projects/Build.md', children: expect.arrayContaining(['tasks/run.md']), supportingNotes: expect.arrayContaining(['knowledge/reason.md']) }),
    ]));
    expect(graph.value.knowledgeConnectivity.literatureWithoutInterpretation.total).toBe(0);

    const bases = await callJson(client, 'get_wiki_bases_view', { view: 'projects', accessToken });
    expect(bases.value).toMatchObject({ view: 'projects', suggestedPath: 'Views/LLM Wiki Projects.base', matchingNotes: 2 });
    expect(bases.value.content).toContain('note.note_kind == "project" || note.note_kind == "task"');
  } finally {
    await client.close();
    await server.close();
  }
});

test('experiment notes connect epistemic work, reproducible Markdown, graph navigation, and bounded review views', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'experiment-owner', modelId: 'codex', password: 'experiment-owner-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({
        name: 'call_endpoint',
        arguments: {
          endpointId: 'notes.write',
          arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken },
        },
      });
      expect(result.isError).toBeFalsy();
    };

    const capability = await callJson(client, 'search_capabilities', { query: 'reproducible experiment template', limit: 3 });
    expect(capability.value.endpoints).toEqual(expect.arrayContaining([expect.objectContaining({ endpointId: 'wiki.note_template' })]));
    const template = await callJson(client, 'call_endpoint', { endpointId: 'wiki.note_template', arguments: { noteKind: 'experiment', accessToken } });
    expect(template.value).toMatchObject({
      templateId: 'experiment',
      noteKind: 'experiment',
      properties: { epistemic_status: 'planned', tests: [] },
    });
    expect(template.value.markdown).toContain('## Protocol');
    expect(template.value.markdown).toContain('## Reproduction');

    await write('Knowledge/Latency hypothesis.md', '# Latency hypothesis\n\nBatching lowers median latency.\n', {
      llm_wiki_type: 'knowledge', note_kind: 'hypothesis', lifecycle: 'review', epistemic_status: 'proposed',
    });
    await write('Knowledge/Unrelated concept.md', '# Unrelated concept\n', {
      llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen',
    });
    await write('Experiments/Latency run 1.md', '# Latency run 1\n\n## Tested proposition\n[[Knowledge/Latency hypothesis]]\n\n## Protocol\nSend 100 requests with and without batching.\n\n## Environment\nNode 24 on Windows.\n\n## Observations\nPending.\n\n## Result\nPending.\n\n## Reproduction\nRun the benchmark fixture.\n', {
      llm_wiki_type: 'knowledge', note_kind: 'experiment', lifecycle: 'review', epistemic_status: 'planned',
      tests: ['[[Knowledge/Latency hypothesis]]'], methods: ['benchmark'],
    });
    await write('Experiments/Wrong target.md', '# Wrong target\n\n## Protocol\nRun once.\n\n## Observations\nThe run completed.\n\n## Result\nNo difference.\n', {
      llm_wiki_type: 'knowledge', note_kind: 'experiment', lifecycle: 'review', epistemic_status: 'completed',
      tests: ['[[Knowledge/Unrelated concept]]'],
    });

    const gaps = await callJson(client, 'call_endpoint', { endpointId: 'wiki.knowledge_gaps', arguments: { limit: 10, maxChars: 6000, accessToken } });
    expect(gaps.value.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Experiments/Latency run 1.md', noteKind: 'experiment', epistemicStatus: 'planned', reasons: ['experiment_planned'] }),
    ]));
    const dashboard = await callJson(client, 'call_endpoint', { endpointId: 'wiki.review_dashboard', arguments: { limit: 10, maxChars: 16000, accessToken } });
    expect(dashboard.value.sections.epistemic.experiments).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ path: 'Experiments/Latency run 1.md', epistemicStatus: 'planned' })],
    });
    const bases = await callJson(client, 'call_endpoint', { endpointId: 'wiki.bases_view', arguments: { view: 'experiments', limit: 20, accessToken } });
    expect(bases.value).toMatchObject({ view: 'experiments', suggestedPath: 'Views/LLM Wiki Experiments.base', matchingNotes: 2, matchingNotesExact: true });
    expect(bases.value.content).toContain('note.note_kind == "experiment"');

    const graph = await callJson(client, 'call_endpoint', { endpointId: 'wiki.graph_health', arguments: { limit: 20, maxChars: 12000, accessToken } });
    expect(graph.value.typedRelations.kindMismatches.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Experiments/Wrong target.md', relation: 'tests', targetKind: 'knowledge' }),
    ]));
    expect(graph.value.relationNavigation.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'Knowledge/Latency hypothesis.md',
        incoming: expect.arrayContaining([expect.objectContaining({ relation: 'tests', paths: ['Experiments/Latency run 1.md'] })]),
      }),
    ]));
    const quality = await callJson(client, 'call_endpoint', { endpointId: 'wiki.quality_check', arguments: { path: 'Experiments/Latency run 1.md', maxChars: 8000, accessToken } });
    expect(quality.value.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'tested_proposition', passed: true }),
      expect.objectContaining({ id: 'reproducible_protocol', passed: true }),
    ]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('knowledge roles provide role templates, catalog facets, quality rubrics, and focused Obsidian views', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'knowledge-role-owner', modelId: 'codex', password: 'knowledge-role-owner-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };

    const template = await callJson(client, 'call_endpoint', { endpointId: 'wiki.note_template', arguments: { noteKind: 'concept', accessToken } });
    expect(template.value).toMatchObject({ templateId: 'concept', noteKind: 'atomic', properties: { knowledge_role: 'concept' } });
    expect(template.value.markdown).toContain('## Non-examples and boundaries');

    await write('Knowledge/Bounded queue.md', '# Bounded queue\n\n## Definition\nA queue with a fixed capacity.\n\n## Examples\n- A worker pool input buffer.\n\n## Non-examples and boundaries\n- An unbounded append-only log.\n\n## Related concepts\n- [[Knowledge/Backpressure]]\n', {
      llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', knowledge_role: 'concept', summary: 'A queue whose capacity is fixed.',
    });
    await write('Knowledge/Latency observation.md', '# Latency observation\n\n## Context\nWindows benchmark.\n\n## Observation\nMedian latency rose under saturation.\n\n## Method or measurement\nOne hundred timed requests.\n', {
      llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'review', knowledge_role: 'observation', observed_at: '2026-09-04T00:00:00.000Z', summary: 'Latency rose under saturation.',
    });

    const catalog = await callJson(client, 'call_endpoint', { endpointId: 'wiki.catalog', arguments: { knowledgeRole: 'concept', includeFacets: true, limit: 10, maxChars: 6000, accessToken } });
    expect(catalog.value).toMatchObject({ total: 1, organization: { knowledgeRoles: { concept: 1 } }, facets: { knowledgeRole: { concept: 1 } } });
    expect(catalog.value.entries).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Bounded queue.md', knowledgeRole: 'concept' })]));

    const conceptQuality = await callJson(client, 'call_endpoint', { endpointId: 'wiki.quality_check', arguments: { path: 'Knowledge/Bounded queue.md', maxChars: 6000, accessToken } });
    expect(conceptQuality.value).toMatchObject({ knowledgeRole: 'concept' });
    expect(conceptQuality.value.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'concept_definition', passed: true }),
      expect.objectContaining({ id: 'concept_examples', passed: true }),
      expect.objectContaining({ id: 'concept_boundaries', passed: true }),
    ]));
    const observationQuality = await callJson(client, 'call_endpoint', { endpointId: 'wiki.quality_check', arguments: { path: 'Knowledge/Latency observation.md', maxChars: 6000, accessToken } });
    expect(observationQuality.value.nextActions).toContain('observation_interpretation_boundary');

    const concepts = await callJson(client, 'call_endpoint', { endpointId: 'wiki.bases_view', arguments: { view: 'concepts', limit: 20, accessToken } });
    expect(concepts.value).toMatchObject({ view: 'concepts', suggestedPath: 'Views/LLM Wiki Concepts.base', matchingNotes: 1, matchingNotesExact: true });
    expect(concepts.value.content).toContain('note.knowledge_role == "concept"');
    const authority = await callJson(client, 'call_endpoint', { endpointId: 'wiki.bases_view', arguments: { view: 'authority', limit: 20, accessToken } });
    expect(authority.value).toMatchObject({ view: 'authority', suggestedPath: 'Views/LLM Wiki Authority.base' });
  } finally {
    await client.close();
    await server.close();
  }
});

test('knowledge organization helpers stay bounded and revision-safe', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-helper-owner', modelId: 'codex', password: 'organization-helper-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };
    await write('Knowledge/Target.md', '# Target\n', { note_kind: 'atomic', lifecycle: 'evergreen', term_language: 'ko', authority_scheme: 'local-vocabulary', authority_id: 'target-1' });
    await write('Knowledge/Contextless.md', '# Contextless\n\n[[Knowledge/Target]]\n', { note_kind: 'atomic', lifecycle: 'evergreen' });
    await write('Inbox/Project capture.md', '# Project capture\n', { note_kind: 'project', lifecycle: 'inbox' });

    const plan = await callJson(client, 'get_wiki_inbox_plan', { limit: 5, accessToken });
    expect(plan.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Inbox/Project capture.md', suggested: expect.objectContaining({ disposition: 'project' }) })]));

    const linkHealth = await callJson(client, 'get_wiki_link_context_health', { limit: 10, accessToken });
    expect(linkHealth.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'Knowledge/Contextless.md', target: 'Knowledge/Target' })]));

    const exported = await callJson(client, 'export_wiki_base', { view: 'knowledge', expectedRevision: 'missing', accessToken });
    expect(exported.value).toMatchObject({ persisted: true, path: 'Views/LLM Wiki Knowledge.base', revision: expect.any(String) });
    const base = await callJson(client, 'read_note', { path: 'Views/LLM Wiki Knowledge.base', accessToken });
    expect(base.value.content).toContain('note.note_kind');
    const conflict = await client.callTool({ name: 'export_wiki_base', arguments: { view: 'knowledge', expectedRevision: 'missing', accessToken } });
    expect(conflict.isError).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});

test('context shelves, exception board, role quality, and archive resurfacing compose existing views', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-projection-owner', modelId: 'codex', password: 'organization-projection-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };
    await write('Knowledge/Anchor.md', '# Anchor\n\nA durable anchor.\n', { note_kind: 'atomic', lifecycle: 'evergreen', summary: 'A durable anchor.' });
    await write('Knowledge/Support.md', '# Support\n\n[[Knowledge/Anchor]]\n[[Archives/Old]]\n', { note_kind: 'atomic', lifecycle: 'evergreen', summary: 'Supporting context.' });
    await write('Archives/Old.md', '# Old\n\nHistorical context.\n', { note_kind: 'knowledge', lifecycle: 'archived', summary: 'Historical context.', retention_reason: 'Kept for traceability.' });
    await write('Projects/Incomplete.md', '# Incomplete\n', { llm_wiki_type: 'knowledge', note_kind: 'project', lifecycle: 'active' });

    const pack = await callJson(client, 'get_wiki_context_pack', { path: 'Knowledge/Anchor.md', includeSemantic: false, maxChars: 6000, accessToken });
    expect(pack.value).toMatchObject({ mode: 'context_pack', root: expect.objectContaining({ path: 'Knowledge/Anchor.md', revision: expect.any(String) }), readOrder: expect.arrayContaining(['Knowledge/Anchor.md']), entrypoints: expect.any(Array) });
    expect(JSON.stringify(pack.value).length).toBeLessThanOrEqual(6000);

    const quality = await callJson(client, 'get_wiki_quality_check', { path: 'Projects/Incomplete.md', maxChars: 4000, accessToken });
    expect(quality.value).toMatchObject({ path: 'Projects/Incomplete.md', noteKind: 'project', advisory: true });
    expect(quality.value.nextActions).toEqual(expect.arrayContaining(['desired_outcome', 'next_action_or_waiting', 'execution_state']));

    const archives = await callJson(client, 'resurface_wiki_archives', { limit: 5, maxChars: 5000, accessToken });
    expect(archives.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Archives/Old.md', incomingLinks: 1, reason: 'referenced_by_current_visible_note' })]));

    const board = await callJson(client, 'get_wiki_exception_board', { limit: 20, maxChars: 7000, accessToken });
    expect(board.value).toMatchObject({ advisory: true, items: expect.any(Array), counts: expect.any(Object) });
    expect(board.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Projects/Incomplete.md' })]));
    expect(JSON.stringify(board.value).length).toBeLessThanOrEqual(7000);
  } finally {
    await client.close();
    await server.close();
  }
});

afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

test('lint reports cross-note Properties type drift as an advisory organization issue', async () => {
  const { server, client } = await setup();
  try {
    await writeFile(join(vault, 'one.md'), '---\ntags: [research]\n---\nOne\n');
    await writeFile(join(vault, 'two.md'), '---\ntags: research\n---\nTwo\n');
    const lint = await callJson(client, 'lint_wiki', { limit: 20 });
    expect(lint.value.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'property_type_drift', path: 'two.md' }),
    ]));
    const health = await callJson(client, 'get_wiki_organization_health', { limit: 20 });
    expect(health.value.byCode.property_type_drift).toBe(1);
  } finally {
    await client.close();
    await server.close();
  }
});

test('lint reports library vocabulary orphans, cycles, and deprecated facet use', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'vocabulary-health-owner', modelId: 'codex', password: 'vocabulary-health-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };
    await write('Knowledge/Old Term.md', '# Old Term\n', { note_kind: 'knowledge', lifecycle: 'evergreen', term_status: 'deprecated', term_replaced_by: '[[Knowledge/Preferred Term]]' });
    await write('Knowledge/Preferred Term.md', '# Preferred Term\n', { note_kind: 'knowledge', lifecycle: 'evergreen', broader_terms: ['[[Knowledge/Other Term]]'] });
    await write('Knowledge/Other Term.md', '# Other Term\n', { note_kind: 'knowledge', lifecycle: 'evergreen', broader_terms: ['[[Knowledge/Preferred Term]]'] });
    await write('Knowledge/Facet User.md', '# Facet User\n', { note_kind: 'knowledge', lifecycle: 'evergreen', subject_terms: ['Old Term'] });
    await write('Knowledge/Missing Parent.md', '# Missing Parent\n', { note_kind: 'knowledge', lifecycle: 'evergreen', broader_terms: ['[[Knowledge/Does Not Exist]]'] });
    await write('Knowledge/Question.md', '# Question\n', { note_kind: 'question', lifecycle: 'active' });
    await write('Knowledge/Mislinked Answer.md', '# Mislinked Answer\n', { note_kind: 'knowledge', lifecycle: 'evergreen', answers_questions: ['[[Knowledge/Preferred Term]]'] });

    const lint = await callJson(client, 'lint_wiki', { limit: 50, accessToken });
    expect(lint.value.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'broader_term_cycle' }),
      expect.objectContaining({ code: 'unresolved_broader_terms', path: 'Knowledge/Missing Parent.md' }),
      expect.objectContaining({ code: 'deprecated_term_used', path: 'Knowledge/Facet User.md' }),
      expect.objectContaining({ code: 'relation_target_kind_mismatch', path: 'Knowledge/Mislinked Answer.md' }),
    ]));
    const health = await callJson(client, 'get_wiki_organization_health', { limit: 50, accessToken });
    expect(health.value.byCode.broader_term_cycle).toBeGreaterThan(0);
  } finally {
    await client.close();
    await server.close();
  }
});

test('term resolution, merge preview, and citation graph stay bounded and non-mutating', async () => {
  await mkdir(join(vault, '_sources'), { recursive: true });
  const sourceContent = '# Evidence\n\nThe source supports a durable claim.\n';
  const sourceHash = createHash('sha256').update(sourceContent).digest('hex');
  await writeFile(join(vault, '_sources', 'paper.md'), [
    '---',
    'mcpvault_type: source',
    'llm_wiki_type: source',
    'immutable: true',
    'title: A source paper',
    'citation_key: paper-2026',
    'source_type: paper',
    `content_sha256: ${sourceHash}`,
    '---',
    sourceContent,
  ].join('\n'));
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-resolution-owner', modelId: 'codex', password: 'organization-resolution-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
      return callJson(client, 'read_note', { path, accessToken });
    };
    await write('Knowledge/AI Agent.md', '# AI Agent\n\nA canonical concept.\n', { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', aliases: ['agentic model'], stable_id: 'ai-agent' });
    await write('Knowledge/Old Agent Term.md', '# Old Agent Term\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'superseded', term_status: 'deprecated', term_replaced_by: '[[Knowledge/AI Agent]]' });
    const resolved = await callJson(client, 'call_endpoint', { endpointId: 'wiki.resolve_term', arguments: { query: 'agentic model', accessToken, maxChars: 3000 } });
    expect(resolved.value.resolved).toMatchObject({ canonicalTerm: 'AI Agent', path: 'Knowledge/AI Agent.md' });
    expect(resolved.value.matches[0]).toMatchObject({ matchKind: 'alias', matchedTerm: 'agentic model' });
    const termPreview = await callJson(client, 'get_wiki_term_change_preview', {
      currentTerm: 'agentic model', proposedTerm: 'reasoning agent', limit: 10, maxChars: 3000, accessToken,
    });
    expect(termPreview.value).toMatchObject({ canRename: false, currentTerm: 'agentic model', proposedTerm: 'reasoning agent' });
    expect(termPreview.value.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/AI Agent.md', reasons: expect.arrayContaining(['aliases_match']) }),
    ]));

    const source = await write('Knowledge/Source Copy.md', '# Source Copy\n\n[[Knowledge/AI Agent]]\n\nA source-backed claim.\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'review', stable_id: 'source-copy', evidence_paths: ['_sources/paper.md'] });
    const target = await write('Knowledge/Canonical Copy.md', '# Canonical Copy\n\n[[Knowledge/AI Agent]]\n\nA consolidated claim.\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', stable_id: 'canonical-copy', evidence_paths: ['_sources/paper.md'] });
    const merge = await callJson(client, 'call_endpoint', { endpointId: 'wiki.merge_preview', arguments: { sourcePath: 'Knowledge/Source Copy.md', targetPath: 'Knowledge/Canonical Copy.md', accessToken, maxChars: 5000 } });
    expect(merge.value).toMatchObject({ mode: 'bounded_merge_preview', recommendation: 'do_not_merge_without_identity_decision' });
    expect(merge.value.conflicts).toEqual(expect.arrayContaining(['different_titles', 'different_stable_ids', 'different_lifecycles', 'shared_evidence']));
    expect(merge.value.source.revision).toBe(source.value.revision);
    expect(merge.value.target.revision).toBe(target.value.revision);
    expect(merge.value.note).toContain('no files');

    const graph = await callJson(client, 'call_endpoint', { endpointId: 'wiki.citation_graph', arguments: { accessToken, limit: 10, maxChars: 5000 } });
    expect(graph.value.totals).toMatchObject({ sources: 1 });
    expect(graph.value.sources).toEqual(expect.arrayContaining([expect.objectContaining({ path: '_sources/paper.md', usedByCount: 2 })]));
    expect(graph.value.edges).toEqual(expect.arrayContaining([expect.objectContaining({ from: 'Knowledge/Source Copy.md', to: '_sources/paper.md', relation: 'evidence' })]));
    expect(JSON.stringify(graph.value).length).toBeLessThanOrEqual(5000);
  } finally {
    await client.close();
    await server.close();
  }
});

test('projects expose bounded flow health and the organization policy contract', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'flow-policy-owner', modelId: 'codex', password: 'flow-policy-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: {
        path, content: `# ${path}\n\nFlow fixture.\n`, frontmatter, expectedRevision: 'missing', accessToken,
      } });
      expect(result.isError).toBeFalsy();
    };
    await write('Projects/Active.md', {
      llm_wiki_type: 'knowledge', note_kind: 'project', lifecycle: 'active', task_status: 'next_action',
      next_action: 'Run the bounded integration test', service_class: 'research', started_at: '2020-01-01T00:00:00.000Z',
      completion_criteria: ['The integration test passes'],
    });
    await write('Projects/Ready.md', {
      llm_wiki_type: 'knowledge', note_kind: 'project', lifecycle: 'active', task_status: 'open',
      next_action: 'Review the resulting report', service_class: 'standard',
    });
    await write('Projects/Blocked.md', {
      llm_wiki_type: 'knowledge', note_kind: 'task', lifecycle: 'active', task_status: 'blocked',
      blocked_since: '2020-01-01T00:00:00.000Z',
    });
    await write('Projects/Waiting.md', {
      llm_wiki_type: 'knowledge', note_kind: 'task', lifecycle: 'active', task_status: 'waiting',
      waiting_for: 'A source review', waiting_since: '2020-01-01T00:00:00.000Z',
    });

    const flow = await callJson(client, 'get_wiki_flow_health', { wipLimit: 3, blockedAfterDays: 7, waitingAfterDays: 14, limit: 10, maxChars: 7000, accessToken });
    expect(flow.value.flow).toMatchObject({ totalWork: 4, activeWip: 1, readyToPull: 1, blocked: 1, waiting: 1, pullAllowed: true });
    expect(flow.value.lanes.active).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Projects/Active.md', serviceClass: 'research' })]));
    expect(flow.value.lanes.blocked).toEqual(expect.arrayContaining([expect.objectContaining({ aging: true })]));
    expect(flow.value.lanes.waiting).toEqual(expect.arrayContaining([expect.objectContaining({ aging: true, waitingFor: 'A source review' })]));
    expect(JSON.stringify(flow.value).length).toBeLessThanOrEqual(7000);

    const policy = await callJson(client, 'get_wiki_policy', { maxChars: 7000, accessToken });
    expect(policy.value).toMatchObject({
      topic: 'overview',
      policyVersion: WIKI_POLICY_VERSION,
      policyFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      availableTopics: expect.arrayContaining(['overview', 'moc', 'evidence', 'work', 'safety']),
    });
    expect(JSON.stringify(policy.value).length).toBeLessThanOrEqual(1200);

    const workPolicy = await callJson(client, 'get_wiki_policy', { topic: 'work', maxChars: 1600, accessToken });
    expect(workPolicy.value).toMatchObject({
      topic: 'work',
      policyFingerprint: policy.value.policyFingerprint,
      routes: expect.arrayContaining(['wiki.flow_health', 'wiki.next_actions', 'mcp.list_tasks', 'notes.task_update']),
    });
    expect(JSON.stringify(workPolicy.value)).toContain('task_status');
    expect(JSON.stringify(workPolicy.value).length).toBeLessThanOrEqual(1600);

    const mocPolicy = await callJson(client, 'get_wiki_policy', { topic: 'moc', maxChars: 1200, accessToken });
    expect(mocPolicy.value).toMatchObject({
      topic: 'moc',
      policyVersion: policy.value.policyVersion,
      policyFingerprint: policy.value.policyFingerprint,
      rules: expect.any(Array),
      routes: expect.arrayContaining(['wiki.learning_path']),
    });
    expect(JSON.stringify(mocPolicy.value).length).toBeLessThanOrEqual(1200);
    expect(JSON.stringify(mocPolicy.value)).not.toContain('auth.register');

    const runtime = getServerRuntime(server)!;
    runtime.ensureEndpointRegistry();
    const controlTools = new Set(['orient_wiki', 'get_agent_pulse', 'list_active_capabilities', 'search_capabilities', 'call_endpoint']);
    const missingRoutes = WIKI_POLICY_TOPICS.flatMap(topic => {
      const topicPolicy = getWikiPolicyTopic(topic, 16_000);
      return ((topicPolicy.routes || []) as string[])
        .filter(endpointId => !controlTools.has(endpointId) && !runtime.endpointRegistry.resolve(endpointId))
        .map(endpointId => ({ topic, endpointId }));
    });
    expect(missingRoutes).toEqual([]);
    const endpointMentionPattern = /\b(?:auth|chat|community|context|continuity|idea|mcp|moderation|notes|notifications|wiki|workshop)\.[a-z][a-z0-9_]*/g;
    const missingRuleReferences = WIKI_POLICY_TOPICS.flatMap(topic => {
      const topicPolicy = getWikiPolicyTopic(topic, 16_000);
      const mentioned = JSON.stringify(topicPolicy.rules || []).match(endpointMentionPattern) || [];
      return mentioned
        .filter(endpointId => !controlTools.has(endpointId) && !runtime.endpointRegistry.resolve(endpointId))
        .map(endpointId => ({ topic, endpointId }));
    });
    expect(missingRuleReferences).toEqual([]);

    const packet = await callJson(client, 'get_wiki_review_packet', { limit: 10, maxChars: 12000, accessToken });
    expect(packet.value.counts).toMatchObject({ activeWip: 1, readyToPull: 1, blocked: 1, waiting: 1 });
    expect(packet.value.supportingViews.executionFlow.flow).toMatchObject({ activeWip: 1, blocked: 1, waiting: 1 });
    expect(packet.value.priorities).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Projects/Blocked.md', reason: 'blocked_work_needs_unblocking' }),
      expect.objectContaining({ path: 'Projects/Waiting.md', reason: 'waiting_work_needs_follow_up' }),
    ]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('work dependency gates keep flow, project planning, and next actions consistent', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'work-dependency-owner', modelId: 'codex', password: 'work-dependency-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: {
        path,
        content: `# ${path}\n\n## Brainstorm\n\n- Keep the dependency explicit.\n\n## Project support\n\n[[Knowledge/Reference]]\n`,
        frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'project', lifecycle: 'active', project_purpose: 'Verify executable work selection.', desired_outcome: 'Only dependency-safe actions are offered.', completion_criteria: ['The selected action has no unfinished prerequisite'], ...frontmatter },
        expectedRevision: 'missing', accessToken,
      } });
      expect(result.isError).toBeFalsy();
    };
    await write('Projects/Open prerequisite.md', { task_status: 'open', next_action: 'Complete the prerequisite work', task_context: '@computer' });
    await write('Projects/Blocked dependent.md', { task_status: 'open', next_action: 'Run the dependent action', task_context: '@computer', blocked_by: ['[[Projects/Open prerequisite]]'] });
    await write('Projects/Completed prerequisite.md', { task_status: 'completed', aliases: ['finished-gate'] });
    await write('Projects/Ready dependent.md', { task_status: 'open', next_action: 'Run the now-unblocked action', task_context: '@computer', depends_on: ['[[finished-gate]]'] });
    await write('Projects/Unknown dependent.md', { task_status: 'open', next_action: 'Run an unsafe unresolved action', task_context: '@computer', blocked_by: ['[[Projects/Missing prerequisite]]'] });
    await write('Projects/Cycle A.md', { task_status: 'open', next_action: 'Run cycle action A', task_context: '@computer', depends_on: ['[[Projects/Cycle B]]'] });
    await write('Projects/Cycle B.md', { task_status: 'open', next_action: 'Run cycle action B', task_context: '@computer', depends_on: ['[[Projects/Cycle A]]'] });
    await write('Projects/Cycle follower.md', { task_status: 'open', next_action: 'Run work after the cycle', task_context: '@computer', depends_on: ['[[Projects/Cycle A]]'] });
    await write('Projects/Unknown follower.md', { task_status: 'open', next_action: 'Run work after the unknown gate', task_context: '@computer', depends_on: ['[[Projects/Unknown dependent]]'] });
    await write('Projects/Waiting.md', { task_status: 'waiting', next_action: 'Premature waiting action', task_context: '@computer', waiting_for: 'A human decision' });
    await write('Projects/Waiting follower.md', { task_status: 'open', next_action: 'Run work after the waiting item', task_context: '@computer', depends_on: ['[[Projects/Waiting]]'] });
    await write('Projects/Deferred.md', { task_status: 'open', next_action: 'Run a future deferred action', task_context: '@computer', defer_until: '2999-01-01T00:00:00.000Z' });
    await write('Projects/Someday prerequisite.md', { task_status: 'someday', next_action: 'Reconsider this deferred idea', task_context: '@computer' });
    await write('Projects/Someday dependent.md', { task_status: 'open', next_action: 'Do not run before the someday idea is activated', task_context: '@computer', depends_on: ['[[Projects/Someday prerequisite]]'] });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Reference.md', content: '# Reference\n\nReusable context.\n',
      frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen' }, expectedRevision: 'missing', accessToken,
    } });
    await write('Projects/Knowledge dependent.md', { task_status: 'open', next_action: 'Use the reference while working', task_context: '@computer', depends_on: ['[[Knowledge/Reference]]'] });
    await write('Projects/Archived historical work.md', { lifecycle: 'archived', task_status: 'open', next_action: 'Do not enter the current dependency plan', task_context: '@computer' });

    const next = await callJson(client, 'get_wiki_next_actions', { context: '@computer', limit: 20, maxChars: 12000, accessToken });
    const nextPaths = next.value.items.map((item: any) => item.path);
    expect(nextPaths).toEqual(expect.arrayContaining(['Projects/Open prerequisite.md', 'Projects/Ready dependent.md', 'Projects/Knowledge dependent.md']));
    expect(nextPaths).not.toEqual(expect.arrayContaining(['Projects/Blocked dependent.md', 'Projects/Unknown dependent.md', 'Projects/Cycle A.md', 'Projects/Cycle B.md', 'Projects/Cycle follower.md', 'Projects/Unknown follower.md', 'Projects/Waiting.md', 'Projects/Waiting follower.md', 'Projects/Deferred.md', 'Projects/Someday prerequisite.md', 'Projects/Someday dependent.md']));
    expect(next.value.exclusions).toMatchObject({ workflowBlocked: 1, deferred: 1, dependencyBlocked: 8, unresolvedDependencies: 1, dependencyCycles: 2 });
    expect(next.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Projects/Ready dependent.md', revision: expect.any(String) })]));
    expect(next.value.items[0]).toMatchObject({ path: 'Projects/Open prerequisite.md', plannedStage: 0, immediateUnlocks: 1, directDependents: 1 });
    const compactNext = await callJson(client, 'get_wiki_next_actions', { context: '@computer', limit: 20, maxChars: 1200, accessToken });
    expect(compactNext.value).toMatchObject({ total: 3, truncated: true, items: expect.any(Array), exclusions: expect.objectContaining({ dependencyBlocked: 8 }) });
    expect(JSON.stringify(compactNext.value).length).toBeLessThanOrEqual(1200);

    const flow = await callJson(client, 'get_wiki_flow_health', { limit: 20, maxChars: 12000, accessToken });
    expect(flow.value.flow).toMatchObject({ readyToPull: 3, blocked: 8, dependencyBlocked: 8, waiting: 1, deferred: 1 });
    expect(flow.value.lanes.blocked).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Projects/Blocked dependent.md', blockedReason: 'dependency', dependencies: expect.objectContaining({ executable: false, blockers: expect.arrayContaining([expect.objectContaining({ targetRevisions: [expect.any(String)] })]) }) }),
      expect.objectContaining({ path: 'Projects/Cycle A.md', dependencies: expect.objectContaining({ dependencyCycle: expect.arrayContaining(['Projects/Cycle A.md', 'Projects/Cycle B.md']) }) }),
    ]));
    expect(flow.value.dependencyPlan).toMatchObject({
      stats: { stageable: 4, stages: 2, longestDependencyDepth: 1, incompletePrerequisites: 2, blockedByIncompletePrerequisites: 1, workflowHolds: 2, blockedByWorkflowHolds: 1, dependencyCycles: 1, cyclicItems: 2, blockedByCycles: 1 },
      recommendedStages: [expect.objectContaining({ stage: 0, total: 3 }), expect.objectContaining({ stage: 1, total: 1 })],
      unlockPoints: expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ path: 'Projects/Open prerequisite.md', immediateUnlocks: 1 })]) }),
      deepestDependencyChain: [expect.objectContaining({ path: 'Projects/Open prerequisite.md' }), expect.objectContaining({ path: 'Projects/Blocked dependent.md' })],
      dependencyCycles: expect.objectContaining({ total: 1 }),
      cycleBlockedDependents: expect.objectContaining({ total: 1, items: expect.arrayContaining([expect.objectContaining({ path: 'Projects/Cycle follower.md' })]) }),
      incompleteBlockedDependents: expect.objectContaining({ total: 1, items: expect.arrayContaining([expect.objectContaining({ path: 'Projects/Unknown follower.md' })]) }),
      workflowHoldBlockedDependents: expect.objectContaining({ total: 1, items: expect.arrayContaining([expect.objectContaining({ path: 'Projects/Waiting follower.md' })]) }),
    });
    const compactFlow = await callJson(client, 'get_wiki_flow_health', { limit: 20, maxChars: 1800, accessToken });
    expect(compactFlow.value).toMatchObject({ flow: expect.objectContaining({ dependencyBlocked: 8 }), dependencyPlan: { stats: expect.objectContaining({ stages: 2, dependencyCycles: 1 }) }, truncated: true });
    expect(JSON.stringify(compactFlow.value).length).toBeLessThanOrEqual(1800);

    const dashboard = await callJson(client, 'get_wiki_review_dashboard', { limit: 20, maxChars: 18000, accessToken });
    expect(dashboard.value.sections.dependencyBlocked).toMatchObject({ total: 8, items: expect.arrayContaining([expect.objectContaining({ path: 'Projects/Unknown dependent.md', readiness: 'dependency_blocked' })]) });
    const review = await callJson(client, 'get_wiki_review_packet', { limit: 20, maxChars: 16000, accessToken });
    expect(review.value.counts).toMatchObject({ dependencyBlocked: 8 });
    expect(review.value.priorities).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'blocked_work_needs_unblocking' })]));

    const packet = await callJson(client, 'get_wiki_project_packet', { limit: 20, maxChars: 14000, accessToken });
    expect(packet.value).toMatchObject({ dependencyBlocked: 8 });
    expect(packet.value.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Projects/Blocked dependent.md', execution: expect.objectContaining({ ready: false, dependencies: expect.objectContaining({ blockerCount: 1 }) }) }),
    ]));
    const dependencyGraph = await callJson(client, 'get_wiki_graph_health', { limit: 50, maxChars: 16000, accessToken });
    expect(dependencyGraph.value.typedRelations.unresolved.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Projects/Ready dependent.md', relation: 'depends_on' }),
    ]));
    expect(dependencyGraph.value.unresolvedLinks.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Projects/Ready dependent.md', target: 'finished-gate' }),
    ]));
    const base = await callJson(client, 'get_wiki_bases_view', { view: 'project_next_actions', limit: 20, maxChars: 12000, accessToken });
    expect(base.value).toMatchObject({ view: 'project_next_actions', actionScope: 'any_actionable_note', dependencyAware: false, recommendedEndpoint: 'wiki.next_actions', matchingNotesExact: false });
    expect(base.value.content).toContain('note.blocked_by');
  } finally {
    await client.close();
    await server.close();
  }
});

test('Property migrations produce executable bounded change sets and preserve scope boundaries', async () => {
  await mkdir(join(vault, 'Knowledge'), { recursive: true });
  await mkdir(join(vault, '_sources'), { recursive: true });
  await writeFile(join(vault, 'Knowledge', 'A.md'), '---\nnote_kind: project\nlegacy_state: todo\n---\n# A\n');
  await writeFile(join(vault, 'Knowledge', 'B.md'), '---\nnote_kind: project\nlegacy_state: done\ntask_status: open\n---\n# B\n');
  await writeFile(join(vault, '_sources', 'Immutable.md'), '---\nlegacy_state: todo\n---\n# Source\n');
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'migration-owner', modelId: 'codex', password: 'migration-owner-password' });
    const accessToken = registration.value.accessToken;
    const discovery = await callJson(client, 'search_capabilities', { query: 'Obsidian Property schema migration change set', limit: 5, maxChars: 8000, accessToken });
    expect(discovery.value.endpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ endpointId: 'wiki.property_migration' }),
    ]));
    const changeSetDiscovery = await callJson(client, 'search_capabilities', { query: 'multiple notes atomic rollback transaction', limit: 5, maxChars: 8000, accessToken });
    expect(changeSetDiscovery.value.endpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ endpointId: 'notes.change_set', mutating: true }),
    ]));
    const privateWrite = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'notes.write', arguments: {
      path: 'scope://model/codex/Private.md', content: '# Private\n\nOld private text.\n', expectedRevision: 'missing', accessToken,
    } } });
    expect(privateWrite.isError).toBeFalsy();
    const privateNote = await callJson(client, 'call_endpoint', { endpointId: 'notes.read', arguments: { path: 'scope://model/codex/Private.md', accessToken } });
    const privatePreview = await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: {
      changes: [{ path: 'scope://model/codex/Private.md', expectedRevision: privateNote.value.revision, patches: [{ oldString: 'Old private text.', newString: 'New private text.' }] }],
      dryRun: true, accessToken,
    } });
    expect(privatePreview.value.changes[0].path).toBe('scope://model/codex/Private.md');

    const migration = await callJson(client, 'call_endpoint', { endpointId: 'wiki.property_migration', arguments: {
      fromProperty: 'legacy_state', toProperty: 'task_status', valueMap: { todo: 'open', done: 'completed' }, pathPrefix: 'Knowledge', limit: 10, maxChars: 12000, accessToken,
    } });
    expect(migration.result.isError).toBeFalsy();
    expect(migration.value.changes).toEqual([
      expect.objectContaining({ path: 'Knowledge/A.md', expectedRevision: expect.stringMatching(/^[a-f0-9]{64}$/), frontmatter: { set: { task_status: 'open' }, remove: ['legacy_state'] } }),
    ]);
    expect(migration.value.blocked).toEqual([
      expect.objectContaining({ path: 'Knowledge/B.md', reason: expect.stringContaining('different value') }),
    ]);
    expect(migration.value.nextAction.endpointId).toBe('notes.change_set');

    const preview = await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: { changes: migration.value.changes, dryRun: true, accessToken } });
    expect(preview.value).toMatchObject({ success: true, dryRun: true, applied: false, changeCount: 1 });
    const applied = await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: {
      changes: migration.value.changes, dryRun: false, confirmPlanFingerprint: preview.value.planFingerprint, accessToken,
    } });
    expect(applied.value).toMatchObject({ success: true, applied: true, planFingerprint: preview.value.planFingerprint });
    const a = await callJson(client, 'read_note', { path: 'Knowledge/A.md', accessToken });
    expect(a.value.fm).toMatchObject({ note_kind: 'project', task_status: 'open' });
    expect(a.value.fm).not.toHaveProperty('legacy_state');

    const immutablePlan = await callJson(client, 'call_endpoint', { endpointId: 'wiki.property_migration', arguments: {
      fromProperty: 'legacy_state', toProperty: 'task_status', valueMap: { todo: 'open' }, pathPrefix: '_sources', limit: 10, maxChars: 8000, accessToken,
    } });
    expect(immutablePlan.value.changes).toEqual([]);
    expect(immutablePlan.value.blocked).toEqual([expect.objectContaining({ path: '_sources/Immutable.md', reason: expect.stringContaining('cannot mutate immutable') })]);

    const source = await callJson(client, 'read_note', { path: '_sources/Immutable.md', accessToken });
    const rejected = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'notes.change_set', arguments: {
      changes: [{ path: '_sources/Immutable.md', expectedRevision: source.value.revision, frontmatter: { set: { legacy_state: 'done' } } }], accessToken,
    } } });
    expect(rejected.isError).toBe(true);
    expect((rejected.content as any)[0].text).toContain('cannot mutate immutable LLM Wiki sources');
  } finally { await client.close(); await server.close(); }
});

test('MOC order previews require the complete sibling set and apply one revision-safe order', async () => {
  await mkdir(join(vault, 'Knowledge', 'MOCs'), { recursive: true });
  await writeFile(join(vault, 'Knowledge', 'MOCs', 'Root.md'), '---\nllm_wiki_type: knowledge\nnote_kind: moc\nnav_order: 0\n---\n# Root\n');
  await writeFile(join(vault, 'Knowledge', 'MOCs', 'A.md'), '---\nllm_wiki_type: knowledge\nnote_kind: moc\nmoc_parent: "[[Knowledge/MOCs/Root]]"\nnav_order: 10\n---\n# A\n');
  await writeFile(join(vault, 'Knowledge', 'MOCs', 'B.md'), '---\nllm_wiki_type: knowledge\nnote_kind: moc\nmoc_parent: "[[Knowledge/MOCs/Root]]"\nnav_order: 20\n---\n# B\n');
  await writeFile(join(vault, 'Knowledge', 'MOCs', 'C.md'), '---\nllm_wiki_type: knowledge\nnote_kind: moc\nmoc_parent: "[[Knowledge/MOCs/Root]]"\nnav_order: 30\n---\n# C\n');
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'moc-order-owner', modelId: 'codex', password: 'moc-order-owner-password' });
    const accessToken = registration.value.accessToken;
    const discovery = await callJson(client, 'search_capabilities', { query: 'MOC sibling nav order reorder change set', limit: 5, maxChars: 8000, accessToken });
    expect(discovery.value.endpoints).toEqual(expect.arrayContaining([expect.objectContaining({ endpointId: 'wiki.moc_order', method: 'POST' })]));
    const plan = await callJson(client, 'call_endpoint', { endpointId: 'wiki.moc_order', arguments: {
      parentPath: 'Knowledge/MOCs/Root.md',
      orderedMocs: ['Knowledge/MOCs/B.md', 'Knowledge/MOCs/C.md', 'Knowledge/MOCs/A.md'],
      maxChars: 12000,
      accessToken,
    } });
    expect(plan.value).toMatchObject({ valid: true, alreadyOrdered: false, requiredChanges: 3, hierarchy: { siblingTotal: 3 }, nextAction: { endpointId: 'notes.change_set' } });
    expect(plan.value.currentOrder.map((item: any) => item.path)).toEqual(['Knowledge/MOCs/A.md', 'Knowledge/MOCs/B.md', 'Knowledge/MOCs/C.md']);
    expect(plan.value.proposedOrder.map((item: any) => [item.path, item.navOrder])).toEqual([
      ['Knowledge/MOCs/B.md', 10], ['Knowledge/MOCs/C.md', 20], ['Knowledge/MOCs/A.md', 30],
    ]);
    const preview = await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: { changes: plan.value.changes, dryRun: true, accessToken } });
    const applied = await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: {
      changes: plan.value.changes, dryRun: false, confirmPlanFingerprint: preview.value.planFingerprint, accessToken,
    } });
    expect(applied.value).toMatchObject({ success: true, applied: true, changedCount: 3 });
    const confirmed = await callJson(client, 'call_endpoint', { endpointId: 'wiki.moc_order', arguments: {
      parentPath: 'Knowledge/MOCs/Root.md', orderedMocs: ['Knowledge/MOCs/B.md', 'Knowledge/MOCs/C.md', 'Knowledge/MOCs/A.md'], accessToken,
    } });
    expect(confirmed.value).toMatchObject({ valid: true, alreadyOrdered: true, requiredChanges: 0, changes: [] });
    const home = await callJson(client, 'call_endpoint', { endpointId: 'wiki.home', arguments: { limit: 10, maxChars: 10000, accessToken } });
    expect(home.value.mocOrderPlanner).toMatchObject({ endpointId: 'wiki.moc_order' });
    expect(home.value.mocs.map((item: any) => item.path)).toEqual([
      'Knowledge/MOCs/Root.md', 'Knowledge/MOCs/B.md', 'Knowledge/MOCs/C.md', 'Knowledge/MOCs/A.md',
    ]);
    const partial = await callJson(client, 'call_endpoint', { endpointId: 'wiki.moc_order', arguments: {
      parentPath: 'Knowledge/MOCs/Root.md', orderedMocs: ['Knowledge/MOCs/B.md', 'Knowledge/MOCs/C.md'], accessToken,
    } });
    expect(partial.value).toMatchObject({ valid: false, changes: [], blockers: [expect.objectContaining({ reason: expect.stringContaining('complete current sibling set') })] });
    const brokenWrite = await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/MOCs/Broken.md', content: '# Broken\n', frontmatter: { note_kind: 'moc', moc_parent: '[[Missing parent]]' }, expectedRevision: 'missing', accessToken,
    } });
    expect(brokenWrite.isError).toBeFalsy();
    const unsafeRoot = await callJson(client, 'call_endpoint', { endpointId: 'wiki.moc_order', arguments: {
      orderedMocs: ['Knowledge/MOCs/Root.md'], accessToken,
    } });
    expect(unsafeRoot.value).toMatchObject({ valid: false, changes: [], blockers: [expect.objectContaining({ reason: expect.stringContaining('Root order is unsafe') })] });
    await mkdir(join(vault, '_wiki'), { recursive: true });
    await writeFile(join(vault, '_wiki', 'Forged MOC.md'), '---\nllm_wiki_type: knowledge\nnote_kind: moc\nmoc_parent: "[[Knowledge/MOCs/Root]]"\nnav_order: 40\n---\n# Forged MOC\n');
    const reserved = await callJson(client, 'call_endpoint', { endpointId: 'wiki.moc_order', arguments: {
      parentPath: 'Knowledge/MOCs/Root.md',
      orderedMocs: ['Knowledge/MOCs/B.md', 'Knowledge/MOCs/C.md', 'Knowledge/MOCs/A.md', '_wiki/Forged MOC.md'],
      accessToken,
    } });
    expect(reserved.value).toMatchObject({ valid: false, changes: [], blockers: expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining('Reserved _wiki') })]) });
  } finally { await client.close(); await server.close(); }
});

test('reciprocal-link previews repair both graph directions atomically and reject unsafe scopes', async () => {
  await mkdir(join(vault, 'Knowledge'), { recursive: true });
  await writeFile(join(vault, 'Knowledge', 'Left.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nrelated:\n  - "[[Knowledge/Right]]"\nclose_match:\n  - "[[Knowledge/Right]]"\n---\n# Left\n');
  await writeFile(join(vault, 'Knowledge', 'Right.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\n---\n# Right\n');
  await writeFile(join(vault, 'Knowledge', 'Scalar.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nrelated: "[[Knowledge/Right]]"\n---\n# Scalar\n');
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'reciprocal-owner', modelId: 'codex', password: 'reciprocal-owner-password' });
    const accessToken = registration.value.accessToken;
    const discovery = await callJson(client, 'search_capabilities', { query: 'reciprocal mutual related backlink two notes', limit: 5, maxChars: 8000, accessToken });
    expect(discovery.value.endpoints).toEqual(expect.arrayContaining([expect.objectContaining({ endpointId: 'wiki.reciprocal_link', method: 'POST' })]));
    const before = await callJson(client, 'call_endpoint', { endpointId: 'wiki.graph_health', arguments: { limit: 20, maxChars: 12000, accessToken } });
    expect(before.value.typedRelations.reciprocityMissing.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Left.md', target: 'Knowledge/Right.md', repair: { endpointId: 'wiki.reciprocal_link', arguments: { leftPath: 'Knowledge/Left.md', rightPath: 'Knowledge/Right.md', relation: 'related' } } }),
      expect.objectContaining({ path: 'Knowledge/Left.md', target: 'Knowledge/Right.md', relation: 'close_match', repair: { endpointId: 'wiki.reciprocal_link', arguments: { leftPath: 'Knowledge/Left.md', rightPath: 'Knowledge/Right.md', relation: 'close_match' } } }),
    ]));
    const plan = await callJson(client, 'call_endpoint', { endpointId: 'wiki.reciprocal_link', arguments: {
      leftPath: 'Knowledge/Left.md', rightPath: 'Knowledge/Right.md', relation: 'related', accessToken,
    } });
    expect(plan.value).toMatchObject({ valid: true, alreadyReciprocal: false, left: { hasReciprocalEdge: true }, right: { hasReciprocalEdge: false }, nextAction: { endpointId: 'notes.change_set' } });
    expect(plan.value.changes).toEqual([
      expect.objectContaining({ path: 'Knowledge/Right.md', frontmatter: { set: { related: ['[[Knowledge/Left]]'] } } }),
    ]);
    const preview = await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: { changes: plan.value.changes, dryRun: true, accessToken } });
    await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: {
      changes: plan.value.changes, dryRun: false, confirmPlanFingerprint: preview.value.planFingerprint, accessToken,
    } });
    const graph = await callJson(client, 'call_endpoint', { endpointId: 'wiki.graph_health', arguments: { limit: 20, maxChars: 12000, accessToken } });
    expect(graph.value.typedRelations.reciprocityMissing.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Left.md', target: 'Knowledge/Right.md' }),
      expect.objectContaining({ path: 'Knowledge/Right.md', target: 'Knowledge/Left.md' }),
    ]));
    expect(graph.value.typedRelations.reciprocityMissing.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Left.md', target: 'Knowledge/Right.md', relation: 'close_match' }),
    ]));

    const closePlan = await callJson(client, 'call_endpoint', { endpointId: 'wiki.reciprocal_link', arguments: {
      leftPath: 'Knowledge/Left.md', rightPath: 'Knowledge/Right.md', relation: 'close_match', accessToken,
    } });
    expect(closePlan.value).toMatchObject({ valid: true, changes: [expect.objectContaining({ path: 'Knowledge/Right.md', expectedRevision: expect.any(String) })] });
    const closePreview = await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: { changes: closePlan.value.changes, dryRun: true, accessToken } });
    const rightBeforeConcurrentEdit = await callJson(client, 'read_note', { path: 'Knowledge/Right.md', accessToken });
    await callJson(client, 'patch_note', { path: 'Knowledge/Right.md', oldString: '# Right', newString: '# Right\n\nConcurrent edit.', expectedRevision: rightBeforeConcurrentEdit.value.revision, accessToken });
    const staleCloseApply = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'notes.change_set', arguments: {
      changes: closePlan.value.changes, dryRun: false, confirmPlanFingerprint: closePreview.value.planFingerprint, accessToken,
    } } });
    expect(staleCloseApply.isError).toBe(true);
    expect(String((staleCloseApply.content as any)[0]?.text)).toMatch(/revision|fingerprint/i);

    const freshClosePlan = await callJson(client, 'call_endpoint', { endpointId: 'wiki.reciprocal_link', arguments: {
      leftPath: 'Knowledge/Left.md', rightPath: 'Knowledge/Right.md', relation: 'close_match', accessToken,
    } });
    const freshClosePreview = await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: { changes: freshClosePlan.value.changes, dryRun: true, accessToken } });
    await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: {
      changes: freshClosePlan.value.changes, dryRun: false, confirmPlanFingerprint: freshClosePreview.value.planFingerprint, accessToken,
    } });
    const afterCloseRepair = await callJson(client, 'get_wiki_graph_health', { limit: 20, maxChars: 12000, accessToken });
    expect(afterCloseRepair.value.typedRelations.reciprocityMissing.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Left.md', target: 'Knowledge/Right.md', relation: 'close_match' }),
    ]));
    const confirmed = await callJson(client, 'call_endpoint', { endpointId: 'wiki.reciprocal_link', arguments: {
      leftPath: 'Knowledge/Left.md', rightPath: 'Knowledge/Right.md', relation: 'related', accessToken,
    } });
    expect(confirmed.value).toMatchObject({ valid: true, alreadyReciprocal: true, changes: [] });
    const malformed = await callJson(client, 'call_endpoint', { endpointId: 'wiki.reciprocal_link', arguments: {
      leftPath: 'Knowledge/Scalar.md', rightPath: 'Knowledge/Right.md', relation: 'related', accessToken,
    } });
    expect(malformed.value).toMatchObject({ valid: false, changes: [], blockers: [expect.objectContaining({ path: 'Knowledge/Scalar.md', reason: expect.stringContaining('Property list') })] });

    const privateWrite = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'notes.write', arguments: {
      path: 'scope://model/codex/Private.md', content: '# Private\n', expectedRevision: 'missing', accessToken,
    } } });
    expect(privateWrite.isError).toBeFalsy();
    const unsafe = await callJson(client, 'call_endpoint', { endpointId: 'wiki.reciprocal_link', arguments: {
      leftPath: 'Knowledge/Left.md', rightPath: 'scope://model/codex/Private.md', relation: 'same_as', accessToken,
    } });
    expect(unsafe.value).toMatchObject({ valid: false, changes: [], blockers: [expect.objectContaining({ reason: expect.stringContaining('privacy boundary') })] });
  } finally { await client.close(); await server.close(); }
});

test('review packets route a selected reciprocity defect to the executable reciprocal planner', async () => {
  await mkdir(join(vault, 'Notes'), { recursive: true });
  await writeFile(join(vault, 'Notes', 'Left.md'), '---\nrelated:\n  - "[[Notes/Right]]"\n---\n# Left\n\n[[Notes/Right]]\n');
  await writeFile(join(vault, 'Notes', 'Right.md'), '# Right\n\n[[Notes/Left]]\n');
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'review-route-owner', modelId: 'codex', password: 'review-route-password' });
    const accessToken = registration.value.accessToken;
    const packet = await callJson(client, 'call_endpoint', { endpointId: 'wiki.review_packet', arguments: { limit: 10, maxChars: 12000, accessToken } });
    expect(packet.value.priorities).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Notes/Left.md', reason: 'typed_relation_reciprocity_missing', suggestedTool: 'wiki.reciprocal_link' }),
    ]));
    expect(packet.value.curationPlan).toMatchObject({
      selected: { path: 'Notes/Left.md', reason: 'typed_relation_reciprocity_missing' },
      then: { endpointId: 'wiki.reciprocal_link', arguments: { leftPath: 'Notes/Left.md', rightPath: 'Notes/Right.md', relation: 'related' } },
    });
  } finally { await client.close(); await server.close(); }
});

test('hierarchy-change previews repair MOC and focus parents while blocking cycles and downward horizons', async () => {
  await mkdir(join(vault, 'Knowledge', 'MOCs'), { recursive: true });
  await mkdir(join(vault, 'Goals'), { recursive: true });
  await mkdir(join(vault, 'Projects'), { recursive: true });
  await writeFile(join(vault, 'Knowledge', 'MOCs', 'Root.md'), '---\nllm_wiki_type: knowledge\nnote_kind: moc\n---\n# Root\n[[Knowledge/MOCs/Child]]\n');
  await writeFile(join(vault, 'Knowledge', 'MOCs', 'Child.md'), '---\nllm_wiki_type: knowledge\nnote_kind: moc\nmoc_parent: "[[Missing MOC]]"\n---\n# Child\n');
  await writeFile(join(vault, 'Goals', 'Goal.md'), '---\nllm_wiki_type: knowledge\nnote_kind: knowledge\nfocus_horizon: goal\n---\n# Goal\n');
  await writeFile(join(vault, 'Projects', 'Project.md'), '---\nllm_wiki_type: knowledge\nnote_kind: project\nfocus_horizon: project\n---\n# Project\n');
  await writeFile(join(vault, 'Projects', 'Peer.md'), '---\nllm_wiki_type: knowledge\nnote_kind: project\nfocus_horizon: project\n---\n# Peer\n');
  await writeFile(join(vault, 'Projects', 'Wrong.md'), '---\nllm_wiki_type: knowledge\nnote_kind: project\nfocus_horizon: project\nfocus_parent: "[[Projects/Peer]]"\n---\n# Wrong\n');
  await mkdir(join(vault, '_wiki'), { recursive: true });
  await writeFile(join(vault, '_wiki', 'Forged Goal MOC.md'), '---\nllm_wiki_type: knowledge\nnote_kind: moc\nfocus_horizon: goal\n---\n# Forged Goal MOC\n');
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'hierarchy-owner', modelId: 'codex', password: 'hierarchy-owner-password' });
    const accessToken = registration.value.accessToken;
    const discovery = await callJson(client, 'search_capabilities', { query: 'hierarchy', limit: 8, maxChars: 9000, accessToken });
    expect(discovery.value.endpoints).toEqual(expect.arrayContaining([expect.objectContaining({ endpointId: 'wiki.hierarchy_change', method: 'POST' })]));

    const mocPlan = await callJson(client, 'call_endpoint', { endpointId: 'wiki.hierarchy_change', arguments: {
      hierarchy: 'moc', operation: 'set', childPath: 'Knowledge/MOCs/Child.md', parentPath: 'Knowledge/MOCs/Root.md', accessToken,
    } });
    expect(mocPlan.value).toMatchObject({ valid: true, afterState: 'nested', alreadyApplied: false, changes: [expect.objectContaining({ path: 'Knowledge/MOCs/Child.md', frontmatter: { set: { moc_parent: '[[Knowledge/MOCs/Root]]' } } })], nextAction: { endpointId: 'notes.change_set' } });
    const mocDryRun = await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: { changes: mocPlan.value.changes, dryRun: true, accessToken } });
    await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: { changes: mocPlan.value.changes, dryRun: false, confirmPlanFingerprint: mocDryRun.value.planFingerprint, accessToken } });
    const mocConfirmed = await callJson(client, 'call_endpoint', { endpointId: 'wiki.hierarchy_change', arguments: {
      hierarchy: 'moc', operation: 'set', childPath: 'Knowledge/MOCs/Child.md', parentPath: 'Knowledge/MOCs/Root.md', accessToken,
    } });
    expect(mocConfirmed.value).toMatchObject({ valid: true, alreadyApplied: true, changes: [] });
    const mocClear = await callJson(client, 'call_endpoint', { endpointId: 'wiki.hierarchy_change', arguments: {
      hierarchy: 'moc', operation: 'clear', childPath: 'Knowledge/MOCs/Child.md', accessToken,
    } });
    expect(mocClear.value).toMatchObject({ valid: true, afterState: 'root', changes: [expect.objectContaining({ frontmatter: { remove: ['moc_parent'] } })] });
    const mocCycle = await callJson(client, 'call_endpoint', { endpointId: 'wiki.hierarchy_change', arguments: {
      hierarchy: 'moc', operation: 'set', childPath: 'Knowledge/MOCs/Root.md', parentPath: 'Knowledge/MOCs/Child.md', accessToken,
    } });
    expect(mocCycle.value).toMatchObject({ valid: false, changes: [], blockers: expect.arrayContaining([expect.objectContaining({ reason: expect.stringMatching(/cycle|valid nested branch/) })]) });
    const reservedMoc = await callJson(client, 'call_endpoint', { endpointId: 'wiki.hierarchy_change', arguments: {
      hierarchy: 'moc', operation: 'set', childPath: 'Knowledge/MOCs/Child.md', parentPath: '_wiki/Forged Goal MOC.md', accessToken,
    } });
    expect(reservedMoc.value).toMatchObject({ valid: false, changes: [], blockers: expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining('Reserved _wiki') })]) });

    const focusPlan = await callJson(client, 'call_endpoint', { endpointId: 'wiki.hierarchy_change', arguments: {
      hierarchy: 'focus', operation: 'set', childPath: 'Projects/Project.md', parentPath: 'Goals/Goal.md', accessToken,
    } });
    expect(focusPlan.value).toMatchObject({ valid: true, afterState: 'nested', changes: [expect.objectContaining({ frontmatter: { set: { focus_parent: '[[Goals/Goal]]' } } })] });
    const downward = await callJson(client, 'call_endpoint', { endpointId: 'wiki.hierarchy_change', arguments: {
      hierarchy: 'focus', operation: 'set', childPath: 'Goals/Goal.md', parentPath: 'Projects/Project.md', accessToken,
    } });
    expect(downward.value).toMatchObject({ valid: false, changes: [], blockers: expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining('higher horizon') })]) });
    const reservedFocus = await callJson(client, 'call_endpoint', { endpointId: 'wiki.hierarchy_change', arguments: {
      hierarchy: 'focus', operation: 'set', childPath: 'Projects/Project.md', parentPath: '_wiki/Forged Goal MOC.md', accessToken,
    } });
    expect(reservedFocus.value).toMatchObject({ valid: false, changes: [], blockers: expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining('Reserved _wiki') })]) });
    const graph = await callJson(client, 'call_endpoint', { endpointId: 'wiki.graph_health', arguments: { limit: 20, maxChars: 14000, accessToken } });
    expect(graph.value.focusHealth.horizonMismatches.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Projects/Wrong.md', target: 'Projects/Peer.md', reason: 'focus_parent_must_point_to_higher_horizon', repair: expect.objectContaining({ endpointId: 'wiki.hierarchy_change' }) }),
    ]));
    expect(graph.value.focusHealth).toMatchObject({ declaredParentEdges: 1, parentEdges: 0 });
    expect(graph.value.focusHealth.reverseMap.items.find((item: any) => item.path === 'Projects/Peer.md')?.children || []).not.toContain('Projects/Wrong.md');
  } finally { await client.close(); await server.close(); }
});

test('MOC-membership previews validate real maps and replace canonical navigation Properties', async () => {
  await mkdir(join(vault, 'Knowledge', 'MOCs'), { recursive: true });
  await mkdir(join(vault, 'Knowledge'), { recursive: true });
  await writeFile(join(vault, 'Knowledge', 'MOCs', 'Primary.md'), '---\nllm_wiki_type: knowledge\nnote_kind: moc\n---\n# Primary\n[[Knowledge/Note]]\n');
  await writeFile(join(vault, 'Knowledge', 'MOCs', 'Context.md'), '---\nllm_wiki_type: knowledge\nnote_kind: moc\n---\n# Context\n[[Knowledge/Note]]\n');
  await writeFile(join(vault, 'Knowledge', 'Not a MOC.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\n---\n# Not a MOC\n');
  await writeFile(join(vault, 'Knowledge', 'Note.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nmoc: "[[Legacy Map]]"\n---\n# Note\n');
  await mkdir(join(vault, '_wiki'), { recursive: true });
  await writeFile(join(vault, '_wiki', 'Forged MOC.md'), '---\nllm_wiki_type: knowledge\nnote_kind: moc\n---\n# Forged MOC\n');
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'membership-owner', modelId: 'codex', password: 'membership-owner-password' });
    const accessToken = registration.value.accessToken;
    const plan = await callJson(client, 'call_endpoint', { endpointId: 'wiki.moc_membership', arguments: {
      notePath: 'Knowledge/Note.md', primaryMocPath: 'Knowledge/MOCs/Primary.md', additionalMocPaths: ['Knowledge/MOCs/Context.md'], accessToken,
    } });
    expect(plan.value).toMatchObject({
      valid: true,
      primaryMoc: { link: '[[Knowledge/MOCs/Primary]]' },
      additionalMocs: [{ link: '[[Knowledge/MOCs/Context]]' }],
      changes: [expect.objectContaining({ frontmatter: { set: { primary_moc: '[[Knowledge/MOCs/Primary]]', mocs: ['[[Knowledge/MOCs/Context]]'] } } })],
      warnings: [expect.objectContaining({ reason: expect.stringContaining('Legacy moc is preserved') })],
    });
    const dryRun = await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: { changes: plan.value.changes, dryRun: true, accessToken } });
    await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: { changes: plan.value.changes, dryRun: false, confirmPlanFingerprint: dryRun.value.planFingerprint, accessToken } });
    const confirmed = await callJson(client, 'call_endpoint', { endpointId: 'wiki.moc_membership', arguments: {
      notePath: 'Knowledge/Note.md', primaryMocPath: 'Knowledge/MOCs/Primary.md', additionalMocPaths: ['Knowledge/MOCs/Context.md'], accessToken,
    } });
    expect(confirmed.value).toMatchObject({ valid: true, alreadyApplied: true, changes: [] });
    const removeContext = await callJson(client, 'call_endpoint', { endpointId: 'wiki.moc_membership', arguments: {
      notePath: 'Knowledge/Note.md', primaryMocPath: 'Knowledge/MOCs/Primary.md', additionalMocPaths: [], accessToken,
    } });
    expect(removeContext.value).toMatchObject({ valid: true, changes: [expect.objectContaining({ frontmatter: { set: { primary_moc: '[[Knowledge/MOCs/Primary]]' }, remove: ['mocs'] } })] });
    const wrongKind = await callJson(client, 'call_endpoint', { endpointId: 'wiki.moc_membership', arguments: {
      notePath: 'Knowledge/Note.md', primaryMocPath: 'Knowledge/Not a MOC.md', accessToken,
    } });
    expect(wrongKind.value).toMatchObject({ valid: false, changes: [], blockers: [expect.objectContaining({ reason: expect.stringContaining('note_kind: moc') })] });
    const reserved = await callJson(client, 'call_endpoint', { endpointId: 'wiki.moc_membership', arguments: {
      notePath: 'Knowledge/Note.md', primaryMocPath: '_wiki/Forged MOC.md', accessToken,
    } });
    expect(reserved.value).toMatchObject({ valid: false, changes: [], blockers: expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining('Reserved _wiki') })]) });
    const privateMoc = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'notes.write', arguments: {
      path: 'scope://model/codex/Private MOC.md', content: '# Private MOC\n', frontmatter: { note_kind: 'moc' }, expectedRevision: 'missing', accessToken,
    } } });
    expect(privateMoc.isError).toBeFalsy();
    const scopeBlocked = await callJson(client, 'call_endpoint', { endpointId: 'wiki.moc_membership', arguments: {
      notePath: 'Knowledge/Note.md', primaryMocPath: 'scope://model/codex/Private MOC.md', accessToken,
    } });
    expect(scopeBlocked.value).toMatchObject({ valid: false, changes: [], blockers: [expect.objectContaining({ reason: expect.stringContaining('privacy boundary') })] });
  } finally { await client.close(); await server.close(); }
});

test('relation-set previews replace complete directional and focus-support sets with graph repair routes', async () => {
  await mkdir(join(vault, 'Knowledge'), { recursive: true });
  await mkdir(join(vault, 'Projects'), { recursive: true });
  await mkdir(join(vault, 'Goals'), { recursive: true });
  await writeFile(join(vault, 'Knowledge', 'Answer.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nanswers_questions:\n  - "[[Missing Question]]"\n---\n# Answer\n');
  await writeFile(join(vault, 'Knowledge', 'Question.md'), '---\nllm_wiki_type: knowledge\nnote_kind: question\nepistemic_status: open\n---\n# Question\n');
  await writeFile(join(vault, 'Knowledge', 'Not Question.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\n---\n# Not Question\n');
  await writeFile(join(vault, 'Knowledge', 'Map.md'), '---\nllm_wiki_type: knowledge\nnote_kind: moc\n---\n# Map\n\n[[Knowledge/Answer]]\n');
  await writeFile(join(vault, 'Projects', 'Project.md'), '---\nllm_wiki_type: knowledge\nnote_kind: project\nfocus_horizon: project\nfocus_supports:\n  - "[[Projects/Peer]]"\n---\n# Project\n');
  await writeFile(join(vault, 'Projects', 'Peer.md'), '---\nllm_wiki_type: knowledge\nnote_kind: project\nfocus_horizon: project\n---\n# Peer\n');
  await writeFile(join(vault, 'Goals', 'Goal.md'), '---\nllm_wiki_type: knowledge\nnote_kind: knowledge\nfocus_horizon: goal\n---\n# Goal\n');
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'relation-set-owner', modelId: 'codex', password: 'relation-set-owner-password' });
    const accessToken = registration.value.accessToken;
    const discovery = await callJson(client, 'search_capabilities', { query: 'replace complete typed relation broken ambiguous link focus supports', limit: 8, maxChars: 9000, accessToken });
    expect(discovery.value.endpoints).toEqual(expect.arrayContaining([expect.objectContaining({ endpointId: 'wiki.relation_set', method: 'POST' })]));
    const graph = await callJson(client, 'call_endpoint', { endpointId: 'wiki.graph_health', arguments: { limit: 20, maxChars: 14000, accessToken } });
    expect(graph.value.typedRelations.unresolved.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Answer.md', relation: 'answers_questions', repair: expect.objectContaining({ endpointId: 'wiki.relation_set' }) }),
    ]));
    expect(graph.value.focusHealth.horizonMismatches.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Projects/Project.md', field: 'focus_supports', repair: expect.objectContaining({ endpointId: 'wiki.relation_set' }) }),
    ]));
    const review = await callJson(client, 'call_endpoint', { endpointId: 'wiki.review_packet', arguments: { limit: 10, maxChars: 14000, accessToken } });
    expect(review.value.curationPlan.then).toMatchObject({ endpointId: 'wiki.relation_set', arguments: expect.objectContaining({ relation: 'focus_supports' }) });

    const plan = await callJson(client, 'call_endpoint', { endpointId: 'wiki.relation_set', arguments: {
      sourcePath: 'Knowledge/Answer.md', relation: 'answers_questions', targetPaths: ['Knowledge/Question.md'], accessToken,
    } });
    expect(plan.value).toMatchObject({ valid: true, alreadyApplied: false, relation: 'answers_questions', desired: { count: 1 }, changes: [expect.objectContaining({ path: 'Knowledge/Answer.md', frontmatter: { set: { answers_questions: ['[[Knowledge/Question]]'] } } })], nextAction: { endpointId: 'notes.change_set' } });
    const dryRun = await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: { changes: plan.value.changes, dryRun: true, accessToken } });
    await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: { changes: plan.value.changes, dryRun: false, confirmPlanFingerprint: dryRun.value.planFingerprint, accessToken } });
    const confirmed = await callJson(client, 'call_endpoint', { endpointId: 'wiki.relation_set', arguments: {
      sourcePath: 'Knowledge/Answer.md', relation: 'answers_questions', targetPaths: ['Knowledge/Question.md'], accessToken,
    } });
    expect(confirmed.value).toMatchObject({ valid: true, alreadyApplied: true, changes: [] });
    const clear = await callJson(client, 'call_endpoint', { endpointId: 'wiki.relation_set', arguments: {
      sourcePath: 'Knowledge/Answer.md', relation: 'answers_questions', targetPaths: [], accessToken,
    } });
    expect(clear.value).toMatchObject({ valid: true, desired: { count: 0 }, changes: [expect.objectContaining({ frontmatter: { remove: ['answers_questions'] } })] });
    const maintenance = await callJson(client, 'call_endpoint', { endpointId: 'wiki.maintenance_debt', arguments: { limit: 20, maxChars: 14000, accessToken } });
    expect(maintenance.value.items.find((item: any) => item.path === 'Knowledge/Answer.md')?.curationPlan?.then).toMatchObject({ endpointId: 'wiki.moc_membership', arguments: { notePath: 'Knowledge/Answer.md' } });

    const wrongKind = await callJson(client, 'call_endpoint', { endpointId: 'wiki.relation_set', arguments: {
      sourcePath: 'Knowledge/Answer.md', relation: 'answers_questions', targetPaths: ['Knowledge/Not Question.md'], accessToken,
    } });
    expect(wrongKind.value).toMatchObject({ valid: false, changes: [], blockers: expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining('note_kind: question') })]) });
    const focusPlan = await callJson(client, 'call_endpoint', { endpointId: 'wiki.relation_set', arguments: {
      sourcePath: 'Projects/Project.md', relation: 'focus_supports', targetPaths: ['Goals/Goal.md'], accessToken,
    } });
    expect(focusPlan.value).toMatchObject({ valid: true, changes: [expect.objectContaining({ frontmatter: { set: { focus_supports: ['[[Goals/Goal]]'] } } })] });
    const horizontalFocus = await callJson(client, 'call_endpoint', { endpointId: 'wiki.relation_set', arguments: {
      sourcePath: 'Projects/Project.md', relation: 'focus_supports', targetPaths: ['Projects/Peer.md'], accessToken,
    } });
    expect(horizontalFocus.value).toMatchObject({ valid: false, changes: [], blockers: expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining('higher horizon') })]) });

    const privateTarget = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'notes.write', arguments: {
      path: 'scope://model/codex/Private question.md', content: '# Private question\n', frontmatter: { note_kind: 'question' }, expectedRevision: 'missing', accessToken,
    } } });
    expect(privateTarget.isError).toBeFalsy();
    const scopeBlocked = await callJson(client, 'call_endpoint', { endpointId: 'wiki.relation_set', arguments: {
      sourcePath: 'Knowledge/Answer.md', relation: 'answers_questions', targetPaths: ['scope://model/codex/Private question.md'], accessToken,
    } });
    expect(scopeBlocked.value).toMatchObject({ valid: false, changes: [], blockers: expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining('privacy boundary') })]) });
    const reciprocal = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.relation_set', arguments: {
      sourcePath: 'Knowledge/Answer.md', relation: 'related', targetPaths: ['Knowledge/Question.md'], accessToken,
    } } });
    expect(reciprocal.isError).toBe(true);
    expect(String((reciprocal.content as any)[0].text)).toContain('wiki.reciprocal_link');
  } finally { await client.close(); await server.close(); }
});

test('lifecycle transition planner keeps retirement and reactivation metadata coherent', async () => {
  await mkdir(join(vault, 'Knowledge'), { recursive: true });
  await writeFile(join(vault, 'Knowledge', 'Old.md'), [
    '---', 'llm_wiki_type: knowledge', 'note_kind: atomic', 'lifecycle: evergreen', 'knowledge_status: verified', '---',
    '# Old', '', 'Useful historical content.',
  ].join('\n'));
  await writeFile(join(vault, 'Knowledge', 'New.md'), [
    '---', 'llm_wiki_type: knowledge', 'note_kind: atomic', 'lifecycle: evergreen', 'knowledge_status: verified', '---',
    '# New', '', 'Corrected current content.',
  ].join('\n'));
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'lifecycle-owner', modelId: 'codex', password: 'lifecycle-owner-password' });
    const accessToken = registration.value.accessToken;
    const discovery = await callJson(client, 'search_capabilities', { query: 'archive supersede tombstone reactivate lifecycle retention', limit: 5, maxChars: 8000, accessToken });
    expect(discovery.value.endpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ endpointId: 'wiki.lifecycle_transition', method: 'POST', available: true }),
    ]));

    const oldBefore = await callJson(client, 'read_note', { path: 'Knowledge/Old.md', accessToken });
    const archive = await callJson(client, 'call_endpoint', { endpointId: 'wiki.lifecycle_transition', arguments: {
      path: 'Knowledge/Old.md', operation: 'archive', reason: 'The project ended.', accessToken,
    } });
    expect(archive.value).toMatchObject({
      valid: true, operation: 'archive', changes: [expect.objectContaining({
        path: 'Knowledge/Old.md', expectedRevision: oldBefore.value.revision,
        frontmatter: { set: expect.objectContaining({
          lifecycle: 'archived', retention_policy: 'archive', retention_event: 'manual',
          archive_reason: 'The project ended.', retention_reason: 'The project ended.',
        }) },
      })],
      nextAction: { endpointId: 'notes.change_set' },
    });
    const stillCurrent = await callJson(client, 'read_note', { path: 'Knowledge/Old.md', accessToken });
    expect(stillCurrent.value.fm.lifecycle).toBe('evergreen');
    expect(stillCurrent.value.revision).toBe(oldBefore.value.revision);

    const supersede = await callJson(client, 'call_endpoint', { endpointId: 'wiki.lifecycle_transition', arguments: {
      path: 'Knowledge/Old.md', operation: 'supersede', replacementPath: 'Knowledge/New.md', reason: 'A corrected note replaces it.', accessToken,
    } });
    expect(supersede.value).toMatchObject({
      valid: true, operation: 'supersede', replacement: { path: 'Knowledge/New.md' },
      changes: [
        expect.objectContaining({ path: 'Knowledge/Old.md', frontmatter: { set: expect.objectContaining({
          lifecycle: 'superseded', knowledge_status: 'superseded', retention_policy: 'preserve',
          retention_event: 'superseded', retention_reason: 'A corrected note replaces it.', replaced_by: '[[Knowledge/New]]',
        }) } }),
        expect.objectContaining({ path: 'Knowledge/New.md', frontmatter: { set: { supersedes: ['[[Knowledge/Old]]'] } } }),
      ],
    });
    const dryRun = await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: { changes: supersede.value.changes, dryRun: true, accessToken } });
    await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: {
      changes: supersede.value.changes, dryRun: false, confirmPlanFingerprint: dryRun.value.planFingerprint, accessToken,
    } });
    const repeated = await callJson(client, 'call_endpoint', { endpointId: 'wiki.lifecycle_transition', arguments: {
      path: 'Knowledge/Old.md', operation: 'supersede', replacementPath: 'Knowledge/New.md', reason: 'A corrected note replaces it.', accessToken,
    } });
    expect(repeated.value).toMatchObject({ valid: true, alreadyApplied: true, changes: [] });

    const reactivate = await callJson(client, 'call_endpoint', { endpointId: 'wiki.lifecycle_transition', arguments: {
      path: 'Knowledge/Old.md', operation: 'reactivate', replacementPath: 'Knowledge/New.md', targetLifecycle: 'review',
      nextKnowledgeStatus: 'draft', reason: 'New evidence reopens the older note.', accessToken,
    } });
    expect(reactivate.value).toMatchObject({
      valid: true, operation: 'reactivate', changes: [
        expect.objectContaining({ path: 'Knowledge/Old.md', frontmatter: { set: { lifecycle: 'review', knowledge_status: 'draft' }, remove: expect.arrayContaining(['replaced_by', 'retention_policy', 'retention_event', 'retention_reason']) } }),
        expect.objectContaining({ path: 'Knowledge/New.md', frontmatter: { remove: ['supersedes'] } }),
      ],
    });
    const reactivateDryRun = await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: { changes: reactivate.value.changes, dryRun: true, accessToken } });
    await callJson(client, 'call_endpoint', { endpointId: 'notes.change_set', arguments: {
      changes: reactivate.value.changes, dryRun: false, confirmPlanFingerprint: reactivateDryRun.value.planFingerprint, accessToken,
    } });
    const repeatedReactivation = await callJson(client, 'call_endpoint', { endpointId: 'wiki.lifecycle_transition', arguments: {
      path: 'Knowledge/Old.md', operation: 'reactivate', replacementPath: 'Knowledge/New.md', targetLifecycle: 'review',
      nextKnowledgeStatus: 'draft', reason: 'New evidence reopens the older note.', accessToken,
    } });
    expect(repeatedReactivation.value).toMatchObject({ valid: true, alreadyApplied: true, changes: [], blockers: [] });
  } finally { await client.close(); await server.close(); }
});

test('lifecycle transition planner blocks preservation and unsafe lineage without leaking hidden paths', async () => {
  await mkdir(join(vault, 'Knowledge'), { recursive: true });
  await mkdir(join(vault, '_scopes', 'models', 'claude'), { recursive: true });
  await writeFile(join(vault, 'Knowledge', 'Held.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: evergreen\nlegal_hold: true\n---\n# Held\n');
  await writeFile(join(vault, 'Knowledge', 'Protected.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: evergreen\npreserve_until: 2999-01-01\n---\n# Protected\n');
  await writeFile(join(vault, 'Knowledge', 'Tomb.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: evergreen\nknowledge_status: disputed\n---\n# Tomb\n');
  await writeFile(join(vault, 'Knowledge', 'Hidden impact.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: evergreen\n---\n# Hidden impact\n');
  await writeFile(join(vault, '_scopes', 'models', 'claude', 'Secret.md'), '# Secret\n\n[[Knowledge/Hidden impact]]\n');
  await writeFile(join(vault, 'Knowledge', 'Malformed successor.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: evergreen\nsupersedes: broken\n---\n# Successor\n');
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'lifecycle-guard-owner', modelId: 'codex', password: 'lifecycle-guard-password' });
    const accessToken = registration.value.accessToken;
    for (const [path, reason] of [['Knowledge/Held.md', 'legal hold'], ['Knowledge/Protected.md', 'preserve_until']] as const) {
      const result = await callJson(client, 'call_endpoint', { endpointId: 'wiki.lifecycle_transition', arguments: {
        path, operation: 'archive', reason: 'Attempted retirement.', accessToken,
      } });
      expect(result.value).toMatchObject({ valid: false, changes: [], blockers: expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining(reason) })]) });
    }
    const malformed = await callJson(client, 'call_endpoint', { endpointId: 'wiki.lifecycle_transition', arguments: {
      path: 'Knowledge/Protected.md', operation: 'supersede', replacementPath: 'Knowledge/Malformed successor.md',
      reason: 'Attempted replacement.', accessToken,
    } });
    expect(malformed.value).toMatchObject({ valid: false, changes: [] });
    expect(malformed.value.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: expect.stringContaining('supersedes') }),
    ]));

    const tombstone = await callJson(client, 'call_endpoint', { endpointId: 'wiki.lifecycle_transition', arguments: {
      path: 'Knowledge/Tomb.md', operation: 'tombstone', reason: 'Keep only a visible retirement marker.', accessToken,
    } });
    expect(tombstone.value).toMatchObject({ valid: true, changes: [expect.objectContaining({
      path: 'Knowledge/Tomb.md', frontmatter: { set: expect.objectContaining({
        lifecycle: 'archived', retention_policy: 'tombstone',
        retention_event: 'manual', archive_reason: 'Keep only a visible retirement marker.',
        retention_reason: 'Keep only a visible retirement marker.',
      }) },
    })] });
    expect(tombstone.value.changes[0].frontmatter.set).not.toHaveProperty('knowledge_status');

    const hiddenImpact = await callJson(client, 'call_endpoint', { endpointId: 'wiki.lifecycle_transition', arguments: {
      path: 'Knowledge/Hidden impact.md', operation: 'archive', reason: 'Retire after review.', accessToken,
    } });
    expect(hiddenImpact.value).toMatchObject({
      valid: true, changes: [expect.objectContaining({ path: 'Knowledge/Hidden impact.md' })],
      referenceImpact: { hiddenReferencesPresent: true }, blockers: [],
      warnings: expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining('inaccessible scope') })]),
    });
    expect(JSON.stringify(hiddenImpact.value)).not.toContain('Secret.md');

    const heldRead = await callJson(client, 'read_note', { path: 'Knowledge/Held.md', accessToken });
    const clearHold = await client.callTool({ name: 'triage_wiki_note', arguments: {
      path: 'Knowledge/Held.md', legalHold: false, expectedRevision: heldRead.value.revision, accessToken,
    } });
    expect(clearHold.isError).toBe(true);
    expect(String((clearHold.content as any)[0].text)).toContain('server host');
    const protectedRead = await callJson(client, 'read_note', { path: 'Knowledge/Protected.md', accessToken });
    const shortenPreservation = await client.callTool({ name: 'triage_wiki_note', arguments: {
      path: 'Knowledge/Protected.md', preserveUntil: '2025-01-01', expectedRevision: protectedRead.value.revision, accessToken,
    } });
    expect(shortenPreservation.isError).toBe(true);
    expect(String((shortenPreservation.content as any)[0].text)).toContain('server host');
    const direct = await client.callTool({ name: 'triage_wiki_note', arguments: {
      path: 'Knowledge/Held.md', lifecycle: 'archived', archiveReason: 'Bypass.', retentionPolicy: 'archive', retentionReason: 'Bypass.',
      expectedRevision: heldRead.value.revision, accessToken,
    } });
    expect(direct.isError).toBe(true);
    expect(String((direct.content as any)[0].text)).toContain('wiki.lifecycle_transition');
    const reviewed = await client.callTool({ name: 'review_wiki_note', arguments: {
      path: 'Knowledge/Held.md', reviewOutcome: 'superseded', reviewedBy: 'codex', nextLifecycle: 'superseded',
      expectedRevision: heldRead.value.revision, accessToken,
    } });
    expect(reviewed.isError).toBe(true);
    expect(String((reviewed.content as any)[0].text)).toContain('wiki.lifecycle_transition');
  } finally { await client.close(); await server.close(); }
});

test('lifecycle transition closes writer bypasses, resolves scoped successors, and hides moderated metadata', async () => {
  await mkdir(join(vault, 'Knowledge'), { recursive: true });
  await mkdir(join(vault, 'Community', 'Posts'), { recursive: true });
  await mkdir(join(vault, '_wiki'), { recursive: true });
  await mkdir(join(vault, '_scopes', 'models', 'codex'), { recursive: true });
  const active = (title: string, extra = '') => ['---', 'llm_wiki_type: knowledge', 'note_kind: atomic', 'lifecycle: evergreen', 'knowledge_status: verified', extra, '---', `# ${title}`, ''].filter(Boolean).join('\n');
  await writeFile(join(vault, 'Knowledge', 'Retired.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: superseded\nknowledge_status: superseded\nretention_policy: preserve\nretention_event: superseded\nretention_reason: Replaced.\nreplaced_by: "[[Knowledge/Successor]]"\n---\n# Retired\n');
  await writeFile(join(vault, 'Knowledge', 'Successor.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: evergreen\nknowledge_status: verified\nsupersedes:\n  - "[[Knowledge/Retired]]"\n---\n# Successor\n');
  await writeFile(join(vault, 'Knowledge', 'Visible source.md'), active('Visible source'));
  await writeFile(join(vault, 'Knowledge', 'Hidden source.md'), active('Hidden source', 'moderation_status: quarantined'));
  await writeFile(join(vault, 'Knowledge', 'Hidden successor.md'), active('Hidden successor', 'moderation_status: quarantined'));
  for (let index = 1; index <= 4; index += 1) {
    await writeFile(join(vault, 'Knowledge', `Reference ${index}.md`), `# Reference ${index}\n\n${'before '.repeat(70)}[[Knowledge/Visible source]]${' after'.repeat(70)}\n`);
  }
  await writeFile(join(vault, 'Community', 'Posts', 'Managed.md'), active('Managed community record'));
  await writeFile(join(vault, '_wiki', 'Control.md'), active('Control record'));
  await writeFile(join(vault, '_scopes', 'models', 'codex', 'Old.md'), active('Scoped old'));
  await writeFile(join(vault, '_scopes', 'models', 'codex', 'New.md'), active('Scoped new'));
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'lifecycle-bypass-owner', modelId: 'codex', password: 'lifecycle-bypass-password' });
    const accessToken = registration.value.accessToken;
    const retired = await callJson(client, 'read_note', { path: 'Knowledge/Retired.md', accessToken });
    for (const [name, arguments_] of [
      ['triage_wiki_note', { path: 'Knowledge/Retired.md', lifecycle: 'evergreen', expectedRevision: retired.value.revision, accessToken }],
      ['review_wiki_note', { path: 'Knowledge/Retired.md', reviewOutcome: 'confirmed', nextLifecycle: 'evergreen', expectedRevision: retired.value.revision, accessToken }],
    ] as const) {
      const result = await client.callTool({ name, arguments: arguments_ });
      expect(result.isError).toBe(true);
      expect(String((result.content as any)[0].text)).toContain('wiki.lifecycle_transition');
    }

    const source = await callJson(client, 'ingest_source', {
      sourceId: 'lifecycle-bypass-evidence', title: 'Lifecycle evidence', content: 'Retirement must be coherent.', capturedBy: 'codex', accessToken,
    });
    const publishBypass = await client.callTool({ name: 'publish_knowledge', arguments: {
      path: 'Knowledge/Published retired.md', content: '# Published retired\n', evidencePaths: [source.value.path], author: 'codex',
      status: 'superseded', lifecycle: 'superseded', replacedBy: '[[Knowledge/Successor]]', retentionPolicy: 'preserve',
      retentionReason: 'Bypass.', expectedRevision: 'missing', accessToken,
    } });
    expect(publishBypass.isError).toBe(true);
    expect(String((publishBypass.content as any)[0].text)).toContain('wiki.lifecycle_transition');

    const scoped = await callJson(client, 'call_endpoint', { endpointId: 'wiki.lifecycle_transition', arguments: {
      path: 'scope://model/codex/Old.md', operation: 'supersede', replacementPath: 'scope://model/codex/New.md', reason: 'Scoped successor.', accessToken,
    } });
    expect(scoped.value).toMatchObject({
      valid: true, source: { path: 'scope://model/codex/Old.md' }, replacement: { path: 'scope://model/codex/New.md' },
      changes: [expect.objectContaining({ path: 'scope://model/codex/Old.md' }), expect.objectContaining({ path: 'scope://model/codex/New.md' })],
    });

    const boundedFailure = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.lifecycle_transition', arguments: {
      path: 'Knowledge/Visible source.md', operation: 'archive', reason: 'x'.repeat(1000), maxChars: 4096, accessToken,
    } } });
    expect(boundedFailure.isError).toBe(true);
    expect(String((boundedFailure.content as any)[0].text)).toContain('maxChars');

    const stalePlan = await callJson(client, 'call_endpoint', { endpointId: 'wiki.lifecycle_transition', arguments: {
      path: 'Knowledge/Visible source.md', operation: 'archive', reason: 'Concurrency check.', accessToken,
    } });
    const visibleBefore = await callJson(client, 'read_note', { path: 'Knowledge/Visible source.md', accessToken });
    const concurrentEdit = await client.callTool({ name: 'update_frontmatter', arguments: {
      path: 'Knowledge/Visible source.md', frontmatter: { concurrency_marker: true }, expectedRevision: visibleBefore.value.revision, accessToken,
    } });
    expect(concurrentEdit.isError).toBeFalsy();
    const staleApply = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'notes.change_set', arguments: {
      changes: stalePlan.value.changes, dryRun: true, accessToken,
    } } });
    expect(staleApply.isError).toBe(true);
    expect(String((staleApply.content as any)[0].text)).toMatch(/revision|changed/i);

    const hiddenSource = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.lifecycle_transition', arguments: {
      path: 'Knowledge/Hidden source.md', operation: 'archive', reason: 'Hidden source.', accessToken,
    } } });
    expect(hiddenSource.isError).toBe(true);
    expect(String((hiddenSource.content as any)[0].text)).not.toMatch(/revision|lifecycle|knowledgeStatus/);

    const hiddenReplacement = await callJson(client, 'call_endpoint', { endpointId: 'wiki.lifecycle_transition', arguments: {
      path: 'Knowledge/Visible source.md', operation: 'supersede', replacementPath: 'Knowledge/Hidden successor.md', reason: 'Hidden successor.', accessToken,
    } });
    expect(hiddenReplacement.value).toMatchObject({ valid: false, changes: [] });
    expect(hiddenReplacement.value).not.toHaveProperty('replacement');
    expect(JSON.stringify(hiddenReplacement.value)).not.toMatch(/Hidden successor.*revision|hasReverseSupersedes/);

    const selfReplacement = await callJson(client, 'call_endpoint', { endpointId: 'wiki.lifecycle_transition', arguments: {
      path: 'Knowledge/Visible source.md', operation: 'supersede', replacementPath: 'Knowledge/Visible source.md', reason: 'Invalid self replacement.', accessToken,
    } });
    expect(selfReplacement.value).toMatchObject({ valid: false, changes: [], blockers: expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining('itself') })]) });

    const managedCommunity = await callJson(client, 'call_endpoint', { endpointId: 'wiki.lifecycle_transition', arguments: {
      path: 'Community/Posts/Managed.md', operation: 'archive', reason: 'Wrong endpoint.', accessToken,
    } });
    expect(managedCommunity.value).toMatchObject({ valid: false, changes: [], blockers: expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining('dedicated endpoint') })]) });

    const controlRecord = await callJson(client, 'call_endpoint', { endpointId: 'wiki.lifecycle_transition', arguments: {
      path: '_wiki/Control.md', operation: 'archive', reason: 'Wrong target.', accessToken,
    } });
    expect(controlRecord.value).toMatchObject({ valid: false, changes: [], blockers: expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining('Reserved _wiki') })]) });
  } finally { await client.close(); await server.close(); }
});

async function setup() {
  const server = createServer(vault, { version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'llm-wiki-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { server, client };
}

async function callJson(client: Client, name: string, arguments_: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: arguments_ });
  return { result, value: JSON.parse((result.content as any)[0].text) };
}

test('recognizes a manually maintained public schema without frontmatter', async () => {
  const { server, client } = await setup();
  try {
    await mkdir(join(vault, '_wiki'), { recursive: true });
    await writeFile(join(vault, '_wiki', 'SCHEMA.md'), '# LLM Wiki schema\n\nPlain Markdown remains a valid public schema.\n');

    const catalog = await callJson(client, 'get_wiki_catalog', {});
    expect(catalog.value).toMatchObject({ counts: { schema: 1 }, total: 1, schemaPresent: true });

    const orientation = await callJson(client, 'orient_wiki', { maxChars: 6000 });
    expect(orientation.value.publicOnboarding).toMatchObject({
      schemaPath: '_wiki/SCHEMA.md',
      readableWithoutLogin: true,
    });
    expect(orientation.value.nextActions).toEqual([
      expect.objectContaining({ tool: 'wiki.policy', arguments: { topic: 'onboarding', maxChars: 2400 } }),
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test('catalog facets and explainable knowledge neighborhoods stay bounded', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'neighborhood-owner', modelId: 'codex', password: 'neighborhood-owner-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };
    await write('Knowledge/Anchor.md', '# Anchor\n\nA durable anchor. [[Knowledge/Linked]]\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', epistemic_status: 'verified', review_policy: 'on_source_change', domain: 'retrieval', moc: '[[MOCs/Research]]', tags: ['research', 'anchor'] });
    await write('Knowledge/Linked.md', '# Linked\n\n[[Knowledge/Anchor]]\n', { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'review', knowledge_polarity: 'negative', source_type: 'paper', subject_terms: ['retrieval'], moc: '[[MOCs/Research]]', tags: ['research'] });
    await write('Knowledge/Project.md', '# Project\n', { llm_wiki_type: 'knowledge', note_kind: 'project', lifecycle: 'active', task_status: 'next_action', project: '[[Projects/Build]]', tags: ['build'] });

    const catalog = await callJson(client, 'get_wiki_catalog', { includeFacets: true, facetLimit: 10, limit: 2, maxChars: 5000, accessToken });
    expect(catalog.value.facets).toMatchObject({ noteKind: { knowledge: 1, atomic: 1, project: 1 }, lifecycle: { evergreen: 1, review: 1, active: 1 }, epistemicStatus: { verified: 1 }, taskStatus: { next_action: 1 }, reviewPolicy: { on_source_change: 1 }, sourceType: { paper: 1 }, polarity: { negative: 1 }, domain: { retrieval: 1 }, subjectTerm: { retrieval: 1 }, tag: { research: 2 } });
    expect(catalog.value.entries).toHaveLength(2);

    const filtered = await callJson(client, 'get_wiki_catalog', { epistemicStatus: 'verified', includeFacets: true, accessToken });
    expect(filtered.value).toMatchObject({ total: 1, entries: [expect.objectContaining({ path: 'Knowledge/Anchor.md', epistemicStatus: 'verified' })], facets: { epistemicStatus: { verified: 1 } } });

    const neighborhood = await callJson(client, 'get_wiki_neighborhood', { path: 'Knowledge/Anchor.md', limit: 5, maxChars: 3000, accessToken });
    expect(neighborhood.value.source.path).toBe('Knowledge/Anchor.md');
    expect(neighborhood.value.neighbors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Linked.md', reasons: expect.arrayContaining(['direct_link', 'shared_moc']) }),
    ]));
    expect(neighborhood.value.neighbors.every((item: Record<string, unknown>) => !('content' in item))).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});

test('knowledge organization contract preserves aliases, projections, and typed relations', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-contract-owner', modelId: 'codex', password: 'organization-contract-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', {
      sourceId: 'organization-contract-source', title: 'Organization contract source', content: '# Source\n\n## Evidence\n\nTyped links and compact projections make knowledge easier to maintain. ^contract-evidence', capturedBy: 'codex', accessToken,
    });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Existing.md', content: '# Existing\n\nA related durable note.\n', expectedRevision: 'missing', accessToken,
    } });
    const published = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Contract.md', content: '# Contract\n\nA compact, linked knowledge note.\n', evidencePaths: [source.value.path],
      aliases: ['Knowledge contract', 'Metadata contract'], mocs: ['[[MOCs/Research]]', '[[MOCs/Operations]]'], summary: 'Properties describe the note and typed links describe why it is related.',
      keyPoints: ['Keep the full Markdown body.', 'Use typed links for meaningful relations.'], openQuestions: ['Which relation needs review next?'],
      relations: { related: ['[[Knowledge/Existing]]'] }, claims: [{ id: 'contract-claim', text: 'Typed links explain why notes are related.', status: 'supported', confidence: 'high', evidence_paths: [source.value.path], evidence: [{ path: source.value.path, heading: 'Evidence', blockId: 'contract-evidence', revision: source.value.revision }] }], stableId: 'knowledge-contract', lifecycle: 'evergreen', taskStatus: 'next_action', startedAt: '2030-01-01', noteKind: 'question', epistemicStatus: 'open', reviewPolicy: 'periodic', evidence: [{ path: source.value.path, heading: 'Evidence', blockId: 'contract-evidence', revision: source.value.revision }], author: 'codex', expectedRevision: 'missing', accessToken,
    });
    expect(published.value.success).toBe(true);
    const projection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Contract.md', view: 'summary', accessToken });
    expect(projection.value).toMatchObject({ aliases: ['Knowledge contract', 'Metadata contract'], stableId: 'knowledge-contract', noteKind: 'question', taskStatus: 'next_action', reviewPolicy: 'periodic', summaryFresh: true, navigation: { mocs: ['[[MOCs/Research]]', '[[MOCs/Operations]]'] }, claims: [{ id: 'contract-claim', text: 'Typed links explain why notes are related.', status: 'supported', confidence: 'high', evidencePaths: [source.value.path], evidence: [{ path: source.value.path, heading: 'Evidence', blockId: 'contract-evidence', revision: source.value.revision }] }], relations: { related: ['[[Knowledge/Existing]]'] } });
    const progressive = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Contract.md', view: 'progressive', accessToken });
    expect(progressive.value.content).toContain('Evidence:');
    expect(progressive.value.content).toContain(source.value.path);
    expect(published.value.evidence[0]).toMatchObject({ path: source.value.path, heading: 'Evidence', blockId: 'contract-evidence', revision: source.value.revision });
    const refs = await callJson(client, 'read_references', { path: 'Knowledge/Contract.md', accessToken });
    expect(refs.value.references).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Existing.md' })]));
    const backlinks = await callJson(client, 'get_backlinks', { path: 'Knowledge/Existing.md', accessToken });
    expect(backlinks.value.backlinks).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Contract.md', relation: 'related' })]));
    const outlinks = await callJson(client, 'get_outlinks', { path: 'Knowledge/Contract.md', accessToken });
    expect(outlinks.value.outlinks).toEqual(expect.arrayContaining([expect.objectContaining({ relation: 'related' })]));
    expect(outlinks.value.outlinks.filter((entry: any) => entry.relation === 'related')).toHaveLength(1);
    const health = await callJson(client, 'get_wiki_organization_health', { limit: 20, accessToken });
    expect(health.value).toMatchObject({ healthy: true, organizationIssueTotal: 0 });
  } finally {
    await client.close();
    await server.close();
  }
});

test('questions, negative knowledge, locators, event review, MOC coverage, and Bases export stay connected', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'remaining-priorities-owner', modelId: 'codex', password: 'remaining-priorities-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', {
      sourceId: 'remaining-priorities-source', title: 'Remaining priorities source', content: '# Source\n\n## Result\n\nThe rejected approach failed under load. ^remaining-result', sourceType: 'paper', citationKey: 'remaining-priorities-2026', author: 'Research Group', publishedAt: '2026-01-01', retrievedAt: '2026-09-03', sourceFamily: 'remaining-priorities', sourceVersion: '2026-09-edition-1', capturedBy: 'codex', accessToken,
    });
    const sourceTrust = await callJson(client, 'get_wiki_source_trust', { accessToken });
    expect(sourceTrust.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ citationKey: 'remaining-priorities-2026', sourceType: 'paper', author: 'Research Group', publishedAt: '2026-01-01', retrievedAt: '2026-09-03', sourceFamily: 'remaining-priorities', sourceVersion: '2026-09-edition-1' })]));
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Related.md', content: '# Related\n\nThe linked context is stable.\n', expectedRevision: 'missing', accessToken,
    } });
    const negative = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Rejected approach.md', content: '# Rejected approach\n\nThis approach is retained as a counterexample. [[Knowledge/Related]]\n',
      evidence: [{ path: source.value.path, heading: 'Result', blockId: 'remaining-result', revision: source.value.revision, startLine: 5, endLine: 5, quoteHash: createHash('sha256').update('The rejected approach failed under load. ^remaining-result').digest('hex') }],
      noteKind: 'hypothesis', lifecycle: 'evergreen', polarity: 'negative', negativeType: 'counterexample', reviewPolicy: 'on_link_change',
      attempted: 'Run the approach under load.', observed: 'The operation failed under load.', failureCondition: 'Concurrent load exceeds the tested threshold.', reproduction: 'Run the documented load test.', reusableLesson: 'Keep a bounded fallback and test concurrency before adoption.', replacementPath: '[[Knowledge/Related]]', epistemicStatus: 'inconclusive',
      expectedRevision: 'missing', author: 'codex', accessToken,
    });
    expect(negative.value).toMatchObject({ success: true, evidence: [expect.objectContaining({ heading: 'Result', blockId: 'remaining-result', revision: source.value.revision, startLine: 5, endLine: 5 })] });

    const projection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Rejected approach.md', view: 'summary', accessToken });
    expect(projection.value).toMatchObject({ noteKind: 'hypothesis', epistemicStatus: 'inconclusive', polarity: 'negative', negativeType: 'counterexample', reusableLesson: 'Keep a bounded fallback and test concurrency before adoption.', reviewPolicy: 'on_link_change', evidence: [expect.objectContaining({ heading: 'Result', blockId: 'remaining-result', revision: source.value.revision, quoteHash: expect.any(String) })] });

    const mocWrite = await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/MOCs/Research.md', content: '# Research MOC\n\n[[Knowledge/Rejected approach]]\n', frontmatter: { note_kind: 'moc', lifecycle: 'evergreen' }, expectedRevision: 'missing', accessToken,
    } });
    expect(mocWrite.isError).toBeFalsy();
    const childMocWrite = await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/MOCs/Child.md', content: '# Child MOC\n\n[[Knowledge/Rejected approach]]\n', frontmatter: { note_kind: 'moc', lifecycle: 'evergreen' }, expectedRevision: 'missing', accessToken,
    } });
    expect(childMocWrite.isError).toBeFalsy();
    const parentMocWrite = await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/MOCs/Parent.md', content: '# Parent MOC\n\n[Child map](Knowledge/MOCs/Child.md)\n', frontmatter: { note_kind: 'moc', lifecycle: 'evergreen' }, expectedRevision: 'missing', accessToken,
    } });
    expect(parentMocWrite.isError).toBeFalsy();
    const graph = await callJson(client, 'get_wiki_graph_health', { limit: 10, maxChars: 5000, accessToken });
    expect(graph.value.mocCoverage).toMatchObject({ knowledgeTotal: 1, knowledgeLinkedFromMoc: 1, ratio: 1 });
    expect(graph.value.mocCoverage.mocs).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/MOCs/Parent.md', indirectKnowledge: 1, nestedMocs: 1 })]));

    const bases = await callJson(client, 'get_wiki_bases_view', { noteKind: 'hypothesis', lifecycle: 'evergreen', limit: 10, accessToken });
    expect(bases.value).toMatchObject({ format: 'obsidian-bases/yaml', suggestedPath: 'Views/LLM Wiki.base', matchingNotes: 1, truncated: false });
    expect(bases.value.content).toContain('type: table');
    expect(bases.value.content).toContain('note.note_kind == "hypothesis"');
    const home = await callJson(client, 'get_wiki_home', { limit: 10, accessToken });
    expect(home.value).toMatchObject({ suggestedHomePath: 'Home.md', suggestedIndexPath: 'JDex.md' });
    expect(home.value.mocs).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/MOCs/Research.md' })]));

    const related = await callJson(client, 'read_note', { path: 'Knowledge/Related.md', accessToken });
    const changed = await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Related.md', content: '# Related\n\nThe linked context changed.\n', expectedRevision: related.value.revision, accessToken,
    } });
    if (changed.isError) throw new Error(JSON.stringify(changed));
    const impact = await callJson(client, 'get_wiki_impact_report', { limit: 10, maxChars: 6000, accessToken });
    expect(impact.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Rejected approach.md', reasons: expect.arrayContaining(['link_changed']), reviewTriggered: true, reviewTrigger: 'link_changed' })]));
    const queue = await callJson(client, 'get_wiki_review_queue', { limit: 10, maxChars: 6000, accessToken });
    expect(queue.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Rejected approach.md', reviewTrigger: 'link_changed' })]));

    await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Open question.md', content: '# Open question\n\nShould this result be reproduced independently?\n', evidencePaths: [source.value.path],
      noteKind: 'question', epistemicStatus: 'open', lifecycle: 'active', reviewPolicy: 'on_any_edit', desiredOutcome: 'Obtain one independent reproduction.', nextAction: 'Ask another agent to rerun the test.', taskContext: '@research', dueAt: '2030-01-01', reviewOutcome: 'confirmed', reviewedBy: 'codex', reviewedAt: '2030-01-01', reviewNote: 'The question remains open and evidence is intact.', expectedRevision: 'missing', author: 'codex', accessToken,
    });
    const questionProjection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Open question.md', accessToken });
    expect(questionProjection.value).toMatchObject({ epistemicStatus: 'open', desiredOutcome: 'Obtain one independent reproduction.', nextAction: 'Ask another agent to rerun the test.', taskContext: '@research', reviewOutcome: 'confirmed', reviewedBy: 'codex' });
    const questionActions = await callJson(client, 'get_wiki_next_actions', { context: '@research', limit: 10, accessToken });
    expect(questionActions.value.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Open question.md', action: 'Ask another agent to rerun the test.', context: '@research' }),
    ]));
    await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Waiting question.md', content: '# Waiting question\n\nCan a peer provide the missing observation?\n', evidencePaths: [source.value.path],
      noteKind: 'question', epistemicStatus: 'blocked', lifecycle: 'active', waitingFor: 'An independent peer observation', waitingSince: '2030-01-02',
      expectedRevision: 'missing', author: 'codex', accessToken,
    });
    const actionableFlow = await callJson(client, 'get_wiki_flow_health', { limit: 20, maxChars: 12000, accessToken });
    expect(actionableFlow.value.lanes.waiting).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Waiting question.md', kind: 'question', waitingFor: 'An independent peer observation' }),
    ]));
    const actionableDashboard = await callJson(client, 'get_wiki_review_dashboard', { limit: 20, maxChars: 12000, accessToken });
    expect(actionableDashboard.value.sections.projectReadiness).toMatchObject({ scope: 'any_actionable_note' });
    expect(actionableDashboard.value.sections.projectReadiness.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Open question.md', kind: 'question', readiness: 'ready' }),
    ]));
    const actionableQuality = await callJson(client, 'get_wiki_quality_check', { path: 'Knowledge/Open question.md', accessToken });
    expect(actionableQuality.value.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'desired_outcome', passed: true }),
      expect.objectContaining({ id: 'next_action_or_waiting', passed: true }),
      expect.objectContaining({ id: 'execution_state', passed: false }),
    ]));
    const actionableHome = await callJson(client, 'get_wiki_home', { limit: 20, maxChars: 12000, accessToken });
    expect(actionableHome.value.counts.actionableWork).toBeGreaterThanOrEqual(2);
    const actionableBase = await callJson(client, 'get_wiki_bases_view', { view: 'project_next_actions', limit: 20, maxChars: 12000, accessToken });
    expect(actionableBase.value).toMatchObject({ actionScope: 'any_actionable_note', matchingNotesExact: false, recommendedEndpoint: 'wiki.next_actions' });
    expect(actionableBase.value.content).toContain('note.next_action || note.next_actions');
    expect(actionableBase.value.content).toContain('note.llm_wiki_type == "knowledge"');
    const question = await callJson(client, 'read_note', { path: 'Knowledge/Open question.md', accessToken });
    const editedQuestion = await client.callTool({ name: 'patch_note', arguments: {
      path: 'Knowledge/Open question.md', oldString: 'Should this result be reproduced independently?', newString: 'Should this result be reproduced independently by another agent?', expectedRevision: question.value.revision, accessToken,
    } });
    expect(editedQuestion.isError).toBeFalsy();
    const editedImpact = await callJson(client, 'get_wiki_impact_report', { limit: 10, maxChars: 8000, accessToken });
    expect(editedImpact.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Open question.md', reviewTrigger: 'note_edited' })]));

    const invalidLocator = await client.callTool({ name: 'publish_knowledge', arguments: {
      path: 'Knowledge/Invalid locator.md', content: '# Invalid locator\n\nA note with a bad locator.\n', evidence: [{ path: source.value.path, heading: 'Does not exist', revision: source.value.revision }],
      expectedRevision: 'missing', author: 'codex', accessToken,
    } });
    expect(invalidLocator.isError).toBe(true);
    expect((invalidLocator.content as any)[0].text).toContain('heading');
    const invalidQuote = await client.callTool({ name: 'publish_knowledge', arguments: {
      path: 'Knowledge/Invalid quote.md', content: '# Invalid quote\n\nA note with a bad quote.\n', evidence: [{ path: source.value.path, startLine: 5, endLine: 5, quoteHash: '0'.repeat(64), revision: source.value.revision }],
      expectedRevision: 'missing', author: 'codex', accessToken,
    } });
    expect(invalidQuote.isError).toBe(true);
    expect((invalidQuote.content as any)[0].text).toContain('quoteHash');
  } finally {
    await client.close();
    await server.close();
  }
});

test('capture, review completion, and bounded Reflect dashboard close the organization loop', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'reflect-owner', modelId: 'codex', password: 'reflect-owner-password' });
    const accessToken = registration.value.accessToken;
    await client.callTool({ name: 'write_note', arguments: { path: 'Projects/Capture task.md', content: '# Capture task\n', expectedRevision: 'missing', accessToken } });
    const captured = await callJson(client, 'capture_wiki_note', { title: 'Unprocessed observation', content: 'A rough observation to classify later.', capturedBy: 'codex', capturedFrom: 'experiment', captureReason: 'Preserve the observation before deciding its final home.', captureContext: 'Observed while checking the bounded organization workflow.', relatedTask: '[[Projects/Capture task]]', accessToken });
    expect(captured.value).toMatchObject({ noteKind: 'fleeting', lifecycle: 'inbox', nextAction: { endpointId: 'wiki.clarify', arguments: { path: captured.value.path, expectedRevision: captured.value.revision } } });
    expect(captured.value.path).toMatch(/^Inbox\/capture-/);
    expect(captured.value).toMatchObject({ capturedFrom: 'experiment', relatedTask: 'Projects/Capture task.md' });
    const capturedNote = await callJson(client, 'read_note', { path: captured.value.path, accessToken });
    expect(capturedNote.value.fm).toMatchObject({ captured_from: 'experiment', capture_reason: 'Preserve the observation before deciding its final home.', capture_context: 'Observed while checking the bounded organization workflow.', related_task: 'Projects/Capture task.md', references: ['Projects/Capture task.md'] });
    const inbox = await callJson(client, 'get_wiki_inbox', { accessToken });
    expect(inbox.value).toMatchObject({ total: 1, items: [expect.objectContaining({ path: captured.value.path, lifecycle: 'inbox' })] });

    const source = await callJson(client, 'ingest_source', { sourceId: 'reflect-source', title: 'Reflect source', content: 'The reviewable claim is grounded.', capturedBy: 'codex', accessToken });
    const published = await callJson(client, 'publish_knowledge', { path: 'Knowledge/Reviewable.md', content: '# Reviewable\n\nThe claim is grounded.\n', evidencePaths: [source.value.path], noteKind: 'atomic', lifecycle: 'review', reviewPolicy: 'manual', reviewAt: '2030-01-01', expectedRevision: 'missing', author: 'codex', accessToken });
    const reviewed = await callJson(client, 'review_wiki_note', { path: 'Knowledge/Reviewable.md', reviewOutcome: 'confirmed', reviewedBy: 'codex', reviewAt: '2031-01-01', nextLifecycle: 'evergreen', reviewNote: 'Evidence and body were checked.', expectedRevision: published.value.revision, accessToken });
    expect(reviewed.value).toMatchObject({ success: true, reviewOutcome: 'confirmed', reviewedBy: 'codex', reviewAt: '2031-01-01', nextLifecycle: 'evergreen' });
    const projection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Reviewable.md', accessToken });
    expect(projection.value).toMatchObject({ reviewOutcome: 'confirmed', reviewedBy: 'codex', reviewNote: 'Evidence and body were checked.' });

    await client.callTool({ name: 'write_note', arguments: { path: 'Projects/Unblocked later.md', content: '# Unblocked later\n', frontmatter: { note_kind: 'project', lifecycle: 'active', task_status: 'someday' }, expectedRevision: 'missing', accessToken } });
    await client.callTool({ name: 'write_note', arguments: { path: 'Projects/Needs action.md', content: '# Needs action\n', frontmatter: { note_kind: 'project', lifecycle: 'active' }, expectedRevision: 'missing', accessToken } });
    const dashboard = await callJson(client, 'get_wiki_review_dashboard', { limit: 10, maxChars: 9000, accessToken });
    expect(dashboard.value.sections).toMatchObject({ inbox: { total: 1 }, projectsAndTasks: { total: 1, items: [expect.objectContaining({ path: 'Projects/Needs action.md', missingNextAction: true })] }, knowledge: { total: 0 } });
  } finally {
    await client.close();
    await server.close();
  }
});

test('retention queue, claim review, contextual resurfacing, and term proposals stay bounded and revision-safe', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-batch-owner', modelId: 'codex', password: 'organization-batch-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', { sourceId: 'organization-batch-source', title: 'Organization batch source', content: '# Evidence\n\nThe approach is useful for debugging retrieval.\n', capturedBy: 'codex', accessToken });
    const published = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Batch.md', content: '# Batch\n\nThe approach is useful for debugging retrieval.\n', evidencePaths: [source.value.path],
      claims: [{ id: 'debugging-claim', text: 'The approach is useful for debugging retrieval.', evidencePaths: [source.value.path], status: 'supported', confidence: 'medium' }],
      retrievalCues: ['debugging retrieval', 'search results are stale'], useWhen: 'When investigating a broken or stale knowledge lookup.',
      retentionPolicy: 'review', retentionAt: '2020-01-01T00:00:00.000Z', retentionReason: 'Recheck after major search changes.',
      noteKind: 'atomic', lifecycle: 'evergreen', expectedRevision: 'missing', author: 'codex', accessToken,
    });

    const retention = await callJson(client, 'get_wiki_retention_queue', { accessToken, limit: 10, maxChars: 5000 });
    expect(retention.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Batch.md', reasons: expect.arrayContaining(['retention_review_due']), suggestedAction: 'choose_retention_policy_and_reason' })]));

    const resurfaced = await callJson(client, 'resurface_wiki_knowledge', { context: 'debugging retrieval', accessToken, limit: 20, maxChars: 6000 });
    expect(resurfaced.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Batch.md', reasons: expect.arrayContaining(['retrieval_cue_match']), contextMatch: expect.any(Number) })]));

    const reviewed = await callJson(client, 'review_wiki_claim', { path: 'Knowledge/Batch.md', claimId: 'debugging-claim', status: 'disputed', confidence: 'low', reviewedBy: 'codex', reviewNote: 'Needs an independent reproduction.', expectedRevision: published.value.revision, accessToken });
    expect(reviewed.value).toMatchObject({ success: true, claimId: 'debugging-claim', status: 'disputed', confidence: 'low' });
    const projection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Batch.md', accessToken });
    expect(projection.value.claims).toEqual([expect.objectContaining({ id: 'debugging-claim', status: 'disputed', confidence: 'low', review: expect.objectContaining({ reviewedBy: 'codex', note: 'Needs an independent reproduction.' }) })]);
    const body = await callJson(client, 'read_note', { path: 'Knowledge/Batch.md', accessToken });
    expect(body.value.content).toContain('The approach is useful for debugging retrieval.');

    const proposal = await callJson(client, 'propose_wiki_term_change', { currentTerm: 'debugging retrieval', proposedTerm: 'retrieval debugging', rationale: 'The preferred wording matches the surrounding authority vocabulary.', affectedPath: 'Knowledge/Batch.md', reportedBy: 'codex', accessToken });
    expect(proposal.value).toMatchObject({ success: true, path: expect.stringContaining('_wiki/issues/term-change-') });
    const proposalNote = await callJson(client, 'read_note', { path: proposal.value.path, accessToken });
    expect(proposalNote.value.fm).toMatchObject({ issue_kind: 'authority_change', proposal_status: 'proposed', current_term: 'debugging retrieval', proposed_term: 'retrieval debugging' });
  } finally {
    await client.close();
    await server.close();
  }
});

test('organization health exposes GTD focus, Zettelkasten connectivity, and progressive context', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-health-owner', modelId: 'codex', password: 'organization-health-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', { sourceId: 'organization-health-source', title: 'Organization health source', content: 'A stable source claim.', capturedBy: 'codex', accessToken });
    const progressive = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Progressive.md', content: '# Progressive\n\nA durable claim.\n', evidencePaths: [source.value.path], noteKind: 'atomic', lifecycle: 'evergreen',
      summary: 'A compact durable claim.', summaryLayer: 3, summaryHighlights: [{ text: 'A durable claim.', startLine: 3, endLine: 3 }], openQuestions: ['Does a second agent agree?'], expectedRevision: 'missing', author: 'codex', accessToken,
    });
    const progressiveRead = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Progressive.md', view: 'progressive', accessToken });
    expect(progressiveRead.value).toMatchObject({ view: 'progressive', summaryFresh: true, summaryStale: false });
    expect(progressiveRead.value.content).toContain('Selected passages:');
    expect(progressiveRead.value.content).toContain('Does a second agent agree?');
    const changed = await client.callTool({ name: 'patch_note', arguments: { path: 'Knowledge/Progressive.md', oldString: 'A durable claim.\n', newString: 'A changed durable claim.\n', replaceAll: true, expectedRevision: progressive.value.revision, accessToken } });
    expect(changed.isError).toBeFalsy();
    const staleRead = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Progressive.md', view: 'progressive', accessToken });
    expect(staleRead.value).toMatchObject({ summaryFresh: false, summaryStale: true });

    await client.callTool({ name: 'write_note', arguments: { path: 'Projects/Focus.md', content: '# Focus\n', frontmatter: { note_kind: 'project', lifecycle: 'active', focus_horizon: 'project', focus_parent: '[[Goals/Missing]]' }, expectedRevision: 'missing', accessToken } });
    await client.callTool({ name: 'write_note', arguments: { path: 'Goals/One.md', content: '# One\n', frontmatter: { note_kind: 'goal', lifecycle: 'active', focus_horizon: 'goal', focus_parent: '[[Goals/Two]]' }, expectedRevision: 'missing', accessToken } });
    await client.callTool({ name: 'write_note', arguments: { path: 'Goals/Two.md', content: '# Two\n', frontmatter: { note_kind: 'goal', lifecycle: 'active', focus_horizon: 'goal', focus_parent: '[[Goals/One]]' }, expectedRevision: 'missing', accessToken } });
    const graph = await callJson(client, 'get_wiki_graph_health', { limit: 20, accessToken });
    expect(graph.value.focusHealth).toMatchObject({ unresolved: { total: 1 }, cycles: { total: 1 }, unparented: { total: 0 } });
    expect(graph.value.knowledgeConnectivity).toMatchObject({ total: 1, isolated: { total: 1 }, isolatedAtomic: { total: 1 } });
    const health = await callJson(client, 'get_wiki_organization_health', { limit: 20, accessToken });
    expect(health.value).toMatchObject({ advisoryIssueTotal: expect.any(Number), focusHealth: expect.objectContaining({ cycles: expect.objectContaining({ total: 1 }) }), knowledgeConnectivity: expect.objectContaining({ isolatedAtomic: expect.objectContaining({ total: 1 }) }) });

    await client.callTool({ name: 'write_note', arguments: { path: 'Projects/Waiting.md', content: '# Waiting\n', frontmatter: { note_kind: 'project', lifecycle: 'active', task_status: 'waiting', waiting_for: 'another agent' }, expectedRevision: 'missing', accessToken } });
    await client.callTool({ name: 'write_note', arguments: { path: 'Projects/Someday.md', content: '# Someday\n', frontmatter: { note_kind: 'project', lifecycle: 'active', task_status: 'someday' }, expectedRevision: 'missing', accessToken } });
    await client.callTool({ name: 'write_note', arguments: { path: 'Knowledge/Question.md', content: '# Question\n', frontmatter: { note_kind: 'question', lifecycle: 'review', epistemic_status: 'open' }, expectedRevision: 'missing', accessToken } });
    const dashboard = await callJson(client, 'get_wiki_review_dashboard', { limit: 20, accessToken });
    expect(dashboard.value.sections).toMatchObject({ waiting: { total: 1 }, someday: { total: 1 }, epistemic: { questions: { total: 1 } } });
  } finally {
    await client.close();
    await server.close();
  }
});

test('clarify, source distillation, and MOC candidates complete the organization loop', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-loop-owner', modelId: 'codex', password: 'organization-loop-password' });
    const accessToken = registration.value.accessToken;
    const captured = await callJson(client, 'capture_wiki_note', { path: 'Inbox/Clarify me.md', title: 'Clarify me', content: 'A rough project observation.', capturedBy: 'codex', accessToken });
    expect(captured.value.nextAction).toMatchObject({ endpointId: 'wiki.clarify', arguments: { path: captured.value.path, expectedRevision: captured.value.revision } });
    const clarified = await callJson(client, 'clarify_wiki_note', {
      path: captured.value.path, disposition: 'project', clarifyNote: 'This needs an explicit next action.', expectedRevision: captured.value.revision, accessToken,
    });
    expect(clarified.value).toMatchObject({ disposition: 'project', recommendedPath: 'Projects/', recommendedLifecycle: 'active', frontmatter: { noteKind: 'project', lifecycle: 'active', disposition: 'project' }, nextAction: { endpointId: 'notes.move_preview' } });
    const inbox = await callJson(client, 'get_wiki_inbox', { accessToken });
    expect(inbox.value).toMatchObject({ total: 0, items: [] });

    await client.callTool({ name: 'write_note', arguments: { path: 'Projects/Existing.md', content: '# Existing\n', expectedRevision: 'missing', accessToken } });
    const collisionCapture = await callJson(client, 'capture_wiki_note', { path: 'Inbox/Collision.md', content: 'A capture whose proposed destination already exists.', accessToken });
    const collision = await callJson(client, 'clarify_wiki_note', { path: collisionCapture.value.path, disposition: 'project', targetPath: 'Projects/Existing.md', expectedRevision: collisionCapture.value.revision, accessToken });
    expect(collision.value).toMatchObject({ targetPath: 'Projects/Existing.md', targetExists: true, targetRevision: expect.any(String), nextAction: { endpointId: 'wiki.merge_preview' } });

    const source = await callJson(client, 'ingest_source', { sourceId: 'distill-source', title: 'Distill source', content: '# Evidence\n\nA durable observation.', capturedBy: 'codex', accessToken });
    const distilled = await callJson(client, 'distill_wiki_source', {
      sourcePath: source.value.path, path: 'Resources/Distilled.md', title: 'Distilled literature', content: '# Distilled literature\n\nA source-backed interpretation.', noteKind: 'literature', expectedRevision: 'missing', author: 'codex', accessToken,
    });
    expect(distilled.value).toMatchObject({ success: true, noteKind: 'literature', distilledFrom: { path: source.value.path, revision: source.value.revision } });
    const projection = await callJson(client, 'read_wiki_projection', { path: 'Resources/Distilled.md', accessToken });
    expect(projection.value).toMatchObject({ noteKind: 'literature', evidence: [expect.objectContaining({ path: source.value.path, revision: source.value.revision })] });

    await callJson(client, 'publish_knowledge', { path: 'Knowledge/Alpha.md', content: '# Alpha\n\nA durable idea.', evidencePaths: [source.value.path], noteKind: 'atomic', lifecycle: 'evergreen', author: 'codex', expectedRevision: 'missing', accessToken });
    await callJson(client, 'publish_knowledge', { path: 'Knowledge/Beta.md', content: '# Beta\n\nAnother durable idea.', evidencePaths: [source.value.path], noteKind: 'atomic', lifecycle: 'evergreen', author: 'codex', expectedRevision: 'missing', accessToken });
    const candidates = await callJson(client, 'get_wiki_moc_candidates', { limit: 10, accessToken });
    expect(candidates.value).toMatchObject({ total: expect.any(Number), candidates: expect.arrayContaining([expect.objectContaining({ suggestedPurpose: expect.any(String), suggestedQuestions: expect.any(Array), notePaths: expect.arrayContaining(['Knowledge/Alpha.md', 'Knowledge/Beta.md']), orderedEntries: expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Alpha.md', revision: expect.any(String) })]), draftMarkdown: expect.stringContaining('[[Knowledge/Alpha|Alpha]]'), creationPlan: expect.objectContaining({ endpointId: 'notes.write' }) })]) });
  } finally {
    await client.close();
    await server.close();
  }
});

test('MOC rebalance produces an explainable bounded plan without rewriting notes', async () => {
  await mkdir(join(vault, 'Knowledge', 'MOCs'), { recursive: true });
  await mkdir(join(vault, 'Knowledge'), { recursive: true });
  await writeFile(join(vault, 'Knowledge', 'MOCs', 'Large.md'), [
    '---', 'llm_wiki_type: knowledge', 'note_kind: moc', 'lifecycle: evergreen', '---',
    '# Large map', '',
    '[[Knowledge/MOCs/Submap]]',
    '[[Knowledge/Domain note]]',
    '[[Knowledge/Relation note]]',
    '[[Knowledge/Unclassified]]',
    '', '## Foundations', '',
    '[[Knowledge/Foundation A]]',
    '[[Knowledge/Foundation B]]',
    '[[Knowledge/Hidden]]',
  ].join('\n'));
  await writeFile(join(vault, 'Knowledge', 'MOCs', 'Submap.md'), '---\nllm_wiki_type: knowledge\nnote_kind: moc\nlifecycle: evergreen\n---\n# Submap\n');
  await writeFile(join(vault, 'Knowledge', 'Domain note.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: evergreen\ndomain: Retrieval\n---\n# Domain note\n\nBody must not be returned.\n');
  await writeFile(join(vault, 'Knowledge', 'Relation note.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: evergreen\ndepends_on:\n  - "[[Knowledge/Domain note]]"\n---\n# Relation note\n');
  await writeFile(join(vault, 'Knowledge', 'Unclassified.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: evergreen\n---\n# Unclassified\n');
  await writeFile(join(vault, 'Knowledge', 'Foundation A.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: evergreen\n---\n# Foundation A\n');
  await writeFile(join(vault, 'Knowledge', 'Foundation B.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: evergreen\n---\n# Foundation B\n');
  await writeFile(join(vault, 'Knowledge', 'Hidden.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: evergreen\nmoderation_status: quarantined\n---\n# Hidden\n');

  const { server, client } = await setup();
  try {
    const discovery = await callJson(client, 'search_capabilities', { query: 'MOC rebalance split saturated map', limit: 5, maxChars: 6000 });
    expect(discovery.value.endpoints).toEqual(expect.arrayContaining([expect.objectContaining({ endpointId: 'wiki.moc_rebalance', available: true })]));
    const plan = await callJson(client, 'get_wiki_moc_rebalance', { path: 'Knowledge/MOCs/Large.md', saturationThreshold: 3, maxBranches: 5, limit: 30, maxChars: 12000 });
    expect(plan.value).toMatchObject({
      mode: 'explainable_moc_rebalance_plan',
      root: { path: 'Knowledge/MOCs/Large.md', revision: expect.stringMatching(/^[a-f0-9]{64}$/) },
      memberTotal: 6,
      saturationThreshold: 3,
      saturated: true,
      rebalanceRecommended: true,
      mutates: false,
      strategyPriority: ['authored_heading', 'child_moc', 'typed_relation', 'domain', 'subject_term', 'unclassified'],
    });
    expect(plan.value.branches).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Foundations', basis: { kind: 'authored_heading', value: 'Foundations' }, memberCount: 2 }),
      expect.objectContaining({ label: 'Sub-MOCs', basis: { kind: 'child_moc', value: 'moc' }, memberCount: 1 }),
      expect.objectContaining({ label: 'Relation: depends_on → Domain note', basis: expect.objectContaining({ kind: 'typed_relation', relation: 'depends_on', target: 'Knowledge/Domain note.md' }), memberCount: 1 }),
      expect.objectContaining({ label: 'Domain: Retrieval', basis: { kind: 'domain', value: 'Retrieval' }, memberCount: 1 }),
      expect.objectContaining({ label: 'Unclassified', basis: { kind: 'unclassified', value: 'Unclassified' }, memberCount: 1 }),
    ]));
    expect(plan.value.crossBranchDependencies).toEqual(expect.arrayContaining([expect.objectContaining({ from: 'Knowledge/Relation note.md', to: 'Knowledge/Domain note.md', relation: 'depends_on' })]));
    expect(JSON.stringify(plan.value)).not.toContain('Body must not be returned');
    expect(JSON.stringify(plan.value)).not.toContain('Hidden.md');
    expect(JSON.stringify(plan.value).length).toBeLessThanOrEqual(12000);
    const unchanged = await callJson(client, 'read_note', { path: 'Knowledge/MOCs/Large.md' });
    expect(unchanged.value.revision).toBe(plan.value.root.revision);
    const healthy = await callJson(client, 'get_wiki_moc_rebalance', { path: 'Knowledge/MOCs/Large.md', maxChars: 3000 });
    expect(healthy.value).toMatchObject({ rebalanceRecommended: false, saturated: false, branches: [], mutates: false });
  } finally {
    await client.close();
    await server.close();
  }
});

test('upstream review baselines resolve aliases, respect relation direction, and stop reopening after review', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'upstream-owner', modelId: 'codex', password: 'upstream-owner-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', { sourceId: 'upstream-source', title: 'Upstream source', content: 'A durable upstream fact.', capturedBy: 'codex', accessToken });
    const upstream = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Foundations/Upstream.md', content: '# Upstream\n\nA durable upstream fact.\n', aliases: ['Foundation alias'], evidencePaths: [source.value.path], noteKind: 'atomic', lifecycle: 'evergreen', status: 'verified', author: 'codex', expectedRevision: 'missing', accessToken,
    });
    const downstream = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Downstream.md', content: '# Downstream\n\nA conclusion derived from the foundation.\n', evidencePaths: [source.value.path], relations: { derived_from: ['[[Foundation alias]]'] }, reviewPolicy: 'on_upstream_change', lifecycle: 'evergreen', author: 'codex', expectedRevision: 'missing', accessToken,
    });
    let queue = await callJson(client, 'get_wiki_review_queue', { limit: 20, maxChars: 10000, accessToken });
    expect(queue.value.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Downstream.md', reviewTrigger: 'upstream_changed' })]));

    await callJson(client, 'review_wiki_note', { path: upstream.value.path, reviewOutcome: 'disputed', nextLifecycle: 'review', expectedRevision: upstream.value.revision, accessToken });
    const impact = await callJson(client, 'get_wiki_impact_report', { limit: 20, maxChars: 10000, accessToken });
    expect(impact.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Downstream.md', reasons: expect.arrayContaining(['upstream_changed', 'upstream_change_triggered_review']), upstreamChanges: expect.arrayContaining([expect.stringContaining('Knowledge/Foundations/Upstream.md')]) })]));
    queue = await callJson(client, 'get_wiki_review_queue', { limit: 20, maxChars: 10000, accessToken });
    expect(queue.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Downstream.md', reviewTrigger: 'upstream_changed' })]));

    const currentDownstream = await callJson(client, 'read_note', { path: downstream.value.path, accessToken });
    await callJson(client, 'review_wiki_note', { path: downstream.value.path, reviewOutcome: 'confirmed', nextLifecycle: 'evergreen', expectedRevision: currentDownstream.value.revision, accessToken });
    queue = await callJson(client, 'get_wiki_review_queue', { limit: 20, maxChars: 10000, accessToken });
    expect(queue.value.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Downstream.md', reviewTrigger: 'upstream_changed' })]));

    const supporter = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Supporter.md', content: '# Supporter\n\nIndependent support for the downstream conclusion.\n', evidencePaths: [source.value.path], relations: { supports: ['[[Knowledge/Downstream]]'] }, lifecycle: 'evergreen', author: 'codex', expectedRevision: 'missing', accessToken,
    });
    queue = await callJson(client, 'get_wiki_review_queue', { limit: 20, maxChars: 10000, accessToken });
    expect(queue.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Downstream.md', upstreamChanges: expect.arrayContaining([expect.stringContaining('supports')]) })]));
    const downstreamAfterSupport = await callJson(client, 'read_note', { path: downstream.value.path, accessToken });
    await callJson(client, 'review_wiki_note', { path: downstream.value.path, reviewOutcome: 'confirmed', nextLifecycle: 'evergreen', expectedRevision: downstreamAfterSupport.value.revision, accessToken });
    await callJson(client, 'review_wiki_note', { path: supporter.value.path, reviewOutcome: 'disputed', nextLifecycle: 'review', expectedRevision: supporter.value.revision, accessToken });
    queue = await callJson(client, 'get_wiki_review_queue', { limit: 20, maxChars: 10000, accessToken });
    expect(queue.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Downstream.md', upstreamChanges: expect.arrayContaining([expect.stringContaining('supports')]) })]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('bounded upstream invalidation cascades through opted-in typed dependencies', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'cascade-owner', modelId: 'codex', password: 'cascade-owner-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', { sourceId: 'cascade-source', title: 'Cascade source', content: 'A source for a dependency chain.', capturedBy: 'codex', accessToken });
    const root = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Cascade root.md', content: '# Cascade root\n\nInitial premise.\n', evidencePaths: [source.value.path], noteKind: 'atomic', lifecycle: 'evergreen', author: 'codex', expectedRevision: 'missing', accessToken,
    });
    await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Cascade direct.md', content: '# Cascade direct\n\nDirect conclusion.\n', evidencePaths: [source.value.path], relations: { depends_on: ['[[Knowledge/Cascade root]]'] }, reviewPolicy: 'on_upstream_change', lifecycle: 'evergreen', author: 'codex', expectedRevision: 'missing', accessToken,
    });
    await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Cascade second.md', content: '# Cascade second\n\nSecond-order conclusion.\n', evidencePaths: [source.value.path], relations: { depends_on: ['[[Knowledge/Cascade direct]]'] }, reviewPolicy: 'on_upstream_change', lifecycle: 'evergreen', author: 'codex', expectedRevision: 'missing', accessToken,
    });
    await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Cascade third.md', content: '# Cascade third\n\nThird-order conclusion.\n', evidencePaths: [source.value.path], relations: { depends_on: ['[[Knowledge/Cascade second]]'] }, reviewPolicy: 'on_upstream_change', lifecycle: 'evergreen', author: 'codex', expectedRevision: 'missing', accessToken,
    });

    const changed = await client.callTool({ name: 'patch_note', arguments: { path: root.value.path, oldString: 'Initial premise.', newString: 'Revised premise.', expectedRevision: root.value.revision, accessToken } });
    expect(changed.isError).toBeFalsy();

    const shallow = await callJson(client, 'get_wiki_review_queue', { limit: 20, maxChars: 12000, maxCascadeDepth: 1, accessToken });
    expect(shallow.value).toMatchObject({ cascade: { maxDepth: 1, truncated: false } });
    expect(shallow.value.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Cascade direct.md', reviewReasons: expect.arrayContaining(['upstream_changed']) }),
      expect.objectContaining({ path: 'Knowledge/Cascade second.md', reviewReasons: expect.arrayContaining(['upstream_cascade_changed']), cascadeDepth: 1, cascadeRoot: 'Knowledge/Cascade direct.md', cascadeVia: 'Knowledge/Cascade direct.md' }),
    ]));
    expect(shallow.value.items.find((item: any) => item.path === 'Knowledge/Cascade third.md')).toBeUndefined();

    const deep = await callJson(client, 'get_wiki_impact_report', { limit: 20, maxChars: 12000, maxCascadeDepth: 2, accessToken });
    expect(deep.value).toMatchObject({ cascade: { maxDepth: 2, truncated: false } });
    expect(deep.value.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Cascade second.md', reasons: expect.arrayContaining(['upstream_cascade_changed']), cascadeDepth: 1 }),
      expect.objectContaining({ path: 'Knowledge/Cascade third.md', reasons: expect.arrayContaining(['upstream_cascade_changed']), cascadeDepth: 2, cascadeRoot: 'Knowledge/Cascade direct.md', cascadeVia: 'Knowledge/Cascade second.md' }),
    ]));
    expect(JSON.stringify(deep.value).length).toBeLessThanOrEqual(12000);
  } finally {
    await client.close();
    await server.close();
  }
});

test('MOC question coverage, Evergreen quality, and review packet stay bounded and explicit', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'review-packet-owner', modelId: 'codex', password: 'review-packet-password' });
    const accessToken = registration.value.accessToken;
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Atomic concept.md', content: '# Atomic concept\n\nA reusable concept with a compact interpretation.\n',
      frontmatter: { note_kind: 'atomic', lifecycle: 'evergreen', summary: 'A reusable concept.' }, expectedRevision: 'missing', accessToken,
    } });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Untitled.md', content: '# Untitled\n\nA durable note that still needs organization.\n',
      frontmatter: { note_kind: 'atomic', lifecycle: 'evergreen' }, expectedRevision: 'missing', accessToken,
    } });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/MOCs/Research.md', content: '# Research\n\n## Questions\n\n- [ ] What is the reusable concept?\n  - [[Knowledge/Atomic concept]]\n- [ ] Which gap remains open?\n',
      frontmatter: { note_kind: 'moc', lifecycle: 'evergreen', moc_purpose: 'Navigate research questions', moc_questions: ['What is the reusable concept?', 'Which gap remains open?'] }, expectedRevision: 'missing', accessToken,
    } });

    const graph = await callJson(client, 'get_wiki_graph_health', { limit: 20, maxChars: 9000, accessToken });
    expect(graph.value.mocQuestionCoverage).toMatchObject({ total: 2, linked: 1, ratio: 0.5, unlinked: { total: 1 } });
    expect(graph.value.mocQuestionCoverage.unlinked.items).toEqual(expect.arrayContaining([expect.objectContaining({ question: 'Which gap remains open?', state: 'unlinked' })]));
    expect(graph.value.mocCoverage.mocs).toEqual(expect.arrayContaining([expect.objectContaining({ questionTotal: 2, questionLinked: 1, questionCoverage: 0.5 })]));
    expect(graph.value.evergreenQuality).toMatchObject({ total: 2, needsAttention: 1, ready: 1 });
    expect(graph.value.evergreenQuality.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Untitled.md', state: 'needs_attention', flags: expect.arrayContaining(['missing_compact_projection', 'generic_concept_title']) })]));

    const packet = await callJson(client, 'get_wiki_review_packet', { limit: 5, maxChars: 7000, accessToken });
    expect(packet.value).toMatchObject({ counts: { unlinkedMocQuestions: 1, evergreenNeedsAttention: 1 } });
    expect(packet.value.priorities).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/MOCs/Research.md', reason: 'moc_question_has_no_linked_answer' })]));
    expect(JSON.stringify(packet.value).length).toBeLessThanOrEqual(7000);
  } finally {
    await client.close();
    await server.close();
  }
});

test('project packet exposes Natural Planning gaps and lint catches citation collisions', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'planning-owner', modelId: 'codex', password: 'planning-owner-password' });
    const accessToken = registration.value.accessToken;
    for (const [sourceId, title] of [['planning-source-one', 'Planning source one'], ['planning-source-two', 'Planning source two']]) {
      const result = await callJson(client, 'ingest_source', { sourceId, title, content: `# ${title}\n\nSource content.`, citationKey: 'duplicate-planning-key', capturedBy: 'codex', accessToken });
      expect(result.value.success).toBe(true);
    }
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Projects/Incomplete.md', content: '# Incomplete project\n\n## Brainstorm\n\n- Explore the first option.\n', frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'project', lifecycle: 'active', next_action: 'Inspect the first option.' }, expectedRevision: 'missing', accessToken,
    } });
    const packet = await callJson(client, 'get_wiki_project_packet', { accessToken, limit: 10 });
    expect(packet.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Projects/Incomplete.md', missing: expect.arrayContaining(['purpose', 'desired_outcome', 'project_support']) })]));
    const lint = await callJson(client, 'lint_wiki', { accessToken, limit: 50 });
    expect(lint.value.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'duplicate_citation_key' })]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('review records bounded history and split preview stays revision-safe', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'review-split-owner', modelId: 'codex', password: 'review-split-owner-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', { sourceId: 'review-split-source', title: 'Review split source', content: 'The source supports the note.', capturedBy: 'codex', accessToken });
    const published = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Review.md', content: '# Review\n\nGrounded body.', evidencePaths: [source.value.path],
      noteKind: 'knowledge', lifecycle: 'review', reviewPolicy: 'manual', author: 'codex', expectedRevision: 'missing', accessToken,
    });
    const reviewed = await callJson(client, 'review_wiki_note', {
      path: 'Knowledge/Review.md', reviewOutcome: 'confirmed', reviewReason: 'source_changed', nextLifecycle: 'evergreen',
      reviewedBy: 'codex', expectedRevision: published.value.revision, accessToken,
    });
    expect(reviewed.value).toMatchObject({ reviewCount: 1, reviewReopenCount: 0, reviewTrigger: 'source_changed' });

    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Broad.md', content: '# Broad\n\n## First idea\n\nOne claim.\n\n## Second idea\n\nAnother claim.\n',
      expectedRevision: 'missing', accessToken,
    } });
    const preview = await callJson(client, 'preview_wiki_split', { path: 'Knowledge/Broad.md', heading: 'First idea', targetPath: 'Knowledge/First idea.md', accessToken });
    expect(preview.value).toMatchObject({ mode: 'preview', sourcePath: 'Knowledge/Broad.md', heading: 'First idea', targetExists: false, collision: 'none' });
    expect(preview.value.content).toContain('One claim.');
    expect(preview.value.nextSteps).toEqual(expect.arrayContaining([expect.stringContaining('expectedRevision') ]));
    const broad = await callJson(client, 'read_note', { path: 'Knowledge/Broad.md', accessToken });
    expect(broad.value.content).toContain('Second idea');
  } finally {
    await client.close();
    await server.close();
  }
});

test('ingest, publish, catalog, lint, and immutable source enforcement form one workflow', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'wiki-owner', modelId: 'codex', password: 'wiki-owner-password' });
    const accessToken = registration.value.accessToken;
    const initialized = await callJson(client, 'initialize_llm_wiki', { actor: 'human', accessToken });
    expect(initialized.value).toMatchObject({ success: true, created: true, schemaPath: '_wiki/SCHEMA.md' });

    const ingested = await callJson(client, 'ingest_source', {
      sourceId: 'karpathy-idea', title: 'LLM Wiki idea', content: 'Persistent interlinked Markdown compounds knowledge.',
      sourceUrl: 'https://example.test/idea', capturedBy: 'human', accessToken,
    });
    expect(ingested.value).toMatchObject({ created: true, path: '_sources/karpathy-idea.md' });

    const duplicate = await callJson(client, 'ingest_source', {
      sourceId: 'karpathy-idea', title: 'LLM Wiki idea', content: 'Persistent interlinked Markdown compounds knowledge.', capturedBy: 'human', accessToken,
    });
    expect(duplicate.value.created).toBe(false);

    const published = await callJson(client, 'publish_knowledge', {
      path: 'Concepts/Compounding Wiki.md',
      content: '# Compounding Wiki\n\nA maintained wiki compounds prior synthesis.',
      evidencePaths: ['_sources/karpathy-idea.md'], author: 'codex', confidence: 'high', status: 'verified', expectedRevision: 'missing', accessToken,
    });
    expect(published.result.isError).toBeFalsy();

    const catalog = await callJson(client, 'get_wiki_catalog', {});
    expect(catalog.value.counts).toMatchObject({ schema: 1, source: 1, knowledge: 1 });
    const lint = await callJson(client, 'lint_wiki', {});
    expect(lint.value.errors).toBe(0);

    const orientation = await callJson(client, 'orient_wiki', { maxChars: 6000 });
    expect(orientation.value.protocol).toBe('mcpvault-llm-wiki/v1');
    expect(orientation.value.mission).toContain('future agents');
    expect(orientation.value.primaryAction).toMatchObject({ endpointId: 'wiki.policy', via: 'call_endpoint', arguments: { topic: 'onboarding', maxChars: 2400 } });
    expect(orientation.value.actionBudget).toMatchObject({ endpointCalls: 1, stopAfterAction: true });
    expect(orientation.value.routing).toContain('Do not search');
    expect(orientation.value.participation.invitation).toContain('equal participant');
    expect(orientation.value.visibleScopes).toEqual([
      { kind: 'community', uri: 'scope://community/local/' },
      { kind: 'global', uri: 'scope://global/' },
    ]);
    expect(orientation.value.nextActions).toEqual([
      expect.objectContaining({ tool: 'wiki.policy' }),
    ]);

    const issue = await callJson(client, 'report_wiki_issue', {
      issueId: 'verify-claim', kind: 'unsupported_claim', title: 'Verify one claim', description: 'The claim needs a second source.', reportedBy: 'reviewer',
      subjectPath: 'Concepts/Compounding Wiki.md', evidencePaths: ['_sources/karpathy-idea.md'], accessToken,
    });
    const resolved = await callJson(client, 'resolve_wiki_issue', {
      path: issue.value.path, actor: 'reviewer', resolution: 'The claim was narrowed to match the source.', expectedRevision: issue.value.revision, accessToken,
    });
    expect(resolved.value.status).toBe('resolved');

    for (const mutation of [
      { name: 'write_note', arguments: { path: '_sources/karpathy-idea.md', content: 'tampered', accessToken } },
      { name: 'patch_note', arguments: { path: '_sources/karpathy-idea.md', oldString: 'Persistent', newString: 'Ephemeral', accessToken } },
      { name: 'delete_note', arguments: { path: '_sources/karpathy-idea.md', confirmPath: '_sources/karpathy-idea.md', accessToken } },
      { name: 'move_note', arguments: { oldPath: '_sources/karpathy-idea.md', newPath: 'moved.md', accessToken } },
    ]) {
      const blocked = await client.callTool(mutation);
      expect(blocked.isError, mutation.name).toBe(true);
      expect((blocked.content as any)[0].text).toContain('immutable LLM Wiki sources');
    }

    const rawPath = join(vault, '_sources', 'karpathy-idea.md');
    await writeFile(rawPath, (await readFile(rawPath, 'utf8')).replace('Persistent', 'Tampered'), 'utf8');
    const damaged = await callJson(client, 'lint_wiki', {});
    expect(damaged.value.issues).toContainEqual(expect.objectContaining({ code: 'source_hash_mismatch' }));
  } finally {
    await client.close();
    await server.close();
  }
});

test('organization metadata, catalog facets, review queue, and lint warnings stay bounded and discoverable', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-owner', modelId: 'codex', password: 'organization-owner-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', {
      sourceId: 'organization-source', title: 'Organization source', content: 'PARA and linked notes help agents find durable knowledge.', capturedBy: 'codex', accessToken,
    });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Projects/MCPVault.md', content: '# MCPVault project\n', expectedRevision: 'missing', accessToken,
    } });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/MOCs/LLM Wiki.md', content: '# LLM Wiki MOC\n\n[[Projects/MCPVault]]\n', expectedRevision: 'missing', accessToken,
    } });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Inbox/Rough capture.md', content: '# Rough capture\n\nSort this later.\n', frontmatter: { captured_at: '2000-01-01T00:00:00.000Z', updated_at: '2000-01-01T00:00:00.000Z' }, expectedRevision: 'missing', accessToken,
    } });
    const inbox = await callJson(client, 'get_wiki_inbox', { limit: 2, maxChars: 1600, accessToken });
    expect(inbox.value).toMatchObject({ total: 1, ageBands: { stale: 1 }, oldestAgeDays: expect.any(Number), items: [expect.objectContaining({ path: 'Inbox/Rough capture.md', agingBand: 'stale', suggestedAction: 'clarify_or_archive_this_old_capture' })] });
    const rough = await callJson(client, 'read_note', { path: 'Inbox/Rough capture.md', accessToken });
    const triaged = await callJson(client, 'triage_wiki_note', {
      path: 'Inbox/Rough capture.md', noteKind: 'project', lifecycle: 'active', project: '[[Projects/MCPVault]]',
      desiredOutcome: 'The captured work is organized.', nextAction: 'Review the captured source.', completionCriteria: ['The source has a durable destination.'],
      summary: 'A captured organization project.', summaryLayer: 2, summaryHighlights: [{ text: 'Sort this later.' }],
      serviceClass: 'research', startedAt: '2030-01-01', blockedSince: '2030-01-02', waitingSince: '2030-01-03', completedAt: '2030-01-04',
      retrievalCues: ['When an Inbox capture becomes actionable'], useWhen: 'During Inbox clarification',
      expectedRevision: rough.value.revision, accessToken,
    });
    expect(triaged.value).toMatchObject({
      success: true,
      frontmatter: {
        noteKind: 'project', lifecycle: 'active', desiredOutcome: 'The captured work is organized.', nextAction: 'Review the captured source.',
        completionCriteria: ['The source has a durable destination.'], serviceClass: 'research', startedAt: '2030-01-01', blockedSince: '2030-01-02',
        waitingSince: '2030-01-03', completedAt: '2030-01-04', retrievalCues: ['When an Inbox capture becomes actionable'],
        useWhen: 'During Inbox clarification',
      },
    });
    const triagedRead = await callJson(client, 'read_note', { path: 'Inbox/Rough capture.md', accessToken });
    expect(triagedRead.value.fm).toMatchObject({
      summary_layer: 2, summary_highlights: [{ text: 'Sort this later.' }], completion_criteria: ['The source has a durable destination.'],
      service_class: 'research', started_at: '2030-01-01', blocked_since: '2030-01-02', waiting_since: '2030-01-03', completed_at: '2030-01-04',
      retrieval_cues: ['When an Inbox capture becomes actionable'], use_when: 'During Inbox clarification',
    });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Interpreted literature.md', content: '# Interpreted literature\n', frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'literature', lifecycle: 'active' }, expectedRevision: 'missing', accessToken,
    } });
    const literature = await callJson(client, 'read_note', { path: 'Knowledge/Interpreted literature.md', accessToken });
    const interpreted = await callJson(client, 'triage_wiki_note', {
      path: 'Knowledge/Interpreted literature.md', interpretationStatus: 'interpreted', expectedRevision: literature.value.revision, accessToken,
    });
    expect(interpreted.value.frontmatter).toMatchObject({ noteKind: 'literature', interpretationStatus: 'interpreted' });

    await client.callTool({ name: 'write_note', arguments: {
      path: 'Projects/Reclassify.md', content: '# Reclassify\n', frontmatter: {
        llm_wiki_type: 'knowledge', note_kind: 'project', lifecycle: 'active', project_purpose: 'Temporary project role.', project_support: ['[[Resources/Guide]]'],
        desired_outcome: 'Finish once.', next_action: 'Do the old work.', task_status: 'open', custom_property: 'preserve-me',
      }, expectedRevision: 'missing', accessToken,
    } });
    const reclassify = await callJson(client, 'read_note', { path: 'Projects/Reclassify.md', accessToken });
    const unsafeReclassify = await client.callTool({ name: 'triage_wiki_note', arguments: {
      path: 'Projects/Reclassify.md', noteKind: 'resource', lifecycle: 'active', expectedRevision: reclassify.value.revision, accessToken,
    } });
    expect(unsafeReclassify.isError).toBe(true);
    expect(String((unsafeReclassify.content as any)[0]?.text)).toContain('clearInapplicable');
    const cleaned = await callJson(client, 'triage_wiki_note', {
      path: 'Projects/Reclassify.md', noteKind: 'resource', lifecycle: 'active', clearInapplicable: true, expectedRevision: reclassify.value.revision, accessToken,
    });
    expect(cleaned.value).toMatchObject({
      success: true,
      clearedProperties: expect.arrayContaining(['project_purpose', 'project_support']),
      frontmatter: { noteKind: 'resource', lifecycle: 'active' },
    });
    const cleanedRead = await callJson(client, 'read_note', { path: 'Projects/Reclassify.md', accessToken });
    expect(cleanedRead.value.fm).toMatchObject({ note_kind: 'resource', lifecycle: 'active', custom_property: 'preserve-me', desired_outcome: 'Finish once.', next_action: 'Do the old work.', task_status: 'open' });
    expect(cleanedRead.value.fm).not.toHaveProperty('project_purpose');
    expect(cleanedRead.value.fm).not.toHaveProperty('project_support');
    const invalidTriage = await client.callTool({ name: 'triage_wiki_note', arguments: {
      path: 'Inbox/Rough capture.md', nextAction: 'x'.repeat(501), expectedRevision: triaged.value.revision, accessToken,
    } });
    expect(invalidTriage.isError).toBe(true);
    const inboxAfterTriage = await callJson(client, 'get_wiki_inbox', { limit: 2, maxChars: 1600, accessToken });
    expect(inboxAfterTriage.value).toMatchObject({ total: 0, items: [] });
    const stalledWrite = await client.callTool({ name: 'write_note', arguments: {
      path: 'Projects/Stalled.md', content: '# Stalled\n', frontmatter: { note_kind: 'project', lifecycle: 'active' }, expectedRevision: 'missing', accessToken,
    } });
    expect(stalledWrite.isError).toBeFalsy();
    await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Atomic/Organization.md',
      content: '# Organization\n\n[[Projects/MCPVault]] is the active implementation project.',
      evidencePaths: [source.value.path], references: ['[[Projects/MCPVault]]'], author: 'codex',
      status: 'disputed', confidence: 'medium', noteKind: 'atomic', lifecycle: 'review',
      moc: '[[Knowledge/MOCs/LLM Wiki]]', project: '[[Projects/MCPVault]]', reviewAt: '2000-01-01',
      expectedRevision: 'missing', accessToken,
    });

    const catalog = await callJson(client, 'get_wiki_catalog', { noteKind: 'atomic', lifecycle: 'review', accessToken });
    expect(catalog.value).toMatchObject({ total: 1, organization: { noteKinds: { atomic: 1 }, lifecycles: { review: 1 } } });
    expect(catalog.value.entries[0]).toMatchObject({ noteKind: 'atomic', lifecycle: 'review', project: '[[Projects/MCPVault]]' });

    const queue = await callJson(client, 'get_wiki_review_queue', { limit: 1, maxChars: 1200, accessToken });
    expect(queue.value).toMatchObject({ total: 1, truncated: false, items: [expect.objectContaining({ noteKind: 'atomic', lifecycle: 'review', overdue: true })] });
    const organizationNote = await callJson(client, 'read_note', { path: 'Knowledge/Atomic/Organization.md', accessToken });
    const snoozed = await callJson(client, 'triage_wiki_note', {
      path: 'Knowledge/Atomic/Organization.md', reviewSnoozedUntil: '2099-01-01', reviewSnoozeReason: 'Waiting for the next source edition.',
      expectedRevision: organizationNote.value.revision, accessToken,
    });
    const snoozedRead = await callJson(client, 'read_note', { path: 'Knowledge/Atomic/Organization.md', accessToken });
    expect(snoozedRead.value.fm.review_snoozed_until).toBe('2099-01-01');
    const snoozedQueue = await callJson(client, 'get_wiki_review_queue', { limit: 1, maxChars: 1200, accessToken });
    expect(snoozedQueue.value.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Atomic/Organization.md' })]));

    const lint = await callJson(client, 'lint_wiki', { accessToken });
    expect(lint.value.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'knowledge_review_due' }),
      expect.objectContaining({ code: 'active_project_without_next_action', path: 'Projects/Stalled.md' }),
    ]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('knowledge-related commits are blocked by Wiki errors while ordinary notes remain normal Git changes', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'commit-owner', modelId: 'codex', password: 'commit-owner-password' });
    const accessToken = registration.value.accessToken;
    const initialized = await client.callTool({ name: 'initialize_revision_history', arguments: { confirm: true, accessToken } });
    expect(initialized.isError).toBeFalsy();
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Ordinary.md', content: '# Ordinary note\n', expectedRevision: 'missing', accessToken,
    } });
    const ordinaryCommit = await callJson(client, 'commit_changes', { reason: 'Add an ordinary note', accessToken });
    expect(ordinaryCommit.value.success).toBe(true);

    await client.callTool({ name: 'write_note', arguments: {
      path: 'Broken knowledge.md', content: '# Unsupported\n', frontmatter: { llm_wiki_type: 'knowledge' }, expectedRevision: 'missing', accessToken,
    } });
    const blocked = await client.callTool({ name: 'commit_changes', arguments: { reason: 'Attempt to save unsupported knowledge', accessToken } });
    expect(blocked.isError).toBe(true);
    expect((blocked.content as any)[0].text).toContain('Wiki validation blocked commit');
    expect((blocked.content as any)[0].text).toContain('knowledge_without_evidence');
  } finally {
    await client.close();
    await server.close();
  }
});

test('private source and knowledge workflows are visible only to their logged-in owner', async () => {
  const { server, client } = await setup();
  try {
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'alpha-owner', modelId: 'alpha', password: 'alpha-private-password' } });
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'beta-owner', modelId: 'beta', password: 'beta-private-password' } });
    const alphaToken = (await callJson(client, 'login_scope', { accountId: 'alpha-owner', password: 'alpha-private-password' })).value.accessToken;
    const betaToken = (await callJson(client, 'login_scope', { accountId: 'beta-owner', password: 'beta-private-password' })).value.accessToken;

    const source = await callJson(client, 'ingest_source', {
      scopeUri: 'scope://model/alpha/', sourceId: 'private-source', title: 'Private', content: 'alpha-only evidence',
      sourceWorkId: 'alpha-private-work', sourceEditionId: 'edition-1', archiveCollectionId: 'alpha-private-archive', archiveSeries: ['Private series'], archiveSequence: 1, accessToken: alphaToken,
    });
    expect(source.value.path).toBe('scope://model/alpha/_sources/private-source.md');
    const unsafePublicPublish = await client.callTool({ name: 'publish_knowledge', arguments: {
      path: 'Public Leak.md', content: 'would expose private provenance',
      evidencePaths: ['scope://model/alpha/_sources/private-source.md'], expectedRevision: 'missing', accessToken: alphaToken,
    } });
    expect(unsafePublicPublish.isError).toBe(true);
    expect((unsafePublicPublish.content as any)[0].text).toContain('more-private source');
    await client.callTool({ name: 'publish_knowledge', arguments: {
      path: 'scope://model/alpha/Private Knowledge.md', content: 'alpha-only conclusion',
      evidencePaths: ['scope://model/alpha/_sources/private-source.md'], expectedRevision: 'missing', accessToken: alphaToken,
    } });

    const betaSearch = await callJson(client, 'search_notes', { query: 'alpha-only', accessToken: betaToken });
    expect(betaSearch.value).toEqual([]);
    const anonymousCatalog = await callJson(client, 'get_wiki_catalog', {});
    expect(anonymousCatalog.value.total).toBe(0);
    const betaRead = await client.callTool({ name: 'read_note', arguments: { path: 'scope://model/alpha/Private Knowledge.md', accessToken: betaToken } });
    expect(betaRead.isError).toBe(true);
    const alphaArchive = await callJson(client, 'get_wiki_archive_finding_aid', { collectionId: 'alpha-private-archive', accessToken: alphaToken });
    expect(alphaArchive.value).toMatchObject({ totals: { matchingSources: 1 }, items: [expect.objectContaining({ path: 'scope://model/alpha/_sources/private-source.md' })] });
    const betaArchive = await callJson(client, 'get_wiki_archive_finding_aid', { collectionId: 'alpha-private-archive', accessToken: betaToken });
    expect(betaArchive.value).toMatchObject({ totals: { matchingSources: 0 }, items: [] });
    const alphaLineage = await callJson(client, 'get_wiki_source_lineage', { sourceFamily: 'alpha-private-work', accessToken: alphaToken });
    expect(alphaLineage.value.works).toEqual([expect.objectContaining({ workId: 'alpha-private-work' })]);
    const betaLineage = await callJson(client, 'get_wiki_source_lineage', { sourceFamily: 'alpha-private-work', accessToken: betaToken });
    expect(betaLineage.value.works).toEqual([]);
  } finally {
    await client.close();
    await server.close();
  }
});

test('claim provenance, progressive projections, duplicate preflight, impact, and graph health stay bounded', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'quality-owner', modelId: 'codex', password: 'quality-owner-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', {
      sourceId: 'quality-source', title: 'Quality source', content: 'A durable wiki should preserve evidence, revisions, and links.', capturedBy: 'codex', accessToken,
    });
    const published = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Quality.md', title: 'Quality', content: '# Quality\n\nA durable wiki preserves evidence, revisions, and links.\n\n## Details\n\nThe details remain inspectable.\n',
      evidencePaths: [source.value.path], claims: [{ id: 'durability', text: 'A durable wiki preserves evidence.', evidencePaths: [source.value.path], confidence: 'high', status: 'supported' }],
      author: 'codex', status: 'verified', confidence: 'high', expectedRevision: 'missing', accessToken,
    });
    expect(published.value.claims).toEqual([expect.objectContaining({ id: 'durability', status: 'supported' })]);

    const summary = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Quality.md', view: 'summary', maxChars: 1200, accessToken });
    expect(summary.value).toMatchObject({ view: 'summary', path: 'Knowledge/Quality.md', content: expect.stringContaining('A durable wiki preserves evidence') });
    const outline = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Quality.md', view: 'outline', accessToken });
    expect(outline.value.content).toContain('Details');
    const section = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Quality.md', view: 'section', section: 'Details', accessToken });
    expect(section.value.content).toContain('details remain inspectable');

    const preflight = await callJson(client, 'preflight_wiki_publish', {
      path: 'Knowledge/Quality-copy.md', title: 'Quality copy', content: 'A durable wiki preserves evidence, revisions, and links.', accessToken,
    });
    expect(preflight.value.candidates[0]).toMatchObject({ path: 'Knowledge/Quality.md', relation: 'possible_duplicate' });

    await writeFile(join(vault, '_sources', 'quality-source.md'), (await readFile(join(vault, '_sources', 'quality-source.md'), 'utf8')).replace('A durable wiki should preserve', 'A changed source should preserve'), 'utf8');
    const impact = await callJson(client, 'get_wiki_impact_report', { limit: 5, maxChars: 2500, accessToken });
    expect(impact.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Quality.md', reasons: expect.arrayContaining(['source_changed']) })]));
    const lint = await callJson(client, 'lint_wiki', { accessToken });
    expect(lint.value.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid_claim_evidence', path: 'Knowledge/Quality.md' })]));

    await client.callTool({ name: 'write_note', arguments: { path: 'Knowledge/Empty MOC.md', content: '# Empty MOC\n', frontmatter: { note_kind: 'moc' }, expectedRevision: 'missing', accessToken } });
    await client.callTool({ name: 'write_note', arguments: { path: 'Knowledge/Broken.md', content: '# Broken\n\n[[Missing target]]\n', expectedRevision: 'missing', accessToken } });
    const graph = await callJson(client, 'get_wiki_graph_health', { limit: 10, maxChars: 4000, accessToken });
    expect(graph.value.emptyMocs.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Empty MOC.md' })]));
    expect(graph.value.unresolvedLinks.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Broken.md' })]));

    const trustedSource = await callJson(client, 'ingest_source', {
      sourceId: 'decision-source', title: 'Decision evidence', content: 'Use bounded reads and preserve Git history.', capturedBy: 'codex', trustLevel: 'high', trustReason: 'Primary project design record.', accessToken,
    });
    const decision = await callJson(client, 'publish_decision_record', {
      path: 'Knowledge/Decisions/Read-policy.md', title: 'Bounded read policy', context: 'Agents have limited context and concurrent edits.', decision: 'Use progressive reads with revision checks.', alternatives: ['Load every document in full.'], consequences: ['Callers must request a larger view when needed.'], status: 'accepted', evidencePaths: [trustedSource.value.path], author: 'codex', expectedRevision: 'missing', accessToken,
    });
    expect(decision.value).toMatchObject({ created: true, path: 'Knowledge/Decisions/Read-policy.md' });
    const trust = await callJson(client, 'get_wiki_source_trust', { accessToken });
    expect(trust.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: trustedSource.value.path, trustLevel: 'high', integrity: 'intact', usedByKnowledgeNotes: 1 })]));

    await callJson(client, 'publish_blog_post', { slug: 'promotable-research', title: 'A useful research result', content: 'This community result should become durable knowledge.', category: 'research', references: [trustedSource.value.path], expectedRevision: 'missing', accessToken });
    const promotion = await callJson(client, 'get_wiki_promotion_candidates', { accessToken });
    expect(promotion.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ slug: 'promotable-research', suggestedPath: 'Knowledge/Community/promotable-research.md' })]));

    await callJson(client, 'publish_knowledge', { path: 'Knowledge/Long.md', content: `# Long\n\n${'A durable paragraph without a stored summary. '.repeat(60)}`, evidencePaths: [trustedSource.value.path], author: 'codex', expectedRevision: 'missing', accessToken });
    const summaries = await callJson(client, 'get_wiki_summary_candidates', { accessToken });
    expect(summaries.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Long.md', reason: 'missing_summary' })]));

    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Stale.md', content: '# Stale\n\nThe body was edited after the compact projection.\n',
      frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', summary: 'An old projection.', summary_of_content_sha256: '0000000000000000000000000000000000000000000000000000000000000000' },
      expectedRevision: 'missing', accessToken,
    } });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Alias-owner.md', content: '# Alias owner\n',
      frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', aliases: ['Shared concept'], stable_id: 'shared-concept' },
      expectedRevision: 'missing', accessToken,
    } });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Alias-collision.md', content: '# Alias collision\n',
      frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', aliases: ['Shared concept'], stable_id: 'shared-concept' },
      expectedRevision: 'missing', accessToken,
    } });
    const organizationHealth = await callJson(client, 'get_wiki_organization_health', { limit: 20, maxChars: 5000, accessToken });
    expect(organizationHealth.value.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'stale_summary', path: 'Knowledge/Stale.md' }),
      expect.objectContaining({ code: 'duplicate_alias_across_notes' }),
      expect.objectContaining({ code: 'duplicate_stable_id' }),
    ]));
    const staleSummaries = await callJson(client, 'get_wiki_summary_candidates', { accessToken });
    expect(staleSummaries.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Stale.md', reason: 'stale_summary', summaryFresh: false })]));

    await client.callTool({ name: 'write_note', arguments: { path: 'Knowledge/Old.md', content: '# Old\n\nOld knowledge.', frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', updated_at: '2020-01-01T00:00:00.000Z', created_at: '2020-01-01T00:00:00.000Z' }, expectedRevision: 'missing', accessToken } });
    const unused = await callJson(client, 'get_wiki_unused_knowledge', { olderThanDays: 30, accessToken });
    expect(unused.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Old.md', suggestedAction: 'review_then_archive_or_supersede' })]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('next actions and knowledge rediscovery stay bounded while graph health checks epistemic flow', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-signals-owner', modelId: 'codex', password: 'organization-signals-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };
    const dynamic = (endpointId: string, arguments_: Record<string, unknown>) => callJson(client, 'call_endpoint', { endpointId, arguments: arguments_ });

    await write('Projects/Research.md', '# Research project\n\n## Support\n\n[[Knowledge/Atomic idea]]\n', {
      llm_wiki_type: 'knowledge', note_kind: 'project', lifecycle: 'active', task_status: 'next_action',
      next_action: 'Inspect the source implementation', task_context: '@computer', due_at: '2030-01-01T00:00:00.000Z', time_estimate_minutes: 30, energy: 'high', effort: 'high',
    });
    await write('Tasks/Read.md', '# Read task\n', {
      llm_wiki_type: 'knowledge', note_kind: 'task', lifecycle: 'active', task_status: 'next_action',
      next_actions: ['Read the primary paper', 'Extract one claim'], task_context: '@research', time_estimate_minutes: 10, energy: 'low', effort: 'medium',
    });
    await write('Knowledge/Atomic idea.md', '# Atomic idea\n\nA reusable idea.\n', {
      llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', summary: 'A reusable idea.',
    });
    await write('Knowledge/Open question.md', '# Open question\n', {
      llm_wiki_type: 'knowledge', note_kind: 'question', lifecycle: 'review', epistemic_status: 'answered',
    });
    await write('Knowledge/Unsupported hypothesis.md', '# Unsupported hypothesis\n', {
      llm_wiki_type: 'knowledge', note_kind: 'hypothesis', lifecycle: 'review', epistemic_status: 'supported',
    });
    await write('Knowledge/Captured literature.md', '# Captured literature\n', {
      llm_wiki_type: 'knowledge', note_kind: 'literature', lifecycle: 'active', interpretation_status: 'unprocessed',
    });
    await write('Knowledge/Un grounded synthesis.md', '# Un grounded synthesis\n', {
      llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', interpretation_status: 'synthesized',
    });
    await write('Knowledge/Typed gap.md', '# Typed gap\n', {
      llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', supports: ['[[Knowledge/Does not exist]]'],
    });

    const computer = await dynamic('wiki.next_actions', { context: '@computer', limit: 10, maxChars: 3000, accessToken });
    expect(computer.value).toMatchObject({ context: '@computer', total: 1, items: [expect.objectContaining({ path: 'Projects/Research.md', context: '@computer', action: 'Inspect the source implementation' })] });
    expect(computer.value.items[0]).not.toHaveProperty('projectSupport');
    const lowEnergy = await dynamic('wiki.next_actions', { maxMinutes: 15, energy: 'low', accessToken });
    expect(lowEnergy.value).toMatchObject({ selection: { maxMinutes: 15, energy: 'low' }, total: 2 });
    expect(lowEnergy.value.items.every((item: any) => item.path === 'Tasks/Read.md')).toBe(true);
    const allActions = await dynamic('wiki.next_actions', { limit: 2, maxChars: 1200, accessToken });
    expect(allActions.value).toMatchObject({ total: 3, truncated: true });
    expect(allActions.value.items.length).toBeLessThanOrEqual(2);
    expect(JSON.stringify(allActions.value).length).toBeLessThanOrEqual(1200);

    const resurfaced = await dynamic('wiki.resurface', { limit: 3, maxChars: 1800, accessToken });
    expect(resurfaced.value).toMatchObject({ total: 8, rotationDate: expect.any(String) });
    expect(resurfaced.value.items.length).toBeLessThanOrEqual(3);
    for (const item of resurfaced.value.items) {
      expect(item).toMatchObject({ path: expect.stringMatching(/^(?:Knowledge|Projects|Tasks)\//), reasons: expect.any(Array) });
    }
    expect(JSON.stringify(resurfaced.value).length).toBeLessThanOrEqual(1800);

    const graph = await callJson(client, 'get_wiki_graph_health', { limit: 20, maxChars: 5000, accessToken });
    expect(graph.value.epistemicConsistency.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Open question.md', reasons: expect.arrayContaining(['answered_without_answer_relation']) }),
      expect.objectContaining({ path: 'Knowledge/Unsupported hypothesis.md', reasons: expect.arrayContaining(['resolved_hypothesis_without_evidence']) }),
    ]));
    expect(graph.value.knowledgeFlow).toMatchObject({ stages: { unprocessed: 1, synthesized: 1 }, literatureWithoutSource: { total: 1 }, synthesisWithoutInputs: { total: 1 } });
    expect(graph.value.typedRelations.unresolved.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Typed gap.md', relation: 'supports' })]));
    const contract = await callJson(client, 'get_wiki_property_contract', { accessToken });
    expect(contract.value.relations).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'supports', direction: 'directional' })]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('composition candidates, projection-only updates, and waiting follow-up signals stay bounded and revision-safe', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-maintenance-owner', modelId: 'codex', password: 'organization-maintenance-password' });
    const accessToken = registration.value.accessToken;
    const body = [
      '# Broad note',
      '',
      '## First section',
      '',
      'This paragraph combines several reusable claims. It links to [[Knowledge/Atomic idea]] and [[Knowledge/Supporting idea]]. It should be reviewed as a possible multi-claim block.',
      '',
      ...Array.from({ length: 5 }, (_, index) => [`First reusable observation ${index + 1}.`, '']).flat(),
      '',
      '## Second section',
      '',
      ...Array.from({ length: 5 }, (_, index) => [`Second reusable observation ${index + 1}.`, '']).flat(),
      '',
      '## Third section',
      '',
      ...Array.from({ length: 5 }, (_, index) => [`Third reusable observation ${index + 1}.`, '']).flat(),
    ].join('\n');
    const written = await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Broad composition.md',
      content: body,
      frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', stable_id: 'broad-composition' },
      expectedRevision: 'missing', accessToken,
    } });
    expect(written.isError).toBeFalsy();

    const dynamic = (endpointId: string, arguments_: Record<string, unknown>) => callJson(client, 'call_endpoint', { endpointId, arguments: arguments_ });
    const candidates = await dynamic('wiki.composition_candidates', { limit: 5, maxChars: 3000, accessToken });
    expect(candidates.value).toMatchObject({ total: 1, items: [expect.objectContaining({ path: 'Knowledge/Broad composition.md', suggestedTool: 'wiki.split_preview' })] });
    expect(candidates.value.items[0].signals).toEqual(expect.arrayContaining(['many_sections', 'many_paragraphs', 'multi_claim_paragraphs']));
    expect(candidates.value.items[0].paragraphCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ startLine: expect.any(Number), endLine: expect.any(Number), sentenceCount: 3, linkCount: 2 }),
    ]));
    expect(JSON.stringify(candidates.value).length).toBeLessThanOrEqual(3000);

    const before = await callJson(client, 'read_note', { path: 'Knowledge/Broad composition.md', accessToken });
    const projection = await dynamic('wiki.projection_update', {
      path: 'Knowledge/Broad composition.md',
      summary: 'A broad note with three reusable sections.',
      keyPoints: ['Three sections are candidates for reuse.'],
      summaryLayer: 2,
      expectedRevision: before.value.revision,
      accessToken,
    });
    expect(projection.value).toMatchObject({ projection: { summaryLayer: 2, summaryFresh: true, bodyChanged: false } });
    const after = await callJson(client, 'read_note', { path: 'Knowledge/Broad composition.md', accessToken });
    expect(after.value.content).toBe(before.value.content);
    expect(after.value.fm.stable_id).toBe('broad-composition');

    await mkdir(join(vault, 'Projects'), { recursive: true });
    await writeFile(join(vault, 'Projects', 'Waiting.md'), [
      '---',
      'llm_wiki_type: knowledge',
      'note_kind: project',
      'lifecycle: active',
      'task_status: waiting',
      'waiting_for: an external review',
      'waiting_since: 2020-01-01T00:00:00.000Z',
      '---',
      '# Waiting project',
      '',
      'A project awaiting a response.',
      '',
    ].join('\n'));
    const dashboard = await callJson(client, 'get_wiki_review_dashboard', { limit: 20, accessToken });
    expect(dashboard.value.sections.waiting.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Projects/Waiting.md', waitingAgeDays: expect.any(Number), followUpNeeded: true, followUpReason: 'waiting_14_days_or_more' }),
    ]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('Property contract is discoverable and review cadence schedules the next review', async () => {
  const { server, client } = await setup();
  try {
    const contract = await callJson(client, 'get_wiki_property_contract', { maxChars: 12000 });
    expect(contract.value.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'note_kind', type: 'text' }),
      expect.objectContaining({ name: 'review_interval_days', type: 'number' }),
    ]));
    expect(contract.value.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'supports', direction: 'directional' }),
    ]));
    expect(JSON.stringify(contract.value).length).toBeLessThanOrEqual(12000);

    const focusedContract = await callJson(client, 'get_wiki_property_contract', {
      names: ['task_status', 'moc_purpose', 'not_a_managed_property'], maxChars: 6000,
    });
    expect(focusedContract.value).toMatchObject({
      totalFields: expect.any(Number),
      selection: { mode: 'names', matches: 2, offset: 0, returned: 2, unknownNames: ['not_a_managed_property'] },
      fields: expect.arrayContaining([
        expect.objectContaining({ name: 'task_status', allowed: expect.arrayContaining(['open', 'completed']), description: expect.any(String) }),
        expect.objectContaining({ name: 'moc_purpose', appliesTo: ['moc'], description: expect.any(String) }),
      ]),
    });
    const roleContract = await callJson(client, 'get_wiki_property_contract', {
      names: ['knowledge_role', 'interpretation_status', 'epistemic_status', 'issue_resolution_status'], maxChars: 7000,
    });
    expect(roleContract.value.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'knowledge_role', appliesTo: ['atomic', 'knowledge', 'decision'] }),
      expect.objectContaining({ name: 'interpretation_status', appliesTo: ['literature', 'atomic', 'knowledge'] }),
      expect.objectContaining({ name: 'epistemic_status', appliesTo: ['question', 'hypothesis', 'experiment', 'assumption'] }),
      expect.objectContaining({ name: 'issue_resolution_status', appliesTo: ['issue'] }),
    ]));
    const contractPage = await callJson(client, 'get_wiki_property_contract', { query: 'review', limit: 2, maxChars: 5000 });
    expect(contractPage.value.selection).toMatchObject({ mode: 'query', query: 'review', offset: 0, returned: 2, nextOffset: 2 });
    expect(contractPage.value.nextAction).toMatchObject({ endpointId: 'wiki.property_contract', arguments: { query: 'review', offset: 2, limit: 2, maxChars: 5000 } });
    expect(contractPage.value.fields.every((field: any) => typeof field.description === 'string')).toBe(true);
    const ambiguousContractRequest = await client.callTool({ name: 'get_wiki_property_contract', arguments: { names: ['task_status'], query: 'review' } });
    expect(ambiguousContractRequest.isError).toBe(true);

    const namedContract = await callJson(client, 'get_wiki_property_contract', { maxChars: 4000 });
    expect(namedContract.value.fields).toEqual(expect.arrayContaining(['note_kind', 'review_interval_days']));
    expect(namedContract.value.conventions.nativeCompatibility).toMatchObject({
      safeTypes: expect.arrayContaining(['list']),
      mcpManagedComplexFields: expect.arrayContaining(['claims', 'evidence']),
    });
    expect(JSON.stringify(namedContract.value).length).toBeLessThanOrEqual(4000);

    const tinyContract = await callJson(client, 'get_wiki_property_contract', { maxChars: 512, prettyPrint: true });
    expect(tinyContract.value).toMatchObject({
      contractFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      totalFields: expect.any(Number),
      totalRelations: expect.any(Number),
      truncated: true,
      nextAction: { endpointId: 'wiki.property_contract', arguments: { maxChars: 4000 } },
    });
    expect(String((tinyContract.result.content as any)[0].text).length).toBeLessThanOrEqual(512);

    const registration = await callJson(client, 'register_scope_account', { accountId: 'cadence-owner', modelId: 'codex', password: 'cadence-owner-password' });
    const accessToken = registration.value.accessToken;
    await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Cadence.md', content: '# Cadence\n\nA note with a declared review cadence.\n',
      frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', review_interval_days: 7 }, expectedRevision: 'missing', accessToken,
    } });
    const before = await callJson(client, 'read_note', { path: 'Knowledge/Cadence.md', includeContent: false, accessToken });
    const reviewed = await callJson(client, 'review_wiki_note', { path: 'Knowledge/Cadence.md', reviewOutcome: 'confirmed', expectedRevision: before.value.revision, accessToken });
    expect(reviewed.value).toMatchObject({ reviewOutcome: 'confirmed', reviewIntervalDays: 7, reviewAt: expect.any(String) });
    const reviewedAt = Date.parse(reviewed.value.reviewedAt);
    const nextReviewAt = Date.parse(reviewed.value.reviewAt);
    expect(nextReviewAt - reviewedAt).toBe(7 * 24 * 60 * 60 * 1000);
  } finally {
    await client.close();
    await server.close();
  }
});

test('authority, maintenance debt, answer packets, and adaptive review stay bounded', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-views-owner', modelId: 'codex', password: 'organization-views-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };
    await write('Knowledge/Anchor.md', '# Anchor\n\nThe anchor claim. [[Knowledge/Support]] and [[Knowledge/Counter]].\n', {
      title: 'Anchor concept', llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', aliases: ['Shared anchor'], preferred_term: 'Anchor concept (canonical)', disambiguation: 'The central organization example', stable_id: 'anchor-concept', review_policy: 'periodic', subject_terms: ['knowledge organization', 'retrieval'], domain: 'information management', methods: ['Zettelkasten'], audience: ['agents'],
    });
    await write('Knowledge/Support.md', '# Support\n\nSupporting context.\n', {
      title: 'Supporting context', llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', aliases: ['Anchor support'], stable_id: 'anchor-support',
    });
    await write('Knowledge/Counter.md', '# Counter\n\nA failed counterexample worth checking.\n', {
      title: 'Counterexample', llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'review', knowledge_status: 'disputed', knowledge_polarity: 'negative', negative_type: 'counterexample', negative_reusable_lesson: 'Check the boundary conditions before reusing the claim.',
    });
    await write('Knowledge/Alias-two.md', '# Alias two\n', {
      title: 'Another concept', llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', aliases: ['Shared anchor'], stable_id: 'another-concept',
    });
    await write('Inbox/Rough.md', '# Rough\n\nUnsorted capture.\n', { note_kind: 'fleeting', lifecycle: 'inbox' });
    await write('Knowledge/Stale.md', '# Stale\n\nBody changed after summary.\n', {
      title: 'Stale projection', llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', summary: 'Old summary', summary_of_content_sha256: '0000000000000000000000000000000000000000000000000000000000000000', updated_at: '2020-01-01T00:00:00.000Z', created_at: '2020-01-01T00:00:00.000Z',
    });
    await write('Knowledge/Legacy-anchor.md', '# Legacy anchor\n\nUse the preferred anchor term instead.\n', {
      title: 'Legacy anchor', llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', term_status: 'deprecated', term_replaced_by: '[[Knowledge/Anchor]]', broader_terms: ['[[Knowledge/Core]]'], related_terms: ['[[Knowledge/Support]]'],
    });
    await write('Knowledge/Project misplaced.md', '# Project misplaced\n\nThis belongs with active work.\n', {
      title: 'Project misplaced', llm_wiki_type: 'knowledge', note_kind: 'project', lifecycle: 'active',
    });
    await write('Knowledge/Open question.md', '# Open question\n\nWhich retrieval projection is most useful?\n', {
      title: 'Open retrieval question', llm_wiki_type: 'knowledge', note_kind: 'question', lifecycle: 'active', epistemic_status: 'open', subject_terms: ['retrieval'], domain: 'information management',
    });

    const authority = await callJson(client, 'get_wiki_authority_map', { query: 'shared anchor', accessToken });
    expect(authority.value.entries).toEqual(expect.arrayContaining([expect.objectContaining({ term: 'Shared anchor', collision: 'term_used_by_multiple_notes', address: expect.any(String), stableIds: expect.arrayContaining(['anchor-concept', 'another-concept']) })]));
    const preferredAuthority = await callJson(client, 'get_wiki_authority_map', { query: 'canonical', accessToken });
    expect(preferredAuthority.value.entries).toEqual(expect.arrayContaining([expect.objectContaining({ term: 'Anchor concept (canonical)', preferred: 'Anchor concept (canonical)', disambiguation: ['The central organization example'] })]));
    const legacyAuthority = await callJson(client, 'get_wiki_authority_map', { query: 'legacy anchor', accessToken });
    expect(legacyAuthority.value.entries).toEqual(expect.arrayContaining([expect.objectContaining({ term: 'Legacy anchor', status: 'deprecated', replacedBy: ['[[Knowledge/Anchor]]'], broaderTerms: ['[[Knowledge/Core]]'] })]));

    const catalog = await callJson(client, 'get_wiki_catalog', { orderBy: 'alphabet', limit: 10, accessToken });
    expect(catalog.value).toMatchObject({ orderBy: 'alphabet' });
    expect(catalog.value.entries[0].title).toBe('Anchor concept');
    const facetedCatalog = await callJson(client, 'get_wiki_catalog', { includeFacets: true, limit: 10, accessToken });
    expect(facetedCatalog.value.facets).toMatchObject({ domain: { 'information management': expect.any(Number) }, subjectTerm: { retrieval: expect.any(Number) }, method: { Zettelkasten: expect.any(Number) }, audience: { agents: expect.any(Number) } });

    const debt = await callJson(client, 'get_wiki_maintenance_debt', { olderThanDays: 30, limit: 20, accessToken });
    expect(debt.value.counts).toMatchObject({ inbox_capture: 1, stale_summary: 1 });
    expect(debt.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Inbox/Rough.md' }), expect.objectContaining({ path: 'Knowledge/Stale.md', priority: 'high' })]));

    const packet = await callJson(client, 'get_wiki_answer_packet', { path: 'Knowledge/Anchor.md', intent: 'decide', includeSemantic: false, maxChars: 5000, accessToken });
    expect(packet.value).toMatchObject({ mode: 'bounded_answer_packet', intent: 'decide', source: expect.objectContaining({ path: 'Knowledge/Anchor.md' }), reasoningTrail: expect.objectContaining({ claims: expect.any(Array), evidence: expect.any(Array), counterexamples: expect.any(Array), gaps: expect.any(Array) }) });
    expect(JSON.stringify(packet.value).length).toBeLessThanOrEqual(5000);
    expect(packet.value.supporting).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Support.md', relationToSource: 'supporting_context' })]));
    expect(packet.value.counterpoints).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Counter.md', relationToSource: 'counterpoint_or_review' })]));
    const neighborhood = await callJson(client, 'get_wiki_neighborhood', { path: 'Knowledge/Anchor.md', includeSemantic: false, maxChars: 4000, accessToken });
    expect(neighborhood.value.neighbors).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Support.md', pathTrace: expect.arrayContaining([expect.stringContaining('direct_link')]) })]));
    const trail = await callJson(client, 'get_wiki_trail', { fromPath: 'Knowledge/Anchor.md', toPath: 'Knowledge/Support.md', maxDepth: 2, accessToken });
    expect(trail.value.paths).toEqual(expect.arrayContaining([expect.objectContaining({ nodes: ['Knowledge/Anchor.md', 'Knowledge/Support.md'], length: 1 })]));
    const placements = await callJson(client, 'get_wiki_placement_candidates', { limit: 10, accessToken });
    expect(placements.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Project misplaced.md', suggestedFolder: 'Projects', reasons: expect.arrayContaining(['project_or_task_outside_projects']) })]));
    const gaps = await callJson(client, 'get_wiki_knowledge_gaps', { limit: 10, accessToken });
    expect(gaps.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Open question.md', noteKind: 'question', epistemicStatus: 'open', reasons: ['question_open'] })]));

    const adaptive = await callJson(client, 'read_note', { path: 'Knowledge/Anchor.md', includeContent: false, accessToken });
    const reviewed = await callJson(client, 'review_wiki_note', { path: 'Knowledge/Anchor.md', reviewOutcome: 'confirmed', reviewedBy: 'codex', expectedRevision: adaptive.value.revision, accessToken });
    expect(reviewed.value).toMatchObject({ adaptiveReviewInterval: true, reviewIntervalDays: 30, reviewAt: expect.any(String) });
    const health = await callJson(client, 'get_wiki_organization_health', { limit: 10, accessToken });
    expect(health.value.quarantine).toMatchObject({ total: expect.any(Number), items: expect.any(Array) });
    expect(health.value.collectionHealth.items).toEqual(expect.arrayContaining([expect.objectContaining({ nextAction: expect.any(String), signals: expect.any(Array), attentionScore: expect.any(Number) })]));
    expect(legacyAuthority.value.entries).toEqual(expect.arrayContaining([expect.objectContaining({ term: 'Legacy anchor', preferred: 'Legacy anchor' })]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('volatility classes control adaptive review defaults and caps without overriding explicit dates', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'volatility-owner', modelId: 'codex', password: 'volatility-owner-password' });
    const accessToken = registration.value.accessToken;
    const cases = [
      { value: 'ephemeral', initial: 7, maximum: 30 },
      { value: 'evolving', initial: 30, maximum: 180 },
      { value: 'durable', initial: 90, maximum: 730 },
      { value: 'foundational', initial: 365, maximum: 3650 },
    ] as const;

    for (const item of cases) {
      const path = `Knowledge/Volatility-${item.value}.md`;
      const createdWrite = await client.callTool({ name: 'write_note', arguments: {
        path,
        content: `# ${item.value}\n\nReview cadence fixture.\n`,
        frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', review_policy: 'periodic', volatility_class: item.value },
        expectedRevision: 'missing',
        accessToken,
      } });
      expect(createdWrite.isError).toBeFalsy();
      const created = await callJson(client, 'read_note', { path, includeContent: false, accessToken });
      let revision = created.value.revision;
      let reviewed = await callJson(client, 'review_wiki_note', { path, reviewOutcome: 'confirmed', expectedRevision: revision, accessToken });
      expect(reviewed.value).toMatchObject({ adaptiveReviewInterval: true, reviewIntervalDays: item.initial, volatilityClass: item.value });
      revision = reviewed.value.revision;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        reviewed = await callJson(client, 'review_wiki_note', { path, reviewOutcome: 'confirmed', expectedRevision: revision, accessToken });
        revision = reviewed.value.revision;
      }
      expect(reviewed.value.reviewIntervalDays).toBe(item.maximum);
    }

    const explicitPath = 'Knowledge/Volatility-explicit.md';
    const explicitWrite = await client.callTool({ name: 'write_note', arguments: {
      path: explicitPath,
      content: '# Explicit review date\n',
      frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', review_policy: 'periodic', volatility_class: 'ephemeral' },
      expectedRevision: 'missing',
      accessToken,
    } });
    expect(explicitWrite.isError).toBeFalsy();
    const explicitCreated = await callJson(client, 'read_note', { path: explicitPath, includeContent: false, accessToken });
    const explicit = await callJson(client, 'review_wiki_note', {
      path: explicitPath,
      reviewOutcome: 'confirmed',
      reviewAt: '2040-01-02T03:04:05.000Z',
      expectedRevision: explicitCreated.value.revision,
      accessToken,
    });
    expect(explicit.value).toMatchObject({ reviewAt: '2040-01-02T03:04:05.000Z', reviewIntervalDays: 7, volatilityClass: 'ephemeral' });

    const revisedPath = 'Knowledge/Volatility-revised.md';
    const revisedWrite = await client.callTool({ name: 'write_note', arguments: {
      path: revisedPath,
      content: '# Revised cadence\n',
      frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', review_policy: 'periodic', volatility_class: 'ephemeral' },
      expectedRevision: 'missing',
      accessToken,
    } });
    expect(revisedWrite.isError).toBeFalsy();
    const revisedCreated = await callJson(client, 'read_note', { path: revisedPath, includeContent: false, accessToken });
    const revised = await callJson(client, 'review_wiki_note', { path: revisedPath, reviewOutcome: 'revised', expectedRevision: revisedCreated.value.revision, accessToken });
    expect(revised.value.reviewIntervalDays).toBe(7);
    const disputed = await callJson(client, 'review_wiki_note', { path: revisedPath, reviewOutcome: 'disputed', expectedRevision: revised.value.revision, accessToken });
    expect(disputed.value.reviewIntervalDays).toBe(7);
  } finally {
    await client.close();
    await server.close();
  }
});

test('authority shelves browse natural scheme order without leaking hidden collisions', async () => {
  await mkdir(join(vault, 'Knowledge'), { recursive: true });
  await mkdir(join(vault, '_scopes', 'models', 'claude'), { recursive: true });
  const authorityNote = (title: string, scheme: string, authorityId?: string, extra = '') => [
    '---', `title: ${title}`, `preferred_term: ${title}`, `authority_scheme: ${scheme}`,
    ...(authorityId ? [`authority_id: ${authorityId}`] : []),
    ...(extra ? extra.split('\n') : []),
    '---', `# ${title}`, '', `${title} body.`, '',
  ].join('\n');
  await writeFile(join(vault, 'Knowledge', 'A.md'), authorityNote('Alpha', 'local-topics', 'AI.2'));
  await writeFile(join(vault, 'Knowledge', 'B.md'), authorityNote('Beta', 'local-topics', 'AI.10'));
  await writeFile(join(vault, 'Knowledge', 'C.md'), authorityNote('Gamma', 'local-topics', 'AI.3', 'aliases:\n  - Third topic\nclose_match:\n  - "[[Knowledge/B]]"'));
  await writeFile(join(vault, 'Knowledge', 'Collision one.md'), authorityNote('Collision one', 'local-topics', 'AI.20'));
  await writeFile(join(vault, 'Knowledge', 'Collision two.md'), authorityNote('Collision two', 'LOCAL-TOPICS', 'ai.20'));
  await writeFile(join(vault, 'Knowledge', 'Unclassified.md'), authorityNote('Unclassified', 'local-topics'));
  await writeFile(join(vault, 'Knowledge', 'Other scheme.md'), authorityNote('Other scheme', 'other-topics', 'AI.3'));
  await writeFile(join(vault, '_scopes', 'models', 'claude', 'Hidden duplicate.md'), authorityNote('Hidden duplicate', 'local-topics', 'AI.3'));

  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'authority-shelf-owner', modelId: 'codex', password: 'authority-shelf-password' });
    const accessToken = registration.value.accessToken;
    const discovery = await callJson(client, 'search_capabilities', { query: 'call number close match authority shelf', limit: 3, maxChars: 4000, accessToken });
    expect(discovery.value.endpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ endpointId: 'wiki.authority_map', available: true }),
    ]));
    const shelf = await callJson(client, 'call_endpoint', { endpointId: 'wiki.authority_map', arguments: {
      scheme: 'local-topics', aroundAuthorityId: 'AI.3', limit: 3, maxChars: 2400, accessToken,
    } });
    expect(shelf.result.isError).toBeFalsy();
    expect(shelf.value).toMatchObject({
      scheme: 'local-topics', order: 'natural_authority_id', anchor: { requested: 'AI.3', matched: true },
    });
    expect(shelf.value.entries.map((entry: any) => entry.authorityId)).toEqual(['AI.2', 'AI.3', 'AI.10']);
    expect(JSON.stringify(shelf.value).length).toBeLessThanOrEqual(2400);
    expect(JSON.stringify(shelf.value)).not.toContain('Hidden duplicate');

    const insertion = await callJson(client, 'call_endpoint', { endpointId: 'wiki.authority_map', arguments: {
      scheme: 'local-topics', aroundAuthorityId: 'AI.4', limit: 2, maxChars: 2400, accessToken,
    } });
    expect(insertion.value.entries.map((entry: any) => entry.authorityId)).toEqual(['AI.3', 'AI.10']);
    expect(insertion.value.anchor).toMatchObject({ requested: 'AI.4', matched: false, insertionIndex: 2 });

    const all = await callJson(client, 'call_endpoint', { endpointId: 'wiki.authority_map', arguments: {
      scheme: 'LOCAL-TOPICS', includeUnclassified: true, limit: 10, maxChars: 5000, accessToken,
    } });
    expect(all.value.entries.at(-1)).toMatchObject({ path: 'Knowledge/Unclassified.md' });
    expect(all.value.entries.at(-1)).not.toHaveProperty('authorityId');
    expect(all.value.collisions).toEqual([
      { authorityId: 'AI.20', paths: ['Knowledge/Collision one.md', 'Knowledge/Collision two.md'] },
    ]);
    expect(JSON.stringify(all.value)).not.toContain('Knowledge/Other scheme.md');

    const filtered = await callJson(client, 'call_endpoint', { endpointId: 'wiki.authority_map', arguments: {
      scheme: 'local-topics', query: 'Third topic', limit: 10, maxChars: 2400, accessToken,
    } });
    expect(filtered.value.entries).toEqual([expect.objectContaining({ path: 'Knowledge/C.md', authorityId: 'AI.3' })]);

    const invalid = await client.callTool({ name: 'call_endpoint', arguments: {
      endpointId: 'wiki.authority_map', arguments: { aroundAuthorityId: 'AI.3', accessToken },
    } });
    expect(invalid.isError).toBe(true);
    expect(String((invalid.content as any)[0]?.text)).toContain('aroundAuthorityId requires scheme');
  } finally {
    await client.close();
    await server.close();
  }
});

test('authority integrity lint validates shapes and visible scheme-local collisions', async () => {
  await mkdir(join(vault, 'Knowledge'), { recursive: true });
  await mkdir(join(vault, '_scopes', 'models', 'claude'), { recursive: true });
  await writeFile(join(vault, 'Knowledge', 'Bad scheme.md'), '---\nauthority_scheme: []\nauthority_id: AI.1\n---\n# Bad scheme\n');
  await writeFile(join(vault, 'Knowledge', 'Bad id.md'), '---\nauthority_scheme: local-topics\nauthority_id: ""\n---\n# Bad id\n');
  await writeFile(join(vault, 'Knowledge', 'Orphan id.md'), '---\nauthority_id: AI.2\n---\n# Orphan id\n');
  await writeFile(join(vault, 'Knowledge', 'A owner.md'), '---\nauthority_scheme: local-topics\nauthority_id: AI.7\nclose_match:\n  - "[[Knowledge/Missing close target]]"\n---\n# A owner\n');
  await writeFile(join(vault, 'Knowledge', 'B duplicate.md'), '---\nauthority_scheme: LOCAL-TOPICS\nauthority_id: ai.7\n---\n# B duplicate\n');
  await writeFile(join(vault, 'Knowledge', 'Cross scheme.md'), '---\nauthority_scheme: other-topics\nauthority_id: AI.7\n---\n# Cross scheme\n');
  await writeFile(join(vault, '_scopes', 'models', 'claude', 'Hidden duplicate.md'), '---\nauthority_scheme: local-topics\nauthority_id: AI.7\n---\n# Hidden duplicate\n');

  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'authority-lint-owner', modelId: 'codex', password: 'authority-lint-password' });
    const accessToken = registration.value.accessToken;
    const lint = await callJson(client, 'lint_wiki', { limit: 200, accessToken });
    expect(lint.value.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_authority_scheme', path: 'Knowledge/Bad scheme.md' }),
      expect.objectContaining({ code: 'invalid_authority_id', path: 'Knowledge/Bad id.md' }),
      expect.objectContaining({ code: 'authority_id_without_scheme', path: 'Knowledge/Orphan id.md' }),
      expect.objectContaining({ code: 'invalid_relation', path: 'Knowledge/A owner.md', detail: expect.stringContaining('close_match') }),
    ]));
    const duplicates = lint.value.issues.filter((issue: any) => issue.code === 'duplicate_authority_id');
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({ path: 'Knowledge/B duplicate.md', detail: expect.stringContaining('Knowledge/A owner.md') });
    expect(JSON.stringify(lint.value)).not.toContain('Hidden duplicate');
    expect(duplicates[0].detail).not.toContain('Cross scheme');

    const health = await callJson(client, 'get_wiki_organization_health', { limit: 100, maxChars: 12000, accessToken });
    expect(health.value.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate_authority_id' }),
      expect.objectContaining({ code: 'authority_id_without_scheme' }),
    ]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('canonical lineage and optional active recall stay in the Markdown organization model', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'lineage-recall-owner', modelId: 'codex', password: 'lineage-recall-password' });
    const accessToken = registration.value.accessToken;
    const write = await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Legacy.md', content: '# Legacy approach\n\nThe older approach.\n', frontmatter: {
        llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'superseded', stable_id: 'legacy-approach', canonical_path: 'Knowledge/Current.md',
        term_status: 'redirect', term_replaced_by: '[[Knowledge/Current]]', same_as: ['[[Knowledge/Current]]'], version_of: ['[[Knowledge/Current]]'],
      }, expectedRevision: 'missing', accessToken,
    } });
    expect(write.isError).toBeFalsy();
    const projection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Legacy.md', accessToken });
    expect(projection.value).toMatchObject({ canonicalPath: 'Knowledge/Current.md', relations: { same_as: ['[[Knowledge/Current]]'], version_of: ['[[Knowledge/Current]]'] } });

    const recallWrite = await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Recall.md', content: '# Recall\n\nA durable fact.\n', frontmatter: {
        llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', recall_prompt: 'What is the durable fact?', recall_interval_days: 1, last_recalled_at: '2020-01-01T00:00:00.000Z', recall_quality: 'partial',
      }, expectedRevision: 'missing', accessToken,
    } });
    expect(recallWrite.isError).toBeFalsy();
    const gaps = await callJson(client, 'get_wiki_knowledge_gaps', { limit: 10, accessToken });
    expect(gaps.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Recall.md', reasons: expect.arrayContaining(['recall_due']), recallPrompt: 'What is the durable fact?' })]));
    const reviewPacket = await callJson(client, 'get_wiki_review_packet', { limit: 10, maxChars: 12000, accessToken });
    const recallPriorities = reviewPacket.value.priorities.filter((item: any) => item.path === 'Knowledge/Recall.md');
    expect(recallPriorities).toHaveLength(1);
    expect(recallPriorities[0]).toMatchObject({ reason: 'active_recall_due', reasons: expect.arrayContaining(['active_recall_due', 'evergreen_quality_hint']), recallPrompt: 'What is the durable fact?', suggestedTool: 'wiki.recall_queue' });
    expect(reviewPacket.value.curationPlan).toMatchObject({
      selected: { path: 'Knowledge/Recall.md', revision: expect.any(String), reason: 'active_recall_due' },
      inspect: { endpointId: 'wiki.recall_queue', targetPath: 'Knowledge/Recall.md' },
      then: { endpointId: 'wiki.record_recall', arguments: { path: 'Knowledge/Recall.md', expectedRevision: expect.any(String) }, requiredArguments: ['recallQuality'] },
    });
    const before = await callJson(client, 'read_note', { path: 'Knowledge/Recall.md', includeContent: false, accessToken });
    const recalled = await callJson(client, 'record_wiki_recall', { path: 'Knowledge/Recall.md', recallQuality: 'good', expectedRevision: before.value.revision, accessToken });
    expect(recalled.value).toMatchObject({ recallQuality: 'good', recallIntervalDays: 1, nextRecallAt: expect.any(String) });
    const after = await callJson(client, 'read_note', { path: 'Knowledge/Recall.md', includeContent: false, accessToken });
    expect(after.value.fm).toMatchObject({ recall_quality: 'good', recall_interval_days: 1 });
  } finally {
    await client.close();
    await server.close();
  }
});

test('agent active recall state is isolated from the shared knowledge note', async () => {
  const { server, client } = await setup();
  try {
    const owner = await callJson(client, 'register_scope_account', { accountId: 'recall-isolation-owner', modelId: 'codex', password: 'recall-isolation-owner-password' });
    const ownerToken = owner.value.accessToken;
    const write = await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Shared recall.md', content: '# Shared recall\n\nA fact shared by all agents.\n',
      frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', recall_prompt: 'What is the shared fact?', recall_interval_days: 1 },
      expectedRevision: 'missing', accessToken: ownerToken,
    } });
    expect(write.isError).toBeFalsy();
    const agent = await callJson(client, 'register_scope_account', { accountId: 'recall-isolation-worker', modelId: 'codex', agentId: 'recall-isolation-worker', userId: 'recall-isolation-owner', password: 'recall-isolation-worker-password', accessToken: ownerToken });
    const agentToken = agent.value.accessToken;
    const before = await callJson(client, 'read_note', { path: 'Knowledge/Shared recall.md', includeContent: false, accessToken: agentToken });
    const recalled = await callJson(client, 'record_wiki_recall', { path: 'Knowledge/Shared recall.md', recallQuality: 'good', expectedRevision: before.value.revision, accessToken: agentToken });
    expect(recalled.value).toMatchObject({ recallQuality: 'good', recallHistoryCount: 1, recallStreak: 1, recallSuccessCount: 1, isolatedTo: expect.stringMatching(/^scope:\/\/agent\/recall-isolation-worker\/_continuity\/recall\/[a-f0-9]{64}\.md$/) });
    const recalledAgain = await callJson(client, 'record_wiki_recall', { path: 'Knowledge/Shared recall.md', recallQuality: 'good', expectedRevision: before.value.revision, accessToken: agentToken });
    expect(recalledAgain.value).toMatchObject({ recallHistoryCount: 2, recallStreak: 2, recallSuccessCount: 2 });
    const after = await callJson(client, 'read_note', { path: 'Knowledge/Shared recall.md', includeContent: false, accessToken: ownerToken });
    expect(after.value.fm).not.toHaveProperty('last_recalled_at');
    expect(after.value.fm).not.toHaveProperty('recall_quality');
  } finally {
    await client.close();
    await server.close();
  }
});

test('vocabulary health detects bounded facet fragmentation and low-selectivity values without leaking hidden notes', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'facet-health-owner', modelId: 'codex', password: 'facet-health-password' });
    const accessToken = registration.value.accessToken;
    for (let index = 0; index < 20; index += 1) {
      const write = await client.callTool({ name: 'write_note', arguments: {
        path: `Knowledge/Facet ${index}.md`, content: `# Facet ${index}\n`,
        frontmatter: { note_kind: 'atomic', lifecycle: 'evergreen', tags: ['common', `niche-${index}`], subject_terms: [`subject-${index}`], domain: 'shared-domain' },
        expectedRevision: 'missing', accessToken,
      } });
      expect(write.isError).toBeFalsy();
    }
    const hidden = await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Hidden facet.md', content: '# Hidden facet\n',
      frontmatter: { note_kind: 'atomic', lifecycle: 'evergreen', tags: ['secret-taxonomy'], moderation_status: 'hidden' },
      expectedRevision: 'missing', accessToken,
    } });
    expect(hidden.isError).toBeFalsy();

    const vocabulary = await callJson(client, 'call_endpoint', { endpointId: 'wiki.vocabulary_health', arguments: { limit: 20, maxChars: 10000, accessToken } });
    expect(vocabulary.value.facets.tag.common).toBe(20);
    expect(vocabulary.value.facets.tag).not.toHaveProperty('secret-taxonomy');
    expect(vocabulary.value.facetHealth.fragmentedFacets).toEqual(expect.arrayContaining([
      expect.objectContaining({ facet: 'tag', distinctValues: 21, singletonValues: 20, reason: 'facet_may_be_overfragmented' }),
    ]));
    expect(vocabulary.value.facetHealth.lowSelectivityValues).toEqual(expect.arrayContaining([
      expect.objectContaining({ facet: 'tag', value: 'common', noteCount: 20, reason: 'facet_value_has_low_selectivity' }),
      expect.objectContaining({ facet: 'domain', value: 'shared-domain', noteCount: 20, reason: 'facet_value_has_low_selectivity' }),
    ]));
    expect(vocabulary.value.facetHealth.advisory).toBe(true);
    expect(vocabulary.value.issueCounts).toMatchObject({ unresolvedSubjectTerms: 20, fragmentedFacets: 2, lowSelectivityValues: 2 });
    expect(vocabulary.value.facetHealth).toMatchObject({ fragmentedTotal: 2, lowSelectivityTotal: 2 });
    const narrowVocabulary = await callJson(client, 'call_endpoint', { endpointId: 'wiki.vocabulary_health', arguments: { limit: 1, maxChars: 10000, accessToken } });
    expect(narrowVocabulary.value.unresolvedSubjectTerms).toHaveLength(1);
    expect(narrowVocabulary.value.facetHealth.fragmentedFacets).toHaveLength(1);
    expect(narrowVocabulary.value.issueCounts).toMatchObject({ unresolvedSubjectTerms: 20, fragmentedFacets: 2, lowSelectivityValues: 2 });
    expect(narrowVocabulary.value.truncated).toBe(true);
    const review = await callJson(client, 'get_wiki_review_packet', { limit: 10, maxChars: 16000, accessToken });
    expect(review.value.counts).toMatchObject({ unresolvedSubjectTerms: 20, fragmentedFacets: 2, lowSelectivityFacetValues: 2 });
    expect(review.value.crossVaultActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'facet_fragmentation_needs_review', inspect: expect.objectContaining({ endpointId: 'wiki.vocabulary_health' }) }),
      expect.objectContaining({ reason: 'facet_low_selectivity_needs_review', inspect: expect.objectContaining({ endpointId: 'wiki.vocabulary_health' }) }),
    ]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('recall queue, near-duplicate review, and typed relation health stay bounded', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-quality-3-owner', modelId: 'codex', password: 'organization-quality-3-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };
    await write('Knowledge/Recall queue.md', '# Recall queue\n\nA durable fact about graph health.\n', {
      llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', recall_prompt: 'What does graph health protect?', recall_interval_days: 1, last_recalled_at: '2020-01-01T00:00:00.000Z', recall_quality: 'failed',
    });
    await write('Knowledge/Agent Memory.md', '# Agent memory\n\nA durable note about agents, memory, graph health, and bounded review.\n', { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen' });
    await write('Knowledge/Agent Memory System.md', '# Agent memory system\n\nA durable note about agents, memory, graph health, and bounded review.\n', { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen' });
    await write('Knowledge/Question.md', '# Question\n', { llm_wiki_type: 'knowledge', note_kind: 'question', lifecycle: 'review', epistemic_status: 'open' });
    await write('Knowledge/Concept.md', '# Concept\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen' });
    await write('Knowledge/Self.md', '# Self\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', related: ['[[Knowledge/Self]]'], answers_questions: ['[[Knowledge/Concept]]'] });
    await write('Knowledge/Topic.md', '# Topic\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen' });
    await write('Knowledge/Related.md', '# Related\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', related: ['[[Knowledge/Topic]]'] });
    await write('Archive/Topic.md', '# Topic archive\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'archived' });
    await write('Knowledge/Ambiguous.md', '# Ambiguous\n', { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'evergreen', related: ['Topic'] });
    await write('Knowledge/Tag One.md', '# Tag One\n', { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', tags: ['Research'], subject_terms: ['Unmodeled concept'] });
    await write('Knowledge/Tag Two.md', '# Tag Two\n', { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', tags: ['research'] });
    await write('Knowledge/Retention.md', '# Retention\n', { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'active', retention_policy: 'archive', retention_at: '2020-01-01', retention_reason: 'Old experiment retained for audit.' });

    const recall = await callJson(client, 'call_endpoint', { endpointId: 'wiki.recall_queue', arguments: { limit: 5, maxChars: 3000, accessToken } });
    expect(recall.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Recall queue.md', reason: 'previous_recall_failed' })]));
    const reviewQueue = await callJson(client, 'get_wiki_review_queue', { limit: 20, maxChars: 8000, accessToken });
    expect(reviewQueue.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Retention.md', retentionDue: true, reviewReasons: expect.arrayContaining(['retention_due']) })]));
    const duplicates = await callJson(client, 'call_endpoint', { endpointId: 'wiki.duplicate_candidates', arguments: { limit: 10, maxChars: 5000, accessToken } });
    expect(duplicates.value.items.some((item: any) => new Set([item.source, item.candidate]).size === 2 && [item.source, item.candidate].some((path: string) => path.endsWith('/Agent Memory.md')) && [item.source, item.candidate].some((path: string) => path.endsWith('/Agent Memory System.md')))).toBe(true);

    const graph = await callJson(client, 'get_wiki_graph_health', { limit: 20, maxChars: 8000, accessToken });
    expect(graph.value.typedRelations.self.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Self.md', relation: 'related' })]));
    expect(graph.value.typedRelations.kindMismatches.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Self.md', relation: 'answers_questions', targetKind: 'knowledge' })]));
    expect(graph.value.typedRelations.reciprocityMissing.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Related.md', relation: 'related', target: 'Knowledge/Topic.md' })]));
    expect(graph.value.typedRelations.ambiguous.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Ambiguous.md', relation: 'related' })]));
    const vocabulary = await callJson(client, 'call_endpoint', { endpointId: 'wiki.vocabulary_health', arguments: { limit: 10, maxChars: 5000, accessToken } });
    expect(vocabulary.value.tagVariants).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'research', reason: 'tag_spelling_or_case_variants' })]));
    expect(vocabulary.value.unresolvedSubjectTerms).toEqual(expect.arrayContaining([expect.objectContaining({ term: 'Unmodeled concept', advisory: true })]));
    const contract = await callJson(client, 'call_endpoint', { endpointId: 'wiki.property_contract', arguments: { maxChars: 4000, accessToken } });
    expect(contract.value.conventions.nativeCompatibility).toMatchObject({ safeTypes: expect.arrayContaining(['list']), mcpManagedComplexFields: expect.arrayContaining(['claims', 'evidence']) });
    const template = await callJson(client, 'call_endpoint', { endpointId: 'wiki.note_template', arguments: { noteKind: 'question', maxChars: 4000, accessToken } });
    expect(template.value).toMatchObject({ templateId: 'question', noteKind: 'question', properties: { epistemic_status: 'open' } });
  } finally {
    await client.close();
    await server.close();
  }
});

test('organization projections expose relation reverse navigation, MOC hierarchy, redirects, and focused Bases views', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-projections-owner', modelId: 'codex', password: 'organization-projections-password' });
    const accessToken = registration.value.accessToken;
    const write = async (path: string, content: string, frontmatter: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'write_note', arguments: { path, content, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(result.isError).toBeFalsy();
    };
    await write('Knowledge/Target.md', '# Target\n\nA durable target. ^target-line\n', { note_kind: 'atomic', lifecycle: 'evergreen', summary: 'Target summary.', primary_moc: '[[Knowledge/MOCs/Parent]]', domain: 'knowledge-management', related_terms: ['[[Knowledge/Support]]'] });
    await write('Knowledge/Support.md', '# Support\n\nSupports the target.\n\nA nearby explanation.\n', { note_kind: 'atomic', lifecycle: 'evergreen', supports: ['[[Knowledge/Target]]'] });
    await write('Knowledge/MOCs/Parent.md', '# Parent MOC\n\n[[Knowledge/MOCs/Child]]\n', { note_kind: 'moc', lifecycle: 'evergreen' });
    await write('Knowledge/MOCs/Child.md', '# Child MOC\n\n[[Knowledge/Target]]\n', { note_kind: 'moc', lifecycle: 'evergreen', moc_parent: '[[Knowledge/MOCs/Parent]]' });
    await write('Knowledge/Old.md', '# Old\n\nHistorical note.\n', { note_kind: 'knowledge', lifecycle: 'superseded', replaced_by: '[[Knowledge/Target]]', retention_reason: 'Replaced by the current target note.', retention_event: 'superseded', preserve_until: '2030-01-01', legal_hold: true });

    const graph = await callJson(client, 'get_wiki_graph_health', { limit: 20, maxChars: 10000, accessToken });
    expect(graph.value.relationNavigation.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Target.md', incoming: expect.arrayContaining([expect.objectContaining({ relation: 'supports', paths: ['Knowledge/Support.md'] })]) }),
    ]));
    expect(graph.value.mocHierarchy).toMatchObject({ total: 2, explicitParentEdges: 1, cycles: { total: 0 }, missingParents: { total: 0 } });
    expect(graph.value.mocHierarchy.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/MOCs/Child.md', state: 'nested', resolvedParent: 'Knowledge/MOCs/Parent.md' }),
    ]));

    const projection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Old.md', view: 'summary', accessToken });
    expect(projection.value.redirect).toMatchObject({ state: 'superseded', replacement: '[[Knowledge/Target]]', action: 'preserve_under_hold' });
    expect(projection.value).toMatchObject({ retentionEvent: 'superseded', preserveUntil: '2030-01-01', legalHold: true });

    const targetProjection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Target.md', view: 'summary', accessToken });
    expect(targetProjection.value.navigation).toMatchObject({ primaryMoc: '[[Knowledge/MOCs/Parent]]', domain: 'knowledge-management' });
    const blockProjection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Target.md', view: 'section', blockId: 'target-line', contextBefore: 1, contextAfter: 1, accessToken });
    expect(blockProjection.value).toMatchObject({ section: { startLine: 12, endLine: 12 }, context: { target: { startLine: 12, endLine: 12 } } });
    expect(blockProjection.value.context.after).toEqual(expect.arrayContaining([expect.objectContaining({ line: 13 })]));

    const bases = await callJson(client, 'get_wiki_bases_view', { view: 'inbox_oldest', accessToken });
    expect(bases.value).toMatchObject({ view: 'inbox_oldest', matchingNotesExact: true });
    expect(bases.value.content).toContain('note.lifecycle == "inbox"');
    expect(bases.value.content).toContain('note.captured_at');
  } finally {
    await client.close();
    await server.close();
  }
});

test('triage persists primary MOC and retention safety metadata through the endpoint', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'organization-retention-owner', modelId: 'codex', password: 'organization-retention-password' });
    const accessToken = registration.value.accessToken;
    const captured = await callJson(client, 'capture_wiki_note', { path: 'Inbox/Retention capture.md', content: 'A captured preservation decision.', expectedRevision: 'missing', accessToken });
    const triaged = await callJson(client, 'triage_wiki_note', {
      path: 'Inbox/Retention capture.md', expectedRevision: captured.value.revision, accessToken,
      primaryMoc: '[[Knowledge/MOCs/Operations]]', retentionEvent: 'created', preserveUntil: '2031-01-01', legalHold: true,
    });
    expect(triaged.value.frontmatter).toMatchObject({ primaryMoc: '[[Knowledge/MOCs/Operations]]', retentionEvent: 'created', preserveUntil: '2031-01-01', legalHold: true });
  } finally {
    await client.close();
    await server.close();
  }
});

test('remaining organization loops connect issue retrospectives, recall repair, search learning, source lineage, and portable manifests', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'remaining-loops-owner', modelId: 'codex', password: 'remaining-loops-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', {
      sourceId: 'remaining-source-edition-1', title: 'Remaining source edition', content: '# Source\n\nEdition one.\n', capturedBy: 'codex',
      sourceWorkId: 'remaining-source-work', sourceEditionId: 'edition-1', accessToken,
    });
    const lineage = await callJson(client, 'get_wiki_source_lineage', { accessToken, maxChars: 8000 });
    expect(lineage.value.works).toEqual(expect.arrayContaining([expect.objectContaining({ workId: 'remaining-source-work', editionCount: 1, editions: expect.arrayContaining([expect.objectContaining({ editionId: 'edition-1', sourceId: 'remaining-source-edition-1', integrity: 'intact' })]) })]));

    const issue = await callJson(client, 'report_wiki_issue', { issueId: 'remaining-exception', kind: 'other', title: 'Remaining exception', description: 'An exception to learn from.', accessToken });
    const resolved = await callJson(client, 'resolve_wiki_issue', {
      path: issue.value.path, expectedRevision: issue.value.revision, resolution: 'Fixed the immediate cause.', resolutionStatus: 'resolved',
      retrospectiveStatus: 'synthesized', retrospective: 'Add a regression check before changing the reader contract.', accessToken,
    });
    expect(resolved.value).toMatchObject({ status: 'resolved', retrospectiveStatus: 'synthesized' });
    const issueNote = await callJson(client, 'read_note', { path: issue.value.path, accessToken });
    expect(issueNote.value.fm).toMatchObject({ issue_resolution_status: 'resolved', issue_retrospective_status: 'synthesized', issue_retrospective: 'Add a regression check before changing the reader contract.' });

    await client.callTool({ name: 'write_note', arguments: { path: 'Knowledge/Recall repair.md', content: '# Recall repair\n', frontmatter: { note_kind: 'atomic', lifecycle: 'evergreen' }, expectedRevision: 'missing', accessToken } });
    const knowledgeWrite = await client.callTool({ name: 'write_note', arguments: { path: 'Knowledge/Recall target.md', content: '# Recall target\n\nThe durable fact.\n', frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', recall_prompt: 'What is the durable fact?', evidence_paths: [source.value.path] }, expectedRevision: 'missing', accessToken } });
    expect(knowledgeWrite.isError).toBeFalsy();
    const knowledge = await callJson(client, 'read_note', { path: 'Knowledge/Recall target.md', accessToken });
    const recalled = await callJson(client, 'record_wiki_recall', { path: 'Knowledge/Recall target.md', recallQuality: 'failed', confusion: 'Confused the edition label with the source work.', repairPath: 'Knowledge/Recall repair.md', expectedRevision: knowledge.value.revision, accessToken });
    expect(recalled.value).toMatchObject({ recallQuality: 'failed', repairStatus: 'in_progress', repairPath: 'Knowledge/Recall repair.md' });
    const queue = await callJson(client, 'get_wiki_recall_queue', { accessToken, limit: 10 });
    expect(queue.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Recall target.md', repairStatus: 'in_progress', repairPath: 'Knowledge/Recall repair.md' })]));

    await callJson(client, 'search_notes', { query: 'never-existing-search-term', accessToken });
    const feedback = await callJson(client, 'record_search_feedback', { query: 'never-existing-search-term', outcome: 'failed', note: 'Add a retrieval cue if this concept is durable.', accessToken });
    expect(feedback.value).toMatchObject({ tracked: true, query: 'never-existing-search-term', feedbackFailures: 1 });
    const improvements = await callJson(client, 'get_search_improvement_candidates', { accessToken });
    expect(improvements.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ query: 'never-existing-search-term', reasons: expect.arrayContaining(['zero_results', 'explicit_failure']) })]));

    const manifest = await callJson(client, 'get_wiki_organization_manifest', { accessToken, maxChars: 12000 });
    expect(manifest.value).toMatchObject({ format: 'mcpvault-organization-manifest', portable: true, contracts: expect.objectContaining({ relations: expect.any(Array) }), reservedPaths: expect.arrayContaining(['.mcpvault/']) });
  } finally {
    await client.close();
    await server.close();
  }
});

test('archival finding aid preserves collection context and original order without loading source bodies', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'archive-owner', modelId: 'codex', password: 'archive-owner-password' });
    const accessToken = registration.value.accessToken;
    for (const source of [
      { sourceId: 'archive-third', title: 'Third interview', content: '# Third\n\nBody must not appear in the finding aid.\n', archiveCollectionId: 'fieldwork-2030', archiveSeries: ['Interviews', 'Experts'], archiveSequence: 3, accessionId: 'acc-2030-01' },
      { sourceId: 'archive-first', title: 'First interview', content: '# First\n\nPrivate-looking source body marker.\n', archiveCollectionId: 'fieldwork-2030', archiveSeries: ['Interviews', 'Experts'], archiveSequence: 1, accessionId: 'acc-2030-01', custodialHistory: 'Transferred from the field recorder.', originalOrderNote: 'Recorder sequence retained.' },
      { sourceId: 'archive-duplicate', title: 'Duplicate position', content: '# Duplicate\n\nDuplicate order test.\n', archiveCollectionId: 'fieldwork-2030', archiveSeries: ['Interviews', 'Experts'], archiveSequence: 1, accessionId: 'acc-2030-02' },
      { sourceId: 'archive-other', title: 'Other collection', content: '# Other\n\nOther collection.\n', archiveCollectionId: 'lab-2030', archiveSeries: ['Runs'], archiveSequence: 1 },
    ]) {
      const ingested = await callJson(client, 'ingest_source', { ...source, accessToken });
      expect(ingested.result.isError).toBeFalsy();
    }
    const invalid = await client.callTool({ name: 'ingest_source', arguments: { sourceId: 'archive-invalid', title: 'Invalid archive source', content: '# Invalid\n', archiveSeries: ['Unowned series'], accessToken } });
    expect(invalid.isError).toBe(true);

    const overview = await callJson(client, 'get_wiki_archive_finding_aid', { accessToken, limit: 20, maxChars: 9000 });
    expect(overview.value).toMatchObject({ mode: 'archive_finding_aid_overview', totals: { archivalSources: 4, collections: 2, collectionsExact: true } });
    expect(overview.value.collections).toEqual(expect.arrayContaining([
      expect.objectContaining({ collectionId: 'fieldwork-2030', sourceCount: 3, originalOrder: { sequenced: 3, unsequenced: 0 }, seriesCount: 1, accessionCount: 2 }),
    ]));
    expect(JSON.stringify(overview.value)).not.toContain('Private-looking source body marker');

    const detail = await callJson(client, 'get_wiki_archive_finding_aid', { collectionId: 'fieldwork-2030', series: ['Interviews'], accessToken, limit: 20, maxChars: 9000 });
    expect(detail.value).toMatchObject({ mode: 'archive_finding_aid_detail', totals: { matchingSources: 3 } });
    expect(detail.value.items.map((item: any) => item.sequence)).toEqual([1, 1, 3]);
    expect(detail.value.items.every((item: any) => typeof item.revision === 'string' && item.revision.length === 64)).toBe(true);
    expect(detail.value.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'duplicate_archive_sequence', sequence: 1 })]));
    const tiny = await callJson(client, 'get_wiki_archive_finding_aid', { collectionId: 'fieldwork-2030', accessToken, limit: 20, maxChars: 512 });
    expect(JSON.stringify(tiny.value).length).toBeLessThanOrEqual(512);
    expect(tiny.value.truncated).toBe(true);

    const bases = await callJson(client, 'get_wiki_bases_view', { view: 'archives', accessToken, maxChars: 12000 });
    expect(bases.value).toMatchObject({ view: 'archives', matchingNotes: 4, matchingNotesExact: true, suggestedPath: 'Views/LLM Wiki Source Archives.base' });
    expect(bases.value.content).toContain('note.archive_collection_id');

    const capabilities = await callJson(client, 'search_capabilities', { query: 'archive original order', accessToken, limit: 5 });
    expect(capabilities.value.endpoints).toEqual(expect.arrayContaining([expect.objectContaining({ endpointId: 'wiki.archive_finding_aid' })]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('portable migration preflight excludes non-global content and reports revision-safe compatibility hazards', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'portable-owner', userId: 'portable-family', modelId: 'codex', agentId: 'portable-worker', password: 'portable-owner-password' });
    const accessToken = registration.value.accessToken;
    for (const [path, frontmatter] of [
      ['Knowledge/Portable One.md', { title: 'Portable One', note_kind: 'atomic', lifecycle: 'evergreen', stable_id: 'portable-shared', aliases: ['공통 용어'], tags: ['portable'], authority_scheme: 'portable-topics', authority_id: 'AI.1', supports: ['[[Missing Portable Target]]'], close_match: ['[[Knowledge/Portable Two]]'] }],
      ['Knowledge/Portable Two.md', { title: 'Portable Two', note_kind: 'atomic', lifecycle: 'evergreen', stable_id: 'portable-shared', aliases: ['공통 용어'], tags: 'portable', authority_scheme: 'portable-topics', authority_id: 'AI.2', close_match: ['[[Knowledge/Portable One]]'] }],
    ] as const) {
      const written = await client.callTool({ name: 'write_note', arguments: { path, content: `# ${frontmatter.title}\n`, frontmatter, expectedRevision: 'missing', accessToken } });
      expect(written.isError).toBeFalsy();
    }
    await client.callTool({ name: 'write_note', arguments: { path: 'scope://agent/portable-worker/Private.md', content: '# Private\nNever export.', frontmatter: { stable_id: 'private-id' }, expectedRevision: 'missing', accessToken } });
    await client.callTool({ name: 'write_note', arguments: { path: 'Knowledge/Quarantined Portable.md', content: '# Quarantined\nNever export.', frontmatter: { note_kind: 'atomic', moderation_status: 'quarantined', stable_id: 'quarantined-id' }, expectedRevision: 'missing', accessToken } });
    await callJson(client, 'publish_blog_post', { slug: 'portable-community-only', title: 'Community only', content: 'Never enter a global migration inventory.', expectedRevision: 'missing', accessToken });

    const defaultManifest = await callJson(client, 'get_wiki_organization_manifest', { accessToken });
    expect(defaultManifest.value).toMatchObject({
      manifestVersion: 7,
      portable: true,
      contentFreeByDefault: true,
      contractFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      reviewCadence: {
        volatilityProperty: 'volatility_class',
        classes: ['ephemeral', 'evolving', 'durable', 'foundational'],
        explicitDatesPrecedeDefaults: true,
        cascade: 'bounded_explicit_upstream_projection',
      },
      authority: {
        identity: ['authority_scheme', 'authority_id'],
        identityScope: 'scheme_local',
        shelfOrder: 'natural_authority_id',
        relationStrength: ['same_as', 'close_match', 'broader', 'related'],
      },
      templates: expect.arrayContaining(['concept', 'model']),
      basesViews: expect.arrayContaining(['concepts', 'authority', 'archives']),
      contracts: expect.objectContaining({ claimRoles: expect.arrayContaining(['premise', 'conclusion', 'objection']), claimRelations: expect.arrayContaining(['supports_claims', 'contradicts_claims', 'depends_on_claims']) }),
    });
    expect(defaultManifest.value.truncated).toBeUndefined();
    expect(defaultManifest.value.contracts.properties).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'task_status', type: 'text', allowed: expect.arrayContaining(['open', 'completed']) }),
      expect.objectContaining({ name: 'project_purpose', type: 'text', appliesTo: ['project'] }),
    ]));
    expect(defaultManifest.value.contracts.properties[0].description).toBeUndefined();
    const selfCompared = await callJson(client, 'get_wiki_organization_manifest', {
      compareManifest: defaultManifest.value,
      expectedCounterpartFingerprint: defaultManifest.value.contractFingerprint,
      limit: 50,
      maxChars: 24000,
      accessToken,
    });
    expect(selfCompared.value.migrationPreview).toMatchObject({ compatible: true, blockingIssues: 0, counterpartChanged: false });
    expect(selfCompared.value.migrationPreview.issueCounts).toEqual({});
    expect(defaultManifest.value.readiness).toBeUndefined();
    expect(JSON.stringify(defaultManifest.value)).not.toContain('Portable One');

    const readiness = await callJson(client, 'get_wiki_organization_manifest', { includeReadiness: true, limit: 50, maxChars: 24000, accessToken });
    expect(readiness.value.readiness).toMatchObject({ scope: 'global_only', bodyContentIncluded: false, privateOrCommunityContentIncluded: false, safeToMigrate: false, excludedModerated: 1 });
    expect(readiness.value.readiness.issueCounts).toMatchObject({ duplicate_stable_id: 1, vocabulary_collision: 1, property_type_drift: 1, missing_relation_target: 1 });
    expect(readiness.value.readiness.inventory.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Portable One.md', revision: expect.stringMatching(/^[a-f0-9]{64}$/) })]));
    expect(readiness.value.readiness.inventory.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Portable One.md', relations: expect.objectContaining({ close_match: ['[[Knowledge/Portable Two]]'] }) }),
    ]));
    expect(JSON.stringify(readiness.value.readiness)).not.toContain('portable-community-only');
    expect(JSON.stringify(readiness.value.readiness)).not.toContain('Private.md');
    expect(JSON.stringify(readiness.value.readiness)).not.toContain('Quarantined Portable');

    const legacyVersionFive = structuredClone(defaultManifest.value);
    legacyVersionFive.manifestVersion = 5;
    delete legacyVersionFive.authority;
    delete legacyVersionFive.contractFingerprint;
    const legacyCompared = await callJson(client, 'get_wiki_organization_manifest', { compareManifest: legacyVersionFive, limit: 50, maxChars: 24000, accessToken });
    expect(legacyCompared.value.migrationPreview.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'older_manifest_version', severity: 'warning', detail: expect.stringContaining('reviewed migration') }),
      expect.objectContaining({ code: 'missing_authority_contract', severity: 'warning' }),
    ]));

    const legacyVersionSix = structuredClone(defaultManifest.value);
    legacyVersionSix.manifestVersion = 6;
    delete legacyVersionSix.reviewCadence;
    delete legacyVersionSix.contractFingerprint;
    const cadenceMigration = await callJson(client, 'get_wiki_organization_manifest', { compareManifest: legacyVersionSix, limit: 50, maxChars: 24000, accessToken });
    expect(cadenceMigration.value.migrationPreview.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'older_manifest_version', severity: 'warning' }),
      expect.objectContaining({ code: 'missing_review_cadence_contract', severity: 'warning' }),
    ]));

    const conflictingCadence = structuredClone(defaultManifest.value);
    conflictingCadence.reviewCadence.classes = ['foundational', 'durable', 'evolving', 'ephemeral'];
    const cadenceConflict = await callJson(client, 'get_wiki_organization_manifest', { compareManifest: conflictingCadence, limit: 50, maxChars: 24000, accessToken });
    expect(cadenceConflict.value.migrationPreview).toMatchObject({ compatible: false, blockingIssues: expect.any(Number) });
    expect(cadenceConflict.value.migrationPreview.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'review_cadence_contract_conflict', severity: 'blocking' }),
    ]));

    const conflictingVersionSix = structuredClone(defaultManifest.value);
    conflictingVersionSix.authority.shelfOrder = 'lexicographic_path';
    const authorityConflict = await callJson(client, 'get_wiki_organization_manifest', { compareManifest: conflictingVersionSix, limit: 50, maxChars: 24000, accessToken });
    expect(authorityConflict.value.migrationPreview).toMatchObject({ compatible: false, blockingIssues: expect.any(Number) });
    expect(authorityConflict.value.migrationPreview.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'authority_contract_conflict', severity: 'blocking' }),
    ]));

    const counterpart = {
      manifestVersion: 1,
      format: 'mcpvault-organization-manifest',
      reservedPaths: ['Community/'],
      contracts: {
        noteKinds: ['atomic'], lifecycles: ['evergreen'], taskStatuses: [], serviceClasses: [],
        properties: [
          { name: 'aliases', type: 'text' },
          { name: 'task_status', type: 'text', allowed: ['open'] },
          { name: 'project_purpose', type: 'text', appliesTo: ['atomic'] },
        ],
        relations: [{ field: 'related', direction: 'mutual', reciprocal: false }],
      },
    };
    const compared = await callJson(client, 'get_wiki_organization_manifest', { compareManifest: counterpart, expectedCounterpartFingerprint: 'a'.repeat(64), limit: 50, maxChars: 24000, accessToken });
    expect(compared.value.migrationPreview).toMatchObject({ mutatesVault: false, compatible: false, counterpartChanged: true });
    expect(compared.value.migrationPreview.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'counterpart_changed', severity: 'blocking' }),
      expect.objectContaining({ code: 'property_contract_type_conflict', severity: 'blocking' }),
      expect.objectContaining({ code: 'property_contract_vocabulary_conflict', severity: 'blocking' }),
      expect.objectContaining({ code: 'property_contract_applicability_conflict', severity: 'blocking' }),
      expect.objectContaining({ code: 'relation_reciprocity_conflict', severity: 'blocking' }),
    ]));
    expect(compared.value.migrationPreview.issueCounts).toMatchObject({ missing_templates: 1, missing_bases_views: 1 });
    expect(compared.value.migrationPreview.issueCounts.missing_relation_contract).toBeGreaterThan(0);
    const tinyCompared = await callJson(client, 'get_wiki_organization_manifest', { compareManifest: counterpart, expectedCounterpartFingerprint: 'a'.repeat(64), limit: 50, maxChars: 512, prettyPrint: true, accessToken });
    expect(String((tinyCompared.result.content as any)[0].text).length).toBeLessThanOrEqual(512);
    expect(tinyCompared.value.contractFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(tinyCompared.value.migrationPreview).toMatchObject({ compatible: false, blockingIssues: expect.any(Number) });
  } finally {
    await client.close();
    await server.close();
  }
});

test('curation, synthesis, discussion, task lessons, and interrupted edits expose exact revision-safe next actions', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'workflow-owner', userId: 'workflow-family', modelId: 'codex', agentId: 'workflow-worker', password: 'workflow-owner-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', { sourceId: 'workflow-source', title: 'Workflow source', content: '# Evidence\n\nA checked fact.\n', capturedBy: 'codex', accessToken });
    const published = await callJson(client, 'publish_knowledge', { path: 'Knowledge/Workflow synthesis.md', content: '# Workflow synthesis\n\nA checked claim.\n', evidencePaths: [source.value.path], keyPoints: ['A checked claim'], status: 'draft', expectedRevision: 'missing', accessToken });
    const packet = await callJson(client, 'get_wiki_answer_packet', { path: 'Knowledge/Workflow synthesis.md', intent: 'decide', maxChars: 12000, accessToken });
    expect(packet.value.synthesisPlan).toMatchObject({ status: 'needs_counterpoint_review', inputs: expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Workflow synthesis.md', revision: published.value.revision })]), nextAction: { endpointId: 'wiki.neighborhood', arguments: { path: 'Knowledge/Workflow synthesis.md', includeSemantic: false } } });
    const smallPacket = await callJson(client, 'get_wiki_answer_packet', { path: 'Knowledge/Workflow synthesis.md', intent: 'decide', maxChars: 1024, accessToken });
    expect((smallPacket.result.content as any)[0].text.length).toBeLessThanOrEqual(1024);
    expect(smallPacket.value.synthesisPlan.nextAction.endpointId).toBe('wiki.neighborhood');

    const capture = await callJson(client, 'capture_wiki_note', { title: 'Interrupted curation', content: 'Clarify this capture later.', expectedRevision: 'missing', accessToken });
    const maintenance = await callJson(client, 'get_wiki_maintenance_debt', { limit: 20, maxChars: 12000, accessToken });
    expect(maintenance.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: capture.value.path, revision: capture.value.revision, curationPlan: expect.objectContaining({ then: expect.objectContaining({ endpointId: 'wiki.clarify', arguments: { path: capture.value.path, expectedRevision: capture.value.revision } }) }) })]));
    const smallMaintenance = await callJson(client, 'get_wiki_maintenance_debt', { limit: 20, maxChars: 700, accessToken });
    expect((smallMaintenance.result.content as any)[0].text.length).toBeLessThanOrEqual(700);
    expect(smallMaintenance.value.nextAction.endpointId).toBe('wiki.answer_packet');
    const reviewPacket = await callJson(client, 'get_wiki_review_packet', { limit: 20, maxChars: 12000, accessToken });
    expect(reviewPacket.value.curationPlan.selected.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(reviewPacket.value.curationPlan.inspect.endpointId).toBe('wiki.answer_packet');
    const smallReviewPacket = await callJson(client, 'get_wiki_review_packet', { limit: 20, maxChars: 700, accessToken });
    expect((smallReviewPacket.result.content as any)[0].text.length).toBeLessThanOrEqual(700);
    expect(smallReviewPacket.value.selected.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(smallReviewPacket.value.nextAction.endpointId).toBe('wiki.answer_packet');

    const task = await callJson(client, 'create_agent_task', { taskId: 'workflow-lesson', title: 'Learn from indexing', description: 'Check the index repair flow.', expectedRevision: 'missing', accessToken });
    await callJson(client, 'update_agent_task', { taskId: 'workflow-lesson', status: 'completed', reason: 'The repair path was verified.', retrospective: 'Index repairs need a revision guard and a post-write read.', expectedRevision: task.value.revision, accessToken });
    const promotion = await callJson(client, 'get_wiki_promotion_candidates', { limit: 20, maxChars: 16000, accessToken });
    expect(promotion.value.items).toEqual(expect.arrayContaining([expect.objectContaining({ sourceType: 'completed_task', taskId: 'workflow-lesson', revision: expect.stringMatching(/^[a-f0-9]{64}$/), promotionPlan: expect.objectContaining({ inspect: expect.objectContaining({ endpointId: 'mcp.read_agent_task' }) }) })]));
    const smallPromotion = await callJson(client, 'get_wiki_promotion_candidates', { limit: 20, maxChars: 700, accessToken });
    expect((smallPromotion.result.content as any)[0].text.length).toBeLessThanOrEqual(700);
    expect(smallPromotion.value.items?.[0]?.nextAction?.endpointId || smallPromotion.value.nextAction?.endpointId).toBe('mcp.read_agent_task');

    const checkpoint = await callJson(client, 'save_work_state', {
      topic: 'Interrupted organization edits', summary: 'Two changes were planned but not applied.', nextAction: 'Re-read both notes and resume only if revisions still match.',
      pendingEdits: [
        { path: 'Knowledge/Workflow synthesis.md', expectedRevision: published.value.revision, endpointId: 'wiki.review', purpose: 'Complete evidence review.' },
        { path: capture.value.path, expectedRevision: capture.value.revision, endpointId: 'wiki.clarify', purpose: 'Choose a final disposition.' },
      ],
      accessToken,
    });
    const resumed = await callJson(client, 'resume_work_state', { accessToken });
    expect(checkpoint.value.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(resumed.value.fm.pending_edits).toHaveLength(2);
    expect(resumed.value.fm.pending_edits[0]).toMatchObject({ expectedRevision: published.value.revision, endpointId: 'wiki.review' });
  } finally {
    await client.close();
    await server.close();
  }
});

test('mixed Korean and English retrieval keeps durable Wiki context ahead of noisy community matches', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'retrieval-owner', userId: 'retrieval-family', modelId: 'codex', agentId: 'retrieval-worker', password: 'retrieval-owner-password' });
    const accessToken = registration.value.accessToken;
    const source = await callJson(client, 'ingest_source', { sourceId: 'retrieval-source', title: 'Retrieval source', content: '# Retrieval source\n\nRAG combines retrieval with generation. 검색 증강 생성은 검색 결과를 생성 과정에 연결한다.\n', capturedBy: 'codex', accessToken });
    for (const [path, title] of [['Maps/검색 MOC.md', '검색 MOC'], ['Maps/AI MOC.md', 'AI MOC']] as const) {
      await client.callTool({ name: 'write_note', arguments: { path, content: `# ${title}\n\n- [[Knowledge/RAG Guide]]\n`, frontmatter: { note_kind: 'moc', lifecycle: 'active', moc_purpose: `${title} navigation`, moc_questions: ['RAG는 언제 유용한가?'] }, expectedRevision: 'missing', accessToken } });
    }
    const main = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/RAG Guide.md', content: '# 검색 증강 생성\n\n검색과 생성을 결합해 근거를 찾은 뒤 답을 구성한다.\n', evidencePaths: [source.value.path],
      aliases: ['RAG', 'retrieval augmented generation', '회수 증강 생성'], primaryMoc: '[[Maps/검색 MOC]]', mocs: ['[[Maps/AI MOC]]'],
      summary: 'RAG는 검색 결과를 생성에 연결한다.', keyPoints: ['검색과 생성을 분리해 검증한다.'], openQuestions: ['검색 실패를 어떻게 드러낼까?'], status: 'draft', expectedRevision: 'missing', accessToken,
    });
    const patched = await callJson(client, 'patch_note', { path: 'Knowledge/RAG Guide.md', oldString: '답을 구성한다.', newString: '검증 가능한 답을 구성한다.', expectedRevision: main.value.revision, accessToken });
    expect(patched.value.success).toBe(true);
    await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/RAG Alternate.md', content: '# RAG alternate meaning\n\nRAG can also be an ambiguous local abbreviation.\n', evidencePaths: [source.value.path], aliases: ['RAG'], status: 'draft', expectedRevision: 'missing', accessToken,
    });
    await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/RAG Failure.md', content: '# RAG failure\n\n검색 결과가 부정확하면 생성도 근거 없이 강화될 수 있다.\n', evidencePaths: [source.value.path],
      relations: { contradicts: ['[[Knowledge/RAG Guide]]'] }, polarity: 'negative', negativeType: 'counterexample',
      attempted: 'Use retrieved passages without checking relevance.', observed: 'The answer amplified an irrelevant passage.', failureCondition: 'Low-relevance retrieval.', reproduction: 'Query an ambiguous acronym.', whyRejected: 'Similarity alone is not evidence.', reusableLesson: 'Inspect relevance and preserve a counterpoint.', status: 'disputed', expectedRevision: 'missing', accessToken,
    });
    for (let index = 0; index < 8; index += 1) {
      await callJson(client, 'publish_blog_post', { slug: `rag-noise-${index}`, title: `회수 증강 생성 community thread ${index}`, content: `회수 증강 생성 discussion ${index}. ${'long community context '.repeat(120)}`, category: 'discussion', expectedRevision: 'missing', accessToken });
    }

    const search = await callJson(client, 'search_notes', { query: '회수 증강 생성', limit: 6, maxChars: 2200, includeRevisions: true, accessToken });
    expect((search.result.content as any)[0].text.length).toBeLessThanOrEqual(2200);
    expect(search.value[0]).toMatchObject({ wk: true, why: expect.arrayContaining(['wiki_priority']), rv: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const mainHit = search.value.find((item: any) => item.p === 'Knowledge/RAG Guide.md');
    expect(mainHit).toMatchObject({ why: expect.arrayContaining(['alias_match']), next: 'read_projection' });
    const firstCommunity = search.value.findIndex((item: any) => String(item.p).startsWith('Community/'));
    const lastWiki = search.value.reduce((last: number, item: any, index: number) => item.wk ? index : last, -1);
    expect(firstCommunity === -1 || lastWiki < firstCommunity).toBe(true);
    expect(search.value.every((item: any) => String(item.ex || '').length <= 60)).toBe(true);
    const ambiguous = await callJson(client, 'search_notes', { query: 'RAG', limit: 6, maxChars: 2200, accessToken });
    expect(ambiguous.value.filter((item: any) => item.wk).map((item: any) => item.p)).toEqual(expect.arrayContaining(['Knowledge/RAG Guide.md', 'Knowledge/RAG Alternate.md']));

    const packet = await callJson(client, 'get_wiki_answer_packet', { path: 'Knowledge/RAG Guide.md', intent: 'decide', includeSemantic: false, maxChars: 5000, accessToken });
    expect(packet.value.source).toMatchObject({ path: 'Knowledge/RAG Guide.md', revision: patched.value.revision, summaryStale: true, navigation: expect.objectContaining({ primaryMoc: expect.anything() }) });
    expect(packet.value.counterpoints).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/RAG Failure.md', relationToSource: 'counterpoint_or_review' })]));
    expect(packet.value.reasoningTrail.counterexamples).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/RAG Failure.md', revision: expect.stringMatching(/^[a-f0-9]{64}$/) })]));
    expect(packet.value.synthesisPlan.status).toBe('ready_for_decision_draft');
    expect(JSON.stringify(packet.value)).not.toContain('long community context long community context long community context');
  } finally {
    await client.close();
    await server.close();
  }
});

test('temporal validity and source-work diversity remain bounded review signals', async () => {
  const { server, client } = await setup();
  try {
    const registration = await callJson(client, 'register_scope_account', { accountId: 'temporal-owner', modelId: 'codex', password: 'temporal-owner-password' });
    const accessToken = registration.value.accessToken;
    const sourceA1 = await callJson(client, 'ingest_source', { sourceId: 'temporal-a1', title: 'Study A first snapshot', content: '# Study A\n\nFirst retrieval.\n', sourceWorkId: 'study-a', sourceEditionId: 'edition-1', accessToken });
    const sourceA2 = await callJson(client, 'ingest_source', { sourceId: 'temporal-a2', title: 'Study A second snapshot', content: '# Study A\n\nSecond retrieval.\n', sourceWorkId: 'study-a', sourceEditionId: 'edition-2', accessToken });
    const sourceB = await callJson(client, 'ingest_source', { sourceId: 'temporal-b', title: 'Study B', content: '# Study B\n\nIndependent work.\n', sourceWorkId: 'study-b', sourceEditionId: 'edition-1', accessToken });
    const published = await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Time bounded claim.md', content: '# Time bounded claim\n\nThis condition applies only during the declared window.\n',
      evidencePaths: [sourceA1.value.path, sourceA2.value.path, sourceB.value.path],
      claims: [
        { id: 'same-work-snapshots', text: 'Two snapshots represent one underlying study.', evidencePaths: [sourceA1.value.path, sourceA2.value.path], status: 'supported', confidence: 'high' },
        { id: 'independent-study', text: 'A second source work reports an independent observation.', evidencePaths: [sourceB.value.path], status: 'unverified', confidence: 'medium' },
        { id: 'combined-view', text: 'The combined view draws on two distinct source works.', evidencePaths: [sourceA1.value.path, sourceA2.value.path, sourceB.value.path], status: 'supported', confidence: 'medium' },
      ],
      validFrom: '2030-01-01T00:00:00.000Z', validUntil: '2030-02-01T00:00:00.000Z', observedAt: '2029-12-20T00:00:00.000Z', temporalScope: '2030 winter policy window',
      expectedRevision: 'missing', accessToken,
    });
    expect(published.value.revision).toMatch(/^[a-f0-9]{64}$/);
    const projection = await callJson(client, 'read_wiki_projection', { path: 'Knowledge/Time bounded claim.md', accessToken });
    expect(projection.value.temporal).toMatchObject({ state: 'not_yet_valid', validFrom: '2030-01-01T00:00:00.000Z', validUntil: '2030-02-01T00:00:00.000Z', observedAt: '2029-12-20T00:00:00.000Z', temporalScope: '2030 winter policy window' });

    const catalog = await callJson(client, 'get_wiki_catalog', { validity: 'current', validAt: '2030-01-15T00:00:00.000Z', includeFacets: true, limit: 20, maxChars: 8000, accessToken });
    expect(catalog.value.entries).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/Time bounded claim.md', temporal: expect.objectContaining({ state: 'current' }) })]));
    expect(catalog.value.facets.validity.current).toBeGreaterThanOrEqual(1);

    const packet = await callJson(client, 'get_wiki_answer_packet', { path: 'Knowledge/Time bounded claim.md', intent: 'decide', includeSemantic: false, maxChars: 12000, accessToken });
    expect(packet.value.evidenceDiversity).toMatchObject({ status: 'multiple_source_works', evidencePathCount: 3, scannedSnapshotCount: 3, distinctSourceWorkCount: 2 });
    expect(packet.value.evidenceDiversity.sourceWorks).toEqual(expect.arrayContaining([
      expect.objectContaining({ workId: 'study-a', snapshotCount: 2 }),
      expect.objectContaining({ workId: 'study-b', snapshotCount: 1 }),
    ]));

    const capability = await callJson(client, 'search_capabilities', { query: 'claim evidence matrix', limit: 5, maxChars: 5000, accessToken });
    expect(capability.value.endpoints).toEqual(expect.arrayContaining([expect.objectContaining({ endpointId: 'wiki.claim_matrix', available: true })]));
    const matrix = await callJson(client, 'call_endpoint', { endpointId: 'wiki.claim_matrix', arguments: { path: 'Knowledge/Time bounded claim.md', limit: 20, maxChars: 12000, accessToken } });
    expect(matrix.value).toMatchObject({ revision: published.value.revision, totalClaims: 3, scannedClaims: 3, returnedClaims: 3 });
    expect(matrix.value.authoredOrder.map((item: any) => item.claimId)).toEqual(['same-work-snapshots', 'independent-study', 'combined-view']);
    expect(matrix.value.authoredOrder).toEqual(expect.arrayContaining([
      expect.objectContaining({ claimId: 'same-work-snapshots', evidence: expect.objectContaining({ distinctSourceWorkCount: 1, scannedSnapshotCount: 2 }), signals: expect.arrayContaining(['single_source_work']) }),
      expect.objectContaining({ claimId: 'combined-view', evidence: expect.objectContaining({ distinctSourceWorkCount: 2, scannedSnapshotCount: 3 }) }),
    ]));
    expect(matrix.value.nextAction).toMatchObject({ endpointId: 'wiki.review_claim', arguments: { path: 'Knowledge/Time bounded claim.md', expectedRevision: published.value.revision } });
    const compactMatrix = await callJson(client, 'get_wiki_claim_matrix', { path: 'Knowledge/Time bounded claim.md', limit: 20, maxChars: 1024, accessToken });
    expect(JSON.stringify(compactMatrix.value).length).toBeLessThanOrEqual(1024);
    expect(compactMatrix.value).toMatchObject({ revision: published.value.revision, totalClaims: 3, truncated: true });

    const manual = await client.callTool({ name: 'write_note', arguments: {
      path: 'Knowledge/Stale evidence locator.md', content: '# Stale evidence locator\n\nA manually imported legacy note.\n',
      frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'knowledge', lifecycle: 'review', evidence_paths: [sourceB.value.path], evidence: [{ path: sourceB.value.path, revision: '0'.repeat(64) }] },
      expectedRevision: 'missing', accessToken,
    } });
    expect(manual.isError).toBeFalsy();
    const stalePacket = await callJson(client, 'get_wiki_answer_packet', { path: 'Knowledge/Stale evidence locator.md', intent: 'review', includeSemantic: false, maxChars: 8000, accessToken });
    expect(stalePacket.value.evidenceDiversity).toMatchObject({ status: 'single_source_work', distinctSourceWorkCount: 1, staleLocatorCount: 1 });
    expect(stalePacket.value.reasoningTrail.gaps).toContain('independent_source_work_review');

    await callJson(client, 'publish_knowledge', {
      path: 'Knowledge/Expired claim.md', content: '# Expired claim\n\nThis condition no longer applies.\n', evidencePaths: [sourceB.value.path],
      validUntil: '2020-01-01T00:00:00.000Z', expectedRevision: 'missing', accessToken,
    });
    const review = await callJson(client, 'get_wiki_review_queue', { limit: 20, maxChars: 10000, accessToken });
    expect(review.value.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Knowledge/Expired claim.md', reviewReasons: expect.arrayContaining(['validity_ended']), temporal: expect.objectContaining({ state: 'expired' }) }),
    ]));
  } finally {
    await client.close();
    await server.close();
  }
});
