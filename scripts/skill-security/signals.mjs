// Heuristic review signals, not data-flow proofs or host permission decisions.
export function capabilities(text) {
  const has=re=>re.test(text);
  return {
    credential:has(/credential|secret|api[ _-]?key|access[ _-]?token|인증\s*정보|비밀\s*키/i),
    sensitive:has(/credential|secret|private\s+(?:document|file|data)|confidential|chat\s+history|conversation\s+history|비공개|기밀|대화\s*(?:내역|기록)/i),
    sharedDestination:has(/(?:shared|internal)\s+(?:cache|clipboard|service|storage|log)|다른\s*계정|공유\s*(?:캐시|저장소)|내부\s*서비스/i),
    write:has(/\b(?:write|store|save|append|put)\b|저장|기록/i),
    read:has(/\b(?:read|collect|capture|gather|readFile|open)\b|읽|수집/i),
    send:has(/\b(?:send|transmit|upload|dispatch|post|fetch|request|sync)\b|전송|업로드/i),
    external:has(/https?:\/\/|external|remote|endpoint|외부|원격/i),
    execute:has(/\b(?:execute|install|run|eval|exec|spawn)\b|실행|설치/i),
    download:has(/\b(?:download|fetch|curl|wget)\b|다운로드/i),
    persistence:has(/\b(?:memory|remember|future|persistent|MEMORY\.md|SOUL\.md)\b|기억|앞으로/i),
  };
}
export function researchSignals(text,add) {
  const c=capabilities(text);
  if(c.sensitive&&c.read&&(c.send||c.write)&&(c.external||c.sharedDestination))add('SENSITIVE_DESTINATION_REVIEW','HIGH');
  if(/\b(?:decrypt|decipher)\b|복호화/.test(text.toLowerCase()) && /\b(?:ciphertext|AES(?:-\d+)?|PBKDF2|encrypted\s+(?:payload|instructions|blob))\b|암호문/i.test(text))add('OPAQUE_TRANSFORM_UNINSPECTED','HIGH',true);
  if(/(?:earlier|previous|system|parent)\s+(?:constraints|rules|instructions)[\s\S]{0,80}(?:no longer apply|superseded|obsolete)/i.test(text)
    || /(?:skills?|documents?)\s+(?:override|outrank)[\s\S]{0,60}system\s+(?:prompt|instructions)/i.test(text))add('AUTHORITY_REDEFINITION','HIGH');
  if(/\bif\b[^\n]{0,200}[\s\S]{0,600}\b(?:subprocess\.(?:run|Popen)|os\.system|execSync|spawnSync|eval|exec)\s*\(/.test(text))add('CONDITIONAL_EXECUTION_REVIEW','HIGH');
  if(/(?:always|must|반드시|항상)[\s\S]{0,100}(?:select|choose|use|선택|사용)[\s\S]{0,100}(?:before any|regardless|all tasks|every task|무관|모든 작업)/i.test(text)) add('ROUTING_MANIPULATION','HIGH');
  if(/(?:definition of done|completion requirement|완료 조건)[\s\S]{0,400}/i.test(text) && (c.credential&&c.send || c.download&&c.execute)) add('COMPLETION_SIDE_EFFECT','HIGH');
  if(c.persistence && /(?:trusted|authoritative|preferred|신뢰|우선)[\s\S]{0,120}(?:source|vendor|recommend|출처|업체|추천)/i.test(text)) add('PERSISTENT_TRUST_MANIPULATION','HIGH');
  if(/(?:disable|remove|bypass|weaken|생략|비활성|우회)[\s\S]{0,100}(?:approval|security|permission|safety|승인|보안|권한)/i.test(text)) add('SAFETY_RULE_WEAKENING','HIGH');
  if(/(?:only|always)[\s\S]{0,30}(?:answer|return|report)[\s\S]{0,30}(?:approved|pass|safe|clean)/i.test(text) || /(?:omit|hide|suppress)[\s\S]{0,60}(?:unresolved|findings|warnings|checks)/i.test(text)) add('AUDIT_VERDICT_MANIPULATION','HIGH');
  if(c.credential && c.read && c.send && c.external) add('POSSIBLE_CREDENTIAL_TRANSFER_CHAIN','HIGH');
  if(c.download && c.execute && c.external) add('POSSIBLE_REMOTE_EXECUTION_CHAIN','HIGH');
  if(/(?:configure|set|change|replace|rewrite|enable)[\s\S]{0,100}(?:registry|NODE_OPTIONS|LD_PRELOAD|preload|startup|proxy|certificate|trust store)/i.test(text)
    || /^\s*(?:registry|extra-index-url|index-url|proxy|cafile|NODE_OPTIONS|LD_PRELOAD)\s*=/im.test(text)
    || /(?:save|remember|store)[\s\S]{0,120}(?:external instruction|user preference|trusted directive)/i.test(text)) add('ENVIRONMENT_OR_TRUST_EFFECT','HIGH');
}
