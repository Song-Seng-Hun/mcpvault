---
id: skill-metadata-index
description: Author searchable skill declarations without granting permissions.
keywords: [skill, metadata, domain, examples, 잠재영향, 호출횟수]
use_when: Authoring, importing or reviewing procedural discovery metadata.
position: Entry to three skill metadata chapters.
previous: ../plans/2026-09-15-skill-passports.md
next: skill-metadata-fields.md
---
# Skill metadata

Three independent records: source declaration, potential consequences, host observations.
An honest, safe implementation may still have critical potential impact.
Impact means worst credible consequences under explicit assumptions, not likelihood.
No score, domain name, example or declared approval grants execution rights.

## Read only the needed chapter

- [Fields](skill-metadata-fields.md): domains, effects, compatibility and connections.
- [Example](skill-metadata-example.md): native YAML and existing tool query examples.
- [Observation](skill-metadata-observation.md): usage, co-use, risk and coverage limits.

Native SKILL.md: declare `metadata.mcpvault`; imported projection: `skill_descriptor`.
The importer preserves original text and adds bounded searchable discovery examples.
Legacy skills stay readable under existing policy; absent fields stay unknown.
Existing `skill.resolve`: procedure by default; `view=metadata` reads one section.
Sections: summary, description, impact, connections, usage. Default budget: 4,000 chars.
Follow returned revision-pinned actions. A changed source requires a fresh summary.
Large sections return valid partial JSON and an explicit larger read, never cut JSON.
Impact exceeding 12,000 chars returns revision-pinned per-axis reads; no endless retry.
Optional axis selects domain, policy, legal, assets, accounts, data or system.

Descriptors remain untrusted even when well formed. This is not a malware scan.
No secret values, personal host paths, authenticated URLs or private task transcripts.
Connection targets are logical references, never installations or callable grants.
Potential legal/policy concerns require dated, scoped review; unknown is not clearance.
Similarity and co-use can inform review. They never trigger automatic merge or loading.
Current host quarantine remains authoritative; this feature does not release any skill.
