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
