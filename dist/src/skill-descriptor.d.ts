/** Untrusted declarations for discovery. None of these fields grants authority. */
export declare const SKILL_EFFECTS: readonly ['read_public', 'read_private', 'write_workspace', 'delete_data', 'read_credentials', 'modify_account', 'write_environment', 'network_send', 'install_dependencies', 'start_process', 'register_mcp', 'register_hook', 'financial_transaction', 'irreversible_action'];
export type SkillEffect = typeof SKILL_EFFECTS[number];
export declare const IMPACT_AXES: readonly ['domain', 'policy', 'legal', 'assets', 'accounts', 'data', 'system'];
export type ImpactAxis = typeof IMPACT_AXES[number];
export type ImpactLevel = 'unknown' | 'low' | 'moderate' | 'high' | 'critical';
export interface SkillConnection {
    kind: 'path' | 'program' | 'api' | 'uri' | 'hook' | 'mcp' | 'package' | 'process' | 'environment';
    target: string;
    effects: SkillEffect[];
}
export interface SkillExample {
    query: string;
    action: string;
    expected: string;
    avoid?: string;
}
export interface SkillImpactClaim {
    axis: ImpactAxis;
    level: ImpactLevel;
    scenario: string;
    assumptions: string[];
    jurisdictions: string[];
    references: string[];
}
export interface SkillDescriptor {
    version: 1;
    kind: 'procedure' | 'tool' | 'hybrid' | 'unknown';
    domains: string[];
    purpose: string;
    useWhen: string[];
    avoidWhen: string[];
    keywords: string[];
    inputs: string[];
    outputs: string[];
    effects: SkillEffect[];
    connections: SkillConnection[];
    examples: SkillExample[];
    impactClaims: SkillImpactClaim[];
    compatibility: string[];
    relatedSkills: string[];
    incompatibleSkills: string[];
}
export declare function parseSkillDescriptor(value: unknown): SkillDescriptor;
export declare function skillDescriptorTerms(d: SkillDescriptor): string[];
export declare function skillDescriptorExampleText(d: SkillDescriptor): string;
//# sourceMappingURL=skill-descriptor.d.ts.map