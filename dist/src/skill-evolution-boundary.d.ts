/** Only trusted service code grants one exact write, never a request or note. */
export declare function withSkillEvolutionWrite<T>(path: string, operation: () => Promise<T>): Promise<T>;
export declare function assertSkillEvolutionMutationBoundary(path: string): void;
//# sourceMappingURL=skill-evolution-boundary.d.ts.map