import { expect, test, vi } from 'vitest';
import { jsonStringBytes } from './json-string-bytes.js';

test.each(['', 'plain ASCII/path.md', '한글/문서', 'é € 中', '🧠🌍', '"\\/\b\f\n\r\t\u0000\u001f', '\ud800', '\udc00', '\ud800A\udc00', '\ud800\ud800\udc00'])('counts native JSON UTF-8 bytes: %j', value => {
  expect(jsonStringBytes(value)).toBe(Buffer.byteLength(JSON.stringify(value), 'utf8'));
});

test('every isolated UTF-16 code unit matches native serialization', () => {
  for (let code = 0; code <= 0xffff; code++) {
    const value = String.fromCharCode(code);
    expect(jsonStringBytes(value), code.toString(16)).toBe(Buffer.byteLength(JSON.stringify(value), 'utf8'));
  }
});

test('mixed strings handle adjacent and unmatched surrogates without extra allocation calls', () => {
  let seed = 12345;
  const cases = Array.from({ length: 512 }, () => {
    let value = '';
    for (let i = 0; i < 32; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; value += String.fromCharCode(seed & 0xffff); }
    return { value, bytes: Buffer.byteLength(JSON.stringify(value), 'utf8') };
  });
  const serialize = vi.spyOn(JSON, 'stringify');
  const byteLength = vi.spyOn(Buffer, 'byteLength');
  let actual: number[];
  try {
    actual = cases.map(item => jsonStringBytes(item.value));
    expect(serialize).not.toHaveBeenCalled(); expect(byteLength).not.toHaveBeenCalled();
  } finally { serialize.mockRestore(); byteLength.mockRestore(); }
  for (let index = 0; index < cases.length; index++) expect(actual[index], `case ${index}`).toBe(cases[index]!.bytes);
});
