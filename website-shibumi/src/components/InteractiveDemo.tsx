/**
 * Demo-page interactive example browser. Ported from `InteractiveDemo.tsx`
 * (React, `client:visible` in demo.astro).
 *
 * Scope for this group (Phase 2, group 7 -- "demo shell and response
 * examples, leaving interactivity for Phase 3"): markup, scoped CSS, and
 * the Markdown counterpart (`public/demo.md`, already ported). Deliberately
 * NOT ported here (Phase 3, per the plan's Alpine section -- "interactive
 * demo and response rendering"):
 *  - tab click handling that swaps the active example
 *  - the "AI is thinking..." typing-delay state
 * Every tab/panel keeps its `data-tab`/`data-content` attribute so Phase 3
 * can hook an `Alpine.data()` module onto this exact markup, same
 * convention as `Terminal.tsx`'s `config-tab`/`config-content`. Only the
 * first example ("patch") is visible by default (`.demo-panel.hidden` on
 * the rest) -- the Astro source's initial `useState(examples[0].id)`.
 *
 * `lucide-react`'s `PenSquare`, `FilePenLine`, `LibraryBig`, `Search`,
 * `Tags` are replaced with the audited inline SVG helpers in `icons.tsx`
 * (`SearchIcon` already existed from the features group).
 *
 * The "AI is thinking..." bouncing-dots state and its markup are Phase 3
 * scope (pure client-side transient state with no server-rendered
 * equivalent), so they are dropped here rather than ported inert.
 */
import { CheckCircleFilledIcon, DownloadIcon, FilePenLineIcon, InfoIcon, LibraryBigIcon, PenSquareIcon, SearchIcon, TagsIcon, type IconProps } from "./icons";
import { ResponseRenderer } from "./ResponseRenderer";
import type { FC } from "hono/jsx";

interface DemoExample {
  id: string;
  title: string;
  icon: FC<IconProps>;
  claude: string;
  response: string;
  details: string[];
}

const EXAMPLES: DemoExample[] = [
  {
    id: "patch",
    title: "Efficient Editing",
    icon: PenSquareIcon,
    claude: "Add the equation for energy-mass equivalence to my physics notes",
    response: `MCP-Obsidian: Using patch_note...

Request:
\`\`\`json
{
  "path": "Physics/Relativity.md",
  "oldString": "## Energy and Mass",
  "newString": "## Energy and Mass\\n\\nE = mc²"
}
\`\`\`

Response:
\`\`\`json
{
  "success": true,
  "path": "Physics/Relativity.md",
  "message": "Successfully replaced 1 occurrence",
  "matchCount": 1
}
\`\`\`

Done! Added Einstein's equation to your notes.
Only the specific section was updated - no full file rewrite needed.`,
    details: [
      "MCP server used patch_note for efficient partial update",
      "Multi-line text replacement performed atomically",
      "Frontmatter and formatting preserved perfectly",
      "10x faster than rewriting entire file",
      "replaceAll defaults to false — fails safely if multiple matches found",
    ],
  },
  {
    id: "write",
    title: "Create Notes",
    icon: FilePenLineIcon,
    claude: "Create a quick note about today's meeting",
    response: `MCP-Obsidian: Using write_note...

Request:
\`\`\`json
{
  "path": "Meetings/Team Sync.md",
  "content": "# Team Sync\\n\\n- Discussed Q1 goals\\n- Action items assigned"
}
\`\`\`

Response:
Successfully wrote note: Meetings/Team Sync.md (mode: overwrite)

Done! I've created your meeting note.`,
    details: [
      "MCP server wrote the complete note to disk",
      "AI generated the structured content",
      "File created atomically with proper formatting",
      "Ready to open and edit in Obsidian",
      "Supports overwrite, append, and prepend modes",
    ],
  },
  {
    id: "read_multiple",
    title: "Read Multiple Notes",
    icon: LibraryBigIcon,
    claude: "Read all my book club notes and give me a summary",
    response: `MCP-Obsidian: Using read_multiple_notes...

Request:
\`\`\`json
{
  "paths": [
    "Reading/The Phoenix Project.md",
    "Reading/Atomic Habits.md",
    "Reading/Deep Work.md"
  ],
  "prettyPrint": true
}
\`\`\`

Response:
\`\`\`json
{
  "ok": [
    {
      "path": "Reading/The Phoenix Project.md",
      "content": "...",
      "frontmatter": {...}
    }
  ],
  "err": []
}
\`\`\`

Done. I've read all 3 notes. Here's a summary:
Common themes across these books: systems thinking, habit formation, and focus. All emphasize the importance of intentional work practices and continuous improvement.`,
    details: [
      "MCP server read multiple files in one request (max 10)",
      "Returns ok (successful) and err (failed) arrays",
      "AI analyzes across multiple documents",
      "More efficient than reading files one-by-one",
      "prettyPrint defaults to false for minimal token usage",
    ],
  },
  {
    id: "frontmatter",
    title: "Manage Frontmatter",
    icon: TagsIcon,
    claude: "Update the status and add tags to my project planning note",
    response: `MCP-Obsidian: Using update_frontmatter...

Request:
\`\`\`json
{
  "path": "Projects/Website Redesign.md",
  "frontmatter": {
    "tags": [
      "project",
      "web-design",
      "priority-high"
    ],
    "status": "in-progress",
    "created": "2025-01-15",
    "updated": "2025-01-20"
  }
}
\`\`\`

Response:
Successfully updated frontmatter for: Projects/Website Redesign.md

Done! I've updated the frontmatter with the new status and tags.`,
    details: [
      "MCP server safely updated YAML frontmatter",
      "Merges with existing frontmatter by default (merge: true)",
      "Updates are performed atomically",
      "Note content remains untouched",
      "YAML is validated before writing to prevent corruption",
    ],
  },
  {
    id: "search",
    title: "Search Content",
    icon: SearchIcon,
    claude: 'Search for "React hooks" in my notes',
    response: `MCP-Obsidian: Using search_notes...

Request:
\`\`\`json
{
  "query": "React hooks",
  "limit": 10,
  "prettyPrint": true
}
\`\`\`

Response:
\`\`\`json
[
  {
    "p": "Development/React Best Practices.md",
    "t": "React Best Practices",
    "ex": "...State **React hooks** provide...",
    "mc": 8,
    "ln": 42
  },
  {
    "p": "Learning/Modern JavaScript.md",
    "t": "Modern JavaScript",
    "ex": "...useEffect are common **React hooks**...",
    "mc": 3,
    "ln": 156
  }
]
\`\`\`

Done. Found 2 notes with 11 total matches across your vault.`,
    details: [
      "MCP server performed full-text search across vault",
      "Token-optimized response: p=path, t=title, ex=excerpt, mc=matchCount, ln=lineNumber",
      "Returns 21-char context excerpts around matches",
      "AI can then read specific files for more details",
      "prettyPrint defaults to false for minimal token usage",
    ],
  },
];

export async function InteractiveDemo() {
  const panels = await Promise.all(
    EXAMPLES.map(async (example, index) => (
      <div class={`demo-panel${index === 0 ? "" : " hidden"}`} data-content={example.id}>
        <div class="demo-messages">
          <div class="demo-message demo-message--user">
            <div class="demo-avatar demo-avatar--user">You</div>
            <div class="demo-bubble">
              <p class="demo-bubble-text">{example.claude}</p>
            </div>
          </div>

          <div class="demo-message demo-message--ai">
            <div class="demo-avatar demo-avatar--ai">AI</div>
            <div class="demo-bubble demo-bubble--ai">
              <ResponseRenderer response={example.response} />
            </div>
          </div>
        </div>

        <div class="demo-details">
          <h3 class="demo-details-title">
            <InfoIcon className="demo-details-icon" />
            Technical Details
          </h3>
          <div class="demo-details-grid">
            {example.details.map((detail) => (
              <div class="demo-detail">
                <CheckCircleFilledIcon className="demo-detail-icon" />
                <span>{detail}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )),
  );

  return (
    <section data-component="interactive-demo" aria-labelledby="demo-heading">
      <div class="demo-inner">
        <div class="demo-header fade-in-on-scroll">
          <h2 id="demo-heading" class="demo-title">
            See It In Action
          </h2>
          <p class="demo-lede">Watch how AI assistants intelligently interact with your Obsidian vault. These examples show real conversations and outcomes.</p>
        </div>

        <div class="demo-tabs fade-in-on-scroll">
          {EXAMPLES.map((example, index) => (
            <button class={`demo-tab${index === 0 ? " active" : ""}`} data-tab={example.id} aria-label={`Show ${example.title} demo`}>
              <example.icon className="icon" />
              <span class="demo-tab-label">{example.title}</span>
            </button>
          ))}
        </div>

        <div class="demo-window fade-in-on-scroll">
          <div class="demo-window-header">
            <div class="demo-window-dots">
              <span class="demo-window-dot demo-window-dot--red" />
              <span class="demo-window-dot demo-window-dot--yellow" />
              <span class="demo-window-dot demo-window-dot--green" />
            </div>
            <span class="demo-window-title">AI Desktop Tool - MCP-Obsidian Active</span>
            <div class="demo-window-status">
              <span class="demo-window-status-dot" />
              <span class="demo-window-status-text">Connected</span>
            </div>
          </div>

          <div class="demo-window-body">{panels}</div>
        </div>

        <div class="demo-cta fade-in-on-scroll">
          <p class="demo-cta-text">Ready to experience this level of AI-powered note management?</p>
          <a href="/install" class="demo-cta-link">
            <DownloadIcon className="icon" />
            Get Started Now
          </a>
        </div>
      </div>
    </section>
  );
}
