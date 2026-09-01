import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PathFilter } from './pathfilter.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';

const execFileAsync = promisify(execFile);

function cleanRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error('pathPrefix must be a relative vault folder without parent traversal');
  }
  return normalized.replace(/^\/|\/$/g, '');
}

function limitNumber(value: unknown): number {
  const parsed = value === undefined ? 50 : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('limit must be a positive integer');
  return Math.min(parsed, 500);
}

function extractEntries(value: unknown): Array<{ path: string; line?: number; text?: string }> {
  if (Array.isArray(value)) return value.flatMap(extractEntries);
  if (typeof value === 'string') return [{ path: value.trim() }];
  if (!value || typeof value !== 'object') return [];
  const item = value as Record<string, unknown>;
  const pathValue = item.path ?? item.file ?? item.p;
  if (typeof pathValue === 'string') {
    const line = item.line ?? item.lineNumber ?? item.ln;
    const text = item.text ?? item.context ?? item.excerpt ?? item.ex;
    return [{ path: pathValue, ...(Number.isInteger(Number(line)) && { line: Number(line) }), ...(typeof text === 'string' && { text }) }];
  }
  return Object.values(item).flatMap(extractEntries);
}

export class ObsidianSearchService {
  constructor(
    private readonly vaultPath: string,
    private readonly pathFilter: PathFilter,
    private readonly access: ScopeAccessPolicy,
  ) {}

  async search(params: { query: string; pathPrefix?: string; limit?: number; context?: boolean; caseSensitive?: boolean; principal?: ScopePrincipal }) {
    // Obsidian's index has no concept of MCPVault model/agent scopes. Never
    // run it for an authenticated caller, because its output could reveal a
    // private file before the MCP scope layer gets a chance to filter it.
    if (params.principal) throw new Error('search_obsidian is limited to the public global scope; use search_scoped_notes for authenticated private-scope search');
    const query = String(params.query || '').trim();
    if (!query) throw new Error('query is required');
    if (query.length > 500) throw new Error('query is too long');
    const limit = limitNumber(params.limit);
    const pathPrefix = params.pathPrefix ? cleanRelativePath(params.pathPrefix) : undefined;
    if (pathPrefix && !this.pathFilter.isAllowed(pathPrefix)) throw new Error('pathPrefix is restricted');
    const command = params.context ? 'search:context' : 'search';
    const args = [`query=${query}`, `limit=${limit}`, 'format=json', ...(pathPrefix ? [`path=${pathPrefix}`] : []), ...(params.caseSensitive ? ['case'] : [])];
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync('obsidian', [command, ...args], { cwd: this.vaultPath, windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024 }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Obsidian CLI search failed. Make sure Obsidian is running and CLI is enabled: ${message}`);
    }
    let entries: Array<{ path: string; line?: number; text?: string }>;
    try {
      entries = extractEntries(JSON.parse(stdout));
    } catch {
      entries = stdout.split(/\r?\n/).map(line => {
        const match = /^(.*?):(\d+):\s?(.*)$/.exec(line.trim());
        return match ? { path: match[1]!, line: Number(match[2]), ...(match[3] !== undefined && { text: match[3] }) } : { path: line.trim() };
      }).filter(entry => entry.path);
    }
    const seen = new Set<string>();
    const results = entries.filter(entry => {
      const path = entry.path.replace(/\\/g, '/').replace(/^\.\//, '').trim();
      if (!path || !this.pathFilter.isAllowed(path) || !this.access.canAccessPhysicalPath(path)) return false;
      if (pathPrefix && path !== pathPrefix && !path.startsWith(`${pathPrefix}/`)) return false;
      if (seen.has(`${path}:${entry.line ?? ''}`)) return false;
      seen.add(`${path}:${entry.line ?? ''}`);
      return true;
    }).slice(0, limit).map(entry => ({
      p: entry.path.replace(/\\/g, '/').replace(/^\.\//, ''),
      ...(entry.line !== undefined && { ln: entry.line }),
      ...(entry.text !== undefined && { ex: entry.text }),
    }));
    return { backend: 'obsidian', query, context: params.context === true, results, total: results.length, truncated: entries.length > results.length };
  }
}
