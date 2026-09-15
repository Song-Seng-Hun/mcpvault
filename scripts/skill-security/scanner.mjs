import fs from 'node:fs';
import path from 'node:path';
import { VERSION, hash } from './contract.mjs';
import { detect } from './detect.mjs';
import { analyzeBundle } from './bundle.mjs';

const MAGIC = ['4d5a','7f454c46','feedface','feedfacf','cefaedfe','cffaedfe','cafebabe','0061736d'];
const ARCHIVE = ['504b0304','504b0506','504b0708','1f8b','377abcaf','425a68','fd377a58','52617221'];
export function scan(root, budget, rules, rulesHash) {
  const findings = [], entries = [], documents = [], seen = new Set(); let complete = true, total = 0, count = 0, textBytes=0, referenceCoverage=true;
  const deadline = Date.now() + budget.timeoutMs;
  const add = (rule, severity = 'HIGH', incomplete = false, fileId = null, relatedFileIds) => {
    if (incomplete) complete = false;
    const key = `${rule}:${fileId}:${relatedFileIds?.join(':')??''}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (findings.length >= budget.maxFindings) { complete = false; return; }
    findings.push({ rule, severity, fileId, ...(relatedFileIds && {relatedFileIds}) });
  };
  function walk(dir, depth, verify = false, snapshot = []) {
    if (Date.now() > deadline || depth > budget.maxDepth) { add('SCAN_BUDGET', 'HIGH', true); return; }
    let handle;
    try {
      handle = fs.opendirSync(dir);
      for (let ent; (ent = handle.readSync());) {
        if (Date.now() > deadline || ++count > budget.maxFiles * 2) { add('SCAN_BUDGET', 'HIGH', true); break; }
        const full = path.join(dir, ent.name), relative = path.relative(root, full), id = hash(relative);
        const mark = (rule, severity, incomplete) => add(rule, severity, incomplete, id);
        const stat = fs.lstatSync(full);
        if (stat.isSymbolicLink() || stat.nlink > 1 && stat.isFile()) { mark('LINK_REQUIRES_REVIEW', 'HIGH', true); continue; }
        const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
        if (!samePath(fs.realpathSync(full), path.resolve(full))) { mark('PATH_CHANGED_OR_LINKED', 'HIGH', true); continue; }
        if (stat.isDirectory()) { walk(full, depth + 1, verify, snapshot); continue; }
        if (!stat.isFile()) { mark('SPECIAL_FILE', 'HIGH', true); continue; }
        if (snapshot.length >= budget.maxFiles || stat.size > budget.maxFileBytes || total + stat.size > budget.maxTotalBytes) {
          mark('FILE_BUDGET', 'HIGH', true); continue;
        }
        let fd;
        try {
          fd = fs.openSync(full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
          const before = fs.fstatSync(fd);
          if (!before.isFile() || before.dev !== stat.dev || before.ino !== stat.ino || before.size !== stat.size) { mark('FILE_CHANGED', 'HIGH', true); continue; }
          // Fixed-size bounded read prevents file growth from defeating the byte limit.
          const bytes = Buffer.alloc(before.size + 1);
          let read = 0, n;
          while (read < bytes.length && (n = fs.readSync(fd, bytes, read, bytes.length - read, read))) read += n;
          const after = fs.fstatSync(fd);
          if (read !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) { mark('FILE_CHANGED', 'HIGH', true); continue; }
          if (!samePath(fs.realpathSync(full), path.resolve(full))) { mark('PATH_CHANGED_OR_LINKED', 'HIGH', true); continue; }
          const raw = bytes.subarray(0, read); total += raw.length;
          snapshot.push({ fileId: id, sha256: hash(raw), bytes: raw.length });
          if (verify) continue;
          if (MAGIC.some(sig => raw.subarray(0, 4).toString('hex').startsWith(sig))) { mark('EXECUTABLE_BINARY', 'CRITICAL', true); continue; }
          if (ARCHIVE.some(sig => raw.subarray(0, 4).toString('hex').startsWith(sig)) || /\.(zip|tar|gz|tgz|whl|jar|7z|rar|bz2|xz)$/i.test(relative)) { mark('ARCHIVE_UNINSPECTED', 'HIGH', true); continue; }
          let text;
          try {
            const utf16le = raw[0] === 255 && raw[1] === 254, utf16be = raw[0] === 254 && raw[1] === 255;
            text = new TextDecoder(utf16le ? 'utf-16le' : utf16be ? 'utf-16be' : 'utf-8', { fatal: true }).decode(raw);
            if (text.includes('\0')) throw Error('BINARY');
          } catch { mark('UNSUPPORTED_ENCODING_OR_BINARY', 'HIGH', true); continue; }
          detect(relative + '\n' + text, rules, mark);
          if(relative==='SKILL.md' && !text.trim())mark('ENTRYPOINT_EMPTY','HIGH',true);
          textBytes+=Buffer.byteLength(text);
          if(textBytes<=2097152)documents.push({relative,id,text});
          else {referenceCoverage=false;mark('BUNDLE_TEXT_BUDGET','HIGH',true);}
        } finally { if (fd !== undefined) fs.closeSync(fd); }
      }
    } catch { add('READ_ERROR', 'HIGH', true); }
    finally { if (handle) handle.closeSync(); }
    return snapshot;
  }
  try {
    // Reject links anywhere in the supplied root chain, not only inside the tree.
    for (let p = root; ; p = path.dirname(p)) {
      if (fs.lstatSync(p).isSymbolicLink()) throw Error('LINK');
      if (p === path.dirname(p)) break;
    }
    if (!fs.lstatSync(root).isDirectory()) throw Error('NOT_DIRECTORY');
    walk(root, 0, false, entries);
    if (!entries.some(e => e.fileId === hash('SKILL.md'))) add('ENTRYPOINT_MISSING', 'HIGH', true);
    if (complete) {
      count = 0; total = 0;
      const current = walk(root, 0, true, []) || [];
      const ordered = values => JSON.stringify(values.sort((a, b) => a.fileId.localeCompare(b.fileId)));
      if (ordered(entries) !== ordered(current)) add('INVENTORY_CHANGED', 'HIGH', true);
    }
  } catch { add('ROOT_UNAVAILABLE_OR_LINKED', 'HIGH', true); }
  const bundle=analyzeBundle(documents,rules,add);
  const summary = { critical: 0, high: 0, medium: 0, total: findings.length };
  for (const f of findings) summary[f.severity.toLowerCase()]++;
  const status = !complete ? 'INCOMPLETE' : summary.critical ? 'FAIL' : findings.length ? 'WARN' : 'NO_FINDINGS';
  return { schemaVersion: 1, ruleEngineVersion: VERSION, status, executionAuthorized: false,
    coverage: { complete, scope: 'bounded-static-inspection', semanticSafetyProven: false,
      referencesComplete:referenceCoverage&&bundle.referencesComplete },
    analysis:{dataFlowProven:false,referenceEdges:bundle.edges,referenceScope:'literal-links-imports-and-2048-character-boundaries',runtimeEnforced:false},
    rootId: hash(root), rulesHash, filesCount: entries.length,
    inventoryHash: hash(JSON.stringify(entries.sort((a,b) => a.fileId.localeCompare(b.fileId)))),
    inventory: entries, riskScore: summary.critical * 100 + summary.high * 25 + summary.medium * 10, summary, findings };
}
