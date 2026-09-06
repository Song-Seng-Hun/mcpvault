import { expect, test } from 'vitest';
import { setImmediate as flush } from 'node:timers/promises';
import { forEachInventoryItem } from './inventory-work.js';

test('cooperative merging preserves order and lets an immediate run between batches', async () => {
  const input = Object.freeze(Array.from({ length: 600 }, (_, i) => i));
  const output: number[] = []; let observed = 0;
  await forEachInventoryItem(input, item => {
    output.push(item);
    if (item === 0) setImmediate(() => { observed = output.length; });
  }, () => undefined);
  expect(observed).toBe(256);
  expect(output).toEqual(input);
});

test('small and empty inventories do not introduce an unnecessary macrotask', async () => {
  let marker = false, checked = false;
  setImmediate(() => { marker = true; });
  await forEachInventoryItem([], () => { throw new Error('empty visited'); }, () => { checked = true; });
  const values: number[] = [];
  await forEachInventoryItem([1, 2], item => { values.push(item); }, () => undefined);
  expect(checked).toBe(true); expect(marker).toBe(false); expect(values).toEqual([1, 2]);
  await flush(); expect(marker).toBe(true);
});

test('closure during a yield aborts before visiting another item', async () => {
  let closed = false, visits = 0;
  await expect(forEachInventoryItem(Array(600).fill(0), () => {
    if (++visits === 1) setImmediate(() => { closed = true; });
  }, () => { if (closed) throw new Error('closed'); })).rejects.toThrow('closed');
  expect(visits).toBe(256);
});

test('callback errors and a failed final guard reject instead of certifying completion', async () => {
  const visited: number[] = [];
  await expect(forEachInventoryItem([1, 2, 3], item => {
    visited.push(item); if (item === 2) throw new Error('callback failed');
  }, () => undefined)).rejects.toThrow('callback failed');
  expect(visited).toEqual([1, 2]);
  let closed = false;
  await expect(forEachInventoryItem([1], () => { closed = true; }, () => {
    if (closed) throw new Error('closed');
  })).rejects.toThrow('closed');
});
