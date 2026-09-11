#!/usr/bin/env node
// Installation assistant only. Runtime authority remains server.ts CLI/environment.
import { createHash, randomUUID } from 'node:crypto';
import { lstat, realpath, open, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isDeepStrictEqual } from 'node:util';

const MAX_JSON = 1024 * 1024;
const CORE_ARTIFACTS = ['dist/server.js', 'dist/src/cli.js', 'dist/src/createServer.js'];
const CONTROL_PLANE = ['orient_wiki', 'get_agent_pulse', 'list_active_capabilities', 'search_capabilities', 'call_endpoint'];
const PATH_SLOTS = { program: '${PROGRAM}', vault: '${VAULT}', privateState: '${PRIVATE_STATE}', client: '${CLIENT}' };
const CLIENT_PATH_SLOTS = { privateState: '${PRIVATE_STATE}', client: '${CLIENT}' };
const clientOnly = options => options.operation === 'connect-existing-server' && options.mode === 'remote-https';
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fingerprint = value => hash(JSON.stringify(value));
const within = (parent, child) => { const r = relative(parent, child); return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`)); };

/** Reject aliases instead of following links into an unreviewed storage boundary. */
async function ordinaryPath(value, kind, allowMissing = false) {
  if (typeof value !== 'string' || !value || !isAbsolute(value) || /[\x00-\x1f]/.test(value)) throw new Error('explicit absolute paths are required');
  if (value.split(/[\\/]/).includes('..') || (process.platform === 'win32' && (/^\\\\[?.]\\/.test(value) || value.slice(parse(value).root.length).split(/[\\/]/).some(p => /[ .:]$|:/.test(p))))) {
    throw new Error('use canonical paths without device aliases or traversal');
  }
  const absolute = resolve(value);
  if (absolute === parse(absolute).root) throw new Error('use a separate named directory, not a filesystem root');
  let cursor = parse(absolute).root;
  const parts = absolute.slice(cursor.length).split(sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    cursor = join(cursor, parts[index]);
    let stat;
    try { stat = await lstat(cursor); }
    catch (error) {
      if (error.code === 'ENOENT' && allowMissing && index === parts.length - 1) return { path: join(await realpath(dirname(cursor)), parts[index]), stat: null };
      throw new Error('required path or parent directory is unavailable');
    }
    if (stat.isSymbolicLink()) throw new Error('symlink/junction paths are not accepted; supply the canonical path');
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error('path ancestor must be a directory');
    if (index === parts.length - 1) {
      if (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) throw new Error(`path must be an ordinary ${kind}`);
      if (kind === 'file' && stat.nlink > 1) throw new Error('hardlinked client or artifact files are not accepted');
      return { path: await realpath(cursor), stat };
    }
  }
}

async function readBounded(path, optional = false) {
  const target = await ordinaryPath(path, 'file', optional);
  if (!target.stat) return null;
  if (target.stat.size > MAX_JSON) throw new Error('file exceeds the 1 MiB bound');
  const handle = await open(target.path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink > 1 || stat.ino !== target.stat.ino || stat.dev !== target.stat.dev) throw new Error('file changed during read');
    const bytes = Buffer.alloc(MAX_JSON + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > MAX_JSON) throw new Error('file exceeds the 1 MiB bound');
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}

function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error(`${label} must be valid JSON; refusing to overwrite`); }
}

function connection(options) {
  const { operation, mode } = options;
  if (!['install-new-server', 'connect-existing-server'].includes(operation)) throw new Error('operation must be install-new-server or connect-existing-server');
  if (!['stdio', 'local-http', 'remote-https'].includes(mode)) throw new Error('mode must be stdio, local-http or remote-https');
  if (operation === 'connect-existing-server' && mode === 'stdio') throw new Error('stdio launches a new process; use install-new-server mode');
  if (operation === 'install-new-server' && mode === 'remote-https') throw new Error('remote HTTPS is connect-only; new servers must start with loopback or stdio');
  if (mode === 'stdio') {
    if (options.url) throw new Error('stdio mode does not accept a URL');
    return null;
  }
  let url;
  try { url = new URL(options.url ?? (mode === 'local-http' ? 'http://127.0.0.1:8788/mcp' : '')); }
  catch { throw new Error('an explicit valid endpoint URL is required'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/mcp') throw new Error('endpoint URL must use /mcp without credentials, query or fragment');
  if (mode === 'local-http' && (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('local HTTP requires a numeric loopback URL');
  if (mode === 'remote-https' && url.protocol !== 'https:') throw new Error('remote mode requires HTTPS');
  if (url.port === '0') throw new Error('endpoint URL requires a nonzero port');
  return url;
}

async function paths(options) {
  // A remote client has no local server or Vault. If legacy callers explicitly
  // supply those paths, still validate their storage boundaries rather than
  // silently ignoring a client located inside a supplied Vault/program.
  const program = clientOnly(options) && options.program === undefined ? undefined : await ordinaryPath(options.program, 'directory');
  const vault = clientOnly(options) && options.vault === undefined ? undefined : await ordinaryPath(options.vault, 'directory');
  const state = await ordinaryPath(options.privateState, 'directory');
  const client = await ordinaryPath(options.client, 'file', true);
  const directories = [program?.path, vault?.path, state.path].filter(Boolean);
  for (let i = 0; i < directories.length; i++) for (let j = i + 1; j < directories.length; j++) {
    if (within(directories[i], directories[j]) || within(directories[j], directories[i])) throw new Error('program, Vault and private state must be separate canonical directories');
  }
  if (program && within(program.path, client.path) || vault && within(vault.path, client.path)) throw new Error('client JSON must be outside program and Vault directories');
  if (client.path.endsWith('.mcpvault-setup.lock')) throw new Error('client path conflicts with the installer lock suffix');
  return { ...(program && { program: program.path }), ...(vault && { vault: vault.path }), privateState: state.path, client: client.path };
}

export function platformFeatures(platform = process.platform, requestedPdf = false) {
  if (requestedPdf && platform !== 'win32') throw new Error('Windows PDF sandbox is unsupported on this platform; no fallback is permitted');
  return {
    pdfSandbox: { status: requestedPdf ? 'manual' : 'disabled', detail: requestedPdf ? 'Windows AppContainer provisioning and the existing PDF host configuration must be verified separately; never enabled by setup.' : 'Optional Windows-only sandbox; no extraction or fallback performed.' },
    obsidian: { status: 'manual', detail: 'Optional desktop plugins have a separate explicit-target installer.' },
    service: { status: 'manual', detail: 'No service manager, firewall, certificate or startup registration is changed.' },
  };
}

export function nodeCheck(version = process.versions.node) {
  return { status: Number(version.split('.')[0]) >= 22 ? 'pass' : 'fail', detail: 'Node.js >=22 is required.' };
}

async function privatePermissions(path) {
  const { stat } = await ordinaryPath(path, 'directory');
  if (process.platform !== 'win32') {
    return { status: (stat.mode & 0o077) === 0 && stat.uid === process.getuid() ? 'pass' : 'fail', detail: 'Private directory must be owned by the current user with mode 0700 (no group/other access).' };
  }
  // Read metadata only. No credentials/configuration bodies or ACL mutations.
  try {
    const code = "$ErrorActionPreference='Stop'; $a=[System.IO.Directory]::GetAccessControl($env:MCPVAULT_SETUP_ACL_PATH); $u=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $s=@($a.Access | Where-Object {$_.AccessControlType -eq 'Allow'} | ForEach-Object {$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value}); @{owner=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; user=$u; allowed=$s} | ConvertTo-Json -Compress";
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], {
      windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024, env: { ...process.env, MCPVAULT_SETUP_ACL_PATH: path },
    });
    const acl = JSON.parse(stdout);
    const trusted = [acl.user, 'S-1-5-18', 'S-1-5-32-544'];
    const secure = trusted.includes(acl.owner) && Array.isArray(acl.allowed) && acl.allowed.length > 0 && acl.allowed.every(sid => trusted.includes(sid));
    return { status: secure ? 'pass' : 'fail', detail: 'Windows ACL owner and allow entries must be limited to current user, SYSTEM and Administrators.' };
  } catch { return { status: 'manual', detail: 'Windows ACL inspection unavailable; verify private directory permissions before apply.' }; }
}

async function buildArtifacts(program) {
  const artifacts = {};
  for (const name of CORE_ARTIFACTS) {
    const bytes = await readBounded(join(program, name));
    if (!bytes.length) throw new Error('core build artifacts must not be empty');
    artifacts[name] = hash(bytes);
  }
  return artifacts;
}

async function prepare(options) {
  if (nodeCheck().status !== 'pass') throw new Error('Node.js >=22 is required');
  const url = connection(options);
  platformFeatures(process.platform, options.pdfSandbox);
  const canonical = await paths(options);
  let launch = null, buildHash = null;
  if (options.operation === 'install-new-server') {
    const entry = join(canonical.program, 'dist/server.js');
    buildHash = fingerprint(await buildArtifacts(canonical.program));
    launch = { command: process.execPath, args: [entry, canonical.vault] };
    if (options.mode === 'local-http') launch.args.push('--mcp-http-only', url.port || '80', '--mcp-http-host', url.hostname.replace(/^\[|\]$/g, ''));
  }
  const clientEntry = options.mode === 'stdio' ? launch : { url: url.href };
  const original = await readBounded(canonical.client, true);
  const existing = original === null ? {} : parseJson(original, 'client');
  if (!object(existing) || (existing.mcpServers !== undefined && !object(existing.mcpServers))) throw new Error('client JSON and mcpServers must be objects');
  const servers = existing.mcpServers ?? {};
  const hasEntry = Object.hasOwn(servers, 'mcpvault');
  if (hasEntry && !isDeepStrictEqual(servers.mcpvault, clientEntry)) throw new Error('client mcpvault entry conflict; resolve ownership manually before setup');
  const next = { ...existing, mcpServers: { ...servers, mcpvault: clientEntry } };
  const bytes = Buffer.from(JSON.stringify(next, null, 2) + '\n');
  if (bytes.length > MAX_JSON) throw new Error('merged client exceeds the 1 MiB bound');
  const basis = { version: clientOnly(options) ? 2 : 1, operation: options.operation, mode: options.mode, paths: canonical, clientEntry, launch, buildHash,
    clientHash: original === null ? null : hash(original), pdfSandbox: Boolean(options.pdfSandbox) };
  return { original, bytes, report: { action: 'preview', ...basis, change: hasEntry ? 'unchanged' : 'merge', fingerprint: fingerprint(basis),
    backupPolicy: 'Byte-exact client JSON backup in private state on change; never part of an export.' } };
}

export async function planSetup(options) { return (await prepare(options)).report; }

async function durableCreate(path, bytes) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}

/** One cooperating installer per client; external client editors must be stopped. */
export async function applySetup(options, confirmation) {
  const prepared = await prepare(options);
  if (!confirmation || confirmation !== prepared.report.fingerprint) throw new Error('confirmation fingerprint is missing or stale; preview again');
  if (prepared.report.change === 'unchanged') return { ...prepared.report, action: 'apply', backup: null };
  const permission = await privatePermissions(prepared.report.paths.privateState);
  if (permission.status !== 'pass') throw new Error('private permissions are not verified; use doctor and provision a private directory first');
  const target = prepared.report.paths.client;
  if (process.platform === 'win32' && (await privatePermissions(dirname(target))).status !== 'pass') {
    throw new Error('client parent permissions are not private; replacement settings would inherit unsafe Windows access');
  }
  const lockPath = `${target}.mcpvault-setup.lock`;
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch { throw new Error('client installation lock exists or is unavailable; inspect any interrupted setup before retrying'); }
  let temporary, backup;
  try {
    // Re-read under the lock; both the source bytes and all path/artifact bindings must match.
    const current = await prepare(options);
    if (current.report.fingerprint !== confirmation) throw new Error('confirmation fingerprint is stale; preview again');
    const id = randomUUID();
    backup = join(current.report.paths.privateState, `client-${id}.${current.original === null ? 'absent.json' : 'bak'}`);
    await durableCreate(backup, current.original ?? Buffer.from(JSON.stringify({ version: 1, existed: false, target }) + '\n'));
    temporary = join(dirname(target), `.mcpvault-setup-${id}.tmp`);
    await durableCreate(temporary, current.bytes);
    const beforeRename = await prepare(options);
    if (beforeRename.report.fingerprint !== confirmation) throw new Error('client or artifact changed before write; backup retained');
    await rename(temporary, target); temporary = undefined;
    const verified = await readBounded(target);
    if (!verified?.equals(current.bytes)) throw new Error('post-write verification failed; stop writers and inspect the private backup');
    return { ...current.report, action: 'apply', backup, installedHash: hash(verified) };
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}

/** Recipe only: do not read local configuration, host identity, checkpoints or Vault bodies. */
export function exportManifest(options) {
  connection(options);
  return { format: 'mcpvault-portable-installation', version: clientOnly(options) ? 2 : 1, operation: options.operation, mode: options.mode, paths: { ...(clientOnly(options) ? CLIENT_PATH_SLOTS : PATH_SLOTS) } };
}

function validateManifest(value) {
  const fields = ['format', 'version', 'operation', 'mode', 'paths'];
  if (!object(value) || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))
    || value.format !== 'mcpvault-portable-installation'
    || !(value.version === 1 && isDeepStrictEqual(value.paths, PATH_SLOTS)
      || value.version === 2 && clientOnly(value) && isDeepStrictEqual(value.paths, CLIENT_PATH_SLOTS))) {
    throw new Error('unsupported manifest; only the versioned installation recipe is accepted');
  }
  return value;
}

export async function importManifest(manifest, remap, confirmation) {
  const recipe = validateManifest(manifest);
  if ((remap.operation && remap.operation !== recipe.operation) || (remap.mode && remap.mode !== recipe.mode)) throw new Error('manifest operation/mode conflict; do not override the recipe');
  const options = { ...remap, operation: recipe.operation, mode: recipe.mode };
  const report = confirmation ? await applySetup(options, confirmation) : await planSetup(options);
  return { ...report, remap: report.paths };
}

async function boundedResponse(response) {
  if (Number(response.headers.get('content-length')) > MAX_JSON) throw new Error('endpoint response exceeds bound');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty endpoint response');
  let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > MAX_JSON) throw new Error('endpoint response exceeds bound'); chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}

async function endpointCheck(url) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  async function rpc(method, id, params) {
    const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(4000), headers,
      body: JSON.stringify({ jsonrpc: '2.0', ...(id !== undefined && { id }), method, ...(params && { params }) }) });
    if (!response.ok) throw new Error('endpoint unavailable or authentication requires separate client provisioning');
    const session = response.headers.get('mcp-session-id'); if (session) headers['Mcp-Session-Id'] = session;
    if (id === undefined) { await response.body?.cancel(); return; }
    const text = await boundedResponse(response);
    let payload;
    try {
      payload = response.headers.get('content-type')?.includes('text/event-stream')
        ? text.split(/\r?\n\r?\n/).map(event => event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')).filter(Boolean).map(s => JSON.parse(s)).find(item => item.id === id)
        : JSON.parse(text);
    } catch { throw new Error('invalid endpoint protocol response'); }
    if (payload?.jsonrpc !== '2.0' || payload.id !== id || payload.error || !object(payload.result)) throw new Error('invalid endpoint protocol response');
    return payload.result;
  }
  try {
    const init = await rpc('initialize', 1, { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mcpvault-readonly-doctor', version: '1' } });
    if (!['2024-11-05', '2025-03-26', '2025-06-18'].includes(init.protocolVersion)) throw new Error('unsupported endpoint protocol version');
    headers['MCP-Protocol-Version'] = init.protocolVersion;
    await rpc('notifications/initialized');
    const result = await rpc('tools/list', 2);
    const names = Array.isArray(result.tools) ? result.tools.map(tool => tool?.name) : [];
    if (result.nextCursor || names.length !== CONTROL_PLANE.length || !CONTROL_PLANE.every(name => names.includes(name))) throw new Error('endpoint does not expose the exact five-tool control plane');
    return { status: 'pass', detail: 'Exact five-tool control plane verified; no tools called.' };
  } catch {
    // Remote errors and response bodies can contain secrets or hostile instructions.
    return { status: 'fail', detail: 'Control-plane check failed: verify reachability, authentication and exact five-tool protocol with the host.' };
  }
}

export async function doctor(options) {
  const checks = { node: nodeCheck(), ...platformFeatures(process.platform, options.pdfSandbox) };
  const url = connection(options);
  let canonical;
  try { canonical = await paths(options); checks.paths = { status: 'pass', detail: 'Explicit canonical paths are separated.' }; }
  catch (error) { checks.paths = { status: 'fail', detail: error.message }; }
  checks.build = { status: 'skipped', detail: 'Connect-existing does not require a local build.' };
  if (options.operation === 'install-new-server') {
    try {
      if (!canonical) throw new Error('paths failed');
      const artifacts = await buildArtifacts(canonical.program);
      checks.build = { status: 'pass', artifacts, detail: 'Core server/CLI/control-plane artifacts are present; no build, import or server start performed. Other dependencies and build freshness require separate validation.' };
    } catch { checks.build = { status: 'fail', detail: 'Core built server/CLI/control-plane artifacts are unavailable; obtain a verified build separately.' }; }
  }
  checks.privatePermissions = canonical ? await privatePermissions(canonical.privateState) : { status: 'fail', detail: 'Resolve path errors first.' };
  checks.clientPermissions = process.platform === 'win32' && canonical
    ? await privatePermissions(dirname(canonical.client))
    : { status: 'skipped', detail: 'On POSIX, replacement client and backup files are created with mode 0600.' };
  checks.endpoint = options.checkEndpoint && url ? await endpointCheck(url) : { status: 'skipped', detail: 'Requires explicit --check-endpoint with an HTTP mode; stdio is never started.' };
  return { action: 'doctor', platform: process.platform, ok: !Object.values(checks).some(check => check.status === 'fail'), checks };
}

function parseArgs(args) {
  const valued = { '--action': 'action', '--operation': 'operation', '--mode': 'mode', '--program': 'program', '--vault': 'vault', '--private-state': 'privateState', '--client': 'client', '--url': 'url', '--confirm': 'confirm', '--manifest': 'manifest' };
  const boolean = { '--check-endpoint': 'checkEndpoint', '--pdf-sandbox': 'pdfSandbox' };
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = valued[args[i]] ?? boolean[args[i]];
    if (!key || Object.hasOwn(options, key)) throw new Error('unknown or duplicate setup option');
    if (boolean[args[i]]) options[key] = true;
    else {
      const value = args[++i]; if (!value || value.startsWith('--')) throw new Error('setup options require explicit values and absolute paths');
      options[key] = value;
    }
  }
  options.action ??= 'preview';
  if (!['preview', 'apply', 'doctor', 'export', 'import'].includes(options.action)) throw new Error('action must be preview, apply, doctor, export or import');
  if (options.confirm && !['apply', 'import'].includes(options.action)) throw new Error('--confirm requires apply or import');
  if (options.checkEndpoint && options.action !== 'doctor') throw new Error('--check-endpoint is only available to doctor');
  if (options.manifest && options.action !== 'import') throw new Error('--manifest requires import');
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let report;
  switch (options.action) {
    case 'preview': report = await planSetup(options); break;
    case 'apply': report = await applySetup(options, options.confirm); break;
    case 'doctor': report = await doctor(options); if (!report.ok) process.exitCode = 1; break;
    case 'export': report = exportManifest(options); break;
    case 'import': report = await importManifest(parseJson(await readBounded(options.manifest), 'manifest'), options, options.confirm); break;
  }
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Native filesystem errors may echo unrelated contents/paths; keep diagnostics bounded.
    console.error(error?.code ? 'setup filesystem operation failed; inspect explicit paths and permissions' : error.message);
    process.exitCode = 1;
  });
}
