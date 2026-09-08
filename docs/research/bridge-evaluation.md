# Research bridge evaluation

The deterministic fixture in `src/research-bridge-evaluation.test.ts` is a regression harness for the research bridge contract. It creates twelve isolated Markdown vaults: three known connections, three plausible analogies, three weak combinations, and three incorrect links. Each case compares the bridge with the existing lexical `SearchService` over the same admitted corpus, excluding the focus and compare anchors. If the fixture omits a query, baseline search uses the focus's first authored method, first subject term, or filename, in that order. The cases exercise that baseline alongside authored relations, two anchor mediation, two hop paths, hidden or draft inputs, actionable revision checked reading locators, duplicate suppression, and the `maxChars` output bound.

The fixture answers a narrow engineering question: does the bridge return the expected bounded discovery material for controlled inputs? It does not measure scientific usefulness, novelty, correctness of an analogy, user learning, or emergence of a research field. A passing case is a synthetic regression result, and an omitted candidate is only an outcome under the fixture's access and metadata rules.

## Human actual 12 question protocol

Run twelve real research questions through the same bridge workflow and existing lexical search baseline: three questions with an already known connection, three questions asking for a plausible analogy, three questions deliberately combining weak signals, and three questions containing an incorrect or misleading link. Use the same participant, vault snapshot, model settings, limit, and `maxChars` for both systems. Randomize question order and keep the source notes and revisions fixed during each question.

The following question set is a study starting point, not completed research or ground truth. Before a real run, curate source notes and counterexamples, pin revisions, and verify each intended category against prior work. The synthetic fixtures above are separate from these questions.

| Intended group | Question to investigate |
| --- | --- |
| Rediscovery 1 | Which assumptions connect a mathematical symmetry to a physical conservation statement? |
| Rediscovery 2 | How can a graph operator describe a diffusion process, and where does that representation fail? |
| Rediscovery 3 | What definitions and units must be preserved when comparing information entropy with a physical entropy? |
| Analogy 1 | Can an ecological resilience model suggest a falsifiable recovery measure for a software dependency network? |
| Analogy 2 | Can control feedback provide a useful model of a research group's review process, and which roles have no counterpart? |
| Analogy 3 | Could a musical variation technique generate mathematical conjectures with a concrete counterexample test? |
| Weak combination 1 | Does shared use of the word complexity supply any testable connection between a proof and a painting? |
| Weak combination 2 | What extra observations would be needed to connect a crystal structure with a social community? |
| Weak combination 3 | Can a shared metaphor of growth connect a bibliography to a biological process without inventing a mechanism? |
| Misleading link 1 | Does the same word field justify mapping an agricultural field onto an algebraic field? |
| Misleading link 2 | Does a physical measure of work transfer to task effort without a defined measurement model? |
| Misleading link 3 | If A is related to B and B to C, what counterexample defeats the proposed causal conclusion A causes C? |

For every question, record:

1. wall clock time from prompt to a logged conclusion;
2. input and output token counts, including tool calls;
3. number of notes opened, passages read, and notes written or revised;
4. whether the participant accepted, rejected, or deferred each candidate;
5. the final research question, with its assumptions and counterexample to check;
6. whether the question became more falsifiable: an observable variable, conditions, predicted outcome, and a disconfirming result.

Predefine success before looking at results. The primary outcome is advancement to a falsifiable question, judged by two independent human raters using the same rubric. Tokens, elapsed time, and note burden are secondary cost measures. Report per-category results and the paired difference between bridge and lexical baseline, with disagreements and missing data retained.

Use one row per question and condition: `question_id, condition, input_paths_and_revisions, query, selected_candidate, prior_work_status, traceable_locators, testable_question, assumptions, disconfirming_observation, duplicate_or_error, token_count, elapsed_seconds, notes_read, notes_written, burden_rating, rater_decision, unresolved`. Token/time and burden values are measured or marked unavailable, never inferred from output length.

This protocol is an actual-user effectiveness study, not an automated certification of emergence, novelty, causality, or scientific validity. Any promising bridge candidate still requires reading the original notes, checking external prior work, comparing conditions, and testing counterexamples. Search absence never proves novelty.
