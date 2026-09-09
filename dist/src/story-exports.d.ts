import type { ScopePrincipal } from './scope-auth.js';
import type { StoryWorkspace } from './story-workspace.js';
import { type StoryParams } from './story-model.js';
/** Managed, revision-pinned media exports. The Markdown sidecar owns the exact
 * selection, source dependencies, raw output SHA-256 and retry state. It is not
 * generic wiki.canvas freshness metadata. No model or image generation runs.
 *
 * Writes use prepare -> output CAS -> complete. A failed phase leaves an honest
 * pending manifest. Only the same actor/request/payload may resume it, only if
 * its frozen source selection still renders the same output. Existing bytes
 * must match either the previous pinned output or this pending output hash.
 */
export declare class StoryExports {
    readonly w: StoryWorkspace;
    constructor(w: StoryWorkspace);
    private manifestBudget;
    private path;
    private sequences;
    private addGuard;
    private assertReferenceIdentity;
    private dependencies;
    private plan;
    private assertPlan;
    /** Use Workspace continuation logic while binding it to the complete observed
     * projection, then restore the real note revision in the returned envelope.
     * A changing draft/health view must invalidate cursors even if Project.md or
     * the export manifest has not itself changed.
     */
    private bounded;
    private manifest;
    private output;
    private health;
    execute(params: StoryParams, principal?: ScopePrincipal): Promise<StoryParams>;
}
//# sourceMappingURL=story-exports.d.ts.map