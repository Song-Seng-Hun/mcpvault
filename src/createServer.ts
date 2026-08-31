import { Server, type Tool } from "@modelcontextprotocol/server";
import { FileSystemService } from "./filesystem.js";
import { FrontmatterHandler, parseFrontmatter } from "./frontmatter.js";
import { PathFilter } from "./pathfilter.js";
import { SearchService } from "./search.js";
import { handleWikiLinkTool } from "./wikilink/index.js";
import { GitHistoryService } from "./git-history.js";
import { resolve } from "path";

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

  const server = new Server({ name, version }, {
    capabilities: { tools: {} },
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
              mode: { type: "string", enum: ["overwrite", "append", "prepend"], description: "Write mode: 'overwrite' (default), 'append', or 'prepend'", default: "overwrite" }
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
              replaceAll: { type: "boolean", description: "If true, replace all occurrences. If false (default), the operation will fail if multiple matches are found to prevent unintended replacements.", default: false }
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
              merge: { type: "boolean", description: "Merge with existing frontmatter (default: true)", default: true }
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

    return {
      tools: readOnly
        ? tools.filter((tool) => !MUTATING_TOOLS.has(tool.name))
        : tools,
    };
  });

  server.setRequestHandler("tools/call", async (request) => {
    const { name: toolName, arguments: args } = request.params;
    const trimmedArgs = trimPaths(args);

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
      switch (toolName) {
        case "read_note": {
          const note = await fileSystem.readNote(trimmedArgs.path);
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify({ fm: note.frontmatter, content: note.content }, null, indent) }]
          };
        }

        case "write_note": {
          const fm = parseFrontmatter(trimmedArgs.frontmatter);
          await fileSystem.writeNote({
            path: trimmedArgs.path,
            content: trimmedArgs.content,
            ...(fm !== undefined && { frontmatter: fm }),
            mode: trimmedArgs.mode || 'overwrite'
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
            replaceAll: trimmedArgs.replaceAll
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            isError: !result.success
          };
        }

        case "list_directory": {
          const listing = await fileSystem.listDirectory(trimmedArgs.path || '');
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
          const results = await searchService.search({
            query: trimmedArgs.query,
            limit: trimmedArgs.limit,
            searchContent: trimmedArgs.searchContent,
            searchFrontmatter: trimmedArgs.searchFrontmatter,
            caseSensitive: trimmedArgs.caseSensitive,
            pathPrefix: trimmedArgs.pathPrefix,
            excludePaths: trimmedArgs.excludePaths
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
            merge: trimmedArgs.merge
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
          const stats = await fileSystem.getVaultStats(recentCount);
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify({ notes: stats.totalNotes, folders: stats.totalFolders, size: stats.totalSize, recent: stats.recentlyModified }, null, indent) }]
          };
        }

        case "list_all_tags": {
          const tags = await fileSystem.listAllTags();
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
          });
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
          });
          const indent = trimmedArgs.prettyPrint ? 2 : undefined;
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, indent) }]
          };
        }

        case "get_revision_status": {
          const status = await gitHistory.status();
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
          const result = await gitHistory.commitChanges({
            reason: trimmedArgs.reason,
            ...(trimmedArgs.paths !== undefined && { paths: trimmedArgs.paths }),
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
          return await handleWikiLinkTool(fileSystem, trimmedArgs);

        case "get_backlinks": {
          const requestedLimit = trimmedArgs.limit === undefined ? 100 : Number(trimmedArgs.limit);
          if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
            throw new Error('limit must be a positive integer');
          }
          const backlinks = await fileSystem.getBacklinks(trimmedArgs.path, Math.min(requestedLimit, 500));
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
          const unresolved = await fileSystem.findUnresolvedLinks(Math.min(requestedLimit, 500));
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
          const orphans = await fileSystem.findOrphanNotes(Math.min(requestedLimit, 500));
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

function trimPaths(args: any): any {
  const trimmed = { ...args };

  if (trimmed.path && typeof trimmed.path === 'string') trimmed.path = trimmed.path.trim();
  if (trimmed.oldPath && typeof trimmed.oldPath === 'string') trimmed.oldPath = trimmed.oldPath.trim();
  if (trimmed.newPath && typeof trimmed.newPath === 'string') trimmed.newPath = trimmed.newPath.trim();
  if (trimmed.confirmPath && typeof trimmed.confirmPath === 'string') trimmed.confirmPath = trimmed.confirmPath.trim();
  if (trimmed.confirmOldPath && typeof trimmed.confirmOldPath === 'string') trimmed.confirmOldPath = trimmed.confirmOldPath.trim();
  if (trimmed.confirmNewPath && typeof trimmed.confirmNewPath === 'string') trimmed.confirmNewPath = trimmed.confirmNewPath.trim();
  if (trimmed.folder && typeof trimmed.folder === 'string') trimmed.folder = trimmed.folder.trim();
  if (trimmed.pathPrefix && typeof trimmed.pathPrefix === 'string') trimmed.pathPrefix = trimmed.pathPrefix.trim();
  if (trimmed.sortBy && typeof trimmed.sortBy === 'string') trimmed.sortBy = trimmed.sortBy.trim();

  if (trimmed.paths && Array.isArray(trimmed.paths)) {
    trimmed.paths = trimmed.paths.map((p: any) => typeof p === 'string' ? p.trim() : p);
  }

  return trimmed;
}
