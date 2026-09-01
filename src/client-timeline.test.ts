import { expect, test } from 'vitest';
import { ClientTimelineCache } from './client-timeline.js';

interface Message {
  messageId: string;
  revision: string;
  content: string;
}

test('deduplicates overlapping cursor windows and updates changed revisions', () => {
  const cache = new ClientTimelineCache<Message>({
    getId: item => item.messageId,
    getRevision: item => item.revision,
  });
  const first = cache.merge([
    { messageId: 'm1', revision: 'a', content: 'one' },
    { messageId: 'm2', revision: 'a', content: 'two' },
  ]);
  expect(first.addedIds).toEqual(['m1', 'm2']);

  const overlap = cache.merge([
    { messageId: 'm1', revision: 'a', content: 'one' },
    { messageId: 'm2', revision: 'b', content: 'two edited' },
    { messageId: 'm3', revision: 'a', content: 'three' },
  ]);
  expect(overlap.duplicateIds).toEqual(['m1']);
  expect(overlap.updatedIds).toEqual(['m2']);
  expect(overlap.addedIds).toEqual(['m3']);
  expect(cache.get('m2')).toMatchObject({ revision: 'b', content: 'two edited' });
  expect(cache.values().map(item => item.messageId)).toEqual(['m1', 'm2', 'm3']);
});

test('bounds retained timeline entries', () => {
  const cache = new ClientTimelineCache<{ commentId: string }>({ getId: item => item.commentId, maxEntries: 2 });
  cache.merge([{ commentId: 'c1' }, { commentId: 'c2' }, { commentId: 'c3' }]);
  expect(cache.size()).toBe(2);
  expect(cache.get('c1')).toBeUndefined();
  expect(cache.values().map(item => item.commentId)).toEqual(['c2', 'c3']);
});
