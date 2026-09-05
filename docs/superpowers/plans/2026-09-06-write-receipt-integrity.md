# Issue write receipt integrity

## Confirmed defect

`resolveIssue` wrote status/body, then read the file again to obtain a revision.
A real external write at the notification boundary reproduced a response with
the first writer's resolved status but the second writer's revision. Reusing
that response as an edit guard could overwrite a follow-up the agent never read.

## Contract and implementation

- Return a receipt from the shared filesystem serialization/write pipeline;
  hash the same UTF-8 content supplied to the successful write.
- Preserve existing `writeNote(): Promise<void>` behavior; the internal
  `writeNoteWithReceipt` entry point reuses normalization, path/source checks,
  revision locks, size checks, serialization, and change notification.
- Resolve issues using that receipt, without a post-write revision read.
- No additional MCP tool, endpoint, permission, persistent log, or client setup.
- Re-read remains mandatory for clients. Receipts describe this write, not a
  current-state promise, atomic multi-process transaction, or unchanged file.

## Verification

- Real external-editor interleaving, own-write hash, and stale follow-up rejection.
- Overwrite/append/prepend serialization with Properties and Korean/emoji content.
- Raw BOM/CRLF content, legacy void behavior, competing revision-locked writes.
- Restricted path and stale revision rejection without change notifications.
- Existing issue-section tests, build, full suite, compiled MCP smoke, diff check.
- Focused independent Astra review before committing to the user fork.

Verified: the original disk-race test failed with the later editor's hash;
all seven new receipt tests and thirteen existing issue-section tests now pass.
Build and full suite passed (1,534 passed, one skipped, 115 files). Compiled
MCP smoke verified the resolver receipt, follow-up conflict rejection, preserved
evidence and five-tool surface; the response was 183 characters. Its disposable
Vault/account was removed. Astra's scoped static review found no actionable
issues; the reviewer was closed. `git diff --check` passed.

## Remaining audit

This change corrects the issue resolver. Other mutation methods with post-write
reads must be inspected individually: some intentionally return current state,
others may require write receipts, and related-note guarded writes must preserve
their multi-path lock semantics. Do not claim all mutations were migrated.
