# Append/prepend source integrity

## Evidence

Against 906c5cd, ten real-file regressions failed. A merge read failing with
EIO/EACCES/EPERM after a successful revision guard overwrote the entire original
body and Properties with just the new text. Separate direct disk assertions
confirmed that loss for both append and prepend. Source changes after the first
guard were accepted; deletion was followed by unintended recreation.

## Fix

- Only typed confirmed absence from the filesystem read error permits creation.
- An existing revision guard cannot permit recreation after a missing read.
- The actual merge snapshot must match expectedRevision. A 'missing' guard
  cannot authorize using a newly appeared file.
- Other read failures abort before write/notification, including unguarded
  internal callers. Preserve normal new-file creation and frontmatter formatting.
- Keep response receipts, scope/path/source immutability guards, and fixed MCP
  surface unchanged; clarify failure semantics in schema/tool help/README.

## Verification

Targeted append/prepend and existing filesystem/receipt tests, build, full suite,
compiled MCP failure injection, diff check, scoped review, fork-only commit/push.

## Not claimed

The final guard/write interval is not an atomic OS compare-and-swap. The wider
noteExists/stat failure semantics and whole-read/process budgets still require
separate evidence-based audits. Do not infer that every writer is now protected
against every external editor race.
