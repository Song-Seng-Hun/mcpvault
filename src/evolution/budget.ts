import type { HostWorkStorage } from '../host-work-storage.js';
import type { EvolutionConfig } from './model.js';
import { hash, id, unavailable } from './policy.js';

interface Entry { id: string; kind: 'foreground' | 'evolution'; at: number; reserved: number; tokens?: number; state: 'pending' | 'unknown' | 'settled' }
interface Ledger { version: 1; entries: Entry[] }
const DAY = 86400000;
const amount = (v: unknown): number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 1000000000 ? v as number : unavailable();

/** Per-account/per-host-storage ledger. Evolution is never part of its own denominator.
 * Only trusted host usage counters call this API; model text is not metering.
 * Preserve unknown/in-flight charges across restarts, including after the 24h window.
 */
export class EvolutionBudget {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly storage: HostWorkStorage<EvolutionConfig>, private readonly authorize: (accountId: string) => Promise<void>,
    private readonly now: () => number = Date.now) {}
  private transact<T>(account: string, operation: (ledger: Ledger) => T): Promise<T> {
    const run = async () => {
      id(account); await this.authorize(account);
      if (!this.storage.records || !(await this.storage.refresh()).enabled) return unavailable();
      const writer = await this.storage.acquire();
      try {
        const assert = async () => { await this.authorize(account); if (!(await this.storage.refresh()).enabled) return unavailable(); await writer.assertHeld(); };
        const key = hash(['evolution-budget-v1', account]), prior = await this.storage.records.read(key);
        const ledger = structuredClone(prior.value ?? { version: 1, entries: [] }) as Ledger;
        if (!ledger || ledger.version !== 1 || !Array.isArray(ledger.entries) || ledger.entries.length > 1024
          || new Set(ledger.entries.map(e => `${e.kind}:${e.id}`)).size !== ledger.entries.length) return unavailable();
        for (const e of ledger.entries) {
          id(e.id); amount(e.reserved); if (e.tokens !== undefined) amount(e.tokens);
          if (!Number.isSafeInteger(e.at) || !['foreground', 'evolution'].includes(e.kind) || !['pending', 'unknown', 'settled'].includes(e.state)
            || e.state === 'settled' && e.tokens === undefined || e.kind === 'foreground' && e.state !== 'settled') return unavailable();
        }
        const result = operation(ledger); await assert();
        if (ledger.entries.length > 1024) throw Error('Budget history capacity reached; preserve records for host review');
        if (hash(ledger) !== hash(prior.value ?? null)) await this.storage.records.write(key, ledger, prior.revision, assert);
        await assert(); return result;
      } finally { await writer.close(); }
    };
    const result = this.tail.then(run, run).catch(() => unavailable()); this.tail = result.catch(() => undefined); return result;
  }
  recordForeground(account: string, eventId: string, tokens: number) {
    id(eventId); amount(tokens);
    return this.transact(account, l => {
      const old = l.entries.find(e => e.kind === 'foreground' && e.id === eventId);
      if (old) { if (old.tokens !== tokens) return unavailable(); return; }
      l.entries.push({ id: eventId, kind: 'foreground', at: this.now(), reserved: 0, tokens, state: 'settled' });
    });
  }
  reserve(account: string, requestId: string, maximumTokens: number) {
    id(requestId); if (!amount(maximumTokens)) return unavailable();
    return this.transact(account, l => {
      const old = l.entries.find(e => e.kind === 'evolution' && e.id === requestId);
      // Replaying an old reservation never authorizes another call.
      if (old || l.entries.some(e => e.state === 'unknown')) return unavailable();
      const now = this.now(), recent = (e: Entry) => e.at >= now - DAY && e.at <= now;
      const foreground = l.entries.filter(e => e.kind === 'foreground' && recent(e)).reduce((n, e) => n + e.tokens!, 0);
      const spent = l.entries.filter(e => e.kind === 'evolution' && (recent(e) || e.state !== 'settled'))
        .reduce((n, e) => n + (e.state === 'settled' ? e.tokens! : e.reserved), 0);
      if (spent + maximumTokens > Math.floor(foreground / 10)) return unavailable();
      l.entries.push({ id: requestId, kind: 'evolution', at: now, reserved: maximumTokens, state: 'pending' });
    });
  }
  settle(account: string, requestId: string, tokens: number | undefined) {
    id(requestId); if (tokens !== undefined) amount(tokens);
    return this.transact(account, l => {
      const old = l.entries.find(e => e.kind === 'evolution' && e.id === requestId); if (!old) return unavailable();
      if (old.state === 'settled') { if (old.tokens !== tokens) return unavailable(); return; }
      if (tokens === undefined) old.state = 'unknown';
      else { old.tokens = tokens; old.state = 'settled'; old.at = this.now(); }
    });
  }
}
