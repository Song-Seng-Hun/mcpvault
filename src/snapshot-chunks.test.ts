import { afterEach, expect, test, vi } from 'vitest';
import { snapshotByteChunks } from './snapshot-chunks.js';

afterEach(() => vi.restoreAllMocks());
test('coalesces 100,000 tiny records into two owned bounded buffers', () => {
  function* source() { for (let i = 0; i < 100000; i++) yield 'x'; }
  const chunks = [...snapshotByteChunks(source(), 100000)];
  expect(chunks.length).toBe(2);
  expect(chunks.map(chunk => chunk.length)).toEqual([65536, 34464]);
  expect(Buffer.concat(chunks).toString()).toBe('x'.repeat(100000));
  expect(chunks[0].buffer).not.toBe(chunks[1].buffer);
});

test('preserves Unicode, split bytes, empty chunks, and per-string surrogate encoding', () => {
  const encoded = Buffer.from('한글😀');
  const inputs = ['', new Uint8Array(), '한글😀'.repeat(20000), encoded.subarray(0, 4), encoded.subarray(4), '\ud800', '\udc00'];
  const expected = Buffer.concat(inputs.map(value => Buffer.from(value)));
  const chunks = [...snapshotByteChunks(inputs, expected.length)];
  expect(chunks.every(chunk => chunk.length > 0 && chunk.length <= 65536)).toBe(true);
  expect(Buffer.concat(chunks)).toEqual(expected);
});

test('does not allocate encoded bytes for an oversized string', () => {
  const from = vi.spyOn(Buffer, 'from');
  expect(() => [...snapshotByteChunks(['한글'.repeat(10000)], 100)]).toThrow('Snapshot size exceeded');
  expect(from).not.toHaveBeenCalled();
});

test('cumulative byte overflow closes input without consuming later records', () => {
  let consumed = 0, closed = false;
  function* source() {
    try { for (const value of ['한', '😀', 'never']) { consumed++; yield value; } }
    finally { closed = true; }
  }
  expect(() => [...snapshotByteChunks(source(), 6)]).toThrow('Snapshot size exceeded');
  expect(consumed).toBe(2);
  expect(closed).toBe(true);
});

test('early consumer return closes the underlying source', () => {
  let consumed = 0, closed = false;
  function* source() {
    try { for (let i = 0; i < 100000; i++) { consumed++; yield 'x'.repeat(4096); } }
    finally { closed = true; }
  }
  const iterator = snapshotByteChunks(source(), 500000000);
  expect(iterator.next().value?.length).toBe(65536);
  iterator.return();
  expect(consumed).toBe(16);
  expect(closed).toBe(true);
});

test('copies reused input byte arrays before pulling their next mutation', () => {
  const bytes = Buffer.alloc(32768);
  function* source() { for (let i = 1; i <= 4; i++) { bytes.fill(i); yield bytes; } }
  const result = Buffer.concat([...snapshotByteChunks(source(), 131072)]);
  for (let i = 1; i <= 4; i++) expect(result.subarray((i - 1) * 32768, i * 32768)).toEqual(Buffer.alloc(32768, i));
});

test('empty input emits no uninitialized bytes', () => {
  expect([...snapshotByteChunks(['', new Uint8Array()], 1)]).toEqual([]);
});
test.each([0, -1, NaN, Infinity, 1.5, 0x80000000])('rejects invalid ceiling %s before pulling source', limit => {
  let consumed = false;
  function* source() { consumed = true; yield 'x'; }
  expect(() => [...snapshotByteChunks(source(), limit)]).toThrow('Invalid snapshot byte limit');
  expect(consumed).toBe(false);
});
