/**
 * "Why Choose MCPVault?" comparison table. Ported from ComparisonTable.astro.
 *
 * `lucide-react`'s `CheckCircle2`/`AlertTriangle`/`XCircle` are replaced
 * with the audited `CheckCircle2Icon`/`AlertTriangleIcon`/`XCircleIcon`
 * (icons.tsx). Each status icon sits directly beside its own visible status
 * text (e.g. "Simple"), so the default `aria-hidden="true"` is correct.
 */
import { AlertTriangleIcon, CheckCircle2Icon, GitHubIcon, XCircleIcon, type IconProps } from "./icons";
import type { FC } from "hono/jsx";

type Status = "success" | "warning" | "error";

interface StatusCell {
  status: Status;
  text: string;
  description: string;
}

interface FeatureRow {
  name: string;
  mcpObsidian: StatusCell;
  otherMcpObsidian: StatusCell;
  directAccess: StatusCell;
}

const FEATURES: FeatureRow[] = [
  {
    name: "Setup Complexity",
    mcpObsidian: { status: "success", text: "Simple", description: "Just point to vault path - works instantly" },
    otherMcpObsidian: { status: "error", text: "Complex", description: "Requires Obsidian plugin + API key setup" },
    directAccess: { status: "warning", text: "Variable", description: "Depends on chosen approach" },
  },
  {
    name: "Obsidian Running Required",
    mcpObsidian: { status: "success", text: "No", description: "Works with closed Obsidian - direct file access" },
    otherMcpObsidian: { status: "error", text: "Yes", description: "Obsidian must be running with REST API plugin" },
    directAccess: { status: "success", text: "No", description: "Direct file manipulation" },
  },
  {
    name: "Plugin Dependencies",
    mcpObsidian: { status: "success", text: "None", description: "Zero dependencies - pure file system access" },
    otherMcpObsidian: { status: "error", text: "Required", description: "Needs Local REST API community plugin" },
    directAccess: { status: "success", text: "None", description: "No additional software needed" },
  },
  {
    name: "Frontmatter Safety",
    mcpObsidian: { status: "success", text: "Protected", description: "AST-aware updates preserve raw formatting for unmodified fields" },
    otherMcpObsidian: { status: "warning", text: "API-dependent", description: "Safety depends on Obsidian API implementation" },
    directAccess: { status: "error", text: "Can corrupt", description: "No safety mechanisms" },
  },
  {
    name: "Built-in Search",
    mcpObsidian: { status: "success", text: "Advanced", description: "Full-text search with BM25 relevance ranking" },
    otherMcpObsidian: { status: "success", text: "Good", description: "Uses Obsidian's search via API" },
    directAccess: { status: "error", text: "None", description: "Basic grep at best" },
  },
  {
    name: "Performance",
    mcpObsidian: { status: "success", text: "Fast", description: "Optimized for large vaults with batch I/O" },
    otherMcpObsidian: { status: "warning", text: "API overhead", description: "HTTP API calls add latency" },
    directAccess: { status: "warning", text: "Variable", description: "Depends on system capabilities" },
  },
  {
    name: "Link Handling",
    mcpObsidian: { status: "success", text: "Safe", description: "Preserves note content and frontmatter during moves" },
    otherMcpObsidian: { status: "success", text: "Good", description: "Leverages Obsidian's link management" },
    directAccess: { status: "error", text: "Breaks links", description: "Can corrupt references" },
  },
  {
    name: "Reliability",
    mcpObsidian: { status: "success", text: "High", description: "Direct file access - no intermediary failures" },
    otherMcpObsidian: { status: "warning", text: "Plugin-dependent", description: "Can fail if Obsidian crashes or plugin issues" },
    directAccess: { status: "warning", text: "Variable", description: "Depends on implementation quality" },
  },
];

const STATUS_ICONS: Record<Status, FC<IconProps>> = {
  success: CheckCircle2Icon,
  warning: AlertTriangleIcon,
  error: XCircleIcon,
};

function StatusValue({ cell }: { cell: StatusCell }) {
  const Icon = STATUS_ICONS[cell.status];
  return (
    <div class="comparison-cell">
      <div class="comparison-cell-status">
        <Icon className={`comparison-icon comparison-icon--${cell.status}`} />
        <span class={`comparison-text comparison-text--${cell.status}`}>{cell.text}</span>
      </div>
      <div class="comparison-description">{cell.description}</div>
    </div>
  );
}

export function ComparisonTable() {
  return (
    <section data-component="comparison-table" aria-labelledby="comparison-table-heading">
      <div class="comparison-inner">
        <div class="comparison-header fade-in-on-scroll">
          <h2 id="comparison-table-heading" class="comparison-title">
            Why Choose MCPVault?
          </h2>
          <p class="comparison-lede">See how MCPVault compares to plugin-based alternatives and direct file manipulation. Purpose-built for Obsidian means better safety, performance, and intelligence.</p>
        </div>

        <div class="comparison-table-scroll fade-in-on-scroll">
          <div class="comparison-table">
            <div class="comparison-table-head">
              <div class="comparison-row comparison-row--head">
                <div class="comparison-head-cell comparison-head-cell--feature">Feature</div>
                <div class="comparison-head-cell">
                  <div class="comparison-head-cell-title comparison-head-cell-title--accent">MCPVault</div>
                  <div class="comparison-head-cell-subtitle">This package</div>
                </div>
                <div class="comparison-head-cell">
                  <div class="comparison-head-cell-title">Other MCPVault</div>
                  <div class="comparison-head-cell-subtitle">Plugin-based</div>
                </div>
                <div class="comparison-head-cell">
                  <div class="comparison-head-cell-title">Direct File Access</div>
                  <div class="comparison-head-cell-subtitle">Manual approach</div>
                </div>
              </div>
            </div>

            <div class="comparison-table-body">
              {FEATURES.map((feature, index) => (
                <div class="comparison-row" style={`animation-delay: ${index * 0.1}s`}>
                  <div class="comparison-feature-name">{feature.name}</div>
                  <StatusValue cell={feature.mcpObsidian} />
                  <StatusValue cell={feature.otherMcpObsidian} />
                  <StatusValue cell={feature.directAccess} />
                </div>
              ))}
            </div>

            <div class="comparison-table-footer">
              <div class="comparison-summary">
                <div class="comparison-summary-item">
                  <div class="comparison-summary-value comparison-summary-value--accent">8/8</div>
                  <div class="comparison-summary-label">Features with clear advantage</div>
                </div>
                <div class="comparison-summary-item">
                  <div class="comparison-summary-value comparison-summary-value--success">Zero</div>
                  <div class="comparison-summary-label">Plugin dependencies required</div>
                </div>
                <div class="comparison-summary-item">
                  <div class="comparison-summary-value comparison-summary-value--warning">Instant</div>
                  <div class="comparison-summary-label">Setup time (vs hours)</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="comparison-cta fade-in-on-scroll">
          <div class="comparison-cta-card">
            <div class="comparison-cta-links">
              <a href="/install" class="comparison-cta-primary">
                <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Install Now
              </a>
              <a href="https://github.com/bitbonsai/mcpvault" target="_blank" rel="noopener noreferrer" class="comparison-cta-secondary">
                <GitHubIcon className="icon" />
                View Source
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
