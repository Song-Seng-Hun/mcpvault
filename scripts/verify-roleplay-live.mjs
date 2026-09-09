// Read-only verification of the explicitly dormant operational NAS capability.
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
const client = new Client({ name: 'mcpvault-live-roleplay-verifier', version: '1' }, { versionNegotiation: { mode: 'auto' } });
const decode = r => {
  if (r.isError) throw new Error(r.content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
  return JSON.parse(r.content.find(c => c.type === 'text').text);
};
const endpoint = async (endpointId, args) => decode(await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args } }));
try {
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8788/mcp')));
  assert.equal((await client.listTools()).tools.length, 5);
  const orientation = decode(await client.callTool({ name: 'orient_wiki', arguments: { maxChars: 1800 } }));
  await endpoint(orientation.primaryAction.endpointId, orientation.primaryAction.arguments);
  const world = await endpoint('roleplay.world', { op: 'read', maxChars: 2000 });
  assert.equal(world.enabled, true); assert.equal(world.ready, false); assert.equal(world.title, null);
  assert(world.setupRequired.includes('administrators')); assert.equal(world.evolutionMode, 'fixed');
  const proposals = await endpoint('roleplay.evolution', { op: 'list', maxChars: 2000 });
  assert.equal(proposals.total, 0); assert.equal(proposals.revision, world.revision);
  const history = await endpoint('roleplay.history', { maxChars: 2000 });
  assert.equal(history.total, 0); assert.equal(history.revision, world.revision);
  const skill = await endpoint('skill.resolve', { skillId: 'local-test-driven-development', maxChars: 1500 });
  assert.equal(skill.enabled, true); assert.equal(skill.status, 'original');
  const worldAgain = await endpoint('roleplay.world', { op: 'read', maxChars: 2000 });
  assert.equal(worldAgain.revision, world.revision);
  console.log(JSON.stringify({ operationalMcp: true, fixedTools: 5, roleplay: { enabled: true, ready: false, setupRequired: world.setupRequired, revision: world.revision, canonicalTurns: 0, proposals: 0 }, skillEvolutionStillEnabled: true, existingSkillUnchanged: skill.revision, worldOrOwnersInvented: false, exactReread: true }));
} finally { await client.close(); }
