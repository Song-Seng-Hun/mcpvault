import { expect, test } from 'vitest';
import { PathFilter } from './pathfilter.js';

test('each policy compiles its globs once rather than allocating regexes for every path', () => {
  const NativeRegExp = globalThis.RegExp;
  let constructed = 0, initial = 0, afterChecks = 0;
  const results: boolean[] = [];
  try {
    globalThis.RegExp = new Proxy(NativeRegExp, {
      construct(target, args) { constructed++; return Reflect.construct(target, args); },
    });
    const filter = new PathFilter({ ignoredPatterns: ['Draft*/**', 'Private\\**'] });
    initial = constructed;
    for (let i = 0; i < 200; i++) {
      results.push(filter.isAllowedForListing(`Wiki/Note${i}.md`));
      results.push(filter.isAllowed(`Wiki/Note${i}.md`));
    }
    afterChecks = constructed;
  } finally { globalThis.RegExp = NativeRegExp; }
  expect({ initial, duringChecks: afterChecks - initial }).toEqual({ initial: 12, duringChecks: 0 });
  expect(results).toHaveLength(400);
  expect(results.every(Boolean)).toBe(true);
});

test('compiled policy remains instance-local and independent of later caller array changes', () => {
  const ignoredPatterns = ['archive/**'], allowedExtensions = ['.PDF'];
  const first = new PathFilter({ ignoredPatterns, allowedExtensions });
  ignoredPatterns[0] = 'public/**'; allowedExtensions[0] = '.EXE';
  const second = new PathFilter({ ignoredPatterns, allowedExtensions });
  for (let i = 0; i < 20; i++) {
    expect(first.isAllowed('archive/note.md')).toBe(false);
    expect(first.isAllowed('public/note.md')).toBe(true);
    expect(first.isAllowed('public/report.pdf')).toBe(true);
    expect(first.isAllowed('public/tool.exe')).toBe(false);
    expect(second.isAllowed('archive/note.md')).toBe(true);
    expect(second.isAllowed('public/note.md')).toBe(false);
    expect(second.isAllowed('archive/tool.EXE')).toBe(true);
    expect(second.isAllowed('archive/report.PDF')).toBe(false);
  }
});

test('compiled globs preserve literals, anchoring, canonical paths and repeated case-insensitive matching', () => {
  const filter = new PathFilter({ ignoredPatterns: ['backup.2024/**', '(archive)\\**', 'Draft?/private/*'] });
  const denied = ['backup.2024/note.md', './backup.2024//note.md', '(ARCHIVE)/note.md', 'Draft1/private/note.md', 'Area/.git/config.md', 'Area/.hidden/note.md'];
  const allowed = ['backup_2024/note.md', 'Area/backup.2024/note.md', 'archive/note.md', 'Draft12/private/note.md', 'Draft1/private/deeper/note.md'];
  for (let i = 0; i < 20; i++) {
    for (const path of denied) {
      expect(filter.isAllowed(path)).toBe(false);
      expect(filter.isAllowedForListing(path)).toBe(false);
    }
    for (const path of allowed) {
      expect(filter.isAllowed(path)).toBe(true);
      expect(filter.isAllowedForListing(path)).toBe(true);
    }
  }
});
