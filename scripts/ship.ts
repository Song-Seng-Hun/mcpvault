#!/usr/bin/env bun

/**
 * Project-owned client for shibumi-server.
 *
 * `bun run ship:setup` connects this repository to one server and creates its
 * GitHub webhook. Later, `bun run ship` checks local work, pushes one commit,
 * and follows deployment status until the app is healthy.
 *
 * Commit this file and shibumi-server.json. SSH targets stay in local Git
 * config. Webhook secrets stay on the server and pass directly to GitHub CLI.
 */

import { cancel, confirm, intro, isCancel, log, outro, spinner, text } from "@clack/prompts";
import { chmod, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = process.cwd();
const configPath = join(root, "shibumi-server.json");
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SSH_TARGET = /^(?!-)[A-Za-z0-9_.@:-]+$/;
const COMMIT = /^[a-f0-9]{40}$/;
const SERVER_CLI = "~/.local/bin/shibumi-server";
const LATEST_SOURCE = "https://shibumistack.dev/ship/latest.ts";
const CURRENT_SOURCE = "https://shibumistack.dev/ship/v19.ts";
let sshControlDirectory: string | undefined;
let sshControlTarget: string | undefined;
const accent = (value: string) => process.stdout.isTTY && !("NO_COLOR" in process.env) && process.env.TERM !== "dumb"
  ? `\x1b[38;5;208m${value}\x1b[0m`
  : value;

interface ClientConfig {
  version: 1;
  provider: "shibumi-server";
  server: { hostname: string };
  domain: string;
  appId: string;
  repository: `github:${string}`;
  branch: string;
  webhookUrl: string;
  service: string;
  healthPath: string;
  cutoverRequired: boolean;
}

interface Result {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface DeployStatus {
  commit?: string;
  state?: string;
  stage?: string;
  message?: string;
  output?: string;
  url?: string;
  queuedCommit?: string;
}

interface HistoryEntry {
  commit?: string;
  state?: string;
  stage?: string;
}

function explain(title: string, message: string): void {
  log.info(`${title}\n${message}`);
}

// Run argument arrays directly. Avoiding a shell keeps repository and SSH input
// from becoming executable command text.
async function run(args: string[], options: { input?: string; inherit?: boolean; allowFailure?: boolean } = {}): Promise<Result> {
  const inherit = options.inherit ?? false;
  const child = Bun.spawn(args, {
    cwd: root,
    stdin: options.input === undefined ? (inherit ? "inherit" : "ignore") : "pipe",
    stdout: inherit ? "inherit" : "pipe",
    stderr: inherit ? "inherit" : "pipe",
  });
  if (options.input !== undefined) {
    if (!child.stdin) throw new Error("cannot open command input");
    child.stdin.write(options.input);
    child.stdin.end();
  }
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    inherit ? Promise.resolve("") : new Response(child.stdout).text(),
    inherit ? Promise.resolve("") : new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0 && !options.allowFailure) throw new Error(stderr.trim() || `${args[0]} exited with ${exitCode}`);
  return { exitCode, stdout, stderr };
}

async function git(...args: string[]): Promise<string> {
  return (await run(["git", ...args])).stdout.trim();
}

const setupFiles = ["package.json", "bun.lock", "scripts/ship.ts", "shibumi-server.json"];

async function offerSetupCommit(): Promise<"none" | "committed" | "declined"> {
  const changed: string[] = [];
  for (const file of setupFiles) {
    const status = await run(["git", "status", "--porcelain", "--", file]);
    if (status.stdout.trim()) changed.push(file);
  }
  if (changed.length === 0) return "none";
  const updateOnly = changed.length === 1 && changed[0] === "scripts/ship.ts";
  const trackedConfig = (await run(["git", "ls-files", "--error-unmatch", "shibumi-server.json"], { allowFailure: true })).exitCode === 0;
  const accepted = await confirm({ message: updateOnly ? "Commit ship client update now?" : "Commit deployment setup now?", initialValue: true });
  if (isCancel(accepted) || !accepted) return "declined";
  await run(["git", "add", "--", ...changed]);
  await run(["git", "commit", "--only", "-m", trackedConfig ? "Update Shibumi deployment" : "Add Shibumi deployment", "--", ...changed], { inherit: true });
  log.success(updateOnly ? "Committed ship client update" : "Committed Shibumi deployment setup");
  return "committed";
}

// Double literal hyphens before replacing dots so different domains cannot
// collapse to the same server app ID.
export function appIdForDomain(domain: string): string {
  return domain.replaceAll("-", "--").replaceAll(".", "-");
}

export function terminalHistory(entries: HistoryEntry[], commit: string): HistoryEntry | undefined {
  return entries.findLast((entry) => entry.commit === commit && ["succeeded", "failed"].includes(entry.state ?? ""));
}

export function canFollowDeployment(status: DeployStatus | undefined, commit: string): boolean {
  return status?.commit === commit && ["accepted", "running", "succeeded"].includes(status.state ?? "");
}

export function repositoryFromRemote(remote: string): string {
  const match = /github\.com[/:]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(remote);
  if (!match) throw new Error("origin must be a GitHub repository");
  return match[1];
}

// Infer safe defaults from owned project files. Interactive server setup still
// previews these values before changing Caddy, systemd, or server config.
export function domainFromProject(packageName: unknown, compose: string): string | undefined {
  if (typeof packageName === "string" && DOMAIN.test(packageName)) return packageName;
  const siteUrlDomain = /^\s*(?:-\s*)?SITE_URL(?:=|:\s*)["']?https:\/\/([^/:\s"']+)/m.exec(compose)?.[1]?.toLowerCase();
  return siteUrlDomain && DOMAIN.test(siteUrlDomain) ? siteUrlDomain : undefined;
}

function composeCandidates(files: string[]): string[] {
  return files.filter((file) => /(^|\/)(?:compose\.ya?ml|docker-compose\.ya?ml)$/.test(file));
}

export function composeFileFromTracked(files: string[]): string {
  const candidates = composeCandidates(files);
  for (const preferred of ["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"]) {
    if (candidates.includes(preferred)) return preferred;
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) throw new Error("no Compose file found");
  throw new Error(`multiple Compose files found:\n${candidates.map((file) => `  ${file}`).join("\n")}\n\nNext: keep one deployment Compose file or configure the intended path explicitly.`);
}

interface WorktreeCompose {
  branch: string;
  path: string;
  composeFile: string;
}

export function missingComposeMessage(branch: string, alternatives: WorktreeCompose[]): string {
  const heading = `no tracked Compose file found on current branch ${branch}.`;
  if (alternatives.length === 0) return `${heading}\n\nNext: add compose.yaml, or run ship from a branch containing deployment files.`;
  const rows = alternatives.map((item) => `  ${item.branch} → ${join(item.path, item.composeFile)}`).join("\n");
  const next = alternatives.length === 1
    ? `cd '${alternatives[0].path.replaceAll("'", "'\\''")}' and rerun installer.`
    : "choose one listed worktree, cd to it, and rerun installer.";
  return `${heading}\n\nCompose found in another local worktree:\n${rows}\n\nNext: ${next}`;
}

async function otherWorktreeCompose(): Promise<WorktreeCompose[]> {
  const listed = await run(["git", "worktree", "list", "--porcelain", "-z"], { allowFailure: true });
  if (listed.exitCode !== 0) return [];
  const alternatives: WorktreeCompose[] = [];
  for (const record of listed.stdout.split("\0\0")) {
    const fields = record.split("\0");
    const path = fields.find((field) => field.startsWith("worktree "))?.slice(9);
    const branch = fields.find((field) => field.startsWith("branch refs/heads/"))?.slice(18);
    if (!path || !branch || resolve(path) === resolve(root)) continue;
    const tracked = await run(["git", "-C", path, "ls-files"], { allowFailure: true });
    if (tracked.exitCode !== 0) continue;
    for (const composeFile of composeCandidates(tracked.stdout.split("\n").filter(Boolean))) {
      alternatives.push({ branch, path, composeFile });
    }
  }
  return alternatives;
}

async function inferredProject() {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { name?: unknown; scripts?: Record<string, unknown> };
  const repository = repositoryFromRemote(await git("remote", "get-url", "origin"));
  const branch = await git("branch", "--show-current");
  if (!branch) throw new Error("ship requires a named Git branch");
  const tracked = (await git("ls-files")).split("\n").filter(Boolean);
  if (composeCandidates(tracked).length === 0) throw new Error(missingComposeMessage(branch, await otherWorktreeCompose()));
  const composeFile = composeFileFromTracked(tracked);
  const compose = await readFile(join(root, composeFile), "utf8");
  const domain = domainFromProject(packageJson.name, compose);
  const service = /^services:\s*\n\s{2}([A-Za-z0-9_.-]+):/m.exec(compose)?.[1] ?? "web";
  const healthPath = /https?:\/\/(?:127\.0\.0\.1|localhost):\d+(\/[^\s"'\\]*)/.exec(compose)?.[1] ?? "/healthz";
  return { packageJson, repository, branch, domain, composeFile, service, healthPath };
}

// Treat downloaded and committed JSON as untrusted input. Derived fields must
// agree with the domain before any value reaches GitHub, Git, or SSH.
export function validateConfig(value: unknown): ClientConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("shibumi-server.json must be an object");
  const config = value as Partial<ClientConfig>;
  if (config.version !== 1 || config.provider !== "shibumi-server" || typeof config.domain !== "string" || !DOMAIN.test(config.domain)
    || typeof config.appId !== "string" || config.appId !== appIdForDomain(config.domain)
    || typeof config.repository !== "string" || !/^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository)
    || typeof config.branch !== "string" || !/^[A-Za-z0-9._/-]+$/.test(config.branch)
    || typeof config.webhookUrl !== "string" || config.webhookUrl !== `https://${config.domain}/hooks/github/${config.appId}`
    || typeof config.service !== "string" || typeof config.healthPath !== "string" || typeof config.cutoverRequired !== "boolean"
    || !config.server || typeof config.server.hostname !== "string") {
    throw new Error("shibumi-server.json is invalid");
  }
  return config as ClientConfig;
}

async function readConfig(): Promise<ClientConfig | undefined> {
  try {
    return validateConfig(JSON.parse(await readFile(configPath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

// SSH target is machine-specific, so keep it in local .git/config instead of
// committed shibumi-server.json.
async function localSshTarget(): Promise<string | undefined> {
  const result = await run(["git", "config", "--local", "--get", "shibumi.server"], { allowFailure: true });
  return result.exitCode === 0 && result.stdout.trim() ? result.stdout.trim() : undefined;
}

async function suggestedSshTarget(): Promise<string | undefined> {
  try {
    const env = await readFile(join(root, ".env"), "utf8");
    const host = /^DEPLOY_HOST=(.+)$/m.exec(env)?.[1]?.trim();
    const user = /^DEPLOY_USER=(.+)$/m.exec(env)?.[1]?.trim();
    if (host && user && SSH_TARGET.test(`${user}@${host}`)) return `${user}@${host}`;
  } catch {}
  return undefined;
}

async function requestSshTarget(configHostname?: string): Promise<string | undefined> {
  const suggestion = await suggestedSshTarget() ?? configHostname;
  explain(
    "Local configuration",
    "Use the same user@server target or SSH alias you use in your terminal.\nIt will be saved in .git/config on this computer and will not be committed.\nResolved server hostname, app domain, and deploy settings go in committed shibumi-server.json.",
  );
  const answer = await text({
    message: "SSH target (user@server or alias)",
    placeholder: suggestion ?? "user@example-vps.com",
    validate: (value) => SSH_TARGET.test(value || suggestion || "") ? undefined : "Use an SSH host or user@host without spaces",
  });
  if (isCancel(answer)) return undefined;
  const target = answer || suggestion;
  if (!target) return undefined;
  const accepted = await confirm({
    message: `Save ${target} locally and connect?`,
    initialValue: true,
  });
  if (isCancel(accepted) || !accepted) return undefined;
  await run(["git", "config", "--local", "shibumi.server", target]);
  log.success("SSH target saved to local Git config. It will not be committed.");
  return target;
}

async function resolvedSshHostname(target: string): Promise<string> {
  if (!SSH_TARGET.test(target)) throw new Error("local SSH target is unsafe");
  const result = await run(["ssh", "-G", "--", target]);
  const hostname = /^hostname\s+(.+)$/m.exec(result.stdout)?.[1]?.trim();
  if (!hostname || !/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(hostname)) {
    throw new Error("cannot resolve SSH server hostname");
  }
  return hostname.toLowerCase();
}

// Pass remote arguments separately and reject control characters. Interactive
// setup gets a TTY so SSH and sudo prompts remain attached to this terminal.
async function sshControlPath(): Promise<string> {
  if (!sshControlDirectory) {
    sshControlDirectory = await mkdtemp("/tmp/shibumi-ssh-");
    await chmod(sshControlDirectory, 0o700);
  }
  return join(sshControlDirectory, "control");
}

async function closeSshControl(): Promise<void> {
  if (!sshControlDirectory) return;
  if (sshControlTarget) {
    await run(["ssh", "-S", join(sshControlDirectory, "control"), "-O", "exit", "--", sshControlTarget], { allowFailure: true });
  }
  await rm(sshControlDirectory, { recursive: true, force: true });
  sshControlDirectory = undefined;
  sshControlTarget = undefined;
}

async function ssh(target: string, remoteArgs: string[], options: { tty?: boolean; allowFailure?: boolean } = {}): Promise<Result> {
  if (!SSH_TARGET.test(target)) throw new Error("local SSH target is unsafe");
  if (sshControlTarget && sshControlTarget !== target) throw new Error("ship supports one SSH target per run");
  sshControlTarget = target;
  for (const arg of remoteArgs) if (/[\0\r\n]/.test(arg)) throw new Error("remote argument is unsafe");
  return run([
    "ssh", "-o", "StrictHostKeyChecking=yes", "-o", "ControlMaster=auto", "-o", "ControlPersist=60", "-S", await sshControlPath(),
    ...(options.tty ? ["-t"] : []), "--", target, ...remoteArgs,
  ], { inherit: options.tty, allowFailure: options.allowFailure });
}

function versionAtLeast(current: string, minimum: string): boolean {
  const left = /^\d+\.\d+\.\d+$/.test(current) ? current.split(".").map(Number) : [];
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < right.length; index += 1) {
    if ((left[index] ?? -1) !== right[index]) return (left[index] ?? -1) > right[index];
  }
  return left.length === right.length;
}

// Install only through the reviewed, version-pinned website endpoint.
async function ensureServer(target: string): Promise<void> {
  const version = await ssh(target, [SERVER_CLI, "--version"], { allowFailure: true });
  if (version.exitCode === 0 && versionAtLeast(version.stdout.trim(), "0.1.26")) return;
  explain(
    version.exitCode === 0 ? `shibumi-server ${version.stdout.trim()} needs an upgrade` : "shibumi-server is not installed",
    "This runs the reviewed installer on the SSH server. SSH and sudo prompts stay attached directly to your terminal.",
  );
  const accepted = await confirm({ message: "Install or upgrade shibumi-server now?", initialValue: true });
  if (isCancel(accepted) || !accepted) throw new Error("server setup cancelled");
  const result = await ssh(target, ["curl -fsSL https://shibumistack.dev/install/server | bash"], { tty: true, allowFailure: true });
  if (result.exitCode !== 0) throw new Error("remote shibumi-server installation failed");
}

// Reuse an existing registration silently. New apps retain interactive SSH so
// server and sudo prompts stay attached to the local terminal.
async function remoteSetup(target: string, _force: boolean): Promise<ClientConfig> {
  const project = await inferredProject();
  let domain = project.domain;
  if (!domain) {
    const answer = await text({
      message: "App domain",
      placeholder: "example.com",
      validate: (value) => DOMAIN.test(value) ? undefined : "Use a lowercase public hostname",
    });
    if (isCancel(answer)) throw new Error("setup cancelled");
    domain = answer;
  }
  await ensureServer(target);
  const appId = appIdForDomain(domain);
  const serverHostname = await resolvedSshHostname(target);
  let downloaded = await ssh(target, [
    "env", "SHIBUMI_SKIP_UPDATE_CHECK=1", SERVER_CLI, "client-config", appId, "--server-hostname", serverHostname,
  ], { allowFailure: true });

  if (downloaded.exitCode !== 0) {
    explain(
      "Server setup required",
      `SSH target  ${target}\nDomain      ${domain}\nRepository  github:${project.repository}\n\nSSH and sudo prompts stay attached to this terminal.`,
    );
    const accepted = await confirm({ message: "Continue through SSH?", initialValue: true });
    if (isCancel(accepted) || !accepted) throw new Error("server setup cancelled");
    const setup = await ssh(target, [
      "env", "SHIBUMI_SHIP_SETUP=1", SERVER_CLI, "add", domain,
      "--repository", `github:${project.repository}`,
      "--ref", `refs/heads/${project.branch}`,
      "--compose-file", project.composeFile,
      "--service", project.service,
      "--health-path", project.healthPath,
    ], { tty: true, allowFailure: true });
    if (setup.exitCode !== 0) throw new Error("remote app setup failed");
    downloaded = await ssh(target, [
      "env", "SHIBUMI_SKIP_UPDATE_CHECK=1", SERVER_CLI, "client-config", appId, "--server-hostname", serverHostname,
    ], { allowFailure: true });
  }
  if (downloaded.exitCode !== 0) throw new Error("server setup paused before app registration. Complete the printed DNS instructions, then run bun run ship again");
  const config = validateConfig(JSON.parse(downloaded.stdout));
  if (config.repository !== `github:${project.repository}`) throw new Error(`registered domain belongs to ${config.repository}\n\nNext: use the matching project or remove the conflicting server registration.`);
  if (config.branch !== project.branch) throw new Error(`registered domain deploys ${config.branch}, but current branch is ${project.branch}.\n\nNext: check out ${config.branch}, or register another domain for ${project.branch}.`);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  log.success(`Found ${domain} on ${serverHostname}`);
  log.success("Wrote shibumi-server.json");
  return config;
}

interface GitHubWebhook { id: number; needsRepair: boolean }

export function matchingWebhook(value: unknown, webhookUrl: string): GitHubWebhook | undefined {
  if (!Array.isArray(value)) return undefined;
  const hook = value.find((item) => item && typeof item === "object"
    && (item as { active?: unknown }).active === true
    && (item as { config?: { url?: unknown } }).config?.url === webhookUrl) as { id?: unknown; last_response?: { code?: unknown } } | undefined;
  if (!hook || typeof hook.id !== "number") return undefined;
  const code = hook.last_response?.code;
  return { id: hook.id, needsRepair: typeof code === "number" && code !== 0 && (code < 200 || code >= 300) };
}

async function ensureGitHubAuth(): Promise<void> {
  const status = await run(["gh", "auth", "status", "-h", "github.com"], { allowFailure: true });
  if (status.exitCode === 0) return;
  explain("GitHub sign-in required", "GitHub CLI stores your credentials. Shibumi never reads them.");
  const accepted = await confirm({ message: "Sign in to GitHub now?", initialValue: true });
  if (isCancel(accepted) || !accepted) throw new Error("Next: run gh auth login -h github.com -p https -w, then rerun bun run ship.");
  const login = await run(["gh", "auth", "login", "-h", "github.com", "-p", "https", "-w"], { inherit: true, allowFailure: true });
  if (login.exitCode !== 0 || (await run(["gh", "auth", "status", "-h", "github.com"], { allowFailure: true })).exitCode !== 0) {
    throw new Error("GitHub sign-in did not complete.\n\nNext: run gh auth login -h github.com -p https -w, then rerun bun run ship.");
  }
}

async function authorizeWebhookAccess(): Promise<void> {
  explain("GitHub webhook access required", "GitHub CLI needs admin:repo_hook to create or repair this repository webhook.");
  const accepted = await confirm({ message: "Authorize webhook access now?", initialValue: true });
  if (isCancel(accepted) || !accepted) throw new Error("Next: run gh auth refresh -h github.com -s admin:repo_hook, then rerun bun run ship.");
  const refresh = await run(["gh", "auth", "refresh", "-h", "github.com", "-s", "admin:repo_hook"], { inherit: true, allowFailure: true });
  if (refresh.exitCode !== 0) throw new Error("GitHub webhook authorization did not complete.\n\nNext: run gh auth refresh -h github.com -s admin:repo_hook, then rerun bun run ship.");
}

async function findWebhook(config: ClientConfig): Promise<GitHubWebhook | undefined> {
  const repository = config.repository.slice("github:".length);
  await ensureGitHubAuth();
  let hooks = await run(["gh", "api", `repos/${repository}/hooks?per_page=100`], { allowFailure: true });
  if (hooks.exitCode !== 0) {
    await authorizeWebhookAccess();
    hooks = await run(["gh", "api", `repos/${repository}/hooks?per_page=100`], { allowFailure: true });
  }
  if (hooks.exitCode !== 0) throw new Error(`${hooks.stderr.trim() || "GitHub CLI could not read repository webhooks"}\n\nNext: confirm repository admin access, then rerun bun run ship.`);
  return matchingWebhook(JSON.parse(hooks.stdout), config.webhookUrl);
}

// Fetch the secret only when GitHub needs it. It moves through process memory
// from server output to `gh` input and is never printed or written locally.
async function ensureWebhook(config: ClientConfig, target: string): Promise<void> {
  const existing = await findWebhook(config);
  if (existing && !existing.needsRepair) {
    log.success("GitHub webhook is active");
    return;
  }
  const repository = config.repository.slice("github:".length);
  explain(
    existing ? "GitHub webhook needs repair" : "GitHub webhook is missing",
    `Repository  ${repository}\nPayload URL ${config.webhookUrl}\nEvents      push\n\nThe secret travels from server to GitHub CLI through memory only.`,
  );
  const accepted = await confirm({ message: existing ? "Refresh webhook secret?" : "Create webhook with GitHub CLI?", initialValue: true });
  if (isCancel(accepted) || !accepted) throw new Error(`Next: review ${config.webhookUrl} at https://github.com/${repository}/settings/hooks`);
  const secretResult = await ssh(target, ["env", "SHIBUMI_SKIP_UPDATE_CHECK=1", SERVER_CLI, "webhook-secret", config.appId]);
  const secretValue: unknown = JSON.parse(secretResult.stdout);
  const secret = secretValue && typeof secretValue === "object" ? (secretValue as { secret?: unknown }).secret : undefined;
  if (typeof secret !== "string" || !/^[a-f0-9]{64}$/.test(secret)) throw new Error("server returned an invalid webhook secret");
  const args = existing
    ? ["gh", "api", "-X", "PATCH", `repos/${repository}/hooks/${existing.id}/config`, "--input", "-"]
    : ["gh", "api", "-X", "POST", `repos/${repository}/hooks`, "--input", "-"];
  const input = existing
    ? JSON.stringify({ secret })
    : JSON.stringify({ name: "web", active: true, events: ["push"], config: { url: config.webhookUrl, content_type: "json", insecure_ssl: "0", secret } });
  let result = await run(args, { input, allowFailure: true });
  if (result.exitCode !== 0) {
    await authorizeWebhookAccess();
    result = await run(args, { input, allowFailure: true });
  }
  if (result.exitCode !== 0) throw new Error(`${result.stderr.trim() || "GitHub CLI could not configure webhook"}\n\nNext: confirm repository admin access, then rerun bun run ship.`);
  const hookId = existing?.id ?? (JSON.parse(result.stdout) as { id?: unknown }).id;
  if (typeof hookId !== "number") throw new Error("GitHub returned an invalid webhook");
  const ping = await run(["gh", "api", "-X", "POST", `repos/${repository}/hooks/${hookId}/pings`], { allowFailure: true });
  if (ping.exitCode !== 0) throw new Error(`${ping.stderr.trim() || "GitHub CLI could not test webhook"}\n\nNext: review https://github.com/${repository}/settings/hooks.`);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await Bun.sleep(1_000);
    const checked = await run(["gh", "api", `repos/${repository}/hooks/${hookId}`], { allowFailure: true });
    if (checked.exitCode === 0 && (JSON.parse(checked.stdout) as { last_response?: { code?: unknown } }).last_response?.code === 200) {
      log.success(existing ? "GitHub webhook repaired and tested" : "GitHub webhook created and tested");
      return;
    }
  }
  throw new Error(`GitHub webhook test did not return 200.\n\nNext: review https://github.com/${repository}/settings/hooks.`);
}

async function setup(force: boolean): Promise<{ config: ClientConfig; target: string; changed: boolean }> {
  let config = await readConfig();
  if (force || !config) await inferredProject();
  let target = await localSshTarget();
  if (!target) target = await requestSshTarget(config?.server.hostname);
  if (!target) throw new Error("SSH server is required");
  const previous = config;
  if (force || !config) config = await remoteSetup(target, force);
  if (!config) throw new Error("deployment setup did not return client configuration");
  await ensureWebhook(config, target);
  return { config, target, changed: !previous || JSON.stringify(previous) !== JSON.stringify(config) };
}

// Refuse ambiguous deploys: wrong origin, wrong branch, dirty work, or remote
// work not present locally. Run project-owned checks before every deployment.
async function preflight(config: ClientConfig): Promise<number> {
  const project = await inferredProject();
  if (`github:${project.repository}` !== config.repository) throw new Error(`origin does not match ${config.repository}`);
  if (project.branch !== config.branch) throw new Error(`current branch must be ${config.branch}`);
  const status = await git("status", "--short");
  if (status) throw new Error(`Ship paused: working tree has uncommitted changes.\n\n${status}\n\nNext: commit or stash these changes, then run bun run ship.`);

  const progress = spinner();
  progress.start(`Fetching origin/${config.branch}`);
  await run(["git", "fetch", "origin", config.branch]);
  const counts = (await git("rev-list", "--left-right", "--count", `HEAD...origin/${config.branch}`)).split(/\s+/).map(Number);
  if (counts[1] > 0) {
    progress.stop("Branch is behind or diverged", 1);
    throw new Error(`pull origin/${config.branch} before shipping`);
  }
  progress.stop(counts[0] > 0
    ? `${counts[0]} commit${counts[0] === 1 ? "" : "s"} ready to push`
    : "Current commit already pushed and ready to deploy");

  const scripts = project.packageJson.scripts ?? {};
  for (const name of ["test", "check"]) {
    if (typeof scripts[name] !== "string") continue;
    const check = spinner();
    check.start(`Running bun run ${name}`);
    const result = await run(["bun", "run", name], { allowFailure: true });
    if (result.exitCode !== 0) {
      check.stop(`${name} failed`, 1);
      process.stderr.write(result.stderr || result.stdout);
      throw new Error(`bun run ${name} failed`);
    }
    check.stop(`${name} passed`);
  }
  return counts[0];
}

// Follow status for the exact pushed commit. This prevents an older or parallel
// deployment from being reported as success for current ship.
async function followStatus(config: ClientConfig, target: string, commit: string): Promise<void> {
  const progress = spinner();
  const fit = (value: string) => {
    const width = Math.max(24, (process.stdout.columns ?? 80) - 8);
    return value.length > width ? `${value.slice(0, width - 1)}…` : value;
  };
  progress.start("Waiting for webhook");
  const startedAt = Date.now();
  const deadline = startedAt + 12 * 60_000;
  const webhookDeadline = startedAt + 45_000;
  let lastStage = "";
  let lastOutput = "";
  let sawQueued = false;
  while (Date.now() < deadline) {
    const result = await ssh(target, [
      "env", "SHIBUMI_SKIP_UPDATE_CHECK=1", SERVER_CLI, "status", config.appId, "--commit", commit, "--json",
    ], { allowFailure: true });
    if (result.exitCode === 0 && result.stdout.trim() && result.stdout.trim() !== "null") {
      const status = JSON.parse(result.stdout) as DeployStatus;
      const queued = status.commit !== commit && status.queuedCommit === commit;
      sawQueued ||= queued;
      const displayStage = queued ? `Queued ${commit.slice(0, 7)} next. Current ${status.commit!.slice(0, 7)} ${status.stage}` : status.stage;
      if (status.stage && (`${status.commit}:${status.stage}` !== lastStage || (status.output ?? "") !== lastOutput)) {
        lastStage = `${status.commit}:${status.stage}`;
        lastOutput = status.output ?? "";
        progress.message(status.stage === "shipped" && !queued
          ? "Deployment complete"
          : status.output ? fit(`${displayStage}: ${status.output}`) : fit(`${displayStage}…`));
      }
      if (!queued && status.state === "succeeded") {
        progress.stop(config.cutoverRequired
          ? `New upstream healthy at 127.0.0.1 (Caddy cutover pending)`
          : `Shipped ${status.url ?? `https://${config.domain}`}`);
        return;
      }
      if (!queued && status.state === "failed") {
        progress.stop(`Deployment failed during ${status.stage ?? "unknown"}`, 1);
        throw new Error([status.message ?? "deployment failed", status.output].filter(Boolean).join("\n"));
      }
    } else if (lastStage) {
      const history = await ssh(target, [
        "env", "SHIBUMI_SKIP_UPDATE_CHECK=1", SERVER_CLI, "history", config.appId, "--json",
      ], { allowFailure: true });
      if (history.exitCode === 0 && history.stdout.trim()) {
        const terminal = terminalHistory(JSON.parse(history.stdout) as HistoryEntry[], commit);
        if (terminal?.state === "succeeded") {
          progress.stop(config.cutoverRequired
            ? `New upstream healthy at 127.0.0.1 (Caddy cutover pending)`
            : `Shipped https://${config.domain}`);
          return;
        }
        if (terminal?.state === "failed") {
          progress.stop(`Deployment failed during ${terminal.stage ?? "unknown"}`, 1);
          throw new Error(`deployment failed during ${terminal.stage ?? "unknown"}.\n\nNext: run ssh ${target} shibumi-server history ${config.appId}.`);
        }
      }
    }
    if (sawQueued) {
      const current = await ssh(target, [
        "env", "SHIBUMI_SKIP_UPDATE_CHECK=1", SERVER_CLI, "status", config.appId, "--json",
      ], { allowFailure: true });
      if (current.exitCode === 0 && current.stdout.trim() && current.stdout.trim() !== "null") {
        const status = JSON.parse(current.stdout) as DeployStatus;
        if (status.queuedCommit && status.queuedCommit !== commit) {
          progress.stop(`Queued commit replaced by ${status.queuedCommit.slice(0, 7)}`, 1);
          throw new Error(`deployment ${commit.slice(0, 7)} was superseded by newer commit ${status.queuedCommit.slice(0, 7)}.\n\nNext: pull latest changes before shipping again.`);
        }
      }
    }
    if (!lastStage && Date.now() >= webhookDeadline) {
      progress.stop("Webhook did not start deployment", 1);
      throw new Error(`GitHub webhook did not reach shibumi-server.\n\nNext: check https://github.com/${config.repository.slice("github:".length)}/settings/hooks, then rerun bun run ship after repairing delivery.`);
    }
    await Bun.sleep(2_000);
  }
  progress.stop("Deployment status timed out", 1);
  throw new Error(`deployment may still be running. Check: ssh ${target} shibumi-server status ${config.appId}`);
}

// Existing domains keep serving their previous upstream until new app is
// healthy and user explicitly approves Caddy cutover.
async function completeCutover(config: ClientConfig, target: string): Promise<boolean> {
  if (!config.cutoverRequired) return false;
  explain(
    "Existing-domain cutover",
    `The new app is healthy, but ${config.domain} still serves its previous upstream.\nCaddy cutover validates and reloads configuration without stopping active connections.`,
  );
  const accepted = await confirm({ message: "Switch public traffic to the new upstream through SSH?", initialValue: true });
  if (isCancel(accepted) || !accepted) {
    log.warn("Cutover skipped. Previous upstream remains public.");
    return false;
  }
  const result = await ssh(target, [SERVER_CLI, "caddy-cutover", config.appId], { tty: true, allowFailure: true });
  if (result.exitCode !== 0) throw new Error("Caddy cutover failed; previous upstream remains active");
  const hostname = await resolvedSshHostname(target);
  const downloaded = await ssh(target, [
    "env", "SHIBUMI_SKIP_UPDATE_CHECK=1", SERVER_CLI, "client-config", config.appId, "--server-hostname", hostname,
  ]);
  const next = validateConfig(JSON.parse(downloaded.stdout));
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
  Object.assign(config, next);
  log.success(`Caddy now serves ${config.domain} from the Shibumi upstream`);
  return true;
}

// Setup exits after configuration changes so user can review and commit them.
// Normal ship reaches push only when configuration is already stable.
export async function runShip(): Promise<void> {
  intro("渋み  ship");
  try {
    const forceSetup = process.argv.slice(2).includes("--setup");
    const result = await setup(forceSetup);
    const setupCommit = await offerSetupCommit();
    if (forceSetup || result.changed || setupCommit === "declined") {
      outro(setupCommit === "declined"
        ? `${accent("Next:")} review and commit Shibumi setup files, then run bun run ship.`
        : `${accent("Next:")} bun run ship`);
      return;
    }
    const ahead = await preflight(result.config);
    const accepted = await confirm({
      message: ahead > 0
        ? `Push ${result.config.branch} and deploy ${result.config.domain}?`
        : `Redeploy current ${result.config.branch} commit to ${result.config.domain}?`,
      initialValue: true,
    });
    if (isCancel(accepted) || !accepted) {
      cancel("Ship cancelled");
      return;
    }
    const commit = await git("rev-parse", "HEAD");
    if (!COMMIT.test(commit)) throw new Error("cannot determine shipped commit");
    if (ahead > 0) await run(["git", "push", "origin", result.config.branch], { inherit: true });
    else {
      const redeploy = await ssh(result.target, [
        "env", "SHIBUMI_SKIP_UPDATE_CHECK=1", SERVER_CLI, "redeploy", result.config.appId, commit,
      ], { allowFailure: true });
      if (redeploy.exitCode !== 0) {
        const current = await ssh(result.target, [
          "env", "SHIBUMI_SKIP_UPDATE_CHECK=1", SERVER_CLI, "status", result.config.appId, "--commit", commit, "--json",
        ], { allowFailure: true });
        const status = current.exitCode === 0 && current.stdout.trim() && current.stdout.trim() !== "null"
          ? JSON.parse(current.stdout) as DeployStatus
          : undefined;
        if (!canFollowDeployment(status, commit)) throw new Error(redeploy.stderr.trim() || "redeploy request failed");
        log.info("Deployment already running for this commit. Following its progress.");
      }
    }
    await followStatus(result.config, result.target, commit);
    const changed = await completeCutover(result.config, result.target);
    outro(changed
      ? `Shipped https://${result.config.domain}. Commit updated shibumi-server.json.`
      : `https://${result.config.domain}`);
  } finally {
    await closeSshControl();
  }
}

async function updateShipClient(): Promise<void> {
  intro("渋み  ship update");
  const response = await fetch(LATEST_SOURCE, { headers: { accept: "text/plain" } });
  if (!response.ok) throw new Error(`ship client returned HTTP ${response.status}`);
  const source = await response.text();
  if (!source.startsWith("#!/usr/bin/env bun") || !source.includes("export function runShipCli")) {
    throw new Error("downloaded ship client is invalid");
  }
  const current = await readFile(import.meta.path, "utf8");
  if (source === current) {
    outro("Ship client is current");
    return;
  }
  const reviewed = await fetch(CURRENT_SOURCE, { headers: { accept: "text/plain" } });
  if (!reviewed.ok || await reviewed.text() !== current) {
    throw new Error(`scripts/ship.ts contains owned changes.\n\nNext: review and merge ${LATEST_SOURCE} manually.`);
  }
  const temporary = `${import.meta.path}.tmp-${process.pid}`;
  await writeFile(temporary, source, { mode: 0o644 });
  await chmod(temporary, 0o644);
  await rename(temporary, import.meta.path);
  outro("Ship client updated. Review and commit scripts/ship.ts.");
}

export function runShipCli(): void {
  const action = process.argv.slice(2).includes("--update") ? updateShipClient() : runShip();
  action.catch((error) => {
    cancel(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

if (import.meta.main) runShipCli();
