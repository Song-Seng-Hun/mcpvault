import { describe, it, expect } from 'vitest';
import { documentRecords, toLangChainDocument, toLlamaIndexNode } from './document-adapters.js';
import { parseDocumentStructure } from './document-structure.js';

describe('framework-neutral document adapters', () => {
  it('preserves exact text, public locators and relationships without framework dependencies', () => {
    const doc = parseDocumentStructure({ path: '_scopes/agent/private/n.md', raw: '# 조건\n\n승인 없이는 실행하지 않는다.\n\n```sh\nrm -rf example\n```' });
    const records = documentRecords(doc, 'scope://agent/n.md');
    expect(records.length).toBeGreaterThan(2);
    for (const record of records) {
      expect(record.text).toBe(doc.raw.slice(record.locator.startOffset, record.locator.endOffset));
      expect(record.metadata.path).toBe('scope://agent/n.md');
      expect(JSON.stringify(record)).not.toContain('_scopes/');
      expect(toLangChainDocument(record).pageContent).toBe(record.text);
      expect(toLlamaIndexNode(record).text).toBe(record.text);
    }
    expect(records.some(r => r.text.includes('rm -rf example'))).toBe(true);
  });
  it('requires an explicit public path and exports leaves only by default', () => {
    const doc = parseDocumentStructure({ path: 'n.md', raw: '# T\n\nBody' });
    expect(() => documentRecords(doc, '')).toThrow(/public path/);
    expect(documentRecords(doc, 'n.md').every(r => !r.relationships.children.length)).toBe(true);
    expect(documentRecords(doc, 'n.md', { includeContainers: true }).length).toBe(doc.fragments.length);
  });
});
