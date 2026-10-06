import { guidanceText } from './guidance-runtime.js';
import type { EndpointAvailabilityContext, EndpointDescriptor } from './endpoint-registry.js';
import type { ScopeCapability } from './scope-auth.js';

type ReadPolicy = 'public' | 'authenticated' | 'skill-preview';
interface ReadOperation { alias: string; policy: ReadPolicy }
interface OperationContract {
  defaultOp?: string;
  reads: Readonly<Record<string, ReadOperation>>;
  summary: ReadPolicy | 'write';
}
const reads = (alias: string, policy: ReadPolicy, ...ops: string[]): Record<string, ReadOperation> =>
  Object.fromEntries(ops.map(op => [op, { alias, policy }]));

/** Code-owned mixed-operation contracts, not an authorization or plugin registry.
 * Schemas still own valid writes; services still own all final domain guards. */
const CONTRACTS: Readonly<Record<string, OperationContract>> = {
  get_evolution_context: { defaultOp: 'read', summary: 'authenticated', reads: reads('read_evolution_context', 'authenticated', 'read', 'observations') },
  manage_evolution_feedback: { defaultOp: 'read', summary: 'authenticated', reads: reads('read_evolution_feedback', 'authenticated', 'read') },
  manage_evolution_cycle: { defaultOp: 'diagnose', summary: 'public', reads: {
    ...reads('read_evolution_cycle', 'public', 'diagnose'), ...reads('read_evolution_cycle', 'authenticated', 'read', 'list', 'preview'),
  } },
  manage_wiki_compilation: { defaultOp: 'diagnose', summary: 'public', reads: {
    ...reads('read_wiki_compilation', 'public', 'diagnose'), ...reads('read_wiki_compilation', 'authenticated', 'read', 'split_preview'),
  } },
  manage_skill_candidate: { defaultOp: 'read', summary: 'public', reads: reads('read_skill_candidate', 'public', 'read', 'list') },
  evaluate_skill: { defaultOp: 'read', summary: 'public', reads: reads('read_skill_evaluation', 'public', 'read') },
  promote_skill: { defaultOp: 'preview', summary: 'skill-preview', reads: reads('preview_skill_promotion', 'skill-preview', 'preview') },
  rollback_skill: { defaultOp: 'preview', summary: 'skill-preview', reads: reads('preview_skill_rollback', 'skill-preview', 'preview') },
  manage_work_project: { defaultOp: 'read', summary: 'public', reads: reads('read_work_project', 'public', 'read') },
  manage_work_group: { defaultOp: 'read', summary: 'public', reads: reads('read_work_group', 'public', 'read') },
};

export function operationReadAlias(tool: string, op: unknown): string | undefined {
  const contract = Object.hasOwn(CONTRACTS, tool) ? CONTRACTS[tool] : undefined;
  const selected = op === undefined ? contract?.defaultOp : op;
  return contract && typeof selected === 'string' && Object.hasOwn(contract.reads, selected)
    ? contract.reads[selected]!.alias : undefined;
}

type Availability = NonNullable<EndpointDescriptor['operations']>[string];
export function operationAvailability(item: EndpointDescriptor, context: EndpointAvailabilityContext, baseWrite: Availability):
  (Availability & { operations: Record<string, Availability> }) | undefined {
  const contract = Object.hasOwn(CONTRACTS, item.toolName) ? CONTRACTS[item.toolName] : undefined;
  if (!contract) return;
  const authority = (requires: string[], disabled = false): Availability => {
    const missing = requires.filter(cap => !context.capabilities.has(cap as ScopeCapability));
    const available = !disabled && context.authenticated && !missing.length;
    const reason = disabled ? 'server is read-only' : !context.authenticated ? 'authentication required'
      : missing.length ? `capability required: ${missing.join(', ')}` : undefined;
    return { available, state: disabled ? 'disabled' : available ? 'ready' : 'locked', requires, ...(reason && { reason }) };
  };
  const publicRead: Availability = { available: true, state: 'ready', requires: [] };
  const disabled = (requires: string[], reason: string): Availability => ({ available: false, state: 'disabled', requires, reason });
  const read = (policy: ReadPolicy): Availability => {
    const hostDisabled = context.skillEvolutionEnabled === false && item.endpointId.startsWith('skill.');
    if (hostDisabled && baseWrite.state === 'disabled') return baseWrite;
    switch (policy) {
      case 'public': return publicRead;
      case 'authenticated': return { available: context.authenticated, state: context.authenticated ? 'ready' : 'locked', requires: ['authentication'],
        ...(!context.authenticated && { reason: guidanceText('guid-d85901f74db50a43', 'authentication required') }) };
      case 'skill-preview': return context.skillEvolutionEnabled === false
        ? disabled(item.requires, 'skill evolution is disabled by the host') : authority(item.requires);
    }
  };
  const write = baseWrite;
  const properties = item.input.properties as { op?: { enum?: string[] } } | undefined;
  const ops = properties?.op?.enum ?? Object.keys(contract.reads);
  return { ...(contract.summary === 'write' ? write : read(contract.summary)),
    operations: Object.fromEntries(ops.map(op => [op, Object.hasOwn(contract.reads, op) ? read(contract.reads[op]!.policy) : write])) };
}
