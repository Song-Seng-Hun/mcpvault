import type { HostWorkRecords } from '../host-work-storage.js';
import type { IndexRecord } from './model.js';
/** One bounded owner index, separate page records. No global directory/body scans. */
export declare class EvolutionRepository {
    private readonly records;
    private readonly owner;
    private readonly current;
    private readonly account;
    constructor(records: HostWorkRecords, owner: string, current: () => Promise<void>, account?: string);
    private key;
    read<T extends {
        version: number;
    }>(kind: string, id: string): Promise<{
        revision: string;
        value?: T;
    }>;
    write(kind: string, id: string, value: unknown, revision: string): Promise<{
        revision: string;
    }>;
    private partition;
    index(): Promise<{
        revision: string;
        value: IndexRecord;
    }>;
    add(kind: 'feedback' | 'cycles', id: string, shared?: boolean): Promise<void>;
}
//# sourceMappingURL=repository.d.ts.map