import { guidanceError } from './guidance-runtime.js';
import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ReferenceService } from './references.js';
import type { ScopeAuthService, ScopePrincipal } from './scope-auth.js';
import type { WorkService } from './work-service.js';
import type { AgentTaskService } from './agent-tasks.js';
import { coordinate } from './work-model.js';
import { storyObject, type StoryParams } from './story-model.js';
import { StoryWorkspace, type StoryOptions } from './story-workspace.js';
import { StoryProjects } from './story-projects.js';
import { StoryArtifacts } from './story-artifacts.js';
import { StoryEditorial } from './story-editorial.js';
import { StoryContext } from './story-context.js';
import { StorySessions } from './story-session.js';

const common = ['op', 'projectId', 'requestId', 'expectedRevision', 'expectedProjectRevision', 'accessToken', 'maxChars', 'limit', 'cursor', 'field'];
const fields: Record<string, string[]> = {
  project: ['title', 'brief', 'participants', 'showrunnerAccountId', 'enabled', 'maxSteps'],
  artifact: ['artifactId', 'kind', 'title', 'content', 'branchId', 'data', 'sources', 'references'],
  sequence: ['branchId', 'presentation', 'chronology', 'shots'],
  context: ['branchId', 'artifactId', 'characterId', 'query'],
  review: ['reviewId', 'artifactId', 'branchId', 'sourceRevision', 'content', 'findings', 'pass'],
  adopt: ['artifactId', 'sourceRevision', 'reviewIds', 'reason'],
  session: ['sessionId', 'artifactId', 'writerAccountId', 'editorAccountId', 'sourceRevision', 'reviewId', 'decision', 'reason', 'choiceIds', 'initialState', 'maxSteps', 'reconnectWriter', 'expectedWorkRevision', 'expectedWorkGeneration', 'includeGitHistory', 'reconnectProofFingerprint'],
  export: ['format', 'selection', 'branchId', 'exportId'],
  visual: ['modelId', 'branchId', 'view', 'eventIds', 'sourceRevision', 'intent', 'fingerprint', 'replacements', 'artifactId', 'title'],
};
const operations: Record<string, string[]> = {
  project: ['read', 'create', 'update'], artifact: ['read', 'list', 'create', 'update'], sequence: ['read', 'update'],
  context: ['read'], review: ['read', 'list', 'create'], adopt: ['adopt'],
  session: ['read', 'list', 'reconnect_preview', 'start', 'submit', 'review', 'pause', 'resume', 'decide', 'rehearse'],
  export: ['preview', 'read', 'health', 'write'],
  visual: ['read', 'preview', 'propose'],
};

/** MCP and REST dispatch through this same authenticated, bounded service. */
export class StoryService {
  readonly workspace: StoryWorkspace;
  constructor(fs: FileSystemService, access: ScopeAccessPolicy, references: ReferenceService, auth: ScopeAuthService,
    work: WorkService, tasks: AgentTaskService, options: StoryOptions = {}) {
    this.workspace = new StoryWorkspace(fs, access, references, auth, work, tasks, options);
  }

  async execute(endpoint: string, params: StoryParams, principal?: ScopePrincipal): Promise<StoryParams> {
    if (!fields[endpoint]) throw guidanceError(new Error('Unknown story endpoint'), 'guid-4e805149637683ef');
    storyObject(params, [...common, ...fields[endpoint]], 'story request');
    if (params.op !== undefined && !operations[endpoint]!.includes(params.op)) throw guidanceError(new Error('Invalid story operation'), 'guid-890b48acb1c3dfa8');
    const maxChars = params.maxChars === undefined ? 4000 : params.maxChars;
    if (!Number.isInteger(maxChars) || maxChars < 512 || maxChars > 12000) throw guidanceError(new Error('maxChars must be 512..12000'), 'guid-4b78da01578248c7');
    if (params.limit !== undefined && (!Number.isInteger(params.limit) || params.limit < 1 || params.limit > 100)) throw guidanceError(new Error('limit must be 1..100'), 'guid-e7f2f60cbd1931e0');
    if (params.cursor !== undefined && (typeof params.cursor !== 'string' || !params.cursor || params.cursor.length > 1000)) throw guidanceError(new Error('Invalid story cursor'), 'guid-4654f9bf4c27d282');
    if (params.field !== undefined && (typeof params.field !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,50}$/.test(params.field) || ['constructor', 'prototype', '__proto__'].includes(params.field))) throw guidanceError(new Error('Invalid story projection field'), 'guid-32969c22129455ba');
    const w = this.workspace;
    const run = async () => {
      if (endpoint === 'project') return new StoryProjects(w).execute(params, principal);
      if (endpoint === 'sequence') return new StoryProjects(w).sequence(params, principal);
      if (endpoint === 'artifact') return new StoryArtifacts(w).execute(params, principal);
      if (endpoint === 'review') return new StoryEditorial(w).review(params, principal);
      if (endpoint === 'adopt') return new StoryEditorial(w).adopt(params, principal);
      if (endpoint === 'session') return new StorySessions(w).execute(params, principal);
      if (endpoint === 'visual') {
        const { StoryVisual } = await import('./story-visual.js');
        return new StoryVisual(w).execute(params, principal);
      }
      if (endpoint === 'export') {
        const { StoryExports } = await import('./story-exports.js');
        return new StoryExports(w).execute(params, principal);
      }
      return new StoryContext(w).read(params, principal);
    };
    const mutating = endpoint === 'adopt' || (params.op !== undefined && !['read', 'list', 'preview', 'reconnect_preview', 'health'].includes(params.op));
    const result = await (mutating ? coordinate(run) : run());
    if (JSON.stringify(result).length <= maxChars) return result;
    if (!mutating) throw guidanceError(new Error('Story read response exceeded its declared budget'), 'guid-81585a71bd6a6d6c');
    // Never turn an already committed mutation into a response-size failure.
    // Preserve exact receipt identity and direct the host to a bounded reread.
    const compact: StoryParams = { path: result.path, revision: result.revision, truncated: true, omittedFields: true };
    const nextAction = { endpointId: 'notes.read', arguments: { path: result.path, expectedRevision: result.revision, maxChars: 12000 } };
    if (JSON.stringify({ ...compact, nextAction }).length <= maxChars) compact.nextAction = nextAction;
    for (const key of ['projectId', 'artifactId', 'sessionId', 'stage', 'stale', 'prepared', 'adopted', 'hostExecutionOnly', 'projectRevision']) {
      if (result[key] !== undefined && JSON.stringify({ ...compact, [key]: result[key] }).length <= maxChars) compact[key] = result[key];
    }
    return compact;
  }
}
