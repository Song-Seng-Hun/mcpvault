---
id: reviewed-skill-passport-work
description: Executing distinct reviewed descriptor delivery after regression c.
keywords: [reviewed descriptor, metadata, final fence, 메타데이터 제공]
use_when: Continuing the approved passport integration implementation.
parent: 2026-09-15-reviewed-skill-release.md
previous: 2026-09-15-reviewed-skill-release-passport-next.md
next: 2026-09-15-reviewed-skill-release-discovery.md
---
# Reviewed descriptor delivery

Prior source basis c: 58e5c92f7112dc5b24d9881813f1bf9f7caea21b6f9ead8257449adad2b7d78a.
523 files, 7,046 passed, 4 skipped; full coverage/current basis verified before edits.
New source edits require new target/build/regression evidence; c is historical afterward.

## Contract

Optional descriptorResource names one hash-bound resource of descriptor kind.
Absent in legacy manifests means unknown, never fallback to source metadata evidence.
Descriptor bytes use the existing strict descriptor schema and stay at most 32 KiB.
Include pointer in review basis and resource in all integrity/final delivery fences.
Admission and reads validate actual bytes; reviewer metadata is not a runtime grant.
Metadata sections use reviewed descriptor fields plus immutable release limitations.
Effects remain potential declared effects; usage/co-use stay unknown without telemetry.
Private review artifacts and host paths never become a descriptor resource.

## Work

- [x] RED: absent/valid/invalid descriptor and small-response tests.
- [x] RED: pointer changes invalidate evidence and final-refresh changes deny delivery.
- [x] GREEN: manifest/basis, bounded descriptor loading and metadata projection.
- [x] Verify admission rejects invalid descriptor before any publication (fixture only).
- [x] Final related targets: 106 tests / 19 files; build and solo source review passed.
- [ ] Complete discovery scaling and remaining release work; see next chapter.
- [ ] Freeze and rerun full regression before delivery.

No access files, grants, listener or admission are created by these code changes.
Do not relabel independent trial evidence or reinterpret a code gate as access approval.

RED evidence: six initial descriptor failures, one admission failure, one continuation failure.
39 focused tests passed; broader 105 passed before one additional continuation test.
The added exact-byte continuation test passed in the final 106-test target run.
Legacy verification/receiving package compatibility rechecked; actual source not revalidated.
No new full-suite run yet: finish remaining coherent integration before freezing it.
