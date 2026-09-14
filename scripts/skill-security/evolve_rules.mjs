// Compatibility stop: rule changes are reviewed host maintenance, never an audit side effect.
export function evolveRuleEngine() {
  throw new Error('AUTOMATIC_RULE_MUTATION_DISABLED: review rules, test, and pin a new basis explicitly');
}
if (process.argv[1]?.endsWith('evolve_rules.mjs')) {
  console.error('AUTOMATIC_RULE_MUTATION_DISABLED');
  process.exitCode = 3;
}
