import { createHash } from 'node:crypto';
import { PathFilter } from './pathfilter.js';
import { isOriginalPath } from './original-boundary.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';

export const COMPILATION_OPERATIONS = ['index', 'synthesize', 'embed', 'vision', 'convert'] as const;
export type CompilationOperation = typeof COMPILATION_OPERATIONS[number];
export interface CompilationSourcePolicy { path: string; classification: 'resolved' | 'unresolved'; mode: 'source_only' | 'synthesis_allowed' }
export interface CompilationProject {
  id: string; ruleVersion: string; sources: CompilationSourcePolicy[]; outputPaths: string[];
  runtimeIds: string[]; operations: CompilationOperation[];
}
export interface CompilationConfig { version: 1; enabled: boolean; accountId: string; projects: CompilationProject[] }
/** Only returned by a trusted host verifier. Provider/model/client names are not verification. */
export interface CompilationRuntime { id: string; revision: string; local: boolean; operations: readonly CompilationOperation[] }
export type CompilationAdmission = { status: 'ready'; fingerprint: string; sourceFingerprint: string } | {
  status: 'diagnostic_only' | 'unavailable' | 'review_required' | 'waiting_runtime'; fingerprint?: never;
};
export const compilationHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = () => Error('Invalid compilation configuration');
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9._-]{0,99}$/.test(v);
function record(v: unknown, keys: string[]): Record<string, any> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) throw invalid();
  return v as Record<string, any>;
}
function array<T>(value: unknown, max: number, normalize: (v: unknown) => T): T[] {
  if (!Array.isArray(value) || !value.length || value.length > max) throw invalid();
  return value.map(normalize);
}
function unique<T>(values: T[], key: (v: T) => string): T[] {
  if (new Set(values.map(key)).size !== values.length) throw invalid();
  return values;
}
/** Exact physical Markdown paths. Never normalize a wildcard, traversal or alias into a grant. */
export function compilationPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 400 || /[\\:*?"<>|\x00-\x1f\x7f]/.test(value)
    || value.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
    || !/\.md$/i.test(value) || !new PathFilter().isAllowed(value)) throw invalid();
  return value;
}

export function validateCompilationConfig(value: unknown): CompilationConfig {
  const raw = record(value, ['version', 'enabled', 'accountId', 'projects']);
  if (raw.version !== 1 || typeof raw.enabled !== 'boolean' || !id(raw.accountId)) throw invalid();
  const projects = unique(array(raw.projects, 32, value => {
    const p = record(value, ['id', 'ruleVersion', 'sources', 'outputPaths', 'runtimeIds', 'operations']);
    if (!id(p.id) || !id(p.ruleVersion)) throw invalid();
    const sources = unique(array(p.sources, 64, value => {
      const s = record(value, ['path', 'classification', 'mode']);
      if (!['resolved', 'unresolved'].includes(s.classification) || !['source_only', 'synthesis_allowed'].includes(s.mode)) throw invalid();
      return { path: compilationPath(s.path), classification: s.classification, mode: s.mode } as CompilationSourcePolicy;
    }), s => s.path.toLowerCase());
    const outputPaths = unique(array(p.outputPaths, 32, value => {
      const path = compilationPath(value);
      if (isOriginalPath(path) || /(?:^|\/)(?:Community|PublicCommunity|_continuity|_collaboration|_wiki|_roleplay)(?:\/|$)/i.test(path)) throw invalid();
      return path;
    }), path => path.toLowerCase());
    const runtimeIds = unique(array(p.runtimeIds, 16, v => { if (!id(v)) throw invalid(); return v; }), v => v);
    const operations = unique(array(p.operations, 5, v => {
      if (!(COMPILATION_OPERATIONS as readonly unknown[]).includes(v)) throw invalid(); return v as CompilationOperation;
    }), v => v);
    return { id: p.id as string, ruleVersion: p.ruleVersion as string, sources, outputPaths, runtimeIds, operations };
  }), p => p.id);
  return { version: 1, enabled: raw.enabled, accountId: raw.accountId, projects };
}

/** Admission is metadata-only and emits no rejected path, title, count or department. */
export function inspectCompilationPolicy(params: { config?: CompilationConfig; projectId: string; principal?: ScopePrincipal;
  access: ScopeAccessPolicy; paths: string[]; outputPath: string; operation: CompilationOperation; runtime?: CompilationRuntime }): CompilationAdmission {
  const { config, principal, access, runtime, operation } = params;
  if (!config?.enabled) return { status: 'diagnostic_only' };
  if (!principal || principal.accountId !== config.accountId || !principal.capabilities?.includes('write')) return { status: 'unavailable' };
  const project = config.projects.find(p => p.id === params.projectId);
  if (!project || !project.operations.includes(operation) || !params.paths.length || params.paths.length > 8) return { status: 'unavailable' };
  let paths: string[], output: string;
  try { paths = params.paths.map(compilationPath); output = compilationPath(params.outputPath); } catch { return { status: 'unavailable' }; }
  const policies = paths.map(path => project.sources.find(s => s.path === path));
  if (policies.some(p => !p) || !project.outputPaths.includes(output)
    || ![...paths, output].every(path => access.canAccessPhysicalPath(path, principal, false))) return { status: 'unavailable' };
  if (policies.some(p => p!.classification !== 'resolved' || operation === 'synthesize' && p!.mode !== 'synthesis_allowed')) return { status: 'review_required' };
  if (!runtime || !id(runtime.id) || typeof runtime.revision !== 'string' || !runtime.revision || runtime.revision.length > 200
    || !project.runtimeIds.includes(runtime.id) || !runtime.operations.includes(operation)
    || paths.some(path => access.isConfidentialDocument(path)) && runtime.local !== true) return { status: 'waiting_runtime' };
  const basis = { account: principal.accountId, model: principal.modelId,
    agent: principal.agentId, user: principal.userId, center: principal.commandCenterId, capabilities: principal.capabilities,
    enterprise: principal.enterprise, project: { id: project.id, ruleVersion: project.ruleVersion },
    sources: policies, output, operation, runtime, restrictions: access.documentDependencyFingerprint(paths) };
  return { status: 'ready', sourceFingerprint: compilationHash(basis),
    fingerprint: compilationHash({ basis, outputRestrictions: access.documentDependencyFingerprint([output]) }) };
}
