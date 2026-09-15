---
id: reviewed-skill-metadata-wave6
description: Godot 2D/3D and A/B drafts completed; examples, tested behavior and authority kept distinct.
keywords: [Godot, coordinates, rendering, A/B, significance, 메타데이터]
use_when: Selecting procedural references or preparing tested derivatives from these bundles.
parent: 2026-09-15-reviewed-skill-release.md
previous: 2026-09-16-reviewed-skill-metadata-wave5.md
next: 2026-09-15-reviewed-skill-release-passport-next.md
---
# Metadata wave 6

Main read all 20 retained files: 77,459 bytes across 2d-essentials, 3d-essentials and ab-testing.
Capture and two final NAS fingerprints match; original files remain unchanged.
Target code, editor annotations, shaders and eval prompts were never executed.

## Godot findings

- 2D recipe passes global coordinates to a local-space tile lookup; transformed scenes need conversion.
- Physics quadrant grouping is mislabeled as rendering quadrant size in the source.
- These are separate contracts in [Godot 4.5 TileMapLayer](https://docs.godotengine.org/en/4.5/classes/class_tilemaplayer.html).
- Both decal recipes call look_at before adding the node to the scene tree.
- That violates the documented precondition in [Godot 4.5 Node3D](https://docs.godotengine.org/en/4.5/classes/class_node3d.html).
- Parent transforms, ceiling normals, shared materials and missing assets also require tests.
- LightmapGI renderer tables contradict each other; zero-runtime-cost statements are not measurements.
- Entry claims 4.3+ while references include 4.5-4.7 features; no complete version matrix was tested.
- Optional Laigter link, editor @tool examples and res assets are not approved installations/execution.

## A/B findings

- Source misstates significance as the probability the observed difference arose by chance.
- This contradicts the [ASA p-value statement](https://www.amstat.org/asa/files/pdfs/p-valuestatement.pdf), principles 2 and 3.
- Quick duration framework omits arms/exposure used in the earlier full formula.
- Sample tables lack reproducible assumptions; variant multipliers do not define correction methods.
- Sequential/Bayesian vendor labels were not verified; no live calculator or experiment was used.
- Results summary permits Inconclusive, but the later winner field only offers Control/Variant.
- Seven eval cases are expected prompts/assertions, not executed tests or valid result receipts.
- Missing runner, product-marketing context and peer references remain explicit gaps.

## Verification and remaining work

Three descriptor checks, 24 exact quote ranges and 24 negative controls passed.
Evidence SHA: `bb025be468c256c5b76db037516dea54a6046fedfca73caca568758367a49208`.
Three official-source spot checks support identified issues, not complete runtime/statistical validation.
Explicit draft transitions retain old evidence and pin identical source fingerprints.
Index `743e9671cca9b2a2`: 26 pages; 1,610 unique rows reread; repeat build created nothing.
Totals: 42 metadata-reviewed-with-limitations; zero drafts; 1,568 pending; zero verified live usable.
Only the described subset is covered, not the full library or behavioral tests.
Source quarantine, blocked host access and production source/dist remain unchanged.
Existing regression-e basis revalidated; no new full-suite run or runtime deployment claimed.
Next: continue pending inventory and useful restricted derivatives; resolve admission without bypass.
