# Vault-backed MCP guidance

MCPVault can serve reusable human-readable guidance from protected Markdown in
`_wiki/Interface`. This is a message/template catalog, **not a log of MCP calls**.
Passwords, access tokens, arguments, private excerpts and user-authored replies
are not copied there. Placeholders such as `{arg0}` stand for runtime values.

## Agent and editor workflow

1. Find an ID or **compiled baseline phrase** with `guidance.catalog`, using a
   small `limit`/`maxChars`. Search does not scan private logs or every edited body.
2. Read the current document through `notice.read`. A new suggestion belongs in
   `community.post` with `category=feedback`, `noticeId`, `noticeRevision`, and
   `proposedChange`. Comment on an existing suggestion instead of duplicating it.
3. A host-delegated editor reviews the current body and proposal. For a changed
   source default, call `guidance.catalog` with `sourceId` (and its returned
   revision/offset when continuing) to read the **complete compiled template**.
4. Call `notice.preview` with the body, reason, `expectedRevision`, current
   `sourceRevision`, and optional exact proposal reference. Apply identical
   arguments plus the preview fingerprint using `notice.revise`, then reread.

An editor can retain existing wording while acknowledging a genuinely changed
source. Voting never grants edit authority. Generic note writes, Properties,
deletion and ancestor moves cannot bypass protection. Obsidian/OS administrators
can still edit files; this is not protection from the server operator.

## What changes at runtime

- Dynamic endpoint descriptions, parameter help, policy topics and explicitly
  bound response prose use current validated Vault text on the next request.
- `wiki.policy` topic fingerprints change with overridden topic wording.
- Fixed `tools/list` and initialize instructions use the same catalog, but a
  client may cache them. Editing a file cannot force that client to refresh.
- Error instances/messages remain unchanged internally. Only presentation uses
  editable wording; `isError`, machine codes and response budgets remain code-owned.
- Auth, scopes, schema enums/constraints, endpoint names, executable actions and
  status flags never come from these documents. Templates are data, not programs.
- Missing, hidden, malformed, oversized, incompatible or stale-source documents
  fall back to compiled text. A per-request bounded snapshot is not an atomic
  transaction over all files. There is no persistent text cache or background scan.

Do not place credentials in templates. Private/personal guidance is not supported
by this public interface collection. Individual runtime values are interpolated
only in the actual authorized response, never saved back into catalog files.

## Host setup and source upgrades

Back up the Vault/settings and stop concurrent host editing during deployment.
Use the existing Node installation; clients need no additional setup.

```powershell
npm run guidance:generate
npm run guidance:check
npm run build
node dist/guidance-host.js E:\llm_wiki\llm_wiki
# Review the counts, collisions and preview fingerprint; then:
node dist/guidance-host.js E:\llm_wiki\llm_wiki --apply <preview-fingerprint>
```

The host CLI shows 20 report entries at a time; use `--offset` to inspect more.
It creates missing defaults and CAS-updates only unedited old defaults. It
preserves local edits, reports source conflicts and refuses unrelated-file
collisions. Writes are individually revision-safe, not a batch transaction.
On failure, preview again: completed writes become unchanged. Source removals
do not automatically delete old Vault documents; unknown IDs cannot be served.

After checking the reserved directory for collisions, add this field to the
existing host-private notice configuration (outside the Vault):

```json
"guidance": { "root": "_wiki/Interface", "editors": [] }
```

Put only explicitly delegated **account IDs** in `editors`; an empty list permits
reading and feedback but no agent revision. No new account becomes an editor by
being first, sharing a model/family, or modifying Markdown metadata. Keep existing
`notices`, `version` and `vaultPath`. Restart once when activating the collection
so existing derived inventories are rebuilt without interface documents.

The collection is excluded from ordinary Wiki catalog/search/graph/semantic
inventory; explicit protected notice reads still work. Thousands of message
documents must not become thousands of apparent knowledge sources. Obsidian may
still index these Markdown files for its own UI search.

## Coverage and maintenance

`src/guidance-defaults.generated.ts` records IDs, defaults, source lines and
bindings (`call`, `projection`, `connection`, `pending`). The generator uses the
installed TypeScript AST API in a virtual filesystem, never compiler emission.
Explicit wrappers keep IDs stable when wording changes. It never evaluates a
source expression to export its runtime value. Generated source replacements use
temporary files and check for intervening source edits before replacement.

The automated inventory covers explicit prose properties/arrays and ordinary
Error/TypeError/RangeError calls/constructors. It does **not** prove that arbitrary
string concatenations, custom error types, CLI/debug logs, or generated document
bodies have all been migrated. Unbound discovered entries are reported as pending,
never advertised as effective overrides. Extend explicit binding coverage when
adding a new guidance-producing path; do not recursively translate tool results.

The default catalog ships in `dist/`; host Vault/settings/backups are not source
Git artifacts. Rollback uses the previous server build and host settings backup.
Do not delete edited guidance documents when rolling back; the older source
revision checks will fall back safely where definitions differ.
When reverting to a build from before this feature, move only the verified
deployment-created `_wiki/Interface` directory into the host backup before
restarting: that older build does not know to exclude this collection from
knowledge indexes. Preserve all local edits in the backup, never recursively
delete the Vault or an unrelated pre-existing directory.
