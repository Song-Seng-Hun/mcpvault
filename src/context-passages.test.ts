import { describe, expect, test } from 'vitest';
import { selectContextPassages } from './context-passages.js';

describe('selectContextPassages', () => {
  test('selects Korean prose by query coverage without changing authored negation or conditions', () => {
    const result = selectContextPassages({
      content: '# 결정\n\n승인하지 않는다. 단, 증거가 검증된 경우에만 재검토한다.\n\n다른 설명.',
      query: '증거 검증',
      maxChars: 200,
    });

    expect(result).toEqual({
      passages: [{
        text: '승인하지 않는다. 단, 증거가 검증된 경우에만 재검토한다.',
        startLine: 3,
        endLine: 3,
        headingPath: ['결정'],
        truncated: false,
      }],
      truncated: false,
    });
  });

  test('matches a one-character Korean query and honors an origin line offset', () => {
    const result = selectContextPassages({
      content: '첫 문단.\n\n가나다 정보.',
      query: '가',
      maxChars: 100,
      startLine: 41,
    });

    expect(result.passages).toEqual([expect.objectContaining({ text: '가나다 정보.', startLine: 43, endLine: 43, headingPath: [] })]);
  });

  test('selects separate relevant list items in coverage then authored order', () => {
    const result = selectContextPassages({
      content: [
        '# 계획',
        '',
        '- 배포 전에 백업을 만든다.',
        '- 검토 후 배포를 승인한다.',
        '- 무관한 항목.',
      ].join('\n'),
      query: '배포 검토',
      maxChars: 200,
      maxPassages: 2,
    });

    expect(result.passages).toEqual([
      expect.objectContaining({ text: '- 검토 후 배포를 승인한다.', startLine: 4, endLine: 4, headingPath: ['계획'] }),
      expect.objectContaining({ text: '- 배포 전에 백업을 만든다.', startLine: 3, endLine: 3, headingPath: ['계획'] }),
    ]);
  });

  test('clips a huge selected paragraph but keeps its full source locator', () => {
    const paragraph = `근거 ${'가'.repeat(120)}`;
    const result = selectContextPassages({ content: paragraph, query: '근거', maxChars: 12 });

    expect(result.passages).toEqual([expect.objectContaining({
      text: paragraph.slice(0, 12), startLine: 1, endLine: 1, truncated: true,
    })]);
    expect(result.truncated).toBe(true);
    expect(result.passages[0]!.text.length).toBeLessThanOrEqual(12);
  });

  test('clips a huge paragraph around a late query match using an exact source window', () => {
    const paragraph = `${'앞'.repeat(80)} TARGET-NEEDLE ${'뒤'.repeat(80)}`;
    const result = selectContextPassages({ content: paragraph, query: 'target-needle', maxChars: 31 });
    const passage = result.passages[0]!;

    expect(passage.text).toHaveLength(31);
    expect(passage.text).toContain('TARGET-NEEDLE');
    expect(paragraph).toContain(passage.text);
    expect(passage).toMatchObject({ startLine: 1, endLine: 1, truncated: true });
    expect(result.truncated).toBe(true);
  });

  test('keeps matching fenced code as an exact code-context excerpt without treating fake headings as ancestry', () => {
    const result = selectContextPassages({
      content: [
        '# 실제',
        '~~~~ts',
        '## 예제 제목',
        'const token = "needle";',
        '~~~~',
        '',
        'needle 밖의 문단.',
      ].join('\n'),
      query: 'needle',
      maxChars: 200,
    });

    expect(result.passages).toEqual([
      expect.objectContaining({ text: '~~~~ts\n## 예제 제목\nconst token = "needle";\n~~~~', startLine: 2, endLine: 5, headingPath: ['실제'] }),
      expect.objectContaining({ text: 'needle 밖의 문단.', startLine: 7, endLine: 7, headingPath: ['실제'] }),
    ]);
  });

  test('returns a matching table row with its exact authored header context', () => {
    const result = selectContextPassages({
      content: [
        '## 상태',
        '| 항목 | 상태 |',
        '| --- | --- |',
        '| 배포 | 보류 |',
        '| 문서 | 완료 |',
      ].join('\n'),
      query: '보류',
      maxChars: 200,
    });

    expect(result.passages).toEqual([expect.objectContaining({
      text: '| 항목 | 상태 |\n| --- | --- |\n| 배포 | 보류 |',
      startLine: 2,
      endLine: 4,
      headingPath: ['상태'],
    })]);
  });

  test('preserves CRLF source text and nested heading ancestry', () => {
    const result = selectContextPassages({
      content: '# 상위\r\n## 하위\r\n조건은 유지한다.\r\n다음 줄도 조건이다.',
      query: '조건 유지',
      maxChars: 200,
      startLine: 10,
    });

    expect(result.passages).toEqual([expect.objectContaining({
      text: '조건은 유지한다.\r\n다음 줄도 조건이다.',
      startLine: 12,
      endLine: 13,
      headingPath: ['상위', '하위'],
    })]);
  });

  test('caps passages and total returned source text while retaining the highest-coverage match', () => {
    const result = selectContextPassages({
      content: 'alpha only.\n\nalpha beta chosen.\n\nalpha beta later.',
      query: 'alpha beta',
      maxChars: 17,
      maxPassages: 99,
    });

    expect(result.passages).toHaveLength(1);
    expect(result.passages[0]).toEqual(expect.objectContaining({ text: 'alpha beta chosen.'.slice(0, 17), truncated: true }));
    expect(result.passages.reduce((total, passage) => total + passage.text.length, 0)).toBeLessThanOrEqual(17);
    expect(result.truncated).toBe(true);
  });

  test('caps a caller-requested passage count at two', () => {
    const result = selectContextPassages({
      content: 'match one.\n\nmatch two.\n\nmatch three.',
      query: 'match',
      maxChars: 200,
      maxPassages: 99,
    });

    expect(result.passages.map(passage => passage.text)).toEqual(['match one.', 'match two.']);
    expect(result.truncated).toBe(true);
  });

  test('uses an explicit preferred line before lexical ranking when an evidence locator uses another language', () => {
    const result = selectContextPassages({
      content: '# Evidence\n\n한국어 근거는 조건부로만 적용한다.\n\nenglish query appears here.',
      query: 'english query',
      maxChars: 200,
      maxPassages: 1,
      preferredLine: 3,
    });

    expect(result.passages).toEqual([expect.objectContaining({
      text: '한국어 근거는 조건부로만 적용한다.', startLine: 3, endLine: 3, headingPath: ['Evidence'],
    })]);
    expect(result.truncated).toBe(true);
  });

  test('reads the preferred source unit for an empty query but ignores a nonpositive locator', () => {
    const content = '첫 문단.\n\n둘째 근거.';

    expect(selectContextPassages({ content, query: '', maxChars: 100, preferredLine: 3 }).passages).toEqual([
      expect.objectContaining({ text: '둘째 근거.', startLine: 3, endLine: 3 }),
    ]);
    expect(selectContextPassages({ content, query: '', maxChars: 100, preferredLine: 0 })).toEqual({ passages: [], truncated: false });
  });

  test('uses a heading locator for its next paragraph even when the query has no overlap', () => {
    const result = selectContextPassages({
      content: '# 근거\n\n한국어 원문 근거.\n\nenglish lexical match.',
      query: 'english',
      maxChars: 100,
      maxPassages: 1,
      preferredLine: 1,
    });

    expect(result.passages).toEqual([expect.objectContaining({
      text: '한국어 원문 근거.', startLine: 3, endLine: 3, headingPath: ['근거'],
    })]);
  });

  test('does not treat the boolean OR token as a lexical query term', () => {
    const result = selectContextPassages({
      content: 'or is incidental prose.\n\nalpha target.',
      query: 'alpha OR beta',
      maxChars: 100,
      maxPassages: 1,
    });

    expect(result.passages).toEqual([expect.objectContaining({ text: 'alpha target.', startLine: 3, endLine: 3 })]);
  });

  test('exact phrases win over paragraphs matching individual words', () => {
    const r = selectContextPassages({ content: 'retry without the policy here.\n\nretry separate policy again.\n\nThe retry policy is conditional.', query: '"retry policy"', maxChars: 1200 });
    expect(r.passages[0]?.text).toBe('The retry policy is conditional.');
  });

  test('clipping honors an explicit later evidence line before an earlier lexical hit', () => {
    const r = selectContextPassages({ content: 'retry ' + 'x'.repeat(2500) + '\nLocated evidence only for safe requests.', query: 'retry', preferredLine: 2, maxChars: 350 });
    expect(r.passages[0]?.text).toContain('Located evidence only for safe requests.');
  });

  test('returns no arbitrary passage when the query has no match and the preferred line is not a source unit', () => {
    expect(selectContextPassages({
      content: '첫 문단.\n\n둘째 문단.', query: '없는말', maxChars: 100, preferredLine: 2,
    })).toEqual({ passages: [], truncated: false });
  });
});
