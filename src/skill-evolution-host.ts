import { guidanceError } from './guidance-runtime.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, isAbsolute, relative, sep, join, basename } from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readFederationFile } from './public-federation-storage.js';
import { profileFingerprint, type SkillEvaluationProfile } from './skill-evaluation.js';
import type { SkillEvolutionHost } from './skill-evolution.js';
import { createTrustedSkillEvaluationProfiles } from './skill-evaluation-profiles.js';

const inside = (root: string, path: string): boolean => { const r = relative(root, path); return !r || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r)); };
const local = (path: string): boolean => isAbsolute(path) && !/^(?:\\\\|\/\/)/.test(path);
const runFile = promisify(execFile);

/** Fail closed before reading secrets; no paths, ACL details or key contents are logged. */
export async function assertHostPrivateStorage(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    const info = await lstat(path);
    if (!local(path) || info.isSymbolicLink() || !(info.isDirectory() || info.isFile()) || await realpath(path) !== path) throw guidanceError(new Error('Host private storage requires canonical local paths without links'), 'guid-d86d734e1f7df8be');
    if (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid()))) throw guidanceError(new Error('Host private storage permissions must be owner-only'), 'guid-7c8ada537ca42c7b');
  }
  if (process.platform === 'win32') {
    // Static program; canonical Windows paths travel in an environment value, never executable text.
    const program = `$ErrorActionPreference='Stop'; try {
      $identity=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
      $allowed=@($identity,'S-1-5-18','S-1-5-32-544')
      foreach($path in $env:MCPVAULT_PRIVATE_CHECK_PATHS.Split([char]10)) {
        if([IO.Directory]::Exists($path)) {$acl=[IO.Directory]::GetAccessControl($path)}
        else {$acl=[IO.File]::GetAccessControl($path)}
        $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
        if($allowed -notcontains $owner){exit 2}
        foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
          if($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $rule.IdentityReference.Value){exit 3}
        }
      }
      exit 0
    } catch {exit 4}`;
    try {
      await runFile(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', program],
        { windowsHide: true, timeout: 10000, maxBuffer: 1024, env: { ...process.env,
          PSModulePath: join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
          MCPVAULT_PRIVATE_CHECK_PATHS: paths.join('\n') } });
    } catch (error) { throw guidanceError(new Error(`Host private storage permissions could not be verified (check code ${(error as { code?: unknown }).code ?? 'unavailable'})`), 'guid-3c27527344dbc762'); }
  }
}

/** Host-only loader. JSON selects registered profiles; it cannot load scripts or inline keys. */
export async function loadSkillEvolutionHostConfig(configPath: string, expectedVault: string, registeredProfiles: readonly SkillEvaluationProfile[] = createTrustedSkillEvaluationProfiles()): Promise<SkillEvolutionHost> {
  if (!local(configPath) || !isAbsolute(expectedVault)) throw guidanceError(new Error('Skill evolution configuration requires absolute private host and Vault paths'), 'guid-edec5828dc744b3d');
  const directory = dirname(configPath), vault = await realpath(expectedVault);
  const compiled = dirname(dirname(fileURLToPath(import.meta.url))), source = basename(compiled) === 'dist' ? dirname(compiled) : compiled;
  if (inside(vault, directory) || inside(source, directory)) throw guidanceError(new Error('Skill evolution configuration must be outside Vault/source in private storage'), 'guid-21c04b7267006371');
  await assertHostPrivateStorage([directory, configPath]);
  let raw: any;
  try { raw = JSON.parse(await readFederationFile(directory, configPath, { maxBytes: 8192 })); }
  catch { throw guidanceError(new Error('Invalid or unavailable skill evolution configuration'), 'guid-9eb630366d07760c'); }
  if (!raw || raw.version !== 1 || typeof raw.enabled !== 'boolean'
    || Object.keys(raw).some(k => !['version', 'vaultPath', 'enabled', 'attestationKeyFile', 'approverAccounts', 'profileIds'].includes(k))) throw guidanceError(new Error('Invalid skill evolution configuration'), 'guid-4d4fe90e090414b6');
  if (typeof raw.vaultPath !== 'string' || !isAbsolute(raw.vaultPath) || await realpath(raw.vaultPath) !== vault) throw guidanceError(new Error('Skill evolution configuration belongs to another Vault'), 'guid-34ad54599515207a');
  if (typeof raw.attestationKeyFile !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(raw.attestationKeyFile)) throw guidanceError(new Error('Skill evolution key must be a private sibling file'), 'guid-ac09bac55dedcc28');
  if (!Array.isArray(raw.approverAccounts) || raw.approverAccounts.length > 20 || raw.approverAccounts.some((id: unknown) => typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id))) throw guidanceError(new Error('Invalid skill approval accounts in configuration'), 'guid-0becf4fd37f41b9e');
  if (!Array.isArray(raw.profileIds) || raw.profileIds.length > 100 || raw.profileIds.some((id: unknown) => typeof id !== 'string' || !id || id.length > 128) || new Set(raw.profileIds).size !== raw.profileIds.length) throw guidanceError(new Error('Invalid skill profile identifiers'), 'guid-f3dabd4de1ecd163');
  const profiles = raw.profileIds.map((id: string) => {
    const matches = registeredProfiles.filter(p => p.id === id);
    if (matches.length !== 1 || !profileFingerprint(matches[0])) throw guidanceError(new Error('Skill profile is not uniquely registered by host code'), 'guid-486534f4168da8e9');
    return matches[0]!;
  });
  if (new Set(profiles.map((p: SkillEvaluationProfile) => p.skillId)).size !== profiles.length) throw guidanceError(new Error('Only one registered profile per skill is supported'), 'guid-111158398fd1d75f');
  const keyPath = join(directory, raw.attestationKeyFile);
  let key: string;
  try {
    await assertHostPrivateStorage([directory, configPath, keyPath]);
    key = (await readFederationFile(directory, keyPath, { maxBytes: 512 })).trim();
  } catch { throw guidanceError(new Error('Skill evolution key storage is unavailable or not private'), 'guid-46ec4feb2d119755'); }
  if (key.length < 32 || key.length > 256 || /\s/.test(key)) throw guidanceError(new Error('Invalid skill evolution attestation key'), 'guid-507c8d8e99459b41');
  return { enabled: raw.enabled, attestationKey: key, approverAccounts: [...new Set<string>(raw.approverAccounts)], profiles };
}
