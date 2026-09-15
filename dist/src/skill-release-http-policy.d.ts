/** Transport-owned restriction, never an authorization claim from JSON/headers.
 * This supplementary listener accepts only the canonical approved-resource read.
 * Login stays on the existing authenticated channel; no account endpoint, generic
 * catalog/pulse, alias, URL dispatch or mutation is enabled here. Approval, current
 * account/source/owner checks still run in the ordinary read service. */
export declare function allowedReviewedSkillRequest(method: string | undefined, value: unknown): boolean;
//# sourceMappingURL=skill-release-http-policy.d.ts.map