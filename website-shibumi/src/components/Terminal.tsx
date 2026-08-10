/**
 * Install-page terminal/config-tab UI. Ported from Terminal.astro.
 *
 * Scope for this group (Phase 2, group 4 -- "install"): markup, scoped CSS,
 * and the Markdown counterpart. Deliberately NOT ported here (Phase 3):
 *  - the vanilla `<script>` that wired `.copy-btn` clicks and `.config-tab`
 *    switching -- becomes named `Alpine.data()` modules per the plan.
 *  - the "Copied!" feedback swap it produced.
 * Every tab/copy control keeps its `data-tab`/`data-content`/`data-copy`
 * attribute so Phase 3 can hook Alpine onto this exact markup; only the
 * "standard" tab is visible by default (`.config-content.hidden` on the
 * rest), matching the Astro source's initial server-rendered state.
 *
 * `lucide-react`'s `Check`, `ChevronDown`, `Compass`, `Globe`, `Lightbulb`,
 * `Lock`, `Pencil`, `Search`, `X`, `Zap`, `FolderOpen`, `Layers` are
 * replaced with the audited inline SVG helpers in `icons.tsx` (`GlobeIcon`
 * and `SearchIcon` already existed from the features group). The raw
 * inline copy-icon `<svg>` (never a `lucide-react` import in the Astro
 * source) is centralized as `CopyIcon` there too, since it repeated 8+
 * times here verbatim.
 *
 * Syntax highlighting: the three JSON config samples that went through
 * `CodeBlock.tsx`'s `react-syntax-highlighter` (`client:only="react"`) are
 * now highlighted server-side with Shiki (`highlight.ts`), same audited
 * `raw()` pattern as `FeatureCard`. The Claude Code CLI command and the
 * OpenAI Codex TOML block were already static, hand-colored `<pre>`/`<span>`
 * markup in the Astro source (no CodeBlock/react involved) -- per the
 * plan's "preserve pre-rendered highlighted markup where static", that
 * markup is ported through `raw()` unchanged (fully server-controlled
 * fixed literals, never request/user data, so `raw()` is safe here too).
 *
 * `--color-border-rgb`/`--color-card-rgb` are referenced by
 * `.config-tab`/`.collapsible-card` below with `rgba(var(--...-rgb,
 * <fallback>), a)`, but neither custom property is defined anywhere in the
 * Astro source's global CSS (confirmed by grep) -- production always
 * renders the literal fallback (63, 63, 70) / (24, 24, 27), not the site's
 * real `--color-border`/`--color-card` hex values. `install.css` preserves
 * that fallback verbatim for parity rather than "fixing" it to the real
 * tokens.
 */
import { raw } from "hono/html";
import {
  CheckIcon,
  ChevronDownIcon,
  CompassIcon,
  CopyIcon,
  FolderOpenIcon,
  GlobeIcon,
  LayersIcon,
  LightbulbIcon,
  LockIcon,
  PencilIcon,
  SearchIcon,
  XIcon,
  ZapIcon,
} from "./icons";
import { highlightCode } from "../lib/highlight";

const STANDARD_CONFIG_JSON = `{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["@bitbonsai/mcpvault@latest", "/path/to/your/vault"]
    }
  }
}`;
const STANDARD_CONFIG_COPY = '{"mcpServers": {"obsidian": {"command": "npx", "args": ["@bitbonsai/mcpvault@latest", "/path/to/your/vault"]}}}';

const CLAUDE_CODE_CLI_COPY = `claude mcp add-json obsidian --scope user '{"type":"stdio","command":"npx","args":["@bitbonsai/mcpvault@latest","/path/to/your/vault"]}'`;

const OPENCODE_CONFIG_JSON = `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "obsidian": {
      "type": "local",
      "command": ["npx", "-y", "@bitbonsai/mcpvault@latest", "/path/to/your/vault"]
    }
  }
}`;
const OPENCODE_CONFIG_COPY = '{"$schema": "https://opencode.ai/config.json", "mcp": {"obsidian": {"type": "local", "command": ["npx", "-y", "@bitbonsai/mcpvault@latest", "/path/to/your/vault"]}}}';
const OPENCODE_CLI_COPY = "opencode mcp add";

const GEMINI_CONFIG_COPY = STANDARD_CONFIG_COPY;
const GEMINI_CLI_COPY = "gemini mcp add obsidian -- npx @bitbonsai/mcpvault@latest /path/to/your/vault";

const CODEX_COPY = `[mcp_servers.obsidian]
command = "npx"
args = ["-y", "@bitbonsai/mcpvault@latest", "/path/to/your/vault"]`;

const INSPECTOR_INSTALL_COPY = "npm install -g @modelcontextprotocol/inspector";
const INSPECTOR_TEST_COPY = "mcp-inspector npx @bitbonsai/mcpvault@latest /path/to/vault";

/** `raw()`-audited: fixed literal, matches the Astro source's own hand-colored spans (Catppuccin Mocha), not Shiki output. */
const CLAUDE_CODE_CLI_HTML =
  '<span style="color: #cba6f7;">claude</span> <span style="color: #89b4fa;">mcp add-json</span> <span style="color: #a6e3a1;">obsidian</span> <span style="color: #fab387;">--scope user</span> <span style="color: #f38ba8;">\'{"type":"stdio","command":"npx","args":["@bitbonsai/mcpvault@latest","/path/to/your/vault"]}\'</span>';

/** `raw()`-audited: fixed literal, same reasoning as `CLAUDE_CODE_CLI_HTML`. */
const CODEX_TOML_HTML = `<span style="color: #cba6f7;">[mcp_servers.obsidian]</span>
<span style="color: #89b4fa;">command</span> <span style="color: #94e2d5;">=</span> <span style="color: #a6e3a1;">"npx"</span>
<span style="color: #89b4fa;">args</span> <span style="color: #94e2d5;">=</span> <span style="color: #cdd6f4;">[</span><span style="color: #a6e3a1;">"-y"</span><span style="color: #cdd6f4;">,</span> <span style="color: #a6e3a1;">"@bitbonsai/mcpvault@latest"</span><span style="color: #cdd6f4;">,</span> <span style="color: #a6e3a1;">"/path/to/your/vault"</span><span style="color: #cdd6f4;">]</span>`;

export async function Terminal() {
  const [standardHtml, opencodeHtml, geminiHtml] = await Promise.all([
    highlightCode(STANDARD_CONFIG_JSON, "json"),
    highlightCode(OPENCODE_CONFIG_JSON, "json"),
    highlightCode(STANDARD_CONFIG_JSON, "json"),
  ]);

  return (
    <section id="install" data-component="terminal" aria-labelledby="terminal-heading">
      <div class="terminal-inner">
        <div class="terminal-intro fade-in-on-scroll">
          <h2 id="terminal-heading" class="terminal-intro-title">
            Quick Install
          </h2>
          <p class="terminal-intro-lede">Get MCPVault running in seconds with any MCP-compatible platform</p>
        </div>

        <div class="terminal-steps">
          {/* Step 1: Configure AI Platform */}
          <div class="terminal-step fade-in-on-scroll">
            <div class="step-heading">
              <div class="step-number">1</div>
              <h3 class="step-title">Configure Your AI Platform</h3>
            </div>

            <div class="terminal-window">
              <div class="terminal-header">
                <span class="terminal-button red" />
                <span class="terminal-button yellow" />
                <span class="terminal-button green" />
                <span class="terminal-window-title">AI Platform Config</span>
              </div>
              <div class="terminal-body">
                <div class="config-tabs">
                  <button class="config-tab active" data-tab="standard">
                    Claude Desktop / ChatGPT+
                  </button>
                  <button class="config-tab" data-tab="claude-code">
                    Claude Code
                  </button>
                  <button class="config-tab" data-tab="gemini-cli">
                    Gemini CLI
                  </button>
                  <button class="config-tab" data-tab="opencode">
                    OpenCode
                  </button>
                  <button class="config-tab" data-tab="codex">
                    OpenAI Codex
                  </button>
                </div>

                {/* Standard config (Claude Desktop / ChatGPT+) */}
                <div class="config-content" data-content="standard">
                  <div class="code-scroll">{raw(standardHtml)}</div>
                  <button class="copy-code-btn copy-btn" data-copy={STANDARD_CONFIG_COPY} title="Copy configuration" aria-label="Copy configuration to clipboard">
                    <CopyIcon className="icon" />
                    <span>Copy code</span>
                  </button>
                </div>

                {/* Claude Code config */}
                <div class="config-content hidden" data-content="claude-code">
                  <div class="info-card info-card--mb">
                    <div class="info-card-row">
                      <ZapIcon className="info-card-icon" />
                      <div class="info-card-body">
                        <p class="info-card-title">Use the CLI</p>
                        <div class="code-scroll">
                          <pre class="cli-command">{raw(CLAUDE_CODE_CLI_HTML)}</pre>
                        </div>
                        <button class="copy-code-btn copy-btn info-card-copy" data-copy={CLAUDE_CODE_CLI_COPY} title="Copy configuration" aria-label="Copy configuration to clipboard">
                          <CopyIcon className="icon" />
                          <span>Copy code</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div class="info-card info-card--tip">
                    <div class="info-card-row">
                      <LightbulbIcon className="info-card-icon" />
                      <div class="info-card-body">
                        <p class="info-card-title">Configuration Scopes</p>
                        <p class="info-card-text">Claude Code supports three configuration scopes:</p>
                        <div class="info-card-list">
                          <div class="info-card-list-row">
                            <code class="code-chip code-chip--pill">--scope user</code>
                            <span class="info-card-list-desc">Available across all your projects (recommended)</span>
                          </div>
                          <div class="info-card-list-row">
                            <code class="code-chip code-chip--pill">--scope project</code>
                            <span class="info-card-list-desc">Team-shared via .mcp.json file</span>
                          </div>
                          <div class="info-card-list-row">
                            <code class="code-chip code-chip--pill">--scope local</code>
                            <span class="info-card-list-desc">Current project only (private)</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="info-card info-card--tip">
                    <div class="info-card-row">
                      <LightbulbIcon className="info-card-icon" />
                      <div class="info-card-body">
                        <p class="info-card-title">Usage Examples</p>
                        <p class="info-card-text">After configuration, Claude Code can access your vault:</p>
                        <div class="usage-examples">
                          <code class="code-chip code-chip--example">Read my meeting notes from yesterday</code>
                          <code class="code-chip code-chip--example">Search my vault for notes about machine learning</code>
                          <code class="code-chip code-chip--example">Create a new note summarizing our discussion</code>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* OpenCode config */}
                <div class="config-content hidden" data-content="opencode">
                  <div class="info-card">
                    <div class="info-card-row">
                      <ZapIcon className="info-card-icon" />
                      <div class="info-card-body">
                        <p class="info-card-title">Use the CLI</p>
                        <code class="code-chip code-chip--cli">{OPENCODE_CLI_COPY}</code>
                        <button class="copy-code-btn copy-btn info-card-copy" data-copy={OPENCODE_CLI_COPY} title="Copy command" aria-label="Copy command to clipboard">
                          <CopyIcon className="icon" />
                          <span>Copy code</span>
                        </button>
                        <p class="info-card-hint">
                          Interactive wizard — select <strong class="info-card-hint-strong">local</strong>, then enter the command:{" "}
                          <code class="code-chip code-chip--plain">npx -y @bitbonsai/mcpvault@latest /path/to/your/vault</code>
                        </p>
                      </div>
                    </div>
                  </div>

                  <p class="config-content-note">Or configure manually:</p>
                  <div class="code-scroll">{raw(opencodeHtml)}</div>
                  <button class="copy-code-btn copy-btn" data-copy={OPENCODE_CONFIG_COPY} title="Copy configuration" aria-label="Copy configuration to clipboard">
                    <CopyIcon className="icon" />
                    <span>Copy code</span>
                  </button>

                  <div class="info-card info-card--tip">
                    <div class="info-card-row">
                      <LightbulbIcon className="info-card-icon" />
                      <div class="info-card-body">
                        <p class="info-card-title">Configuration Scopes</p>
                        <p class="info-card-text">OpenCode supports multiple config locations:</p>
                        <div class="info-card-list">
                          <div class="info-card-list-row">
                            <code class="code-chip code-chip--pill">opencode.json</code>
                            <span class="info-card-list-desc">In your project root for per-project config (recommended)</span>
                          </div>
                          <div class="info-card-list-row">
                            <code class="code-chip code-chip--pill">~/.config/opencode/opencode.json</code>
                            <span class="info-card-list-desc">Global config for all projects</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="info-card info-card--tip">
                    <div class="info-card-row">
                      <LightbulbIcon className="info-card-icon" />
                      <div class="info-card-body">
                        <p class="info-card-title">Usage Examples</p>
                        <p class="info-card-text">After configuration, OpenCode can access your vault:</p>
                        <div class="usage-examples">
                          <code class="code-chip code-chip--example">Read my meeting notes from yesterday</code>
                          <code class="code-chip code-chip--example">Search my vault for notes about machine learning</code>
                          <code class="code-chip code-chip--example">Create a new note summarizing our discussion</code>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Gemini CLI config */}
                <div class="config-content hidden" data-content="gemini-cli">
                  <div class="info-card info-card--mb">
                    <div class="info-card-row">
                      <ZapIcon className="info-card-icon" />
                      <div class="info-card-body">
                        <p class="info-card-title">Use the CLI</p>
                        <code class="code-chip code-chip--cli">{GEMINI_CLI_COPY}</code>
                        <button class="copy-code-btn copy-btn info-card-copy" data-copy={GEMINI_CLI_COPY} title="Copy command" aria-label="Copy command to clipboard">
                          <CopyIcon className="icon" />
                          <span>Copy code</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <p class="config-content-note">
                    Or configure manually in <code class="code-chip code-chip--plain">~/.gemini/settings.json</code>:
                  </p>
                  <div class="code-scroll">{raw(geminiHtml)}</div>
                  <button class="copy-code-btn copy-btn" data-copy={GEMINI_CONFIG_COPY} title="Copy configuration" aria-label="Copy configuration to clipboard">
                    <CopyIcon className="icon" />
                    <span>Copy code</span>
                  </button>

                  <div class="info-card info-card--tip">
                    <div class="info-card-row">
                      <LightbulbIcon className="info-card-icon" />
                      <div class="info-card-body">
                        <p class="info-card-title">Usage Examples</p>
                        <p class="info-card-text">After configuration, use commands like:</p>
                        <div class="usage-examples">
                          <code class="code-chip code-chip--example">Read my daily note from yesterday</code>
                          <code class="code-chip code-chip--example">Search my vault for meeting notes</code>
                          <code class="code-chip code-chip--example">Create a new note about project ideas</code>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* OpenAI Codex config (TOML) */}
                <div class="config-content hidden" data-content="codex">
                  <div class="code-scroll">
                    <pre class="cli-command cli-command--toml">{raw(CODEX_TOML_HTML)}</pre>
                  </div>
                  <button class="copy-code-btn copy-btn" data-copy={CODEX_COPY} title="Copy configuration" aria-label="Copy configuration to clipboard">
                    <CopyIcon className="icon" />
                    <span>Copy code</span>
                  </button>

                  <div class="info-card info-card--tip">
                    <div class="info-card-row">
                      <LightbulbIcon className="info-card-icon" />
                      <div class="info-card-body">
                        <p class="info-card-title">Usage Examples</p>
                        <p class="info-card-text">After configuration, interact with your vault naturally:</p>
                        <div class="usage-examples">
                          <code class="code-chip code-chip--example">Show me my recent journal entries</code>
                          <code class="code-chip code-chip--example">Find notes tagged with #project</code>
                          <code class="code-chip code-chip--example">Update my todo list with new tasks</code>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="terminal-notes">
              <div class="note-card">
                <p class="note-card-text">
                  <CompassIcon className="note-card-icon" />
                  <span>
                    <strong class="note-card-strong">Optional no-path mode:</strong> if your client starts MCPVault from inside your vault folder, you can omit the vault path and use current
                    working directory.
                  </span>
                </p>
                <div class="note-card-grid">
                  <code class="code-chip code-chip--block">npx @bitbonsai/mcpvault@latest</code>
                  <code class="code-chip code-chip--block">"args": ["@bitbonsai/mcpvault@latest"]</code>
                </div>
              </div>

              <div class="note-card">
                <p class="note-card-text">
                  <LockIcon className="note-card-icon" />
                  <span>
                    <strong class="note-card-strong">Read-only mode:</strong> add <code class="code-chip code-chip--pill-inline">--read-only</code> after the vault path. Mutating tools are
                    hidden from discovery and rejected if called directly.
                  </span>
                </p>
                <code class="code-chip code-chip--block code-chip--example">"args": ["@bitbonsai/mcpvault@latest", "/path/to/vault", "--read-only"]</code>
              </div>

              <div class="note-card">
                <p class="note-card-text note-card-text--small">
                  <FolderOpenIcon className="note-card-icon" />
                  <span>
                    Supported note file types: <code class="code-chip code-chip--pill-inline">.md</code>, <code class="code-chip code-chip--pill-inline">.markdown</code>,{" "}
                    <code class="code-chip code-chip--pill-inline">.txt</code>, <code class="code-chip code-chip--pill-inline">.base</code>, and{" "}
                    <code class="code-chip code-chip--pill-inline">.canvas</code>.
                  </span>
                </p>
              </div>
            </div>

            {/* Optional setup details */}
            <div class="setup-details">
              <div class="info-card info-card--highlight">
                <p class="setup-details-note">
                  <ZapIcon className="info-card-icon" />
                  <span>
                    <strong>No pre-installation needed!</strong> npx automatically downloads and runs the server when needed.
                  </span>
                </p>
              </div>

              <details class="collapsible-card">
                <summary class="collapsible-summary">
                  <ChevronDownIcon className="collapsible-chevron" />
                  <span class="collapsible-summary-text">
                    <strong>Config file locations</strong>
                  </span>
                </summary>

                <div class="collapsible-content config-locations">
                  <div>
                    <div class="config-locations-heading">Claude Desktop (JSON)</div>
                    <div class="config-locations-body">
                      <div>
                        macOS: <code class="code-chip code-chip--pill-inline">~/Library/Application Support/Claude/claude_desktop_config.json</code>
                      </div>
                      <div>
                        Windows: <code class="code-chip code-chip--pill-inline">%APPDATA%\Claude\claude_desktop_config.json</code>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div class="config-locations-heading">Claude Code (CLI)</div>
                    <div class="config-locations-body">
                      <div>
                        User scope: <code class="code-chip code-chip--pill-inline">~/.claude.json</code>
                      </div>
                      <div class="config-locations-hint">
                        Use <code class="code-chip code-chip--pill-inline">claude mcp add-json --scope user</code> for global access
                      </div>
                    </div>
                  </div>
                  <div>
                    <div class="config-locations-heading">ChatGPT+ Desktop (JSON)</div>
                    <div class="config-locations-body">
                      <div>
                        macOS: <code class="code-chip code-chip--pill-inline">~/Library/Application Support/ChatGPT/chatgpt_config.json</code>
                      </div>
                      <div>
                        Windows: <code class="code-chip code-chip--pill-inline">%APPDATA%\ChatGPT\chatgpt_config.json</code>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div class="config-locations-heading">Gemini CLI (JSON)</div>
                    <div class="config-locations-body">
                      <div>
                        All platforms: <code class="code-chip code-chip--pill-inline">~/.gemini/settings.json</code>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div class="config-locations-heading">OpenCode (JSON)</div>
                    <div class="config-locations-body">
                      <div>
                        Per project: <code class="code-chip code-chip--pill-inline">opencode.json</code>
                      </div>
                      <div>
                        Global: <code class="code-chip code-chip--pill-inline">~/.config/opencode/opencode.json</code>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div class="config-locations-heading">OpenAI Codex (TOML)</div>
                    <div class="config-locations-body">
                      <div>
                        macOS/Linux: <code class="code-chip code-chip--pill-inline">~/.codex/config.toml</code>
                      </div>
                      <div>
                        Windows: <code class="code-chip code-chip--pill-inline">%USERPROFILE%\.codex\config.toml</code>
                      </div>
                    </div>
                  </div>
                </div>
              </details>

              <details class="collapsible-card">
                <summary class="collapsible-summary">
                  <ChevronDownIcon className="collapsible-chevron" />
                  <span class="collapsible-summary-text">
                    <strong>Need your vault path?</strong>
                  </span>
                </summary>

                <div class="collapsible-content vault-path-help">
                  <div class="vault-path-grid">
                    <div>
                      <span class="vault-path-os">macOS:</span> In Finder, right-click your vault folder while holding <code class="code-chip code-chip--pill-inline">Option</code> and choose{" "}
                      <span class="vault-path-emphasis">Copy "..." as Pathname</span>.
                    </div>
                    <div>
                      <span class="vault-path-os">Windows:</span> In File Explorer, hold <code class="code-chip code-chip--pill-inline">Shift</code>, right-click your vault folder, and choose{" "}
                      <span class="vault-path-emphasis">Copy as path</span>.
                    </div>
                    <div class="vault-path-grid-full">
                      <span class="vault-path-os">Linux:</span> Open a terminal in your vault folder and run <code class="code-chip code-chip--pill-inline">pwd</code>.
                    </div>
                  </div>

                  <p>
                    Replace <code class="code-chip code-chip--pill-inline">/path/to/your/vault</code> with that full absolute path.
                  </p>

                  <div class="info-card info-card--highlight">
                    <p class="vault-path-cwd-heading">
                      <CompassIcon className="info-card-icon" />
                      <strong>Optional CWD mode</strong>
                    </p>
                    <p class="vault-path-cwd-text">
                      You can omit the vault path entirely when your client starts this server from inside your vault directory. In that case, MCPVault uses the current working directory as vault
                      root.
                    </p>
                    <div class="vault-path-cwd-examples">
                      <code class="code-chip code-chip--block">npx @bitbonsai/mcpvault@latest</code>
                      <code class="code-chip code-chip--block">npm start</code>
                    </div>
                  </div>
                </div>
              </details>
            </div>
          </div>

          {/* Step 2: Developers - MCP Inspector */}
          <div class="terminal-step fade-in-on-scroll">
            <div class="step-heading">
              <div class="step-number step-number--accent-2">2</div>
              <h3 class="step-title">Developers: Test with MCP Inspector</h3>
            </div>

            <div class="terminal-window">
              <div class="terminal-header">
                <span class="terminal-button red" />
                <span class="terminal-button yellow" />
                <span class="terminal-button green" />
                <span class="terminal-window-title">Terminal</span>
              </div>
              <div class="terminal-body">
                <div class="inspector-commands">
                  <div class="inspector-comment"># Install MCP Inspector globally</div>
                  <div class="inspector-command-row">
                    <span class="inspector-prompt">$</span>
                    <span class="inspector-command-text">npm install -g @modelcontextprotocol/inspector</span>
                    <button class="inspector-copy-btn copy-btn" data-copy={INSPECTOR_INSTALL_COPY} title="Copy to clipboard" aria-label="Copy npm install command to clipboard">
                      <CopyIcon className="icon" />
                    </button>
                  </div>

                  <div class="inspector-comment"># Test MCPVault server</div>
                  <div class="inspector-command-row">
                    <span class="inspector-prompt">$</span>
                    <span class="inspector-command-text">mcp-inspector npx @bitbonsai/mcpvault@latest /path/to/vault</span>
                    <button class="inspector-copy-btn copy-btn" data-copy={INSPECTOR_TEST_COPY} title="Copy to clipboard" aria-label="Copy test command to clipboard">
                      <CopyIcon className="icon" />
                    </button>
                  </div>

                  <div class="inspector-success">
                    <span class="inspector-success-row">
                      <GlobeIcon className="icon" />
                      Opens interactive web interface at http://localhost:5173
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div class="inspector-note">
              <p class="inspector-note-lede">
                <SearchIcon className="inspector-note-icon" />
                <span>
                  <strong>MCP Inspector</strong> provides a web UI to test all MCP methods interactively.
                </span>
              </p>
              <div class="inspector-list">
                <div class="inspector-list-label">Perfect for:</div>
                <ul class="inspector-list-items">
                  <li>Testing server functionality before integration</li>
                  <li>Debugging MCP method calls and responses</li>
                  <li>Exploring available tools and resources</li>
                  <li>Development and troubleshooting</li>
                </ul>
                <div class="inspector-github">
                  <svg class="inspector-github-bullet" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path
                      fill-rule="evenodd"
                      clip-rule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    />
                  </svg>
                  <a href="https://github.com/bitbonsai/mcpvault" target="_blank" rel="noopener noreferrer" class="inspector-github-link">
                    View on GitHub for more details
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Other Platforms */}
          <div class="terminal-step fade-in-on-scroll">
            <div class="platforms-banner">
              <p class="platforms-banner-text">
                <span class="platforms-banner-row">
                  <GlobeIcon className="icon" />
                  <span>
                    <strong>Works with all MCP-compatible platforms:</strong> Claude Desktop, ChatGPT+, Claude Code, OpenCode, Gemini CLI, Cursor IDE, Windsurf, and more coming soon!
                  </span>
                </span>
                <br />
                Use the same configuration with your platform's MCP server settings.
              </p>
            </div>
            <div class="privacy-card">
              <p class="privacy-heading">
                <LockIcon className="icon" />
                <strong class="privacy-heading-strong">What "private" means:</strong>
              </p>

              <div class="privacy-list">
                <div class="privacy-item">
                  <CheckIcon className="privacy-icon privacy-icon--success" />
                  <span>Your vault files stay on your computer</span>
                </div>

                <div class="privacy-item">
                  <CheckIcon className="privacy-icon privacy-icon--success" />
                  <span>We never see, store, or transmit your data</span>
                </div>

                <div class="privacy-item">
                  <CheckIcon className="privacy-icon privacy-icon--success" />
                  <span>Only you and your AI assistant can access your notes</span>
                </div>

                <div class="privacy-item">
                  <XIcon className="privacy-icon privacy-icon--error" />
                  <span>AI providers (Anthropic, OpenAI) process content you share with them</span>
                </div>
              </div>

              <div class="privacy-footer">
                <p class="privacy-footer-text">For commercial Claude users: Your data won't be used for AI training.</p>
              </div>
            </div>
          </div>

          {/* Success message */}
          <div class="terminal-step fade-in-on-scroll">
            <div class="success-card">
              <div class="success-heading">
                <div class="success-icon">
                  <CheckIcon className="icon" />
                </div>
                <h3 class="success-title">You're all set!</h3>
              </div>
              <p class="success-text">Restart your AI platform and you'll see MCPVault connected. Your AI assistant can now safely read, search, and manage your Obsidian vault.</p>
              <div class="success-badges">
                <span class="success-badge">
                  <SearchIcon className="icon" />
                  Search notes
                </span>
                <span class="success-badge">
                  <PencilIcon className="icon" />
                  Edit content
                </span>
                <span class="success-badge">
                  <FolderOpenIcon className="icon" />
                  Organize files
                </span>
                <span class="success-badge">
                  <LayersIcon className="icon" />
                  Batch operations
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
