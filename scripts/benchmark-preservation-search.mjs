// Opt-in synthetic/local benchmark. No Vault path, provider, or URL input.
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve, win32, posix } from 'node:path';
import { freemem, tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO = dirname(dirname(SELF));
const PREFIX = 'mcpvault-synthetic-preservation-';
const START_FREE = 3.25 * 2 ** 30, STOP_FREE = 3.125 * 2 ** 30;
const MAX_OUTPUT = 256 * 1024, MAX_ERROR = 4096, TIMEOUT_MS = 180_000;
const SEARCH_CHARS = 4096, READ_CHARS = 2048, TOP_K = 4;

export const sha256 = raw => createHash('sha256').update(raw, 'utf8').digest('hex');
export function parseArgs(args) {
  if (args.length === 1 && args[0] === '--smoke') return { size: 100, smoke: true };
  if (args.length === 2 && args[0] === '--size' && /^(100|1000|10000)$/.test(args[1])) {
    return { size: Number(args[1]), smoke: false };
  }
  throw new Error('Explicit synthetic arguments required: --smoke OR --size 100|1000|10000; no paths or URLs');
}
export const unavailableMetrics = () => ({ model: null, modelInputTokens: null, modelOutputTokens: null,
  actualNasReadBytes: null, modelAnswerQuality: null, measurementStatus: 'not-measured' });
export const fixturePath = (base, suffix) => join(base, PREFIX + suffix);
export function isOwnedFixture(base, owned, candidate) {
  const rel = relative(resolve(base), resolve(candidate));
  return resolve(candidate) === resolve(owned) && dirname(resolve(candidate)) === resolve(base)
    && !!rel && !isAbsolute(rel) && !rel.startsWith('..') && basename(candidate).startsWith(PREFIX);
}

function returnedPayloadLeaksPrivate(returnedText) {
  const pending = [returnedText];
  // Decode JSON escapes as well as inspecting raw/plain-text tool output.
  try { pending.push(JSON.parse(returnedText)); } catch { /* Plain text is valid input. */ }
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === 'string') {
      const normalized = value.replace(/\\+/g, '/');
      if (/(?:_scopes\/+users\/+other|scope:\/+user\/+other)(?=\/|$|[\s"'<>),\]}])/i.test(normalized)) return true;
      for (const match of value.matchAll(/\b(?:lookup|src|value)(\d{5})/g)) {
        if (Number(match[1]) % 10 === 0) return true;
      }
    } else if (value && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) pending.push(key, entry);
    }
  }
  return false;
}

// Ground truth is used only for evaluation, never for retrieval selection.
export function gradeEvidence(expected, evidence, searchPaths, returnedText = '') {
  const byPath = new Map(expected.map(e => [e.path, e]));
  const seen = new Set(); let correct = 0, invalid = 0;
  const aclLeak = returnedPayloadLeaksPrivate(returnedText)
    || [...searchPaths, ...evidence.map(e => e.path)].some(p => !p.startsWith('public/'));
  for (const item of evidence) {
    const source = byPath.get(item.path);
    const exact = source && item.revision === sha256(source.raw) && item.parts.length > 0
      && item.parts.every(p => Number.isInteger(p.startOffset) && Number.isInteger(p.endOffset)
        && p.startOffset >= 0 && p.endOffset > p.startOffset && p.endOffset <= source.raw.length
        && source.raw.slice(p.startOffset, p.endOffset) === p.text);
    const text = item.parts.map(p => p.text).join('\n');
    if (exact && !seen.has(item.path) && text.includes(`source=${source.source} `)
      && text.includes(`answer=${source.answer}\n`)) correct++;
    else invalid++;
    seen.add(item.path);
  }
  return { pass: !aclLeak && invalid === 0 && correct === expected.length,
    expectedSources: expected.length, correctSources: correct, invalidEvidence: invalid, aclLeak,
    answerMarkerRecall: expected.length ? correct / expected.length : null,
    evidencePrecision: evidence.length ? correct / evidence.length : null };
}

function row(i, version = 1) {
  const id = String(i).padStart(5, '0');
  const path = `${i % 10 === 0 ? '_scopes/users/other' : 'public'}/note-${id}.md`;
  const source = `src${id}`, answer = `value${id}v${version}`, query = `lookup${id}`;
  const lines = [`# Synthetic record ${id}`, ''];
  const markerAt = 3 + (i * 17 % 46);
  for (let line = 0; line < 50; line++) {
    lines.push(line === markerAt ? `${query} source=${source} answer=${answer}`
      : `Context ${id} row ${line}: local deterministic material about storage, research and review.`);
  }
  return { path, source, answer, query, raw: lines.join('\n') + '\n' };
}
function questions(size, changed = false) {
  const ids = [1, Math.floor(size / 2) + 1, size - 1];
  const records = ids.map((id, index) => row(id, changed && index === 1 ? 2 : 1));
  return [
    ...records.map(r => ({ id: r.query, question: `What value does ${r.query} specify? Cite the current source.`, query: r.query, expected: [r] })),
    { id: 'two-sources', question: `What values do ${records[0].query} and ${records[2].query} specify? Cite both.`,
      query: `${records[0].query} ${records[2].query}`, expected: [records[0], records[2]] },
    { id: 'denied-only', question: 'What value does lookup00000 specify in accessible sources?', query: 'lookup00000', expected: [] },
    { id: 'absent', question: 'What value does lookupabsent specify?', query: 'lookupabsent', expected: [] },
  ];
}

// Measures successful logical API reads of fixture files, not kernel or SMB IO.
// Installed before dynamic source imports; named ESM imports are synchronized.
function instrumentReads(corpus) {
  const counts = { readFileCalls: 0, handleReadCalls: 0, openCalls: 0, metadataCalls: 0,
    directoryCalls: 0, sourceReadBytes: 0, otherReadBytes: 0 };
  const original = new Map();
  const local = path => {
    if (typeof path !== 'string' && !Buffer.isBuffer(path) && !(path instanceof URL)) return false;
    const value = path instanceof URL ? fileURLToPath(path) : String(path);
    const rel = relative(corpus, resolve(value));
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  };
  const bytes = value => Buffer.isBuffer(value) ? value.length : Buffer.byteLength(value, 'utf8');
  const add = (path, n) => { counts[String(path).endsWith('.md') ? 'sourceReadBytes' : 'otherReadBytes'] += n; };
  const patch = (name, factory) => { original.set(name, fs[name]); fs[name] = factory(fs[name]); };
  patch('readFile', real => async (path, ...args) => {
    const result = await real(path, ...args);
    if (local(path)) { counts.readFileCalls++; add(path, bytes(result)); }
    return result;
  });
  for (const name of ['stat', 'lstat', 'realpath', 'readdir', 'opendir']) {
    patch(name, real => async (path, ...args) => {
      if (local(path)) counts[name === 'readdir' || name === 'opendir' ? 'directoryCalls' : 'metadataCalls']++;
      return real(path, ...args);
    });
  }
  patch('open', real => async (path, ...args) => {
    const handle = await real(path, ...args);
    if (!local(path)) return handle;
    counts.openCalls++;
    const read = handle.read.bind(handle), readFile = handle.readFile.bind(handle), stat = handle.stat.bind(handle);
    handle.read = async (...args) => { const result = await read(...args); counts.handleReadCalls++; add(path, result.bytesRead); return result; };
    handle.readFile = async (...args) => { const result = await readFile(...args); counts.readFileCalls++; add(path, bytes(result)); return result; };
    handle.stat = async (...args) => { counts.metadataCalls++; return stat(...args); };
    return handle;
  });
  syncBuiltinESMExports();
  return { snapshot: () => ({ ...counts }), restore: () => {
    for (const [name, real] of original) fs[name] = real;
    syncBuiltinESMExports();
  } };
}
const difference = (after, before) => Object.fromEntries(Object.keys(after).map(k => [k, after[k] - before[k]]));

async function makeArm(arm, corpus) {
  const { PathFilter } = await import('../src/pathfilter.ts');
  const { ScopeAccessPolicy } = await import('../src/scope-access.ts');
  const filter = new PathFilter(), access = new ScopeAccessPolicy({ commandCenterId: 'synthetic' });
  const allowed = path => filter.isAllowed(path) && access.canAccessPhysicalPath(path);
  if (arm === 'preservation') {
    const { SearchService } = await import('../src/search.ts');
    const { FileSystemService } = await import('../src/filesystem.ts');
    const { DocumentResourceReader } = await import('../src/document-resource.ts');
    const { DocumentIndex } = await import('../src/document-index.ts');
    const { DocumentService } = await import('../src/document-service.ts');
    // Explicit empty cacheDir prevents inherited host cache configuration.
    const search = new SearchService(corpus, filter, undefined, undefined, '');
    const documents = new DocumentService(new DocumentIndex(
      new DocumentResourceReader(new FileSystemService(corpus), filter, access)));
    return {
      search: query => search.search({ query, canAccessPath: allowed, includeRevisions: true,
        limit: TOP_K, maxChars: SEARCH_CHARS }),
      read: hit => documents.read({ path: hit.p, expectedRevision: hit.rv,
        startLine: hit.ln, endLine: hit.ln + 1, mode: 'exact', maxChars: READ_CHARS }),
      invalidate: path => search.invalidate(path),
      close: async () => { documents.index.close(); await search.close(); },
    };
  }
  // Vanilla: streaming directory traversal; one file body at a time. Match all
  // query terms with OR semantics, retain bounded scored hits, reread selections.
  async function* paths(directory, prefix = '') {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error('Unexpected synthetic symlink');
      if (entry.isDirectory()) {
        // Directory ACL pruning is permitted for this fixed public-reader scope.
        if (allowed(path)) yield* paths(join(directory, entry.name), `${path}/`);
      } else if (entry.isFile() && path.endsWith('.md') && allowed(path)) yield path;
    }
  }
  return {
    search: async query => {
      const terms = query.toLowerCase().split(/\s+/), hits = [];
      for await (const path of paths(corpus)) {
        const raw = await fs.readFile(join(corpus, path), 'utf8');
        const lines = raw.split('\n'); let ln = 0, score = 0;
        for (let i = 0; i < lines.length; i++) {
          const matches = terms.filter(t => lines[i].toLowerCase().includes(t)).length;
          if (matches) { if (!ln) ln = i + 1; score += matches; }
        }
        if (score) {
          hits.push({ p: path, ln, rv: sha256(raw), score });
          hits.sort((a, b) => b.score - a.score || a.p.localeCompare(b.p));
          if (hits.length > TOP_K) hits.pop();
        }
      }
      while (JSON.stringify(hits).length > SEARCH_CHARS) hits.pop();
      return hits;
    },
    read: async hit => {
      if (!allowed(hit.p) || !/^public\/note-\d{5}\.md$/.test(hit.p)) throw new Error('Vanilla read access denied');
      const raw = await fs.readFile(join(corpus, hit.p), 'utf8'), revision = sha256(raw);
      if (revision !== hit.rv) throw new Error('Stale vanilla revision');
      const lines = raw.split('\n');
      const startOffset = lines.slice(0, hit.ln - 1).reduce((n, line) => n + line.length + 1, 0);
      const endOffset = Math.min(raw.length, startOffset + lines.slice(hit.ln - 1, hit.ln + 1).join('\n').length);
      const result = { path: hit.p, revision, parts: [{ startOffset, endOffset, text: raw.slice(startOffset, endOffset) }] };
      if (JSON.stringify(result).length > READ_CHARS) throw new Error('Vanilla selective read exceeded budget');
      return result;
    },
    invalidate: () => {}, close: async () => {},
  };
}

async function runWorker({ base, root, token, size, arm }) {
  if (!['preservation', 'vanilla'].includes(arm) || ![100, 1000, 10000].includes(size)
    || !isOwnedFixture(base, root, root) || await fs.realpath(root) !== root
    || await fs.readFile(join(root, '.owner'), 'utf8') !== token) throw new Error('Invalid owned synthetic fixture');
  const corpus = join(root, 'corpus'), io = instrumentReads(corpus);
  const peak = { rssBytes: 0, heapUsedBytes: 0, externalBytes: 0, arrayBuffersBytes: 0, samples: 0 };
  const sample = () => {
    const m = process.memoryUsage(); peak.samples++;
    for (const key of ['rss', 'heapUsed', 'external', 'arrayBuffers']) peak[`${key}Bytes`] = Math.max(peak[`${key}Bytes`], m[key]);
  };
  sample(); const timer = setInterval(sample, 100);
  const phase = async fn => {
    const before = io.snapshot(), start = performance.now();
    const value = await fn(); sample();
    return { elapsedMs: performance.now() - start, io: difference(io.snapshot(), before), value };
  };
  let service;
  try {
    const startup = await phase(async () => { service = await makeArm(arm, corpus); });
    // Public API bootstrap forces lazy initialization. This measured no-result
    // probe is explicit; no private/test-only production method is called.
    const initialization = await phase(() => service.search('bootstrapabsent'));
    let pinnedHit;
    const changedQuery = row(Math.floor(size / 2) + 1).query;
    const query = async q => {
      let inputChars = 0, outputChars = 0, calls = 0;
      const result = await phase(async () => {
        inputChars += JSON.stringify({ query: q.query, limit: TOP_K, maxChars: SEARCH_CHARS }).length; calls++;
        const hits = await service.search(q.query); outputChars += JSON.stringify(hits).length;
        if (!pinnedHit && q.query === changedQuery) pinnedHit = hits[0];
        if (hits.length > TOP_K || JSON.stringify(hits).length > SEARCH_CHARS) throw new Error('Search output bound exceeded');
        const evidence = [];
        for (const hit of hits) {
          if (!Number.isInteger(hit.ln) || !/^[a-f0-9]{64}$/.test(hit.rv)) throw new Error('Missing exact search locator/revision');
          inputChars += JSON.stringify({ path: hit.p, expectedRevision: hit.rv, startLine: hit.ln, endLine: hit.ln + 1,
            mode: 'exact', maxChars: READ_CHARS }).length; calls++;
          const read = await service.read(hit); outputChars += JSON.stringify(read).length;
          if (JSON.stringify(read).length > READ_CHARS) throw new Error('Read output bound exceeded');
          evidence.push(read);
        }
        return gradeEvidence(q.expected, evidence, hits.map(h => h.p), JSON.stringify({ hits, evidence }));
      });
      return { id: q.id, question: q.question, query: q.query, elapsedMs: result.elapsedMs, io: result.io,
        calls: { retrieval: calls, model: 0 }, quality: result.value,
        proxy: { unit: 'UTF-16 characters; NOT tokens', requestChars: inputChars, responseChars: outputChars },
        ...unavailableMetrics() };
    };
    const cold = [], warm = [];
    for (const q of questions(size)) cold.push(await query(q));
    for (const q of questions(size)) warm.push(await query(q));
    const updated = row(Math.floor(size / 2) + 1, 2);
    const incrementalWrite = await phase(async () => {
      await fs.writeFile(join(corpus, updated.path), updated.raw);
      service.invalidate(updated.path);
    });
    const staleRead = await phase(async () => {
      if (!pinnedHit) throw new Error('No retrieved hit available for stale-read check');
      try { await service.read(pinnedHit); return false; }
      catch (error) { if (/stale.*revision|stale document revision/i.test(String(error))) return true; throw error; }
    });
    const incrementalMaintenance = await phase(() => service.search('bootstrapafterchangeabsent'));
    const incremental = [];
    for (const q of questions(size, true)) incremental.push(await query(q));
    const close = await phase(() => service.close()); service = undefined;
    const strip = p => ({ elapsedMs: p.elapsedMs, io: p.io });
    return { arm, pid: process.pid, ...unavailableMetrics(), startup: strip(startup),
      initializationProbe: { ...strip(initialization), retrievalCalls: 1 }, cold, warm,
      incrementalWrite: { ...strip(incrementalWrite), logicalWriteBytes: Buffer.byteLength(updated.raw) },
      staleReadProbe: { ...strip(staleRead), rejected: staleRead.value, retrievalCalls: 1 },
      incrementalMaintenanceProbe: { ...strip(incrementalMaintenance), retrievalCalls: 1 }, incremental, teardown: strip(close),
      processMaxRssBytes: process.resourceUsage().maxRSS * 1024, memorySamples: peak,
      pass: staleRead.value && [...cold, ...warm, ...incremental].every(q => q.quality.pass) };
  } finally {
    try { await service?.close(); } finally { clearInterval(timer); io.restore(); }
  }
}

function assertMemoryStart() {
  if (freemem() < START_FREE) throw new Error('RAM preflight blocked: requires >=3.25 GiB free');
}

export const isLocalFixedDrive = type => type === 'Fixed';

// Pure lexical admission: in particular, do NOT realpath an environment temp
// directory before rejecting UNC, device namespaces and ambiguous paths.
function lexicalTempPath(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 1024 || raw !== raw.trim()
    || /[\x00-\x1f\x7f]/.test(raw) || /^[\\/]{2}/.test(raw) || /^[\\/]\?\?[\\/]/.test(raw)) {
    throw new Error('Synthetic temp path must be local; UNC/device paths are forbidden');
  }
  const api = process.platform === 'win32' ? win32 : posix;
  if (process.platform === 'win32' ? !/^[a-z]:[\\/]/i.test(raw) : !raw.startsWith('/')) {
    throw new Error('Synthetic temp path must be an absolute local path');
  }
  const root = api.parse(raw).root;
  const tail = raw.slice(root.length).replace(/[\\/]$/, '');
  const segments = tail ? tail.split(process.platform === 'win32' ? /[\\/]/ : /\//) : [];
  if (segments.length > 64 || segments.some(part => !part || part === '.' || part === '..'
    || (process.platform === 'win32' && (/[<>:"|?*]/.test(part) || /[. ]$/.test(part)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))))) {
    throw new Error('Synthetic temp path contains ambiguous or unsupported components');
  }
  return { api, path: api.join(root, ...segments), root: api.normalize(root), segments };
}

// This command is constant. Only a validated drive root (e.g. C:\) is passed
// through the environment; no raw temp path is interpolated or queried here.
// DriveType reads drive classification, not remote directory/volume contents.
const DRIVE_TYPE_COMMAND = String.raw`
$ErrorActionPreference = 'Stop'
$driveRoot = $env:MCPVAULT_BENCHMARK_DRIVE_ROOT
if ($driveRoot -notmatch '^[A-Za-z]:\\$') { exit 2 }
$drive = [System.IO.DriveInfo]::new($driveRoot)
[Console]::Out.Write($drive.DriveType.ToString())
`;

async function windowsDriveType(driveRoot) {
  if (!/^[a-z]:\\$/i.test(driveRoot)) throw new Error('Invalid local temp drive root');
  assertMemoryStart();
  return new Promise((resolveType, reject) => {
    const child = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', DRIVE_TYPE_COMMAND], {
        cwd: REPO, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, MCPVAULT_BENCHMARK_DRIVE_ROOT: driveRoot },
      });
    let stdout = '', stderr = '', failure;
    const stop = error => { if (!failure) { failure = error; killOwnedTree(child); } };
    const interrupt = () => stop(new Error('Temp drive admission interrupted'));
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    const timer = setTimeout(() => stop(new Error('Temp drive admission exceeded 5 seconds')), 5000);
    const monitor = setInterval(() => {
      if (freemem() < STOP_FREE) stop(new Error('RAM guard stopped own temp drive probe'));
    }, 100);
    child.stdout.on('data', data => {
      if (Buffer.byteLength(stdout) + data.length > 128) { stop(new Error('Temp drive probe output exceeded bound')); return; }
      stdout += data.toString();
    });
    child.stderr.on('data', data => {
      if (Buffer.byteLength(stderr) + data.length > 512) { stop(new Error('Temp drive probe stderr exceeded bound')); return; }
      stderr += data.toString();
    });
    child.once('error', error => { failure = error; });
    child.once('close', code => {
      clearTimeout(timer); clearInterval(monitor);
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
      if (failure || code !== 0) { reject(failure || new Error(`Temp drive admission failed (${code}): ${stderr}`)); return; }
      resolveType(stdout.trim());
    });
  });
}

async function admittedTempDirectory(raw) {
  const lexical = lexicalTempPath(raw); // Must remain before ALL fs/probe calls.
  if (process.platform === 'win32' && !isLocalFixedDrive(await windowsDriveType(lexical.root))) {
    throw new Error('Synthetic temp drive must be local Fixed; network/mapped and other drive types are forbidden');
  }
  // Inspect root-to-leaf without following the current component. Following a
  // child is permitted only after its lexical parent was checked. Node lstat
  // reports Windows junctions as symbolic links. Do not normalize away '..'.
  let current = lexical.root;
  const ancestors = [current];
  for (const segment of lexical.segments) { current = lexical.api.join(current, segment); ancestors.push(current); }
  for (const ancestor of ancestors) {
    const info = await fs.lstat(ancestor);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Synthetic temp ancestors must be directories without symlinks/junctions');
  }
  const canonical = lexicalTempPath(await fs.realpath(lexical.path)).path;
  const equal = process.platform === 'win32'
    ? canonical.toLowerCase() === lexical.path.toLowerCase() : canonical === lexical.path;
  if (!equal) throw new Error('Synthetic temp canonical confinement changed or contains an alias');
  return canonical;
}

function killOwnedTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill('SIGKILL'));
    killer.on('close', code => { if (code !== 0) child.kill('SIGKILL'); });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}

async function spawnArm(payload, signal) {
  assertMemoryStart();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^MCPVAULT_|^NODE_OPTIONS$|^NODE_PATH$|^TSX_/i.test(key)));
  env.TSX_DISABLE_CACHE = '1';
  const start = performance.now();
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', SELF, '--internal-worker'], {
      cwd: REPO, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let stdout = '', stderr = '', failure, freeMin = freemem(), freeSamples = 0;
    const stop = error => { if (!failure) { failure = error; killOwnedTree(child); } };
    const abort = () => stop(new Error('Synthetic benchmark interrupted'));
    signal.addEventListener('abort', abort, { once: true });
    const monitor = setInterval(() => {
      const free = freemem(); freeMin = Math.min(freeMin, free); freeSamples++;
      if (free < STOP_FREE) stop(new Error('RAM guard stopped own worker tree: free memory below 3.125 GiB'));
    }, 100);
    const timeout = setTimeout(() => stop(new Error('Synthetic arm timeout')), TIMEOUT_MS);
    child.stdout.on('data', data => {
      if (Buffer.byteLength(stdout) + data.length > MAX_OUTPUT) { stop(new Error('Worker output exceeded 256 KiB')); return; }
      stdout += data.toString();
    });
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(0, MAX_ERROR); });
    child.once('error', error => { failure = error; });
    child.once('close', code => {
      clearInterval(monitor); clearTimeout(timeout); signal.removeEventListener('abort', abort);
      if (failure || code !== 0) { reject(failure || new Error(`Worker failed (${code}): ${stderr}`)); return; }
      try { resolveRun({ ...JSON.parse(stdout), processWallMs: performance.now() - start,
        supervisorFreeMemory: { minimumBytes: freeMin, samples: freeSamples, intervalMs: 100 }, stderr: stderr || null }); }
      catch (error) { reject(error); }
    });
    if (signal.aborted) abort();
    else child.send(payload, error => { if (error) stop(error); });
  });
}

async function cleanup(base, root, token) {
  const target = await fs.realpath(root);
  if (!isOwnedFixture(base, root, target) || target !== root
    || (await fs.lstat(root)).isSymbolicLink() || await fs.readFile(join(root, '.owner'), 'utf8') !== token) {
    throw new Error('Refusing cleanup: owned fixture identity changed');
  }
  let entries = 0;
  async function verify(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (++entries > 11020) throw new Error('Cleanup inspection budget exceeded');
      const path = join(directory, entry.name), info = await fs.lstat(path);
      if (info.isSymbolicLink() || (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))) throw new Error('Refusing cleanup of linked/special fixture entry');
      if (info.isDirectory()) await verify(path);
    }
  }
  await verify(target);
  await fs.rm(target, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
}

export async function runBenchmark(options) {
  // Revalidate programmatic callers too; never accept a fixture path.
  if (!options || Object.keys(options).some(k => !['size', 'smoke'].includes(k))
    || ![100, 1000, 10000].includes(options.size) || typeof options.smoke !== 'boolean'
    || (options.smoke && options.size !== 100)) throw new Error('Invalid synthetic arguments');
  assertMemoryStart();
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  const base = await admittedTempDirectory(tmpdir());
  const root = await fs.mkdtemp(fixturePath(base, '')), token = randomUUID();
  let marked = false;
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const guard = setInterval(() => { if (freemem() < STOP_FREE) controller.abort(); }, 100);
  try {
    await fs.writeFile(join(root, '.owner'), token, { flag: 'wx' }); marked = true;
    const creationStart = performance.now(), corpus = join(root, 'corpus');
    await fs.mkdir(join(corpus, 'public'), { recursive: true });
    await fs.mkdir(join(corpus, '_scopes/users/other'), { recursive: true });
    const digest = createHash('sha256'); let corpusBytes = 0;
    for (let i = 0; i < options.size; i++) {
      if (controller.signal.aborted) throw new Error('RAM guard or interruption during fixture creation');
      const record = row(i); digest.update(record.path + '\0' + record.raw); corpusBytes += Buffer.byteLength(record.raw);
      await fs.writeFile(join(corpus, record.path), record.raw, { flag: 'wx' });
    }
    const creationMs = performance.now() - creationStart;
    const results = [];
    for (const arm of ['vanilla', 'preservation']) {
      if (controller.signal.aborted) throw new Error('RAM guard or interruption before worker launch');
      const original = row(Math.floor(options.size / 2) + 1);
      await fs.writeFile(join(corpus, original.path), original.raw);
      results.push(await spawnArm({ base, root, token, size: options.size, arm }, controller.signal));
    }
    return { benchmark: 'SYNTHETIC local retrieval comparison', version: 1, ...options, node: process.version,
      corpus: { sha256: digest.digest('hex'), documents: options.size, publicDocuments: options.size * 0.9,
        privateDocuments: options.size * 0.1, bytes: corpusBytes, creationMs },
      bounds: { topK: TOP_K, searchChars: SEARCH_CHARS, readChars: READ_CHARS, timeoutPerArmMs: TIMEOUT_MS,
        outputBytesPerArm: MAX_OUTPUT, ramStartBytes: START_FREE, ramStopBytes: STOP_FREE },
      ...unavailableMetrics(), results, pass: results.every(r => r.pass),
      methodology: [
        'Same deterministic corpus, questions, public-reader ACL, current revisions and null model; independent sequential Node processes, vanilla first.',
        'Cold means first question pass AFTER separately measured lazy index bootstrap; warm repeats in-process. OS disk cache is not flushed.',
        'Startup includes source imports/construction; processWallMs also includes Node/tsx bootstrap and IPC. Initialization probe includes one no-result search.',
        'One identical source rewrite per arm; invalidation/write and maintenance probe separate from post-change queries. No durable index cache is configured.',
        'Logical reads: instrumented fs.promises.readFile/open/FileHandle.read/readFile under corpus. Successful read bytes may include repeated verification/EOF calls; metadata attempts also counted.',
        'Does not count OS physical IO, SMB/NAS bytes, module loads, sync/callback/stream IO, kernel directory traffic or physical cache writes. Model tokens and model answer quality are not measured.',
        'Vanilla scans accessible files one body at a time with OR lexical matching and bounded top-K, then revision-checks and returns selected lines; no all-document prompt.',
        'Marker recall/exact-revision slice precision are retrieval correctness gates, not semantic answer quality. Synthetic unique identifiers are a limited workload.',
        'Process maxRSS includes runtime; 100ms samples and free-memory guard can miss peaks and are NOT an OS hard memory bound. No cost advantage claim.',
      ] };
  } finally {
    clearInterval(guard); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    if (marked) await cleanup(base, root, token);
    else if (isOwnedFixture(base, root, await fs.realpath(root))) await fs.rmdir(root);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  if (process.argv.length === 3 && process.argv[2] === '--internal-worker' && process.send) {
    process.once('message', async payload => {
      try { assertMemoryStart(); process.stdout.write(JSON.stringify(await runWorker(payload))); }
      catch (error) { process.stderr.write(String(error.stack || error).slice(0, MAX_ERROR)); process.exitCode = 1; }
      finally { process.disconnect(); }
    });
  } else {
    try {
      const report = await runBenchmark(parseArgs(process.argv.slice(2)));
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      if (!report.pass) process.exitCode = 1;
    } catch (error) { process.stderr.write(String(error.stack || error).slice(0, MAX_ERROR) + '\n'); process.exitCode = 1; }
  }
}
