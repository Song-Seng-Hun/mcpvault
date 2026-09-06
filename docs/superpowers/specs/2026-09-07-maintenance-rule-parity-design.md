# Maintenance Rule Parity

Goal-approved implementation, fork main only. The prior increment passed its
full suite and was pushed; this continuation addresses its recorded follow-ups.

## Evidence and design

Both organization lint and maintenance use a raw wikilink regex for empty MOCs.
They count fenced/inline/escaped examples and reject relative Markdown links
already recognized by the Obsidian graph. Reuse extractObsidianLinkOccurrences
with limit1; this detects a authored navigational link, not proof the destination
exists or is accessible. No resolution, hidden-candidate lookup or auto-linking.

Maintenance uses scalar truthiness for project actions, unlike authored-text
rules in organization.ts. Define needsAuthoredNextAction using existing
isOpenActionableKnowledge, normalized active lifecycle, hasAuthoredNextAction,
hasAuthoredText(waiting_for), and non-waiting/non-blocked task status. Reuse in
both lint and maintenance. Terminal/retired/someday work and explicit holds do
not need a new action; invalid task status remains repairable, never execution
authorization. This measures authored plan completeness, not dependency/defer
execution readiness. Ordinary actionable knowledge keeps its content kind.

Preserve project reason/code identifiers. Add work_without_next_action for other
actionable notes at the same score. The existing project packet inspect action
passes path to a schema that does not accept path; replace work-debt inspection
with an exact-path wiki projection. Repair hints accept nextAction, nextActions
or waitingFor, using the already checked revision. The published wiki.triage
schema must expose all three alternatives with the existing service constraints;
nextAction was missing and is added as a string of at most500 characters. No
extra MCP tools or automatic writes.

Alternatives rejected: duplicate fixes would drift again; running full lint for
every maintenance row would add unrelated work and blur lightweight priorities.

## Proof and limits

Test lint and maintenance against the same action/hold/malformed/terminal matrix,
project/task/question roles, and actual source files. Test Markdown fence lengths,
delimiter mismatch, inline/escaped literals, ordinary wiki/relative links,
external-only links and missing targets. Verify exact-path bounded inspection and
unchanged source bytes, plus existing revision/hidden behavior. Parser masks can
allocate proportional to source length; result limit1 is not a constant-memory
parsing claim. Build, focused/full one-worker tests, independent review, fork push.
