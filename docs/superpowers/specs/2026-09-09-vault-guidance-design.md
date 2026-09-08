# Vault-backed MCP guidance — approved design

The user approved making reusable MCP prose (policies, onboarding, tool/argument
descriptions, examples, success/error/warning/next-action explanations) available
as protected, feedback-reviewable Vault documents and using their validated
revisions in actual responses. This is not an archive of calls, credentials,
personal memories, user-authored bodies, or arbitrary external exception values.

Code continues to decide authorization, endpoint selection, schema constraints,
error codes, success flags and output budgets. Human-readable prose is editable;
it never executes code or grants authority. Existing five MCP tools remain.

Use explicit stable message IDs at authored prose sites. Do not recursively
translate arbitrary response strings: that could rewrite user data. Preserve
Error.message internally and render annotated errors only at the MCP boundary.
An AST inventory records bound and still-unbound prose, avoiding a claim that
regex discovery alone proves complete coverage. Templates store placeholders,
never runtime values or source expressions. Module-level policies/descriptions
need explicit trusted-object projection, not a generic data rewrite.

Host-controlled registration protects a managed guidance collection without
making every template a priority onboarding notice. Reuse notice preview/revise,
revision and fingerprint checks, and community feedback. Host deployment sync
adds missing defaults; unchanged defaults can update, while edited documents are
preserved and upstream conflicts require explicit re-review. Invalid/missing,
oversized or incompatible templates fall back to compiled defaults and report
bounded diagnostics. No silent overwrite of an approved local edit.

Reads are bounded and request-local. Cache invalidation must account for direct
Obsidian edits, deletion, policy revocation and concurrent servers. Fixed MCP
initialization/tool descriptions are client-cache dependent; dynamic endpoint
descriptions and responses use the current validated revision. Scope filtering
precedes disclosure. Exported interface material must not pollute ordinary
knowledge retrieval as evidence, and is not a second permission system.

Deployment targets the existing E:\llm_wiki\llm_wiki Vault and shared server.
Back up before sync, retain user prose, verify live reads and revision changes,
run single-worker tests/build/full regression, then commit/push only source,
tests, documentation and dist to the user's fork main. No upstream PR or release.
