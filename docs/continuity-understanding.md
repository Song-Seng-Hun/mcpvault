# Understanding across a pause

Use the existing `continuity.save` / `continuity.resume` endpoints. No additional
client, model, server, credential transfer or public note is created. Private
Markdown is authoritative; projections and a matching revision are not proof.

Three signals are intentionally separate:

- `learningProgress`: the route and last fully read note, not comprehension.
- `understanding[].explanation`: a short, user-facing self-explanation with
  conditions, not hidden reasoning, raw prompts or copied note bodies.
- `checks`: reported self-checks or referenced peer-check reports. A different
  author/model, a passed outcome or a referenced report does not certify
  independence, truth, or permission to run an experiment.

After reading current evidence, save a bounded record using the current
checkpoint `expectedRevision` (or `missing` for first creation):

```json
{
  "endpointId": "continuity.save",
  "arguments": {
    "topic": "Cache recovery",
    "summary": "Reliable events are a necessary condition.",
    "nextAction": "Check the reconciliation design.",
    "expectedRevision": "missing",
    "understanding": [{
      "explanation": "Event-driven invalidation alone does not cover lost events.",
      "supports": [{"path": "Knowledge/Cache.md", "revision": "REPLACE_WITH_CURRENT_64_HEX_REVISION"}],
      "openQuestions": ["How is event loss detected?"],
      "nextStep": "Read the existing reconciliation note before proposing a change."
    }]
  }
}
```

Use the authenticated executor; never put tokens/passwords in the checkpoint.
Host HTTP bearer authentication needs no duplicate `accessToken` argument;
without either transport authentication or a valid login token access is denied.
Discover the exact `continuity.save` schema before composing a checkpoint.
Required top-level fields are `topic`, `summary`, `nextAction`; `understanding`
is an array of objects containing `explanation`, `supports`, and `nextStep`,
with optional `openQuestions` and `checks`. Input-shape failures offer a bounded exact
schema lookup instead of encouraging field-by-field guesses. Do not clear the
array just to bypass validation: `[]` deliberately removes structured findings.
The revision placeholder above is not executable input. Obtain the real revision
from the current note read. Optional paired `startLine`/`endLine` refer to the
**body after YAML Properties**, inclusive and one-based. The returned reading
action converts those to full-file lines and pins the current revision. When a
source changed, an old body range is not reused as a current exact locator.
When references drift, `understanding.changes` pairs each affected path's
`savedRevision` and `currentRevision` with `revision_changed` or
`locator_invalid`. Changed-reference recovery precedes unchanged review cautions.
This proves snapshot/locator drift, not a semantic change: read the current
target and compare it with the historical explanation before describing what
changed. Do not report matching revisions when the returned pair differs.
Vault paths are not paths in the agent client's working directory; cite exact
Obsidian links and revisions rather than constructing a local absolute link.

Limits: four entries, 600-character explanations, 400-character next steps;
four support locators per entry, three check reports (300-character method and
one to four evidence locators each), four 300-character open questions. All
records combined: eight distinct related notes and 10000 raw JSON characters.
Prose links must resolve to the explicit support/check notes; add a locator
instead of smuggling in an unpinned dependency. There is no script evaluation.

`checks[].kind` is `self_check` or `peer_check_report`; `outcome` is a reported
`passed`, `failed` or `inconclusive`, accompanied by `method` and `evidence`.
Even a passed check is not an automatic review approval. Conditions and open
questions remain visible for the next authenticated session.

Resume states:

| State | Meaning / action |
| --- | --- |
| `not_recorded` | Explicitly empty understanding: no pinned findings were checked. Ordinary checkpoint text is still historical; this is not permission to claim unchanged knowledge. |
| `current_references` | References still match; interpret the explanation and inspect checks, not an assertion of truth. |
| `stale_references` | A supporting/check revision or locator changed; read the current pinned target before relying on the old explanation. |
| `review_required` | Declared validity/lifecycle requires review; saving does not renew it. |
| `references_unavailable` | A reference cannot safely be read. No stored explanation/path is exposed by this projection. |
| `saved_unchecked` | Cheap pulse hint only. Call `continuity.resume` for validation. |
| `invalid_checkpoint` | Repair malformed historical Properties using the current checkpoint revision. |

Resume defaults to 6000 and accepts 512–12000 **serialized JSON characters**,
including pretty indentation, reference locators and cautions. An omitted
understanding projection returns `canResume: false`, `detailsOmitted: true`
and a larger-budget resume action. It never truncates an explanation into a
seemingly complete claim. Reading raw checkpoint lines does not validate it.

Ordinary saves preserve omitted understanding. To replace or clear it, first
resume and pass the returned checkpoint revision; `understanding: []` clears
only the understanding records. This prevents an old session from silently
overwriting newer findings. Related-reference locks are short and released
before model work; external Obsidian edits are not a multi-file transaction.

New checkpoints are bound to their authenticated account and existing private
agent/model path. Another account cannot inherit one by claiming the same model
or agent name. Task handoff is separate: deliberately publish an authorized,
non-confidential handoff through existing work/community operations when another
account must participate. Never auto-copy private explanations into public notes.

Agent checkpoints keep their existing agent-private path. Model-only accounts
use `_scopes/models/<model>/_continuity/accounts/<account>/work-state.md`; the
account boundary is enforced in generic reads, writes, scoped fallback, reference
visibility and search before ranking, not merely in continuity or an editable
owner Property. Old model `_continuity/work-state.md` is denied through MCP and
left intact for **host review** in Obsidian/local files. It is not silently copied
or claimed by the next model account. A host must verify historical ownership
and current revisions before deliberately recovering that legacy state into the
correct account path. Existing agent checkpoints do not need this migration.
