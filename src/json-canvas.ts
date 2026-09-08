import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';

export type WikiCanvasMode = 'moc' | 'neighborhood' | 'workshop';

export interface WikiCanvasNote {
  path: string;
  publicPath: string;
  revision: string;
  title: string;
  role: 'root' | 'moc_entry' | 'neighbor';
  depth?: number;
  authoredPosition?: number;
  stage?: number | undefined;
  reasons?: string[];
}

export interface WikiCanvasEdge {
  fromPath: string;
  toPath: string;
  label: string;
  kind: 'authored' | 'dependency' | 'direct_link' | 'backlink' | 'proximity';
}

/** A structured workshop map item. sourcePath is only used for revision-safe
 * selection; it is never copied into the emitted Canvas text. */
export interface WikiCanvasWorkshopMapNode {
  id: string;
  label: string;
  sourcePath: string;
}

export interface WikiCanvasWorkshopMapEdge {
  fromId: string;
  toId: string;
  label?: string;
}

export type JsonCanvasNode = {
  id: string;
  type: 'file' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string | undefined;
  file?: string;
  text?: string;
};

export type JsonCanvasEdge = {
  id: string;
  fromNode: string;
  fromSide?: 'top' | 'right' | 'bottom' | 'left';
  fromEnd?: 'none' | 'arrow';
  toNode: string;
  toSide?: 'top' | 'right' | 'bottom' | 'left';
  toEnd?: 'none' | 'arrow';
  color?: string;
  label?: string;
};

export interface JsonCanvasDocument {
  nodes: JsonCanvasNode[];
  edges: JsonCanvasEdge[];
}

export interface WikiCanvasSnapshotMetadata {
  kind: 'mcpvault-derived-canvas';
  version: 1;
  mode: WikiCanvasMode;
  rootNodeId: string;
  snapshotFingerprint: string;
  revisions: Record<string, string>;
}

const METADATA_PREFIX = '<!-- mcpvault-canvas:';
const METADATA_SUFFIX = ' -->';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canvasFileNodeId(path: string): string {
  return `note-${digest(path.toLowerCase()).slice(0, 32)}`;
}

function boundedLabel(value: string): string {
  return Array.from(String(value || '').replace(/[\r\n]+/g, ' ').trim()).slice(0, 64).join('') || 'related';
}

function neighborhoodTier(reasons: string[]): number {
  if (reasons.some(reason => reason === 'direct_link' || reason === 'backlink')) return 1;
  if (reasons.some(reason => reason === 'shared_source' || reason === 'shared_moc' || reason === 'shared_project')) return 2;
  if (reasons.some(reason => reason === 'shared_task_context' || reason === 'shared_tag')) return 3;
  return 4;
}

function noteColor(note: WikiCanvasNote): string | undefined {
  if (note.role === 'root') return '6';
  if (note.reasons?.some(reason => reason === 'direct_link' || reason === 'backlink')) return '4';
  if (note.reasons?.includes('shared_source')) return '5';
  if (note.reasons?.includes('semantic_match')) return '3';
  return undefined;
}

/**
 * Build a deterministic JSON Canvas projection. Positions and IDs derive only
 * from the selected paths/order so exporting an unchanged snapshot does not
 * manufacture a noisy file revision.
 */
export function buildJsonCanvasProjection(input: {
  mode: WikiCanvasMode;
  notes: WikiCanvasNote[];
  edges: WikiCanvasEdge[];
  workshopMap?: { nodes: WikiCanvasWorkshopMapNode[]; edges: WikiCanvasWorkshopMapEdge[] };
}): { canvas: JsonCanvasDocument; snapshotFingerprint: string } {
  if (!input.notes.length || input.notes[0]!.role !== 'root') throw guidanceError(new Error('Canvas projection requires one root note first'), 'guid-8215839d11fe2918');
  const notes: WikiCanvasNote[] = [];
  const seenPaths = new Set<string>();
  for (const note of input.notes) {
    const key = note.path.toLowerCase();
    if (!note.path || !note.revision || seenPaths.has(key)) continue;
    seenPaths.add(key);
    notes.push(note);
  }
  const nodeIds = new Map(notes.map(note => [note.path.toLowerCase(), canvasFileNodeId(note.path)]));
  const acceptedEdges: WikiCanvasEdge[] = [];
  const seenEdges = new Set<string>();
  for (const edge of input.edges) {
    const from = edge.fromPath.toLowerCase();
    const to = edge.toPath.toLowerCase();
    if (from === to || !nodeIds.has(from) || !nodeIds.has(to)) continue;
    const key = `${from}\u0000${to}\u0000${edge.kind}\u0000${boundedLabel(edge.label).toLowerCase()}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    acceptedEdges.push({ ...edge, label: boundedLabel(edge.label) });
  }
  const workshopNodes: WikiCanvasWorkshopMapNode[] = [];
  const workshopNodeIds = new Map<string, string>();
  if (input.mode === 'workshop') {
    for (const node of input.workshopMap?.nodes || []) {
      const id = String(node.id || '').trim();
      const label = Array.from(String(node.label || '').replace(/[\r\n]+/g, ' ').trim()).slice(0, 160).join('');
      if (!id || !label || workshopNodeIds.has(id)) continue;
      workshopNodes.push({ id, label, sourcePath: String(node.sourcePath || '') });
      workshopNodeIds.set(id, `workshop-${digest(id).slice(0, 24)}`);
    }
  }
  const workshopEdges: WikiCanvasWorkshopMapEdge[] = [];
  const seenWorkshopEdges = new Set<string>();
  for (const edge of input.mode === 'workshop' ? (input.workshopMap?.edges || []) : []) {
    const fromId = String(edge.fromId || '').trim(), toId = String(edge.toId || '').trim();
    if (!fromId || !toId || fromId === toId || !workshopNodeIds.has(fromId) || !workshopNodeIds.has(toId)) continue;
    const label = boundedLabel(edge.label || 'relates to');
    const key = `${fromId}\u0000${toId}\u0000${label.toLowerCase()}`;
    if (seenWorkshopEdges.has(key)) continue;
    seenWorkshopEdges.add(key);
    workshopEdges.push({ fromId, toId, label });
  }
  const snapshotFingerprint = digest(JSON.stringify({
    mode: input.mode,
    notes: notes.map(note => ({ path: note.path, revision: note.revision, role: note.role, depth: note.depth, authoredPosition: note.authoredPosition, stage: note.stage, reasons: note.reasons })),
    edges: acceptedEdges,
    ...(input.mode === 'workshop' && { workshopMap: workshopNodes.map(node => ({ id: node.id, label: node.label, sourcePath: node.sourcePath })), workshopEdges }),
  }));
  const snapshotMetadata: WikiCanvasSnapshotMetadata = {
    kind: 'mcpvault-derived-canvas',
    version: 1,
    mode: input.mode,
    rootNodeId: nodeIds.get(notes[0]!.path.toLowerCase())!,
    snapshotFingerprint,
    revisions: Object.fromEntries(notes.map(note => [nodeIds.get(note.path.toLowerCase())!, note.revision])),
  };

  const rowsByTier = new Map<number, number>();
  const fileNodes = notes.map((note, index): JsonCanvasNode => {
    if (note.role === 'root') {
      const entryCount = Math.max(1, notes.length - 1);
      return { id: nodeIds.get(note.path.toLowerCase())!, type: 'file', x: 0, y: Math.max(0, Math.floor((entryCount - 1) * 130)), width: 360, height: 220, color: '6', file: note.path };
    }
    if (input.mode === 'moc') {
      const depth = Math.max(0, Number(note.depth) || 0);
      const position = Math.max(1, Number(note.authoredPosition) || index);
      return { id: nodeIds.get(note.path.toLowerCase())!, type: 'file', x: (depth + 1) * 500, y: (position - 1) * 260, width: 360, height: 220, ...(noteColor(note) && { color: noteColor(note) }), file: note.path };
    }
    if (input.mode === 'workshop') {
      return { id: nodeIds.get(note.path.toLowerCase())!, type: 'file', x: 480, y: (index - 1) * 260, width: 360, height: 220, file: note.path };
    }
    const tier = neighborhoodTier(note.reasons || []);
    const row = rowsByTier.get(tier) || 0;
    rowsByTier.set(tier, row + 1);
    return { id: nodeIds.get(note.path.toLowerCase())!, type: 'file', x: tier * 500, y: row * 260, width: 360, height: 220, ...(noteColor(note) && { color: noteColor(note) }), file: note.path };
  });

  const legend: JsonCanvasNode = {
    id: `meta-${snapshotFingerprint.slice(0, 16)}`,
    type: 'text',
    x: -520,
    y: 0,
    width: 420,
    height: 220,
    color: '5',
    text: [
      `${METADATA_PREFIX}${JSON.stringify(snapshotMetadata)}${METADATA_SUFFIX}`,
      '# MCPVault spatial view',
      '',
      `- mode: ${input.mode}`,
      `- root: ${notes[0]!.publicPath}`,
      `- source fingerprint: \`${snapshotFingerprint.slice(0, 20)}\``,
      '',
      'Derived from current Markdown. Regenerate before relying on an old layout; the Canvas is navigation, not evidence or an access boundary.',
    ].join('\n'),
  };
  const mapTextNodes: JsonCanvasNode[] = workshopNodes.map((node, index) => ({
    id: workshopNodeIds.get(node.id)!, type: 'text', x: 980 + Math.floor(index / 8) * 340, y: (index % 8) * 150,
    width: 280, height: 110, color: '4', text: node.label,
  }));
  const canvasEdges: JsonCanvasEdge[] = acceptedEdges.map(edge => {
    const id = `edge-${digest(`${edge.fromPath}\u0000${edge.toPath}\u0000${edge.kind}\u0000${edge.label}`).slice(0, 16)}`;
    const reverse = edge.kind === 'backlink';
    return {
      id,
      fromNode: nodeIds.get(edge.fromPath.toLowerCase())!,
      fromSide: reverse ? 'left' : 'right',
      fromEnd: 'none',
      toNode: nodeIds.get(edge.toPath.toLowerCase())!,
      toSide: reverse ? 'right' : 'left',
      toEnd: 'arrow',
      ...(edge.kind === 'dependency' && { color: '2' }),
      ...(edge.kind === 'proximity' && { color: '3' }),
      label: edge.label,
    };
  });
  for (const edge of workshopEdges) {
    canvasEdges.push({
      id: `workshop-edge-${digest(`${edge.fromId}\u0000${edge.toId}\u0000${edge.label}`).slice(0, 16)}`,
      fromNode: workshopNodeIds.get(edge.fromId)!, fromSide: 'right', fromEnd: 'none',
      toNode: workshopNodeIds.get(edge.toId)!, toSide: 'left', toEnd: 'arrow', color: '4', ...(edge.label !== undefined && { label: edge.label }),
    });
  }
  // JSON Canvas uses array order as z-order: the legend is behind files and
  // the selected root is last/on top.
  const rootNode = fileNodes.shift()!;
  const canvas = { nodes: [legend, ...mapTextNodes, ...fileNodes, rootNode], edges: canvasEdges };
  validateJsonCanvasDocument(canvas);
  return { canvas, snapshotFingerprint };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Read MCPVault snapshot metadata from an otherwise standard text node. */
export function readJsonCanvasMetadata(value: unknown): WikiCanvasSnapshotMetadata | undefined {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return undefined;
  let encoded: string | undefined;
  for (const raw of value.nodes) {
    if (!isRecord(raw) || raw.type !== 'text' || typeof raw.text !== 'string') continue;
    const start = raw.text.indexOf(METADATA_PREFIX);
    if (start < 0) continue;
    const payloadStart = start + METADATA_PREFIX.length;
    const end = raw.text.indexOf(METADATA_SUFFIX, payloadStart);
    if (end < 0) throw guidanceError(new Error('MCPVault Canvas metadata marker is incomplete'), 'guid-e4bc7f735a35ad26');
    if (raw.text.indexOf(METADATA_PREFIX, end + METADATA_SUFFIX.length) >= 0) throw guidanceError(new Error('MCPVault Canvas metadata marker must be unique'), 'guid-d393a1e88f5087a5');
    if (encoded !== undefined) throw guidanceError(new Error('MCPVault Canvas metadata marker must be unique'), 'guid-d393a1e88f5087a5');
    encoded = raw.text.slice(payloadStart, end);
  }
  if (encoded === undefined) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(encoded); }
  catch { throw guidanceError(new Error('MCPVault Canvas metadata must contain valid JSON'), 'guid-b542afe70adf9fcb'); }
  if (!isRecord(parsed) || parsed.kind !== 'mcpvault-derived-canvas' || parsed.version !== 1) throw guidanceError(new Error('Unsupported MCPVault Canvas metadata'), 'guid-3ea00c15cb369ab6');
  if (!['moc', 'neighborhood', 'workshop'].includes(String(parsed.mode || ''))) throw guidanceError(new Error('MCPVault Canvas metadata has an invalid mode'), 'guid-d1ac2ddd0358dba0');
  if (typeof parsed.rootNodeId !== 'string' || !parsed.rootNodeId || parsed.rootNodeId.length > 128) throw guidanceError(new Error('MCPVault Canvas metadata has an invalid root node'), 'guid-89dd21f551dc1f8d');
  if (typeof parsed.snapshotFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.snapshotFingerprint)) throw guidanceError(new Error('MCPVault Canvas metadata has an invalid fingerprint'), 'guid-b7b54f05e764d4af');
  if (!isRecord(parsed.revisions)) throw guidanceError(new Error('MCPVault Canvas metadata must contain revision guards'), 'guid-cdb5d645897160bc');
  const revisions = Object.entries(parsed.revisions);
  if (revisions.length < 1 || revisions.length > 100) throw guidanceError(new Error('MCPVault Canvas metadata has an invalid revision count'), 'guid-1d4080ed06563040');
  const fileIds = new Set(value.nodes.filter(isRecord).filter(node => node.type === 'file').map(node => String(node.id || '')));
  const normalizedRevisions: Record<string, string> = {};
  for (const [nodeId, revision] of revisions) {
    if (!nodeId || nodeId.length > 128 || !fileIds.has(nodeId)) throw guidanceError(new Error('MCPVault Canvas metadata references a missing file node'), 'guid-58b4954933774f87');
    if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) throw guidanceError(new Error('MCPVault Canvas metadata has an invalid source revision'), 'guid-527d7f00a065cfc5');
    normalizedRevisions[nodeId] = revision;
  }
  if (!normalizedRevisions[parsed.rootNodeId]) throw guidanceError(new Error('MCPVault Canvas metadata root has no revision guard'), 'guid-2c6f37624631bf01');
  return {
    kind: 'mcpvault-derived-canvas',
    version: 1,
    mode: parsed.mode as WikiCanvasMode,
    rootNodeId: parsed.rootNodeId,
    snapshotFingerprint: parsed.snapshotFingerprint,
    revisions: normalizedRevisions,
  };
}

/** Validate the bounded subset of JSON Canvas 1.0 that MCPVault emits. */
export function validateJsonCanvasDocument(value: unknown): asserts value is JsonCanvasDocument {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw guidanceError(new Error('Canvas must contain nodes and edges arrays'), 'guid-a4c4142f3000e80d');
  if (value.nodes.length > 101 || value.edges.length > 300) throw guidanceError(new Error('Canvas exceeds the bounded node or edge limit'), 'guid-8dbdbf3911b8e3ed');
  const ids = new Set<string>();
  for (const raw of value.nodes) {
    if (!isRecord(raw)) throw guidanceError(new Error('Canvas nodes must be objects'), 'guid-0740939e4976f1c4');
    const id = String(raw.id || '');
    const type = String(raw.type || '');
    if (!id || ids.has(id)) throw guidanceError(new Error('Canvas node IDs must be non-empty and unique'), 'guid-28558cc8806d7258');
    ids.add(id);
    if (!['file', 'text'].includes(type)) throw guidanceError(new Error(`Unsupported Canvas node type: ${type}`), 'guid-3ae36c90f6cd5560');
    for (const field of ['x', 'y', 'width', 'height']) if (!Number.isInteger(raw[field])) throw guidanceError(new Error(`Canvas node ${field} must be an integer`), 'guid-0b460bdd5a63cd5e');
    if (Number(raw.width) <= 0 || Number(raw.height) <= 0) throw guidanceError(new Error('Canvas node dimensions must be positive'), 'guid-aa9884e6508cb45c');
    if (type === 'file' && (typeof raw.file !== 'string' || !raw.file.trim() || raw.file.length > 1000)) throw guidanceError(new Error('Canvas file nodes require a bounded file path'), 'guid-ba5975f2474421f7');
    if (type === 'text' && (typeof raw.text !== 'string' || raw.text.length > 12000)) throw guidanceError(new Error('Canvas text nodes require bounded text'), 'guid-44bb2b1cdd59de3b');
  }
  const edgeIds = new Set<string>();
  for (const raw of value.edges) {
    if (!isRecord(raw)) throw guidanceError(new Error('Canvas edges must be objects'), 'guid-32c58b53b3347434');
    const id = String(raw.id || '');
    const from = String(raw.fromNode || '');
    const to = String(raw.toNode || '');
    if (!id || edgeIds.has(id)) throw guidanceError(new Error('Canvas edge IDs must be non-empty and unique'), 'guid-9b7b0c87c6c6b599');
    edgeIds.add(id);
    if (!ids.has(from) || !ids.has(to) || from === to) throw guidanceError(new Error('Canvas edges must connect two different existing nodes'), 'guid-241e403dd51c20e0');
    if (raw.label !== undefined && (typeof raw.label !== 'string' || raw.label.length > 64)) throw guidanceError(new Error('Canvas edge labels must be bounded text'), 'guid-94d9dcafc53f2687');
  }
}
