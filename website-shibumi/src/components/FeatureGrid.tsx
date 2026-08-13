/**
 * "Core Features" bento grid. Ported from FeatureGrid.astro. `FeatureCard`
 * is async (Shiki highlighting on the large card), so this component is
 * async too and awaits each card explicitly before composing the grid --
 * Hono JSX does not auto-await elements nested inside `.map()`.
 */
import { FeatureCard } from "./FeatureCard";

const SEARCH_CODE_EXAMPLE = `[
  {
    "p": "Notes/GTD.md",
    "t": "GTD",
    "ex": "...getting things done...",
    "mc": 5,
    "ln": 12
  },
  {
    "p": "Books/Deep Work.md",
    "t": "Deep Work",
    "ex": "...focus and productivity...",
    "mc": 8,
    "ln": 45
  }
]`;

const FRONTMATTER_EXAMPLE = `{
  "status": "completed",
  "tags": ["web", "typescript"],
  "completed": "2025-01-20"
}`;

export async function FeatureGrid() {
  const cards = await Promise.all([
    FeatureCard({
      title: "Powerful Search",
      description: "Fast full-text search with multi-word matching and BM25 relevance ranking. AI can locate notes by content, tags, or metadata instantly.",
      icon: "search",
      size: "large",
      accent: true,
      codeExample: SEARCH_CODE_EXAMPLE,
    }),
    FeatureCard({
      title: "Safe Frontmatter Handling",
      description: "AST-aware YAML updates preserve raw formatting for unmodified fields. Dates, quotes, and time values keep their original form while only changed keys are rewritten.",
      icon: "shield",
      size: "medium",
      codeExample: FRONTMATTER_EXAMPLE,
    }),
    FeatureCard({
      title: "File Operations",
      description: "Read, write, and manage notes safely. Create, update, and organize your vault with AI assistance.",
      icon: "file",
      size: "medium",
    }),
    FeatureCard({
      title: "Security First",
      description: "Path traversal protection and safe file operations. Controlled AI access through MCP protocol.",
      icon: "vault",
      size: "medium",
    }),
    FeatureCard({
      title: "Node.js Compatible",
      description: "Built with Node.js for broad compatibility and ecosystem support.",
      icon: "node",
      size: "small",
    }),
    FeatureCard({
      title: "Token Optimized",
      description: "Minified JSON field names and compact responses. Less token usage means faster, cheaper API calls.",
      icon: "tokens",
      size: "small",
    }),
    FeatureCard({
      title: "TypeScript",
      description: "Fully typed for excellent developer experience.",
      icon: "typescript",
      size: "small",
    }),
    FeatureCard({
      title: "Open Source",
      description: "MIT licensed and community driven.",
      icon: "heart",
      size: "small",
    }),
    FeatureCard({
      title: "Complete Toolkit",
      description: "18 MCP tools for vault management: read/write/patch/move files, search content, manage tags, update frontmatter, vault stats, and more. Built for AI assistant integration.",
      icon: "toolkit",
      size: "medium",
    }),
    FeatureCard({
      title: "Multi-Platform",
      description: "Works with Claude Desktop, ChatGPT+ Desktop, OpenCode, Gemini CLI, OpenAI Codex, Cursor, Windsurf, IntelliJ, and other MCP-compatible AI platforms.",
      icon: "platform",
      size: "medium",
    }),
  ]);

  return (
    <section data-component="feature-grid" aria-labelledby="feature-grid-heading">
      <div class="feature-grid-inner">
        <div class="feature-grid-header fade-in-on-scroll">
          <h2 id="feature-grid-heading" class="feature-grid-title">
            Core Features
          </h2>
          <p class="feature-grid-lede">Designed for safety, performance, and developer experience. Every feature gives AI intelligent access without compromising your data.</p>
        </div>

        <div class="feature-grid">{cards}</div>
      </div>
    </section>
  );
}
