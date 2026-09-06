# Unmeasurable Cache Admission

User-approved goal continuation: improve resource behavior without client setup,
server restarts, model downloads or upstream publication.

## Evidence and choice

`estimateCacheBytes` catches JSON serialization errors and returns zero. All its
production consumers pass the estimate (sometimes with fixed overhead) to the
shared derived-cache budget. The real frontmatter parser accepts a cyclic YAML
sequence (`loop: &loop [*loop]`); sorted metadata caches include frontmatter.
An integration test must establish that complete path before claiming coverage.

Returning zero undercounts unknown data. Throwing would fail otherwise useful
reads. Returning Infinity is the chosen internal sentinel: arithmetic overhead
preserves it, and the existing budget rejects it and disposes the cache copy.
Normal JSON estimates retain identical UTF-8 serialized byte counts. Top-level
values producing no JSON string are also unmeasurable. This is not a claim about
exact heap size, RSS limits, serialization CPU bounds or incident causality.

## Invariants

- Serialize once; no retry, coercion fallback or error detail logging.
- Catch serialization/encoding errors, return Infinity, never a free estimate.
- Keep valid nested JSON omission semantics unchanged.
- Authoritative Markdown and current results survive cache rejection; cache row
  accounting returns to zero and subsequent normal data can be cached.
- No permission, path, revision, API schema or cache budget limit changes.

## Verification

Table tests cover Unicode, escapes, dates, null and valid JSON values; cyclic
objects, BigInt, throwing getter/toJSON, and missing JSON representations fail
closed. Exercise the real budget including overhead, and real temporary Markdown
through sorted metadata reads, repeated reads and repair/invalidation. Run focused
tests, build, independent review, full suite with one worker, and diff checks.
