# Bounded derived snapshot reads

Use executing-plans, TDD and inline review; no new agents or live Vault changes.

## Design

Markdown remains authoritative. Optional disk acceleration must not allocate
unbounded input or gzip output before rejecting an oversized cache. A shared
reader opens the file once, requires a regular file, checks its initial size,
then reads bounded chunks up to the byte limit plus one detection byte. This
retains the limit even if a file grows after stat. Close the handle on all paths.
Gzip uses a native decoded-output ceiling before conversion to text/JSON.
Missing, corrupt and oversized caches follow each service's existing cold-rebuild
path; never delete notes, mark source absence, or require client installation.

Compared with post-decompression checks, bounded input and zlib output limits
prevent the expensive allocation rather than merely observing it. Full streaming
JSON/index restoration would reduce peak memory further but changes persistence
formats and is separate work. Limits are per read, not a process-wide RAM cap.

## Execution

- [x] Reproduce an oversized semantic pending snapshot restoring queued work.
  Use actual gzip data expanding beyond 8 MiB, without any model/native DB.
- [x] Add shared `readSnapshotBytes(path, {maxBytes, maxDecodedBytes?})` tests:
  plain/gzip boundaries, oversized stored/decoded data, corrupt/truncated gzip,
  concatenated members, invalid limits, empty files, missing paths and directories.
- [x] Implement `src/snapshot-read.ts` using bounded FileHandle reads and
  `gunzip` maxOutputLength; stable path-free cache rejection.
- [x] Integrate lexical binary and legacy gzip, public discovery gzip, semantic
  manifest gzip/legacy JSON and pending gzip. Apply 128 MiB lexical/public decoded
  and binary ceilings, 64 MiB manifest decoded/legacy, 8 MiB pending decoded;
  compressed input ceilings are 32 MiB except pending at 8 MiB.
- [x] Check success restoration and cold reconstruction with real temp files.
  Preserve source metadata, private scope filtering and existing retry contracts.
- [x] Run targeted tests, build, full suite, compiled smoke and diff checks.
  Review and commit source/dist/docs; verify push only to the approved fork main.

## Evidence and additional corrected defect

The real 8 MiB pending expansion regression initially restored one queued entry
instead of rejecting the cache. It now restores zero, leaving Markdown intact.
Reader tests include exact boundaries, multi-chunk byte fidelity and deterministic
growth after stat with actual file IO and a verified handle close.

The public round-trip test exposed an existing v2 decoder bug: it read string
count at the version header offset instead of after the common 12-byte header.
The corrected decoder restores normal v2 data and preserves valid v1 migration.
Further v1 fixtures reproduced private/traversal rows attached to a valid public
manifest. Both versions now require exact current public membership, unique
paths, matching collection/type and the same compact public projection as cold
reconstruction. This is not authentication of arbitrary cache metadata.

Targeted tests: 90 passed. Full `npm test`: 62 files passed, 964 tests passed and
1 skipped, 44.37 seconds. `npm run build` passed. Compiled-code smoke verified
gzip exact/over-limit boundaries and an actual public v2 snapshot round-trip.
`git diff --check` passed. The review was inline, with no extra agents, user data
changes, model downloads or new MCP tools. Per-read ceilings do not cap aggregate
memory, object expansion during parsing, or repeated oversized snapshot saves.

## Separate finding

Semantic line locators are calculated over a title-prefixed, frontmatter-stripped
string and paragraph offsets assume two separator characters. Fixing only the
frontmatter offset would leave CRLF/blank-run/long-paragraph and old-row issues.
Keep this open for a version-aware raw-Markdown locator audit. No locator fix or
exhaustive orphan-vector cleanup is claimed by this snapshot resource guard.
