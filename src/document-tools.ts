import { guidanceError, guidanceText } from './guidance-runtime.js';
import type { Tool } from '@modelcontextprotocol/server';
import type { DocumentService } from './document-service.js';
import type { DocumentSearch } from './document-search.js';
import type { ScopePrincipal } from './scope-auth.js';
type Schema = Record<string, any>;
const text = (maxLength: number, minLength = 0): Schema => ({ type: 'string', minLength, maxLength });
const integer = (minimum: number, maximum: number): Schema => ({ type: 'integer', minimum, maximum });
const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', additionalProperties: false, properties, ...(required.length && { required }) });
const revision = { type: 'string', pattern: '^[a-f0-9]{64}$', minLength: 64, maxLength: 64 };
const common = { path: text(500, 1), expectedRevision: revision, accessToken: text(4096, 1), maxChars: { ...integer(512, 12000), default: 4000 } };
const range = {
  fragmentId: text(200, 1), relation: { type: 'string', enum: ['self', 'previous', 'next', 'parent'] },
  edge: { type: 'string', enum: ['head', 'tail'] }, lineCount: integer(1, 1000),
  startLine: integer(1, 8388609), endLine: integer(1, 8388609), startOffset: integer(0, 8388608), endOffset: integer(0, 8388608),
  mode: { type: 'string', enum: ['semantic', 'exact'] },
};
export const DOCUMENT_TOOL_ENDPOINTS: Record<string, string> = {
  get_document_outline: 'documents.outline', read_document: 'documents.read', search_documents: 'documents.search',
  get_resource_manifest: 'resources.manifest', export_resource: 'resources.export',
};
export function getDocumentTools(): Tool[] {
  const spec: Record<string, { description: string; properties?: Record<string, Schema>; required?: string[] }> = {
    get_document_outline: { description: guidanceText('guid-418ee0f34dd7203f', 'Bounded source-revision document structure, extractive descriptions and reading-order links. Markdown, plain text/scripts; optional local PDF. Parent and cursor reads require expectedRevision. Children are read with parentId; no script execution.'),
      properties: { parentId: text(200, 1), limit: integer(1, 100), cursor: text(1000) } },
    read_document: { description: guidanceText('guid-74c0445baa417ec7', 'Read exact lines/UTF-16 offsets or semantic fragments with structural headings, table/list context. Previous defaults to tail N lines, next to head. Revision-pin fragment/cursor reads. Follow nextAction while ranges remain. Meaning completeness is not guaranteed. Optional caller/session-bound knownReads receipts suppress duplicates; forceRead rereads. Never executes source text.'),
      properties: { ...range, ranges: { type: 'array', minItems: 1, maxItems: 8, items: object(range) }, cursor: text(100),
        knownReads: { type: 'array', maxItems: 16, items: text(100, 1) }, forceRead: { type: 'boolean' } } },
    search_documents: { description: guidanceText('guid-65d724cd13118818', 'Search current semantic fragments and return bounded descriptions, exact revision/locators and read actions. Specify path for exhaustive target coverage. Global discovery is a bounded partial candidate window; optional vector discovery is advisory. Hidden data is excluded.'),
      properties: { query: text(500, 1), limit: integer(1, 100), cursor: text(1000), semantic: { type: 'boolean' } }, required: ['query'] },
    get_resource_manifest: { description: guidanceText('guid-b163194a801ea493', 'Inspect authoritative original resource bytes: hash, media type, size and export action. An imported bundle manifest.md pages original members, rejected entries and licensing. Scripts and licenses are data, never executed. Do not infer licensing permission.'),
      properties: { limit: integer(1, 100), cursor: text(1000) } },
    export_resource: { description: guidanceText('guid-b223e2ea79b50a01', 'Read original resource bytes in bounded base64 chunks without conversion or execution. Reassemble chunks and verify the source SHA-256 revision. Continuations require expectedRevision; never returns a host filesystem path.'),
      properties: { startByte: integer(0, 52428800), byteLength: integer(1, 8192) } },
  };
  return Object.entries(spec).map(([name, value]) => ({ name, description: value.description,
    inputSchema: object({ ...common, ...value.properties }, value.required ?? ['path']) as Tool['inputSchema'] }));
}
export async function dispatchDocumentTool(name: string, input: Record<string, any>, principal: ScopePrincipal | undefined, service: DocumentService, search: DocumentSearch) {
  const { accessToken: _token, principal: _untrustedPrincipal, ...args } = input;
  for (const key of ['maxChars', 'limit', 'lineCount', 'startLine', 'endLine', 'startOffset', 'endOffset', 'startByte', 'byteLength']) {
    if (typeof args[key] === 'string' && /^\d{1,8}$/.test(args[key])) args[key] = Number(args[key]);
  }
  for (const key of ['semantic', 'forceRead']) if (args[key] === 'true' || args[key] === 'false') args[key] = args[key] === 'true';
  // GET query arrays have one documented JSON encoding; MCP arrays retain their types.
  for (const key of ['ranges', 'knownReads']) if (typeof args[key] === 'string') {
    if (args[key].length > 16000) throw guidanceError(new Error(`${key} query budget exceeded`), 'guid-889032af05f2a862');
    try { args[key] = JSON.parse(args[key]); } catch { throw guidanceError(new Error(`${key} must be a bounded JSON array`), 'guid-4d0593fac56fdfd5'); }
    if (!Array.isArray(args[key])) throw guidanceError(new Error(`${key} must be an array`), 'guid-865ca92fb9b851b2');
  }
  const params = { ...args, ...(principal && { principal }) } as any;
  try {
    switch (name) {
      case 'get_document_outline': return await service.outline(params);
      case 'read_document': return await service.read(params);
      case 'search_documents': return await search.search(params);
      case 'get_resource_manifest': return await service.manifest(params);
      case 'export_resource': return await service.export(params);
      default: throw guidanceError(new Error('Unknown document endpoint'), 'guid-0fbf1b0b1724f127');
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) throw guidanceError(new Error('Document unavailable; verify path and source availability'), 'guid-97bdfe49267bc68d');
    if (error instanceof Error && error.message.includes(service.index.reader.fs.getVaultPath())) throw guidanceError(new Error('Document unavailable'), 'guid-9ef06b8861d9b3c6');
    throw error;
  }
}
