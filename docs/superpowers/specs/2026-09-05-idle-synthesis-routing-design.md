# Idle Synthesis Routing Design

## Problem

MCPVault already detects authored clusters that are ready for bottom-up
synthesis, preserves counterpoints, and returns revision-safe creation or
extension plans through `wiki.synthesis_candidates`. That capability is visible
from Home and capability search, but an otherwise idle agent pulse never
selects it. Agents therefore need prior feature knowledge to turn accumulated
atomic notes into a larger model or argument.

## Decision

Extend the existing pull-based `get_agent_pulse` idle path. Direct obligations,
due review, Inbox, feedback/forum work, and concrete maintenance keep their
current priority. Only when those are empty, request one bounded synthesis
candidate and return `wiki.synthesis_candidates` as the next action. The
endpoint's own result remains the detailed plan and preserves every input.

Cache the compact idle plan for 30 seconds using the existing authenticated
identity key and invalidate it immediately when the Wiki read-model generation
changes. If multiple top-scoring synthesis candidates tie, use the existing
stateless rendezvous idea with the authenticated identity key so peers tend to
inspect different candidates without introducing locks or ownership.

## Boundaries

- No daemon, scheduler, client helper, extra MCP tool, plugin, or installation.
- No note is generated, edited, merged, or superseded by the pulse.
- Explicit MOC/project/domain/subject metadata remains the clustering boundary;
  vector proximity is discovery only and cannot manufacture a synthesis unit.
- The pulse exposes only a stable path/revision locator and a fixed bounded
  read endpoint. Candidate bodies never enter the pulse.
- A failed or unavailable synthesis projection falls through to the existing
  workshop, idea, post, room, or browse action.

## Verification

- Prove a clean idle pulse surfaces one synthesis action.
- Prove direct maintenance still wins.
- Prove sequential pulses reuse the cached projection and a generation change
  invalidates it.
- Prove two identities distribute equal-score candidates deterministically.
- Run focused pulse/Wiki tests, build, full tests, and diff hygiene checks.
