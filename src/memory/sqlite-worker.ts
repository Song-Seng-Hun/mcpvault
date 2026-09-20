import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { openSync, closeSync } from 'node:fs';

// Internal worker only. No paths, SQL or callbacks arrive from a client endpoint.
let created = false;
try { closeSync(openSync(workerData.path, 'ax', 0o600)); created = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
const db = new DatabaseSync(workerData.path);
if (!created) {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
  if (['state', 'docs', 'units', 'grams', 'edges'].some(name => !tables.has(name))
    || (db.prepare('SELECT version FROM state WHERE id=1').get() as any)?.version !== 1) throw Error('Memory index requires explicit rebuild');
}
// OS-released lock: a second process must not sweep another worker's scan.
db.exec(`PRAGMA locking_mode=EXCLUSIVE; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA cache_size=-8192;
 CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, generation INTEGER NOT NULL);
 INSERT OR IGNORE INTO state VALUES(1,1,0);
 CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, revision TEXT NOT NULL, meta TEXT NOT NULL, fingerprint TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS units (doc INTEGER REFERENCES docs(id) ON DELETE CASCADE, role TEXT NOT NULL, observed TEXT, until_date TEXT);
 CREATE INDEX IF NOT EXISTS units_role ON units(role,doc);
 CREATE INDEX IF NOT EXISTS units_doc ON units(doc,observed);
 CREATE TABLE IF NOT EXISTS grams (gram TEXT, doc INTEGER REFERENCES docs(id) ON DELETE CASCADE, PRIMARY KEY(gram,doc)) WITHOUT ROWID;
 CREATE INDEX IF NOT EXISTS grams_doc ON grams(doc);
 CREATE TABLE IF NOT EXISTS edges (owner INTEGER REFERENCES docs(id) ON DELETE CASCADE, target TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(target,kind,owner)) WITHOUT ROWID;
 CREATE INDEX IF NOT EXISTS edges_owner ON edges(owner);`);
if ((db.prepare('SELECT version FROM state').get() as any)?.version !== 1) throw Error('Unsupported memory index schema');
const generation = () => (db.prepare('SELECT generation FROM state').get() as any).generation as number;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const placeholders = (n: number) => Array(n).fill('?').join(',');
const decode = (rows: any[], limit: number) => ({ notes: rows.slice(0, limit).map(r => ({ path: r.path, revision: r.revision, frontmatter: JSON.parse(r.meta) })), truncated: rows.length > limit, generation: generation() });
function pageSql(q: any) {
  const filters: string[] = [], values: any[] = [];
  const prefix = q.prefix === '.' ? '' : (q.prefix || '').replace(/\/$/, '');
  if (prefix) { filters.push('(d.path=? OR (d.path>=? AND d.path<?))'); values.push(prefix, prefix + '/', prefix + '0'); }
  if (q.after) { filters.push('d.path>?'); values.push(q.after); }
  if (q.role || q.dateFrom || q.dateTo) {
    const unit = ['doc=d.id'];
    if (q.role) { unit.push('role=?'); values.push(q.role); }
    if (q.dateFrom) { unit.push('observed>=?'); values.push(q.dateFrom.slice(0, 10)); }
    if (q.dateTo) { unit.push('observed<?'); values.push(q.dateTo.slice(0, 10) + 'z'); }
    filters.push('EXISTS (SELECT 1 FROM units WHERE ' + unit.join(' AND ') + ')');
  }
  if (q.terms?.length) {
    const terms = [...new Set<string>(q.terms.map((t: string) => t.toLowerCase()))].filter(Boolean), channels: string[] = [];
    for (const term of terms) {
      const size = Math.min(3, term.length), grams = new Set<string>();
      for (let i = 0; i <= term.length - size; i++) grams.add(term.slice(i, i + size));
      channels.push(`SELECT doc FROM grams WHERE gram IN (${placeholders(grams.size)}) GROUP BY doc HAVING COUNT(*)=?`);
      values.push(...grams, grams.size);
    }
    if (channels.length) filters.push(`d.id IN (${channels.join(' UNION ')})`);
  }
  return { sql: `SELECT d.path,d.revision,d.meta FROM docs d ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''} ORDER BY d.path LIMIT ?`, values: [...values, q.limit + 1] };
}
const insDoc = db.prepare('INSERT INTO docs(path,revision,meta,fingerprint) VALUES(?,?,?,?)');
const insUnit = db.prepare('INSERT INTO units(doc,role,observed,until_date) VALUES(?,?,?,?)');
const insGram = db.prepare('INSERT OR IGNORE INTO grams VALUES(?,?)');
const insEdge = db.prepare('INSERT OR IGNORE INTO edges VALUES(?,?,?)');
const del = db.prepare('DELETE FROM docs WHERE path=?'), prior = db.prepare('SELECT fingerprint FROM docs WHERE path=?');
db.exec('CREATE TEMP TABLE seen (path TEXT PRIMARY KEY) WITHOUT ROWID');
parentPort!.on('message', ({ id, op, data }) => {
  try {
    let value: unknown;
    if (op === 'ready') value = undefined;
    else if (op === 'generation') value = generation();
    else if (op === 'beginScan') db.exec('DELETE FROM seen');
    else if (op === 'seen') { const insert = db.prepare('INSERT OR IGNORE INTO seen VALUES(?)'); for (const path of data) insert.run(path); }
    else if (op === 'finishScan') {
      db.exec('BEGIN IMMEDIATE');
      try { if (db.prepare('DELETE FROM docs WHERE path NOT IN (SELECT path FROM seen)').run().changes) db.exec('UPDATE state SET generation=generation+1'); db.exec('COMMIT'); }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    }
    else if (op === 'put' || op === 'remove') {
      db.exec('BEGIN IMMEDIATE'); let changed = false;
      try {
        for (const r of data) {
          if (op === 'remove') { changed = Boolean(del.run(r).changes) || changed; continue; }
          const fingerprint = hash(JSON.stringify(r)); if ((prior.get(r.path) as any)?.fingerprint === fingerprint) continue;
          del.run(r.path); const doc = insDoc.run(r.path, r.revision, JSON.stringify(r.frontmatter), fingerprint).lastInsertRowid;
          for (const e of r.entries) insUnit.run(doc, e.role, e.observed_at || null, e.valid_until || null);
          const text = `${r.path}\n${JSON.stringify(r.frontmatter)}\n${r.text}`.toLowerCase(), grams = new Set<string>();
          // Same case-folded UTF-16 substring discovery as the existing multilingual index.
          for (let n = 1; n <= 3; n++) for (let i = 0; i <= text.length - n; i++) grams.add(text.slice(i, i + n));
          for (const gram of grams) insGram.run(gram, doc);
          for (const edge of r.edges) insEdge.run(doc, edge.target, edge.kind);
          changed = true;
        }
        if (changed) db.exec('UPDATE state SET generation=generation+1'); db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    } else if (op === 'page' || op === 'explain') {
      const q = pageSql(data); value = op === 'explain' ? db.prepare('EXPLAIN QUERY PLAN ' + q.sql).all(...q.values).map((r: any) => r.detail) : decode(db.prepare(q.sql).all(...q.values), data.limit);
    } else if (op === 'get') value = decode(data.length ? db.prepare(`SELECT path,revision,meta FROM docs WHERE path IN (${placeholders(data.length)}) ORDER BY path`).all(...data) : [], 500);
    else if (op === 'dependents') value = decode(data.paths.length ? db.prepare(`SELECT DISTINCT d.path,d.revision,d.meta FROM edges e JOIN docs d ON d.id=e.owner WHERE e.target IN (${placeholders(data.paths.length)}) ORDER BY d.path LIMIT ?`).all(...data.paths, data.limit + 1) : [], data.limit);
    else if (op === 'close') { db.close(); parentPort!.postMessage({ id }); parentPort!.close(); return; }
    else throw Error('Unsupported index operation');
    parentPort!.postMessage({ id, value });
  } catch { parentPort!.postMessage({ id, error: true }); }
});
