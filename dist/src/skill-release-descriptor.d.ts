import { type SkillDescriptor } from './skill-descriptor.js';
import type { SkillReleaseResource } from './skill-release-manifest.js';
/** Only the distinct, registered derivative descriptor. Never source evidence or
 * host review artifacts. Parsing conveys no execution or legal/policy clearance. */
export declare function parseReleaseDescriptor(resource: SkillReleaseResource, bytes: Buffer): SkillDescriptor;
//# sourceMappingURL=skill-release-descriptor.d.ts.map