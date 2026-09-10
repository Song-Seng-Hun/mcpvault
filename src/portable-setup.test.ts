import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, symlink, chmod, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { validateTargetPath } from '../scripts/obsidian-host-plugins.mjs';

// The desktop sandbox cannot provision an owner-only Windows ACL. Simulate only
// the OS ACL metadata for in-process apply tests; CLI doctor still probes the OS.
const permissions = vi.hoisted(() => ({ broadPath: '' }));
vi.mock('node:child_process', async importOriginal => {
  const original = await importOriginal<typeof import('node:child_process')>();
  const { promisify: p } = await import('node:util');
  const realExec = p(original.execFile);
  const wrapped = Object.assign((...args: any[]) => (original.execFile as any)(...args), {
    [p.custom]: (file: string, args: string[], options: any) =>
      file === 'powershell.exe' && options?.env?.MCPVAULT_SETUP_ACL_PATH
        ? Promise.resolve({ stdout: JSON.stringify({ owner: 'fixture-user', user: 'fixture-user', allowed: [options.env.MCPVAULT_SETUP_ACL_PATH === permissions.broadPath ? 'S-1-1-0' : 'fixture-user'] }), stderr: '' })
        : realExec(file, args, options),
  });
  return { ...original, execFile: wrapped };
});

const exec = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(repository, 'scripts/mcpvault-setup.mjs');
const roots: string[] = [];
afterEach(async () => {
  permissions.broadPath = '';
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'mcpvault-portable-')));
  roots.push(root);
  const program = join(root, 'program'), vault = join(root, 'vault'), state = join(root, 'private');
  await mkdir(join(program, 'dist'), { recursive: true });
  await writeFile(join(program, 'dist/server.js'), '// fixture; never execute\n');
  await mkdir(join(program, 'dist/src'));
  for (const name of ['cli.js', 'createServer.js']) await writeFile(join(program, 'dist/src', name), '// fixture; never import\n');
  await mkdir(vault); await mkdir(state, { mode: 0o700 });
  const client = join(root, 'client.json');
  const flags = ['--operation', 'install-new-server', '--mode', 'stdio', '--program', program,
    '--vault', vault, '--private-state', state, '--client', client];
  return { root, program, vault, state, client, flags,
    options: { operation: 'install-new-server', mode: 'stdio', program, vault, privateState: state, client } };
}
function replace(flags: string[], key: string, value: string) {
  const copy = [...flags]; copy[copy.indexOf(key) + 1] = value; return copy;
}
async function run(args: string[], cwd = repository) {
  try {
    const result = await exec(process.execPath, [script, ...args], { cwd, timeout: 15000, maxBuffer: 1024 * 1024 });
    return { code: 0, ...result };
  } catch (error: any) { return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }; }
}
async function preview(flags: string[]) {
  const result = await run(flags); expect(result.stderr).toBe(''); expect(result.code).toBe(0);
  return JSON.parse(result.stdout);
}

describe('portable setup (synthetic paths only)', () => {
  test('previews by default without writing and uses absolute existing CLI launch arguments', async () => {
    const f = await fixture(); const plan = await preview(f.flags);
    expect(plan.action).toBe('preview'); expect(plan.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(plan.launch).toEqual({ command: process.execPath, args: [join(f.program, 'dist/server.js'), f.vault] });
    expect(plan.clientEntry).toEqual(plan.launch);
    expect(await readdir(f.state)).toEqual([]); expect(await readdir(f.vault)).toEqual([]);
    await expect(readFile(f.client)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  test('requires explicit absolute paths and refuses overlapping storage', async () => {
    const f = await fixture();
    await mkdir(join(f.vault, 'private'));
    for (const [key, value] of [['--vault', '.'], ['--program', ''], ['--private-state', join(f.vault, 'private')]]) {
      const result = await run(replace(f.flags, key!, value!));
      expect(result.code).not.toBe(0); expect(result.stderr).toMatch(/absolute|separate/i);
    }
  });
  test('rejects a canonical alias through a junction or symlink', async () => {
    const f = await fixture(); const alias = join(f.root, 'alias');
    await symlink(f.vault, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const result = await run(replace(f.flags, '--private-state', alias));
    expect(result.code).not.toBe(0); expect(result.stderr).toMatch(/symlink|junction|canonical|separate/i);
  });
  test('rejects client files in Vault or program and rejects hardlinked client files', async () => {
    const f = await fixture();
    for (const client of [join(f.vault, 'client.json'), join(f.program, 'client.json')]) {
      expect((await run(replace(f.flags, '--client', client))).stderr).toMatch(/separate|outside/i);
    }
    await writeFile(f.client, '{}');
    const { link } = await import('node:fs/promises'); await link(f.client, join(f.root, 'alias.json'));
    expect((await run(f.flags)).stderr).toMatch(/hardlink/i);
  });
  test('merges settings with a byte-exact recoverable backup and reports only the proposed entry', async () => {
    const f = await fixture(); const original = '{"theme":"dark","mcpServers":{"other":{"command":"fixture","env":{"TOKEN":"synthetic-secret"}}}}';
    await writeFile(f.client, original);
    const p = await preview(f.flags); expect(JSON.stringify(p)).not.toContain('synthetic-secret');
    const { applySetup } = await import('../scripts/mcpvault-setup.mjs');
    const report = await applySetup(f.options, p.fingerprint);
    expect(JSON.stringify(report)).not.toContain('synthetic-secret');
    expect(await readFile(report.backup, 'utf8')).toBe(original);
    const client = JSON.parse(await readFile(f.client, 'utf8'));
    expect(client.theme).toBe('dark'); expect(client.mcpServers.other).toEqual(JSON.parse(original).mcpServers.other);
    expect(client.mcpServers.mcpvault).toEqual(p.clientEntry);
    const again = await preview(f.flags); expect(again.change).toBe('unchanged');
  });
  test('requires fingerprint confirmation and rejects stale source revisions without writes', async () => {
    const f = await fixture(); const p = await preview(f.flags);
    expect((await run([...f.flags, '--action', 'apply'])).stderr).toMatch(/fingerprint|confirm/i);
    await writeFile(f.client, '{"changed":true}');
    expect((await run([...f.flags, '--action', 'apply', '--confirm', p.fingerprint])).stderr).toMatch(/fingerprint|stale/i);
    expect(await readFile(f.client, 'utf8')).toBe('{"changed":true}'); expect(await readdir(f.state)).toEqual([]);
  });
  test('binds confirmation to exact build artifact bytes', async () => {
    const f = await fixture(); const p = await preview(f.flags);
    await writeFile(join(f.program, 'dist/server.js'), '// changed');
    expect((await run([...f.flags, '--action', 'apply', '--confirm', p.fingerprint])).stderr).toMatch(/fingerprint|stale/i);
    await expect(readFile(f.client)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  test('doctor rejects incomplete core build artifacts and confirmation binds supporting artifacts', async () => {
    const f = await fixture(); const p = await preview(f.flags);
    const supporting = join(f.program, 'dist/src/createServer.js');
    await writeFile(supporting, '// changed supporting artifact');
    expect((await run([...f.flags, '--action', 'apply', '--confirm', p.fingerprint])).stderr).toMatch(/fingerprint|stale/i);
    await rm(supporting);
    const doctor = JSON.parse((await run([...f.flags, '--action', 'doctor'])).stdout);
    expect(doctor.checks.build.status).toBe('fail');
  });
  test('refuses conflicting client ownership and malformed JSON without disclosing contents', async () => {
    const f = await fixture();
    for (const content of ['{"mcpServers":{"mcpvault":{"command":"synthetic-secret"}}}', 'synthetic-secret', '{"mcpServers":[]}', '{"mcpServers":{"mcpvault":null}}']) {
      await writeFile(f.client, content); const result = await run(f.flags);
      expect(result.code).not.toBe(0); expect(result.stderr).toMatch(/conflict|JSON|object/i);
      expect(result.stderr).not.toContain('synthetic-secret'); expect(await readFile(f.client, 'utf8')).toBe(content);
    }
  });
  test('serializes concurrent applies and preserves a single completed merge', async () => {
    const f = await fixture(); await writeFile(f.client, '{"keep":true}'); const p = await preview(f.flags);
    const { applySetup } = await import('../scripts/mcpvault-setup.mjs');
    const results = await Promise.allSettled([1, 2].map(() => applySetup(f.options, p.fingerprint)));
    expect(results.filter(r => r.status === 'fulfilled'), JSON.stringify(results)).toHaveLength(1);
    expect(JSON.parse(await readFile(f.client, 'utf8'))).toMatchObject({ keep: true, mcpServers: { mcpvault: p.clientEntry } });
  });
  test.skipIf(process.platform !== 'win32')('refuses a client parent whose inherited Windows ACL would expose replacement settings', async () => {
    const f = await fixture(); await writeFile(f.client, '{"keep":true}');
    const { planSetup, applySetup } = await import('../scripts/mcpvault-setup.mjs');
    const p = await planSetup(f.options); permissions.broadPath = f.root;
    await expect(applySetup(f.options, p.fingerprint)).rejects.toThrow(/client.*permissions/i);
    expect(await readFile(f.client, 'utf8')).toBe('{"keep":true}');
    expect(await readdir(f.state)).toEqual([]);
  });
  test('local HTTP installation only proposes a loopback launch through existing CLI options', async () => {
    const f = await fixture(); const p = await preview(replace(f.flags, '--mode', 'local-http'));
    expect(p.clientEntry).toEqual({ url: 'http://127.0.0.1:8788/mcp' });
    expect(p.launch.args).toEqual([join(f.program, 'dist/server.js'), f.vault, '--mcp-http-only', '8788', '--mcp-http-host', '127.0.0.1']);
    expect(await readdir(f.vault)).toEqual([]);
  });
  test('connect existing server neither requires build artifacts nor proposes a process', async () => {
    const f = await fixture(); await rm(join(f.program, 'dist/server.js'));
    const flags = replace(replace(f.flags, '--operation', 'connect-existing-server'), '--mode', 'remote-https');
    const p = await preview([...flags, '--url', 'https://example.invalid/mcp']);
    expect(p.launch).toBeNull(); expect(p.clientEntry).toEqual({ url: 'https://example.invalid/mcp' });
  });
  test.each([
    ['connect-existing-server', 'stdio', undefined],
    ['install-new-server', 'remote-https', 'https://example.invalid/mcp'],
    ['install-new-server', 'local-http', 'http://0.0.0.0:8788/mcp'],
    ['connect-existing-server', 'remote-https', 'http://example.invalid/mcp'],
    ['connect-existing-server', 'remote-https', 'https://user:secret@example.invalid/mcp'],
    ['connect-existing-server', 'remote-https', 'https://example.invalid/mcp?token=secret'],
    ['connect-existing-server', 'remote-https', 'https://example.invalid/secret/mcp'],
  ])('rejects unsafe operation/transport/URL %s %s %s', async (operation, mode, url) => {
    const f = await fixture(); let args = replace(replace(f.flags, '--operation', operation), '--mode', mode);
    if (url) args = [...args, '--url', url]; const result = await run(args);
    expect(result.code).not.toBe(0); expect(result.stderr).toMatch(/mode|stdio|HTTPS|loopback|URL|remote/i);
    expect(result.stderr).not.toContain('secret');
  });
  test('exports only a strict versioned recipe and imports with explicit path remap preview', async () => {
    const f = await fixture(); await writeFile(join(f.state, 'credentials.json'), 'synthetic-private');
    const result = await run([...f.flags, '--action', 'export']); expect(result.code).toBe(0);
    expect(result.stdout).not.toContain(f.root); expect(result.stdout).not.toContain('synthetic-private');
    const manifest = JSON.parse(result.stdout); expect(manifest.version).toBe(1);
    const manifestPath = join(f.root, 'recipe.json'); await writeFile(manifestPath, result.stdout);
    const other = await fixture(); const p = await preview([...other.flags, '--action', 'import', '--manifest', manifestPath]);
    expect(p.remap).toMatchObject({ program: other.program, vault: other.vault, privateState: other.state, client: other.client });
    await expect(readFile(other.client)).rejects.toMatchObject({ code: 'ENOENT' });
    const { importManifest } = await import('../scripts/mcpvault-setup.mjs');
    const applied = await importManifest(manifest, other.options, p.fingerprint);
    expect(applied.action).toBe('apply'); expect(await readdir(other.vault)).toEqual([]);
  });
  test.each(['credentials', 'identity', 'checkpoint', 'env', 'files'])('rejects non-allowlisted manifest payload %s', async key => {
    const f = await fixture(); const result = await run([...f.flags, '--action', 'export']);
    expect(result.code).toBe(0); const manifest = JSON.parse(result.stdout); manifest[key] = 'do-not-copy';
    const path = join(f.root, 'recipe.json'); await writeFile(path, JSON.stringify(manifest));
    const rejected = await run([...f.flags, '--action', 'import', '--manifest', path]);
    expect(rejected.code).not.toBe(0); expect(rejected.stderr).toMatch(/manifest|unsupported/i);
  });
  test('doctor is read-only and reports build, runtime, storage, permissions and optional features', async () => {
    const f = await fixture(); const p = JSON.parse((await run([...f.flags, '--action', 'doctor'])).stdout);
    expect(p.action).toBe('doctor'); expect(p.checks.node.status).toBe('pass');
    expect(p.checks.build.status).toBe('pass'); expect(p.checks.paths.status).toBe('pass');
    expect(['pass', 'fail', 'manual']).toContain(p.checks.privatePermissions.status);
    expect(p.checks.endpoint.status).toBe('skipped'); expect(p.checks.pdfSandbox.status).toBe('disabled');
    expect(await readdir(f.state)).toEqual([]); expect(await readdir(f.vault)).toEqual([]);
    await rm(join(f.program, 'dist/server.js'));
    const report = await run([...f.flags, '--action', 'doctor']);
    expect(JSON.parse(report.stdout).checks.build.status).toBe('fail');
  });
  test.skipIf(process.platform === 'win32')('doctor reports broad POSIX private permissions without repairing them', async () => {
    const f = await fixture(); await chmod(f.state, 0o755);
    const result = await run([...f.flags, '--action', 'doctor']);
    expect(JSON.parse(result.stdout).checks.privatePermissions.status).toBe('fail');
  });
  test('endpoint doctor lists exactly the five control-plane tools without tool calls or starting a server', async () => {
    const f = await fixture(); const methods: string[] = [];
    const server = createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body); methods.push(input.method);
      const result = input.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
        : { tools: ['orient_wiki', 'get_agent_pulse', 'list_active_capabilities', 'search_capabilities', 'call_endpoint'].map(name => ({ name, inputSchema: { type: 'object' } })) };
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address() as { port: number };
      const p = JSON.parse((await run([...replace(replace(f.flags, '--mode', 'local-http'), '--operation', 'connect-existing-server'), '--action', 'doctor', '--check-endpoint', '--url', `http://127.0.0.1:${address.port}/mcp`])).stdout);
      expect(p.checks.endpoint.status).toBe('pass'); expect(methods).toContain('tools/list');
      expect(methods.every(m => ['initialize', 'notifications/initialized', 'tools/list'].includes(m))).toBe(true);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  test('non-Windows PDF sandbox requests are rejected with no fallback (platform branch)', async () => {
    const module = await import('../scripts/mcpvault-setup.mjs');
    expect(() => module.platformFeatures('linux', true)).toThrow(/Windows|unsupported/i);
    expect(() => module.platformFeatures('darwin', true)).toThrow(/Windows|unsupported/i);
    expect(module.platformFeatures('win32', false).pdfSandbox.status).toBe('disabled');
  });
});

describe('portable existing host scripts', () => {
  test.each(['target', 'confirmation'])('Obsidian rejects junction-plus-parent traversal in the raw %s path', async field => {
    const f = await fixture(); await mkdir(join(f.vault, '.obsidian'));
    const alias = join(f.vault, 'alias');
    await symlink(f.program, alias, process.platform === 'win32' ? 'junction' : 'dir');
    // Do not use join/resolve: these erase the dangerous component before testing.
    const traversal = `${alias}${sep}..`;
    await expect(validateTargetPath(field === 'target' ? traversal : f.vault,
      field === 'confirmation' ? traversal : f.vault)).rejects.toThrow(/canonical|traversal/i);
  });
  test.skipIf(process.platform !== 'win32').each(['\\\\?\\', '\\\\.\\'])('Obsidian rejects Windows device namespace %s before normalizing the target', async prefix => {
    const f = await fixture(); await mkdir(join(f.vault, '.obsidian'));
    const devicePath = `${prefix}${f.vault}`;
    await expect(validateTargetPath(devicePath, devicePath)).rejects.toThrow(/canonical|device/i);
  });
  test.skipIf(process.platform !== 'win32')('Obsidian binds the validated target to filesystem realpath instead of caller casing', async () => {
    const f = await fixture(); await mkdir(join(f.vault, '.obsidian'));
    const spelling = f.vault.toUpperCase();
    await expect(validateTargetPath(spelling, spelling)).resolves.toBe(await realpath(f.vault));
  });
  test('Obsidian target has no inferred machine default and retains exact target and symlink guards', async () => {
    const f = await fixture(); await mkdir(join(f.vault, '.obsidian'));
    await expect(validateTargetPath(f.vault)).rejects.toThrow(/explicit|confirmed/i);
    await expect(validateTargetPath(f.vault, f.vault)).resolves.toBe(f.vault);
    await expect(validateTargetPath(f.vault, f.program)).rejects.toThrow(/exact target/i);
    const alias = join(f.root, 'alias'); await symlink(f.vault, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(validateTargetPath(alias, alias)).rejects.toThrow(/symlink/i);
  });
  test('Obsidian CLI accepts an explicit confirmation path on a different host', async () => {
    const f = await fixture(); await mkdir(join(f.vault, '.obsidian'));
    const result = await exec(process.execPath, [join(repository, 'scripts/obsidian-host-plugins.mjs'), '--action', 'status', '--target', f.vault, '--confirm-target', f.vault]);
    expect(JSON.parse(result.stdout).action).toBe('status');
  });
  test('roleplay host resolves built modules relative to its script from an unrelated cwd', async () => {
    const f = await fixture(); const scripts = join(f.program, 'scripts'); await mkdir(scripts);
    await writeFile(join(scripts, 'roleplay-host.mjs'), await readFile(join(repository, 'scripts/roleplay-host.mjs')));
    await mkdir(join(f.program, 'dist/src'), { recursive: true });
    await writeFile(join(f.program, 'package.json'), '{"type":"module"}');
    await writeFile(join(f.program, 'dist/src/roleplay-host.js'), 'export async function loadRoleplayHostConfig(){return {fixture:true}}');
    await writeFile(join(f.program, 'dist/src/roleplay-recovery.js'), 'export async function inspectRoleplayRecovery(o){return o}; export function recoverRoleplayWriter(){throw Error("never recover")}');
    const result = await exec(process.execPath, [join(scripts, 'roleplay-host.mjs'), 'inspect', f.vault, join(f.state, 'fixture.json')], { cwd: f.root });
    expect(JSON.parse(result.stdout)).toEqual({ fixture: true });
  });
});
