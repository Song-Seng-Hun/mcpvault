import { createHash } from 'node:crypto';

export type WikiCanvasMode = 'moc' | 'neighborhood';

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
}): { canvas: JsonCanvasDocument; snapshotFingerprint: string } {
  if (!input.notes.length || input.notes[0]!.role !== 'root') throw new Error('Canvas projection requires one root note first');
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
  const snapshotFingerprint = digest(JSON.stringify({
    mode: input.mode,
    notes: notes.map(note => ({ path: note.path, revision: note.revision, role: note.role, depth: note.depth, authoredPosition: note.authoredPosition, stage: note.stage, reasons: note.reasons })),
    edges: acceptedEdges,
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
  // JSON Canvas uses array order as z-order: the legend is behind files and
  // the selected root is last/on top.
  const rootNode = fileNodes.shift()!;
  const canvas = { nodes: [legend, ...fileNodes, rootNode], edges: canvasEdges };
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
    if (end < 0) throw new Error('MCPVault Canvas metadata marker is incomplete');
    if (raw.text.indexOf(METADATA_PREFIX, end + METADATA_SUFFIX.length) >= 0) throw new Error('MCPVault Canvas metadata marker must be unique');
    if (encoded !== undefined) throw new Error('MCPVault Canvas metadata marker must be unique');
    encoded = raw.text.slice(payloadStart, end);
  }
  if (encoded === undefined) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(encoded); }
  catch { throw new Error('MCPVault Canvas metadata must contain valid JSON'); }
  if (!isRecord(parsed) || parsed.kind !== 'mcpvault-derived-canvas' || parsed.version !== 1) throw new Error('Unsupported MCPVault Canvas metadata');
  if (!['moc', 'neighborhood'].includes(String(parsed.mode || ''))) throw new Error('MCPVault Canvas metadata has an invalid mode');
  if (typeof parsed.rootNodeId !== 'string' || !parsed.rootNodeId || parsed.rootNodeId.length > 128) throw new Error('MCPVault Canvas metadata has an invalid root node');
  if (typeof parsed.snapshotFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.snapshotFingerprint)) throw new Error('MCPVault Canvas metadata has an invalid fingerprint');
  if (!isRecord(parsed.revisions)) throw new Error('MCPVault Canvas metadata must contain revision guards');
  const revisions = Object.entries(parsed.revisions);
  if (revisions.length < 1 || revisions.length > 100) throw new Error('MCPVault Canvas metadata has an invalid revision count');
  const fileIds = new Set(value.nodes.filter(isRecord).filter(node => node.type === 'file').map(node => String(node.id || '')));
  const normalizedRevisions: Record<string, string> = {};
  for (const [nodeId, revision] of revisions) {
    if (!nodeId || nodeId.length > 128 || !fileIds.has(nodeId)) throw new Error('MCPVault Canvas metadata references a missing file node');
    if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) throw new Error('MCPVault Canvas metadata has an invalid source revision');
    normalizedRevisions[nodeId] = revision;
  }
  if (!normalizedRevisions[parsed.rootNodeId]) throw new Error('MCPVault Canvas metadata root has no revision guard');
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
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error('Canvas must contain nodes and edges arrays');
  if (value.nodes.length > 101 || value.edges.length > 300) throw new Error('Canvas exceeds the bounded node or edge limit');
  const ids = new Set<string>();
  for (const raw of value.nodes) {
    if (!isRecord(raw)) throw new Error('Canvas nodes must be objects');
    const id = String(raw.id || '');
    const type = String(raw.type || '');
    if (!id || ids.has(id)) throw new Error('Canvas node IDs must be non-empty and unique');
    ids.add(id);
    if (!['file', 'text'].includes(type)) throw new Error(`Unsupported Canvas node type: ${type}`);
    for (const field of ['x', 'y', 'width', 'height']) if (!Number.isInteger(raw[field])) throw new Error(`Canvas node ${field} must be an integer`);
    if (Number(raw.width) <= 0 || Number(raw.height) <= 0) throw new Error('Canvas node dimensions must be positive');
    if (type === 'file' && (typeof raw.file !== 'string' || !raw.file.trim() || raw.file.length > 1000)) throw new Error('Canvas file nodes require a bounded file path');
    if (type === 'text' && (typeof raw.text !== 'string' || raw.text.length > 12000)) throw new Error('Canvas text nodes require bounded text');
  }
  const edgeIds = new Set<string>();
  for (const raw of value.edges) {
    if (!isRecord(raw)) throw new Error('Canvas edges must be objects');
    const id = String(raw.id || '');
    const from = String(raw.fromNode || '');
    const to = String(raw.toNode || '');
    if (!id || edgeIds.has(id)) throw new Error('Canvas edge IDs must be non-empty and unique');
    edgeIds.add(id);
    if (!ids.has(from) || !ids.has(to) || from === to) throw new Error('Canvas edges must connect two different existing nodes');
    if (raw.label !== undefined && (typeof raw.label !== 'string' || raw.label.length > 64)) throw new Error('Canvas edge labels must be bounded text');
  }
}
