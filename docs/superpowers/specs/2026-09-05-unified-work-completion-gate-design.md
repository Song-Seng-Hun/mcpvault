# Unified Work Completion Gate Design

## Problem

MCPVault represents work in two compatible forms: managed agent tasks under
`Community/Tasks/` and ordinary knowledge notes carrying `task_status`. Agent
tasks already require an auditable knowledge disposition when they enter
`completed`, but ordinary actionable notes can enter the same state through
the Wiki workflows without returning a lesson, a failed path, or an explicit
reason why nothing reusable exists. That leaves two meanings of "completed"
and permits maintenance debt to bypass the existing exit gate.

## Decision

Use one completion-disposition contract for both work representations while
preserving Obsidian-first interoperability.

Normal Wiki workflows that move an ordinary actionable note from a non-complete
state to `task_status: completed` must provide at least one of:

- one or more visible durable `knowledge_notes`;
- one or more visible negative `negative_knowledge_notes`;
- a bounded experiential `retrospective`; or
- the exclusive `no_reusable_knowledge` disposition with a bounded
  `knowledge_disposition_reason`.

Useful dispositions may be combined. `no_reusable_knowledge` cannot be
combined with a retrospective or linked artifacts. Durable and negative note
paths must resolve through the caller's scope and point to the expected public
knowledge role. The normalized result is stored as ordinary Obsidian
Properties: `knowledge_notes`, `negative_knowledge_notes`, `retrospective`,
`knowledge_dispositions`, and `knowledge_disposition_reason`.

The gate applies only when a workflow enters `completed`, or when disposition
inputs on an already-completed note are explicitly changed. An unrelated
metadata edit to an existing legacy completed note remains possible so that a
repair operation cannot deadlock itself.

## Obsidian and Git interoperability

MCPVault will not block direct Obsidian or Git edits. Markdown and Properties
remain authoritative, and external editors cannot be forced through an MCP
endpoint. Instead, organization lint reports
`completed_work_without_knowledge_disposition` for a completed actionable note
that lacks a valid disposition. The review packet promotes this finding to a
bounded repair action. This combination gives normal agents a preventive gate
and gives out-of-band edits a recoverable path without a daemon, lock file, or
alternate database.

## Surface and architecture

- Extend existing Wiki mutation schemas and dispatch only; add no fixed MCP
  tool and no endpoint.
- Put normalization and mutual-exclusion validation in one pure organization
  helper shared by `AgentTaskService` and `LlmWikiService`.
- Keep path resolution, scope visibility, and role validation inside the
  service that has filesystem and principal access.
- Preserve optimistic `expectedRevision` writes and verify mutations through
  the existing read-after-write behavior.
- Add the five disposition Properties to the public organization contract and
  progressive work policy.

## Rejected alternatives

### Block all generic and filesystem writes

This would make MCPVault cease to be an ordinary Obsidian Vault and still
could not control edits made outside the process.

### Advisory lint only

This would document the problem but continue allowing the primary Wiki APIs to
produce incomplete work records.

### Background retrospective extractor

Automatic extraction from prompts, logs, or hidden reasoning would add privacy
risk, unverifiable synthesis, persistent runtime work, and another source of
truth. The system should request an explicit bounded disposition instead.

## Verification

Tests must cover successful artifact, retrospective, and explained-no-reuse
completion; empty, contradictory, hidden, wrong-role, and stale-revision
failures; legacy completed-note repair; bounded lint/review output; endpoint
schema forwarding; and regression of the existing agent-task gate. Build, the
full test suite, and `git diff --check` remain release gates.
