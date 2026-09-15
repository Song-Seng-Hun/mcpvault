import path from 'node:path';
import { detect } from './detect.mjs';
import { capabilities } from './signals.mjs';
import { normalizeView } from './decode.mjs';

// Limited literal-reference parser, not a Markdown/code interpreter or dependency resolver.
// All targets resolve only against bytes already inspected in this bundle. No I/O here.
export function analyzeBundle(files,rules,add) {
  const map=new Map(files.map(f=>[f.relative.replaceAll('\\','/'),f])), edges=new Set();
  let referencesComplete=true, checked=0;
  const gap=(id,rule)=>{referencesComplete=false;add(rule,'HIGH',true,id);};
  for(const source of files) {
    const labels=new Set(Array.from(source.text.matchAll(/^\s*\[([^\]]+)\]:/gm),m=>m[1].trim().replace(/\s+/g,' ').toLowerCase()));
    for(const match of source.text.matchAll(/\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
      if(++checked>128){gap(source.id,'REFERENCE_BUDGET');return {referencesComplete,checked:128,edges:edges.size};}
      if(!labels.has((match[2]||match[1]).trim().replace(/\s+/g,' ').toLowerCase()))gap(source.id,'REFERENCE_UNRESOLVED');
    }
    if(/\b(?:require|import)\s*\(\s*(?!\s|["'])[\s\S]/.test(source.text))gap(source.id,'DYNAMIC_REFERENCE_UNINSPECTED');
    const patterns=[/\]\(<?([^\s)>]+)>?(?:\s+[^)]*)?\)/g,/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gm,
      /(?:\bfrom\s+|\bimport\s+|\brequire\s*\(\s*|\bimport\s*\(\s*)["']([^"']+)["']/g];
    for(const pattern of patterns) for(const match of source.text.matchAll(pattern)) {
      if(++checked>128){gap(source.id,'REFERENCE_BUDGET');return {referencesComplete,checked:128,edges:edges.size};}
      let target;
      try {target=decodeURIComponent(match[1]);} catch {gap(source.id,'REFERENCE_UNRESOLVED');continue;}
      if(target.startsWith('#') || target.startsWith('node:'))continue;
      if(/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')){gap(source.id,'EXTERNAL_REFERENCE_UNINSPECTED');continue;}
      target=target.split(/[?#]/)[0].replaceAll('\\','/');
      const relative=path.posix.normalize(path.posix.join(path.posix.dirname(source.relative.replaceAll('\\','/')),target));
      if(target.startsWith('/') || relative==='..' || relative.startsWith('../')){gap(source.id,'OUTSIDE_REFERENCE_UNINSPECTED');continue;}
      const destination=map.get(relative);
      if(!destination){gap(source.id,'REFERENCE_UNRESOLVED');continue;}
      const key=source.id+':'+destination.id;
      if(edges.has(key) || source.id===destination.id)continue; edges.add(key);
      const related=[source.id,destination.id].sort();
      const combined=normalizeView(source.text.trimEnd().slice(-2048)+'\n'+destination.text.trimStart().slice(0,2048));
      detect(combined,rules,(rule,severity,incomplete)=>{
        if(incomplete)gap(source.id,'LINKED_ANALYSIS_INCOMPLETE');
        if(rule==='INSTRUCTION_OVERRIDE')add('LINKED_INSTRUCTION_OVERRIDE',severity,false,source.id,related);
      });
      const a=capabilities(normalizeView(source.text)), b=capabilities(normalizeView(destination.text));
      const union=key=>a[key]||b[key];
      if(union('credential')&&union('read')&&union('send')&&union('external')) add('POSSIBLE_CREDENTIAL_TRANSFER_CHAIN','HIGH',false,source.id,related);
      if(union('download')&&union('execute')&&union('external')) add('POSSIBLE_REMOTE_EXECUTION_CHAIN','HIGH',false,source.id,related);
    }
  }
  return {referencesComplete,checked,edges:edges.size};
}
