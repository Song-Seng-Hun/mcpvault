---
id: reviewed-skill-metadata-wave25
description: Source review of code-node secret propagation and MCP wrapper authority.
keywords: [n8n, HMAC, MCP, wrapper, credential, 비밀키]
use_when: Repairing these bundles or reviewing cross-skill capability escalation.
parent: 2026-09-15-reviewed-skill-release.md
previous: 2026-09-16-reviewed-skill-metadata-wave24.md
next: 2026-09-15-reviewed-skill-release-passport-next.md
---
# Code nodes and MCP extension

Review only. No source rewrite, target execution, activation or deletion occurred.
The preceding explanatory turn completed no new review; this batch adds three.

## Findings and disposition

- n8n-code-nodes-official: repair required; HMAC returns the input secret via spread.
- Later credential warnings do not undo that explicit output path.
- Node-choice references contradict each other about all-item expression access.
- Retained aggregation syntax is damaged; HTML interpolation lacks escaping.
- Title sanitization strips Korean; numeric and empty-input handling need definition.
- Anecdotal timing and unconditional workflow tests are not local safety evidence.
- n8n-extending-mcp-official: repair required; mutation wrappers claim no side effects.
- Explicit build/config consent and destructive-call dry-run guidance are useful.
- Credential creation through REST cannot substitute for denied MCP permission.
- Publication, default exposure, current project access and tool reuse need gates.
- mcp-security: incomplete; truncated capability prose and missing runner/references.
- No unnecessary skill-access certificate demand was established in these bundles.

## Evidence and limits

Six files, 44,140 bytes, fully main-read as data; ten contiguous source quotes.
NAS fingerprints matched the retained inventory at capture and twice at sealing.
Three descriptor checks and 24 negative evidence controls passed.
An invalid reviewer-authored risk enum was corrected; parser rules were unchanged.
These checks prove record shape/source binding, not behavior or safe execution.
No installed n8n behavior, performance claim or licensed provenance was verified.
No host grant, MCP registration, workflow, credential or agent-context edit ran.

## Progress

Metadata: 186 / 1,610 = 11.55%; this batch +3 (+0.19 percentage points).
Pending: 1,422; fixtures: two. Actual activation: 0 / 1,610 = 0.00%.
Confirmed backup-inclusive deletions: zero; final disposition: 0.00%.
Private generation: 6da989b8e46309bd859ed39e7841eb100557792fd0bcaca6a3c7843714ecb303.
All 26 index pages reread; repeat generation created no duplicate.
Continue remaining source reviews; do not retry rejected access settings.
Fixes, behavior tests and authorized runtime admission remain separate work.
