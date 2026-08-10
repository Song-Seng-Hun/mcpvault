/**
 * Server-side syntax highlighting via Shiki, replacing the React-only
 * `react-syntax-highlighter` + hand-rolled Catppuccin Mocha theme object
 * from `CodeBlock.tsx` (per the plan's "Syntax highlighting and icons"
 * section).
 *
 * The FeatureGrid's large card has exactly one static, build-time-known
 * code sample (the search-result JSON snippet). Per the plan
 * ("cached at startup"), it is highlighted once here -- a top-level
 * `await` in an ES module runs once at first import and is cached by the
 * module system for every subsequent import, so no per-request Shiki work
 * happens.
 *
 * Output is trusted, fully server-generated markup (no request/user input
 * ever reaches Shiki here), so callers may pass it to `raw()` -- same
 * audited pattern as `Layout`'s JSON-LD script.
 */
import { codeToHtml } from "shiki";

const THEME = "catppuccin-mocha";

export async function highlightCode(code: string, lang: string): Promise<string> {
  return codeToHtml(code, { lang, theme: THEME });
}
