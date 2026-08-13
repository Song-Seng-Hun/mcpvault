/**
 * "Latest MCP spec" banner. Ported from SpecPreviewCallout.astro.
 *
 * `lucide-react`'s `ArrowRight` and `GitBranch` are replaced with the
 * audited `ArrowRightIcon`/`GitBranchIcon` (icons.tsx).
 */
import { ArrowRightIcon, GitBranchIcon } from "./icons";

const SPEC_URL = "https://modelcontextprotocol.io/specification/latest";
const BRANCH_URL = "https://github.com/bitbonsai/mcpvault/tree/feat/mcp-sdk-v2";

export function SpecPreviewCallout() {
  return (
    <section data-component="spec-preview-callout" aria-label="Latest MCP specification development preview">
      <div class="callout-inner">
        <div class="callout-card">
          <div class="callout-row">
            <div class="callout-message">
              <span class="callout-icon">
                <GitBranchIcon className="icon" />
              </span>

              <p class="callout-text">
                <span class="callout-headline">
                  The{" "}
                  <a href={SPEC_URL} target="_blank" rel="noopener noreferrer" class="spec-link">
                    latest MCP spec
                  </a>{" "}
                  is out.
                </span>
                <span class="callout-short"> We’re getting ready for it.</span>
                <span class="callout-long"> We’re getting MCPVault ready for it.</span>
              </p>
            </div>

            <a href={BRANCH_URL} target="_blank" rel="noopener noreferrer" aria-label="View the feat/mcp-sdk-v2 branch" class="work-link">
              <span class="work-link-label">View feat/mcp-sdk-v2</span>
              <ArrowRightIcon className="icon" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
