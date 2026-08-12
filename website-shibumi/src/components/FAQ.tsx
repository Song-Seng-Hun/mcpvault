/**
 * FAQ section. Ported from FAQ.astro. No icons/raw HTML in the source --
 * plain `<details>`/`<summary>` disclosure widgets, which work with no
 * JavaScript.
 */
interface FaqItem {
  q: string;
  a: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    q: "Does my data leave my computer?",
    a: "Vault files stay on your machine. MCPVault reads and writes local files directly. Your AI provider only sees content that your client sends to it.",
  },
  {
    q: "Does Obsidian need to be running?",
    a: "No. MCPVault uses filesystem access, so it works even when Obsidian is closed.",
  },
  {
    q: "Can I use multiple vaults?",
    a: "Yes. Configure multiple MCP server entries, each pointing to a different vault path.",
  },
  {
    q: "What file types are supported?",
    a: "Read and write tools support .md, .markdown, .txt, .base, and .canvas files. Directory listing can include other filenames (like images or PDFs), but non-note files are not read as notes.",
  },
  {
    q: "Is search semantic?",
    a: "Search is lexical full-text search with multi-word matching and BM25 relevance ranking. It does not use embeddings or vector indexes. For semantic search, pair MCPVault with a dedicated vector-search MCP server such as Qdrant's mcp-server-qdrant or Chroma's chroma-mcp: the companion server owns the embeddings index while MCPVault stays deterministic and local.",
  },
  {
    q: "What if the AI makes a mistake?",
    a: "Use version control or vault backups for recovery. Deletions require path confirmation, and write operations are scoped to your selected vault.",
  },
];

export function FAQ() {
  return (
    <section data-component="faq" aria-labelledby="faq-heading">
      <div class="faq-inner">
        <div class="faq-header">
          <h2 id="faq-heading" class="faq-title">
            FAQ
          </h2>
          <p class="faq-lede">Common setup and safety questions.</p>
        </div>

        <div class="faq-list">
          {FAQ_ITEMS.map((item) => (
            <details class="faq-item">
              <summary class="faq-question">{item.q}</summary>
              <p class="faq-answer">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
