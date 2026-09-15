// Recognized syntax only. No module evaluation, dependency loading, URL fetch or AST claim.
// emit receives a literal path and kind. Ambiguous/dynamic syntax stays uninspected.
export function references(text,relative,emit,gap) {
  if(/(?:^|[\\/])package\.json$/i.test(relative)) {
    try {
      const manifest=JSON.parse(text);
      if(!manifest || typeof manifest!=='object' || Array.isArray(manifest))gap('DEPENDENCY_MANIFEST_UNINSPECTED');
      else if(['dependencies','devDependencies','optionalDependencies','peerDependencies','bundledDependencies','bundleDependencies','workspaces','imports','exports']
        .some(key=>manifest[key]!=null && (typeof manifest[key]!=='object'||Object.keys(manifest[key]).length)))gap('DEPENDENCY_MANIFEST_UNINSPECTED');
    } catch {gap('DEPENDENCY_MANIFEST_UNINSPECTED');}
  }
  if(/(?:^|[\\/])(?:requirements[^\\/]*\.(?:txt|in)|Pipfile(?:\.lock)?|poetry\.lock|uv\.lock|setup\.(?:py|cfg))$/i.test(relative)
    && text.split(/\r?\n/).some(line=>line.trim()&&!line.trimStart().startsWith('#')))gap('DEPENDENCY_MANIFEST_UNINSPECTED');
  if(/(?:^|[\\/])pyproject\.toml$/i.test(relative) && /\b(?:dependencies|requires|build-backend)\b/i.test(text))gap('DEPENDENCY_MANIFEST_UNINSPECTED');
  // Command resolution depends on runtime cwd, PATH, flags and environment. Never
  // pretend the bundle directory resolves it, and never execute it to find out.
  if(/(?:^|[\n;])\s*(?:source\s+|\.\s+)[^\r\n]+/m.test(text)
    || /\b(?:python(?:3(?:\.\d+)?)?|node|bash|pwsh|powershell)(?:\.exe)?\s+(?:-[^\r\n ]+\s+)*["']?[^\s"'`]+\.(?:py|m?js|cjs|sh|ps1)\b/i.test(text))gap('EXECUTION_REFERENCE_UNINSPECTED');
  for(const m of text.matchAll(/<([a-z][a-z0-9+.-]*:[^<>\s]+)>/gi))emit(m[1],'literal');
  const labels=new Set(Array.from(text.matchAll(/^\s*\[([^\]]+)\]:/gm),m=>m[1].trim().replace(/\s+/g,' ').toLowerCase()));
  for(const m of text.matchAll(/\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
    if(!labels.has((m[2]||m[1]).trim().replace(/\s+/g,' ').toLowerCase()))gap('REFERENCE_UNRESOLVED');
  }
  for(const pattern of [/\]\(<?([^\s)>]+)>?(?:\s+[^)]*)?\)/g,/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gm])
    for(const m of text.matchAll(pattern))emit(m[1],'literal');
  for(const m of text.matchAll(/\[\[([^\]\r\n]+)\]\]/g))emit(m[1].split('|')[0],'wiki');
  for(const tag of text.matchAll(/<[a-z][^>]{0,8192}>/gi)) {
    for(const m of tag[0].matchAll(/\b(?:src|href|poster|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi))
      emit(m[1]??m[2]??m[3],'literal');
    if(/\b(?:srcset|style|on\w+)\s*=/i.test(tag[0]))gap('EMBEDDED_REFERENCE_UNINSPECTED');
  }
  // Do not accept './part' from import('./part' + suffix) as a resolved dependency.
  for(const m of text.matchAll(/\b(?:require|import)\s*\(\s*/g)) {
    const rest=text.slice(m.index+m[0].length,m.index+m[0].length+8192);
    const literal=/^(["'])([^"'\r\n]*)\1\s*\)/.exec(rest);
    if(literal)emit(literal[2],'module'); else gap('DYNAMIC_REFERENCE_UNINSPECTED');
  }
  for(const m of text.matchAll(/\b(?:from\s+|import\s+)["']([^"'\r\n]+)["']/g))emit(m[1],'module');
  // Inspect recognizable Python syntax regardless of extension. This is a
  // conservative lexical subset, not Python parsing or dependency closure.
  if(/\.(?:py|pyi)$/i.test(relative) || /(?:^|[\n;])\s*(?:from\s+[.\w]+\s+import\b|import\s+[.\w]+)/m.test(text)) {
    for(const m of text.matchAll(/(?:^|[\n;])\s*(?:from\s+([.\w]+)\s+import\s+([^\r\n;]+)|import\s+([^\r\n;]+))/gm)) {
      const module=m[1], items=(m[2]??m[3]).split('#')[0].split(',');
      if(module && !/^\.+$/.test(module))emit(module,'python');
      else for(const item of items) {
        const name=/^\s*([\w.]+)(?:\s+as\s+\w+)?\s*$/.exec(item);
        if(name)emit((module??'')+name[1],'python'); else gap('DYNAMIC_REFERENCE_UNINSPECTED');
      }
    }
    if(/\b(?:__import__|import_module|exec)\s*\(/.test(text))gap('DYNAMIC_REFERENCE_UNINSPECTED');
  }
}
