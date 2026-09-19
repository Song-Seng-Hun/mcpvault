import { randomBytes } from 'node:crypto';
import { hash, id, normalizeFeedback, text, unavailable } from './policy.js';
const escape = (v) => String(v).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x]);
const TTL = 10 * 60 * 1000;
/** A bounded direct-review surface, not an operator grant, model tool or OS isolation boundary. */
export class EvolutionDirectReview {
    storage;
    deps;
    now;
    tail = Promise.resolve();
    sessions = new Map();
    closed = false;
    excerpts = new Map();
    constructor(storage, deps, now = Date.now) {
        this.storage = storage;
        this.deps = deps;
        this.now = now;
    }
    key(a, kind, value = '') { return hash(['direct-review-v1', a.accountId, kind, value]); }
    async serial(a, work) {
        const run = this.tail.then(async () => {
            if (this.closed || !(await this.storage.refresh()).enabled || !this.storage.records)
                return unavailable();
            await a.assert();
            const lock = await this.storage.acquire();
            try {
                await lock.assertHeld();
                const result = await work();
                await lock.assertHeld();
                await a.assert();
                return result;
            }
            finally {
                await lock.close();
            }
        });
        this.tail = run.catch(() => undefined);
        return run;
    }
    async prepareEffect(token, args) {
        for (const [key, value] of this.excerpts)
            if (value.expires <= this.now())
                this.excerpts.delete(key);
        if (this.excerpts.size >= 64)
            return unavailable();
        if (args.responseSource !== 'agent_report')
            return unavailable();
        const excerpt = text(args.responseExcerpt, 4000), feedback = await this.deps.inspectEffect(token, args);
        const effect = { cycleId: id(args.cycleId), expectedRevision: String(args.expectedRevision), deliveryToken: String(args.deliveryToken), responseHash: hash(excerpt) };
        const result = await this.prepareRecord(token, args.requestId, feedback, effect);
        this.excerpts.set(result.reviewId, { text: excerpt, expires: this.now() + TTL });
        return result;
    }
    async prepare(token, args) {
        const normalized = normalizeFeedback(args.feedback);
        if (normalized.target.kind !== 'persona' || normalized.scope.kind !== 'project' || normalized.key !== 'ordering'
            || normalized.value !== 'outcome_first' || normalized.signal !== 'explicit' || args.expectedRevision !== 'missing')
            return unavailable();
        return this.prepareRecord(token, args.requestId, args.feedback);
    }
    async prepareRecord(token, requestId, raw, effect) {
        const a = await this.deps.actor(token, true), feedback = structuredClone(raw);
        const reviewId = `review-${hash([a.accountId, id(requestId)]).slice(0, 40)}`, fingerprint = hash([feedback, effect ?? null]);
        await this.serial(a, async () => {
            const key = this.key(a, 'review', reviewId), r = await this.storage.records.read(key);
            if (r.value !== undefined) {
                const prior = r.value;
                if (prior.fingerprint !== fingerprint || prior.authority !== a.authority || prior.expires <= this.now() || prior.state !== 'pending')
                    return unavailable();
            }
            else
                await this.storage.records.write(key, { version: 1, accountId: a.accountId, authority: a.authority, id: reviewId,
                    fingerprint, expires: this.now() + TTL, state: 'pending', feedback, ...(effect && { effect }) }, r.revision, a.assert);
            const indexKey = this.key(a, 'index'), index = await this.storage.records.read(indexKey);
            const ids = index.value?.ids ?? [];
            if (!Array.isArray(ids) || ids.length > 128)
                return unavailable();
            if (!ids.includes(reviewId)) {
                if (ids.length >= 128)
                    throw Error('Review index full; retain evidence for host archival');
                await this.storage.records.write(indexKey, { version: 1, ids: [...ids, reviewId] }, index.revision, a.assert);
            }
        });
        return { status: 'awaiting_direct_review', reviewId, expiresInSeconds: 600,
            reviewPath: '/evolution/review', notice: 'Existing account login required. User must confirm; agent must not click. No application or effect is certified.' };
    }
    async pending(token) {
        const a = await this.deps.actor(token, false), index = await this.storage.records.read(this.key(a, 'index'));
        const ids = index.value?.ids ?? [];
        if (!Array.isArray(ids) || ids.length > 128)
            return unavailable();
        const items = [];
        for (const reviewId of ids.slice(-16)) {
            const r = await this.storage.records.read(this.key(a, 'review', id(reviewId))), v = r.value;
            if (!v || v.version !== 1 || v.accountId !== a.accountId)
                return unavailable();
            if (v.state === 'pending' && v.authority === a.authority && v.expires > this.now())
                items.push(v);
        }
        await a.assert();
        return items;
    }
    async confirm(token, reviewId) {
        const a = await this.deps.actor(token, true), key = this.key(a, 'review', id(reviewId));
        const review = await this.serial(a, async () => {
            const r = await this.storage.records.read(key), v = r.value;
            if (!v || v.version !== 1 || v.accountId !== a.accountId || v.authority !== a.authority
                || v.state !== 'pending' || v.expires <= this.now() || v.fingerprint !== hash([v.feedback, v.effect ?? null]))
                return unavailable();
            if (v.effect && hash(this.excerpts.get(v.id)?.text) !== v.effect.responseHash)
                return unavailable();
            await this.storage.records.write(key, { ...v, state: 'consuming' }, r.revision, a.assert);
            return v;
        });
        // Consume before calling the owner service. A crash stays uncertain, never replays an approval.
        const result = review.effect ? await this.deps.recordEffect(token, review) : await this.deps.record(token, review);
        await this.serial(a, async () => {
            const r = await this.storage.records.read(key), v = r.value;
            if (v.state !== 'consuming' || v.fingerprint !== review.fingerprint)
                return unavailable();
            await this.storage.records.write(key, { ...v, state: 'recorded' }, r.revision, a.assert);
        });
        this.excerpts.delete(review.id);
        return result;
    }
    async handle(req, res) {
        res.setHeader('cache-control', 'no-store');
        res.setHeader('referrer-policy', 'no-referrer');
        res.setHeader('content-security-policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
        res.setHeader('x-content-type-options', 'nosniff');
        const send = (status, body) => { res.statusCode = status; res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(body); };
        const secure = Boolean(req.socket.encrypted), host = req.headers.host;
        const localPort = req.socket.localPort;
        if (this.closed || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
            || ![`127.0.0.1:${localPort}`, `localhost:${localPort}`, `[::1]:${localPort}`].includes(host ?? '')
            || req.url !== '/evolution/review')
            return send(403, 'Review unavailable');
        const origin = `${secure ? 'https' : 'http'}://${host}`;
        if (req.method !== 'GET' && (req.method !== 'POST' || req.headers.origin !== origin
            || !String(req.headers['content-type']).startsWith('application/x-www-form-urlencoded')))
            return send(403, 'Review unavailable');
        if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site'])))
            return send(403, 'Review unavailable');
        for (const [key, value] of this.sessions)
            if (value.expires <= this.now()) {
                this.sessions.delete(key);
                if (value.token)
                    await this.deps.logout(value.token).catch(() => { });
            }
        let cookie = /(?:^|;\s*)mcpvault_review=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
        let session = cookie ? this.sessions.get(cookie) : undefined;
        if (!session) {
            if (req.method !== 'GET' || this.sessions.size >= 32)
                return send(403, 'Review unavailable');
            cookie = randomBytes(32).toString('hex');
            session = { csrf: randomBytes(32).toString('hex'), expires: this.now() + TTL, displayed: new Map() };
            this.sessions.set(cookie, session);
            res.setHeader('set-cookie', `mcpvault_review=${cookie}; HttpOnly; SameSite=Strict; Path=/evolution/review; Max-Age=600${secure ? '; Secure' : ''}`);
        }
        try {
            if (!(await this.storage.refresh()).enabled)
                return send(403, 'Review unavailable');
            if (req.method === 'POST') {
                let body = '';
                for await (const chunk of req) {
                    body += chunk.toString();
                    if (Buffer.byteLength(body) > 8192)
                        return send(413, 'Request too large');
                }
                const form = new URLSearchParams(body);
                if ([...form.keys()].some((k, i, all) => all.indexOf(k) !== i) || form.get('csrf') !== session.csrf)
                    return send(403, 'Review unavailable');
                if (form.get('action') === 'login') {
                    if (session.token)
                        return send(409, 'Already signed in');
                    session.token = await this.deps.login(String(form.get('accountId')), String(form.get('password')));
                }
                else if (form.get('action') === 'confirm' && session.token) {
                    const reviewId = String(form.get('reviewId')), pending = (await this.pending(session.token)).find(v => v.id === reviewId);
                    if (!pending || session.displayed.get(reviewId) !== pending.fingerprint)
                        return send(409, 'Display the current review before confirming.');
                    session.displayed.delete(reviewId);
                    await this.confirm(session.token, reviewId);
                    return send(200, pending.effect ? 'Direct user confirmation recorded for one next-use sample. This is not independent model evaluation.'
                        : 'Correction recorded. Not applied or effect-verified. Close this page; withdraw through evolution.feedback if needed.');
                }
                else if (form.get('action') === 'logout' && session.token) {
                    await this.deps.logout(session.token);
                    this.sessions.delete(cookie);
                    return send(200, 'Signed out.');
                }
                else
                    return send(403, 'Review unavailable');
            }
            const csrf = `<input type="hidden" name="csrf" value="${session.csrf}">`;
            const form = (body) => `<form method="post" action="/evolution/review">${csrf}${body}</form>`;
            const pending = session.token ? await this.pending(session.token) : [];
            session.displayed = new Map(pending.map(v => [v.id, v.fingerprint]));
            const content = !session.token ? form('<input type="hidden" name="action" value="login"><label>Existing account <input name="accountId" required autocomplete="username"></label><label>Password <input type="password" name="password" required autocomplete="current-password"></label><button>Sign in</button>')
                : pending.map(v => `<section><pre>${escape(JSON.stringify({ scope: v.feedback.scope, correction: { key: v.feedback.key, value: v.feedback.value }, summary: v.feedback.summary }, null, 2))}</pre>${v.effect ? `<p>Agent-reported excerpt, not independently captured. Confirm only if this is the actual response in a distinct later task and session, it used the shown preference, and the target correction succeeded. One sample is not a general guarantee.</p><pre>${escape(this.excerpts.get(v.id)?.text ?? 'Excerpt expired; do not confirm')}</pre>` : ''}${form(`<input type="hidden" name="action" value="confirm"><input type="hidden" name="reviewId" value="${escape(v.id)}"><button>${v.effect ? 'I confirm actual next-session use and the correction result' : 'I confirm this project-only correction'}</button>`)}</section>`).join('')
                    + form('<input type="hidden" name="action" value="logout"><button>Sign out</button>');
            send(200, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Direct correction review</title><h1>Direct correction review</h1><p>User action only. No new permissions. This records a preference, not application or improved behavior. Withdraw with evolution.feedback.</p>${content}</html>`);
        }
        catch {
            send(409, 'Review unavailable, expired, changed or already consumed. Inspect the feedback record before retrying.');
        }
    }
    async close() { this.closed = true; await this.tail; for (const s of this.sessions.values())
        if (s.token)
            await this.deps.logout(s.token).catch(() => { }); this.sessions.clear(); this.excerpts.clear(); }
}
