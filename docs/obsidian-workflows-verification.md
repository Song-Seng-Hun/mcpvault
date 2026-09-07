# Obsidian workflow verification — 2026-09-07

## Environment and boundaries

- Host Vault: `E:\llm_wiki\llm_wiki`; Obsidian CLI/app 1.13.7.
- Official QuickAdd 2.24.2 and Metadata Menu 0.8.12, both loaded/enabled.
- Release URLs, SHA-256 hashes, original settings and generated-file hashes
  were recorded under the host Vault's `.obsidian/mcpvault-host-plugins/backups/`.
  No plugin binaries, host settings, credentials or backups belong to source Git.
- Shared MCP remains one listener at `127.0.0.1:8788/mcp`; no client-side
  process, GPU model, tunnel, or additional MCP tool is required.

## Automated coverage

Final verification: `npm run build`, `git diff --check`, and
`npm test -- --maxWorkers=1` passed (203 files, 3,070 passed, 2 skipped).

The normal single-worker suite includes the installer tests. New coverage checks:

- Authoring routes and inert supplied values; template/form/contract hash agreement.
- Saved-view scope and moderation filtering, body exclusion, length and row bounds,
  cursor continuation, definition revision conflicts, unsupported expressions,
  and native Bases export structure.
- MOC create/delete/rename/move and whole-folder removal/recreation; unrelated
  event bursts; actual MCP registration followed by host file events; no-op
  refresh; restart recovery; raw YAML/manual-text preservation; changed previews;
  permission revocation; private/cross-scope rejection; forged registration;
  malformed/fenced markers; Windows case aliases and self-exclusion.
- Generated links remain navigable but cannot satisfy orphan repair or authored
  learning order. Optional related reads retain links when semantic inference throws.
- Installation/restore paths, contract drift, enabled-plugin preservation,
  official release identity/size limits, and restoration conflicts.

## Live checks performed

1. QuickAdd's CLI input inspection returned exactly title/content prompts.
   Its real Template choice returned `verified: true`, `effect: created` and
   a unique timestamp-based Inbox path. No macro or user script was installed.
2. Native Codex MCP read/search returned that note. Obsidian Properties edits
   changed the revision and title/tags returned through the same MCP connection.
3. Metadata Menu's runtime index recognized `Inbox`, with title `Input` and
   tags `Multi` from the generated FileClass. Its indexed `postValues` API
   changed the test title; both Obsidian readback and MCP readback confirmed it.
4. The real plugin required a trailing slash in `classFilesPath`. This was
   fixed in the installer and covered by a regression assertion. Its legacy
   named-write API was not adopted because it dereferences Dataview.
5. Following the shared-server update, the current Codex connection called
   `wiki.view`, contextual `wiki.note_template`, `wiki.bases_view` and the host
   contract export without restarting Codex. Obsidian was closed during these
   calls. Exactly five fixed MCP tools remained available.
6. Obsidian `base:query` executed the YAML returned by MCP and returned the
   same synthetic note as `wiki.view`.
7. The three synthetic files were moved to Obsidian's trash; MCP search then
   returned no test hit. No account was added to the real Vault.

## Deliberate limits and manual checks

- CLI/runtime API checks do not certify the visual form layout or click flow.
  The human host should try `QuickAdd: Run` → `MCPVault: New Inbox note` and
  the Metadata Menu title/tag controls once.
- Tag options are a host-local picker vocabulary, not a server restriction.
  Adding local options intentionally changes the FileClass. Drift is reported;
  the installer preserves user edits rather than resetting them.
- No live user MOC was enrolled in automatic writing. Enrollment/revocation,
  event/restart behavior and source races were tested in isolated Vaults.
- MCP mutation adapters are covered in isolated authenticated test Vaults;
  real-Vault authoring verification used QuickAdd/Metadata Menu and MCP readback.
- Host plugins have host filesystem access; neither FileClasses nor Bases are
  permission boundaries. Templates and saved views do not execute custom code.
