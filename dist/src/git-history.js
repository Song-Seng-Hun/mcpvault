import { guidanceError, guidanceText } from './guidance-runtime.js';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { PathFilter } from './pathfilter.js';
const STATUS_CACHE_TTL_MS = 300;
export class GitHistoryService {
    pathFilter;
    vaultPath;
    statusCache;
    statusPromise;
    mutationTail = Promise.resolve();
    constructor(vaultPath, pathFilter = new PathFilter()) {
        this.pathFilter = pathFilter;
        this.vaultPath = resolve(vaultPath);
    }
    runGit(args, options = {}) {
        return new Promise((resolvePromise, reject) => {
            execFile('git', ['-c', 'core.fsmonitor=false', '--no-pager', ...args], {
                cwd: this.vaultPath,
                encoding: 'utf8',
                maxBuffer: 10 * 1024 * 1024,
                windowsHide: true,
                env: {
                    ...process.env,
                    GIT_PAGER: 'cat',
                    PAGER: 'cat',
                    GIT_TERMINAL_PROMPT: '0',
                    ...options.env,
                },
            }, (error, stdout, stderr) => {
                const exitCode = error && typeof error.code === 'number'
                    ? error.code
                    : error ? 1 : 0;
                const result = { stdout: stdout || '', stderr: stderr || '', exitCode };
                if (error && !options.allowFailure) {
                    const detail = (stderr || stdout || error.message).trim();
                    reject(guidanceError(new Error(`Git command failed: ${detail || 'unknown error'}`), 'guid-3cbd9ee28b322122'));
                    return;
                }
                resolvePromise(result);
            });
        });
    }
    pathsEqual(a, b) {
        return process.platform === 'win32'
            ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
            : resolve(a) === resolve(b);
    }
    async repoRoot() {
        const result = await this.runGit(['rev-parse', '--show-toplevel'], { allowFailure: true });
        if (result.exitCode !== 0)
            return null;
        const root = resolve(result.stdout.trim());
        if (!this.pathsEqual(root, this.vaultPath)) {
            throw guidanceError(new Error(`Revision history requires the vault itself to be the Git repository root. Detected repository root: ${root}`), 'guid-5b8365442c58d666');
        }
        return root;
    }
    async requireRepo() {
        const root = await this.repoRoot();
        if (!root) {
            throw guidanceError(new Error('Revision history is not initialized for this vault. Call initialize_revision_history first.'), 'guid-f13966a6be65f35f');
        }
        return root;
    }
    clearStatusCache() {
        this.statusCache = undefined;
    }
    async withMutation(task) {
        const previous = this.mutationTail;
        let release;
        this.mutationTail = new Promise(resolvePromise => { release = resolvePromise; });
        await previous;
        try {
            return await task();
        }
        finally {
            release();
        }
    }
    normalizeVaultPath(input, noteOnly = false) {
        if (typeof input !== 'string' || !input.trim()) {
            throw guidanceError(new Error('path is required and must be a non-empty string'), 'guid-238151b3f6039f41');
        }
        const normalizedInput = input.trim().replace(/\\/g, '/').replace(/^\/+/, '');
        const fullPath = resolve(this.vaultPath, normalizedInput);
        const relativePath = relative(this.vaultPath, fullPath).replace(/\\/g, '/');
        if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
            throw guidanceError(new Error(`Path traversal not allowed: ${input}. Paths must be within the vault directory.`), 'guid-6eda287a313aac90');
        }
        const allowed = noteOnly
            ? this.pathFilter.isAllowed(relativePath)
            : this.pathFilter.isAllowedForListing(relativePath);
        if (!allowed) {
            throw guidanceError(new Error(`Access denied: ${relativePath}. This path is restricted.`), 'guid-ae36e2a093b6711a');
        }
        return relativePath;
    }
    parseStatus(output) {
        const tokens = output.split('\0');
        const changes = [];
        for (let index = 0; index < tokens.length; index++) {
            const token = tokens[index];
            if (!token || token.length < 4)
                continue;
            const status = token.slice(0, 2);
            const path = token.slice(3);
            const isRenameOrCopy = status.includes('R') || status.includes('C');
            const previousPath = isRenameOrCopy ? tokens[++index] : undefined;
            try {
                const safePath = this.normalizeVaultPath(path);
                if (previousPath) {
                    const safePreviousPath = this.normalizeVaultPath(previousPath);
                    changes.push({ status, path: safePath, previousPath: safePreviousPath });
                }
                else {
                    changes.push({ status, path: safePath });
                }
            }
            catch {
                // Restricted paths are intentionally invisible to revision tools.
            }
        }
        return changes;
    }
    async pendingChanges() {
        const result = await this.runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
        return this.parseStatus(result.stdout);
    }
    literalPathspec(path) {
        return `:(literal)${path}`;
    }
    async rejectExecutableFilters() {
        // Use the merged Git config, not only .git/config. Global and system
        // filters are equally capable of executing during `git add`.
        const result = await this.runGit(['config', '--get-regexp', '^filter\..*\.(clean|process|smudge)$'], { allowFailure: true });
        if (result.exitCode !== 0 && !result.stdout.trim())
            return;
        const unsafe = result.stdout
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
            const separator = line.search(/\s/);
            return separator === -1
                ? { key: line, command: '' }
                : { key: line.slice(0, separator), command: line.slice(separator).trim() };
        })
            .find(({ key, command }) => {
            const normalizedKey = key.toLowerCase();
            const standardLfs = (normalizedKey === 'filter.lfs.clean' && /^git-lfs clean(?:\s|$)/.test(command)) ||
                (normalizedKey === 'filter.lfs.process' && /^git-lfs filter-process(?:\s|$)/.test(command)) ||
                (normalizedKey === 'filter.lfs.smudge' && /^git-lfs smudge(?:\s|$)/.test(command));
            return !standardLfs;
        });
        if (unsafe) {
            throw guidanceError(new Error(`Refusing to commit because Git config contains executable filter '${unsafe.key}'. Remove or review it before using MCP revision commits.`), 'guid-94938dc750a00a65');
        }
    }
    validateRevision(input) {
        if (typeof input !== 'string' || !input.trim()) {
            throw guidanceError(new Error('revision is required'), 'guid-14de03fdca3ef66a');
        }
        const revision = input.trim();
        if (revision.startsWith('-') || !/^[A-Za-z0-9._/@{}~^:+-]+$/.test(revision)) {
            throw guidanceError(new Error(`Invalid revision: ${input}`), 'guid-3c3bda55a6ad3814');
        }
        return revision;
    }
    async resolveRevision(input) {
        await this.requireRepo();
        const revision = this.validateRevision(input);
        const result = await this.runGit(['rev-parse', '--verify', `${revision}^{commit}`], { allowFailure: true });
        if (result.exitCode !== 0 || !result.stdout.trim()) {
            throw guidanceError(new Error(`Unknown revision: ${input}`), 'guid-e40381f23e578136');
        }
        return result.stdout.trim();
    }
    async initialize() {
        return this.withMutation(() => this.initializeInternal());
    }
    async initializeInternal() {
        const existingRoot = await this.repoRoot();
        if (existingRoot) {
            return { success: true, initialized: false, message: guidanceText('guid-be0e9027010d9b39', 'Revision history is already initialized.') };
        }
        const emptyTemplate = await mkdtemp(join(tmpdir(), 'mcpvault-git-template-'));
        try {
            await this.runGit(['init', `--template=${emptyTemplate}`]);
        }
        finally {
            await rm(emptyTemplate, { recursive: true, force: true });
        }
        await this.requireRepo();
        this.clearStatusCache();
        return { success: true, initialized: true, message: guidanceText('guid-b14e03896cc19f07', 'Initialized Git revision history for the vault. Use commit_changes to create the first revision.') };
    }
    async status() {
        const cached = this.statusCache;
        if (cached && cached.expiresAt > Date.now())
            return cloneRevisionStatus(cached.value);
        if (this.statusPromise)
            return cloneRevisionStatus(await this.statusPromise);
        const computation = this.readStatus();
        this.statusPromise = computation;
        try {
            const value = await computation;
            this.statusCache = { expiresAt: Date.now() + STATUS_CACHE_TTL_MS, value };
            return cloneRevisionStatus(value);
        }
        finally {
            if (this.statusPromise === computation)
                this.statusPromise = undefined;
        }
    }
    async readStatus() {
        const root = await this.repoRoot();
        if (!root) {
            return {
                enabled: false,
                pending: [],
                message: guidanceText('guid-186ec656b25b5afb', 'Revision history is not initialized. Call initialize_revision_history to enable it.'),
            };
        }
        const [branchResult, headResult, pending] = await Promise.all([
            this.runGit(['symbolic-ref', '--short', '-q', 'HEAD'], { allowFailure: true }),
            this.runGit(['rev-parse', '--verify', 'HEAD'], { allowFailure: true }),
            this.pendingChanges(),
        ]);
        return {
            enabled: true,
            repoRoot: root,
            ...(branchResult.stdout.trim() && { branch: branchResult.stdout.trim() }),
            ...(headResult.exitCode === 0 && headResult.stdout.trim() && { head: headResult.stdout.trim() }),
            pending,
        };
    }
    async commitChanges(params) {
        return this.withMutation(() => this.commitChangesInternal(params));
    }
    async commitChangesInternal(params) {
        await this.requireRepo();
        this.clearStatusCache();
        const reason = params.reason?.trim();
        if (!reason)
            throw guidanceError(new Error('reason is required and must describe why the vault changed'), 'guid-61a332fa4e8949fd');
        let authorName = params.authorName?.trim();
        let authorEmail = params.authorEmail?.trim();
        if ((authorName && !authorEmail) || (!authorName && authorEmail)) {
            throw guidanceError(new Error('authorName and authorEmail must be provided together'), 'guid-92cab18f4370b60e');
        }
        if (!authorName && !authorEmail) {
            const [nameResult, emailResult] = await Promise.all([
                this.runGit(['config', 'user.name'], { allowFailure: true }),
                this.runGit(['config', 'user.email'], { allowFailure: true }),
            ]);
            authorName = nameResult.stdout.trim();
            authorEmail = emailResult.stdout.trim();
            if (!authorName || !authorEmail) {
                throw guidanceError(new Error('Git author identity is missing. Provide authorName and authorEmail, or configure user.name and user.email for the vault repository.'), 'guid-1b26805d164cc90d');
            }
        }
        if (!authorName || !authorEmail) {
            throw guidanceError(new Error('Git author identity is missing. Provide authorName and authorEmail, or configure user.name and user.email for the vault repository.'), 'guid-1b26805d164cc90d');
        }
        if (/\r|\n/.test(authorName) || /\r|\n/.test(authorEmail)) {
            throw guidanceError(new Error('Git author identity cannot contain line breaks'), 'guid-e279bc2337d1f542');
        }
        await this.rejectExecutableFilters();
        const pending = await this.pendingChanges();
        const pendingPaths = Array.from(new Set(pending.flatMap(change => [change.path, change.previousPath].filter((path) => Boolean(path)))));
        const paths = params.paths
            ? Array.from(new Set(params.paths.map(path => this.normalizeVaultPath(path))))
            : pendingPaths;
        if (paths.length === 0) {
            return { success: true, committed: false, paths: [], message: guidanceText('guid-2fde0b910e65374a', 'No safe vault changes are pending.') };
        }
        const pathspecs = paths.map(path => this.literalPathspec(path));
        const emptyHooks = await mkdtemp(join(tmpdir(), 'mcpvault-git-hooks-'));
        const identityEnv = {
            GIT_AUTHOR_NAME: authorName,
            GIT_AUTHOR_EMAIL: authorEmail,
            GIT_COMMITTER_NAME: authorName,
            GIT_COMMITTER_EMAIL: authorEmail,
        };
        try {
            const safeGitArgs = ['-c', `core.hooksPath=${emptyHooks}`, '-c', 'commit.gpgSign=false'];
            await this.runGit([...safeGitArgs, 'add', '-A', '--', ...pathspecs], { env: identityEnv });
            const diffCheck = await this.runGit(['diff', '--cached', '--quiet', '--', ...pathspecs], { allowFailure: true });
            if (diffCheck.exitCode === 0) {
                return { success: true, committed: false, paths, message: guidanceText('guid-005251cb7064e6c2', 'The selected paths have no changes to commit.') };
            }
            await this.runGit([...safeGitArgs, 'commit', '--only', '--no-verify', '-m', reason, '--', ...pathspecs], { env: identityEnv });
        }
        finally {
            await rm(emptyHooks, { recursive: true, force: true });
        }
        const revision = (await this.runGit(['rev-parse', '--verify', 'HEAD'])).stdout.trim();
        this.clearStatusCache();
        return {
            success: true,
            committed: true,
            revision,
            paths,
            message: guidanceText('guid-7af83ba2b399ec59', `Created vault revision ${revision.slice(0, 12)}: ${reason}`),
        };
    }
    async noteHistory(pathInput, limit = 20) {
        await this.requireRepo();
        const path = this.normalizeVaultPath(pathInput, true);
        if (!Number.isInteger(limit) || limit < 1)
            throw guidanceError(new Error('limit must be a positive integer'), 'guid-14abe8b02cfc3624');
        const maxLimit = Math.min(limit, 100);
        const format = '%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e';
        const result = await this.runGit(['log', '--follow', `--max-count=${maxLimit}`, `--format=${format}`, '--', this.literalPathspec(path)]);
        return result.stdout
            .split('\x1e')
            .map(record => record.trim())
            .filter(Boolean)
            .map(record => {
            const [revision = '', authorName = '', authorEmail = '', timestamp = '', reason = ''] = record.split('\x1f');
            return { revision, authorName, authorEmail, timestamp, reason };
        });
    }
    async compareNoteRevisions(pathInput, fromInput, toInput = 'HEAD', maxChars = 200_000) {
        await this.requireRepo();
        const path = this.normalizeVaultPath(pathInput, true);
        const fromRevision = await this.resolveRevision(fromInput);
        const toRevision = await this.resolveRevision(toInput);
        const result = await this.runGit([
            'diff',
            '--no-ext-diff',
            '--no-textconv',
            '--unified=3',
            fromRevision,
            toRevision,
            '--',
            this.literalPathspec(path),
        ]);
        const truncated = result.stdout.length > maxChars;
        return {
            path,
            fromRevision,
            toRevision,
            diff: truncated ? result.stdout.slice(0, maxChars) : result.stdout,
            truncated,
        };
    }
    async fileAtRevision(pathInput, revisionInput) {
        await this.requireRepo();
        const path = this.normalizeVaultPath(pathInput, true);
        const revision = await this.resolveRevision(revisionInput);
        const result = await this.runGit(['show', `${revision}:${path}`], { allowFailure: true });
        if (result.exitCode !== 0) {
            throw guidanceError(new Error(`Note '${path}' does not exist at revision ${revisionInput}.`), 'guid-ba04f1c703434a42');
        }
        return { path, revision, content: result.stdout };
    }
    async hasPendingChange(pathInput) {
        await this.requireRepo();
        const path = this.normalizeVaultPath(pathInput, true);
        const pending = await this.pendingChanges();
        return pending.some(change => change.path === path || change.previousPath === path);
    }
}
function cloneRevisionStatus(value) {
    return { ...value, pending: value.pending.map(change => ({ ...change })) };
}
