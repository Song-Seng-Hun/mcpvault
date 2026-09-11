import type { RoleplayState } from './roleplay-model.js';
export declare const roleplayHash: (value: unknown) => string;
export declare const roleplayRevision: (s: RoleplayState) => string;
export declare function roleplayId(value: unknown, label?: string): string;
export declare function roleplayAccount(value: unknown): string;
export declare function roleplayText(value: unknown, max?: number): string;
//# sourceMappingURL=roleplay-kernel.d.ts.map