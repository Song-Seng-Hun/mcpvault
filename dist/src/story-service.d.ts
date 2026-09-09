import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ReferenceService } from './references.js';
import type { ScopeAuthService, ScopePrincipal } from './scope-auth.js';
import type { WorkService } from './work-service.js';
import type { AgentTaskService } from './agent-tasks.js';
import { type StoryParams } from './story-model.js';
import { StoryWorkspace, type StoryOptions } from './story-workspace.js';
/** MCP and REST dispatch through this same authenticated, bounded service. */
export declare class StoryService {
    readonly workspace: StoryWorkspace;
    constructor(fs: FileSystemService, access: ScopeAccessPolicy, references: ReferenceService, auth: ScopeAuthService, work: WorkService, tasks: AgentTaskService, options?: StoryOptions);
    execute(endpoint: string, params: StoryParams, principal?: ScopePrincipal): Promise<StoryParams>;
}
//# sourceMappingURL=story-service.d.ts.map