# Data-only frontmatter with bounded parser input projection

The user delegated design approval and fork-main implementation/publication.
Current source shows gray-matter defaults merge JavaScript's eval-based engine
even though our wrapper replaces YAML. Verify this with an isolated in-memory
marker test; never run network, filesystem, subprocess or credential payloads.

## Choice

An engine deny override alone addresses one execution path but leaves all body
copies. A replacement handwritten YAML/frontmatter parser introduces unnecessary
format drift. Choose a data-language allowlist plus header-only projection into
the existing parser. Retain its tested YAML/JSON behavior and existing raw-text
fallback while preventing executable or unknown engine selection before parsing.

`FrontmatterHandler.parse` recognizes the existing opening rule (one optional
BOM, `---` but not `----`). No opener returns the same BOM-stripped body and raw
original string without gray-matter. Inspect the library's language token using
its non-executing language helper; only empty/yaml/yml/json names may continue.
Unknown/executable labels fall back to the entire untouched original as text.
Do not import metadata from code blocks or a non-leading delimiter.

For a closing `\n---`, pass only through those three closing dashes to gray-matter;
reconstruct the body from the original remainder, removing at most one CR and
one LF exactly like the old parser. This intentionally preserves legacy closing
suffix and unclosed-header semantics, not a new stricter Markdown dialect.
Unclosed frontmatter may still require the whole input: no header size truncation
or partial YAML parsing is introduced. OriginalContent, raw matter and malformed
YAML fallback remain unchanged. Explicit safe engines use our YAML parser and
JSON.parse; also block JavaScript defensively even though the allowlist rejects
its label first. No new dependencies, global library mutations or MCP tools.

## Verification

- Benign global marker tests show JavaScript/js case aliases cannot execute
  through parse/extract/update and a real disposable FileSystemService read.
- Golden differential tests against the former YAML/JSON parser compare all
  four returned fields for valid, invalid, empty, BOM/CRLF, unknown label,
  delimiter suffix, no closing delimiter and fenced examples. Never feed
  executable samples into the golden oracle.
- Buffer-allocation probes show a large body is not passed to Buffer.from for
  plain and closed-header notes; the original fields still match.
- Build, focused/full single-worker tests, independent security review, diff
  check. Optional isolated synthetic memory comparison documents scope/limits.
- Commit source/dist/tests/docs together, push the user's fork only. No live
  Vault modifications, server restarts/config changes or claims of deployed
  runtime protection. Restarting old processes remains an operational boundary.
