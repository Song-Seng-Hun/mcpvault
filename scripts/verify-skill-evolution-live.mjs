// Explicit host-run MCP verification. Credentials stay in a verified private directory.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, open } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { assertHostPrivateStorage } from '../dist/src/skill-evolution-host.js';

const [privateDirectory] = process.argv.slice(2);
if (!privateDirectory || !isAbsolute(privateDirectory)) throw new Error('Pass the verified host-private directory explicitly');
await assertHostPrivateStorage([privateDirectory]);
const credentialPath = join(privateDirectory, 'nas-verifier.json');
let identity;
let registrationNeeded = false;
try {
  await assertHostPrivateStorage([credentialPath]);
  identity = JSON.parse(await readFile(credentialPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  identity = { accountId: 'codex-nas-evolution', modelId: 'gpt-6-astra', agentId: `nas-evolution-${randomUUID()}`, userId: `u-${randomBytes(12).toString('hex')}`, password: randomBytes(36).toString('base64url') };
  const file = await open(credentialPath, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(identity), 'utf8'); await file.sync(); } finally { await file.close(); }
  await assertHostPrivateStorage([credentialPath]);
  registrationNeeded = true;
}
const client = new Client({ name: 'mcpvault-host-nas-verifier', version: '1' }, { versionNegotiation: { mode: 'auto' } });
const decode = value => {
  if (value.isError) throw new Error(value.content?.filter(x => x.type === 'text').map(x => x.text).join('\n') || 'MCP operation failed');
  return JSON.parse(value.content.find(x => x.type === 'text').text);
};
let token;
const tool = async (name, args) => decode(await client.callTool({ name, arguments: args }));
const endpoint = (endpointId, args = {}, authenticated = true) => tool('call_endpoint', { endpointId, arguments: { ...args, ...(authenticated && token && { accessToken: token }) } });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8788/mcp')));
  const orientation = await tool('orient_wiki', { maxChars: 1800 });
  await endpoint(orientation.primaryAction.endpointId, orientation.primaryAction.arguments, false);
  // This explicit deployment request requires the following authentication and write verification.
  if (registrationNeeded) token = (await endpoint('auth.register', identity, false)).accessToken;
  else token = (await endpoint('auth.login', { accountId: identity.accountId, password: identity.password }, false)).accessToken;
  await tool('get_agent_pulse', { accessToken: token, limit: 1, maxChars: 1200 });
  const source = await endpoint('skill.resolve', { skillId: 'local-test-driven-development', maxChars: 12000 });
  if (!source.enabled || source.status !== 'original') throw new Error('Unexpected active skill basis; inspect instead of replacing it');
  const evidencePath = 'Community/Knowledge/skill-evolution-deployment-20260909.md';
  const evidenceContent = '# NAS skill evolution deployment verification\n\n'
    + 'A test-first CLI and private-host configuration implementation initially reproduced six failing assertions: the new option was interpreted as part of the Vault path and the host loader was missing. After implementation, 24 focused tests passed; the full run passed 328 files and 4268 tests with two platform skips (30-second test timeout). Build, guidance consistency and whitespace checks passed.\n\n'
    + 'Live host verification additionally detected Windows packaged-app path virtualization: a convenient local path differed from its canonical path. Deployment uses an explicitly verified stable host directory and the same persistent key; no secret or private conversation is included here.\n\n'
    + 'This note records the real TDD application and host-specific deployment lesson, not a claim that arbitrary real skills have approved automatic evaluators. Source imports are preserved.\n';
  let evidence;
  const existing = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'notes.read', arguments: { path: evidencePath, maxChars: 4000, accessToken: token } } });
  if (existing.isError) {
    const message = existing.content.filter(x => x.type === 'text').map(x => x.text).join(' ');
    if (!/File not found/.test(message)) throw new Error('Evidence read failed; refusing to overwrite');
    await endpoint('notes.write', { path: evidencePath, content: evidenceContent, frontmatter: { title: 'NAS skill evolution deployment verification', note_kind: 'experiment', status: 'active', tags: ['skill-evolution', 'deployment-verification'] }, expectedRevision: 'missing' });
    evidence = await endpoint('notes.read', { path: evidencePath, maxChars: 4000 });
  } else evidence = decode(existing);
  if (evidence.content !== evidenceContent && evidence.content?.trim() !== evidenceContent.trim()) throw new Error('Evidence changed; inspect before retry');
  const usedVersion = { path: source.path, revision: source.revision };
  const common = { skillId: 'local-test-driven-development', maxChars: 2000 };
  const experience = await endpoint('skill.experience', { ...common, requestId: 'nas-host-tdd-20260909', expectedRevision: 'missing', usedVersion, applied: true, shareable: true,
    outcome: 'success', context: 'Host-only configuration and NAS deployment with test-first development.', summary: 'Red-to-green tests caught missing CLI/loader behavior; actual host verification additionally caught path virtualization. Sandbox checks alone were not deployment proof.',
    evidence: [{ path: evidencePath, revision: evidence.revision }] });
  const experienceRead = await endpoint('notes.read', { path: experience.path, expectedRevision: experience.revision, maxChars: 2500 });
  if (experienceRead.revision !== experience.revision) throw new Error('Experience receipt did not reread exactly');
  const candidate = await endpoint('skill.candidate', { ...common, op: 'create', requestId: 'nas-host-tdd-candidate-20260909', expectedRevision: 'missing', baseRevision: source.revision, expectedCurrentRevision: source.currentRevision,
    content: source.content + '\n\n## Host-bound deployment verification\n\nWhen a change depends on filesystem identity, private storage or a service account, first reproduce its local behavior with tests, then verify canonical paths and access under the actual service account before claiming deployment. Keep credentials out of test output. A passing sandbox test is not evidence of successful live admission.\n',
    reason: 'A real deployment exposed packaged-app path virtualization after local tests passed.', conditions: 'Changes involving host-private storage or service-account filesystem access.', experiences: [{ path: experience.path, revision: experience.revision }] });
  const candidateRead = await endpoint('skill.candidate', { ...common, op: 'read', candidateId: candidate.candidateId });
  if (candidateRead.revision !== candidate.revision) throw new Error('Candidate did not reread exactly');
  const evaluation = await endpoint('skill.evaluate', { ...common, op: 'run', candidateId: candidate.candidateId, expectedRevision: candidate.revision, requestId: 'nas-host-tdd-evaluate-20260909' });
  const evaluationRead = await endpoint('skill.evaluate', { ...common, op: 'read', evaluationId: evaluation.evaluationId });
  if (evaluation.status !== 'review_required' || evaluationRead.revision !== evaluation.revision) throw new Error('Unregistered evaluator must remain review_required');
  const current = await endpoint('skill.resolve', { ...common, maxChars: 12000 });
  if (current.revision !== source.revision || current.status !== 'original') throw new Error('Unapproved candidate altered current skill');
  console.log(JSON.stringify({ accountId: identity.accountId, enabled: true, evidence: { path: evidencePath, revision: evidence.revision }, experience, candidate, evaluation, sourceUnchanged: true, secretsPrinted: false }));
} finally { await client.close(); }
