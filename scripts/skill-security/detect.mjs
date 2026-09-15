// Findings are review signals, not proof of malicious intent. Never execute target text.
import { inspectionViews } from './decode.mjs';
import { researchSignals } from './signals.mjs';
const BUILTIN = [
  ['INSTRUCTION_OVERRIDE', /\b(?:ignore|disregard|forget|bypass)\s+(?:all\s+)?(?:previous|parent|system|security)\s+(?:instructions?|rules?|prompts?|constraints?)\b/i],
  ['INSTRUCTION_OVERRIDE', /(?:이전|상위|시스템|부모)\s*(?:지침|규칙|명령|프롬프트)[^\n]{0,60}(?:무시|우회|폐기)/],
  ['INSTRUCTION_OVERRIDE', /(?:忽略|无视).{0,20}(?:指令|规则)|(?:システム|以前の).{0,30}(?:無視|破棄)/],
  ['CREDENTIAL_LITERAL', /\b(?:ghp_[a-zA-Z0-9]{36}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|hf_[A-Za-z0-9]{30,})\b|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['CREDENTIAL_ACCESS', /(?:\.aws[\\/]credentials|\.ssh[\\/]id_|\/etc\/shadow|\.mcpvault[\\/]secrets)/i],
  ['REMOTE_EXECUTION', /(?:curl|wget)[^\n]{0,500}\|\s*(?:sudo\s+)?(?:bash|sh|pwsh|powershell|python|node)\b|\b(?:iex|Invoke-Expression)\s*\(/i],
  ['UNSAFE_DESERIALIZATION', /\b(?:pickle\.loads|_pickle\.loads|marshal\.loads|yaml\.unsafe_load)\s*\(/],
  ['TOOL_MUTATION', /(?:globalThis|global|window)\.(?:fetch|eval|Function)\s*=|__builtins__\.[\w]+\s*=/],
  ['INSTALL_HOOK', /["'](?:preinstall|postinstall|install|prepare)["']\s*:\s*["'][^"']+/i],
  ['DYNAMIC_EXECUTION', /\b(?:eval|exec|Function)\s*\(|\b(?:execSync|spawnSync|os\.system|subprocess\.(?:run|Popen))\s*\(/],
  ['DESTRUCTIVE_OPERATION', /\brm\s+-[^\n ]*[rf][^\n ]*\s+|\b(?:Remove-Item|rmdir|format)\b[^\n]{0,100}(?:-Recurse|\/s|[a-z]:)/i],
  ['EXTERNAL_TRANSFER', /\b(?:fetch|axios\.(?:post|get)|requests\.(?:post|get)|https?\.request)\s*\(|\b(?:curl|wget)\s+https?:/i],
  ['PERSISTENT_INSTRUCTION_CHANGE', /(?:write|append|overwrite|replace|modify)[^\n]{0,100}(?:AGENTS\.md|CLAUDE\.md|SKILL\.md|\.cursorrules)/i],
];
export function compileRules(config) {
  if (!config || typeof config.version !== 'string' || config.version.length > 40) throw Error('RULES_INVALID');
  const rules = [];
  for (const key of ['staticRules', 'subagentRules', 'codeRules']) {
    if (!Array.isArray(config[key]) || !config[key].length || config[key].length > 256) throw Error('RULES_INVALID');
    for (const rule of config[key]) {
      if (!rule || !/^[A-Z][A-Z0-9_]{0,79}$/.test(rule.id) || !['CRITICAL','HIGH','MEDIUM'].includes(rule.severity)) throw Error('RULES_INVALID');
      const pattern = rule.patternB64 ? Buffer.from(rule.patternB64, 'base64').toString('utf8') : rule.pattern;
      if (typeof pattern !== 'string' || !pattern.length || pattern.length > 16384) throw Error('RULES_INVALID');
      rules.push([rule.id, new RegExp(pattern, 'i'), rule.severity]);
    }
  }
  return rules;
}
export function detect(text, extra, add) {
  for (const value of inspectionViews(text,add)) {
    for (const [id, regex, severity = 'HIGH'] of [...BUILTIN, ...extra]) {
      if (regex.test(value)) add(id, severity);
    }
    researchSignals(value,add);
  }
}
