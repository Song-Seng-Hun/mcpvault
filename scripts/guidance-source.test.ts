import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { instrumentGuidanceSource, scanGuidanceSource } from './guidance-source.js';

function id(kind: 'prose' | 'error', template: string) {
  return `guid-${createHash('sha256').update(`${kind}${template}`).digest('hex').slice(0, 16)}`;
}

describe('guidance source scanner', () => {
  test('finds allowed prose, templates, prose arrays, and new error messages', () => {
    const source = [
      "const schema = { description: 'Describe the note', reason: 'broken_link', label: `Open ${'the'} note`, rules: ['Read the note first', `Keep ${kind} bounded`] };",
      "function run() { throw new RangeError(`Value ${value} is outside the allowed range`); }",
      "const ignored = { content: 'User supplied content', enum: ['Do not rewrite'], pattern: 'a human phrase' };",
    ].join('\n');

    const candidates = scanGuidanceSource(source, 'src/example.ts');

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: id('prose', 'Describe the note'),
        kind: 'prose',
        template: 'Describe the note',
        sourceFile: 'src/example.ts',
        line: 1,
        expression: "'Describe the note'",
        wrapped: false,
      }),
      expect.objectContaining({
        id: id('prose', 'Open {arg0} note'),
        template: 'Open {arg0} note',
        expression: "`Open ${'the'} note`",
      }),
      expect.objectContaining({
        id: id('prose', 'Read the note first'),
        template: 'Read the note first',
        expression: "'Read the note first'",
      }),
      expect.objectContaining({
        id: id('prose', 'Keep {arg0} bounded'),
        template: 'Keep {arg0} bounded',
        expression: '`Keep ${kind} bounded`',
      }),
      expect.objectContaining({
        id: id('error', 'Value {arg0} is outside the allowed range'),
        kind: 'error',
        template: 'Value {arg0} is outside the allowed range',
        expression: "new RangeError(`Value ${value} is outside the allowed range`)",
        line: 2,
      }),
    ]));
    expect(candidates.some(candidate => candidate.template === 'broken_link')).toBe(false);
    expect(candidates.some(candidate => candidate.template === 'User supplied content')).toBe(false);
    expect(candidates.some(candidate => candidate.template === 'a human phrase')).toBe(false);
  });

  test('instruments only runtime-safe candidates and preserves exclusions and evaluation shape', () => {
    const source = [
      "const description = { description: `Hello ${name}` };",
      "function run(value: string) { return { message: 'Try again', content: value, error: new Error(`Bad ${value}`) }; }",
      "console.log('Debug only');",
    ].join('\n');

    const result = instrumentGuidanceSource(source, 'src/runtime.ts');

    expect(result.source).toContain("import { guidanceError, guidanceText } from './guidance-runtime.js';");
    expect(result.source).toContain("message: guidanceText('guid-");
    expect(result.source).toContain("error: guidanceError(new Error(`Bad ${value}`), 'guid-");
    expect(result.source).toContain("content: value");
    expect(result.source).toContain("console.log('Debug only')");
    expect(result.candidates.filter(candidate => candidate.wrapped)).toHaveLength(2);
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]).toMatchObject({
      template: 'Hello {arg0}',
      wrapped: false,
      reason: expect.stringContaining('top-level initialization'),
    });
    expect(result.source).not.toContain("description: guidanceText('guid-");
  });

  test('keeps explicit wrapper IDs stable when the default changes and does not duplicate imports or wrappers', () => {
    const source = [
      "import { guidanceText } from './guidance-runtime.js';",
      "const item = { description: guidanceText('guid-fixed-description', 'Updated default') };",
      "function fail() { throw guidanceError(new Error('Updated failure'), 'guid-fixed-error'); }",
    ].join('\n');

    const scanned = scanGuidanceSource(source, 'src/already-guided.ts');
    expect(scanned).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'guid-fixed-description', template: 'Updated default', wrapped: true }),
      expect.objectContaining({ id: 'guid-fixed-error', template: 'Updated failure', wrapped: true }),
    ]));

    const result = instrumentGuidanceSource(source, 'src/already-guided.ts');
    expect(result.source).toBe(source);
    expect(result.source.match(/guidanceText\(/g)).toHaveLength(1);
    expect(result.source.match(/guidanceError\(/g)).toHaveLength(1);
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]).toMatchObject({ id: 'guid-fixed-description', wrapped: true });
  });

  test('rejects test and nested or guidance source paths from production inventory', () => {
    const source = "const item = { description: 'Visible guidance' };";

    expect(scanGuidanceSource(source, 'src/example.test.ts')).toEqual([]);
    expect(scanGuidanceSource(source, 'src/nested/example.ts')).toEqual([]);
    expect(scanGuidanceSource(source, 'src/guidance-runtime.ts')).toEqual([]);
  });

  test('real syntax handles escapes, regex literals and nested template expressions without rewriting comments', () => {
    const source = '// description: "Comment stays"\nfunction run() { return { message: `Hi ${fn(/}/, `${value}`)}\\nNext`, text: "Exact\\ntext" }; }';
    const result = instrumentGuidanceSource(source, 'src/example.ts');
    expect(result.candidates.find(c => c.template.startsWith('Hi'))?.parts).toEqual(['Hi ', '\nNext']);
    expect(result.source).toContain('// description: "Comment stays"');
    expect((result.source.match(/fn\(/g) ?? []).length).toBe(1);
    expect(instrumentGuidanceSource(result.source, 'src/example.ts').source).toBe(result.source);
  });
  test('Error calls without new are annotated; structural fields and variable user data are untouched', () => {
    const source = 'function fail() { const x = { content: body, enum: ["Not editable"], type: "string" }; throw Error(`Denied ${account}`); }';
    const result = instrumentGuidanceSource(source, 'src/example.ts');
    expect(result.source).toContain('guidanceError(Error(`Denied ${account}`)');
    expect(result.source).toContain('content: body, enum: ["Not editable"], type: "string"');
  });
  test('invalid source is never rewritten', () => {
    expect(() => instrumentGuidanceSource('function f( {', 'src/example.ts')).toThrow(/invalid source/);
  });
  test('pure user interpolation and numeric text are never editable guidance', () => {
    const source = 'function show() { return { text: `${body}`, message: `${a}\\n${b}`, note: "12345" }; }';
    expect(instrumentGuidanceSource(source, 'src/example.ts').source).toBe(source);
  });
  test('nested structural schema objects cannot acquire mutable prose wrappers', () => {
    const source = 'function schema() { return { enum: [{description: "Allowed literal"}], const: {message: "Required data"}, examples: [{text: "Example data"}], default: {description: "Stable default"} }; }';
    expect(instrumentGuidanceSource(source, 'src/example.ts').source).toBe(source);
    expect(() => instrumentGuidanceSource('function f() { return {const: {message: guidanceText("guid-bad", "literal")}}; }', 'src/example.ts')).toThrow(/structural schema/);
  });
});
