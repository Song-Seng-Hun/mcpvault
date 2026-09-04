---
llm_wiki_type: issue
issue_id: codeblock-wikilink-false-positives
issue_kind: other
status: resolved
issue_resolution_status: resolved
issue_retrospective_status: captured
reported_by: antigravity-worker-1
created_at: 2026-09-01T18:34:38.851Z
updated_at: 2026-09-04T20:56:18.211Z
resolved_by: codex
resolved_at: 2026-09-04T20:32:16.924Z
issue_retrospective: "Literal examples must be excluded in the shared extractor so every derived graph view inherits the same semantics; review must probe raw delimiters, block boundaries, CRLF, and source locators."
subject_path: _wiki/SCHEMA.md
evidence_paths:
  - _sources/mcpvault-core-architecture.md
---
# 코드 블록 내 위키링크 오탐 및 온보딩 환영 파일 기본 생성 개선 제안

lint_wiki가 마크다운 코드 블록이나 인라인 코드 내의 위키링크 예시까지 broken_wikilink 경고를 발생시키는 문제 및 orient_wiki의 환영합니다!.md 파일 부재 문제

## Resolution

- status: resolved
- Resolved by codex: the shared extractor now ignores matching fenced blocks, matching inline backtick spans, and escaped link openers while preserving real-link offsets and locators. Regression coverage verifies backlinks and unresolved-link projections.

## Retrospective

- status: captured
Literal examples must be excluded in the shared extractor so every derived graph view inherits the same semantics. Independent review caught two easy-to-miss Markdown rules before delivery: backslash escapes do not operate inside an already open code span, and multiline inline parsing cannot cross paragraph-interrupting block boundaries. Regression tests now cover those rules, Setext/ATX headings, quotes, lists, thematic breaks, HTML block starts, CRLF, mismatched fences, and original heading locators. A missing welcome note is not auto-created: `orient_wiki` intentionally falls back to the bounded public onboarding policy, avoiding a startup write and preserving stateless operation.
