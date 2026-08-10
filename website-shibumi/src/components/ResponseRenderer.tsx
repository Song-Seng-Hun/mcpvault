/**
 * Renders one demo example's Claude response text, ported from
 * `ResponseRenderer.tsx` (React). The original split the response on
 * ```json fences and ran the JSON half through `react-syntax-highlighter`
 * (Catppuccin Mocha); this version splits identically but highlights the
 * JSON half server-side with Shiki (`highlight.ts`), same audited pattern
 * as `FeatureCard`/`Terminal`.
 *
 * Async because `highlightCode()` is async; `InteractiveDemo` awaits every
 * `ResponseRenderer` call explicitly (Hono JSX does not auto-await elements
 * nested inside `.map()`), matching `FeatureGrid`'s precedent.
 *
 * Raw-HTML audit: `highlightCode()`'s output is passed through `raw()`
 * below. Safe because the only inputs are each demo example's own fixed
 * literal `response` string (defined in `InteractiveDemo.tsx`, never
 * user/request data) -- same audited pattern as `FeatureCard`.
 */
import { raw } from "hono/html";
import { highlightCode } from "../lib/highlight";

export interface ResponseRendererProps {
  response: string;
}

export async function ResponseRenderer({ response }: ResponseRendererProps) {
  const parts = response.split(/```json\n|```/);
  const rendered = await Promise.all(
    parts.map(async (part, index) => {
      if (index % 2 === 1) {
        return { kind: "json" as const, html: await highlightCode(part.trim(), "json") };
      }
      return { kind: "text" as const, text: part };
    }),
  );

  return (
    <div class="demo-response">
      {rendered.map((part) =>
        part.kind === "json" ? (
          <div class="demo-response-code">{raw(part.html)}</div>
        ) : (
          <pre class="demo-response-text">{part.text}</pre>
        ),
      )}
    </div>
  );
}
