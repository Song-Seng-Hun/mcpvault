# Existence and new-note creation integrity

## Baseline evidence

At c0d33f9, noteExists suppressed all stat failures as false. EIO/EACCES/EPERM
therefore let a 'missing' write replace an existing authoritative note. Another
writer creating a file after the existence guard was also overwritten by normal
writeFile. Real-file tests reproduced these failures for direct overwrite,
append/prepend, and explicit/implicit MCP creation guards: eleven failed, one
baseline normal-absence test passed.

## Changes

- Shared noteExists permits only confirmed path absence as false. Preserve the
  existing non-file/PathFilter result semantics; other failures are path-free
  VaultReadUnavailableError so consumers cannot infer missing knowledge.
- The underlying 'missing' write uses exclusive creation. A late EEXIST is a
  revision conflict, with no successful mutation notification or truncation.
- After checking that omitted revisions are allowed only on new targets,
  notes.write carries 'missing' into the filesystem instead of losing the guard.
- No extra tools, client setup, live Vault mutations or upstream contribution.

## Verification

Real-file stat fault/racing-create regressions, existing filesystem/append/receipt
tests, full suite, build, compiled MCP, scoped review, diff and fork main push.

## Boundaries

Exclusive creation relies on underlying filesystem support. This is not an
atomic read/revision-check/replace of existing files, cross-file transaction,
or crash-atomic persistence. Directory/non-file existence semantics remain
unchanged; exclusive creation still prevents replacing an occupied entry.

## Verification follow-up

The first full run found an existing graph test fixture whose immediate rewrite
retained ctime on Windows. Its purpose is changed-ctime reconciliation; establish
that condition using bounded real-I/O retries, keeping all original assertions.
The focused 26 graph/existence tests passed after that preparation fix. This
does not prove detection of same-size/mtime/ctime edits: an explicit collision
case remains a graph reconciliation audit item, not a completed guarantee.
