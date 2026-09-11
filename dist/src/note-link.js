import { guidanceError } from './guidance-runtime.js';
import { parseWikiLink } from './wikilink/resolveWikiLink.js';
import { isModerationHidden } from './moderation-policy.js';
import { resolveEvidenceLocator } from './evidence-locator.js';
import { bodyStartLine } from './retrieval-service.js';
import { endpointIdForTool } from './endpoint-registry.js';
const MAX_BYTES = 8 * 1024 * 1024;
const unavailable = () => guidanceError(new Error('Link target unavailable or changed; search_notes for a current exact path'), 'guid-54aca9f4d78c4a15');
function parse(input) {
    if (typeof input !== 'string' || !input.trim() || input.length > 1000)
        throw guidanceError(new Error('Invalid wiki-link syntax: provide a bounded document link'), 'guid-0a0192ff556b0e9c');
    const parsed = parseWikiLink(input);
    let text = input.trim();
    if (text.startsWith('[['))
        text = text.slice(2).replace(/\\\|/g, '|');
    if (text.endsWith(']]'))
        text = text.slice(0, -2);
    text = text.split('|', 1)[0];
    const index = text.indexOf('#'), fragment = index < 0 ? undefined : text.slice(index + 1).trim();
    if (fragment === '')
        throw guidanceError(new Error('Invalid wiki-link syntax: empty fragment'), 'guid-7a7f9e39e58d55ca');
    return { document: parsed.document, fragment: fragment === undefined ? undefined : fragment.startsWith('^') ? { blockId: fragment.slice(1) } : { heading: fragment } };
}
/** Read-only navigation. Metadata discovers; fresh source guards authorize the
 * bounded candidate list and exact body-relative locator, never a first guess.
 */
export class NoteLinkService {
    fs;
    admitted;
    publicPath;
    constructor(fs, admitted = () => true, publicPath = path => path) {
        this.fs = fs;
        this.admitted = admitted;
        this.publicPath = publicPath;
    }
    resolve(params) { return this.read(params, false); }
    legacy(params) { return this.read(params, true); }
    async read(params, legacy) {
        const maxChars = params.maxChars ?? 4000;
        if (!Number.isSafeInteger(maxChars) || maxChars < 512 || maxChars > 12000)
            throw guidanceError(new Error('maxChars must be 512..12000'), 'guid-4b78da01578248c7');
        const parsed = parse(params.document), guards = new Map(), watched = new Set();
        let changed = false;
        const dispose = this.fs.observeNoteChanges(path => { if (watched.has(this.fs.noteChangeIdentity(path)))
            changed = true; });
        const metadata = async (path) => {
            if (!this.admitted(path))
                throw unavailable();
            watched.add(this.fs.noteChangeIdentity(path));
            const note = (await this.fs.readNoteMetadata([path], this.admitted, { fresh: true, strict: true, maxBytes: MAX_BYTES }))[0];
            if (!note || !note.revision)
                return undefined;
            guards.set(path, note.revision);
            if (isModerationHidden(note.frontmatter))
                return undefined;
            return { path, revision: note.revision };
        };
        const length = (result) => JSON.stringify(result, null, params.prettyPrint ? 2 : undefined).length;
        const finish = async (result) => {
            if (length(result) > maxChars)
                throw guidanceError(new Error('maxChars too small for the pinned link action; repeat with 12000'), 'guid-81f9a33e38ef7d9a');
            for (const [path, revision] of guards)
                if (!this.admitted(path) || await this.fs.readNoteRevision(path, MAX_BYTES) !== revision)
                    throw unavailable();
            if (changed || [...guards.keys()].some(path => !this.admitted(path)))
                throw unavailable();
            return result;
        };
        try {
            if (params.sourcePath && !await metadata(params.sourcePath))
                throw unavailable();
            if (!parsed.document && !params.sourcePath)
                throw guidanceError(new Error('A same-note fragment requires sourcePath'), 'guid-3efb677e4e61ab39');
            const paths = await this.fs.findPathForWikiLink(parsed.document || params.sourcePath, this.admitted, params.sourcePath);
            const selected = params.path ? paths.filter(path => path === params.path) : paths;
            if (!selected.length)
                throw guidanceError(new Error(`No file found for [[${parsed.document}]]. Use search_notes for the correct name.`), 'guid-343f7942b7704dd4');
            let partial = false, inspected = 0;
            const targets = [];
            for (const path of selected) {
                // Hidden rows never consume the visible window or imply ambiguity.
                // An exhausted metadata budget is unknown, not a visible candidate count.
                if (++inspected > 256)
                    throw unavailable();
                const value = await metadata(path);
                if (!value)
                    continue;
                if (targets.length === 32) {
                    partial = true;
                    break;
                }
                targets.push(value);
            }
            if (!targets.length)
                throw unavailable();
            if (!legacy && (targets.length > 1 || partial)) {
                const result = { status: 'needs_selection', candidates: [], truncated: partial,
                    nextAction: { endpointId: 'notes.resolve_link', arguments: { document: params.document, ...(params.sourcePath && { sourcePath: this.publicPath(params.sourcePath) }) }, requiredArguments: ['path'] } };
                for (const target of targets) {
                    result.candidates.push({ path: this.publicPath(target.path), revision: target.revision });
                    if (length(result) > maxChars) {
                        result.candidates.pop();
                        result.truncated = true;
                        break;
                    }
                }
                return await finish(result);
            }
            const target = targets[0];
            if (params.expectedRevision !== undefined && params.expectedRevision !== target.revision)
                throw unavailable();
            const path = this.publicPath(target.path);
            const result = { status: 'resolved', document: parsed.document, path, revision: target.revision };
            if (!legacy && !parsed.fragment) {
                result.readAction = { endpointId: 'notes.read', arguments: { path, expectedRevision: target.revision, maxChars: 4000 } };
                return await finish(result);
            }
            const note = await this.fs.readNote(target.path, MAX_BYTES);
            if (note.revision !== target.revision || isModerationHidden(note.frontmatter) || !this.admitted(target.path))
                throw unavailable();
            if (!legacy) {
                const resolved = resolveEvidenceLocator(note.content, parsed.fragment, note.revision);
                if (!resolved.valid)
                    throw guidanceError(new Error(`Link fragment unavailable: ${resolved.issue}`), 'guid-9ce4cd1d68768eba');
                result.fragment = parsed.fragment;
                result.readAction = { endpointId: endpointIdForTool('read_note_lines'), arguments: { path, expectedRevision: target.revision,
                        startLine: bodyStartLine(note) + resolved.startLine - 1, endLine: bodyStartLine(note) + resolved.endLine - 1, maxChars: 4000 } };
            }
            else {
                let totalLines = 1;
                for (let i = 0; i < note.originalContent.length; i++)
                    if (note.originalContent.charCodeAt(i) === 10)
                        totalLines++;
                Object.assign(result, { deprecated: true, replacement: 'notes.resolve_link', fragmentIgnored: Boolean(parsed.fragment), truncated: false, content: '', fm: note.frontmatter });
                if (targets.length > 1)
                    result.alternatives = targets.slice(1).map(t => this.publicPath(t.path));
                result.alternativesTruncated = partial;
                // Full pinned read action is retained even if the preview ends mid-line.
                result.nextAction = { endpointId: endpointIdForTool('read_note_lines'), arguments: { path, expectedRevision: target.revision, startLine: bodyStartLine(note), endLine: totalLines, maxChars: 4000 } };
                if (length(result) > maxChars) {
                    delete result.fm;
                    result.frontmatterOmitted = true;
                }
                while (result.alternatives?.length && length(result) > maxChars) {
                    result.alternatives.pop();
                    result.alternativesTruncated = true;
                }
                let lo = 0, hi = Math.min(note.content.length, maxChars);
                while (lo < hi) {
                    const middle = Math.ceil((lo + hi) / 2);
                    result.content = note.content.slice(0, middle);
                    result.truncated = middle < note.content.length;
                    if (length(result) <= maxChars)
                        lo = middle;
                    else
                        hi = middle - 1;
                }
                // Avoid splitting a UTF-16 surrogate pair in the preview.
                if (lo && /[\uD800-\uDBFF]/.test(note.content[lo - 1]))
                    lo--;
                result.content = note.content.slice(0, lo);
                result.truncated = lo < note.content.length;
                if (!result.truncated)
                    delete result.nextAction;
            }
            return await finish(result);
        }
        finally {
            dispose();
        }
    }
}
