---
id: catalog-event-optimization-20260916
kind: performance-report
description: Remove redundant directory-hint scans during watcher event bursts.
keywords: [catalog, watcher, CPU, event-loop, indexing, 성능]
use_when: Evaluating repeated filesystem notifications; not desktop GPU diagnosis.
position: Standalone measured change; related implementation linked below.
parent: ../architecture/graph-index-measurement.md
previous: ../architecture/graph-index-measurement.md
next: ../../src/vault-catalog.ts
---
# Catalog event classification

Scope: MCPVault CPU work; the temporary Windows drag setting was restored.

## Plan and constraints
- Reproduce duplicate inventory scans before changing production code.
- Reuse one positive folder hint for the same inventory snapshot.
- Skip classification after an unknown event already requires full invalidation.
- Preserve every invalidation, explicit edit, read barrier and permission check.
- Clear the hint when publishing a new inventory and when closing the catalog.
- Run targeted tests, build, full low-memory regression, deployment and fork push.

## Fixed synthetic workload
Run `node --max-old-space-size=512 scripts/benchmark-catalog-events.mjs`.
Five trials of 100 identical events; matching folder last, or Missing with no match.
The benchmark uses the real built event handler but no NAS IO or file watcher.

| Paths | Folder | Before median ms | After median ms |
| ---: | --- | ---: | ---: |
| 100,000 | Late | 162.42 | 4.50 |
| 100,000 | Missing | 168.54 | 2.66 |
| 1,000,000 | Late | 1767.19 | 20.30 |
| 1,000,000 | Missing | 1820.33 | 19.34 |

Before implementation SHA256: `bdc749a28e9f4128cc1008ebb4389a80aa098e25ff86fff7bd51f0d5d5d953b2`.
After implementation SHA256: `851cbc5fc95e34a2d227bd1ccce5906143d88eae28dadfa898293f4e5811220d`.
The deterministic 100,001-path test reduces inspected entries from 10,000,100
to at most 100,001 (99%). Existing code failed this assertion before the fix.
Maximum after time for the million-path matching case was 219.90 ms;
allocation/GC variance remains. This is not a p95 production latency result.

## Evidence and limits
- Targeted: 86 tests across six files passed; build passed.
- Differential probe: 20,000 synthetic transitions retained identical invalidation state.
- Luna review: initial stale-hint concern retracted after baseline/consumer comparison.
- Full: 527 files, 7,096 passed, 4 skipped; computer-worlds deployment verified.
- One retained path, not a growing directory index or cached authorization.
- Alternating uncached folders still require scans; full reconciliation is unchanged.
- No claim that this caused or resolved desktop window stutter.
