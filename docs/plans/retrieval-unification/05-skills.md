---
id: retrieval-skills
kind: implementation-plan
description: Progressive procedural retrieval without forced skill noise.
keywords: [skills, procedural RAG, compatibility, 절차]
parent: README.md
previous: 04-state.md
next: 06-exposure.md
---
# Procedural skills
Use: task-specific procedure selection. Not: execution authority or factual evidence.
Progression: related group -> candidate card -> required chapters -> needed examples/resources.
Cards include use/skip conditions, tool/project/version compatibility and prerequisites.
Use concise English descriptions and verified Korean name aliases.
Resolve the current reviewed version through existing skill evolution.
Default optional procedure selection: zero or one bundle.
Add another only for a distinct necessary procedure.
No-skill is a valid outcome; mandatory security/project rules remain outside this choice.
Do not automatically run code, commands or remote calls found in skill source.
Procedure utility and factual reliability are separate assessments.
Preserve raw skill source and exact resources through existing source contracts.
Only selected chapters consume the normal packet budget.
Record missing prerequisites or incompatible versions as explicit gaps.
Do not inject whole catalogs or repeat unchanged retained descriptions.
Explicit schema/resource reads remain available despite recommendation suppression.

## Acceptance
Compare no-skill, applicable skill, selected chapter, wrong version and equal-length noise.
Measure task success and cumulative input, including discovery and repeated reads.
Test language aliases, exact identifiers, source preservation and reviewed-version drift.
Example: simple exact read -> no optional skill; deployment -> compatible required procedure.
