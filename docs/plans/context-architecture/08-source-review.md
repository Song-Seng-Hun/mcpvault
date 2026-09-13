---
id: context-source-review
kind: source-review
description: Pinned Caveman provenance and Codex hook limitations; not activation evidence.
keywords: [Caveman, licensing, hooks, code mode, provenance]
parent: README.md
previous: 07-source-chapter-use.md
next: 09-librarian-preflight.md
---
# Reviewed references

Caveman commit: `15581d14007fd01fb3f132016741962f34936ca2`.
Reviewed2026-09-13; upstream commit date2026-09-07.
Only plaintext source and notices were fetched; nothing was executed or installed.

- [Skill](https://github.com/JuliusBrussee/caveman/blob/15581d14007fd01fb3f132016741962f34936ca2/skills/caveman/SKILL.md).
- Skill SHA-256: `c4d7354b4b063d54601fcdd5097a5b1713d1a1a2e386ac39efa438aa1ffef8ce`.
- [License scope](https://github.com/JuliusBrussee/caveman/blob/15581d14007fd01fb3f132016741962f34936ca2/LICENSING.md).
- Scope SHA-256: `84e8dfe4096a9989640ed5d544355cc8878a874346245ec3b643bd5001c7b106`.
- [Copyright notice](https://github.com/JuliusBrussee/caveman/blob/15581d14007fd01fb3f132016741962f34936ca2/LICENSE).
- Notice SHA-256: `94fe75d355887f84ee7eefca68e06d8d082a23dad47a8e1f58a94d98900edf5b`.

Upstream assigns MIT to skills and BSL-1.1 to engine-linked components.
Do not import the whole repository as MIT. Preserve applicable notices on import.
The separate compression skill delegates to Claude and overwrites originals.
That execution path remains excluded; its SHA-256 is:
`377b0b8682d9db1a832c20ee6732ed0f19f55e4f7048955296128244c869c916`.

Vault adaptation keeps qualifiers, exact identifiers and clear safety sentences.
It overrides upstream session-language and persisted-document exclusions.
It keeps required progress updates and work records; no fake broken grammar.
Import and presentation-profile registration remain pending P1 implementation.

## Host hooks

[Official hooks documentation](https://learn.chatgpt.com/docs/hooks) was read.
Documented PreToolUse supports nested code-mode calls; PostToolUse cannot undo writes.
Hosted WebSearch is outside that hook path. Delayed shell completion has separate timing.
Documented support is not measured acceptance by this installed app.
No native hook, external provider or background model was activated here.
