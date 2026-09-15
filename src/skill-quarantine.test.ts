import { expect, test } from 'vitest';
import { PathFilter } from './pathfilter.js';
import { parseCliArgs } from './cli.js';

test('quarantine is explicit host input, with malformed or duplicate flags rejected', () => {
  expect(parseCliArgs(['Vault', '--quarantine-skills'])).toEqual({vaultPathArg:'Vault',readOnly:false,quarantineSkills:true});
  expect(parseCliArgs(['Vault'])).not.toHaveProperty('quarantineSkills');
  for(const args of [['--quarantine-skills=false'],['--quarantine-skills=true'],['--quarantine-skills','--quarantine-skills']])
    expect(()=>parseCliArgs(args)).toThrow(/quarantine-skills/);
});

test('quarantine denies the entire skill subtree, not just SKILL.md', () => {
  const filter=new PathFilter({quarantineSkills:true});
  for(const p of ['Community/Skills','/Community/Skills/','community/skills/new/SKILL.md',
    'Community\\Skills\\new\\scripts\\a.py','Community//Skills/./new/reference.md',
    'Other/../Community/Skills/new/SKILL.md','Community/Skills/new/_evolution/versions/x.md']) {
    expect(filter.isAllowed(p),p).toBe(false);
    expect(filter.isAllowedForListing(p),p).toBe(false);
  }
  for(const p of ['Welcome.md','Community/Posts/post.md','Community/Skills-guide.md','Knowledge/Skills/a.md'])
    expect(filter.isAllowed(p),p).toBe(true);
  expect(new PathFilter().isAllowed('Community/Skills/a/SKILL.md')).toBe(true);
});

test('quarantine composes with the original host filter without granting or mutating access',()=>{
  const parent=new PathFilter({ignoredPatterns:['Restricted/**'],allowedExtensions:['.pdf']});
  const filter=new PathFilter({quarantineSkills:true},parent);
  expect(filter.isAllowed('Restricted/note.md')).toBe(false);
  expect(filter.isAllowedForListing('Restricted/note.md')).toBe(false);
  expect(filter.isAllowed('Public/file.pdf')).toBe(true);
  expect(filter.isAllowedForListing('Public/file.pdf')).toBe(true);
  expect(filter.filterPaths(['Public/a.md','Community/Skills/a/SKILL.md'])).toEqual(['Public/a.md']);
  expect(parent.isAllowed('Community/Skills/a/SKILL.md')).toBe(true);
  expect(()=>new PathFilter({quarantineSkills:'false'} as any)).toThrow(/policy/);
});
