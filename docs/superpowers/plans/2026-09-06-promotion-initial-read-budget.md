# Promotion initial-read integrity

## Scope

Selected source and reference hydration must read complete Markdown within the
existing 8 MiB note size limit. Failed storage reads must not erase ranked
candidates or pretend existing knowledge is absent and suggest duplicate lessons.
Keep public scope filtering, final revision barriers, and fixed five MCP tools.

## Evidence and implementation

- Eight real-temp-vault regressions: seven failed against `f9df091`; missing
  references already remained safely omittable.
- Optional `readNote(maxBytes)` and metadata `maxBytes` reuse bounded Vault I/O.
  A metadata byte cap bypasses cached metadata; strict reads distinguish absence
  from other failures. Callers without a cap retain existing behavior.
- Promotion requests strict capped initial reference reads and capped source
  reads. Non-absence failures return a generic path-free retry error.
- Preserve typed absence via the wrapped filesystem error's cause. Existing
  source-deletion race coverage remains applicable; absent winners are omitted.
- Exact-limit multibyte read coverage checks full body/revision parity, including
  a UTF-8 character crossing the 64 KiB chunk boundary.
- README/schema describe the limit and failure semantics.

## Validation

Run focused promotion and filesystem coverage, build, complete suite, compiled
five-tool MCP smoke, diff check; inspect the fork remote before commit/push.
Independent scoped Astra review reported no introduced defect; its deletion
coverage suggestion is handled by existing legacy race tests, and its UTF-8
boundary suggestion by the new exact-limit test.

## Remaining boundaries

This is a selected-hydration and final-revision per-read cap, not a total
inventory, parsing CPU, request I/O, or process-memory guarantee. Ranking remains
metadata-advisory. Cross-file state is optimistic, not an atomic OS snapshot.
Do not silently claim full-inventory boundedness from these tests.
