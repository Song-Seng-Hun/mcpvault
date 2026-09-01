import { appendFile, chmod, mkdir, open } from 'node:fs/promises';
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

const AUDIT_TAIL_BYTES = 512 * 1024;
const AUDIT_TAIL_LINES = 2_000;

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

  private async readTail(): Promise<{ lines: string[]; truncated: boolean }> {
    let handle;
    try {
      handle = await open(this.auditPath, 'r');
      const size = (await handle.stat()).size;
      const start = Math.max(0, size - AUDIT_TAIL_BYTES);
      const buffer = Buffer.alloc(size - start);
      if (buffer.length > 0) await handle.read(buffer, 0, buffer.length, start);
      let lines = buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
      const partialLine = start > 0;
      if (partialLine) lines = lines.slice(1);
      const truncated = partialLine || lines.length > AUDIT_TAIL_LINES;
      return { lines: lines.slice(-AUDIT_TAIL_LINES), truncated };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { lines: [], truncated: false };
      throw error;
    } finally {
      if (handle) await handle.close().catch(() => undefined);
    }
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
    const tail = await this.readTail();
    const target = params.principal.agentId || params.principal.modelId;
    const events: AuditEvent[] = [];
    for (const line of tail.lines.reverse()) {
      try {
        const event = JSON.parse(line) as AuditEvent;
        if (event.actor !== target) continue;
        if (!params.includeErrors && event.outcome === 'error') continue;
        events.push(event);
        if (events.length >= limit) break;
      } catch { /* ignore a torn/corrupt line and keep the audit reader bounded */ }
    }
    return { events, total: events.length, truncated: tail.truncated || events.length >= limit };
  }
}
