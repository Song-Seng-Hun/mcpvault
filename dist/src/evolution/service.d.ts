import type { ScopePrincipal } from '../scope-auth.js';
import type { EvolutionOptions } from './model.js';
type Params = Record<string, any>;
export declare class EvolutionService {
    private readonly options;
    private tail;
    private evaluatorBusy;
    private closed;
    private evaluationController?;
    constructor(options: EvolutionOptions);
    close(): Promise<void>;
    execute(endpoint: string, input: Params, principal?: ScopePrincipal, assertActor?: () => Promise<void>, execution?: {
        automatic: boolean;
    }): Promise<any>;
    private evidence;
    private visible;
    private feedback;
    private sources;
    private persona;
    private adapter;
    private view;
    private cycle;
    private context;
}
export {};
//# sourceMappingURL=service.d.ts.map