import { guidanceError } from './guidance-runtime.js';
/** Pure declarative validation shared by skills, learning paths and procedural bundles.
 * A valid selection describes configuration only; it never grants host permissions. */
import { createHash } from 'node:crypto';
export interface CapabilityNode { id: string; requires: string[]; excludes: string[]; cost: number }
export function configId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value) || ['constructor', 'prototype'].includes(value)) throw guidanceError(new Error('Invalid configuration id'), 'guid-655b11bf293942fc');
  return value;
}
export function configKeys(value: any, allowed: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(k => !allowed.includes(k))) throw guidanceError(new Error('Unknown declarative configuration field'), 'guid-64bd8730ba0c4318');
}
export function configNumber(value: unknown, min = 0, max = 1000): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw guidanceError(new Error('Configuration number outside bounds'), 'guid-29c01c01fd9d083d');
  return value;
}
export function configIds(value: unknown, max = 128): string[] {
  if (!Array.isArray(value) || value.length > max) throw guidanceError(new Error('Configuration list outside bounds'), 'guid-86d5bf656dde329d');
  const ids = value.map(configId);
  if (new Set(ids).size !== ids.length) throw guidanceError(new Error('Duplicate configuration id'), 'guid-dc1dbd7e445523b3');
  return ids;
}
export function validateCapabilityGraph(input: unknown): CapabilityNode[] {
  if (!Array.isArray(input) || input.length > 128) throw guidanceError(new Error('Capability graph outside bounds'), 'guid-78e502405f4caa68');
  const nodes = input.map(n => { configKeys(n, ['id', 'requires', 'excludes', 'cost']); return { id: configId(n.id), requires: configIds(n.requires, 16), excludes: configIds(n.excludes, 16), cost: configNumber(n.cost) }; });
  const map = new Map(nodes.map(n => [n.id, n]));
  if (map.size !== nodes.length) throw guidanceError(new Error('Duplicate capability id'), 'guid-cf3388eefb9b5b53');
  const visiting = new Set<string>(), done = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) throw guidanceError(new Error('Capability prerequisite cycle'), 'guid-33cac9cfaee5fbda');
    if (done.has(id)) return;
    const node = map.get(id); if (!node) throw guidanceError(new Error('Missing capability reference'), 'guid-70b5f9313f01855b');
    if (node.excludes.some(e => e === id || !map.has(e))) throw guidanceError(new Error('Invalid capability exclusion'), 'guid-8a5af0a52e81bc64');
    visiting.add(id); node.requires.forEach(visit); visiting.delete(id); done.add(id);
  }
  nodes.forEach(n => visit(n.id));
  return nodes;
}
export function validateCapabilitySelection(nodes: CapabilityNode[], input: unknown): string[] {
  const graph = validateCapabilityGraph(nodes), selected = configIds(input), map = new Map(graph.map(n => [n.id, n]));
  for (const id of selected) {
    const n = map.get(id); if (!n) throw guidanceError(new Error('Unknown capability'), 'guid-c42396efe2f153e4');
    if (n.requires.some(r => !selected.includes(r))) throw guidanceError(new Error('Missing capability prerequisite'), 'guid-e492214fb016e14b');
    if (n.excludes.some(e => selected.includes(e))) throw guidanceError(new Error('Capability exclusion conflict'), 'guid-39b32bd203039bdc');
  }
  return selected;
}
export function capabilityRemoval(nodes: CapabilityNode[], learned: string[], requested: unknown): string[] {
  validateCapabilitySelection(nodes, learned);
  const remove = new Set(configIds(requested));
  if ([...remove].some(id => !learned.includes(id))) throw guidanceError(new Error('Cannot remove unlearned capability'), 'guid-555213b31804c22c');
  let changed = true;
  while (changed) { changed = false; for (const n of nodes) if (learned.includes(n.id) && !remove.has(n.id) && n.requires.some(r => remove.has(r))) { remove.add(n.id); changed = true; } }
  return learned.filter(id => remove.has(id));
}

export interface CapabilityConfigurationCheck {
  kind: 'learning-path' | 'procedural-bundle'; id: string; version: string; valid: true;
  nodeCount: number; selectedCount: number; totalCost: number; fingerprint: string;
  executable: false; permissionsGranted: false;
}
/** Input is exactly {id, version, nodes: CapabilityNode[], selected: string[]}.
 * Return only a compact validation summary, never source bodies or executable steps. */
function checkConfiguration(kind: CapabilityConfigurationCheck['kind'], input: unknown): CapabilityConfigurationCheck {
  const value = input as Record<string, unknown>;
  configKeys(value, ['id', 'version', 'nodes', 'selected']);
  const id = configId(value.id), version = value.version;
  if (typeof version !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version)) throw guidanceError(new Error('Exact configuration version required'), 'guid-89ef72974f5e2d71');
  const graph = validateCapabilityGraph(value.nodes), selected = validateCapabilitySelection(graph, value.selected).sort();
  const nodes = graph.map(n => ({ id: n.id, requires: [...n.requires].sort(), excludes: [...n.excludes].sort(), cost: n.cost })).sort((a, b) => a.id < b.id ? -1 : 1);
  const fingerprint = createHash('sha256').update(JSON.stringify({ kind, id, version, nodes, selected })).digest('hex');
  return { kind, id, version, valid: true, nodeCount: nodes.length, selectedCount: selected.length,
    totalCost: nodes.filter(n => selected.includes(n.id)).reduce((sum, n) => sum + n.cost, 0), fingerprint, executable: false, permissionsGranted: false };
}
export function validateLearningPathConfiguration(input: unknown): CapabilityConfigurationCheck { return checkConfiguration('learning-path', input); }
export function validateProceduralBundleConfiguration(input: unknown): CapabilityConfigurationCheck { return checkConfiguration('procedural-bundle', input); }
