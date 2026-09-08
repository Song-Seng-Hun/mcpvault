# Recorded model pilot: managed workshops and quests

## What was actually run

On 2026-09-08 two isolated native Codex worker sessions used
`gpt-5.6-luna`, reasoning `medium`, sequentially (no overlapping model trials).
Both received the same 12 fact sets and a five-minute ceiling, with the same
1,600-character common-result limit. The managed arm additionally received the
current method catalogue/input guide and a 6,000-character method-record ceiling.
The free arm could not inspect those guides or the other arm. Neither could read
the other's output, use the live MCP, create accounts, or move real XP.

The cases cover product, design, research, risk, retrospective and incident work,
two each. Inputs: [case definitions](workshop-evaluation-cases.json).
Unmodified model records: [free](workshop-evaluation-free.json),
[managed](workshop-evaluation-managed.json).

This is a **paired single-account proposal pilot**, not a multi-person consensus
experiment, a Gemini/Claude host trial, or evidence of autonomous real-world
execution. A common output contract itself prompts some good practices in both
arms. The different method-record allowance prevents a claim of equal token cost.
No detailed implementation or successful answer was supplied to the workers.

After both sessions ended, `workshop-model-evaluation.test.ts` replayed their
records through actual FileSystem/Reference/Ideation services in temporary Vaults.
Free long proposals used an ordinary referenced note plus the unchanged short
legacy contribution. Managed records completed 36 method steps, synthesis and
explicit close. Both arms passed on first replay. This automated replay is a
separate protocol check, **not an additional model trial or proof that the model
itself authenticated and called every endpoint**. Temporary Vaults were removed.

## Measurements and observations

Counts below use compact JSON character lengths, not tokens. All supplied output
is BMP text, so the measured JavaScript/PowerShell lengths equal Unicode code
point counts for these records. Formatting whitespace in the stored files is
excluded. Result-record length includes identifiers and method records where
present, but not the overall file envelope.

| Measure across 12 cases | Free | Managed |
| --- | ---: | ---: |
| Common result characters | 8,399 | 8,071 |
| Complete case record characters | 8,727 | 22,503 |
| Alternatives listed in common result | 12 | 24 |
| Provided fact IDs cited in common result | 35 | 34 |
| Common results retaining a risk and uncertainty | 12 | 12 |
| Explicit method-step records | 0 | 36 |
| Cases passing service replay | 12 | 12 |

Managed recording cost was **2.58 times** the free record size; its final result
size was similar. More listed alternatives is not a measurement of more useful
or genuinely distinct ideas. For example, managed product-1's top-N, next-page and
two-stage pagination proposals overlap. Structural ID uniqueness does not solve
semantic duplication. Free results also preserved uncertainties because the
common result contract asked for them.

The managed incident-2 factor “worker disappeared” goes beyond the supplied fact
that the ledger has no worker despite an existing Work receipt. The uncertainty
elsewhere in the result does not make that causal gloss verified. This is a
concrete model-quality limitation; the server correctly treats the material as a
proposal, not machine-certified truth. No original record was silently corrected
to improve the score. Both arms proposed bounded checks and did not claim to have
deployed fixes. No independent blinded usefulness rating was performed.

Managed dispatch-to-observed-completion was 216,983 ms, including coordinator
observation delay; this is an upper bound, not model compute time. The free arm
was not instrumented equivalently. Host token usage was unavailable. Therefore
there is no measured token, latency, or efficiency superiority claim. The combined
record replay, output authorization regression and 1,000-case simulation test run
took 30.48 seconds with one worker; that is test runtime, not model runtime.

## Small free-versus-paid behavior comparison

Each worker also received one identical bounded project opportunity, with the
free or escrow-backed route selected for its arm. Both preserved source/revision
verification, a next-session check and refusal of self-approval or hostile peer
instructions. The paid result additionally checked contract terms and escrow;
neither treated XP as execution permission or performed live financial writes.

This checks proposal comprehension only. Goal completion, verified deployed
artifact yield, independent-owner repeat trade, XP reinvestment and actual
next-session return are **not measured** by a one-opportunity text pilot. They
must not be assigned invented success rates. Separate MCP protocol tests exercise
three authenticated synthetic accounts, exact artifacts, review/payout and
interrupted claim recovery; those test identities do not prove independent human
owners. The deterministic 1,000-case model checks conservation, unauthorized
newcomers, circulation, inactivity, concentration and minimum-reward behavior,
not a real economy's fairness or liquidity forecast.

## Deployment interpretation

The pilot supports keeping methods optional and exposing bounded per-step
guidance, not making every task a large meeting. Exact source locators, minority
views, review conditions and normal output authorization remain necessary.
Production economy stays OFF. Live owner verification, funding, reviewer staffing
and a longitudinal operating experiment require a separate host decision; code
completion does not grant those authorities.

The host storage probe also ran against `E:\dev\llm_wiki` and
`E:\llm_wiki\llm_wiki`: both reported NTFS and passed exclusive-create, fsync,
rename and reread. Sandbox-only WMI access was denied first; the explicitly
approved host diagnostic succeeded. Only its own scratch files were removed.
No private economy configuration or funded ledger was created. This is not a
power-loss test, nor proof about a future checkpoint directory.
