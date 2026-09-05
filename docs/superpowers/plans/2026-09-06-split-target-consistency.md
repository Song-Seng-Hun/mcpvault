# Split preview identity and destination guidance

## Reproduction

Baseline tests reproduced six failures: a 350-character exact heading was
shortened into a different ellipsis-named section, four cross-scope splits
were labeled usable despite incompatible content/return-link visibility, and
an existing destination still produced write/source-patch instructions.
Existing projection integrity tests passed; the original source snapshot and
bounded raw-range recovery contract are preserved.

A subsequent real MCP test reproduced destination collision/status loss in
the compact response, even after service-level target guidance was fixed.

## Repair

- Keep the full heading identity and shared exact/unique-partial selector.
- Check source-to-target reference permission and target-to-source content
  compatibility as well as caller access. Do not query incompatible targets.
- Report scope_incompatible/inaccessible/target_exists without instructions
  to write or patch. Missing targetPath asks for a new destination preview.
- Preserve destination identity/status alongside source revision/range in
  the existing compact MCP projection. Keep the budget error if these cannot
  fit rather than dropping a collision result.
- A preview remains read-only and does not reserve a path. Missing-revision
  create and source revision checks remain mandatory at execution time.

## Verification

Seven initial tests (six red, one already passing) now pass. Additional missing,
inaccessible, compatible/public, concurrent destination-create and MCP compact
tests pass: 33 split/projection tests total. Fresh build passes. Full suite:
1512 passed, 1 skipped, 113 files (70.87 seconds).

Compiled dynamic MCP verified complete heading identity, missing-target
guidance, preserved compact collision state in both formats, no mutation or
reservation, and the fixed five-tool surface. The owned temporary Vault was
removed. Astra performed a bounded static review of destination checks and
then the final compact adapter change, reporting no actionable issue. It did
not rerun tests; the main agent verified the counts above. Reviewer closed;
diff check passed. No running user server or live Vault was modified.
