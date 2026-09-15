---
id: reviewed-skill-independent-delivery
description: Verified inactive runtime delivery and remaining actual-skill admission restrictions.
keywords: [deployment, independent trial, regression, quarantine, 배포]
use_when: Checking delivered code and distinguishing it from usable reviewed skills.
parent: 2026-09-15-reviewed-skill-release.md
previous: 2026-09-16-reviewed-skill-independent-trials.md
next: 2026-09-16-reviewed-writing-v3-package.md
---
# Independent-trial code delivery

Starting main: 07f3975eb82edf16ea01680d52ba43cc711d73ba.
Only evidence-format validation and its tests changed executable source.
No scanner rule, admission authority, account, firewall or listener policy changed.

## Fresh validation

- RED: the new independent-method acceptance test failed on the old verifier.
- GREEN: 32 targeted tests across evidence, admission and passport passed; build passed.
- Full e: exact 525 files, 7,074 passed, 4 skipped, 7,078 total; process exited zero.
- Basis: `1d3e5b6befe0a121478638e48df6c105f07acd7b83a41e0077d3ae6bc94f4152`.
- Current source/build basis matched after full regression and deployment.
- Four Windows-specific skips remain unverified, not counted as passed.
- Solo source/security review and staged path/whitespace/selected-secret checks passed.
- Actual writing-v3 package: prior verifier rejected, new verifier accepted; 6 negative controls passed.
- Forty package blobs and twenty earlier artifacts reread; original failed trial preserved.

## Deployment and actual observations

- Retained old runtime and launcher; all 1,068 dist files copied and hash-compared.
- PID 16500 served 127.0.0.1:8788 from the independent-text-e deployment when inspected.
- Original, world and economy bytes/checkpoints matched across controlled writer restart.
- Quarantine flag remained present; reviewed-reader configuration remained absent.
- Welcome exact-read returned the same revision with bounded content and continuation.
- Procedures search, limit 1 / 512 characters: empty cards and explicit partial notice.
- skill.resolve catalog entry remained locked by owner consent; no alternate access attempted.
- Original-path server denial verified before deployment; post-deployment retry was stopped by host safety review.
- That stopped retry is not evidence of post-deployment server enforcement; do not repeat or bypass it.

## Remaining work

No actual release registered or authenticated approved-skill read completed; live usable = 0.
Previously refused canary access settings remain untouched; no substitute grants created.
No bundle script execution, new model call, new agent, Telnet or NAS protection change.
Writing v3's text-trial package is prepared, not a live approval or universal safety guarantee.
Full-library metadata and remaining procedural reviews continue as separate tracked work.
Fork commit/push follows final staging; raw evidence and host data stay outside Git.
