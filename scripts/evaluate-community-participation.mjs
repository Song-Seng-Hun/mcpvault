/**
 * Opt-in actual-Codex comparison. This is intentionally separate from npm test.
 * It runs the same model and two five-minute sessions per arm in equivalent,
 * disposable Vaults: default participation versus an explicit community opt-in.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENDPOINTS, buildCodexArgs, closeFixture, communityPulse, configureOptIn, finishParticipation,
  participationState, peerContribution, physicalState, publicResult, runModel, startFixture,
  startParticipation,
} from './community-participation-eval-support.mjs';

const options = process.argv.slice(2);
const option = (key, fallback) => { const index = options.indexOf(key); return index < 0 ? fallback : options[index + 1]; };
if (options.includes('--help')) {
  console.log('node scripts/evaluate-community-participation.mjs [--codex <executable>] [--model gpt-5.6-luna] [--dry-run|--fixture-only]\nRuns an opt-in actual-model comparison using temporary Vaults. --fixture-only verifies the built local API without starting a model. --help/--dry-run do not require dist. Reports structural tool, usage, and physical-artifact evidence without transcripts or credentials.');
  process.exit(0);
}
if (option('--codex', undefined)) process.env.MCPVAULT_CODEX = option('--codex', 'codex');
const model = option('--model', 'gpt-5.6-luna');

const protocol = {
  model, fixedArmBudget: { sessions: 2, maxMinutesPerSession: 5, reasoningEffort: 'medium' },
  arms: { baseline: 'default participation settings with the same workshop purpose and prompt', enhanced: 'enabled for the same workshop purpose, actions initiate/respond, daily limit 2' },
  endpoints: ENDPOINTS, scenario: 'Session one asks for one finite Workshop. A peer then contributes one counterexample. Session two rereads the Workshop and may contribute one bounded response.',
  evidence: 'successful MCP call outputs plus current physical Markdown frontmatter and revisions; unavailable measures stay unavailable',
};
if (options.includes('--dry-run')) {
  const args = buildCodexArgs('http://127.0.0.1:49123/mcp', 'C:/temporary-workspace', model);
  if (!args.includes('mcp_servers.eval.bearer_token_env_var="MCPVAULT_EVAL_TOKEN"') || Object.values(ENDPOINTS).some(value => !value.includes('.'))) throw new Error('Protocol fixture is incomplete');
  console.log(JSON.stringify({ dryRun: true, protocol }, null, 2));
  process.exit(0);
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(repo, '.mcpvault', 'evaluations', `community-${Date.now()}`);
const report = { kind: 'actual_codex_community_participation_comparison', startedAt: new Date().toISOString(), protocol, runs: [], hostNotRun: [], operationalErrors: [], cleanup: [] };

function creationPrompt(pulsePacket, publicRequestId) {
  return `The user purpose for this session is the finite Workshop "Bounded counterexample review": ask for one counterexample to a general claim, use a two-step agenda, and a 20-minute timebox. Here is the bounded current MCP pulse packet: ${JSON.stringify(pulsePacket)}.
Use only the eval MCP server. Choose one action: create that Workshop through dynamic endpoint ${ENDPOINTS.workshopCreate}, or rest without a public write. If you create it, use call_endpoint and${publicRequestId ? ` supply requestId ${publicRequestId}.` : ' use no participation requestId.'} Do not invent a result; report only MCP return values.`;
}
function responsePrompt(workshopId, pulsePacket, publicRequestId) {
  return `The user purpose remains the finite Workshop "Bounded counterexample review". Here is the bounded current MCP pulse packet: ${JSON.stringify(pulsePacket)}.
Use only the eval MCP server. Read Workshop ${workshopId}, including the peer counterexample, then choose one action: leave at most one short bounded contribution that preserves uncertainty, or rest without a public write. Use ${ENDPOINTS.workshopRead} and ${ENDPOINTS.workshopContribute} through call_endpoint.${publicRequestId ? ` Supply requestId ${publicRequestId}.` : ' use no participation requestId.'} Do not invent a result; report only MCP return values.`;
}
function unavailable(reason) { return { available: false, reason }; }
function reportableSession(session) { const { after: _physicalNotes, ...evidence } = session; return evidence; }
function operationalCode(error) { return error instanceof Error && /^[A-Za-z]+Error$/.test(error.name) ? error.name : 'UNKNOWN'; }
function recordSpawnFailures(scope, sessions) {
  for (const session of sessions) {
    if (session?.model?.outcome?.kind === 'spawn_failed') report.hostNotRun.push({ scope, session: session.number, reason: 'model_spawn_failed', code: session.model.outcome.code });
  }
}
const SIMULATED_INTER_SESSION_GAP_MS = 30 * 60 * 1000;

/** The fixture has no clock injection. Advance only its private run timestamp with
 * an expected revision so the service's 30-minute coalescing guard is testable.
 */
async function advanceFixtureParticipationGap(fixture) {
  const state = await participationState(fixture);
  const note = await fixture.service.readNote(state.path, 100_000);
  const participation = { ...note.frontmatter.participation, lastStartedAt: new Date(Date.now() - SIMULATED_INTER_SESSION_GAP_MS).toISOString() };
  await fixture.service.writeNote({ path: state.path, expectedRevision: note.revision, content: note.content, frontmatter: { ...note.frontmatter, participation } });
  return SIMULATED_INTER_SESSION_GAP_MS;
}

async function session(fixture, arm, number, action, target) {
  const enhanced = arm === 'enhanced';
  const pulse = await communityPulse(fixture, enhanced ? 'community' : 'work');
  let record;
  if (enhanced) record = await startParticipation(fixture, action, target);
  const active = record?.activeRun;
  if (enhanced && !active) throw new Error('Opt-in run did not return an active run');
  const before = await physicalState(fixture);
  const prompt = number === 1
    ? creationPrompt(pulse, active?.publicRequestId)
    : responsePrompt(target.workshopId, pulse, active?.publicRequestId);
  const modelRun = await runModel(fixture, model, prompt);
  const after = await physicalState(fixture);
  let result;
  if (enhanced) {
    const type = number === 1 ? 'workshop' : 'workshop_contribution';
    result = publicResult(after, active.publicRequestId, fixture.accountId, fixture.agentId, type);
    await finishParticipation(fixture, active, result, true);
  }
  return {
    number, action, model: modelRun,
    pulseState: pulse.community?.state || pulse.state || 'unavailable', publicRequestId: active?.publicRequestId || null,
    physical: { beforeNoteCount: before.length, afterNoteCount: after.length, result: result || unavailable(enhanced ? 'no single current artifact matched the active run publicRequestId and physical author' : 'baseline has no participation run') },
    after,
  };
}

async function runArm(arm) {
  let fixture;
  try {
    fixture = await startFixture(arm, model);
    if (arm === 'enhanced') await configureOptIn(fixture);
    const first = await session(fixture, arm, 1, 'initiate');
    // The workshop identity is re-derived from authoritative notes; no model text is trusted.
    const workshop = first.after.filter(note => note.type === 'workshop' && note.facilitator === fixture.agentId && (arm === 'baseline' || note.requestId === first.publicRequestId)).map(note => ({ workshopId: note.frontmatter.workshop_id, path: note.path, revision: note.revision })).at(-1);
    let workshopRevision = workshop?.revision;
    let peer = unavailable('Workshop creation was unavailable, so a peer contribution could not be made');
    if (workshop?.workshopId) {
      const peerWrite = await peerContribution(fixture, workshop.workshopId);
      const current = (await physicalState(fixture)).filter(note => note.type === 'workshop' && note.path === workshop.path)[0];
      workshopRevision = current?.revision;
      peer = { available: true, workshopId: workshop.workshopId, returned: Boolean(peerWrite?.success), workshopRevisionAfterPeer: current?.revision || null };
    }
    const target = workshop?.path && workshopRevision ? { path: workshop.path, revision: workshopRevision, workshopId: workshop.workshopId } : undefined;
    const simulatedGapMs = arm === 'enhanced' && target ? await advanceFixtureParticipationGap(fixture) : 0;
    const second = target ? await session(fixture, arm, 2, 'respond', target) : { number: 2, model: unavailable('No Workshop exists to reread'), physical: unavailable('No Workshop exists to reread') };
    const sessions = [reportableSession(first), reportableSession(second)];
    recordSpawnFailures(arm, sessions);
    return { arm, actualModelAccount: fixture.accountId, actualModelAgent: fixture.agentId, simulatedInterSessionGapMs: simulatedGapMs, sessions, peer, metrics: { peerContribution: peer.available, sessionOneSuccessfulMcpOutputs: first.model.successfulToolCalls, sessionTwoSuccessfulMcpOutputs: second.model?.successfulToolCalls ?? null } };
  } finally {
    if (fixture) report.cleanup.push({ arm, ...(await closeFixture(fixture)) });
  }
}

async function runIdleControl() {
  let fixture;
  try {
    fixture = await startFixture('idle', model);
    await configureOptIn(fixture, ['explore']);
    const pulse = await communityPulse(fixture);
    const record = await startParticipation(fixture, 'explore');
    const active = record.activeRun;
    if (!active) throw new Error('Idle control did not return an active run');
    const before = await physicalState(fixture);
    const modelRun = await runModel(fixture, model, `The user purpose is to check whether there is a current community opportunity. Here is the bounded MCP pulse packet: ${JSON.stringify(pulse)}. If it contains a meaningful authorized explore opportunity, take at most one bounded explore action; otherwise rest without a public write. Use only the eval MCP server and report only MCP return values.`);
    const after = await physicalState(fixture);
    await finishParticipation(fixture, active, undefined, true);
    recordSpawnFailures('idle-control', [{ number: 1, model: modelRun }]);
    const publicCount = notes => notes.filter(note => note.path.startsWith('Community/')).length;
    return { configured: true, pulseState: pulse.community?.state || pulse.state || 'unavailable', runRecorded: true, model: modelRun, physical: { beforeNoteCount: before.length, afterNoteCount: after.length, publicArtifactDelta: publicCount(after) - publicCount(before) } };
  } finally {
    if (fixture) report.cleanup.push({ arm: 'idle-control', ...(await closeFixture(fixture)) });
  }
}

/** Post-build transport/API verification. It creates no Codex child process. */
async function runFixtureOnly() {
  let fixture;
  try {
    fixture = await startFixture('fixture-only', model);
    const configured = await configureOptIn(fixture, ['explore']);
    const pulse = await communityPulse(fixture);
    const record = await startParticipation(fixture, 'explore');
    const finished = await finishParticipation(fixture, record.activeRun, undefined, true);
    return { configured: configured.settings?.enabled === true, pulseState: pulse.community?.state || pulse.state || 'unavailable', recorded: !finished.activeRun };
  } finally {
    if (fixture) report.cleanup.push({ arm: 'fixture-only', ...(await closeFixture(fixture)) });
  }
}

try {
  await mkdir(output, { recursive: true });
  if (options.includes('--fixture-only')) {
    report.fixtureOnly = await runFixtureOnly();
  } else {
    for (const arm of ['baseline', 'enhanced']) {
      try { report.runs.push(await runArm(arm)); }
      catch (error) { report.operationalErrors.push({ scope: arm, code: operationalCode(error) }); }
    }
    try { report.idleControl = await runIdleControl(); }
    catch (error) { report.operationalErrors.push({ scope: 'idle-control', code: operationalCode(error) }); }
  }
} finally {
  report.finishedAt = new Date().toISOString();
  const modelRuns = [...report.runs.flatMap(arm => arm.sessions.map(session => session.model)), report.idleControl?.model].filter(run => run?.outcome);
  if (report.operationalErrors.length || report.hostNotRun.length || modelRuns.some(run => run.outcome.kind !== 'completed')) process.exitCode = 1;
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(`Evaluation report: ${join(output, 'report.json')}; hostNotRun=${report.hostNotRun.length > 0}`);
}
