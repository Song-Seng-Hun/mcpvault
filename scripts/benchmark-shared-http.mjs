// Opt-in Windows probe. Build first; never accepts an existing Vault or URL.
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as pause } from 'node:timers/promises';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && !['--smoke', '--smoke-fail-startup'].includes(args[0]))) throw new Error('Use no arguments or --smoke (or --smoke-fail-startup for failure verification)');
if (process.platform !== 'win32') throw new Error('This process-memory probe requires Windows Get-Process');
const failStartup = args[0] === '--smoke-fail-startup', smoke = args.length > 0;
const config = { clients: smoke ? 1 : 3, notes: smoke ? 16 : 256, rounds: smoke ? 4 : 24 };
const order = smoke ? ['stdio', 'http'] : ['stdio', 'http', 'http', 'stdio'];
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(repo, 'dist/server.js'), env = getDefaultEnvironment();
const shell = join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const exec = promisify(execFile), base = await realpath(tmpdir()), prefix = 'mcpvault-http-benchmark-';
const round = n => +n.toFixed(2);
const notePath = i => `Note-${String(i).padStart(4, '0')}.md`;
const group = i => `BenchGroup_${i % 8}_X`;

async function processes(pids, allowMissing = false) {
  if (!pids.length || pids.some(pid => !Number.isSafeInteger(pid) || pid <= 0)) throw new Error('Invalid owned process IDs');
  const command = `$ErrorActionPreference='Stop'; $rows=@(Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ id=$_.Id; start=$_.StartTime.ToUniversalTime().Ticks.ToString(); workingSet=$_.WorkingSet64; privateBytes=$_.PrivateMemorySize64; cpuMs=$_.TotalProcessorTime.TotalMilliseconds } }); ConvertTo-Json -InputObject $rows -Compress`;
  const { stdout } = await exec(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true, timeout: 10000, maxBuffer: 32768,
  });
  const rows = JSON.parse(stdout);
  if (!Array.isArray(rows) || (!allowMissing && rows.length !== pids.length)) throw new Error('Owned process disappeared during measurement');
  for (const row of rows) {
    if (!pids.includes(row.id) || !row.start || ['workingSet', 'privateBytes', 'cpuMs'].some(k => !Number.isFinite(row[k]) || row[k] < 0)) {
      throw new Error('Incomplete process metrics');
    }
  }
  return rows;
}
function memory(rows) {
  return Object.fromEntries(['workingSet', 'privateBytes'].map(k => [k, round(rows.reduce((sum, r) => sum + r[k], 0) / 1048576)]));
}
function latency(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, median: round((sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2),
    p95: round(sorted[Math.ceil(sorted.length * 0.95) - 1]) };
}
async function invoke(client, endpointId, input) {
  const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: input } }, undefined, { timeout: 10000 });
  if (result.isError) throw new Error(`Fixture ${endpointId} failed: ${JSON.stringify(result.content).slice(0, 1000)}`);
  const text = result.content.find(item => item.type === 'text')?.text;
  if (!text || text.length > 16384) throw new Error('Missing or oversized result content');
  return JSON.parse(text);
}
async function search(client, i) {
  const token = group(i), result = await invoke(client, 'wiki.search', { query: token, semantic: false, limit: 3, maxChars: 1024 });
  const eligible = new Set(Array.from({ length: config.notes }, (_, index) => index).filter(index => group(index) === token).map(notePath));
  if (!Array.isArray(result) || result.length !== Math.min(3, eligible.size) ||
      result.some(item => !eligible.has(item.p)) || new Set(result.map(item => item.p)).size !== result.length || JSON.stringify(result).length > 1024) {
    throw new Error('Search result mismatch or unbounded result');
  }
}
async function read(client, i) {
  const result = await invoke(client, 'notes.read', { path: notePath(i), maxChars: 1024 });
  if (!result.content?.startsWith(`# Note ${i}\n${group(i)}\n`) || !/^[a-f0-9]{64}$/.test(result.revision)) throw new Error('Read result mismatch');
}

async function measure(mode) {
  const vault = await mkdtemp(join(base, prefix));
  const clients = [], transports = [], pids = [];
  const liveOwners = new Map(), identities = new Map();
  const track = (pid, isLive) => {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Missing owned PID');
    if (!liveOwners.has(pid)) pids.push(pid);
    liveOwners.set(pid, isLive);
  };
  const snapshot = async () => {
    const assertLive = () => { if ([...liveOwners.values()].some(isLive => !isLive())) throw new Error('Owned process exited'); };
    assertLive();
    const rows = await processes(pids);
    assertLive(); // Bind PID snapshots to live child/transport handles, not PID alone.
    for (const row of rows) {
      if (identities.has(row.id) && identities.get(row.id) !== row.start) throw new Error('Process identity changed');
      identities.set(row.id, row.start);
    }
    return rows;
  };
  let child, closed = false, childDone, childError, stderr = '', report, failure;
  try {
    for (let i = 0; i < config.notes; i++) await writeFile(join(vault, notePath(i)), `# Note ${i}\n${group(i)}\n` + '한글 bounded synthetic knowledge. '.repeat(64));
    const started = performance.now();
    let url;
    if (mode === 'http') {
      child = spawn(process.execPath, [entry, vault, '--read-only', '--mcp-http-only=0', '--mcp-http-host=127.0.0.1'], {
        cwd: repo, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      });
      child.on('error', error => { childError = error; });
      childDone = new Promise(resolve => child.once('close', () => { closed = true; resolve(); }));
      if (child.pid) track(child.pid, () => !closed && child.exitCode === null && child.signalCode === null);
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
      const deadline = Date.now() + 10000;
      while (!(url = stderr.match(/http:\/\/127\.0\.0\.1:\d+\/mcp/)?.[0])) {
        if (closed || childError || Date.now() > deadline) throw new Error(`HTTP startup failed: ${childError?.message || stderr.slice(-1000)}`);
        await pause(20);
      }
    }
    for (let i = 0; i < config.clients; i++) {
      const transport = mode === 'stdio'
        ? new StdioClientTransport({ command: process.execPath, args: [entry, vault, '--read-only'], cwd: repo, env, stderr: 'pipe', maxBufferSize: 65536 })
        : new StreamableHTTPClientTransport(new URL(url));
      transports.push(transport);
      if (mode === 'stdio') {
        transport.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
        // Preserve the base prototype: SDK auto negotiation treats subclasses
        // differently and would otherwise change the startup being measured.
        const start = transport.start.bind(transport);
        transport.start = async () => {
          try { await start(); }
          finally { const pid = transport.pid; if (pid) track(pid, () => transport.pid === pid); }
          if (failStartup) throw new Error('Injected failure after spawn before handshake');
        };
      }
      const client = new Client({ name: `resource-probe-${i}`, version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
      clients.push(client);
      await client.connect(transport, { timeout: 10000 });
      const tools = (await client.listTools()).tools.map(tool => tool.name).sort();
      if (tools.join(',') !== 'call_endpoint,get_agent_pulse,list_active_capabilities,orient_wiki,search_capabilities') throw new Error('Fixed tool mismatch');
    }
    const startupMs = round(performance.now() - started);
    await snapshot(); // Establish identities before warm-up; outside startup/workload timings.
    const warming = performance.now();
    for (const client of clients) {
      for (let i = 0; i < 8; i++) await search(client, i);
      await read(client, 0);
    }
    const warmupMs = round(performance.now() - warming), before = await snapshot();
    const times = [], reads = [], searches = [], timed = performance.now();
    for (let iteration = 0; iteration < config.rounds; iteration++) {
      await Promise.all(clients.map(async (client, i) => {
        const start = performance.now(), isRead = iteration % 2 === 0;
        if (isRead) await read(client, (iteration * config.clients + i) % config.notes);
        else await search(client, iteration + i);
        const elapsed = performance.now() - start;
        times.push(elapsed); (isRead ? reads : searches).push(elapsed);
      }));
    }
    const workloadMs = round(performance.now() - timed), after = await snapshot();
    for (const old of before) if (after.find(row => row.id === old.id)?.start !== old.start) throw new Error('Process identity changed');
    const cpu = after.reduce((sum, row) => sum + row.cpuMs, 0) - before.reduce((sum, row) => sum + row.cpuMs, 0);
    if (cpu < 0) throw new Error('Process CPU counter moved backwards');
    report = { mode, serverCount: pids.length, startupMs, warmupMs, workloadMs, serverCpuMs: round(cpu),
      requestCount: times.length, latencyMs: latency(times), readLatencyMs: latency(reads), searchLatencyMs: latency(searches),
      memoryMiB: { before: memory(before), after: memory(after) } };
  } catch (error) { failure = error; throw error; }
  finally {
    // Settle every close before any fixture deletion, even if a different close fails.
    const closing = await Promise.allSettled(clients.map(client => client.close()));
    await Promise.allSettled(transports.map(transport => transport.close()));
    if (child && !closed) child.kill('SIGKILL'); // Direct child handle only; never process-name termination.
    if (childDone) await childDone;
    let remaining = pids.length ? await processes(pids, true) : [];
    const deadline = Date.now() + 3000;
    while (remaining.length && Date.now() < deadline) { await pause(50); remaining = await processes(pids, true); }
    if (remaining.length || closing.some(result => result.status === 'rejected')) throw new Error('Fixture cleanup unverified; preserving temporary Vault');
    const target = await realpath(vault), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe fixture cleanup');
    await rm(target, { recursive: true, force: true });
    if (report) report.cleanupVerified = true;
    if (failure) { failure.cleanupVerified = true; failure.trackedOwners = pids.length; }
  }
  return report;
}

if (failStartup) {
  let verified = false;
  try { await measure('stdio'); }
  catch (error) {
    if (error.message !== 'Injected failure after spawn before handshake' || !error.cleanupVerified || error.trackedOwners !== 1) throw error;
    verified = true;
  }
  if (!verified) throw new Error('Expected startup failure was not exercised');
  process.stdout.write(JSON.stringify({ expectedStartupFailure: true, trackedOwners: 1, cleanupVerified: true }) + '\n');
} else {
  const results = [];
  for (const mode of order) results.push(await measure(mode));
  process.stdout.write(JSON.stringify({ node: process.version, platform: process.platform, config, results,
    limits: 'Synthetic lexical reads only; no native embedding. End-to-end configurations with independently warmed stdio caches versus one shared HTTP cache, not a cache-isolated transport benchmark. Memory is summed server working-set/private-byte snapshots, not unique physical or peak RAM. Driver/probe memory excluded. CPU covers the two probe snapshots, including idle/probe gaps. Small samples, filesystem cache, JIT/GC and sequential startup/order affect latency; not a desktop-lag or large-Vault benchmark.' }, null, 2) + '\n');
}
