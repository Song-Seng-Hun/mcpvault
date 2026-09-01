import { appendFile, chmod, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ScopePrincipal } from './scope-auth.js';

export interface AuditEvent {
  at: string;
  tool: string;
  actor: string;
  role: 'model' | 'agent' | 'anonymous';
  outcome: 'attempt' | 'error';
  target?: string;
  error?: string;
}

function actorFor(principal?: ScopePrincipal, explicit?: unknown): { actor: string; role: AuditEvent['role'] } {
  if (principal) return { actor: principal.agentId || principal.modelId, role: principal.role };
  const actor = typeof explicit === 'string' && explicit.trim() ? explicit.trim().slice(0, 120) : 'anonymous';
  return { actor, role: 'anonymous' };
}

function targetFor(args: Record<string, unknown>): string | undefined {
  const candidates = ['path', 'oldPath', 'newPath', 'slug', 'commentId', 'roomId', 'messageId', 'taskId', 'agentId', 'identity'];
  const values = candidates.flatMap(key => typeof args[key] === 'string' && args[key] ? [`${key}=${String(args[key]).slice(0, 160)}`] : []);
  return values.length ? values.join(' ') : undefined;
}

/**
 * Append-only, metadata-only audit trail. It deliberately excludes request
 * bodies and access tokens so it can diagnose denied operations without
 * becoming a second content database or a secret store.
 */
export class AuditService {
  private readonly auditPath: string;
  private tail: Promise<void> = Promise.resolve();

  constructor(vaultPath: string) {
    this.auditPath = join(resolve(vaultPath), '.mcpvault', 'audit.ndjson');
  }

  private async exclusive(operation: () => Promise<void>): Promise<void> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>(resolvePromise => { release = resolvePromise; });
    await previous;
    try { await operation(); } finally { release(); }
  }

  async record(params: { tool: string; principal?: ScopePrincipal; args?: Record<string, unknown>; outcome: AuditEvent['outcome']; error?: unknown; explicitActor?: unknown }): Promise<void> {
    const identity = actorFor(params.principal, params.explicitActor);
    const target = params.args ? targetFor(params.args) : undefined;
    const event: AuditEvent = {
      at: new Date().toISOString(),
      tool: String(params.tool).slice(0, 120),
      actor: identity.actor,
      role: identity.role,
      outcome: params.outcome,
      ...(target ? { target } : {}),
      ...(params.error !== undefined ? { error: String(params.error instanceof Error ? params.error.message : params.error).slice(0, 500) } : {}),
    };
    try {
      await this.exclusive(async () => {
        const directory = dirname(this.auditPath);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await appendFile(this.auditPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
        await Promise.allSettled([chmod(directory, 0o700), chmod(this.auditPath, 0o600)]);
      });
    } catch {
      // Auditing must never change the result of the requested MCP operation.
    }
  }

  async list(params: { principal?: ScopePrincipal; limit?: number; includeErrors?: boolean }) {
    if (!params.principal) throw new Error('Login is required to read the security audit log');
    const limit = Math.min(Math.max(Number(params.limit ?? 50), 1), 500);
    let lines: string[] = [];
    try { lines = (await readFile(this.auditPath, 'utf8')).split(/\r?\n/).filter(Boolean); } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const target = params.principal.agentId || params.principal.modelId;
    const events: AuditEvent[] = [];
    for (const line of lines.slice(-2000).reverse()) {
      try {
        const event = JSON.parse(line) as AuditEvent;
        if (event.actor !== target) continue;
        if (!params.includeErrors && event.outcome === 'error') continue;
        events.push(event);
        if (events.length >= limit) break;
      } catch { /* ignore a torn/corrupt line and keep the audit reader bounded */ }
    }
    return { events, total: events.length, truncated: lines.length > events.length };
  }
}
