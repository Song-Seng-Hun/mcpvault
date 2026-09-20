import { guidanceError } from './guidance-runtime.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ScopePrincipal } from './scope-auth.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import { documentPolicyPath } from './document-authority.js';

interface DocumentContext { access: ScopeAccessPolicy; principal?: ScopePrincipal; assertFresh: () => void;
  observe?: (policyRoot: string) => void;
  inherit?: (target: string) => Promise<void>;
  canAccessPath?: (path: string) => boolean;
  canTraversePath?: (path: string) => boolean;
  beforeWrite?: (path: string) => Promise<void> }
interface StorageContext extends DocumentContext { publicCommunityWriter?: boolean; documentContext?: DocumentContext }
const context = new AsyncLocalStorage<StorageContext>();
interface PublicationStage { owner: string; paths: ReadonlySet<string>; active: boolean; parent: PublicationStage | undefined }
const publicationStage = new AsyncLocalStorage<PublicationStage>();

/** Code-owned publication adapter only. This is not a principal or an ACL
 * grant: it permits its exact pending outputs while all normal rules remain.
 * Revocation on return also closes leaked/delayed async continuations. */
export async function withPublicationStaging<T>(owner: string, paths: readonly string[], operation: () => Promise<T>): Promise<T> {
  if (!/^[a-f0-9]{64}$/.test(owner) || !paths.length || paths.length > 8) throw guidanceError(Error('Invalid publication stage'), 'guid-7700f2c94fdd8c31');
  const value: PublicationStage = { owner, paths: new Set(paths.map(documentPolicyPath)), active: true, parent: publicationStage.getStore() };
  try { return await publicationStage.run(value, operation); } finally { value.active = false; }
}
export function allowsStagedPublication(owner: string, path: string): boolean {
  let stage = publicationStage.getStore(); if (!stage) return false;
  for (; stage; stage = stage.parent) if (!stage.active || stage.owner !== owner || !stage.paths.has(documentPolicyPath(path))) return false;
  return true;
}

export function withEnterpriseStorageContext<T>(value: StorageContext, operation: () => T): T {
  // Privileged service-internal counter reads may change enterprise context,
  // but may never shed the caller's confidential document boundary.
  const outer = context.getStore()?.documentContext;
  const layerAllowsTraversal = (layer: DocumentContext, path: string) =>
    layer.canAccessPath?.(path) !== false || layer.canTraversePath?.(path) === true;
  const narrowed = outer ? {
    ...outer,
    assertFresh: () => { outer.assertFresh(); value.assertFresh(); },
    canAccessPath: (path: string) => outer.canAccessPath?.(path) !== false && value.canAccessPath?.(path) !== false,
    canTraversePath: (path: string) => layerAllowsTraversal(outer, path) && layerAllowsTraversal(value, path),
    ...(outer.observe || value.observe ? { observe: (path: string) => { outer.observe?.(path); value.observe?.(path); } } : {}),
    ...(outer.inherit || value.inherit ? { inherit: async (path: string) => { await outer.inherit?.(path); await value.inherit?.(path); } } : {}),
    ...(outer.beforeWrite || value.beforeWrite ? { beforeWrite: async (path: string) => { await outer.beforeWrite?.(path); await value.beforeWrite?.(path); } } : {}),
  } : value;
  return context.run({ ...value, documentContext: narrowed }, operation);
}

export function activeDocumentStorageContext() { return context.getStore()?.documentContext; }

/** Every serialized body write passes this before the final physical guard. */
export async function prepareDocumentWrite(path: string): Promise<void> {
  const document = activeDocumentStorageContext();
  document?.assertFresh();
  await document?.beforeWrite?.(path);
  document?.assertFresh();
  await document?.inherit?.(path);
  document?.assertFresh();
}

export function assertEnterpriseStorageFresh(): void {
  const current = context.getStore();
  if (current?.documentContext?.access.hasDocumentPolicy()) current.documentContext.assertFresh();
  if (current?.access.getEnterpriseProfile()) current.assertFresh();
}

/** recordSource=false is for internal filename discovery only. Every physical
 * read and exposed metadata row still uses the default observing check. */
export function canReadEnterpriseStoragePath(path: string, recordSource = true): boolean {
  const current = context.getStore();
  if (current?.documentContext?.canAccessPath?.(path) === false) return false;
  if (current?.documentContext && !current.documentContext.access.canReadProtectedDocument(path, current.documentContext.principal, recordSource)) return false;
  if (!current?.access.getEnterpriseProfile()) return true;
  current.assertFresh();
  return current.access.canAccessPhysicalPath(path, current.principal, recordSource);
}

/** Directory enumeration only. The caller must first establish that the
 * physical entry is a directory. Never use this for body IO or writes. */
export function canTraverseEnterpriseStoragePath(path: string, recordSource = true): boolean {
  const current = context.getStore();
  if (current?.documentContext?.canAccessPath?.(path) === false
    && current.documentContext.canTraversePath?.(path) !== true) return false;
  if (current?.documentContext) {
    current.documentContext.assertFresh();
    if (!current.documentContext.access.canReadProtectedDocument(path, current.documentContext.principal, recordSource)) return false;
  }
  if (!current?.access.getEnterpriseProfile()) return true;
  current.assertFresh();
  return current.access.canAccessPhysicalPath(path === '.' ? '' : path, current.principal, recordSource);
}

/** Optional-activity guard for trusted storage adapters whose root is not an
 * enterprise scope. Call only with a canonical logical Vault path. */
export function assertOwnerActivityStorageAccess(path: string): void {
  const document = activeDocumentStorageContext();
  document?.assertFresh();
  if (document?.canAccessPath?.(path) === false) throw guidanceError(new Error('Access denied: owner activity data scope unavailable'), 'guid-c0c9e18369c559ac');
}

/** Refresh owner consent before an optional adapter performs its physical write. */
export async function prepareOwnerActivityStorageWrite(path: string): Promise<void> {
  const document = activeDocumentStorageContext();
  document?.assertFresh();
  await document?.beforeWrite?.(path);
  assertOwnerActivityStorageAccess(path);
}

/** A second boundary at physical IO protects service-internal reads and writes. */
export function assertEnterpriseStorageAccess(path: string, write = false): void {
  const current = context.getStore();
  if (current?.documentContext?.canAccessPath?.(path) === false) throw guidanceError(new Error('Access denied: owner activity data scope unavailable'), 'guid-c0c9e18369c559ac');
  if (current?.documentContext?.access.hasDocumentPolicy()) {
    current.documentContext.assertFresh();
    if (!current.documentContext.access.canReadProtectedDocument(path, current.documentContext.principal)) throw guidanceError(new Error('Access denied: protected document unavailable'), 'guid-5f2a63e873739df9');
  }
  if (!current?.access.getEnterpriseProfile()) return;
  current.assertFresh();
  if (!current.access.canAccessPhysicalPath(path, current.principal)) throw guidanceError(new Error('Access denied: enterprise resource unavailable'), 'guid-2bd7b875156d94ee');
  if (write && /^publiccommunity(?:\/|$)/i.test(path.replace(/\\/g, '/')) && !current.publicCommunityWriter) {
    throw guidanceError(new Error('Managed public community writes require a dedicated community operation'), 'guid-9547ed46542e6dac');
  }
  if (write && current.access.getEnterpriseProfile()!.mode === 'company') {
    const p = path.replace(/\\/g, '/').toLowerCase();
    if (!p.startsWith('community/') && !p.startsWith('_scopes/') && !p.startsWith('_whispers/')) {
      throw guidanceError(new Error('Company agents cannot write public Global material; use the administrator export workflow'), 'guid-3ba0b1a806d118bc');
    }
  }
}
