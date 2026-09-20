import { hash } from '../src/evolution/policy.js';

/** Fresh per-call mutable map/lease storage for tests only. */
export function memoryStorage() {
  const records = new Map<string, any>(); let held = false;
  return { records, storage: { refresh: async () => ({ version: 1 as const, enabled: true }), acquire: async () => {
    if (held) throw Error('busy'); held = true;
    return { assertHeld: async () => { if (!held) throw Error('lost'); }, close: async () => { held = false; } };
  }, records: {
    read: async (key: string) => ({ revision: records.has(key) ? hash(records.get(key)) : 'missing', value: structuredClone(records.get(key)) }),
    write: async (key: string, value: any, expected: string) => {
      if (!held || expected !== (records.has(key) ? hash(records.get(key)) : 'missing')) throw Error('conflict');
      records.set(key, structuredClone(value)); return { revision: hash(value) };
    },
  } } } as any;
}
