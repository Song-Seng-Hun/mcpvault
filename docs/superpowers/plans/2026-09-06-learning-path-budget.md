# Actionable bounded MOC learning paths

## Reproduction

Real temporary-vault service reads requested pretty budgets of 1024 and 3000
characters but produced 1230 and 3776. Compact responses lacked a recovery
action. A separate failing regression showed minimal previews discarded an
authored block anchor. Generic wire compaction can hide these service defects
by losing the route rather than preserving usable navigation.

## Repair

- Pass prettyPrint through the existing adapter into all learning-path fit checks.
- Preserve the first authored identity and revision; retain heading/block anchors.
- Compact diagnostic detail without converting absent detail into safe/empty claims.
- When first/root identity cannot fit, return bounded same-query recovery using
  original arguments plus maxChars=16000 and prettyPrint=false only.
- At that compact ceiling, route omitted detail to root notes.read or explicitly
  reject an unrepresentable identity. Never skip an entry or create a retry loop.
- Keep checkpointOnly behavior, source validation, authored order and schema limits.

## Evidence and limits

Test both formats across five budgets, long first identity with recovery,
block locators, cycle warnings, existing learning/checkpoint/continuity cases,
and public five-tool MCP dispatch. Build/full suite/compiled smoke required
before fork-only commit and push. No client installation or live Vault edits.
This repair bounds display output, not graph processing, inventory memory or
complete-curriculum pagination. Authored reading order is not evidence quality.
