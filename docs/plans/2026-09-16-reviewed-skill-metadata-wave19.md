---
id: reviewed-skill-metadata-wave19
description: Full ability-system bundle review with independent lifecycle counterexamples.
keywords: [Godot, abilities, tags, ownership, HUD, 기절-중첩]
use_when: Preparing a limited ability-system derivative or continuing the metadata queue.
parent: 2026-09-15-reviewed-skill-release.md
previous: 2026-09-16-reviewed-skill-metadata-wave18.md
next: 2026-09-16-reviewed-skill-debugging-baseline.md
---
# Wave 19: ability-system

Main read all four retained files (45,919 bytes), including three detailed references.
The descriptor records discovery conditions, examples, connections and seven impact axes.
Potential impact is conditional reach, not maliciousness; account/legal/data uncertainty stays explicit.
No source code, missing runner, game action or host hook was executed.

## Concrete review findings

| Mechanism | Observed limitation |
| --- | --- |
| Required tags | Missing container returns true before checking required tags |
| Overlapping stun | One expiry removes a shared tag while another owner remains active |
| Reapplying an Effect | Two apply callbacks can share one timer entry and one later expiry |
| Delayed frame | At most one tick occurs; catch-up/drop and expiry ordering need an explicit policy |
| Modifier source | One source/stat slot replaces another operation from that same source |
| Mutable resources | Direct edits bypass notification methods; per-entity ownership is unspecified |
| HUD lifecycle | No late-bind state snapshot or rebind/disconnect guard is retained |
| Main integration | Referenced AbilityComponent and main sections are missing from the truncated entry |

Independent abstract models reproduced five counterexamples and passed two normal controls.
They bind to exact captured source mechanisms but do not execute GDScript/C#.
These are design counterexamples, not Godot runtime, behavioral safety or release tests.
Signal-based UI still uses frame interpolation; do not interpret it as zero per-frame work.
Named related skills are not verified co-use links. Provenance and license remain unresolved.

## Verification and next work

Field expectations first failed without a review record, then passed with the completed descriptor.
Eleven contiguous quotes cover all four files; eight evidence/descriptor rejection controls passed.
NAS fingerprints matched twice before immutable local evidence sealing.
The paginated work index was reread; a second build created no duplicate generation.
Before release, resolve ownership/timing policy, recover missing prerequisites and fix behavioral cases.
Do not turn a gameplay tag predicate into host, account or multiplayer authorization.

Totals: 146 ordinary metadata reviews, two fixtures, 1,462 pending; live usable remains zero.
Source/dist unchanged; existing regression-e basis revalidated: 525 files, 7,074 passes, four skips.
No new full-suite run, runtime deployment, account grant, quarantine change or source rewrite.
