import { expect, test } from 'vitest';
import { knowledgeOrganization, organizationNoteTemplate, getOrganizationPropertyContract } from './organization.js';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { projectSkill, previewSkills, applySkills, readSkillSource } from './skill-library.js';

const source = () => ({ id: 'example-tool', origin: 'example/plugin', version: '1.0', license: 'MIT', licenseText: 'MIT License\nCopyright Example\nPermission is hereby granted, free of charge, to any person obtaining a copy', description: 'Retrieve a bounded procedure', files: [{ path: 'SKILL.md', text: '# Procedure\n\nRun no code during import.\n' }], unavailable: ['scripts/run.sh'] });

test('skill is a first-class note kind and procedural template, not an execution grant', () => {
  expect(knowledgeOrganization({ status: 'draft', noteKind: 'skill' })).toMatchObject({ note_kind: 'skill' });
  expect(organizationNoteTemplate('skill')).toMatchObject({ noteKind: 'skill', properties: { memory_role: 'procedural' } });
  expect(getOrganizationPropertyContract().find(p => p.name === 'skill_origin_sha256')).toBeTruthy();
});

test('projection preserves source as data, local Community scope and license', () => {
  const notes = projectSkill(source());
  expect(notes[0].path).toBe('Community/Skills/example-tool/SKILL.md');
  expect(notes[0].frontmatter.title).toBe('example-tool');
  expect(notes[0].frontmatter).toMatchObject({ note_kind: 'skill', memory_role: 'procedural', skill_license: 'MIT' });
  expect(notes[0].content).toContain('# Procedure');
  expect(notes[0].content).toContain('not execution permission');
  expect(notes[0].content).toContain('scripts/run.sh');
  expect(notes[0].content).toContain('IMPORT-LICENSE.md');
  expect(notes.at(-1)?.content).toContain('Copyright Example');
  expect(projectSkill(source())).toEqual(notes);
});
test('primary skill links every imported reference without relying on original host paths', () => {
  const notes=projectSkill({ ...source(), files:[...source().files,{path:'references/detail.md',text:'# Detail'}] });
  expect(notes[0].content).toContain('[[Community/Skills/example-tool/references/detail.md]]');
  expect(notes[0].content).toContain('Original paths may require adaptation');
});

test.each(['../escape', 'x/y', 'C:\\Users\\user'])('rejects unsafe identity %s', id => {
  expect(() => projectSkill({ ...source(), id })).toThrow();
});
test.each(['../secret.md', '/absolute.md', 'x\\y.md', 'x.js', '.hidden.md', 'folder/../x.md'])('rejects source traversal and executable path %s', path => {
  expect(() => projectSkill({ ...source(), files: [{ path, text: 'text' }] })).toThrow();
});
test.each(['C:\\Users\\alice\\private.txt', '-----BEGIN PRIVATE KEY-----', 'ghp_abcdefghijklmnopqrstuvwxyz1234567890', 'https://user:password@example.com'])('quarantines sensitive source without echoing it', text => {
  try { projectSkill({ ...source(), files: [{ path: 'SKILL.md', text }] }); throw Error('accepted'); }
  catch (error) { expect(String(error)).toContain('sensitive'); expect(String(error)).not.toContain(text); }
});
test('does not infer sharing license, evaluate templates, or allow unbounded input', () => {
  expect(() => projectSkill({ ...source(), license: 'unknown' })).toThrow(/license/);
  expect(() => projectSkill({ ...source(), licenseText: 'not established' })).toThrow(/license/);
  const text = '# Reference\n${process.exit()}\n<script>throw 123</script>';
  expect(projectSkill({ ...source(), files: [{ path: 'SKILL.md', text }] })[0].content).toContain(text);
  expect(() => projectSkill({ ...source(), files: [{ path: 'SKILL.md', text: 'x'.repeat(131073) }] })).toThrow(/limit/);
});
test('preview/apply verifies revisions, replays as no-op and preserves edited notes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcpvault-skill-'));
  const fs = new FileSystemService(root);
  try {
    const notes = projectSkill(source());
    const preview = await previewSkills(fs, notes);
    expect(preview.rows[0].action).toBe('create');
    await expect(applySkills(fs, notes, 'bad')).rejects.toThrow(/fingerprint/);
    expect((await applySkills(fs, notes, preview.fingerprint)).written).toBe(notes.length);
    const unchanged = await previewSkills(fs, notes);
    expect(unchanged.rows[0].action).toBe('unchanged');
    expect((await applySkills(fs, notes, unchanged.fingerprint)).written).toBe(0);
    const current = await fs.readNote(notes[0].path);
    const changedSource = projectSkill({ ...source(), version: '2', files: [{ path: 'SKILL.md', text: '# Changed source' }] });
    const pending = await previewSkills(fs, changedSource);
    expect(pending.rows[0].action).toBe('update');
    await fs.writeNote({ path: notes[0].path, content: current.content + '\nUser edit', frontmatter: current.frontmatter, expectedRevision: current.revision });
    await expect(applySkills(fs, changedSource, pending.fingerprint)).rejects.toThrow(/fingerprint/);
    expect((await previewSkills(fs, changedSource)).rows[0].action).toBe('conflict');
    await expect(previewSkills(fs, [...notes, ...notes])).rejects.toThrow(/duplicate/);
    await expect(previewSkills(fs, [{ ...notes[0], path: 'Knowledge/leak.md' }])).rejects.toThrow(/Community/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('host source reader preserves Markdown references, records scripts without executing, and requires terms', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcpvault-skill-read-'));
  try {
    await mkdir(join(root, 'references'));
    await mkdir(join(root, 'scripts'));
    await writeFile(join(root, 'SKILL.md'), '---\nname: Sample\ndescription: Use for a task\n---\n# Method\nSee [detail](references/detail.md)');
    await writeFile(join(root, 'references/detail.md'), '# Conditions\nDo not execute anything on import.');
    await writeFile(join(root, 'scripts/do.sh'), 'exit 73');
    await writeFile(join(root, 'LICENSE.txt'), source().licenseText);
    const entry = { id: 'example-tool', origin: 'example/plugin', version: '1', root, licensePath: join(root, 'LICENSE.txt') };
    const result = await readSkillSource(entry);
    expect(result.license).toBe('MIT');
    expect(result.files.map(f => f.path)).toEqual(['SKILL.md', 'references/detail.md']);
    expect(result.unavailable).toContain('scripts/do.sh');
    expect(result.description).toBe('Use for a task');
    await expect(readSkillSource({ ...entry, licensePath: undefined })).rejects.toThrow(/license/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('many references never crowd the primary SKILL.md out of the import budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcpvault-skill-limit-'));
  try {
    await mkdir(join(root, 'references'));
    await writeFile(join(root, 'SKILL.md'), '# Primary');
    await writeFile(join(root, 'LICENSE'), source().licenseText);
    for (let i=0;i<35;i++) await writeFile(join(root, `references/r${i}.md`), '# Reference');
    const result = await readSkillSource({ id:'test',origin:'test',version:'1',root,licensePath:join(root,'LICENSE') });
    expect(result.files[0].path).toBe('SKILL.md');
    expect(result.files).toHaveLength(32);
    expect(result.unavailable).toHaveLength(4);
  } finally { await rm(root,{recursive:true,force:true}); }
});
test('host source admission refuses junction roots and junction ancestors', async () => {
  const root=await mkdtemp(join(tmpdir(),'mcpvault-skill-link-'));
  try {
    const actual=join(root,'actual'),child=join(actual,'child');
    await mkdir(child,{recursive:true});
    for(const dir of [actual,child]) { await writeFile(join(dir,'SKILL.md'),'# Reference');await writeFile(join(dir,'LICENSE'),source().licenseText); }
    const link=join(root,'linked');await symlink(actual,link,'junction');
    for(const dir of [link,join(link,'child')]) await expect(readSkillSource({id:'test',origin:'test',version:'1',root:dir,licensePath:join(dir,'LICENSE')})).rejects.toThrow(/symbolic|junction/i);
  } finally { await rm(root,{recursive:true,force:true}); }
});
test('source update never deletes user YAML comments or formatting', async () => {
  const root=await mkdtemp(join(tmpdir(),'mcpvault-skill-comment-'));const fs=new FileSystemService(root);
  try {
    const notes=projectSkill(source());await applySkills(fs,notes,(await previewSkills(fs,notes)).fingerprint);
    const current=await fs.readNote(notes[0].path);
    await fs.writeNote({path:notes[0].path,content:current.originalContent.replace('---\n','---\n# Keep my local annotation\n'),expectedRevision:current.revision});
    const update=projectSkill({...source(),version:'2'});
    const preview=await previewSkills(fs,update);
    expect(preview.rows[0].action).toBe('conflict');
    await expect(applySkills(fs,update,preview.fingerprint)).rejects.toThrow(/conflict/);
    expect((await fs.readNote(notes[0].path)).originalContent).toContain('# Keep my local annotation');
  } finally { await rm(root,{recursive:true,force:true}); }
});
