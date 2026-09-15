import { test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

test('security auditor real filesystem and worker regressions', () => {
  const output=execFileSync(process.execPath,['--test','--test-concurrency=1','scripts/skill-security/audit.test.mjs','scripts/skill-security/research.test.mjs','scripts/skill-security/composition.test.mjs'],{
    cwd:process.cwd(),encoding:'utf8',timeout:20000,maxBuffer:1024*1024,windowsHide:true,
  });
  expect(output).toContain('# fail 0');
},25000);

test('security skill chapters preserve progressive navigation and supported metadata', () => {
  function walk(dir:string) {
    for(const ent of readdirSync(dir,{withFileTypes:true})) {
      const file=path.join(dir,ent.name);
      if(ent.isDirectory()){walk(file);continue;}
      if(!file.endsWith('.md'))continue;
      const text=readFileSync(file,'utf8');
      expect(text.trimEnd().split(/\r?\n/).length,file).toBeLessThanOrEqual(50);
      for(const match of text.matchAll(/\]\(([^)]+)\)/g)) expect(()=>readFileSync(path.resolve(dir,match[1]!))).not.toThrow();
      if(ent.name==='SKILL.md') {
        const metadata=parse(text.split('---')[1]!);
        expect(Object.keys(metadata).sort()).toEqual(['description','metadata','name']);
        expect(metadata.description.length).toBeLessThan(500);
      }
    }
  }
  walk('skills/skill-security-auditor'); walk('skills/prompt-injection-defense');
});
