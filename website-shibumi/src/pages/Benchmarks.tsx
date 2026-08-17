/**
 * Benchmarks page. Ported from website/src/pages/benchmarks.astro.
 *
 * Composition: Nav, hero + TL;DR, BenchmarkCharts, prose sections
 * (Why should we move? / HTTP / Method), skeptics FAQ, Footer.
 */
import { BenchmarkCharts } from "../components/BenchmarkCharts";
import { Footer } from "../components/Footer";
import { Nav } from "../components/Nav";
import { Layout } from "../layouts/Layout";

const SPEC_URL = "https://modelcontextprotocol.io/specification/latest";
const SCRIPTS_URL = "https://github.com/bitbonsai/mcpvault/tree/main/benchmarks";
const ISSUE_URL = "https://github.com/bitbonsai/mcpvault/issues/49";

interface FaqItem {
  q: string;
  a: unknown;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    q: "Sub-millisecond tool calls? That looks made up.",
    a: "It's stdio on the same machine: no network, and the file is already in the OS cache. The number isolates server processing, the only part the SDK swap could change.",
  },
  {
    q: "Eight cold starts and twenty searches is a tiny sample.",
    a: "True. It's enough to compare medians of a quiet local process, and it's why we claim a tie, never a speedup. Every p95 is in the table above.",
  },
  {
    q: "MCP v2 wins some rows. Convenient.",
    a: (
      <>
        Noise. Those differences flip between runs. The claim is only that <strong>MCP v2</strong> isn't slower.
      </>
    ),
  },
  {
    q: "You benchmarked your own project and concluded it's fine.",
    a: "The scripts are in the repo and print the exact numbers on this page. Rerun them on your own vault; if you get different results, open an issue.",
  },
  {
    q: "Two protocol versions in one server sounds like per-request overhead.",
    a: "The version is settled once, when the client connects. Requests never re-check it, which is what the flat per-request numbers show.",
  },
  {
    q: "So nothing at all got slower? Really?",
    a: (
      <>
        One thing: pinning an <strong>MCP v2</strong> client to the new protocol version adds about 110 ms, once, at
        connect. Only our test harness does that; shipping apps don't pin. Publishing it because you'd find it anyway.
      </>
    ),
  },
];

export interface BenchmarksPageProps {
  currentPath: string;
  version: string;
}

export function BenchmarksPage({ currentPath, version }: BenchmarksPageProps) {
  return (
    <Layout
      title="MCP v2 Benchmarks"
      description="MCPVault already runs on the new MCP specification (2026-07-28). Benchmarks show identical speed for every client, old and new."
      canonical="https://mcpvault.org/benchmarks"
      page="benchmarks"
      pageStylesheet="/styles/benchmarks.css"
      clientScript="/client/alpine.js"
      version={version}
    >
      <Nav currentPath={currentPath} version={version} />

      <main id="main-content" data-component="benchmarks">
        <section class="bench-section bench-hero">
          <div class="bench-container">
            <h1>Ready for the next MCP. Same speed.</h1>
            <p>
              The Model Context Protocol published its{" "}
              <a href={SPEC_URL} target="_blank" rel="noopener noreferrer">
                2026-07-28 specification
              </a>{" "}
              in July 2026. MCPVault runs on the new official SDK, which we call <strong>MCP v2</strong>, and serves
              both protocol generations from a single process: each client gets an answer in whichever version it
              speaks. Your current setup keeps working as is, and when your favorite app moves to the new protocol,
              MCPVault is already there.
            </p>
            <p>We benchmarked the upgrade before shipping it. Three pairings, one real vault (381 notes), everything over stdio.</p>

            <aside class="bench-tldr" aria-label="Summary">
              <p class="bench-tldr-label">TL;DR</p>
              <p>
                Benchmarks of MCPVault on <strong>MCP v2</strong>: ~107 ms to connect and identical per-request speed,
                whether the app talks the old protocol or the new one. Below: the numbers, why we moved, what stateless
                HTTP opens up, and answers for skeptics.
              </p>
            </aside>
          </div>
        </section>

        <section class="bench-section" aria-label="Benchmark results">
          <div class="bench-container">
            <BenchmarkCharts />
          </div>
        </section>

        <section class="bench-section">
          <div class="bench-container bench-prose">
            <div>
              <h2>Why should we move?</h2>
              <ul>
                <li>
                  <strong>Every client, one server.</strong> The <strong>MCP v2</strong> build detects what each client
                  speaks during the opening exchange. Apps on the current protocol and apps on 2026-07-28 connect to
                  the same MCPVault.
                </li>
                <li>
                  <strong>The maintained SDK line.</strong> New MCP features, fixes, and security patches land in the{" "}
                  <strong>MCP v2</strong> packages first. Staying on the 1.x SDK means those reach you late, or never.
                </li>
                <li>
                  <strong>Richer tool definitions ahead.</strong> The new spec supports full JSON Schema 2020-12, so
                  tool inputs can be described more precisely as clients adopt it.
                </li>
              </ul>
            </div>

            <div>
              <h2>What this opens up: HTTP</h2>
              <p>
                The 2026-07-28 spec makes the HTTP transport stateless: servers stop tracking per-client sessions, so
                an MCP server can sit behind any ordinary load balancer and serve many clients from plain
                infrastructure. For MCPVault that means a future HTTP mode, your vault reachable by AI assistants that
                never touch your filesystem, without the session bookkeeping that made the old approach fragile.
                MCPVault stays local-first by default; HTTP would ship as a separate opt-in package built on this{" "}
                <strong>MCP v2</strong> core. That work is tracked in{" "}
                <a href={ISSUE_URL} target="_blank" rel="noopener noreferrer">
                  issue #49
                </a>
                .
              </p>
            </div>

            <div>
              <h2>Method</h2>
              <p>
                Each pairing spawns <code>mcpvault &lt;vault&gt; --read-only</code> over stdio. Cold start is the
                median of 8 full connect cycles, spawn to first response. Per-request numbers are medians on a warm
                connection after one warmup call (50 iterations per tool, 20 for search_notes). Measured 2026-08-17 on
                macOS, Node 26, SDK 1.30.0 vs 2.0.0. The scripts live in the repo's{" "}
                <a href={SCRIPTS_URL} target="_blank" rel="noopener noreferrer">
                  benchmarks folder
                </a>
                , so you can rerun them against your own vault.
              </p>
            </div>
          </div>
        </section>

        <section class="bench-section bench-faq" aria-label="Frequently asked questions">
          <div class="bench-container">
            <h2>For the skeptics</h2>
            <p class="bench-faq-intro">Fair questions a developer should ask about a project benchmarking itself.</p>
            <div class="bench-faq-list">
              {FAQ_ITEMS.map((item) => (
                <details>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <Footer />
      </main>
    </Layout>
  );
}
