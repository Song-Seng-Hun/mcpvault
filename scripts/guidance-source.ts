import { createHash } from 'node:crypto';
import { API } from 'typescript/unstable/sync';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import * as ts from 'typescript/unstable/ast';

export interface Candidate {
  id: string; kind: 'prose' | 'error'; template: string; parts: string[];
  sourceFile: string; line: number; expression: string; wrapped: boolean; reason?: string;
}
interface Found { candidate: Candidate; start: number; end: number; pending: boolean }
const properties = new Set(['description', 'message', 'guidance', 'instruction', 'warning', 'reason', 'purpose', 'label', 'hint', 'note', 'recommendation', 'markdown', 'text', 'joiningSteps', 'endConditions', 'resultLocation', 'contributorAttribution']);
const arrays = new Set(['rules', 'avoid', 'invariants', 'warnings', 'guidance', 'recommendations', 'joiningSteps', 'endConditions']);
const errors = new Set(['Error', 'TypeError', 'RangeError']);
const idFor = (kind: string, template: string) => `guid-${createHash('sha256').update(kind + template).digest('hex').slice(0, 16)}`;
function partsOf(node: ts.Node | undefined): string[] | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map(s => s.literal.text)];
  return undefined;
}
function propertyName(node: ts.Node | undefined): string | undefined {
  return node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : undefined;
}
function hasRuntimeAncestor(node: ts.Node): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p) || ts.isMethodDeclaration(p) || ts.isConstructorDeclaration(p) || ts.isGetAccessorDeclaration(p)) return true;
    if (ts.isSourceFile(p)) break;
  }
  return false;
}
function collect(source: string, file: string): Found[] {
  if (!/^src\/[^/]+\.ts$/.test(file.replaceAll('\\', '/')) || /\.test\.ts$/.test(file) || /\/guidance-/.test(file)) return [];
  // Read-only parser API with virtual files. Never import tsc or emit files.
  const root = process.cwd().replaceAll('\\', '/') + '/.mcpvault/virtual-guidance';
  const config = root + '/tsconfig.json', input = root + '/input.ts';
  const api = new API({ cwd: root, fs: createVirtualFileSystem({
    [config]: JSON.stringify({ compilerOptions: { noEmit: true, noLib: true, noResolve: true, types: [] }, files: ['input.ts'] }), [input]: source,
  }) });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [config] });
    const program = snapshot.getProject(config)!.program;
    const fileNode = program.getSourceFile(input)!;
    if (program.getSyntacticDiagnostics(input).length) throw new Error(`Cannot instrument syntactically invalid source: ${file}`);
    const found: Found[] = [];
    const add = (node: ts.Node, value: ts.Node, kind: 'prose' | 'error', wrapped = false, explicitId?: string) => {
      const parts = partsOf(value); if (!parts) return;
      const template = parts.map((p, i) => p + (i < parts.length - 1 ? `{arg${i}}` : '')).join('');
      if (!template.trim() || template.length > 20000 || parts.length > 17) return;
      if (!parts.some(p => /\p{L}/u.test(p))) return; // Pure user interpolation/numeric data is not authored prose.
      const pending = kind === 'prose' && !hasRuntimeAncestor(node);
      found.push({ start: node.getStart(fileNode), end: node.end, pending, candidate: {
        id: explicitId ?? idFor(kind, template), kind, template, parts, sourceFile: file,
        line: fileNode.getLineAndCharacterOfPosition(node.getStart(fileNode)).line + 1,
        expression: node.getText(fileNode), wrapped,
        ...(pending && { reason: 'top-level initialization requires explicit runtime projection' }),
      } });
    };
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (name === 'guidanceText' && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[1]) {
          add(node, node.arguments[1], 'prose', true, node.arguments[0].text); return;
        }
        if (name === 'guidanceError' && node.arguments[0] && (ts.isNewExpression(node.arguments[0]) || ts.isCallExpression(node.arguments[0])) && node.arguments[1] && ts.isStringLiteral(node.arguments[1])) {
          const value = node.arguments[0].arguments?.[0]; if (value) add(node, value, 'error', true, node.arguments[1].text); return;
        }
      }
      if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && ts.isIdentifier(node.expression) && errors.has(node.expression.text) && node.arguments?.[0]) {
        add(node, node.arguments[0], 'error'); return;
      }
      if (ts.isPropertyAssignment(node)) {
        const name = propertyName(node.name), parts = partsOf(node.initializer);
        if (name && ['enum', 'const', 'pattern', 'default', 'examples'].includes(name)) {
          const check = (child: ts.Node): void => {
            if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && ['guidanceText', 'guidanceError'].includes(child.expression.text)) throw new Error(`Guidance wrapper inside structural schema: ${file}:${fileNode.getLineAndCharacterOfPosition(child.getStart()).line + 1}`);
            child.forEachChild(n => { check(n); });
          };
          check(node.initializer); return;
        }
        if (name && properties.has(name) && parts && (name !== 'reason' || /\s/.test(parts.join('')))) { add(node.initializer, node.initializer, 'prose'); return; }
        if (name && arrays.has(name) && ts.isArrayLiteralExpression(node.initializer)) {
          for (const child of node.initializer.elements) { if (partsOf(child)) add(child, child, 'prose'); else visit(child); } return;
        }
      }
      node.forEachChild(child => { visit(child); });
    };
    visit(fileNode); snapshot.dispose(); return found.sort((a, b) => a.start - b.start);
  } finally { api.close(); }
}
export function scanGuidanceSource(source: string, file: string): Candidate[] { return collect(source, file).map(f => f.candidate); }
export function instrumentGuidanceSource(source: string, file: string) {
  const found = collect(source, file), imports = new Set<string>();
  let output = source;
  for (const item of [...found].reverse()) {
    if (item.pending || item.candidate.wrapped) continue;
    const { id, kind } = item.candidate;
    const fn = kind === 'error' ? 'guidanceError' : 'guidanceText';
    imports.add(fn);
    const original = source.slice(item.start, item.end);
    const replacement = kind === 'error' ? `${fn}(${original}, '${id}')` : `${fn}('${id}', ${original})`;
    output = output.slice(0, item.start) + replacement + output.slice(item.end);
    item.candidate.wrapped = true;
  }
  const existing = [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/guidance-runtime\.js['"]/g)].flatMap(m => m[1]!.split(',').map(s => s.trim()));
  const missing = [...imports].filter(name => !existing.includes(name)).sort();
  if (missing.length) output = `import { ${missing.join(', ')} } from './guidance-runtime.js';\n` + output;
  return { source: output, candidates: found.map(f => f.candidate), pending: found.filter(f => f.pending).map(f => f.candidate) };
}
