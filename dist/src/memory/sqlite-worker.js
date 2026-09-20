import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { openSync, closeSync } from 'node:fs';
// Internal worker only. No paths, SQL or callbacks arrive from a client endpoint.
let created = false;
try {
    closeSync(openSync(workerData.path, 'ax', 0o600));
    created = true;
}
catch (e) {
    if (e.code !== 'EEXIST')
        throw e;
}
const db = new DatabaseSync(workerData.path);
if (!created) {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
    if (['state', 'docs', 'units', 'grams', 'edges'].some(name => !tables.has(name))
        || db.prepare('SELECT version FROM state WHERE id=1').get()?.version !== 1)
        throw Error('Memory index requires explicit rebuild');
    const extension = ['graph_documents', 'graph_occurrences'].filter(name => tables.has(name));
    if (extension.length === 1)
        throw Error('Incomplete graph index extension');
}
// OS-released lock: a second process must not sweep another worker's scan.
db.exec(`PRAGMA locking_mode=EXCLUSIVE; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA cache_size=-8192;
 CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, generation INTEGER NOT NULL);
 INSERT OR IGNORE INTO state VALUES(1,1,0);
 CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, revision TEXT NOT NULL, meta TEXT NOT NULL, fingerprint TEXT NOT NULL, memory INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS units (doc INTEGER REFERENCES docs(id) ON DELETE CASCADE, role TEXT NOT NULL, observed TEXT, until_date TEXT);
 CREATE INDEX IF NOT EXISTS units_role ON units(role,doc);
 CREATE INDEX IF NOT EXISTS units_doc ON units(doc,observed);
 CREATE TABLE IF NOT EXISTS grams (gram TEXT, doc INTEGER REFERENCES docs(id) ON DELETE CASCADE, PRIMARY KEY(gram,doc)) WITHOUT ROWID;
 CREATE INDEX IF NOT EXISTS grams_doc ON grams(doc);
 CREATE TABLE IF NOT EXISTS edges (owner INTEGER REFERENCES docs(id) ON DELETE CASCADE, target TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(target,kind,owner)) WITHOUT ROWID;
 CREATE INDEX IF NOT EXISTS edges_owner ON edges(owner);
 CREATE TABLE IF NOT EXISTS graph_documents (doc INTEGER PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE, version INTEGER NOT NULL, partial INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS graph_occurrences (owner INTEGER REFERENCES docs(id) ON DELETE CASCADE, occurrence TEXT NOT NULL, target_key TEXT NOT NULL,
   relation TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(owner,occurrence)) WITHOUT ROWID;
 CREATE INDEX IF NOT EXISTS graph_reverse ON graph_occurrences(target_key,occurrence,owner);
 CREATE TABLE IF NOT EXISTS graph_names (name TEXT NOT NULL, doc INTEGER REFERENCES docs(id) ON DELETE CASCADE,
   PRIMARY KEY(name,doc)) WITHOUT ROWID;
 CREATE INDEX IF NOT EXISTS graph_names_doc ON graph_names(doc);`);
if (db.prepare('SELECT version FROM state').get()?.version !== 1)
    throw Error('Unsupported memory index schema');
// Add a covering discriminator without turning graph-only rows into a linear
// memory scan. This one-time v1 extension happens in the background worker.
// Unit triggers also maintain it if an older compatible writer opens the cache.
if (!db.prepare('PRAGMA table_info(docs)').all().some(r => r.name === 'memory')) {
    db.exec(`BEGIN IMMEDIATE; ALTER TABLE docs ADD COLUMN memory INTEGER NOT NULL DEFAULT 0;
    UPDATE docs SET memory=1 WHERE EXISTS (SELECT 1 FROM units WHERE doc=docs.id); COMMIT;`);
}
db.exec(`CREATE INDEX IF NOT EXISTS docs_memory_path ON docs(memory,path);
  CREATE TRIGGER IF NOT EXISTS memory_unit_insert AFTER INSERT ON units BEGIN UPDATE docs SET memory=1 WHERE id=NEW.doc; END;
  CREATE TRIGGER IF NOT EXISTS memory_unit_delete AFTER DELETE ON units BEGIN
    UPDATE docs SET memory=0 WHERE id=OLD.doc AND NOT EXISTS (SELECT 1 FROM units WHERE doc=OLD.doc); END;`);
const generation = () => db.prepare('SELECT generation FROM state').get().generation;
const hash = (s) => createHash('sha256').update(s).digest('hex');
const placeholders = (n) => Array(n).fill('?').join(',');
const decode = (rows, limit) => ({ notes: rows.slice(0, limit).map(r => ({ path: r.path, revision: r.revision, frontmatter: JSON.parse(r.meta) })), truncated: rows.length > limit, generation: generation() });
function pageSql(q) {
    const filters = ['d.memory=1'], values = [];
    const prefix = q.prefix === '.' ? '' : (q.prefix || '').replace(/\/$/, '');
    if (prefix) {
        filters.push('(d.path=? OR (d.path>=? AND d.path<?))');
        values.push(prefix, prefix + '/', prefix + '0');
    }
    if (q.after) {
        filters.push('d.path>?');
        values.push(q.after);
    }
    if (q.role || q.dateFrom || q.dateTo) {
        const unit = ['doc=d.id'];
        if (q.role) {
            unit.push('role=?');
            values.push(q.role);
        }
        if (q.dateFrom) {
            unit.push('observed>=?');
            values.push(q.dateFrom.slice(0, 10));
        }
        if (q.dateTo) {
            unit.push('observed<?');
            values.push(q.dateTo.slice(0, 10) + 'z');
        }
        filters.push('EXISTS (SELECT 1 FROM units WHERE ' + unit.join(' AND ') + ')');
    }
    if (q.terms?.length) {
        const terms = [...new Set(q.terms.map((t) => t.toLowerCase()))].filter(Boolean), channels = [];
        for (const term of terms) {
            const size = Math.min(3, term.length), grams = new Set();
            for (let i = 0; i <= term.length - size; i++)
                grams.add(term.slice(i, i + size));
            channels.push(`SELECT doc FROM grams WHERE gram IN (${placeholders(grams.size)}) GROUP BY doc HAVING COUNT(*)=?`);
            values.push(...grams, grams.size);
        }
        if (channels.length)
            filters.push(`d.id IN (${channels.join(' UNION ')})`);
    }
    return { sql: `SELECT d.path,d.revision,d.meta FROM docs d ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''} ORDER BY d.path LIMIT ?`, values: [...values, q.limit + 1] };
}
const insDoc = db.prepare('INSERT INTO docs(path,revision,meta,fingerprint) VALUES(?,?,?,?)');
const insUnit = db.prepare('INSERT INTO units(doc,role,observed,until_date) VALUES(?,?,?,?)');
const insGram = db.prepare('INSERT OR IGNORE INTO grams VALUES(?,?)');
const insEdge = db.prepare('INSERT OR IGNORE INTO edges VALUES(?,?,?)');
const insGraphDoc = db.prepare('INSERT INTO graph_documents VALUES(?,?,?)');
const insGraph = db.prepare('INSERT INTO graph_occurrences VALUES(?,?,?,?,?)');
const insName = db.prepare('INSERT INTO graph_names VALUES(?,?)');
const del = db.prepare('DELETE FROM docs WHERE path=?'), prior = db.prepare(`SELECT d.fingerprint,x.version,
  EXISTS (SELECT 1 FROM graph_names n WHERE n.doc=d.id) AS names_ready FROM docs d
  LEFT JOIN graph_documents x ON x.doc=d.id WHERE d.path=?`);
function graphSql(q) {
    // IN + ORDER BY previously sorted every incoming edge of every selected hub
    // before LIMIT. Bound each exact-key index walk first, then merge that window.
    // The largest prefix needed from any branch is the overall page size + 1.
    const values = [];
    const branches = q.keys.map((key) => {
        values.push(key, ...(q.after ? [q.after] : []), q.limit + 1);
        const where = q.direction === 'incoming' ? 'g.target_key=?' : 'g.owner=(SELECT id FROM docs WHERE path=?)';
        return `SELECT * FROM (SELECT g.owner,g.occurrence,g.payload FROM graph_occurrences g
      WHERE ${where}${q.after ? ' AND g.occurrence>?' : ''} ORDER BY g.occurrence LIMIT ?)`;
    });
    return { sql: `WITH window AS (${branches.join(' UNION ALL ')})
    SELECT g.occurrence,g.payload,d.path,x.partial FROM window g
    JOIN docs d ON d.id=g.owner JOIN graph_documents x ON x.doc=g.owner
    ORDER BY g.occurrence LIMIT ?`, values: [...values, q.limit + 1] };
}
db.exec('CREATE TEMP TABLE seen (path TEXT PRIMARY KEY) WITHOUT ROWID');
parentPort.on('message', ({ id, op, data }) => {
    try {
        let value;
        if (op === 'ready')
            value = undefined;
        else if (op === 'generation')
            value = generation();
        else if (op === 'beginScan')
            db.exec('DELETE FROM seen');
        else if (op === 'seen') {
            const insert = db.prepare('INSERT OR IGNORE INTO seen VALUES(?)');
            for (const path of data)
                insert.run(path);
        }
        else if (op === 'finishScan') {
            db.exec('BEGIN IMMEDIATE');
            try {
                if (db.prepare('DELETE FROM docs WHERE path NOT IN (SELECT path FROM seen)').run().changes)
                    db.exec('UPDATE state SET generation=generation+1');
                db.exec('COMMIT');
            }
            catch (e) {
                db.exec('ROLLBACK');
                throw e;
            }
        }
        else if (op === 'put' || op === 'remove') {
            db.exec('BEGIN IMMEDIATE');
            let changed = false;
            try {
                for (const r of data) {
                    if (op === 'remove') {
                        changed = Boolean(del.run(r).changes) || changed;
                        continue;
                    }
                    const fingerprint = hash(JSON.stringify(r)), previous = prior.get(r.path);
                    if (previous?.fingerprint === fingerprint && previous.version === r.graph.version && previous.names_ready)
                        continue;
                    del.run(r.path);
                    const doc = insDoc.run(r.path, r.revision, JSON.stringify(r.frontmatter), fingerprint).lastInsertRowid;
                    for (const e of r.entries)
                        insUnit.run(doc, e.role, e.observed_at || null, e.valid_until || null);
                    if (r.entries.length) {
                        const text = `${r.path}\n${JSON.stringify(r.frontmatter)}\n${r.text}`.toLowerCase(), grams = new Set();
                        // Same UTF-16 discovery as memory. Ordinary graph-only records do
                        // not replicate their whole body into an unrelated memory index.
                        for (let n = 1; n <= 3; n++)
                            for (let i = 0; i <= text.length - n; i++)
                                grams.add(text.slice(i, i + n));
                        for (const gram of grams)
                            insGram.run(gram, doc);
                    }
                    for (const edge of r.edges)
                        insEdge.run(doc, edge.target, edge.kind);
                    for (const name of r.names)
                        insName.run(name, doc);
                    insGraphDoc.run(doc, r.graph.version, Number(r.graph.partial));
                    for (const occurrence of r.graph.occurrences)
                        insGraph.run(doc, occurrence.assertion.id, occurrence.key, occurrence.assertion.relation, JSON.stringify(occurrence.assertion));
                    changed = true;
                }
                if (changed)
                    db.exec('UPDATE state SET generation=generation+1');
                db.exec('COMMIT');
            }
            catch (e) {
                db.exec('ROLLBACK');
                throw e;
            }
        }
        else if (op === 'graph' || op === 'graphExplain') {
            if (data.expectedGeneration !== undefined && data.expectedGeneration !== generation())
                throw Error('Graph generation changed');
            const q = graphSql(data);
            if (op === 'graphExplain')
                value = db.prepare('EXPLAIN QUERY PLAN ' + q.sql).all(...q.values).map((r) => r.detail);
            else {
                const rows = db.prepare(q.sql).all(...q.values), selected = rows.slice(0, data.limit);
                const missing = data.direction === 'outgoing' ? db.prepare(`SELECT d.path FROM docs d LEFT JOIN graph_documents x ON x.doc=d.id
          WHERE d.path IN (${placeholders(data.keys.length)}) AND (x.doc IS NULL OR x.partial=1 OR x.version<>2)`).all(...data.keys).map(r => r.path) : [];
                value = { occurrences: selected.map(r => JSON.parse(r.payload)), truncated: rows.length > data.limit,
                    ...(rows.length > data.limit && { next: selected.at(-1).occurrence }), generation: generation(),
                    incompleteOwners: [...new Set([...missing, ...selected.filter(r => r.partial).map(r => r.path)])], coverage: 'candidates_only' };
            }
        }
        else if (op === 'unindexedGraph') {
            value = data.length ? db.prepare(`SELECT d.path FROM docs d LEFT JOIN graph_documents x ON x.doc=d.id
        WHERE d.path IN (${placeholders(data.length)}) AND (x.doc IS NULL OR x.version<>2
          OR NOT EXISTS (SELECT 1 FROM graph_names n WHERE n.doc=d.id)) ORDER BY d.path`).all(...data).map(r => r.path) : [];
        }
        else if (op === 'references' || op === 'referencesExplain') {
            // Bound each indexed identity walk before deduplication; a popular alias
            // must not sort its entire posting list just to return a small window.
            const values = [], branches = data.keys.map((key) => {
                values.push(key, data.limit + 1);
                return 'SELECT * FROM (SELECT doc FROM graph_names WHERE name=? ORDER BY doc LIMIT ?)';
            });
            const sql = `WITH candidates AS (${branches.join(' UNION ALL ')})
        SELECT DISTINCT d.path,d.revision,d.meta FROM candidates c JOIN docs d ON d.id=c.doc ORDER BY d.path LIMIT ?`;
            values.push(data.limit + 1);
            value = op === 'referencesExplain' ? db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...values).map((r) => r.detail)
                : decode(db.prepare(sql).all(...values), data.limit);
        }
        else if (op === 'page' || op === 'explain') {
            const q = pageSql(data);
            value = op === 'explain' ? db.prepare('EXPLAIN QUERY PLAN ' + q.sql).all(...q.values).map((r) => r.detail) : decode(db.prepare(q.sql).all(...q.values), data.limit);
        }
        else if (op === 'get')
            value = decode(data.length ? db.prepare(`SELECT path,revision,meta FROM docs WHERE path IN (${placeholders(data.length)}) ORDER BY path`).all(...data) : [], 500);
        else if (op === 'dependents')
            value = decode(data.paths.length ? db.prepare(`SELECT DISTINCT d.path,d.revision,d.meta FROM edges e JOIN docs d ON d.id=e.owner WHERE e.target IN (${placeholders(data.paths.length)}) ORDER BY d.path LIMIT ?`).all(...data.paths, data.limit + 1) : [], data.limit);
        else if (op === 'close') {
            db.close();
            parentPort.postMessage({ id });
            parentPort.close();
            return;
        }
        else
            throw Error('Unsupported index operation');
        parentPort.postMessage({ id, value });
    }
    catch {
        parentPort.postMessage({ id, error: true });
    }
});
