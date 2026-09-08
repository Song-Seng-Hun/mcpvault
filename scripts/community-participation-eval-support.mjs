/** Helpers for the opt-in, actual-model community-participation evaluation.
 * They deliberately do not import dist at module load, so --help/--dry-run work
 * before a build. Nothing here grades prose or treats a keyword as success.
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

export const RUN_TIMEOUT_MS = 5 * 60 * 1000;
export const ENDPOINTS = Object.freeze({
  register: 'auth.register', settings: 'community.participation', record: 'community.participation_record',
  workshopCreate: 'workshop.create', workshopRead: 'workshop.read', workshopContribute: 'workshop.contribute',
});
export const TOPIC = 'bounded counterexample review';

export function buildCodexArgs(endpoint, workspace, model) {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.port === '8788' || url.username || url.password) throw new Error('Evaluation requires its own ephemeral loopback HTTP listener');
  const args = ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--json', '--color', 'never', '-s', 'read-only', '-C', workspace, '-m', model];
  for (const feature of ['plugins', 'apps', 'shell_tool', 'unified_exec', 'multi_agent', 'memories', 'hooks', 'computer_use', 'browser_use', 'image_generation']) args.push('--disable', feature);
  args.push('--enable', 'skip_host_skill_discovery', '--enable', 'mcp_2026_07_28');
  for (const config of ['approval_policy="never"', 'project_doc_max_bytes=0', 'model_reasoning_effort="medium"', 'web_search="disabled"', `mcp_servers.eval.url=${JSON.stringify(endpoint)}`, 'mcp_servers.eval.required=true', 'mcp_servers.eval.bearer_token_env_var="MCPVAULT_EVAL_TOKEN"', 'mcp_servers.eval.default_tools_approval_mode="approve"', 'mcp_servers.eval.startup_timeout_sec=30', 'mcp_servers.eval.tool_timeout_sec=60']) args.push('-c', config);
  args.push('-'); return args;
}

export function buildEvalEnvironment(parent, token) {
  const allowed = new Set(['path', 'systemroot', 'windir', 'comspec', 'pathext', 'temp', 'tmp', 'userprofile', 'appdata', 'localappdata', 'homedrive', 'homepath', 'home', 'codex_home', 'programfiles', 'programfiles(x86)', 'programdata']);
  return { ...Object.fromEntries(Object.entries(parent).filter(([key, value]) => allowed.has(key.toLowerCase()) && typeof value === 'string')), MCPVAULT_EVAL_TOKEN: token };
}

const resultText = result => result.content?.filter(item => item.type === 'text').map(item => item.text).join('') || '';
export async function callEndpoint(client, endpointId, args = {}, accessToken) {
  const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args, ...(accessToken && { accessToken }) } });
  if (result.isError) throw new Error(`Endpoint ${endpointId} failed`);
  try { return JSON.parse(resultText(result)); } catch { throw new Error(`Endpoint ${endpointId} returned non-JSON output`); }
}

/** Creates two accounts in one fresh vault: an actual-model account and a peer. */
export async function startFixture(arm, model) {
  const root = await mkdtemp(join(tmpdir(), 'mcpvault-community-eval-'));
  const vault = join(root, 'vault');
  const workspace = join(root, 'workspace');
  let server, api, client;
  try {
    await mkdir(vault);
    await mkdir(workspace);
    await writeFile(join(workspace, 'EVALUATION.md'), '# Isolated MCPVault evaluation\nUse only the supplied MCP server.\n', 'utf8');
    const [{ createServer }, { startMcpHttpApi }, { Client, StreamableHTTPClientTransport }, { FileSystemService }] = await Promise.all([import('../dist/src/createServer.js'), import('../dist/src/mcp-http.js'), import('@modelcontextprotocol/client'), import('../dist/src/filesystem.js')]);
    server = createServer(vault, { version: `community-eval-${arm}` });
    api = await startMcpHttpApi(server, { host: '127.0.0.1', port: 0 });
    if (api.port === 8788) throw new Error('Unexpected production-port collision');
    client = new Client({ name: `community-eval-${arm}`, version: '1' }, { versionNegotiation: { mode: 'auto' } });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${api.port}${api.path}`)));
    const suffix = randomUUID().slice(0, 10); const accountId = `eval-${arm}-${suffix}`; const agentId = `session-${suffix}`;
    const registration = await callEndpoint(client, ENDPOINTS.register, { accountId, userId: `eval-human-${suffix}`, modelId: String(model).toLowerCase(), agentId, password: randomUUID() });
    const peerId = `peer-${suffix}`; const peerAgentId = `peer-session-${suffix}`;
    const peer = await callEndpoint(client, ENDPOINTS.register, { accountId: peerId, userId: `peer-human-${suffix}`, modelId: 'peer', agentId: peerAgentId, password: randomUUID() });
    return { root, vault, workspace, server, api, client, service: new FileSystemService(vault), accountId, agentId, token: registration.accessToken, peerId, peerAgentId, peerToken: peer.accessToken };
  } catch (error) {
    try { await client?.close(); } catch { /* best-effort setup cleanup */ }
    try { api?.server.closeAllConnections(); await api?.close(); } catch { /* best-effort setup cleanup */ }
    try { await server?.close(); } catch { /* best-effort setup cleanup */ }
    const relativeRoot = relative(resolve(tmpdir()), resolve(root));
    if (!relativeRoot || relativeRoot.startsWith('..') || isAbsolute(relativeRoot) || !relativeRoot.startsWith('mcpvault-community-eval-')) throw new Error('Unsafe fixture cleanup target');
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    throw error;
  }
}

export async function configureOptIn(fixture, allowedActions = ['initiate', 'respond']) { return callEndpoint(fixture.client, ENDPOINTS.settings, { op: 'update', expectedRevision: 'missing', requestId: 'evaluation-opt-in-v1', settings: { enabled: true, allowedTopics: [TOPIC], allowedActions, dailyLimit: 2, dailyInitiationLimit: 1 } }, fixture.token); }
export async function participationState(fixture) { return callEndpoint(fixture.client, ENDPOINTS.settings, { op: 'read', maxChars: 12000 }, fixture.token); }
export async function communityPulse(fixture, purpose = 'community') {
  const result = await fixture.client.callTool({ name: 'get_agent_pulse', arguments: { accessToken: fixture.token, purpose, maxChars: 4000 } });
  if (result.isError) throw new Error('get_agent_pulse failed');
  try { return JSON.parse(resultText(result)); } catch { throw new Error('get_agent_pulse returned non-JSON output'); }
}
export async function startParticipation(fixture, action, target) { const state = await participationState(fixture); const canonicalTarget = target && { path: target.path, revision: target.revision, ...(target.activityRevision && { activityRevision: target.activityRevision }) }; return callEndpoint(fixture.client, ENDPOINTS.record, { op: 'start', requestId: `evaluation-${action}-${randomUUID()}`, expectedRevision: state.revision, action, topic: TOPIC, ...(canonicalTarget && { target: canonicalTarget }) }, fixture.token); }
export async function finishParticipation(fixture, run, result, noMutation = false) { const state = await participationState(fixture); return callEndpoint(fixture.client, ENDPOINTS.record, result ? { op: 'finish', requestId: `evaluation-finish-${run.id}`, expectedRevision: state.revision, runId: run.id, result } : { op: 'skip', requestId: `evaluation-skip-${run.id}`, expectedRevision: state.revision, runId: run.id, noMutation }, fixture.token); }

async function walk(root, prefix = '') { const entries = await readdir(join(root, prefix), { withFileTypes: true }); const nested = await Promise.all(entries.map(async entry => entry.isDirectory() ? walk(root, join(prefix, entry.name)) : [join(prefix, entry.name)])); return nested.flat().map(path => path.replaceAll('\\', '/')).sort(); }
/** Current authoritative notes/revisions, including exactly who created public artifacts. */
export async function physicalState(fixture) { const notes = []; for (const path of (await walk(fixture.vault)).filter(path => path.endsWith('.md'))) { try { const note = await fixture.service.readNote(path, 100_000); notes.push({ path, revision: note.revision, type: note.frontmatter.mcpvault_type, author: note.frontmatter.author, facilitator: note.frontmatter.facilitator, requestId: note.frontmatter.community_request_id, requestActor: note.frontmatter.community_request_actor, workshopId: note.frontmatter.workshop_id, frontmatter: note.frontmatter }); } catch { /* Non-note Markdown is not an artifact metric. */ } } return notes; }
export function publicResult(notes, requestId, accountId, agentId, type) { const requestActor = createHash('sha256').update(JSON.stringify({ accountId })).digest('hex'); const matches = notes.filter(note => note.requestId === requestId && note.requestActor === requestActor && (type === 'workshop' ? note.facilitator === agentId : note.author === agentId) && (!type || note.type === type)); if (matches.length !== 1) return undefined; const note = matches[0]; return { path: note.path, revision: note.revision }; }
export async function peerContribution(fixture, workshopId) { return callEndpoint(fixture.client, ENDPOINTS.workshopContribute, { workshopId, kind: 'counterexample', content: 'Counterexample: one successful example does not establish the general claim.', requestId: `peer-contribution-${randomUUID()}` }, fixture.peerToken); }

const safeErrorCode = value => {
  const code = typeof value === 'string' ? value.toUpperCase() : '';
  return /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'UNKNOWN';
};
const callSucceeded = item => {
  const result = item.result;
  return result !== undefined && result !== null && !(typeof result === 'object' && (result.isError === true || result.error === true));
};
const usageFrom = value => { const usage = value?.usage; return usage && typeof usage === 'object' ? Object.fromEntries(Object.entries(usage).filter(([, item]) => typeof item === 'number')) : undefined; };
/** Structural evidence only: no transcript, prompts, credentials, or reasoning are written. */
export async function runModel(fixture, model, prompt) {
  const child = spawn(process.env.MCPVAULT_CODEX || 'codex', buildCodexArgs(`http://127.0.0.1:${fixture.api.port}${fixture.api.path}`, fixture.workspace, model), { cwd: fixture.workspace, windowsHide: true, env: buildEvalEnvironment(process.env, fixture.token), stdio: ['pipe', 'pipe', 'pipe'] });
  const events = []; let bytes = 0; let stderrBytes = 0; let timedOut = false; let spawnErrorCode; let buffer = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); child.stdout.on('data', chunk => { bytes += Buffer.byteLength(chunk); buffer += chunk; let newline; while ((newline = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); try { const event = JSON.parse(line); if (event.type === 'item.completed' || event.type === 'thread.completed' || event.type === 'turn.completed' || event.type === 'turn.failed') events.push(event); } catch { /* Do not retain raw output. */ } } }); child.stderr.on('data', chunk => { stderrBytes += Buffer.byteLength(chunk); });
  const exit = await new Promise(resolveExit => { const timer = setTimeout(() => { timedOut = true; child.kill(); }, RUN_TIMEOUT_MS); child.once('close', (code, signal) => { clearTimeout(timer); resolveExit({ code, signal }); }); child.once('error', error => { spawnErrorCode = safeErrorCode(error.code || error.name); clearTimeout(timer); resolveExit({ code: null }); }); child.stdin.on('error', () => {}); child.stdin.end(prompt); });
  const calls = events.filter(event => event.type === 'item.completed' && event.item?.type === 'mcp_tool_call').map(event => event.item); const completed = events.filter(event => event.type === 'turn.completed' || event.type === 'thread.completed').at(-1);
  const endpointIds = [...new Set(calls.map(call => call.arguments?.endpointId).filter(value => typeof value === 'string'))];
  const failedTurn = events.filter(event => event.type === 'turn.failed').at(-1);
  const successfulEndpoints = calls.filter(callSucceeded).map(call => call.arguments?.endpointId);
  const readIndex = successfulEndpoints.indexOf(ENDPOINTS.workshopRead);
  const writeIndex = successfulEndpoints.findIndex((value, index) => index > readIndex && value === ENDPOINTS.workshopContribute);
  const outcome = spawnErrorCode ? { kind: 'spawn_failed', code: spawnErrorCode } : timedOut ? { kind: 'timed_out' } : failedTurn ? { kind: 'turn_failed', code: safeErrorCode(failedTurn.error?.code || failedTurn.error?.name) } : exit.code === 0 && completed ? { kind: 'completed' } : { kind: 'turn_failed', code: exit.code === 0 ? 'NO_COMPLETED_TURN' : typeof exit.code === 'number' ? `EXIT_${exit.code}` : 'UNKNOWN' };
  return { outcome, exit, outputBytes: bytes, stderrBytes, toolCalls: calls.length, successfulToolCalls: calls.filter(callSucceeded).length, failedToolCalls: calls.filter(call => !callSucceeded(call)).length, endpointIds, followUpReadThenWrite: readIndex >= 0 && writeIndex > readIndex, returnedResultChars: calls.filter(callSucceeded).reduce((total, call) => total + JSON.stringify(call.result ?? {}).length, 0), usage: usageFrom(completed) || null, semanticAssessment: 'not_evaluated', retentionAssessment: 'not_evaluated' };
}

export async function closeFixture(fixture) { const errors = []; for (const action of [async () => fixture.client?.close(), async () => { fixture.api?.server.closeAllConnections(); await fixture.api?.close(); }, async () => fixture.server?.close()]) { try { await Promise.race([action(), new Promise((_, reject) => setTimeout(() => reject(new Error('cleanup timeout')), 5000))]); } catch { errors.push('cleanup_failed_or_timed_out'); } } const relativeRoot = relative(resolve(tmpdir()), resolve(fixture.root)); if (!relativeRoot || relativeRoot.startsWith('..') || isAbsolute(relativeRoot) || !relativeRoot.startsWith('mcpvault-community-eval-')) throw new Error('Unsafe fixture cleanup target'); try { await rm(fixture.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { errors.push('fixture_remove_failed'); } return { removed: errors.length === 0, errors }; }
