// Findings are review signals, not proof of malicious intent. Never execute target text.
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
  const nfkc = text.normalize('NFKC');
  if (/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD]/u.test(nfkc)) add('INVISIBLE_CONTROLS', 'HIGH');
  if (/[\u{E0000}-\u{E007F}]/u.test(text)) add('UNICODE_TAGS', 'HIGH');
  // Preserve the original; use transformed views only for detection, never as output or commands.
  const normalized = nfkc.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD]/gu, '');
  const views = new Set([text, normalized]);
  let decodedBytes = 0, variants = 0;
  const view = value => {
    if (++variants > 16 || (decodedBytes += value.length) > 262144) { add('DECODE_BUDGET', 'HIGH', true); return; }
    views.add(value.normalize('NFKC'));
  };
  if (/\\[xu][0-9a-f]/i.test(normalized)) view(normalized.replace(/\\x([0-9a-f]{2})|\\u([0-9a-f]{4})/gi, (_, a, b) => String.fromCharCode(parseInt(a || b, 16))));
  for (const match of normalized.matchAll(/[A-Za-z0-9+/]{40,}={0,2}|\b[0-9a-fA-F]{24,}\b/g)) {
    if (variants >= 16) { add('DECODE_BUDGET', 'HIGH', true); break; }
    view(Buffer.from(match[0], /^[0-9a-f]+$/i.test(match[0]) ? 'hex' : 'base64').toString('utf8'));
  }
  for (const match of normalized.matchAll(/(?:%[0-9a-f]{2}){4,}/gi)) {
    if (variants >= 16) { add('DECODE_BUDGET', 'HIGH', true); break; }
    try { view(decodeURIComponent(match[0])); } catch { add('UNDECODABLE_SEQUENCE', 'MEDIUM'); }
  }
  for (const match of normalized.matchAll(/\b(?:[01]{8}[\s,]+){4,}[01]{8}\b/g)) {
    if (variants >= 16) { add('DECODE_BUDGET', 'HIGH', true); break; }
    view(Buffer.from(match[0].split(/[\s,]+/).map(bits => parseInt(bits, 2))).toString('utf8'));
  }
  // Limited cipher views do not establish semantic completeness or decryption coverage.
  view(normalized.replace(/[a-z]/gi, c => String.fromCharCode(c.charCodeAt(0) + (c.toLowerCase() <= 'm' ? 13 : -13))));
  for (const value of views) for (const [id, regex, severity = 'HIGH'] of [...BUILTIN, ...extra]) {
    if (regex.test(value)) add(id, severity);
  }
}
