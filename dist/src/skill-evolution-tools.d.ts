import type { Tool } from '@modelcontextprotocol/server';
export declare const SKILL_MUTATING_TOOLS: readonly ['record_skill_experience', 'manage_skill_candidate', 'evaluate_skill', 'promote_skill', 'rollback_skill'];
/** Used by both the early read-only gate and the common MCP/REST dispatcher. */
export declare function skillReadAlias(tool: string, op: unknown): string | undefined;
export declare function getSkillEvolutionTools(): Tool[];
//# sourceMappingURL=skill-evolution-tools.d.ts.map