import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { isMarkdownModerationHidden } from './moderation-policy.js';
import { boundSearchResults, normalizeSearchMaxChars } from './search-limits.js';
import { VaultIoCoordinator } from './vault-io.js';
import { createDerivedCacheOwner, derivedCacheBudget, estimateCacheBytes } from './cache-budget.js';
const execFileAsync = promisify(execFile);
const OBSIDIAN_CACHE_TTL_MS = 2_000;
const OBSIDIAN_CACHE_MAX_ENTRIES = 64;
const OBSIDIAN_MAX_CLI_ENTRIES = 200;
const OBSIDIAN_VERIFY_BATCH_SIZE = 8;
function cleanRelativePath(value) {
    const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized) || normalized.split('/').includes('..')) {
        throw new Error('pathPrefix must be a relative vault folder without parent traversal');
    }
    return normalized.replace(/^\/|\/$/g, '');
}
function limitNumber(value) {
    const parsed = value === undefined ? 20 : Number(value);
    if (!Number.isInteger(parsed) || parsed < 1)
        throw new Error('limit must be a positive integer');
    return Math.min(parsed, 50);
}
function extractEntries(value, maxEntries = OBSIDIAN_MAX_CLI_ENTRIES) {
    const entries = [];
    const visit = (current) => {
        if (entries.length >= maxEntries)
            return;
        if (Array.isArray(current)) {
            for (const item of current) {
                visit(item);
                if (entries.length >= maxEntries)
                    return;
            }
            return;
        }
        if (typeof current === 'string') {
            entries.push({ path: current.trim() });
            return;
        }
        if (!current || typeof current !== 'object')
            return;
        const item = current;
        const pathValue = item.path ?? item.file ?? item.p;
        if (typeof pathValue === 'string') {
            const line = item.line ?? item.lineNumber ?? item.ln;
            const text = item.text ?? item.context ?? item.excerpt ?? item.ex;
            entries.push({ path: pathValue, ...(Number.isInteger(Number(line)) && { line: Number(line) }), ...(typeof text === 'string' && { text }) });
            return;
        }
        for (const child of Object.values(item)) {
            visit(child);
            if (entries.length >= maxEntries)
                return;
        }
    };
    visit(value);
    return { entries, truncated: entries.length >= maxEntries };
}
export class ObsidianSearchService {
    vaultPath;
    pathFilter;
    access;
    vaultIo;
    cache = new Map();
    inFlight = new Map();
    cacheOwner = createDerivedCacheOwner('obsidian.search');
    constructor(vaultPath, pathFilter, access, vaultIo = new VaultIoCoordinator()) {
        this.vaultPath = vaultPath;
        this.pathFilter = pathFilter;
        this.access = access;
        this.vaultIo = vaultIo;
    }
    async search(params) {
        // Enforce the public-only boundary before consulting the cache. Otherwise
        // an anonymous cached result could be returned to an authenticated caller
        // without reaching the same guard in searchUncached().
        if (params.principal)
            throw new Error('search_obsidian is limited to the public global scope; use search_scoped_notes for authenticated private-scope search');
        const cacheKey = JSON.stringify({
            query: params.query,
            pathPrefix: params.pathPrefix || '',
            limit: params.limit,
            maxChars: params.maxChars,
            context: params.context === true,
            caseSensitive: params.caseSensitive === true,
        });
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            this.cache.delete(cacheKey);
            this.cache.set(cacheKey, cached);
            derivedCacheBudget.touch(this.cacheOwner, cacheKey);
            return cloneObsidianSearchResult(cached.value);
        }
        if (cached)
            this.deleteCache(cacheKey);
        const running = this.inFlight.get(cacheKey);
        if (running)
            return cloneObsidianSearchResult(await running);
        const computation = this.searchUncached(params);
        this.inFlight.set(cacheKey, computation);
        try {
            const value = await computation;
            const entry = { expiresAt: Date.now() + OBSIDIAN_CACHE_TTL_MS, value: cloneObsidianSearchResult(value) };
            this.cache.set(cacheKey, entry);
            derivedCacheBudget.register(this.cacheOwner, cacheKey, estimateCacheBytes(entry.value), () => {
                if (this.cache.get(cacheKey) === entry)
                    this.cache.delete(cacheKey);
            });
            while (this.cache.size > OBSIDIAN_CACHE_MAX_ENTRIES)
                this.deleteCache(this.cache.keys().next().value);
            return cloneObsidianSearchResult(value);
        }
        finally {
            if (this.inFlight.get(cacheKey) === computation)
                this.inFlight.delete(cacheKey);
        }
    }
    async searchUncached(params) {
        // Obsidian's index has no concept of MCPVault model/agent scopes. Never
        // run it for an authenticated caller, because its output could reveal a
        // private file before the MCP scope layer gets a chance to filter it.
        if (params.principal)
            throw new Error('search_obsidian is limited to the public global scope; use search_scoped_notes for authenticated private-scope search');
        const query = String(params.query || '').trim();
        if (!query)
            throw new Error('query is required');
        if (query.length > 500)
            throw new Error('query is too long');
        const limit = limitNumber(params.limit);
        const maxChars = normalizeSearchMaxChars(params.maxChars);
        const pathPrefix = params.pathPrefix ? cleanRelativePath(params.pathPrefix) : undefined;
        if (pathPrefix && !this.pathFilter.isAllowed(pathPrefix))
            throw new Error('pathPrefix is restricted');
        const command = params.context ? 'search:context' : 'search';
        const cliLimit = Math.min(Math.max(limit * 4, limit), 50);
        const args = [`query=${query}`, `limit=${cliLimit}`, 'format=json', ...(pathPrefix ? [`path=${pathPrefix}`] : []), ...(params.caseSensitive ? ['case'] : [])];
        let stdout;
        try {
            ({ stdout } = await execFileAsync('obsidian', [command, ...args], { cwd: this.vaultPath, windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024 }));
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Obsidian CLI search failed. Make sure Obsidian is running and CLI is enabled: ${message}`);
        }
        let entries;
        let parserTruncated = false;
        try {
            const extracted = extractEntries(JSON.parse(stdout));
            entries = extracted.entries;
            parserTruncated = extracted.truncated;
        }
        catch {
            const allLines = stdout.split(/\r?\n/);
            const lines = allLines.slice(0, OBSIDIAN_MAX_CLI_ENTRIES);
            entries = lines.map(line => {
                const match = /^(.*?):(\d+):\s?(.*)$/.exec(line.trim());
                return match ? { path: match[1], line: Number(match[2]), ...(match[3] !== undefined && { text: match[3] }) } : { path: line.trim() };
            }).filter(entry => entry.path);
            parserTruncated = allLines.length > entries.length;
        }
        const seen = new Set();
        const candidates = [];
        for (const entry of entries) {
            const path = entry.path.replace(/\\/g, '/').replace(/^\.\//, '').trim();
            if (!path || !this.pathFilter.isAllowed(path) || !this.access.canAccessPhysicalPath(path))
                continue;
            if (pathPrefix && path !== pathPrefix && !path.startsWith(`${pathPrefix}/`))
                continue;
            const key = `${path}:${entry.line ?? ''}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            candidates.push({ ...entry, path });
        }
        const visibleEntries = [];
        let verificationTruncated = false;
        for (let offset = 0; offset < candidates.length; offset += OBSIDIAN_VERIFY_BATCH_SIZE) {
            const batch = candidates.slice(offset, offset + OBSIDIAN_VERIFY_BATCH_SIZE);
            const verified = await Promise.all(batch.map(async (entry) => {
                try {
                    const markdown = await this.vaultIo.readUtf8(join(this.vaultPath, entry.path));
                    return isMarkdownModerationHidden(markdown) ? undefined : entry;
                }
                catch {
                    // The CLI result may race with a deleted or inaccessible note. Do not
                    // turn that into a leak or make the whole search fail.
                    return undefined;
                }
            }));
            for (const entry of verified)
                if (entry)
                    visibleEntries.push(entry);
            if (visibleEntries.length >= limit) {
                verificationTruncated = offset + batch.length < candidates.length;
                break;
            }
        }
        const results = boundSearchResults(visibleEntries.slice(0, limit).map(entry => ({
            p: entry.path,
            ...(entry.line !== undefined && { ln: entry.line }),
            ...(entry.text !== undefined && { ex: entry.text }),
        })), maxChars);
        return { backend: 'obsidian', query, context: params.context === true, results, total: results.length, truncated: parserTruncated || verificationTruncated || visibleEntries.length > results.length || entries.length > visibleEntries.length };
    }
    deleteCache(cacheKey) {
        if (this.cache.delete(cacheKey))
            derivedCacheBudget.remove(this.cacheOwner, cacheKey);
    }
}
function cloneObsidianSearchResult(value) {
    return { ...value, results: value.results.map(result => ({ ...result })) };
}
