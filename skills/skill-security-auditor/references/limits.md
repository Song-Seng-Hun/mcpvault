---
id: skill-audit-limits
description: Interpret findings without false safety claims or destructive remediation.
keywords: [false positive, incomplete, isolation, review, 한계]
parent: ../SKILL.md
previous: ../reference.md
next: research-checks.md
---
# Limits and disposition

This is bounded static pattern inspection, not an AST analyzer, malware sandbox,
formal verifier, dependency provenance service, or proof against prompt injection.
Worker isolation limits regex time and JS heap. It is not an OS security boundary.
It does not prevent all native-memory pressure or interrupt every blocked NAS I/O.
Prefer an access-controlled local snapshot and a minimally privileged host process.
Targets may not mutate that snapshot or the engine during inspection.
NAS availability failure is unknown coverage, never an empty clean inventory.

Report file IDs, rule IDs and severity only; retrieve exact source through an
authorized bounded read when needed. Do not log raw secrets, payloads or filenames.
Hash values can correlate documents; keep reports within the source's restrictions.

Example: a credential token is detected -> report type/location ID, not its value.
Example: a valid security tutorial triggers a rule -> inspect its actual use,
record the false-positive rationale against exact bytes; do not exempt all docs.
Example: a large archive remains unread -> report incomplete, not zero-risk.

No self-exclusion establishes trust in this engine. Review host-owned code and
rules separately; preserve provenance, hashes, tests and recovery copies.
The retained legacy patterns can be slow or noisy. Timeout is incomplete.
Changing patterns requires explicit review, negative/positive cases, full-path
tests and a new basis. Never tune against only a favored set of passing skills.

Do not rewrite code, strip examples, rename Korean identifiers, delete resources,
change permissions, or move quarantine data merely to satisfy a scanner.
Manual approval must specify what may run, where, with which inputs and effects.

Decoded views: at most 4 layers, 24 queued views and 512 KiB decoded text.
ROT13 views stop at 65,536 characters; skipped coverage is incomplete.
Bundle analysis retains at most 2 MiB text and checks 128 literal references.
It joins linked 2,048-character boundaries; capability signals include decoded views.
External, missing, dynamic and outside references remain uninspected; no fetch.
`referencesComplete` describes this parser scope, not every possible dependency.
Arbitrary syntax, encodings, distant text fragments and semantic paraphrases can evade it.
Related file IDs indicate review candidates, not proven data flow or malicious intent.
Read [research checks](research-checks.md) for lifecycle review beyond static patterns.
Directed capability paths stop at 3 edges / 4 files and 512 states; excess is incomplete.
ROT13 participates in bounded pattern decoding, not literal reference resolution.
HTML entities use a small allowlist; unknown names remain incomplete.
Resource states describe inspection, never proof of image meaning or dependency closure.
