// Read-only offline contract checks. Never renders, evaluates source, or refreshes hashes.
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Existing lockfile's Vite/Rolldown parser; parses TypeScript without executing it.
import { parseAst } from 'rolldown/parseAst';

export const SOURCE_FILES = Object.freeze([
  'src/graph-contract.ts', 'src/graph-assertion.ts', 'src/evidence-locator.ts',
  'src/knowledge-synthesis-model.ts', 'src/organization.ts', 'src/endpoint-registry.ts',
  'src/createServer.ts', 'src/filesystem.ts', 'src/graph-assertion-packet.ts',
  'src/llm-wiki.test.ts', 'src/neighborhood-snapshot.test.ts', 'src/topic-packet.test.ts',
  'src/graph-assertion-packet.test.ts', 'src/architecture-transitions.test.ts',
  'package-lock.json',
]);
export const DIAGRAM_FILES = Object.freeze(['domain', 'retrieval', 'states', 'deployment'].map(p => `docs/architecture/uml/${p}.puml`));
export const REQUIRED_TEST_LINKS = Object.freeze([
  { category: 'domain', path: 'src/graph-assertion-packet.test.ts', title: 'occurrences preserve kind, direction and both revisions without raw authored labels' },
  { category: 'retrieval', path: 'src/neighborhood-snapshot.test.ts', title: 'neighborhood rejects a peer hidden after enrichment reads return their captured bodies' },
  { category: 'topic', path: 'src/topic-packet.test.ts', title: 'new membership during a request invalidates its old topic context' },
  { category: 'mutation', path: 'src/llm-wiki.test.ts', title: 'lifecycle transition planner keeps retirement and reactivation metadata coherent' },
  { category: 'preservation', path: 'src/llm-wiki.test.ts', title: 'lifecycle transition planner blocks preservation and unsafe lineage without leaking hidden paths' },
  { category: 'state', path: 'src/architecture-transitions.test.ts', title: 'architecture reactivation cannot infer epistemic state or accept a retirement target' },
]);
const paths = [...SOURCE_FILES, ...DIAGRAM_FILES], manifestPath = 'docs/architecture/uml/contract.json';
const maxBytes = 2 * 1024 * 1024;
export const contractHash = text => createHash('sha256').update(text.replaceAll('\r\n', '\n'), 'utf8').digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unwrap = node => ['TSAsExpression', 'ParenthesizedExpression'].includes(node.type) ? unwrap(node.expression) : node;
function descendants(root, predicate) {
  const result = [];
  function visit(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const item of n) visit(item); return; }
    if (typeof n.type !== 'string') return;
    if (predicate(n)) result.push(n);
    for (const value of Object.values(n)) if (typeof value === 'object') visit(value);
  }
  visit(root); return result;
}
function declaration(file, name) {
  const matches = descendants(file, n => n.type === 'VariableDeclarator' && n.id.name === name);
  if (matches.length !== 1 || !matches[0].init) throw Error('missing declaration');
  return unwrap(matches[0].init);
}
function strings(node) {
  if (node.type === 'NewExpression' && node.callee.name === 'Set') node = node.arguments?.[0];
  if (!node || node.type !== 'ArrayExpression' || node.elements.some(n => n?.type !== 'Literal' || typeof n.value !== 'string')) throw Error('nonliteral array');
  return node.elements.map(n => n.value);
}
function fields(file, name) {
  const list = descendants(file, n => n.type === 'TSInterfaceDeclaration' && n.id.name === name);
  if (list.length !== 1 || list[0].body.body.some(n => n.type !== 'TSPropertySignature' || n.key.type !== 'Identifier')) throw Error('missing interface');
  return list[0].body.body.map(n => n.key.name);
}
function block(text, kind, name) {
  const matches = [...text.matchAll(new RegExp(`^${kind} ${name} \\{\\n([^}]+)\\}`, 'gm'))];
  if (matches.length !== 1) throw Error('missing diagram block');
  return matches[0][1].trim().split('\n').map(s => s.trim());
}

export function checkArchitectureContract(bundle) {
  const errors = [], fail = code => errors.push(code);
  try {
    const { manifest: m, files } = bundle;
    if (m.version !== 1 || m.hashPolicy !== 'utf8_lf_sha256') fail('manifest:version');
    if (!same(Object.keys(m.files).sort(), [...paths].sort()) || !same(Object.keys(files).sort(), [...paths].sort())) fail('manifest:inventory');
    const text = {}, trees = new Map(); let totalBytes = 0;
    for (const p of paths) {
      if (typeof files[p] !== 'string' || Buffer.byteLength(files[p]) > maxBytes) throw Error('invalid bounded file');
      totalBytes += Buffer.byteLength(files[p]);
      if (totalBytes > 12 * 1024 * 1024) throw Error('contract inventory exceeds bound');
      if (!/^[a-f0-9]{64}$/.test(m.files[p]) || contractHash(files[p]) !== m.files[p]) fail(`hash:${p}`);
      text[p] = files[p].replaceAll('\r\n', '\n');
    }
    const tree = p => {
      if (!trees.has(p)) trees.set(p, parseAst(text[p], { lang: 'ts' }, p));
      return trees.get(p);
    };
    const check = (code, fn) => { try { if (!fn()) fail(code); } catch { fail(code); } };
    check('parser:locked-version', () => JSON.parse(text['package-lock.json']).packages['node_modules/rolldown'].version === '1.1.5');
    for (const p of DIAGRAM_FILES) {
      if (/^\s*!|(?:https?|ftp|file|data):|<img\b|\[\[|\\\\/im.test(text[p])) fail(`unsafe:${p}`);
      if (!text[p].startsWith('@startuml\n') || !text[p].trimEnd().endsWith('@enduml') || (text[p].match(/@startuml/g) || []).length !== 1) fail(`diagram:${p}`);
    }
    const domain = text[DIAGRAM_FILES[0]], retrieval = text[DIAGRAM_FILES[1]], states = text[DIAGRAM_FILES[2]], deployment = text[DIAGRAM_FILES[3]];
    const graph = tree('src/graph-contract.ts');
    check('contract:version', () => declaration(graph, 'GRAPH_CONTRACT_VERSION').value === m.graphContractVersion && m.graphContractVersion === 1);
    check('domain:relations', () => same(block(domain, 'enum', 'RelationKind'), strings(declaration(graph, 'RELATION_FIELDS'))));
    for (const [diagram, source, name] of [
      ['RelationOccurrence', 'src/graph-assertion.ts', 'GraphAssertion'],
      ['EvidenceLocator', 'src/evidence-locator.ts', 'EvidenceLocator'],
      ['SynthesisBasis', 'src/knowledge-synthesis-model.ts', 'KnowledgeSynthesis'],
    ]) check(`domain:${diagram}`, () => same(block(domain, 'class', diagram), fields(tree(source), name)));
    check('domain:source-target-optionality', () => {
      const item = descendants(tree('src/graph-assertion.ts'), n => n.type === 'TSInterfaceDeclaration' && n.id.name === 'GraphAssertion')[0];
      return item.body.body.find(n => n.key.name === 'source').optional === false
        && item.body.body.find(n => n.key.name === 'target').optional === true;
    });
    for (const line of [
      'RelationOccurrence "0..*" --> "1" Revision : source',
      'RelationOccurrence "0..*" --> "0..1" Revision : resolved target',
      'SynthesisBasis "0..*" --> "2..8" Revision : exact input pins',
    ]) check(`multiplicity:${line.split(' : ')[1]}`, () => domain.split('\n').includes(line));
    check('domain:no-cascade', () => !/\*--|--\*/.test(domain));
    check('synthesis:runtime-inputs', () => {
      const calls = descendants(tree('src/knowledge-synthesis-model.ts'), n => n.type === 'CallExpression' && n.callee.name === 'array'
        && n.arguments[0]?.type === 'MemberExpression' && n.arguments[0].object.name === 'root' && n.arguments[0].property.name === 'inputs');
      return calls.length === 1 && calls[0].arguments[1].value === 2 && calls[0].arguments[2].value === 8;
    });
    const org = tree('src/organization.ts');
    check('state:lifecycle', () => {
      const actual = strings(declaration(org, 'LIFECYCLES'));
      const found = [...states.matchAll(/^  state ([a-z_]+)$/gm)].map(m => m[1]);
      return same(found, actual);
    });
    check('state:task', () => same([...states.matchAll(/^  state "([a-z_]+)" as task_[a-z_]+$/gm)].map(m => m[1]), strings(declaration(org, 'TASK_STATUSES'))));
    for (const kind of ['question', 'hypothesis', 'experiment', 'assumption']) check(`state:${kind}`, () => {
      const expected = strings(declaration(org, `${kind.toUpperCase()}_STATUSES`));
      return states.includes(`state "${kind}: ${expected.join(', ')}" as ${kind}`);
    });
    for (const marker of ['DryRun --> Apply : same request + confirmPlanFingerprint', 'Apply --> ReRead : current ACL/revision/source protection', 'Preview --> Refused : legal hold / preserve_until / unsafe lineage']) check('state:guard:' + marker.split(' : ')[0], () => states.includes(marker));
    const sequence = ['filter before resolution/aggregation', 'final current revisions', 'alt drift, ambiguity or revocation observed', 'packet / explicit partial scope'];
    check('retrieval:release-order', () => sequence.every((s, i) => retrieval.includes(s) && (!i || retrieval.indexOf(sequence[i - 1]) < retrieval.indexOf(s))));
    check('deployment:five-tools', () => {
      const actual = strings(declaration(tree('src/endpoint-registry.ts'), 'CONTROL_TOOLS'));
      return actual.length === 5 && actual.every(s => deployment.includes(s));
    });
    for (const edge of ['MCP --> Registry', 'Registry --> Services', 'Services --> Boundary', 'Boundary --> Vault', 'Services --> Cache : discovery only']) {
      check('deployment:boundary:' + edge, () => deployment.includes(edge));
    }
    for (const [source, dependencies] of [
      ['src/createServer.ts', ['./filesystem.js', './pathfilter.js', './scope-access.js', './llm-wiki.js', './endpoint-registry.js']],
      ['src/filesystem.ts', ['./pathfilter.js', './scope-access.js']],
      ['src/graph-assertion-packet.ts', ['./filesystem.js', './scope-access.js', './graph-assertion.js']],
    ]) check(`imports:${source}`, () => {
      const imported = tree(source).body.filter(n => n.type === 'ImportDeclaration').map(n => n.source.value);
      return dependencies.every(d => imported.includes(d));
    });
    check('tests:required-links', () => same(m.testLinks, REQUIRED_TEST_LINKS));
    for (const link of REQUIRED_TEST_LINKS) check(`test:${link.category}`, () => descendants(tree(link.path), n => n.type === 'CallExpression'
      && ['test', 'it'].includes(n.callee.name) && n.arguments[0]?.type === 'Literal' && n.arguments[0].value === link.title).length === 1);
  } catch { fail('contract:invalid-input'); }
  return { valid: errors.length === 0, errors, testsExecuted: false, rendered: false, hostDeploymentAttested: false };
}

export async function loadArchitectureContract(root) {
  const canonical = await realpath(resolve(root));
  async function bounded(p) {
    if (![manifestPath, ...paths].includes(p)) throw Error('Unsafe contract path');
    let current = canonical;
    const parts = p.split('/');
    for (let i = 0; i < parts.length; i++) {
      current = join(current, parts[i]); const stat = await lstat(current);
      if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw Error('Unsafe reparse contract path');
      if (i === parts.length - 1 && stat.size > maxBytes) throw Error('Contract file exceeds bound');
    }
    if (await realpath(current) !== current) throw Error('Unsafe contract path');
    const text = await readFile(current, 'utf8');
    if (Buffer.byteLength(text) > maxBytes || await realpath(current) !== current) throw Error('Contract file changed or exceeds bound');
    return text;
  }
  const manifest = JSON.parse(await bounded(manifestPath)), files = {};
  if (!same(Object.keys(manifest.files || {}).sort(), [...paths].sort())) throw Error('Unsafe manifest inventory');
  // Fixed paths only. Manifest values never select code, imports or files to execute.
  for (const p of paths) files[p] = await bounded(p);
  return { manifest, files };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw Error('Run without arguments from the repository checkout');
  const result = checkArchitectureContract(await loadArchitectureContract(fileURLToPath(new URL('..', import.meta.url))));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.valid) process.exitCode = 1;
}
