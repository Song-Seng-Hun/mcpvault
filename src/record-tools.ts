import { guidanceError } from './guidance-runtime.js';
import type { Tool } from '@modelcontextprotocol/server';

const token = { type: 'string', description: 'Local session token; omit for OAuth, whose host supplies it.' } as const;
const label = { type: 'string', description: 'Optional approved OAuth activity label, not an identity or access grant.' } as const;
const revision = { type: 'string', pattern: '^[a-fA-F0-9]{64}$', description: 'Revision from the latest read of this item.' } as const;
const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const create = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const update = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

/** A small task-facing surface over existing authorized services and endpoints. */
export const RECORDING_MCP_TOOLS: Tool[] = [
  { name: 'get_wiki_policy', description: 'Read one Vault policy topic before authoring; guidance does not grant access.',
    annotations: read, inputSchema: { type: 'object', properties: {
      topic: { type: 'string', description: 'Relevant topic, such as knowledge or memory.' },
      maxChars: { type: 'integer', minimum: 1024, maximum: 16000 }, accessToken: token,
    } } },
  { name: 'memory_brief', description: 'Read a bounded packet of this agent\'s relevant past experience; never writes memory.',
    annotations: read, inputSchema: { type: 'object', properties: {
      query: { type: 'string', maxLength: 1000 }, scope: { type: 'string', enum: ['personal', 'community', 'global'], default: 'personal' },
      maxChars: { type: 'integer', minimum: 1000, maximum: 4000 }, accessToken: token,
    } } },
  { name: 'search_notes', description: 'Find existing visible Wiki/research notes before creating or changing one.',
    annotations: read, inputSchema: { type: 'object', properties: {
      query: { type: 'string' }, pathPrefix: { type: 'string' }, includeRevisions: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 100 }, maxChars: { type: 'integer', minimum: 512, maximum: 20000 }, accessToken: token,
    }, required: ['query'] } },
  { name: 'read_note', description: 'Read one visible Wiki/research note and its current revision; use that revision for edits.',
    annotations: read, inputSchema: { type: 'object', properties: {
      path: { type: 'string' }, expectedRevision: revision,
      maxChars: { type: 'integer', minimum: 512, maximum: 20000 }, accessToken: token,
    }, required: ['path'] } },
  { name: 'list_journal_entries', description: 'List this authenticated agent\'s private journal IDs and revisions.',
    annotations: read, inputSchema: { type: 'object', properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100 }, maxChars: { type: 'integer', minimum: 1000, maximum: 12000 },
      cursor: { type: 'string' }, accessToken: token,
    } } },
  { name: 'read_journal_entry', description: 'Read one entry in this authenticated agent\'s private journal and its revision.',
    annotations: read, inputSchema: { type: 'object', properties: {
      entryId: { type: 'string' }, expectedRevision: revision,
      maxChars: { type: 'integer', minimum: 1000, maximum: 12000 }, accessToken: token,
    }, required: ['entryId'] } },
  { name: 'create_journal_entry', description: 'Create a new private diary, work log or reflection for the authenticated agent; never update an existing entry.',
    annotations: create, inputSchema: { type: 'object', properties: {
      content: { type: 'string', maxLength: 20000 }, title: { type: 'string' }, date: { type: 'string' },
      kind: { type: 'string', enum: ['diary', 'log', 'reflection'] }, tags: { type: 'array', items: { type: 'string' } },
      references: { type: 'array', items: { type: 'string' } }, accessToken: token, agentLabel: label,
    }, required: ['content'] } },
  { name: 'update_journal_entry', description: 'Replace an existing private journal entry after reading its ID and revision; preserves omitted metadata.',
    annotations: update, inputSchema: { type: 'object', properties: {
      entryId: { type: 'string' }, content: { type: 'string', maxLength: 20000 }, expectedRevision: revision,
      title: { type: 'string' }, accessToken: token, agentLabel: label,
    }, required: ['entryId', 'content', 'expectedRevision'] } },
  { name: 'create_note', description: 'Create a new Wiki/research Markdown note at an authorized path; never overwrite an existing note.',
    annotations: create, inputSchema: { type: 'object', properties: {
      path: { type: 'string' }, content: { type: 'string' },
      frontmatter: { type: 'object', description: 'Optional Obsidian Properties including note_kind and evidence_paths.' },
      accessToken: token, agentLabel: label,
    }, required: ['path', 'content'] } },
  { name: 'patch_note', description: 'Replace one exact passage in an existing note, preserving unrelated body and Properties; read it first.',
    annotations: update, inputSchema: { type: 'object', properties: {
      path: { type: 'string' }, oldString: { type: 'string' }, newString: { type: 'string' },
      expectedRevision: revision, accessToken: token, agentLabel: label,
    }, required: ['path', 'oldString', 'newString', 'expectedRevision'] } },
  { name: 'update_note_properties', description: 'Merge Properties into an existing note without rewriting its body; read it first.',
    annotations: update, inputSchema: { type: 'object', properties: {
      path: { type: 'string' }, frontmatter: { type: 'object' }, expectedRevision: revision,
      accessToken: token, agentLabel: label,
    }, required: ['path', 'frontmatter', 'expectedRevision'] } },
];

export const RECORDING_TOOL_NAMES = new Set(RECORDING_MCP_TOOLS.map(tool => tool.name));

function requiredString(args: Record<string, unknown>, field: string): string {
  const value = args[field];
  if (typeof value !== 'string' || !value.trim()) throw guidanceError(new Error(`${field} is required`), 'guid-0c6fd33ea1895f5e');
  return value;
}

function requiredRevision(args: Record<string, unknown>): string {
  const value = requiredString(args, 'expectedRevision');
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw guidanceError(new Error('expectedRevision must be the current 64-character revision'), 'guid-b6f8ab194166cca0');
  return value;
}

export function routeRecordingTool(name: string, args: Record<string, unknown>): { toolName: string; args: Record<string, unknown> } {
  const accessToken = args.accessToken;
  if (name === 'create_journal_entry') return { toolName: 'write_journal_entry', args: {
    content: requiredString(args, 'content'), expectedRevision: 'missing',
    ...('title' in args && { title: args.title }), ...('date' in args && { date: args.date }),
    ...('kind' in args && { kind: args.kind }), ...('tags' in args && { tags: args.tags }),
    ...('references' in args && { references: args.references }), accessToken,
  } };
  if (name === 'update_journal_entry') return { toolName: 'write_journal_entry', args: {
    entryId: requiredString(args, 'entryId'), content: requiredString(args, 'content'), expectedRevision: requiredRevision(args),
    ...('title' in args && { title: args.title }), accessToken,
  } };
  if (name === 'create_note') return { toolName: 'write_note', args: {
    path: requiredString(args, 'path'), content: args.content, ...('frontmatter' in args && { frontmatter: args.frontmatter }),
    mode: 'overwrite', expectedRevision: 'missing', accessToken,
  } };
  if (name === 'patch_note') return { toolName: 'patch_note', args: {
    path: requiredString(args, 'path'), oldString: requiredString(args, 'oldString'), newString: args.newString,
    expectedRevision: requiredRevision(args), replaceAll: false, dryRun: false, accessToken,
  } };
  if (name === 'update_note_properties') return { toolName: 'update_frontmatter', args: {
    path: requiredString(args, 'path'), frontmatter: args.frontmatter, expectedRevision: requiredRevision(args), merge: true, accessToken,
  } };
  return { toolName: name, args };
}
