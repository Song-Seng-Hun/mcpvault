import path from 'node:path';
import { detect } from './detect.mjs';
import { capabilities } from './signals.mjs';
import { inspectionViews, normalizeView } from './decode.mjs';
import { references } from './references.mjs';

// Resolve only inspected bundle members. All combinations remain heuristic evidence.
export function analyzeBundle(files,rules,add) {
  const map=new Map(files.map(f=>[f.relative.replaceAll('\\','/'),f])), adjacency=new Map(), summaries=new Map();
  let referencesComplete=true,compositionComplete=true,checked=0,edgeCount=0,states=0,decodedCapabilityFiles=0;
  const gap=(id,rule)=>{referencesComplete=false;add(rule,'HIGH',true,id);};
  for(const source of files) {
    const mark=(rule,severity,incomplete)=>{if(incomplete)referencesComplete=false;add(rule,severity,incomplete,source.id);};
    const views=inspectionViews(source.text,mark), base=capabilities(normalizeView(source.text));
    const caps={...base};
    for(const view of views) for(const [key,value] of Object.entries(capabilities(view)))caps[key] ||= value;
    if(Object.keys(caps).some(key=>caps[key]&&!base[key]))decodedCapabilityFiles++;
    summaries.set(source.id,caps);
    const seenReferences=new Set();
    // Rendering changes emphasis, possibly inside identifiers. Never resolve its paths.
    for(const view of inspectionViews(source.text,mark,{rot13:false,render:false})) {
      references(view,source.relative,(raw,kind)=>{
        const refKey=kind+':'+raw;
        if(seenReferences.has(refKey))return; seenReferences.add(refKey);
        if(++checked>128){gap(source.id,'REFERENCE_BUDGET');return;}
        let target;
        try {target=decodeURIComponent(raw);} catch {gap(source.id,'REFERENCE_UNRESOLVED');return;}
        if(target.startsWith('#') || target.startsWith('node:'))return;
        if(/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')){gap(source.id,'EXTERNAL_REFERENCE_UNINSPECTED');return;}
        if(kind==='module' && !/^\.{1,2}[\\/]/.test(target)){gap(source.id,'EXTERNAL_REFERENCE_UNINSPECTED');return;}
        let directory=path.posix.dirname(source.relative.replaceAll('\\','/'));
        if(kind==='python') {
          const leading=/^\.+/.exec(target)?.[0].length??0;
          if(!leading) directory='.';
          else {
            const parts=directory==='.'?[]:directory.split('/');
            if(leading-1>parts.length){gap(source.id,'OUTSIDE_REFERENCE_UNINSPECTED');return;}
            directory=parts.slice(0,parts.length-leading+1).join('/')||'.';
          }
          target=target.slice(leading).replaceAll('.','/');
        }
        target=target.split(/[?#]/)[0].replaceAll('\\','/');
        if(!target)return;
        const relative=path.posix.normalize(path.posix.join(directory,target));
        if(target.startsWith('/') || relative==='..' || relative.startsWith('../')){gap(source.id,'OUTSIDE_REFERENCE_UNINSPECTED');return;}
        const candidates=kind==='wiki'?[relative,relative+'.md']:kind==='python'?[relative+'.py',relative+'/__init__.py']:[relative];
        const found=candidates.filter(p=>map.has(p));
        if(found.length!==1){gap(source.id,'REFERENCE_UNRESOLVED');return;}
        const destination=map.get(found[0]);
        if(source.id===destination.id)return;
        const neighbors=adjacency.get(source.id)??new Map(); adjacency.set(source.id,neighbors);
        if(neighbors.has(destination.id))return; neighbors.set(destination.id,destination); edgeCount++;
        const related=[source.id,destination.id].sort();
        const combined=normalizeView(source.text.trimEnd().slice(-2048)+'\n'+destination.text.trimStart().slice(0,2048));
        detect(combined,rules,(rule,severity,incomplete)=>{
          if(incomplete)gap(source.id,'LINKED_ANALYSIS_INCOMPLETE');
          if(rule==='INSTRUCTION_OVERRIDE')add('LINKED_INSTRUCTION_OVERRIDE',severity,false,source.id,related);
        });
      },rule=>gap(source.id,rule));
      if(checked>128)break;
    }
    if(checked>128)break;
  }
  // At most 3 edges (4 files), 512 states, directed paths without repeated vertices.
  outer: for(const source of files) {
    const queue=[{ids:[source.id],caps:summaries.get(source.id)??{}}];
    for(let cursor=0;cursor<queue.length;cursor++) {
      if(++states>512){compositionComplete=false;add('COMPOSITION_BUDGET','HIGH',true,source.id);break outer;}
      const state=queue[cursor], neighbors=adjacency.get(state.ids.at(-1));
      for(const destination of neighbors?.values()??[]) {
        if(state.ids.includes(destination.id))continue;
        if(state.ids.length>=4){compositionComplete=false;add('COMPOSITION_DEPTH_UNINSPECTED','HIGH',true,source.id);continue;}
        const ids=[...state.ids,destination.id],caps={...state.caps};
        for(const [key,value] of Object.entries(summaries.get(destination.id)??{}))caps[key] ||= value;
        const related=[...ids].sort();
        if(caps.credential&&caps.read&&caps.send&&caps.external)add('POSSIBLE_CREDENTIAL_TRANSFER_CHAIN','HIGH',false,source.id,related);
        if(caps.download&&caps.execute&&caps.external)add('POSSIBLE_REMOTE_EXECUTION_CHAIN','HIGH',false,source.id,related);
        if(queue.length>=512){compositionComplete=false;add('COMPOSITION_BUDGET','HIGH',true,source.id);break outer;}
        queue.push({ids,caps});
      }
    }
  }
  return {referencesComplete,compositionComplete,checked:Math.min(128,checked),edges:edgeCount,states:Math.min(512,states),decodedCapabilityFiles};
}
