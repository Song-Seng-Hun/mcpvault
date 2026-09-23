---
id: nas-native-reviewed-skills
description: Serve reviewed skill bytes from NAS; retire the local operational mirror.
keywords: [NAS, skills, active, migration, 검토, 활성화]
use_when: Migrating reviewed releases or diagnosing skill availability.
parent: 2026-09-21-reviewed-source-access.md
---
# NAS-native reviewed skills

Current content: `Community/Skills/<name>/SKILL.md` and registered sibling resources.
Review evidence: Vault `.mcpvault-reviewed-skills/blobs/<sha256>`.
Registry: Vault `.mcpvault-reviewed-skills/registry.json`.
Local server configuration pins its SHA-256; no local skill bodies are required.
Configuration is not a new account, certificate binding or access grant.

Use `--reviewed-skills-config` with version 4, `authorization: source-access`,
`vaultPath` and `registryHash`. Do not include `hostPath` or legacy grant fields.
Version 1–3 remains readable for explicit rollback, not automatic fallback.

Registry v1 contains entries with `registration`, `contentFingerprint`, `resources`.
Registration reuses reviewed admission evidence. Resources map blob hashes to
relative paths within that skill; the main procedure must map to `SKILL.md`.
The original manifest fingerprint remains review provenance. The content fingerprint
binds the entire current NAS folder, including its metadata. Never substitute one for the other.

## Transition

Verify the old admission, complete evidence and current original fingerprint first.
Preserve exact originals and recovery records on NAS before replacing any file.
Write approved resource bytes unchanged; preserve license and restriction metadata.
Write a per-skill status record, then compute the current folder fingerprint.
Publish the registry last. Pin its hash only after verification; restart normally.
Read through the existing authenticated service. Count activation only after this succeeds.
Unreviewed skills stay quarantined. An `active` flag alone grants nothing.

## Failure and revocation

Body, reference, folder, registry or permission changes stop delivery.
Never return a local/archive body when a current NAS file is missing or changed.
Registry replacement stops all reads under its old pin until explicitly configured.
For rollback, check current output hashes before restoring originals and the old config.
Keep old review evidence until transition and rollback checks pass; do not delete in bulk.
Raw note access remains quarantined. Reviewed read approval never authorizes execution.
NAS outage is unavailable, not deleted. Historical local-delivery counts are not NAS-native counts.
