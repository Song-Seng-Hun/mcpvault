import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { isMarkdownModerationHidden } from './moderation-policy.js';
import { boundSearchResults, normalizeSearchMaxChars } from './search-limits.js';
const execFileAsync = promisify(execFile);
const OBSIDIAN_CACHE_TTL_MS = 2_000;
const OBSIDIAN_CACHE_MAX_ENTRIES = 64;
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
function extractEntries(value) {
    if (Array.isArray(value))
        return value.flatMap(extractEntries);
    if (typeof value === 'string')
        return [{ path: value.trim() }];
    if (!value || typeof value !== 'object')
        return [];
    const item = value;
    const pathValue = item.path ?? item.file ?? item.p;
    if (typeof pathValue === 'string') {
        const line = item.line ?? item.lineNumber ?? item.ln;
        const text = item.text ?? item.context ?? item.excerpt ?? item.ex;
        return [{ path: pathValue, ...(Number.isInteger(Number(line)) && { line: Number(line) }), ...(typeof text === 'string' && { text }) }];
    }
    return Object.values(item).flatMap(extractEntries);
}
export class ObsidianSearchService {
    vaultPath;
    pathFilter;
    access;
    cache = new Map();
    inFlight = new Map();
    constructor(vaultPath, pathFilter, access) {
        this.vaultPath = vaultPath;
        this.pathFilter = pathFilter;
        this.access = access;
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
            return cloneObsidianSearchResult(cached.value);
        }
        if (cached)
            this.cache.delete(cacheKey);
        const running = this.inFlight.get(cacheKey);
        if (running)
            return cloneObsidianSearchResult(await running);
        const computation = this.searchUncached(params);
        this.inFlight.set(cacheKey, computation);
        try {
            const value = await computation;
            this.cache.set(cacheKey, { expiresAt: Date.now() + OBSIDIAN_CACHE_TTL_MS, value: cloneObsidianSearchResult(value) });
            while (this.cache.size > OBSIDIAN_CACHE_MAX_ENTRIES)
                this.cache.delete(this.cache.keys().next().value);
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
        const args = [`query=${query}`, `limit=${limit}`, 'format=json', ...(pathPrefix ? [`path=${pathPrefix}`] : []), ...(params.caseSensitive ? ['case'] : [])];
        let stdout;
        try {
            ({ stdout } = await execFileAsync('obsidian', [command, ...args], { cwd: this.vaultPath, windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024 }));
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Obsidian CLI search failed. Make sure Obsidian is running and CLI is enabled: ${message}`);
        }
        let entries;
        try {
            entries = extractEntries(JSON.parse(stdout));
        }
        catch {
            entries = stdout.split(/\r?\n/).map(line => {
                const match = /^(.*?):(\d+):\s?(.*)$/.exec(line.trim());
                return match ? { path: match[1], line: Number(match[2]), ...(match[3] !== undefined && { text: match[3] }) } : { path: line.trim() };
            }).filter(entry => entry.path);
        }
        const seen = new Set();
        const visibleEntries = [];
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
            try {
                const markdown = await readFile(join(this.vaultPath, path), 'utf8');
                if (isMarkdownModerationHidden(markdown))
                    continue;
            }
            catch {
                // The CLI result may race with a deleted or inaccessible note. Do not
                // turn that into a leak or make the whole search fail.
                continue;
            }
            visibleEntries.push({ ...entry, path });
        }
        const results = boundSearchResults(visibleEntries.slice(0, limit).map(entry => ({
            p: entry.path,
            ...(entry.line !== undefined && { ln: entry.line }),
            ...(entry.text !== undefined && { ex: entry.text }),
        })), maxChars);
        return { backend: 'obsidian', query, context: params.context === true, results, total: results.length, truncated: visibleEntries.length > results.length || entries.length > visibleEntries.length };
    }
}
function cloneObsidianSearchResult(value) {
    return { ...value, results: value.results.map(result => ({ ...result })) };
}
