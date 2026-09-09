import { guidanceError } from './guidance-runtime.js';
/** Pure media projections over caller-selected, access-checked snapshots.
 * Paths are opaque references: this module neither resolves nor authorizes them.
 * No filesystem/network/model calls, image fetching, or Canvas writes occur.
 */
export interface StoryScreenplayBlock {
  type: 'heading' | 'action' | 'character' | 'dialogue' | 'transition';
  text: string;
}
export interface StoryMediaSource {
  id: string;
  path: string;
  revision: string;
}
export interface StoryMediaScene extends StoryMediaSource {
  title: string;
  content: string;
  /** Typed blocks are authoritative for Fountain; absent blocks use literal
   * action text from content. Manuscripts retain the original Markdown body. */
  blocks?: StoryScreenplayBlock[];
}
export interface StoryMediaImage {
  path: string;
  revision?: string;
  /** Set by the caller after authorized reference checks, never inferred here. */
  missing?: boolean;
}
export interface StoryMediaShot extends StoryMediaSource {
  sourceSceneId: string;
  sourceSceneRevision: string;
  /** Authored metadata only; shotIds is the canonical presentation sequence. */
  order: number;
  camera: string;
  action: string;
  dialogue: string;
  sound: string;
  durationSeconds: number;
  images?: StoryMediaImage[];
}
export interface StoryMediaInput {
  title: string;
  /** Array order is the explicit manuscript sequence. */
  scenes: StoryMediaScene[];
  /** Fail closed rather than truncate a manuscript or machine-readable export. */
  maxOutputChars?: number;
}
export interface StoryStoryboardInput extends StoryMediaInput {
  shots: StoryMediaShot[];
  /** Exact permutation of the supplied shot IDs, including when empty. */
  shotIds: string[];
}
export interface StoryMediaDiagnostic {
  code: 'missing_scene' | 'stale_shot' | 'missing_image';
  id: string;
  path?: string;
}
export interface StoryTextExport {
  text: string;
  sources: StoryMediaSource[];
  diagnostics: StoryMediaDiagnostic[];
}
export interface StoryCanvasFileNode {
  id: string;
  type: 'file';
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface StoryCanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  toEnd: 'arrow';
}
export interface StoryCanvasExport {
  canvas: { nodes: StoryCanvasFileNode[]; edges: StoryCanvasEdge[] };
  manifest: {
    kind: 'mcpvault-story-canvas';
    version: 1;
    sceneIds: string[];
    shotIds: string[];
    sources: StoryMediaSource[];
    shotSources: { shotId: string; sourceSceneId: string; sourceSceneRevision: string; currentSceneRevision?: string }[];
    images: { shotId: string; path: string; revision?: string; missing: boolean }[];
  };
  diagnostics: StoryMediaDiagnostic[];
}
export const STORY_MEDIA_LIMITS = Object.freeze({
  scenes: 256, shots: 1024, blocksPerScene: 2048, imagesPerShot: 16,
  textChars: 100_000, totalInputChars: 1_000_000, outputChars: 2_000_000,
});

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown, name: string, limit: number = STORY_MEDIA_LIMITS.textChars, nonempty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > limit || (nonempty && !value.trim()) || value.includes('\0')) throw guidanceError(new Error(`${name} string bound or value invalid.`), 'guid-c6061ca24c37b263');
}
function line(value: unknown, name: string, limit: number): asserts value is string {
  text(value, name, limit, true);
  if (/[\r\n\u2028\u2029]/.test(value)) throw guidanceError(new Error(`${name} must be a single line.`), 'guid-82263fb2c54b6c08');
}
function source(value: StoryMediaSource): void {
  if (!record(value)) throw guidanceError(new Error('Invalid source.'), 'guid-567df9dbcb6abf99');
  line(value.id, 'id', 128); line(value.path, 'path', 2048); line(value.revision, 'revision', 256);
}
function outputLimit(input: StoryMediaInput): number {
  const limit = input.maxOutputChars === undefined ? STORY_MEDIA_LIMITS.outputChars : input.maxOutputChars;
  if (!Number.isInteger(limit) || limit < 1 || limit > STORY_MEDIA_LIMITS.outputChars) throw guidanceError(new Error('Output bound invalid.'), 'guid-0b5055eee2e3e795');
  return limit;
}
function finish<T>(result: T, input: StoryMediaInput): T {
  if (JSON.stringify(result).length > outputLimit(input)) throw guidanceError(new Error('Media output bound exceeded.'), 'guid-364b002a416d8558');
  return result;
}
function sourceCopy({ id, path, revision }: StoryMediaSource): StoryMediaSource { return { id, path, revision }; }

function validateScenes(input: StoryMediaInput): number {
  if (!record(input)) throw guidanceError(new Error('Invalid media input.'), 'guid-76bb65717a43e45b');
  line(input.title, 'title', 1024);
  outputLimit(input);
  if (!Array.isArray(input.scenes) || input.scenes.length > STORY_MEDIA_LIMITS.scenes) throw guidanceError(new Error('Scene count bound exceeded.'), 'guid-213aca2efa032b4a');
  const ids = new Set<string>();
  let chars = input.title.length;
  const add = (value: string): void => {
    chars += value.length;
    if (chars > STORY_MEDIA_LIMITS.totalInputChars) throw guidanceError(new Error('Media input bound exceeded.'), 'guid-b60e5bf2e689feab');
  };
  for (const scene of input.scenes) {
    source(scene);
    if (ids.has(scene.id)) throw guidanceError(new Error('Duplicate scene id.'), 'guid-826ea853a58847f4');
    ids.add(scene.id);
    line(scene.title, 'scene title', 1024); text(scene.content, 'content');
    for (const value of [scene.id, scene.path, scene.revision, scene.title, scene.content]) add(value);
    if (scene.blocks === undefined) continue;
    if (!Array.isArray(scene.blocks) || scene.blocks.length > STORY_MEDIA_LIMITS.blocksPerScene) throw guidanceError(new Error('Screenplay block count bound exceeded.'), 'guid-d66331b1833308b4');
    let previous: StoryScreenplayBlock['type'] | undefined;
    for (const block of scene.blocks) {
      if (!record(block) || !['heading', 'action', 'character', 'dialogue', 'transition'].includes(block.type)) throw guidanceError(new Error('Invalid screenplay block type.'), 'guid-5b30b3771ccf56a7');
      text(block.text, 'block text', STORY_MEDIA_LIMITS.textChars, true);
      if (['heading', 'character', 'transition'].includes(block.type)) line(block.text, 'structural block', 1024);
      if (previous === 'character' && block.type !== 'dialogue') throw guidanceError(new Error('Character block must be followed by dialogue.'), 'guid-04cfcf2ce35f917f');
      if (block.type === 'dialogue' && previous !== 'character' && previous !== 'dialogue') throw guidanceError(new Error('Dialogue block requires a character.'), 'guid-79d24ed11166098a');
      previous = block.type;
      add(block.text);
    }
    if (previous === 'character') throw guidanceError(new Error('Character block requires dialogue.'), 'guid-31968611d35aa744');
  }
  return chars;
}

function validateStoryboard(input: StoryStoryboardInput): { ordered: StoryMediaShot[]; diagnostics: StoryMediaDiagnostic[] } {
  let chars = validateScenes(input);
  if (!Array.isArray(input.shots) || input.shots.length > STORY_MEDIA_LIMITS.shots) throw guidanceError(new Error('Shot count bound exceeded.'), 'guid-a5328b16fe5c1832');
  const scenes = new Map(input.scenes.map(scene => [scene.id, scene]));
  const shots = new Map<string, StoryMediaShot>();
  const diagnostics: StoryMediaDiagnostic[] = [];
  for (const shot of input.shots) {
    source(shot);
    if (shots.has(shot.id)) throw guidanceError(new Error('Duplicate shot id.'), 'guid-4081a539d2e3380d');
    shots.set(shot.id, shot);
    line(shot.sourceSceneId, 'sourceSceneId', 128); line(shot.sourceSceneRevision, 'sourceSceneRevision', 256);
    if (!Number.isInteger(shot.order) || shot.order < 0 || shot.order > 1_000_000) throw guidanceError(new Error('Shot order bound invalid.'), 'guid-8bfba69b75aed011');
    if (!Number.isFinite(shot.durationSeconds) || shot.durationSeconds < 0 || shot.durationSeconds > 86_400) throw guidanceError(new Error('Shot durationSeconds bound invalid.'), 'guid-4b2f619e0c8504a5');
    for (const value of [shot.id, shot.path, shot.revision, shot.sourceSceneId, shot.sourceSceneRevision, shot.camera, shot.action, shot.dialogue, shot.sound]) {
      text(value, 'shot text'); chars += value.length;
    }
    const current = scenes.get(shot.sourceSceneId);
    if (!current) diagnostics.push({ code: 'missing_scene', id: shot.id });
    else if (current.revision !== shot.sourceSceneRevision) diagnostics.push({ code: 'stale_shot', id: shot.id });
    if (shot.images !== undefined) {
      if (!Array.isArray(shot.images) || shot.images.length > STORY_MEDIA_LIMITS.imagesPerShot) throw guidanceError(new Error('Image count bound exceeded.'), 'guid-f8f98de35547be51');
      for (const image of shot.images) {
        if (!record(image)) throw guidanceError(new Error('Invalid image reference.'), 'guid-0e130b0f91cb2f2f');
        line(image.path, 'image path', 2048);
        if (image.revision !== undefined) line(image.revision, 'image revision', 256);
        if (image.missing !== undefined && typeof image.missing !== 'boolean') throw guidanceError(new Error('Invalid missing image flag.'), 'guid-7d66ac69b6e6b784');
        chars += image.path.length + (image.revision?.length ?? 0);
        if (image.missing) diagnostics.push({ code: 'missing_image', id: shot.id, path: image.path });
      }
    }
    if (chars > STORY_MEDIA_LIMITS.totalInputChars) throw guidanceError(new Error('Media input bound exceeded.'), 'guid-b60e5bf2e689feab');
  }
  if (!Array.isArray(input.shotIds) || input.shotIds.length !== input.shots.length || new Set(input.shotIds).size !== input.shots.length
    || !input.shotIds.every(id => typeof id === 'string' && shots.has(id))) throw guidanceError(new Error('shotIds must be an exact unique permutation of supplied shots.'), 'guid-37ac223bfe7bf84e');
  const positions = new Map(input.shotIds.map((id, index) => [id, index]));
  diagnostics.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
  return { ordered: input.shotIds.map(id => shots.get(id)!), diagnostics };
}

function markdownLabel(value: string): string {
  return value.replace(/[\\`*_{}\[\]()<>#+.!|~-]/g, '\\$&').replace(/\r\n?|\n/g, ' ');
}
function markdownLink(path: string, label: string): string {
  // Angle destination plus percent encoding keeps path punctuation from closing
  // the link. This changes presentation only, not the opaque source manifest.
  const destination = encodeURI(path).replace(/[<>\[\]#]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `[${markdownLabel(label)}](<${destination}>)`;
}

/** Markdown bodies are copied exactly; wrappers and heading titles are escaped.
 * Caller must select an appropriate scope before requesting body exports. */
export function exportStoryManuscript(input: StoryMediaInput): StoryTextExport {
  validateScenes(input);
  const parts = [`# ${markdownLabel(input.title)}`];
  for (const scene of input.scenes) parts.push(`## ${markdownLabel(scene.title)}\n\n${scene.content}`);
  return finish({ text: `${parts.join('\n\n')}\n`, sources: input.scenes.map(sourceCopy), diagnostics: [] }, input);
}

/** Resolve Obsidian links only outside matching fences / inline code / escaped
 * openers. Every other character remains literal for the Fountain escape pass.
 * A Fountain [[note]] is deliberately treated as visible Obsidian link text.
 */
function visibleWikiText(content: string): string {
  const normalized = content.replace(/\r\n?/g, '\n');
  const mask = new Uint8Array(normalized.length);
  const runs: { start: number; length: number; segment: number; escaped: boolean }[] = [];
  let fenceChar = '';
  let fenceLength = 0;
  let lineStart = 0;
  let segment = 0;
  for (const raw of normalized.split('\n')) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(raw);
    if (fenceChar) {
      if (fence && fence[1]![0] === fenceChar && fence[1]!.length >= fenceLength && /^[ \t]*$/.test(fence[2]!)) fenceChar = '';
      mask.fill(1, lineStart, lineStart + raw.length + 1);
      segment++;
    } else if (fence && (fence[1]![0] !== '`' || !fence[2]!.includes('`'))) {
      fenceChar = fence[1]![0]!; fenceLength = fence[1]!.length;
      mask.fill(1, lineStart, lineStart + raw.length + 1);
      segment++;
    } else {
      if (!raw.trim()) segment++;
      let backslashes = 0;
      for (let offset = 0; offset < raw.length; offset++) {
        if (raw[offset] === '`') {
          let length = 1;
          while (raw[offset + length] === '`') length++;
          runs.push({ start: lineStart + offset, length, segment, escaped: backslashes % 2 === 1 });
          offset += length - 1;
        }
        backslashes = raw[offset] === '\\' ? backslashes + 1 : 0;
      }
    }
    lineStart += raw.length + 1;
  }
  // Pre-index matching delimiter runs: unmatched backticks cannot cause an
  // unbounded repeated scan, and inline code may span nonblank lines.
  const next = new Map<string, number>();
  const closing = new Map<number, number>();
  for (let index = runs.length - 1; index >= 0; index--) {
    const run = runs[index]!;
    const key = `${run.segment}:${run.length}`;
    if (next.has(key)) closing.set(index, next.get(key)!);
    next.set(key, index);
  }
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index]!;
    const endIndex = closing.get(index);
    if (run.escaped || endIndex === undefined) continue;
    const end = runs[endIndex]!;
    mask.fill(1, run.start, end.start + end.length);
    index = endIndex;
  }
  let result = '';
  let cachedEnd = -1;
  for (let index = 0; index < normalized.length;) {
    if (mask[index]) { result += normalized[index]!; index++; continue; }
    const char = normalized[index]!;
    if (char === '\\' && index + 1 < normalized.length) { result += normalized.slice(index, index + 2); index += 2; continue; }
    const start = normalized.startsWith('![[', index) ? index + 1 : index;
    if (normalized.startsWith('[[', start)) {
      if (cachedEnd < start + 2) cachedEnd = normalized.indexOf(']]', start + 2);
      if (cachedEnd < 0) { result += normalized.slice(index); break; }
      const newline = normalized.indexOf('\n', start + 2);
      if (newline !== -1 && newline < cachedEnd) {
        // No closer on this line: preserve its remainder in one pass instead
        // of repeatedly scanning every malformed [[ prefix across paragraphs.
        result += normalized.slice(index, newline + 1); index = newline + 1; continue;
      }
      const target = normalized.slice(start + 2, cachedEnd);
      if (mask.subarray(start, cachedEnd + 2).some(value => value !== 0)) result += normalized.slice(index, cachedEnd + 2);
      else {
        const alias = target.indexOf('|');
        result += alias >= 0 ? target.slice(alias + 1) : target;
      }
      index = cachedEnd + 2; continue;
    }
    result += char; index++;
  }
  return result;
}

function fountainLiteral(value: string): string {
  // Fountain implementations do not consistently honor escaped trailing ^.
  // Full-width caret is an intentional display substitution, never dual-dialogue.
  // Escape slash as well as star so neither /* nor */ can become a boneyard.
  return value.replace(/\^/g, '＾').replace(/[\\/*_\[\]@!<>#=~():]/g, '\\$&').replace(/^([ \t]*)\./, '$1\\.');
}
function literalLines(value: string): string[] {
  return visibleWikiText(value).split('\n').map(fountainLiteral);
}
function fountainHeading(value: string): string {
  const visible = visibleWikiText(value).trimStart();
  // A forced heading requires a letter or number directly after its dot.
  // Keep Unicode names (including Korean); do not discard literal punctuation
  // such as a leading '(회상)' merely to manufacture a valid heading.
  if (!/^[\p{L}\p{N}]/u.test(visible)) throw guidanceError(new Error('Fountain heading must start with a Unicode letter or number after leading whitespace.'), 'guid-6c474ae9f1026b83');
  return `.${fountainLiteral(visible)}`;
}

/** Derived literal-text Fountain, not a lossless Obsidian/Fountain round trip.
 * Uses . headings, ! actions, @ characters (including Korean), > transitions.
 * Literal metacharacters are escaped; ^ becomes full-width ＾ for portability.
 * Heading whitespace is trimmed at the start; unsupported prefixes are rejected.
 * Markdown code fences remain visible literal action lines, never directives.
 * See https://fountain.io/syntax/ for the target format.
 */
export function exportStoryFountain(input: StoryMediaInput): StoryTextExport {
  validateScenes(input);
  const scenes: string[] = [];
  for (const scene of input.scenes) {
    const parts: string[] = [];
    if (scene.blocks === undefined) {
      parts.push(fountainHeading(scene.title));
      for (const value of literalLines(scene.content)) parts.push(value ? `!${value}` : '');
    } else {
      let previous: StoryScreenplayBlock['type'] | undefined;
      for (const block of scene.blocks) {
        const lines = literalLines(block.text);
        if (block.type === 'dialogue') {
          // Two spaces preserve intentional blank dialogue lines in Fountain.
          const dialogue = lines.map(value => value.trim() ? value : '  ').join('\n');
          if (previous === 'character' || previous === 'dialogue') parts[parts.length - 1] += `\n${dialogue}`;
        } else if (block.type === 'action') parts.push(lines.map(value => value ? `!${value}` : '').join('\n\n'));
        else if (block.type === 'heading') parts.push(fountainHeading(block.text));
        else {
          if (!lines[0]!.trim()) throw guidanceError(new Error(`Fountain ${block.type} requires nonempty visible text.`), 'guid-0a3b75ea608989a5');
          parts.push(`${{ character: '@', transition: '>' }[block.type]}${lines[0]!}`);
        }
        previous = block.type;
      }
    }
    scenes.push(parts.join('\n\n'));
  }
  return finish({ text: `${scenes.join('\n\n')}\n`, sources: input.scenes.map(sourceCopy), diagnostics: [] }, input);
}

/** Text storyboard includes caller-approved shot bodies and image links. */
export function exportStoryStoryboard(input: StoryStoryboardInput): StoryTextExport {
  const { ordered, diagnostics } = validateStoryboard(input);
  const parts = [`# ${markdownLabel(input.title)} — Storyboard`];
  for (const shot of ordered) {
    const flags = diagnostics.filter(diagnostic => diagnostic.id === shot.id).map(diagnostic => diagnostic.code);
    parts.push(`## ${markdownLabel(shot.id)}\n\n${markdownLink(shot.path, shot.id)}\n\n`
      + `Source: ${markdownLabel(shot.sourceSceneId)} @ ${markdownLabel(shot.sourceSceneRevision)}\n\n`
      + `Duration: ${shot.durationSeconds}s\n\nCamera: ${markdownLabel(shot.camera)}\n\n`
      + `Action: ${markdownLabel(shot.action)}\n\nDialogue: ${markdownLabel(shot.dialogue)}\n\nSound: ${markdownLabel(shot.sound)}`
      + (flags.length ? `\n\nFlags: ${flags.join(', ')}` : '')
      + (shot.images?.length ? `\n\nImages: ${shot.images.map(image => image.missing ? `missing_image: ${markdownLabel(image.path)}` : markdownLink(image.path, image.path)).join(', ')}` : ''));
  }
  return finish({ text: `${parts.join('\n\n')}\n`, sources: [...input.scenes.map(sourceCopy), ...ordered.map(sourceCopy)], diagnostics }, input);
}

/** New deterministic projection only. Never accepts an existing Canvas and never
 * overwrites one. Caller owns managed/unmanaged checks, manifests, revision CAS,
 * and authorized image existence. JSON Canvas contains file nodes only, never
 * scene/shot bodies. Layout and edge order derive from explicit input sequences.
 */
export function buildStoryCanvas(input: StoryStoryboardInput): StoryCanvasExport {
  const { ordered, diagnostics } = validateStoryboard(input);
  const nodes: StoryCanvasFileNode[] = [];
  const edges: StoryCanvasEdge[] = [];
  const sceneNodes = new Map<string, string>();
  const sceneRevisions = new Map(input.scenes.map(scene => [scene.id, scene.revision]));
  const file = (id: string, path: string, x: number, y: number): void => { nodes.push({ id, type: 'file', file: path, x, y, width: 320, height: 240 }); };
  const edge = (fromNode: string, toNode: string): void => { edges.push({ id: `edge-${edges.length}`, fromNode, toNode, toEnd: 'arrow' }); };
  input.scenes.forEach((scene, index) => {
    const id = `scene-${index}`; sceneNodes.set(scene.id, id); file(id, scene.path, 0, index * 300);
  });
  const images: StoryCanvasExport['manifest']['images'] = [];
  ordered.forEach((shot, index) => {
    const id = `shot-${index}`; file(id, shot.path, 400, index * 300);
    if (index > 0) edge(`shot-${index - 1}`, id);
    const sceneNode = sceneNodes.get(shot.sourceSceneId);
    if (sceneNode) edge(sceneNode, id);
    shot.images?.forEach((image, imageIndex) => {
      images.push({ shotId: shot.id, path: image.path, ...(image.revision !== undefined ? { revision: image.revision } : {}), missing: image.missing === true });
      if (image.missing) return;
      const imageId = `image-${index}-${imageIndex}`;
      file(imageId, image.path, 800 + imageIndex * 400, index * 300); edge(id, imageId);
    });
  });
  return finish({ canvas: { nodes, edges }, manifest: {
    kind: 'mcpvault-story-canvas', version: 1,
    sceneIds: input.scenes.map(scene => scene.id), shotIds: [...input.shotIds],
    sources: [...input.scenes.map(sourceCopy), ...ordered.map(sourceCopy)],
    shotSources: ordered.map(shot => ({ shotId: shot.id, sourceSceneId: shot.sourceSceneId, sourceSceneRevision: shot.sourceSceneRevision,
      ...(sceneRevisions.has(shot.sourceSceneId) ? { currentSceneRevision: sceneRevisions.get(shot.sourceSceneId)! } : {}) })), images,
  }, diagnostics }, input);
}
