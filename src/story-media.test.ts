import { beforeEach, describe, expect, test } from 'vitest';
import type { StoryMediaInput, StoryStoryboardInput } from './story-media.js';

const media = await import('./story-media.js').catch(() => ({})) as typeof import('./story-media.js');
beforeEach(() => {
  for (const name of ['exportStoryManuscript', 'exportStoryFountain', 'exportStoryStoryboard', 'buildStoryCanvas'] as const)
    expect(media[name], `${name} exists`).toBeTypeOf('function');
});

const scene = (id = 's1') => ({ id, title: `장면 ${id}`, path: `User/비공개/${id}.md`, revision: 'r1', content: '비가 내린다.' });
const manuscript = (): StoryMediaInput => ({ title: '한강의 밤', scenes: [scene('s2'), scene()] });
const storyboard = (): StoryStoryboardInput => ({
  ...manuscript(),
  shots: [
    { id: 'b', path: 'Shots/b.md', revision: 'shot-r2', sourceSceneId: 's1', sourceSceneRevision: 'r0', order: 2, camera: '클로즈업', action: '비밀 행동', dialogue: '안녕', sound: '빗소리', durationSeconds: 2, images: [{ path: 'Images/없는 그림.png', missing: true }] },
    { id: 'a', path: 'Shots/a.md', revision: 'shot-r1', sourceSceneId: 's2', sourceSceneRevision: 'r1', order: 1, camera: '와이드', action: '다리', dialogue: '', sound: '', durationSeconds: 3, images: [{ path: 'Images/한강.png', revision: 'img-r1' }] },
  ],
  shotIds: ['b', 'a'],
});

describe('pure story media exports', () => {
  test('exports Korean manuscript in caller scene order with exact source revisions', () => {
    const input = manuscript();
    const result = media.exportStoryManuscript(input);
    expect(result.text).toContain('# 한강의 밤');
    expect(result.text.indexOf('장면 s2')).toBeLessThan(result.text.indexOf('장면 s1'));
    expect(result.text).toContain('비가 내린다.');
    expect(result.sources).toEqual(input.scenes.map(({ id, path, revision }) => ({ id, path, revision })));
    expect(input).toEqual(manuscript());
  });

  test('uses forced typed Fountain elements and keeps character next to dialogue', () => {
    const input = manuscript();
    input.scenes = [{ ...scene(), blocks: [
      { type: 'heading', text: '서울 강변 - 밤' },
      { type: 'action', text: '민수가 뛰어온다.' },
      { type: 'character', text: '민수' },
      { type: 'dialogue', text: '돌아왔어.\n정말이야.' },
      { type: 'transition', text: '암전' },
    ] }];
    expect(media.exportStoryFountain(input).text).toContain('.서울 강변 - 밤\n\n!민수가 뛰어온다.\n\n@민수\n돌아왔어.\n정말이야.\n\n>암전');
  });

  test.each(['   서울 - 밤', '\t １층 서울 - 밤', '  [[Places/서울| 서울 - 밤]]'])('normalizes leading heading whitespace in both typed and fallback scenes: %s', heading => {
    const expected = heading.includes('１') ? '.１층 서울 - 밤' : '.서울 - 밤';
    const typed: StoryMediaInput = { ...manuscript(), scenes: [{ ...scene(), blocks: [{ type: 'heading', text: heading }] }] };
    const fallback: StoryMediaInput = { ...manuscript(), scenes: [{ ...scene(), title: heading }] };
    expect.soft(media.exportStoryFountain(typed).text.split('\n')[0]).toBe(expected);
    expect.soft(media.exportStoryFountain(fallback).text.split('\n')[0]).toBe(expected);
  });

  test.each(['(회상) 서울 - 밤', '   (회상) 서울 - 밤', '...서울 - 밤', '[[서울|(회상) 서울 - 밤]]'])('rejects unsupported heading prefixes without removing literal content: %s', heading => {
    const typed: StoryMediaInput = { ...manuscript(), scenes: [{ ...scene(), blocks: [{ type: 'heading', text: heading }] }] };
    const fallback: StoryMediaInput = { ...manuscript(), scenes: [{ ...scene(), title: heading }] };
    expect.soft(() => media.exportStoryFountain(typed)).toThrow(/heading.*letter|heading.*number/i);
    expect.soft(() => media.exportStoryFountain(fallback)).toThrow(/heading.*letter|heading.*number/i);
  });

  test('normalizes every whitespace-only dialogue line to exactly two spaces while retaining speech', () => {
    const input: StoryMediaInput = { ...manuscript(), scenes: [{ ...scene(), blocks: [
      { type: 'character', text: '민수' },
      { type: 'dialogue', text: '돌아왔어.\n \n정말이야.\n\t\n    \n\u00a0\n끝.' },
    ] }] };
    expect(media.exportStoryFountain(input).text).toBe('@민수\n돌아왔어.\n  \n정말이야.\n  \n  \n  \n끝.\n');
  });

  test.each([
    { type: 'character' as const, text: '[[민수|]]' },
    { type: 'character' as const, text: '[[민수| \t]]' },
    { type: 'transition' as const, text: '[[암전|]]' },
    { type: 'transition' as const, text: '[[암전| \u00a0]]' },
  ])('rejects a $type whose resolved text is empty: $text', block => {
    const blocks = block.type === 'character'
      ? [block, { type: 'dialogue' as const, text: '안녕.' }]
      : [block];
    const input: StoryMediaInput = { ...manuscript(), scenes: [{ ...scene(), blocks }] };
    expect(() => media.exportStoryFountain(input)).toThrow(/visible|resolved/i);
  });

  test('retains nonempty resolved character and transition text', () => {
    const input: StoryMediaInput = { ...manuscript(), scenes: [{ ...scene(), blocks: [
      { type: 'character', text: '[[Characters/민수|민수]]' },
      { type: 'dialogue', text: '안녕.' },
      { type: 'transition', text: '[[Transitions/암전|암전]]' },
    ] }] };
    expect(media.exportStoryFountain(input).text).toBe('@민수\n안녕.\n\n>암전\n');
  });

  test('neutralizes notes, boneyards, dual dialogue and formatting metacharacters', () => {
    const input = manuscript();
    input.scenes = [{ ...scene(), blocks: [
      { type: 'action', text: '[[Characters/민수|민수]]와 [[메모]] /*삭제 금지*/ **별** _밑줄_' },
      { type: 'character', text: '민수 ^' },
      { type: 'dialogue', text: '(속삭임)\n\n>장면 아님\n~노래 아님\n[[메모]]' },
    ] }];
    const result = media.exportStoryFountain(input).text;
    expect(result).toContain('민수와 메모');
    expect(result).not.toMatch(/\[\[|\]\]|\/\*|\*\//);
    expect(result).not.toMatch(/^@.*\^\s*$/m);
    expect(result).toContain('\\*\\*별\\*\\*');
    expect(result).toContain('\\_밑줄\\_');
    expect(result).toContain('\\(속삭임\\)');
    expect(result).not.toMatch(/^>장면|^~노래/m);
  });

  test.each(['````', '~~~~'])('only matching %s fences end literal regions', fence => {
    const other = fence[0] === '`' ? '~~~' : '```';
    const input = manuscript();
    input.scenes = [{ ...scene(), content: `${fence}text\n[[secret|ALIAS]]\n${other}\n${fence.slice(1)}\n[[still|HIDDEN]]\n${fence} trailing\n[[also|HIDDEN2]]\n${fence}\n[[outside|VISIBLE]]` }];
    const result = media.exportStoryFountain(input).text;
    expect(result).toContain('secret|ALIAS');
    expect(result).toContain('still|HIDDEN');
    expect(result).toContain('also|HIDDEN2');
    expect(result).toContain('!VISIBLE');
    expect(result).not.toContain('outside|VISIBLE');
    expect(result).not.toContain('[[secret');
  });

  test.each([
    { fence: '```', suffix: '\u00a0' },
    { fence: '```', suffix: '\ufeff' },
    { fence: '~~~', suffix: '\u00a0' },
    { fence: '~~~', suffix: '\ufeff' },
  ])('keeps $fence open when its apparent closer ends in Unicode whitespace $suffix', ({ fence, suffix }) => {
    const input: StoryMediaInput = { ...manuscript(), scenes: [{ ...scene(),
      content: `${fence}text\n${fence}${suffix}\n[[inside|LITERAL]]\n${fence} \t\n[[outside|VISIBLE]]`,
    }] };
    const result = media.exportStoryFountain(input).text;
    expect(result).toContain('inside|LITERAL');
    expect(result).not.toContain('!LITERAL');
    expect(result).toContain('!VISIBLE');
    expect(result).not.toContain('outside|VISIBLE');
  });

  test('escaped wikilinks and inline code remain literal rather than resolved', () => {
    const input = manuscript();
    input.scenes = [{ ...scene(), content: '\\[[path|escaped]] `[[path|inline]]` [[path|resolved]]' }];
    const text = media.exportStoryFountain(input).text;
    expect(text).toContain('path|escaped');
    expect(text).toContain('path|inline');
    expect(text).not.toContain('path|resolved');
  });

  test('flags stale shots and missing images without loading images', () => {
    const result = media.exportStoryStoryboard(storyboard());
    expect(result.text.indexOf('Shots/b.md')).toBeLessThan(result.text.indexOf('Shots/a.md'));
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'stale_shot', id: 'b' }),
      expect.objectContaining({ code: 'missing_image', id: 'b' }),
    ]));
    expect(result.text).toContain('missing_image');
    expect(result.text).toContain('stale_shot');
  });

  test('Canvas links files only, honors explicit order, and returns freshness manifest', () => {
    const input = storyboard();
    const result = media.buildStoryCanvas(input);
    expect(media.buildStoryCanvas(input)).toEqual(result);
    expect(result.canvas.nodes.every(node => node.type === 'file')).toBe(true);
    expect(JSON.stringify(result.canvas)).not.toContain('비밀 행동');
    expect(JSON.stringify(result.canvas)).not.toContain('없는 그림');
    expect(result.canvas.nodes.filter(node => node.id.startsWith('shot-')).map(node => node.file)).toEqual(['Shots/b.md', 'Shots/a.md']);
    expect(result.manifest.shotIds).toEqual(['b', 'a']);
    expect(result.manifest.sources).toEqual(expect.arrayContaining([
      { id: 'b', path: 'Shots/b.md', revision: 'shot-r2' },
      { id: 's1', path: 'User/비공개/s1.md', revision: 'r1' },
    ]));
    expect(result.manifest.shotSources).toContainEqual({ shotId: 'b', sourceSceneId: 's1', sourceSceneRevision: 'r0', currentSceneRevision: 'r1' });
    expect(input).toEqual(storyboard());
  });

  test('reports missing source scene, and never guesses one from order', () => {
    const input = storyboard();
    input.shots[0]!.sourceSceneId = 'missing';
    expect(media.buildStoryCanvas(input).diagnostics).toContainEqual(expect.objectContaining({ code: 'missing_scene', id: 'b' }));
  });

  test('rejects unknown, duplicate, or incomplete explicit shot lists', () => {
    for (const shotIds of [['a', 'bad'], ['a', 'a'], ['a']]) {
      expect(() => media.buildStoryCanvas({ ...storyboard(), shotIds })).toThrow(/shotIds/);
    }
  });

  test('bounds content, output, counts and numeric fields; rejects duplicate identities', () => {
    expect(() => media.exportStoryManuscript({ ...manuscript(), scenes: [scene(), scene()] })).toThrow(/duplicate/i);
    expect(() => media.exportStoryManuscript({ ...manuscript(), scenes: [{ ...scene(), content: 'x'.repeat(100_001) }] })).toThrow(/bound/i);
    expect(() => media.exportStoryManuscript({ ...manuscript(), scenes: Array.from({ length: 257 }, (_, i) => scene(`${i}`)) })).toThrow(/bound/i);
    expect(() => media.exportStoryManuscript({ ...manuscript(), maxOutputChars: 10 })).toThrow(/output/i);
    const input = storyboard();
    input.shots[0]!.durationSeconds = Number.NaN;
    expect(() => media.exportStoryStoryboard(input)).toThrow(/duration/i);
  });

  test('rejects malformed typed dialogue sequences and structural newline injection', () => {
    for (const blocks of [
      [{ type: 'dialogue' as const, text: '화자 없음' }],
      [{ type: 'character' as const, text: '민수\n@다른 사람' }, { type: 'dialogue' as const, text: '대사' }],
      [{ type: 'character' as const, text: '민수' }],
    ]) expect(() => media.exportStoryFountain({ ...manuscript(), scenes: [{ ...scene(), blocks }] })).toThrow(/block|character|dialogue/i);
  });

  test('rejects null limits instead of silently replacing invalid JSON values', () => {
    expect(() => media.exportStoryManuscript({ ...manuscript(), maxOutputChars: null as never })).toThrow(/output/i);
  });

  test('keeps multi-line inline-code wikilinks literal', () => {
    const input = manuscript();
    input.scenes = [{ ...scene(), content: '`first\n[[path|inside]]\nlast`\n[[path|outside]]' }];
    const text = media.exportStoryFountain(input).text;
    expect(text).toContain('path|inside');
    expect(text).not.toContain('path|outside');
  });

  test('keeps fences open across literal CRLF content until a longer matching close', () => {
    const input = manuscript();
    input.scenes = [{ ...scene(), content: '~~~txt\r\n[[path|inside]]\r\n~~~~\r\n[[path|outside]]' }];
    const text = media.exportStoryFountain(input).text;
    expect(text).toContain('path|inside');
    expect(text).not.toContain('path|outside');
  });

  test('caps aggregate input and Canvas output without truncating JSON', () => {
    const input = { ...manuscript(), scenes: Array.from({ length: 11 }, (_, i) => ({ ...scene(`${i}`), content: '한'.repeat(99_000) })) };
    expect(() => media.exportStoryManuscript(input)).toThrow(/bound/i);
    expect(() => media.buildStoryCanvas({ ...storyboard(), maxOutputChars: 100 })).toThrow(/output/i);
  });
});
