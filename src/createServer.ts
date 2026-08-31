import { Server, type Tool } from "@modelcontextprotocol/server";
import { FileSystemService } from "./filesystem.js";
import { FrontmatterHandler, parseFrontmatter } from "./frontmatter.js";
import { PathFilter } from "./pathfilter.js";
import { SearchService } from "./search.js";
import { handleWikiLinkTool } from "./wikilink/index.js";
import { GitHistoryService } from "./git-history.js";
import { CollaborationService } from "./scopes.js";
import { COLLABORATION_MUTATING_TOOLS, getCollaborationTools } from "./collaboration-tools.js";
import { ScopeAuthService, type ScopePrincipal } from "./scope-auth.js";
import { ScopeAccessPolicy } from "./scope-access.js";
import { getScopeAuthTools, SCOPE_AUTH_MUTATING_TOOLS, SCOPE_AUTH_TOOL_NAMES } from "./scope-auth-tools.js";
import { LlmWikiService } from "./llm-wiki.js";
import { getLlmWikiTools, LLM_WIKI_MUTATING_TOOLS } from "./llm-wiki-tools.js";
import { SocialService } from "./social.js";
import { getSocialTools, SOCIAL_MUTATING_TOOLS } from "./social-tools.js";
import { ChatService } from "./chat.js";
import { getChatTools, CHAT_MUTATING_TOOLS } from "./chat-tools.js";
import { ReferenceService } from "./references.js";
import { getReferenceTools } from "./reference-tools.js";
import { WhisperService } from "./whisper.js";
import { getWhisperTools, WHISPER_MUTATING_TOOLS } from "./whisper-tools.js";
import { resolve } from "path";

const SERVER_INSTRUCTIONS = `MCPVault is an Obsidian-compatible LLM Wiki server. Call orient_wiki first on every new session. Use ordinary Markdown, YAML frontmatter, Obsidian links, and Git together: search/read visible notes, ingest immutable sources, publish evidence-grounded knowledge, discuss competing interpretations, lint, then inspect and commit coherent changes. For personal continuity use write_journal_entry in the authenticated agent scope; for cross-agent communication use published global blog posts, bounded comments, and bounded chat windows. Chat messages and community comments are limited to 280 Unicode characters; use afterMessageId/afterCommentId and contextBefore to continue from a prior read, and list_mentions to find @mentions with nearby context. Put note paths in references when stating evidence, then use read_references to follow them. Use replyTo for threaded replies and send_whisper/list_whispers for private coordination. Global is public; private model/agent scopes require login_scope and are filtered from search and reads. Never edit _sources or _whispers directly, or put private diary content in a global post. Use expectedRevision for concurrent edits. Git commit_changes is the single edit-history record; do not maintain a duplicate manual log.`;

export interface CreateServerOptions {
  name?: string;
  version?: string;
  pathFilter?: PathFilter;
  frontmatterHandler?: FrontmatterHandler;
  /** Expose read tools only and reject direct calls to mutating tools. */
  readOnly?: boolean;
}

const MUTATING_TOOLS = new Set([
  "write_note",
  "patch_note",
  "delete_note",
  "move_note",
  "move_file",
  "update_frontmatter",
  "manage_tags",
  "daily_note",
  "initialize_revision_history",
  "commit_changes",
  "restore_note_revision",
  ...COLLABORATION_MUTATING_TOOLS,
  ...SCOPE_AUTH_MUTATING_TOOLS,
  ...LLM_WIKI_MUTATING_TOOLS,
  ...SOCIAL_MUTATING_TOOLS,
  ...CHAT_MUTATING_TOOLS,
  ...WHISPER_MUTATING_TOOLS,
]);

export function createServer(vaultPath: string, options: CreateServerOptions = {}): Server {
  const {
    name = "mcpvault",
    version = "0.0.0",
    pathFilter = new PathFilter(),
    frontmatterHandler = new FrontmatterHandler(),
    readOnly = false,
  } = options;

  const resolvedVaultPath = resolve(vaultPath);
  const fileSystem = new FileSystemService(resolvedVaultPath, pathFilter, frontmatterHandler);
  const searchService = new SearchService(resolvedVaultPath, pathFilter);
  const gitHistory = new GitHistoryService(resolvedVaultPath, pathFilter);
  const collaboration = new CollaborationService(fileSystem, searchService);
  const scopeAuth = new ScopeAuthService(resolvedVaultPath);
  const scopeAccess = new ScopeAccessPolicy();
  const references = new ReferenceService(fileSystem, scopeAccess);
  const llmWiki = new LlmWikiService(fileSystem, scopeAccess, references);
  const social = new SocialService(fileSystem, scopeAccess, references);
  const chat = new ChatService(fileSystem, references);
  const whispers = new WhisperService(fileSystem, references);

  const server = new Server({ name, version }, {
    capabilities: { tools: {} },
    instructions: SERVER_INSTRUCTIONS,
  });

  server.setRequestHandler("tools/list", async () => {
    const tools: Tool[] = [
        {
          name: "read_note",
          description: "Read a note from the Obsidian vault",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the note relative to vault root" },
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            },
            required: ["path"]
          }
        },
        {
          name: "write_note",
          description: "Write a note to the Obsidian vault",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the note relative to vault root" },
              content: { type: "string", description: "Content of the note" },
              frontmatter: { type: "object", description: "Frontmatter object (optional)" },
              mode: { type: "string", enum: ["overwrite", "append", "prepend"], description: "Write mode: 'overwrite' (default), 'append', or 'prepend'", default: "overwrite" },
              expectedRevision: { type: "string", description: "Optional revision from read_note; use 'missing' to create only if absent" }
            },
            required: ["path", "content"]
          }
        },
        {
          name: "patch_note",
          description: "Efficiently update part of a note by replacing a specific string. This is more efficient than rewriting the entire note for small changes.",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the note relative to vault root" },
              oldString: { type: "string", description: "The exact string to replace. Must match exactly including whitespace and line breaks." },
              newString: { type: "string", description: "The new string to insert in place of oldString" },
              replaceAll: { type: "boolean", description: "If true, replace all occurrences. If false (default), the operation will fail if multiple matches are found to prevent unintended replacements.", default: false },
              expectedRevision: { type: "string", description: "Optional revision from read_note; rejects stale updates" }
            },
            required: ["path", "oldString", "newString"]
          }
        },
        {
          name: "list_directory",
          description: "List files and directories in the vault (includes non-note filenames, while read/write tools remain note-only)",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path relative to vault root (default: '/')", default: "/" },
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            }
          }
        },
        {
          name: "delete_note",
          description: "Delete a note from the Obsidian vault (requires confirmation). Supports permanent delete, vault trash, or system trash.",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the note relative to vault root" },
              confirmPath: { type: "string", description: "Confirmation: must exactly match the path parameter to proceed with deletion" },
              trashMode: { type: "string", enum: ["none", "local", "system"], description: "Deletion mode: 'none' = permanent delete (default), 'local' = move to .trash inside vault, 'system' = move to OS trash", default: "none" }
            },
            required: ["path", "confirmPath"]
          }
        },
        {
          name: "search_notes",
          description: "Search for notes in the vault by content or frontmatter",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query text" },
              limit: { type: "number", description: "Maximum number of results (default: 5, max: 20)", default: 5 },
              searchContent: { type: "boolean", description: "Search in note content (default: true)", default: true },
              searchFrontmatter: { type: "boolean", description: "Search in frontmatter (default: false)", default: false },
              caseSensitive: { type: "boolean", description: "Case sensitive search (default: false)", default: false },
              pathPrefix: { type: "string", description: "Restrict the search to a vault subtree, e.g. \"Projects/2026\" (directory prefix)" },
              excludePaths: { type: "array", items: { type: "string" }, description: "Skip files under these subtrees, e.g. [\"Archive\", \"meta\"] (directory prefixes)" },
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            },
            required: ["query"]
          }
        },
        {
          name: "move_note",
          description: "Move or rename a note in the vault",
          inputSchema: {
            type: "object",
            properties: {
              oldPath: { type: "string", description: "Current path of the note" },
              newPath: { type: "string", description: "New path for the note" },
              overwrite: { type: "boolean", description: "Allow overwriting existing file (default: false)", default: false }
            },
            required: ["oldPath", "newPath"]
          }
        },
        {
          name: "move_file",
          description: "Move or rename any file in the vault (binary-safe, file-only, requires confirmation)",
          inputSchema: {
            type: "object",
            properties: {
              oldPath: { type: "string", description: "Current path of the file" },
              newPath: { type: "string", description: "New path for the file" },
              confirmOldPath: { type: "string", description: "Confirmation: must exactly match oldPath" },
              confirmNewPath: { type: "string", description: "Confirmation: must exactly match newPath" },
              overwrite: { type: "boolean", description: "Allow overwriting existing file (default: false)", default: false }
            },
            required: ["oldPath", "newPath", "confirmOldPath", "confirmNewPath"]
          }
        },
        {
          name: "read_multiple_notes",
          description: "Read multiple notes in a batch (max 10 files)",
          inputSchema: {
            type: "object",
            properties: {
              paths: { type: "array", items: { type: "string" }, description: "Array of note paths to read", maxItems: 10 },
              includeContent: { type: "boolean", description: "Include note content (default: true)", default: true },
              includeFrontmatter: { type: "boolean", description: "Include frontmatter (default: true)", default: true },
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            },
            required: ["paths"]
          }
        },
        {
          name: "update_frontmatter",
          description: "Update frontmatter of a note without changing content",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the note" },
              frontmatter: { type: "object", description: "Frontmatter object to update" },
              merge: { type: "boolean", description: "Merge with existing frontmatter (default: true)", default: true },
              expectedRevision: { type: "string", description: "Optional revision from read_note; rejects stale updates" }
            },
            required: ["path", "frontmatter"]
          }
        },
        {
          name: "get_notes_info",
          description: "Get metadata for notes without reading full content",
          inputSchema: {
            type: "object",
            properties: {
              paths: { type: "array", items: { type: "string" }, description: "Array of note paths to get info for" },
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            },
            required: ["paths"]
          }
        },
        {
          name: "get_frontmatter",
          description: "Extract frontmatter from a note without reading the content",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the note relative to vault root" },
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            },
            required: ["path"]
          }
        },
        {
          name: "manage_tags",
          description: "Add, remove, or list tags in a note",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the note relative to vault root" },
              operation: { type: "string", enum: ["add", "remove", "list"], description: "Operation to perform: 'add', 'remove', or 'list'" },
              tags: { type: "array", items: { type: "string" }, description: "Array of tags (required for 'add' and 'remove' operations)" }
            },
            required: ["path", "operation"]
          }
        },
        {
          name: "get_vault_stats",
          description: "Get vault statistics including total notes, folders, size, and recently modified files. Useful for understanding vault scope before batch operations.",
          inputSchema: {
            type: "object",
            properties: {
              recentCount: { type: "number", description: "Number of recently modified files to return (default: 5, max: 20)", default: 5 },
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            }
          }
        },
        ...getCollaborationTools(),
        ...getScopeAuthTools(),
        ...getLlmWikiTools(),
        ...getSocialTools(),
        ...getChatTools(),
        ...getReferenceTools(),
        ...getWhisperTools(),
        {
          name: "list_all_tags",
          description: "List all tags across the vault with occurrence counts. Returns both frontmatter tags and inline #hashtags, deduplicated and sorted by frequency. Useful for discovering existing tags before creating or organizing notes.",
          inputSchema: {
            type: "object",
            properties: {
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            }
          }
        },
        {
          name: "list_tasks",
          description: "List checkbox tasks across the vault. Defaults to open tasks; use status=completed or status=all to include completed tasks. Ignores YAML frontmatter and fenced code blocks.",
          inputSchema: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["open", "completed", "all"], description: "Task status to return (default: open)", default: "open" },
              pathPrefix: { type: "string", description: "Restrict results to a vault subtree, e.g. Projects/2026" },
              limit: { type: "number", description: "Maximum tasks to return (default: 100, max: 500)", default: 100 },
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            }
          }
        },
        {
          name: "query_notes",
          description: "Filter notes by structured YAML frontmatter and optionally sort by a frontmatter property. Filters use exact values; array fields match when they contain the requested value(s).",
          inputSchema: {
            type: "object",
            properties: {
              filters: { type: "object", description: "Frontmatter filters, including dot notation for nested properties, e.g. {\"status\": \"active\", \"project\": \"alpha\"}" },
              pathPrefix: { type: "string", description: "Restrict results to a vault subtree, e.g. Projects/2026" },
              sortBy: { type: "string", description: "path (default) or a frontmatter property, including nested dot notation" },
              sortOrder: { type: "string", enum: ["asc", "desc"], description: "Sort direction (default: asc)", default: "asc" },
              limit: { type: "number", description: "Maximum notes to return (default: 100, max: 500)", default: 100 },
              includeContent: { type: "boolean", description: "Include the note body in each result (default: false)", default: false },
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            }
          }
        },
        {
          name: "get_revision_status",
          description: "Check whether Git-backed vault history is initialized and list pending safe vault changes. Ordinary MCP and Obsidian edits remain normal file changes until commit_changes groups them into a meaningful revision.",
          inputSchema: {
            type: "object",
            properties: {
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            }
          }
        },
        {
          name: "initialize_revision_history",
          description: "Initialize a Git repository at the vault root for revision history. Creates no commit and does not configure a remote. Requires explicit confirmation.",
          inputSchema: {
            type: "object",
            properties: {
              confirm: { type: "boolean", description: "Must be true to create the vault .git repository" }
            },
            required: ["confirm"]
          }
        },
        {
          name: "commit_changes",
          description: "Save pending vault file changes as one meaningful Git revision. Uses Git as the only history log; no duplicate audit database and no automatic commit per edit. Restricted paths such as .obsidian and .git are never included.",
          inputSchema: {
            type: "object",
            properties: {
              reason: { type: "string", description: "Required edit summary explaining why these changes belong together" },
              paths: { type: "array", items: { type: "string" }, maxItems: 500, description: "Optional exact vault-relative paths to commit. Omit to commit all safe pending vault changes." },
              authorName: { type: "string", description: "Optional revision author name; must be paired with authorEmail. Defaults to Git configuration." },
              authorEmail: { type: "string", description: "Optional revision author email; must be paired with authorName. Defaults to Git configuration." },
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            },
            required: ["reason"]
          }
        },
        {
          name: "get_note_history",
          description: "Return a note's Git revision history with author, timestamp, and edit reason. Follows renames when Git can detect them.",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Vault-relative note path" },
              limit: { type: "number", description: "Maximum revisions to return (default: 20, max: 100)", default: 20 },
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            },
            required: ["path"]
          }
        },
        {
          name: "compare_note_revisions",
          description: "Show the Git diff for one note between two revisions without invoking external diff tools. toRevision defaults to HEAD.",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Vault-relative note path" },
              fromRevision: { type: "string", description: "Older Git revision, tag, or ref" },
              toRevision: { type: "string", description: "Newer Git revision, tag, or ref (default: HEAD)", default: "HEAD" },
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            },
            required: ["path", "fromRevision"]
          }
        },
        {
          name: "restore_note_revision",
          description: "Restore one note from a Git revision as a new pending file change. Never resets the repository or discards other notes. Refuses to overwrite an already-pending change unless overwritePending=true and requires exact path and revision confirmations.",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Vault-relative note path" },
              revision: { type: "string", description: "Revision to restore from" },
              confirmPath: { type: "string", description: "Must exactly match path" },
              confirmRevision: { type: "string", description: "Must exactly match revision" },
              overwritePending: { type: "boolean", description: "Allow replacing an uncommitted change to this note (default: false)", default: false },
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            },
            required: ["path", "revision", "confirmPath", "confirmRevision"]
          }
        },
        {
          name: "wiki_link",
          description: "Read an Obsidian wiki link. Accepts the same syntax as Obsidian: [[Document Name]] or [[Document Name|Display Text]], including table-authored escapes like [[Document Name\\|Display]] and path-qualified links like [[folder/Document Name]]. A #fragment suffix in the input is ignored. Searches the vault for an exact basename match (or exact vault-relative path match when the name contains '/') and returns the file's content. When multiple files share the basename, picks the first (vault root first, then alphabetical by path) and lists the other paths in structuredContent.alternatives. Content is returned bare — ready for direct use in context.",
          inputSchema: {
            type: "object",
            properties: {
              document: {
                type: "string",
                description: "The document name — what goes inside [[ ]]. e.g. 'My-Document'. Brackets and display text (|...) are stripped if present. The .md extension is always appended (never include it)."
              },
              prettyPrint: {
                type: "boolean",
                description: "Format JSON response with indentation (default: false)",
                default: false
              }
            },
            required: ["document"]
          }
        },
        {
          name: "get_daily_note",
          description: "Read a daily note using the local date or an explicit YYYY-MM-DD date. Defaults to Daily Notes/YYYY-MM-DD.md and never creates or modifies files.",
          inputSchema: {
            type: "object",
            properties: {
              date: { type: "string", description: "today, yesterday, tomorrow, or YYYY-MM-DD (default: today)", default: "today" },
              folder: { type: "string", description: "Daily note folder relative to the vault (default: Daily Notes)", default: "Daily Notes" },
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            }
          }
        },
        {
          name: "daily_note",
          description: "Create or append to a daily note. Create never overwrites an existing note. Append requires content. Defaults to Daily Notes/YYYY-MM-DD.md.",
          inputSchema: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["create", "append"], description: "Operation to perform" },
              date: { type: "string", description: "today, yesterday, tomorrow, or YYYY-MM-DD (default: today)", default: "today" },
              folder: { type: "string", description: "Daily note folder relative to the vault (default: Daily Notes)", default: "Daily Notes" },
              content: { type: "string", description: "Initial content for create, or content to append for append" },
              frontmatter: { type: "object", description: "Optional frontmatter for a newly created note or merged frontmatter for append" }
            },
            required: ["action"]
          }
        },
        {
          name: "find_orphan_notes",
          description: "Find notes with no incoming wikilinks from another note. Self-links and attachment links do not prevent a note from being considered an orphan. Results include the note path and incoming link count.",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "number", description: "Maximum orphan notes to return (default: 100, max: 500)", default: 100 },
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            }
          }
        },
        {
          name: "find_unresolved_links",
          description: "Find broken Obsidian wikilinks across the vault. Returns source paths, line numbers, raw links, targets, and compact context. Explicit links to existing attachments are treated as resolved; fenced code blocks are ignored.",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "number", description: "Maximum unresolved link occurrences to return (default: 100, max: 500)", default: 100 },
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            }
          }
        },
        {
          name: "get_outlinks",
          description: "List the Obsidian wikilinks from a note. Returns destination targets, line numbers, raw link text, and compact line context. Includes embeds, aliases, headings, and path-qualified links; ignores fenced code blocks.",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the source note relative to vault root" },
              limit: { type: "number", description: "Maximum outlink occurrences to return (default: 100, max: 500)", default: 100 },
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            },
            required: ["path"]
          }
        },
        {
          name: "get_backlinks",
          description: "Find notes that link to a target note. Returns matching note paths, line numbers, link text, and compact line context. Scans Obsidian wikilinks including embeds, aliases, headings, and path-qualified links; ignores fenced code blocks.",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the target note relative to vault root" },
              limit: { type: "number", description: "Maximum backlink occurrences to return (default: 100, max: 500)", default: 100 },
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            },
            required: ["path"]
          }
        },
        {
          name: "get_note_outline",
          description: "Get the heading structure of a note without reading its full content. Returns headings with level, text, and line number. Use this first to navigate large notes efficiently, then call read_note_lines to read only the section you need.",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the note relative to vault root" },
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            },
            required: ["path"]
          }
        },
        {
          name: "read_note_lines",
          description: "Read a specific line range from a note. Use after get_note_outline to read only the section you need instead of the full file.",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the note relative to vault root" },
              startLine: { type: "number", description: "First line to read (1-indexed, inclusive)" },
              endLine: { type: "number", description: "Last line to read (1-indexed, inclusive)" },
              prettyPrint: { type: "boolean", description: "Format JSON response with indentation (default: false)", default: false }
            },
            required: ["path", "startLine", "endLine"]
          }
        }
      ];

    for (const tool of tools) {
      if (SCOPE_AUTH_TOOL_NAMES.has(tool.name)) continue;
      const schema = tool.inputSchema as { properties?: Record<string, unknown> };
      schema.properties ||= {};
      schema.properties.accessToken ||= {
        type: "string",
        description: "Optional token from login_scope. Without it, only the public global scope is visible.",
      };
    }

    return {
      tools: readOnly
        ? tools.filter((tool) => !MUTATING_TOOLS.has(tool.name))
        : tools,
    };
  });

  server.setRequestHandler("tools/call", async (request) => {
    const { name: toolName, arguments: args } = request.params;

    if (readOnly && MUTATING_TOOLS.has(toolName)) {
      return {
        content: [{
          type: "text",
          text: `Error: ${toolName} is disabled because MCPVault is running in read-only mode. Restart without --read-only to enable vault mutations.`,
        }],
        isError: true,
      };
    }

    try {
      const rawArgs = args && typeof args === 'object' ? { ...(args as Record<string, unknown>) } : {};

      if (toolName === 'register_scope_account') return jsonResult(await scopeAuth.register(rawArgs as any), rawArgs.prettyPrint as boolean);
      if (toolName === 'login_scope') return jsonResult(await scopeAuth.login(rawArgs as any), rawArgs.prettyPrint as boolean);
      if (toolName === 'logout_scope') return jsonResult(scopeAuth.logout(rawArgs.accessToken), rawArgs.prettyPrint as boolean);
      if (toolName === 'whoami_scope') return jsonResult(scopeAuth.whoami(rawArgs.accessToken), rawArgs.prettyPrint as boolean);
      if (toolName === 'change_scope_password') return jsonResult(await scopeAuth.changePassword(rawArgs as any), rawArgs.prettyPrint as boolean);

      const principal = scopeAuth.authenticate(rawArgs.accessToken);
      const trimmedArgs = trimPaths(rawArgs, scopeAccess, principal);
      const canAccessPath = (path: string) => scopeAccess.canAccessPhysicalPath(path, principal);
      assertImmutableSourceBoundary(toolName, trimmedArgs, scopeAccess);
      switch (toolName) {
        case "get_scope_context": {
          return jsonResult(collaboration.getScopeContext(principal?.modelId, principal?.agentId), trimmedArgs.prettyPrint);
        }

        case "orient_wiki": {
          return jsonResult(await llmWiki.orient(principal), trimmedArgs.prettyPrint);
        }

        case "create_agent_scope": {
          await assertCanManageAgent(fileSystem, principal, trimmedArgs.agentId, trimmedArgs.modelId);
          return jsonResult(await collaboration.createAgentScope(trimmedArgs), trimmedArgs.prettyPrint);
        }

        case "handoff_agent_scope": {
          await assertCanManageAgent(fileSystem, principal, trimmedArgs.agentId);
          return jsonResult(await collaboration.handoffAgentScope(trimmedArgs), trimmedArgs.prettyPrint);
        }

        case "resume_agent_scope": {
          await assertCanManageAgent(fileSystem, principal, trimmedArgs.agentId);
          return jsonResult(await collaboration.resumeAgentScope(trimmedArgs), trimmedArgs.prettyPrint);
        }

        case "read_scoped_note": {
          return jsonResult(await collaboration.readScopedNote({
            path: trimmedArgs.path,
            ...(principal?.modelId && { modelId: principal.modelId }),
            ...(principal?.agentId && { agentId: principal.agentId }),
          }), trimmedArgs.prettyPrint);
        }

        case "search_scoped_notes": {
          return jsonResult(await collaboration.searchScopedNotes({
            query: trimmedArgs.query,
            limit: trimmedArgs.limit,
            searchContent: trimmedArgs.searchContent,
            searchFrontmatter: trimmedArgs.searchFrontmatter,
            caseSensitive: trimmedArgs.caseSensitive,
            ...(principal?.modelId && { modelId: principal.modelId }),
            ...(principal?.agentId && { agentId: principal.agentId }),
          }), trimmedArgs.prettyPrint);
        }

        case "initialize_llm_wiki": {
          const scopeRoot = trimmedArgs.scopeUri || '';
          return jsonResult(await llmWiki.initialize(scopeRoot, actorName(principal, trimmedArgs.actor)), trimmedArgs.prettyPrint);
        }

        case "ingest_source": {
          return jsonResult(await llmWiki.ingestSource({
            ...trimmedArgs,
            scopeRoot: trimmedArgs.scopeUri || '',
            capturedBy: actorName(principal, trimmedArgs.capturedBy),
          }), trimmedArgs.prettyPrint);
        }

        case "publish_knowledge": {
          return jsonResult(await llmWiki.publishKnowledge({
            ...trimmedArgs,
            principal,
            author: actorName(principal, trimmedArgs.author),
          }), trimmedArgs.prettyPrint);
        }

        case "get_wiki_catalog": {
          return jsonResult(await llmWiki.catalog(principal), trimmedArgs.prettyPrint);
        }

        case "lint_wiki": {
          return jsonResult(await llmWiki.lint(principal, trimmedArgs.limit), trimmedArgs.prettyPrint);
        }

        case "report_wiki_issue": {
          return jsonResult(await llmWiki.reportIssue({
            ...trimmedArgs,
            scopeRoot: trimmedArgs.scopeUri || '',
            reportedBy: actorName(principal, trimmedArgs.reportedBy),
          }), trimmedArgs.prettyPrint);
        }

        case "resolve_wiki_issue": {
          return jsonResult(await llmWiki.resolveIssue({
            ...trimmedArgs,
            actor: actorName(principal, trimmedArgs.actor),
          }), trimmedArgs.prettyPrint);
        }

        case "write_journal_entry": {
          return jsonResult(await social.writeJournalEntry({ ...trimmedArgs, principal }), trimmedArgs.prettyPrint);
        }

        case "list_journal_entries": {
          return jsonResult(await social.listJournalEntries({ ...trimmedArgs, principal }), trimmedArgs.prettyPrint);
        }

        case "read_journal_entry": {
          return jsonResult(await social.readJournalEntry({ ...trimmedArgs, principal }), trimmedArgs.prettyPrint);
        }

        case "publish_blog_post": {
          return jsonResult(await social.publishBlogPost({ ...trimmedArgs, principal }), trimmedArgs.prettyPrint);
        }

        case "list_blog_posts": {
          return jsonResult(await social.listBlogPosts({ ...trimmedArgs, principal }), trimmedArgs.prettyPrint);
        }

        case "read_blog_post": {
          return jsonResult(await social.getBlogPost({ ...trimmedArgs, principal }), trimmedArgs.prettyPrint);
        }

        case "comment_on_blog_post": {
          return jsonResult(await social.commentOnBlogPost({ ...trimmedArgs, principal }), trimmedArgs.prettyPrint);
        }

        case "list_blog_comments": {
          return jsonResult(await social.listBlogComments(trimmedArgs), trimmedArgs.prettyPrint);
        }

        case "list_mentions": {
          return jsonResult(await social.listMentions({ ...trimmedArgs, principal }), trimmedArgs.prettyPrint);
        }

        case "read_references": {
          return jsonResult(await references.readFromNote({ ...trimmedArgs, principal }), trimmedArgs.prettyPrint);
        }

        case "create_chat_room": {
          return jsonResult(await chat.createRoom({ ...trimmedArgs, principal }), trimmedArgs.prettyPrint);
        }

        case "list_chat_rooms": {
          return jsonResult(await chat.listRooms(trimmedArgs), trimmedArgs.prettyPrint);
        }

        case "send_chat_message": {
          return jsonResult(await chat.sendMessage({ ...trimmedArgs, principal }), trimmedArgs.prettyPrint);
        }

        case "read_chat_room": {
          return jsonResult(await chat.readRoomWithMessages(trimmedArgs), trimmedArgs.prettyPrint);
        }

        case "send_whisper": {
          return jsonResult(await whispers.send({ ...trimmedArgs, principal }), trimmedArgs.prettyPrint);
        }

        case "list_whispers": {
          return jsonResult(await whispers.list({ ...trimmedArgs, principal }), trimmedArgs.prettyPrint);
        }

        case "create_discussion": {
          return jsonResult(await collaboration.createDiscussion({
            ...trimmedArgs,
            createdBy: actorName(principal, trimmedArgs.createdBy),
          }), trimmedArgs.prettyPrint);
        }

        case "get_discussion": {
          return jsonResult(await collaboration.getDiscussion(trimmedArgs.discussionId), trimmedArgs.prettyPrint);
        }

        case "add_discussion_argument": {
          return jsonResult(await collaboration.addDiscussionArgument({
            ...trimmedArgs,
            actor: actorName(principal, trimmedArgs.actor),
          }), trimmedArgs.prettyPrint);
        }

        case "update_discussion_status": {
          return jsonResult(await collaboration.updateDiscussionStatus({
            ...trimmedArgs,
            actor: actorName(principal, trimmedArgs.actor),
          }), trimmedArgs.prettyPrint);
        }

        case "read_note": {
          const note = await fileSystem.readNote(trimmedArgs.path);
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify({ fm: note.frontmatter, content: note.content, revision: note.revision }, null, indent) }]
          };
        }

        case "write_note": {
          const fm = parseFrontmatter(trimmedArgs.frontmatter);
          await fileSystem.writeNote({
            path: trimmedArgs.path,
            content: trimmedArgs.content,
            ...(fm !== undefined && { frontmatter: fm }),
            mode: trimmedArgs.mode || 'overwrite',
            expectedRevision: trimmedArgs.expectedRevision,
          });
          return {
            content: [{ type: "text", text: `Successfully wrote note: ${trimmedArgs.path} (mode: ${trimmedArgs.mode || 'overwrite'})` }]
          };
        }

        case "patch_note": {
          const result = await fileSystem.patchNote({
            path: trimmedArgs.path,
            oldString: trimmedArgs.oldString,
            newString: trimmedArgs.newString,
            replaceAll: trimmedArgs.replaceAll,
            expectedRevision: trimmedArgs.expectedRevision,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            isError: !result.success
          };
        }

        case "list_directory": {
          const listing = await fileSystem.listDirectory(trimmedArgs.path || '');
          const base = String(trimmedArgs.path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
          listing.directories = listing.directories.filter(name => canAccessPath(base ? `${base}/${name}` : name));
          listing.files = listing.files.filter(name => canAccessPath(base ? `${base}/${name}` : name));
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify({ dirs: listing.directories, files: listing.files }, null, indent) }]
          };
        }

        case "delete_note": {
          const result = await fileSystem.deleteNote({
            path: trimmedArgs.path,
            confirmPath: trimmedArgs.confirmPath,
            trashMode: trimmedArgs.trashMode
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            isError: !result.success
          };
        }

        case "search_notes": {
          const results = trimmedArgs.pathPrefix
            ? (await searchService.search({
                query: trimmedArgs.query,
                limit: trimmedArgs.limit,
                searchContent: trimmedArgs.searchContent,
                searchFrontmatter: trimmedArgs.searchFrontmatter,
                caseSensitive: trimmedArgs.caseSensitive,
                pathPrefix: trimmedArgs.pathPrefix,
                excludePaths: trimmedArgs.excludePaths,
              })).filter(result => canAccessPath(result.p))
            : await collaboration.searchScopedNotes({
                query: trimmedArgs.query,
                limit: trimmedArgs.limit,
                searchContent: trimmedArgs.searchContent,
                searchFrontmatter: trimmedArgs.searchFrontmatter,
                caseSensitive: trimmedArgs.caseSensitive,
                ...(principal?.modelId && { modelId: principal.modelId }),
                ...(principal?.agentId && { agentId: principal.agentId }),
              });
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify(results, null, indent) }]
          };
        }

        case "move_note": {
          const result = await fileSystem.moveNote({
            oldPath: trimmedArgs.oldPath,
            newPath: trimmedArgs.newPath,
            overwrite: trimmedArgs.overwrite
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            isError: !result.success
          };
        }

        case "move_file": {
          const result = await fileSystem.moveFile({
            oldPath: trimmedArgs.oldPath,
            newPath: trimmedArgs.newPath,
            confirmOldPath: trimmedArgs.confirmOldPath,
            confirmNewPath: trimmedArgs.confirmNewPath,
            overwrite: trimmedArgs.overwrite
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            isError: !result.success
          };
        }

        case "read_multiple_notes": {
          const result = await fileSystem.readMultipleNotes({
            paths: trimmedArgs.paths,
            includeContent: trimmedArgs.includeContent,
            includeFrontmatter: trimmedArgs.includeFrontmatter
          });
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: result.successful, err: result.failed }, null, indent) }]
          };
        }

        case "update_frontmatter": {
          const fm = parseFrontmatter(trimmedArgs.frontmatter);
          if (!fm) {
            throw new Error('frontmatter is required');
          }
          await fileSystem.updateFrontmatter({
            path: trimmedArgs.path,
            frontmatter: fm,
            merge: trimmedArgs.merge,
            expectedRevision: trimmedArgs.expectedRevision,
          });
          return {
            content: [{ type: "text", text: `Successfully updated frontmatter for: ${trimmedArgs.path}` }]
          };
        }

        case "get_notes_info": {
          const result = await fileSystem.getNotesInfo(trimmedArgs.paths);
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, indent) }]
          };
        }

        case "get_frontmatter": {
          const note = await fileSystem.readNote(trimmedArgs.path);
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify(note.frontmatter, null, indent) }]
          };
        }

        case "manage_tags": {
          const result = await fileSystem.manageTags({
            path: trimmedArgs.path,
            operation: trimmedArgs.operation,
            tags: trimmedArgs.tags
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            isError: !result.success
          };
        }

        case "get_vault_stats": {
          const recentCount = Math.min(trimmedArgs.recentCount || 5, 20);
          const stats = await fileSystem.getVaultStats(recentCount, canAccessPath);
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify({ notes: stats.totalNotes, folders: stats.totalFolders, size: stats.totalSize, recent: stats.recentlyModified }, null, indent) }]
          };
        }

        case "list_all_tags": {
          const tags = await fileSystem.listAllTags(canAccessPath);
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify(tags, null, indent) }]
          };
        }

        case "list_tasks": {
          const status = trimmedArgs.status || 'open';
          if (status !== 'open' && status !== 'completed' && status !== 'all') {
            throw new Error('status must be open, completed, or all');
          }
          const requestedLimit = trimmedArgs.limit === undefined ? 100 : Number(trimmedArgs.limit);
          if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
            throw new Error('limit must be a positive integer');
          }
          const tasks = await fileSystem.listTasks({
            status,
            pathPrefix: trimmedArgs.pathPrefix,
            limit: Math.min(requestedLimit, 500),
          }, canAccessPath);
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify(tasks, null, indent) }]
          };
        }

        case "query_notes": {
          const requestedLimit = trimmedArgs.limit === undefined ? 100 : Number(trimmedArgs.limit);
          if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
            throw new Error('limit must be a positive integer');
          }
          const result = await fileSystem.queryNotes({
            filters: trimmedArgs.filters,
            pathPrefix: trimmedArgs.pathPrefix,
            sortBy: trimmedArgs.sortBy,
            sortOrder: trimmedArgs.sortOrder,
            limit: Math.min(requestedLimit, 500),
            includeContent: trimmedArgs.includeContent,
          }, canAccessPath);
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, indent) }]
          };
        }

        case "get_revision_status": {
          const status = await gitHistory.status();
          status.pending = status.pending.filter(change => canAccessPath(change.path) && (!change.previousPath || canAccessPath(change.previousPath)));
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify(status, null, indent) }]
          };
        }

        case "initialize_revision_history": {
          if (trimmedArgs.confirm !== true) {
            throw new Error('confirm must be true to initialize revision history');
          }
          const result = await gitHistory.initialize();
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
          };
        }

        case "commit_changes": {
          let commitPaths = trimmedArgs.paths;
          if (!commitPaths) {
            const pending = (await gitHistory.status()).pending
              .filter(change => canAccessPath(change.path) && (!change.previousPath || canAccessPath(change.previousPath)));
            commitPaths = Array.from(new Set(pending.flatMap(change => [change.path, change.previousPath].filter((path): path is string => Boolean(path)))));
          }
          await llmWiki.validateCommitPaths(commitPaths, principal);
          const result = await gitHistory.commitChanges({
            reason: trimmedArgs.reason,
            paths: commitPaths,
            ...(trimmedArgs.authorName !== undefined && { authorName: trimmedArgs.authorName }),
            ...(trimmedArgs.authorEmail !== undefined && { authorEmail: trimmedArgs.authorEmail }),
          });
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, indent) }]
          };
        }

        case "get_note_history": {
          const requestedLimit = trimmedArgs.limit === undefined ? 20 : Number(trimmedArgs.limit);
          if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
            throw new Error('limit must be a positive integer');
          }
          const history = await gitHistory.noteHistory(trimmedArgs.path, Math.min(requestedLimit, 100));
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify(history, null, indent) }]
          };
        }

        case "compare_note_revisions": {
          const result = await gitHistory.compareNoteRevisions(
            trimmedArgs.path,
            trimmedArgs.fromRevision,
            trimmedArgs.toRevision || 'HEAD',
          );
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, indent) }]
          };
        }

        case "restore_note_revision": {
          if (trimmedArgs.confirmPath !== trimmedArgs.path) {
            throw new Error('confirmPath must exactly match path');
          }
          if (trimmedArgs.confirmRevision !== trimmedArgs.revision) {
            throw new Error('confirmRevision must exactly match revision');
          }
          if (!trimmedArgs.overwritePending && await gitHistory.hasPendingChange(trimmedArgs.path)) {
            throw new Error('The note has an uncommitted change. Commit it first or explicitly set overwritePending=true to replace it.');
          }
          const snapshot = await gitHistory.fileAtRevision(trimmedArgs.path, trimmedArgs.revision);
          await fileSystem.writeNote({ path: snapshot.path, content: snapshot.content, mode: 'overwrite' });
          const result = {
            success: true,
            path: snapshot.path,
            revision: snapshot.revision,
            message: `Restored ${snapshot.path} from ${snapshot.revision.slice(0, 12)} as a pending change. Use commit_changes with a restoration reason to save the revision.`,
          };
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, indent) }]
          };
        }

        case "wiki_link":
          return await handleWikiLinkTool(fileSystem, trimmedArgs, canAccessPath);

        case "get_backlinks": {
          const requestedLimit = trimmedArgs.limit === undefined ? 100 : Number(trimmedArgs.limit);
          if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
            throw new Error('limit must be a positive integer');
          }
          const backlinks = await fileSystem.getBacklinks(trimmedArgs.path, Math.min(requestedLimit, 500), canAccessPath);
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify(backlinks, null, indent) }]
          };
        }

        case "get_outlinks": {
          const requestedLimit = trimmedArgs.limit === undefined ? 100 : Number(trimmedArgs.limit);
          if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
            throw new Error('limit must be a positive integer');
          }
          const outlinks = await fileSystem.getOutlinks(trimmedArgs.path, Math.min(requestedLimit, 500));
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify(outlinks, null, indent) }]
          };
        }

        case "find_unresolved_links": {
          const requestedLimit = trimmedArgs.limit === undefined ? 100 : Number(trimmedArgs.limit);
          if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
            throw new Error('limit must be a positive integer');
          }
          const unresolved = await fileSystem.findUnresolvedLinks(Math.min(requestedLimit, 500), canAccessPath);
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify(unresolved, null, indent) }]
          };
        }

        case "get_daily_note": {
          const dailyNote = await fileSystem.getDailyNote(trimmedArgs.date || 'today', trimmedArgs.folder || 'Daily Notes');
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify(dailyNote, null, indent) }]
          };
        }

        case "daily_note": {
          if (trimmedArgs.action !== 'create' && trimmedArgs.action !== 'append') {
            throw new Error('action must be create or append');
          }
          const frontmatter = trimmedArgs.frontmatter === undefined
            ? undefined
            : parseFrontmatter(trimmedArgs.frontmatter);
          const dailyNote = await fileSystem.writeDailyNote({
            action: trimmedArgs.action,
            date: trimmedArgs.date,
            folder: trimmedArgs.folder,
            content: trimmedArgs.content,
            ...(frontmatter !== undefined && { frontmatter }),
          });
          return {
            content: [{ type: "text", text: JSON.stringify(dailyNote, null, 2) }]
          };
        }

        case "find_orphan_notes": {
          const requestedLimit = trimmedArgs.limit === undefined ? 100 : Number(trimmedArgs.limit);
          if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
            throw new Error('limit must be a positive integer');
          }
          const orphans = await fileSystem.findOrphanNotes(Math.min(requestedLimit, 500), canAccessPath);
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify(orphans, null, indent) }]
          };
        }

        case "get_note_outline": {
          const headings = await fileSystem.getNoteOutline(trimmedArgs.path);
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify(headings, null, indent) }]
          };
        }

        case "read_note_lines": {
          const text = await fileSystem.readNoteLines({
            path: trimmedArgs.path,
            startLine: trimmedArgs.startLine,
            endLine: trimmedArgs.endLine
          });
          return {
            content: [{ type: "text", text }]
          };
        }

        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  });

  return server;
}

function trimPaths(args: any, access: ScopeAccessPolicy, principal?: ScopePrincipal): any {
  const trimmed = { ...args };

  for (const key of ['path', 'oldPath', 'newPath', 'confirmPath', 'confirmOldPath', 'confirmNewPath', 'folder', 'pathPrefix', 'scopeUri', 'subjectPath']) {
    if (trimmed[key] && typeof trimmed[key] === 'string') trimmed[key] = access.resolveExternalPath(trimmed[key], principal);
  }
  if (trimmed.sortBy && typeof trimmed.sortBy === 'string') trimmed.sortBy = trimmed.sortBy.trim();

  if (trimmed.paths && Array.isArray(trimmed.paths)) {
    trimmed.paths = trimmed.paths.map((p: any) => typeof p === 'string' ? access.resolveExternalPath(p, principal) : p);
  }

  if (trimmed.excludePaths && Array.isArray(trimmed.excludePaths)) {
    trimmed.excludePaths = trimmed.excludePaths.map((p: any) => typeof p === 'string' ? access.resolveExternalPath(p, principal) : p);
  }

  if (trimmed.evidencePaths && Array.isArray(trimmed.evidencePaths)) {
    trimmed.evidencePaths = trimmed.evidencePaths.map((p: any) => typeof p === 'string' ? access.resolveExternalPath(p, principal) : p);
  }

  if (trimmed.references && Array.isArray(trimmed.references)) {
    trimmed.references = trimmed.references.map((p: any) => typeof p === 'string' ? access.resolveExternalPath(p, principal) : p);
  }

  if (trimmed.evidence && Array.isArray(trimmed.evidence)) {
    trimmed.evidence = trimmed.evidence.map((item: any) =>
      typeof item === 'string' && item.trim().toLowerCase().startsWith('scope://')
        ? access.toPublicPath(access.resolveExternalPath(item, principal))
        : item,
    );
  }

  return trimmed;
}

function assertImmutableSourceBoundary(toolName: string, args: any, access: ScopeAccessPolicy): void {
  const paths: string[] = [];
  if (['write_note', 'patch_note', 'delete_note', 'update_frontmatter', 'restore_note_revision', 'publish_knowledge'].includes(toolName)) {
    if (typeof args.path === 'string') paths.push(args.path);
  }
  if (toolName === 'manage_tags' && args.operation !== 'list' && typeof args.path === 'string') paths.push(args.path);
  if (['move_note', 'move_file'].includes(toolName)) {
    if (typeof args.oldPath === 'string') paths.push(args.oldPath);
    if (typeof args.newPath === 'string') paths.push(args.newPath);
  }
  if (toolName === 'daily_note' && typeof args.folder === 'string') paths.push(args.folder);
  for (const path of paths) access.assertMutationAllowed(path, toolName);
}

async function assertCanManageAgent(
  fileSystem: FileSystemService,
  principal: ScopePrincipal | undefined,
  agentIdInput: unknown,
  modelIdInput?: unknown,
): Promise<void> {
  if (!principal) throw new Error('Login is required to manage a private agent scope');
  const agentId = String(agentIdInput || '').trim().toLowerCase();
  if (!agentId) throw new Error('agentId is required');
  let modelId = typeof modelIdInput === 'string' && modelIdInput.trim() ? modelIdInput.trim().toLowerCase() : undefined;
  if (!modelId) {
    const identityPath = `_scopes/agents/${agentId}/_identity.md`;
    const identity = await fileSystem.readNote(identityPath);
    modelId = String(identity.frontmatter.model_id || '').trim().toLowerCase();
  }
  if (principal.modelId !== modelId) throw new Error(`Access denied: agent '${agentId}' belongs to another model scope`);
  if (principal.role === 'agent' && principal.agentId !== agentId) {
    throw new Error(`Access denied: agent account '${principal.accountId}' cannot manage agent '${agentId}'`);
  }
}

function actorName(principal: ScopePrincipal | undefined, explicit: unknown): string {
  if (principal) return principal.agentId || principal.modelId || principal.accountId;
  const actor = typeof explicit === 'string' ? explicit.trim() : '';
  if (!actor) throw new Error('actor identity is required for a global unauthenticated operation');
  return actor;
}

function jsonResult(value: unknown, prettyPrint?: boolean) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, prettyPrint ? 2 : undefined) }] };
}
