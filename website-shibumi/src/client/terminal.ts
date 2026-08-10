/**
 * Alpine.data() module backing the install page's Terminal section
 * (`Terminal.tsx`). Ported from `Terminal.astro`'s vanilla `<script>`:
 * `.config-tab` clicks swapped the visible `.config-content` panel, and
 * `.copy-btn` clicks wrote `data-copy` to the clipboard with a 2s "Copied!"
 * feedback swap.
 *
 * Registered under the name `terminal` in `alpine.ts`. `Terminal.tsx` only
 * ever *names* this module and its methods in HTML attributes
 * (`x-data="terminal"`, `x-on:click="selectTab('standard')"`,
 * `x-bind:class="{ active: activeTab === 'standard' }"`,
 * `x-on:click="copy($el.dataset.copy)"`, `x-text="copiedText ===
 * $el.closest('button').dataset.copy ? 'Copied!' : 'Copy code'"`) -- every
 * attribute above is grammar the `@alpinejs/csp` build's restricted
 * evaluator accepts (bare identifiers, `===`/`!==`, ternaries, member/call
 * expressions on `$el`), never an inline function body.
 *
 * Every copy button reads its own payload from `$el.dataset.copy` (the
 * `data-copy` attribute the server already rendered) instead of the
 * template naming each payload as an inline string literal -- several of
 * these payloads (the Claude Code CLI command) contain single quotes,
 * which would otherwise have to be re-escaped to survive the CSP
 * tokenizer's own string-literal grammar. Reading the attribute the
 * template already has sidesteps that entirely, and matches the original
 * vanilla script's own `button.getAttribute('data-copy')`.
 *
 * Maintainer decision 2026-08-10 (`.plans/shibumi-website-migration.md`,
 * "demo-purpose only, keep it simple"): this module also drives a
 * lightweight typing animation for the two MCP Inspector command lines
 * (Step 2's terminal window) -- a purely cosmetic, demo-only addition with
 * no production equivalent, kept intentionally small: one char revealed
 * per tick, one line at a time, via `typed` (an array of in-progress
 * strings, same length as `commands`) so a template can `x-text="typed[0]"`
 * /`x-text="typed[1]"` a line's current progress. `nextTypedState()` is a
 * pure, unit-testable step function; `startTyping()` is the thin
 * interval-driving wrapper around it, with the interval/step delay
 * injectable so tests don't need real timers.
 */
export interface CopyClipboard {
  writeText(text: string): Promise<void>;
}

export interface TerminalData {
  activeTab: string;
  copiedText: string | null;
  typed: string[];
  selectTab(this: TerminalData, id: string): void;
  copy(this: TerminalData, text: string | undefined): Promise<void>;
  startTyping(this: TerminalData): void;
}

export const DEFAULT_TAB = "standard";
export const COPIED_FEEDBACK_MS = 2000;
export const TYPING_TICK_MS = 25;

/**
 * Mirrors `Terminal.tsx`'s `INSPECTOR_INSTALL_COPY`/`INSPECTOR_TEST_COPY`
 * exactly. Duplicated here, not imported, the same way `interactive-demo.ts`
 * doesn't import from `InteractiveDemo.tsx`: this module is bundled for the
 * browser (`client-bundle.ts`, `target: "browser"`) and must not pull in
 * `Terminal.tsx`'s server-only imports (`hono/jsx`, `hono/html`, Shiki).
 */
export const INSPECTOR_COMMANDS: readonly string[] = ["npm install -g @modelcontextprotocol/inspector", "mcp-inspector npx @bitbonsai/mcpvault@latest /path/to/vault"];

/** One char revealed per call, one line completed before the next starts. Pure and unit-testable. */
export function nextTypedState(commands: readonly string[], typed: readonly string[]): string[] {
  const next = [...typed];
  for (let i = 0; i < commands.length; i++) {
    const current = next[i] ?? "";
    if (current.length < commands[i]!.length) {
      next[i] = commands[i]!.slice(0, current.length + 1);
      return next;
    }
  }
  return next;
}

export function isTypingDone(commands: readonly string[], typed: readonly string[]): boolean {
  return commands.every((command, i) => (typed[i]?.length ?? 0) >= command.length);
}

/**
 * @param commands The full text of every command line to animate, in order.
 * @param clipboard Injectable so tests don't need a real Clipboard API.
 * @param tickMs Injectable so tests don't need real timers.
 * @param feedbackMs Injectable so tests don't need real timers.
 */
export function terminal(
  commands: readonly string[] = INSPECTOR_COMMANDS,
  clipboard: CopyClipboard = navigator.clipboard,
  tickMs: number = TYPING_TICK_MS,
  feedbackMs: number = COPIED_FEEDBACK_MS,
): TerminalData {
  return {
    activeTab: DEFAULT_TAB,
    copiedText: null,
    typed: commands.map(() => ""),
    selectTab(id) {
      if (id === this.activeTab) return;
      this.activeTab = id;
    },
    async copy(text) {
      if (!text) return;
      try {
        await clipboard.writeText(text);
      } catch {
        // Clipboard write denied/unsupported: leave the button as-is rather
        // than showing "Copied!" feedback for a copy that didn't happen.
        return;
      }
      this.copiedText = text;
      setTimeout(() => {
        if (this.copiedText === text) this.copiedText = null;
      }, feedbackMs);
    },
    startTyping() {
      if (commands.length === 0) return;
      const interval = setInterval(() => {
        this.typed = nextTypedState(commands, this.typed);
        if (isTypingDone(commands, this.typed)) clearInterval(interval);
      }, tickMs);
    },
  };
}
