import { join, resolve } from 'path';
import { watch } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { generateObsidianUri } from './uri.js';
import { boundSearchResults, boundedTopK, normalizeSearchLimit, normalizeSearchMaxChars } from './search-limits.js';
import { isMarkdownModerationHidden } from './moderation-policy.js';
import { createDerivedCacheOwner, derivedCacheBudget, estimateCacheBytes } from './cache-budget.js';
import { VaultIoCoordinator } from './vault-io.js';
import { isMissingVaultPath, VaultReadUnavailableError } from './vault-read-errors.js';
import { readSnapshotBytes } from './snapshot-read.js';
import { parse as parseYaml } from 'yaml';
const WIKI_TYPES = new Set(['schema', 'source', 'knowledge', 'issue']);
const SEARCH_CACHE_TTL_MS = 5_000;
const SEARCH_CACHE_MAX_ENTRIES = 128;
const INDEX_RECONCILE_INTERVAL_MS = 60_000;
const NO_WATCHER_RECONCILE_INTERVAL_MS = 5_000;
const INDEX_READ_BATCH_SIZE = 32;
const MAX_INDEXED_TEXT_BYTES = 64 * 1024 * 1024;
const NGRAM_SIZE = 3;
const SEARCH_SNAPSHOT_FILE = '.mcpvault/search-index.snapshot.bin';
const LEGACY_SEARCH_SNAPSHOT_FILE = '.mcpvault/search-index.snapshot.gz';
const SEARCH_SNAPSHOT_VERSION = 6;
const SNAPSHOT_SAVE_DEBOUNCE_MS = 1_000;
const DIRECTORY_CACHE_TTL_MS = 5_000;
const DIRECTORY_CACHE_MAX_ENTRIES = 1_024;
const CORPUS_STATS_CACHE_MAX_ENTRIES = 64;
const GRAM_COMPACTION_MIN_ENTRIES = 4_096;
const GRAM_COMPACTION_MIN_STALE_ENTRIES = 1_024;
const GRAM_COMPACTION_STALE_RATIO = 0.25;
const MAX_SNAPSHOT_BYTES = 128 * 1024 * 1024;
const SNAPSHOT_MAGIC = Buffer.from('MCPVSRCH', 'ascii');
const MAX_SNAPSHOT_ENTRIES = 1_000_000;
const SEARCH_TOKEN_PATTERN = /"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\S+/g;
function splitScopedTerms(value) {
    return (value.match(SEARCH_TOKEN_PATTERN) || [])
        .map(unquoteSearchToken)
        .filter(term => term && term.toUpperCase() !== 'OR');
}
function unquoteSearchToken(value) {
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1).replace(/\\(["'])/g, '$1');
    }
    return value;
}
function parseSearchQuery(query) {
    const terms = [];
    const excludeTerms = [];
    const filters = {};
    // Obsidian allows section:(...) / block:(...) / task:(...) forms. Extract
    // these before tokenization so spaces inside the scoped expression survive.
    const scopedQuery = query.replace(/(?:^|\s)(section|block|task-todo|task-done|task):(?:\(([^)]*)\)|("(?:\\.|[^"])*")|('(?:\\.|[^'])*')|(\S+))/gi, (_match, rawKind, parenthesized, doubleQuoted, singleQuoted, bare) => {
        const value = parenthesized ?? doubleQuoted ?? singleQuoted ?? bare ?? '';
        const scopedTerms = splitScopedTerms(value);
        if (scopedTerms.length === 0)
            return ' ';
        const kind = String(rawKind).toLowerCase();
        if (kind === 'section')
            filters.sectionTerms = [...(filters.sectionTerms || []), ...scopedTerms];
        else if (kind === 'block')
            filters.blockTerms = [...(filters.blockTerms || []), ...scopedTerms];
        else {
            filters.taskTerms = [...(filters.taskTerms || []), ...scopedTerms];
            if (kind === 'task-todo')
                filters.taskStatus = 'open';
            if (kind === 'task-done')
                filters.taskStatus = 'completed';
        }
        terms.push(...scopedTerms);
        return ' ';
    });
    const tokenizedQuery = scopedQuery.replace(/\[([^\]]+)\]/g, (_match, body) => `[${String(body).replace(/\s+OR\s+/gi, '__MCPVAULT_OR__')}]`);
    for (const rawToken of tokenizedQuery.match(SEARCH_TOKEN_PATTERN) || []) {
        const quoted = (rawToken.startsWith('"') && rawToken.endsWith('"')) || (rawToken.startsWith("'") && rawToken.endsWith("'"));
        const token = unquoteSearchToken(rawToken);
        const bracketFilter = !quoted ? token.match(/^\[([^:\]]+)(?::([^\]]+))?\]$/) : undefined;
        const filter = !quoted && !bracketFilter ? token.match(/^(path|tag|property):(.+)$/i) : undefined;
        if (!quoted && token.startsWith('-') && token.length > 1) {
            const excluded = token.slice(1).trim();
            if (excluded)
                excludeTerms.push(unquoteSearchToken(excluded));
            continue;
        }
        if (!quoted && token.toUpperCase() === 'OR')
            continue;
        if (bracketFilter) {
            const key = bracketFilter[1].trim();
            const rawValue = bracketFilter[2] === undefined ? undefined : unquoteSearchToken(bracketFilter[2].trim()).replace(/__MCPVAULT_OR__/g, ' OR ');
            const values = rawValue?.split(/\s+OR\s+/i).map(value => value.trim()).filter(Boolean);
            const firstValue = values?.[0];
            if (key)
                filters.property = { key, ...(values?.length === 1 && firstValue ? { value: firstValue } : values?.length ? { value: values } : {}) };
            continue;
        }
        if (!filter) {
            terms.push(token);
            continue;
        }
        const kind = filter[1].toLowerCase();
        const value = unquoteSearchToken(filter[2].trim());
        if (!value) {
            terms.push(token);
        }
        else if (kind === 'path') {
            filters.pathPrefix = normalizeSubtree(value);
        }
        else if (kind === 'tag') {
            filters.tag = value.replace(/^#/, '').toLowerCase();
        }
        else {
            const equals = value.indexOf('=');
            const key = (equals === -1 ? value : value.slice(0, equals)).trim();
            if (!key)
                terms.push(token);
            else {
                const rawValue = equals === -1 ? undefined : unquoteSearchToken(value.slice(equals + 1).trim());
                const values = rawValue?.split(/\s+OR\s+/i).map(item => item.trim()).filter(Boolean);
                const firstValue = values?.[0];
                filters.property = { key, ...(values?.length === 1 && firstValue ? { value: firstValue } : values?.length ? { value: values } : {}) };
            }
        }
    }
    return { terms, excludeTerms, filters };
}
function propertyValueMatches(actual, expected) {
    if (expected === undefined)
        return actual !== undefined;
    if (Array.isArray(expected))
        return expected.some(value => propertyValueMatches(actual, value));
    if (expected.trim().toLowerCase() === 'null') {
        return actual === null || actual === undefined || actual === '';
    }
    if (Array.isArray(actual))
        return actual.some(value => propertyValueMatches(value, expected));
    if (actual === null || actual === undefined || typeof actual === 'object')
        return false;
    return String(actual).trim().toLowerCase() === expected.trim().toLowerCase();
}
function getProperty(frontmatter, key) {
    let current = frontmatter;
    for (const segment of key.split('.')) {
        if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment))
            return undefined;
        current = current[segment];
    }
    return current;
}
function parseSearchFrontmatter(value) {
    if (!value.trim())
        return undefined;
    try {
        const parsed = parseYaml(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : undefined;
    }
    catch {
        // A malformed frontmatter block should not make ordinary search fail.
        return undefined;
    }
}
function hasTag(document, tag) {
    const normalized = tag.replace(/^#/, '').toLowerCase();
    const frontmatterTags = getProperty(document.frontmatter, 'tags');
    const values = Array.isArray(frontmatterTags) ? frontmatterTags : [frontmatterTags];
    if (values.some(value => typeof value === 'string' && value.replace(/^#/, '').trim().toLowerCase() === normalized))
        return true;
    const body = `${document.body || ''}\n${document.frontmatterText || ''}`.toLowerCase();
    return new RegExp(`(?:^|[\\s(])#${normalized.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(?=$|[\\s),.!?:;])`, 'i').test(body);
}
function matchesSearchFilters(document, filters) {
    if (filters.pathPrefix && !isWithinSubtree(document.relativePath, filters.pathPrefix))
        return false;
    if (filters.tag && !hasTag(document, filters.tag))
        return false;
    if (filters.property && !propertyValueMatches(getProperty(document.frontmatter, filters.property.key), filters.property.value))
        return false;
    if (filters.sectionTerms?.length && !matchesInSection(document.body || '', filters.sectionTerms))
        return false;
    if (filters.blockTerms?.length && !matchesInBlock(document.body || '', filters.blockTerms))
        return false;
    if (filters.taskTerms?.length && !matchesInTask(document.body || '', filters.taskTerms, filters.taskStatus))
        return false;
    return true;
}
function includesAllTerms(value, terms) {
    const haystack = value.toLowerCase();
    return terms.every(term => haystack.includes(term.toLowerCase()));
}
function bodyLines(body) {
    const lines = body.split('\n').map(line => line.replace(/\r$/, ''));
    let inFence = false;
    let fenceChar = '';
    let fenceLength = 0;
    return lines.filter(line => {
        const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (fence) {
            const markers = fence[1];
            const trailing = fence[2];
            const char = markers.charAt(0);
            if (!inFence) {
                inFence = true;
                fenceChar = char;
                fenceLength = markers.length;
            }
            else if (char === fenceChar && markers.length >= fenceLength && trailing.trim() === '') {
                inFence = false;
                fenceChar = '';
                fenceLength = 0;
            }
            return false;
        }
        return !inFence;
    });
}
function matchesInBlock(body, terms) {
    return bodyLines(body).join('\n').split(/\n\s*\n/).some(block => includesAllTerms(block, terms));
}
function matchesInTask(body, terms, status) {
    return bodyLines(body).some(line => {
        const match = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
        if (!match)
            return false;
        const taskStatus = match[1].toLowerCase() === 'x' ? 'completed' : 'open';
        return (!status || status === taskStatus) && includesAllTerms(match[2], terms);
    });
}
function matchesInSection(body, terms) {
    const lines = bodyLines(body);
    const sections = [];
    let current = [];
    let currentLevel = 7;
    for (const line of lines) {
        const heading = /^(#{1,6})\s+/.exec(line);
        if (heading) {
            const level = heading[1].length;
            if (current.length > 0 && level <= currentLevel)
                sections.push(current.join('\n'));
            currentLevel = Math.min(currentLevel, level);
        }
        current.push(line);
    }
    if (current.length > 0)
        sections.push(current.join('\n'));
    if (sections.length === 0)
        sections.push(lines.join('\n'));
    return sections.some(section => includesAllTerms(section, terms));
}
function isWithinSubtree(path, prefix) {
    const normalizedPath = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
    const normalizedPrefix = prefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
    return !normalizedPrefix || normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}
function encodeSnapshotString(value) {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32LE(bytes.length, 0);
    return Buffer.concat([length, bytes]);
}
function encodeSnapshot(snapshot) {
    const chunks = [SNAPSHOT_MAGIC];
    const header = Buffer.allocUnsafe(12);
    header.writeUInt32LE(SEARCH_SNAPSHOT_VERSION, 0);
    header.writeUInt32LE(snapshot.documents.length, 4);
    header.writeUInt32LE(snapshot.grams.length, 8);
    chunks.push(header);
    for (const value of snapshot.grams)
        chunks.push(encodeSnapshotString(value));
    for (const document of snapshot.documents) {
        chunks.push(encodeSnapshotString(document.relativePath));
        chunks.push(encodeSnapshotString(document.title));
        const authorityCount = Buffer.allocUnsafe(4);
        authorityCount.writeUInt32LE(document.authorityTerms.length, 0);
        chunks.push(authorityCount);
        for (const term of document.authorityTerms)
            chunks.push(encodeSnapshotString(term));
        const authorityIdCount = Buffer.allocUnsafe(4);
        authorityIdCount.writeUInt32LE(document.authorityIds.length, 0);
        chunks.push(authorityIdCount);
        for (const term of document.authorityIds)
            chunks.push(encodeSnapshotString(term));
        const sameAsCount = Buffer.allocUnsafe(4);
        sameAsCount.writeUInt32LE(document.sameAsTerms.length, 0);
        chunks.push(sameAsCount);
        for (const term of document.sameAsTerms)
            chunks.push(encodeSnapshotString(term));
        const closeMatchCount = Buffer.allocUnsafe(4);
        closeMatchCount.writeUInt32LE(document.closeMatchTerms.length, 0);
        chunks.push(closeMatchCount);
        for (const term of document.closeMatchTerms)
            chunks.push(encodeSnapshotString(term));
        const broaderCount = Buffer.allocUnsafe(4);
        broaderCount.writeUInt32LE(document.broaderTerms.length, 0);
        chunks.push(broaderCount);
        for (const term of document.broaderTerms)
            chunks.push(encodeSnapshotString(term));
        const relatedCount = Buffer.allocUnsafe(4);
        relatedCount.writeUInt32LE(document.relatedTerms.length, 0);
        chunks.push(relatedCount);
        for (const term of document.relatedTerms)
            chunks.push(encodeSnapshotString(term));
        const cueCount = Buffer.allocUnsafe(4);
        cueCount.writeUInt32LE(document.retrievalCues.length, 0);
        chunks.push(cueCount);
        for (const cue of document.retrievalCues)
            chunks.push(encodeSnapshotString(cue));
        chunks.push(encodeSnapshotString(document.useWhen || ''));
        const flags = Buffer.from([(document.isWiki ? 1 : 0) | (document.moderationHidden ? 2 : 0)]);
        chunks.push(flags, encodeSnapshotString(document.revision));
        const numbers = Buffer.allocUnsafe(40);
        numbers.writeDoubleLE(document.size, 0);
        numbers.writeDoubleLE(document.mtimeMs, 8);
        numbers.writeUInt32LE(document.bodyLength, 16);
        numbers.writeUInt32LE(document.frontmatterLength, 20);
        numbers.writeUInt32LE(document.textBytes, 24);
        numbers.writeUInt32LE(document.bodyGramIds.length, 28);
        numbers.writeUInt32LE(document.frontmatterGramIds.length, 32);
        numbers.writeUInt32LE(document.titleGramIds.length, 36);
        chunks.push(numbers);
        for (const values of [document.bodyGramIds, document.frontmatterGramIds, document.titleGramIds]) {
            const encodedValues = Buffer.allocUnsafe(values.length * 4);
            values.forEach((value, index) => encodedValues.writeUInt32LE(value, index * 4));
            chunks.push(encodedValues);
        }
    }
    return Buffer.concat(chunks);
}
function decodeSnapshot(buffer) {
    if (buffer.length < SNAPSHOT_MAGIC.length + 12 || !buffer.subarray(0, SNAPSHOT_MAGIC.length).equals(SNAPSHOT_MAGIC))
        return undefined;
    let offset = SNAPSHOT_MAGIC.length;
    const version = buffer.readUInt32LE(offset);
    offset += 4;
    const count = buffer.readUInt32LE(offset);
    offset += 4;
    const gramCount = buffer.readUInt32LE(offset);
    offset += 4;
    if (version !== SEARCH_SNAPSHOT_VERSION || count > MAX_SNAPSHOT_ENTRIES)
        return undefined;
    const readString = () => {
        if (offset + 4 > buffer.length)
            return undefined;
        const length = buffer.readUInt32LE(offset);
        offset += 4;
        if (length > buffer.length - offset)
            return undefined;
        const value = buffer.toString('utf8', offset, offset + length);
        offset += length;
        return value;
    };
    const grams = [];
    if (gramCount > MAX_SNAPSHOT_ENTRIES)
        return undefined;
    for (let index = 0; index < gramCount; index += 1) {
        const value = readString();
        if (value === undefined)
            return undefined;
        grams.push(value);
    }
    const readGramIds = (count) => {
        if (count > MAX_SNAPSHOT_ENTRIES)
            return undefined;
        if (offset + count * 4 > buffer.length)
            return undefined;
        const values = [];
        for (let index = 0; index < count; index += 1) {
            const value = buffer.readUInt32LE(offset);
            offset += 4;
            if (value === 0 || value > grams.length)
                return undefined;
            values.push(value);
        }
        return values;
    };
    const documents = [];
    for (let index = 0; index < count; index += 1) {
        const relativePath = readString();
        const title = readString();
        if (relativePath === undefined || title === undefined || offset + 1 > buffer.length)
            return undefined;
        const readBoundedStrings = (maximum) => {
            if (offset + 4 > buffer.length)
                return undefined;
            const valueCount = buffer.readUInt32LE(offset);
            offset += 4;
            if (valueCount > maximum)
                return undefined;
            const values = [];
            for (let valueIndex = 0; valueIndex < valueCount; valueIndex += 1) {
                const value = readString();
                if (value === undefined)
                    return undefined;
                values.push(value);
            }
            return values;
        };
        const authorityTerms = readBoundedStrings(64);
        const authorityIds = readBoundedStrings(8);
        const sameAsTerms = readBoundedStrings(20);
        const closeMatchTerms = readBoundedStrings(20);
        const broaderTerms = readBoundedStrings(20);
        const relatedTerms = readBoundedStrings(20);
        if (!authorityTerms || !authorityIds || !sameAsTerms || !closeMatchTerms || !broaderTerms || !relatedTerms)
            return undefined;
        if (offset + 4 > buffer.length)
            return undefined;
        const cueCount = buffer.readUInt32LE(offset);
        offset += 4;
        if (cueCount > 8)
            return undefined;
        const retrievalCues = [];
        for (let cueIndex = 0; cueIndex < cueCount; cueIndex += 1) {
            const cue = readString();
            if (cue === undefined)
                return undefined;
            retrievalCues.push(cue);
        }
        const useWhenValue = readString();
        if (useWhenValue === undefined)
            return undefined;
        const flags = buffer[offset];
        offset += 1;
        const revisionValue = readString();
        if (revisionValue === undefined || offset + 40 > buffer.length)
            return undefined;
        const size = buffer.readDoubleLE(offset);
        const mtimeMs = buffer.readDoubleLE(offset + 8);
        const bodyLength = buffer.readUInt32LE(offset + 16);
        const frontmatterLength = buffer.readUInt32LE(offset + 20);
        const textBytes = buffer.readUInt32LE(offset + 24);
        const bodyGramCount = buffer.readUInt32LE(offset + 28);
        const frontmatterGramCount = buffer.readUInt32LE(offset + 32);
        const titleGramCount = buffer.readUInt32LE(offset + 36);
        offset += 40;
        const bodyGramIds = readGramIds(bodyGramCount);
        const frontmatterGramIds = readGramIds(frontmatterGramCount);
        const titleGramIds = readGramIds(titleGramCount);
        if (!bodyGramIds || !frontmatterGramIds || !titleGramIds)
            return undefined;
        documents.push({ relativePath, title, authorityTerms, authorityIds, sameAsTerms, closeMatchTerms, broaderTerms, relatedTerms, retrievalCues, ...(useWhenValue && { useWhen: useWhenValue }), isWiki: (flags & 1) !== 0, moderationHidden: (flags & 2) !== 0, revision: revisionValue, size, mtimeMs, bodyLength, frontmatterLength, textBytes, bodyGramIds, frontmatterGramIds, titleGramIds });
    }
    return offset === buffer.length ? { version, grams, documents } : undefined;
}
function isWikiPath(path) {
    const normalized = path.toLowerCase();
    return normalized === '_wiki'
        || normalized.startsWith('_wiki/')
        || normalized === '_sources'
        || normalized.startsWith('_sources/')
        || /^_scopes\/(models|agents)\/[^/]+\/(?:_wiki|_sources)(?:\/|$)/.test(normalized);
}
function revision(content) {
    return createHash('sha256').update(content, 'utf8').digest('hex');
}
function wikiType(content) {
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    const value = frontmatter?.match(/^\s*llm_wiki_type\s*:\s*['"]?([a-z_-]+)['"]?\s*$/im)?.[1]?.toLowerCase();
    return value && WIKI_TYPES.has(value) ? value : undefined;
}
function searchableTextFor(document, searchContent, searchFrontmatter) {
    if (searchContent && searchFrontmatter)
        return `${document.frontmatterText || ''}\n${document.body || ''}`;
    if (searchContent)
        return document.body || '';
    if (searchFrontmatter)
        return document.frontmatterText || '';
    return '';
}
function authorityMetadataFromFrontmatter(frontmatter) {
    if (!frontmatter)
        return { authorityTerms: [], authorityIds: [], sameAsTerms: [], closeMatchTerms: [], broaderTerms: [], relatedTerms: [] };
    const title = typeof frontmatter.title === 'string' && frontmatter.title.trim() ? [frontmatter.title.trim()] : [];
    const aliases = Array.isArray(frontmatter.aliases)
        ? frontmatter.aliases.filter((value) => typeof value === 'string' && value.trim().length > 0)
        : [];
    const list = (key, max) => Array.isArray(frontmatter[key])
        ? frontmatter[key].filter((value) => typeof value === 'string' && value.trim().length > 0).slice(0, max).map(value => value.trim())
        : [];
    return {
        authorityTerms: [...title, ...aliases.slice(0, 32).map(alias => alias.trim())],
        authorityIds: typeof frontmatter.authority_id === 'string' && frontmatter.authority_id.trim() ? [frontmatter.authority_id.trim()] : [],
        sameAsTerms: list('same_as', 20),
        closeMatchTerms: list('close_match', 20),
        broaderTerms: list('broader_terms', 20),
        relatedTerms: list('related_terms', 20),
    };
}
function retrievalMetadataFromFrontmatter(frontmatter) {
    if (!frontmatter)
        return { cues: [] };
    const cues = Array.isArray(frontmatter.retrieval_cues)
        ? frontmatter.retrieval_cues.filter((value) => typeof value === 'string' && value.trim().length > 0).slice(0, 8).map(value => value.trim())
        : [];
    const useWhen = typeof frontmatter.use_when === 'string' && frontmatter.use_when.trim() ? frontmatter.use_when.trim() : undefined;
    return useWhen ? { cues, useWhen } : { cues };
}
function matchingAuthorityValue(values, terms, caseSensitive) {
    for (const value of values) {
        const candidate = caseSensitive ? value : value.toLowerCase();
        if (terms.some(term => candidate.includes(term)))
            return value;
    }
    return undefined;
}
function rankCandidateFor(document, documentId, terms, scoringTerms, searchContent, searchFrontmatter, caseSensitive, expandAuthority) {
    const searchableText = searchableTextFor(document, searchContent, searchFrontmatter);
    const searchIn = caseSensitive ? searchableText : searchableText.toLowerCase();
    const title = document.relativePath.split('/').pop()?.replace(/\.md$/, '') || document.relativePath;
    const filenameToSearch = caseSensitive ? title : title.toLowerCase();
    const filenameMatch = terms.some(term => filenameToSearch.includes(term));
    const authorityText = document.authorityTerms.join('\n');
    const authorityIdText = document.authorityIds.join('\n');
    const sameAsText = document.sameAsTerms.join('\n');
    const closeMatchText = document.closeMatchTerms.join('\n');
    const broaderText = document.broaderTerms.join('\n');
    const relatedText = document.relatedTerms.join('\n');
    const authorityIn = caseSensitive ? authorityText : authorityText.toLowerCase();
    const authorityTermMatch = terms.some(term => authorityIn.includes(term));
    const authorityIdValue = matchingAuthorityValue(document.authorityIds, terms, caseSensitive);
    const sameAsValue = expandAuthority ? matchingAuthorityValue(document.sameAsTerms, terms, caseSensitive) : undefined;
    const closeMatchValue = expandAuthority ? matchingAuthorityValue(document.closeMatchTerms, terms, caseSensitive) : undefined;
    const broaderValue = expandAuthority ? matchingAuthorityValue(document.broaderTerms, terms, caseSensitive) : undefined;
    const relatedValue = expandAuthority ? matchingAuthorityValue(document.relatedTerms, terms, caseSensitive) : undefined;
    const authorityIdMatch = Boolean(authorityIdValue);
    const sameAsMatch = Boolean(sameAsValue);
    const closeMatch = Boolean(closeMatchValue);
    const broaderTermMatch = Boolean(broaderValue);
    const relatedTermMatch = Boolean(relatedValue);
    const authorityExpansion = authorityIdValue
        ? { relation: 'authority_id', confidence: 'exact', matched: authorityIdValue }
        : sameAsValue
            ? { relation: 'same_as', confidence: 'exact', matched: sameAsValue }
            : closeMatchValue
                ? { relation: 'close_match', confidence: 'high', matched: closeMatchValue }
                : broaderValue
                    ? { relation: 'broader', confidence: 'medium', matched: broaderValue }
                    : relatedValue
                        ? { relation: 'related', confidence: 'low', matched: relatedValue }
                        : undefined;
    const retrievalText = [...document.retrievalCues, ...(document.useWhen ? [document.useWhen] : [])].join('\n');
    const retrievalIn = caseSensitive ? retrievalText : retrievalText.toLowerCase();
    const retrievalCueMatch = terms.some(term => retrievalIn.includes(term));
    const termIndices = terms.map(term => searchIn.indexOf(term));
    const matchedIndices = termIndices.filter(index => index !== -1);
    const firstIndex = matchedIndices.length > 0 ? Math.min(...matchedIndices) : -1;
    if (terms.length > 0 && firstIndex === -1 && !filenameMatch && !authorityTermMatch && !authorityExpansion && !retrievalCueMatch)
        return undefined;
    const explicitAuthorityText = [
        authorityIdText,
        ...(expandAuthority ? [sameAsText, closeMatchText, broaderText, relatedText] : []),
    ].join('\n');
    const explicitAuthorityIn = caseSensitive ? explicitAuthorityText : explicitAuthorityText.toLowerCase();
    const termFreqs = new Map();
    for (const term of scoringTerms) {
        let count = 0;
        let searchIndex = 0;
        while ((searchIndex = searchIn.indexOf(term, searchIndex)) !== -1) {
            count += 1;
            searchIndex += term.length;
        }
        let authorityIndex = 0;
        while ((authorityIndex = authorityIn.indexOf(term, authorityIndex)) !== -1) {
            count += 1;
            authorityIndex += term.length;
        }
        let explicitAuthorityIndex = 0;
        while ((explicitAuthorityIndex = explicitAuthorityIn.indexOf(term, explicitAuthorityIndex)) !== -1) {
            count += 1;
            explicitAuthorityIndex += term.length;
        }
        let retrievalIndex = 0;
        while ((retrievalIndex = retrievalIn.indexOf(term, retrievalIndex)) !== -1) {
            count += 1;
            retrievalIndex += term.length;
        }
        termFreqs.set(term, count);
    }
    return {
        documentId,
        title,
        firstIndex,
        firstTermIndex: firstIndex === -1 ? -1 : termIndices.indexOf(firstIndex),
        filenameMatch,
        authorityTermMatch,
        authorityIdMatch,
        sameAsMatch,
        closeMatch,
        broaderTermMatch,
        relatedTermMatch,
        ...(authorityExpansion && { authorityExpansion }),
        retrievalCueMatch,
        termFreqs,
        docLength: (searchContent ? document.bodyLength : 0) + (searchFrontmatter ? document.frontmatterLength : 0) + countWords(authorityText) + countWords(explicitAuthorityText) + countWords(retrievalText),
        wiki: document.isWiki,
    };
}
/** Normalize a subtree path: forward slashes, no leading/trailing slashes. */
function normalizeSubtree(p) {
    return p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}
export class SearchService {
    pathFilter;
    catalog;
    vaultIo;
    cacheOwner = createDerivedCacheOwner('search.results');
    directoryCacheOwner = createDerivedCacheOwner('search.directories');
    corpusCacheOwner = createDerivedCacheOwner('search.corpus');
    vaultPath;
    cache = new Map();
    inFlight = new Map();
    documents = new Map();
    documentsById = new Map();
    dirtyDocuments = new Set();
    postings = new Map();
    gramIds = new Map();
    gramsById = [''];
    gramUsage = new Map();
    pathDocuments = new Map();
    documentPathKeys = new Map();
    corpusStatsCache = new Map();
    directoryCache = new Map();
    nextDocumentId = 1;
    indexedTextBytes = 0;
    cacheGeneration = 0;
    indexReady;
    snapshotReady;
    indexRefresh;
    snapshotTimer;
    snapshotWrite;
    snapshotPending = false;
    snapshotSavedGeneration = -1;
    indexGeneration = 0;
    watcher;
    catalogUnsubscribe;
    lastIndexReconcileAt = 0;
    needsFullReconcile = true;
    /** Process-local, per-account telemetry; never persisted or included in logs. */
    usageByScope = new Map();
    constructor(vaultPath, pathFilter, catalog, vaultIo = new VaultIoCoordinator()) {
        this.pathFilter = pathFilter;
        this.catalog = catalog;
        this.vaultIo = vaultIo;
        this.vaultPath = resolve(vaultPath);
        this.snapshotReady = this.loadSnapshot();
        if (catalog) {
            this.catalogUnsubscribe = catalog.subscribeBatch(changes => {
                if (changes)
                    this.invalidateMany(changes);
                else
                    this.invalidate();
            });
        }
    }
    /**
     * Search is derived from Markdown, so a short cache is safe and useful for
     * repeated agent lookups. Writers call this immediately after a mutation;
     * the TTL also covers edits made directly in Obsidian.
     */
    invalidate(path, kind = 'upsert') {
        if (path)
            this.invalidateMany([{ path, kind }]);
        else
            this.invalidateMany();
    }
    invalidateMany(changes) {
        this.cacheGeneration += 1;
        this.cache.clear();
        // Existing readers may finish, but later readers must not share a
        // computation that selected its index before this invalidation. The
        // generation guard prevents old work from repopulating the result cache.
        this.inFlight.clear();
        derivedCacheBudget.clearOwner(this.cacheOwner);
        this.corpusStatsCache.clear();
        derivedCacheBudget.clearOwner(this.corpusCacheOwner);
        this.directoryCache.clear();
        derivedCacheBudget.clearOwner(this.directoryCacheOwner);
        if (changes) {
            for (const change of changes) {
                const normalized = change.path.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
                if (change.kind === 'delete') {
                    this.removeDocument(normalized);
                    this.maybeCompactGramDictionary();
                }
                else
                    this.dirtyDocuments.add(normalized);
            }
        }
        else {
            this.needsFullReconcile = true;
        }
    }
    async close() {
        this.catalogUnsubscribe?.();
        this.watcher?.close();
        this.watcher = undefined;
        if (this.snapshotTimer)
            clearTimeout(this.snapshotTimer);
        this.snapshotTimer = undefined;
        // Prevent an in-flight flush from scheduling another snapshot after the
        // server has started tearing down its temporary or mounted vault.
        this.snapshotPending = false;
        if (this.snapshotWrite)
            await this.snapshotWrite.catch(() => undefined);
        this.directoryCache.clear();
        derivedCacheBudget.clearOwner(this.cacheOwner);
        derivedCacheBudget.clearOwner(this.directoryCacheOwner);
        derivedCacheBudget.clearOwner(this.corpusCacheOwner);
        this.usageByScope.clear();
    }
    recordUsage(scopeKey, query, resultCount) {
        const normalized = query.trim().replace(/\s+/g, ' ').slice(0, 240);
        if (!normalized)
            return;
        const scope = this.usageByScope.get(scopeKey) || new Map();
        const key = normalized.toLocaleLowerCase();
        const existing = scope.get(key) || { query: normalized, searches: 0, zeroResultSearches: 0, feedbackFailures: 0, feedbackAmbiguous: 0, usefulSelections: 0, lastResultCount: 0, lastAt: '' };
        existing.searches += 1;
        if (resultCount <= 0)
            existing.zeroResultSearches += 1;
        existing.lastResultCount = Math.max(0, Math.floor(resultCount));
        existing.lastAt = new Date().toISOString();
        scope.delete(key);
        scope.set(key, existing);
        while (scope.size > 256)
            scope.delete(scope.keys().next().value);
        this.usageByScope.set(scopeKey, scope);
        while (this.usageByScope.size > 32)
            this.usageByScope.delete(this.usageByScope.keys().next().value);
    }
    recordFeedback(scopeKey, query, outcome, selectedPaths = [], note) {
        const normalized = query.trim().replace(/\s+/g, ' ').slice(0, 240);
        if (!normalized)
            throw new Error('query is required');
        const scope = this.usageByScope.get(scopeKey) || new Map();
        const key = normalized.toLocaleLowerCase();
        const existing = scope.get(key) || { query: normalized, searches: 0, zeroResultSearches: 0, feedbackFailures: 0, feedbackAmbiguous: 0, usefulSelections: 0, lastResultCount: 0, lastAt: '' };
        if (outcome === 'failed')
            existing.feedbackFailures += 1;
        else if (outcome === 'ambiguous')
            existing.feedbackAmbiguous += 1;
        else
            existing.usefulSelections += Math.min(20, selectedPaths.length || 1);
        if (note?.trim())
            existing.note = note.trim().slice(0, 300);
        existing.lastAt = new Date().toISOString();
        scope.delete(key);
        scope.set(key, existing);
        while (scope.size > 256)
            scope.delete(scope.keys().next().value);
        this.usageByScope.set(scopeKey, scope);
        return { success: true, tracked: true, query: normalized, searches: existing.searches, feedbackFailures: existing.feedbackFailures, feedbackAmbiguous: existing.feedbackAmbiguous };
    }
    improvementCandidates(scopeKey, limit = 10, maxChars = 6000) {
        const boundedLimit = Math.min(Math.max(Number(limit) || 10, 1), 30);
        const boundedChars = Math.min(Math.max(Number(maxChars) || 6000, 512), 12000);
        const records = [...(this.usageByScope.get(scopeKey)?.values() || [])]
            .map(record => {
            const reasons = [];
            if (record.zeroResultSearches > 0)
                reasons.push('zero_results');
            if (record.feedbackFailures > 0)
                reasons.push('explicit_failure');
            if (record.feedbackAmbiguous > 0)
                reasons.push('ambiguous_results');
            if (record.searches >= 3 && record.usefulSelections === 0)
                reasons.push('repeated_without_useful_selection');
            const score = record.feedbackFailures * 5 + record.feedbackAmbiguous * 3 + record.zeroResultSearches * 2 + (record.searches >= 3 && record.usefulSelections === 0 ? 2 : 0);
            return { record, reasons, score };
        })
            .filter(item => item.reasons.length > 0)
            .sort((a, b) => b.score - a.score || b.record.searches - a.record.searches || a.record.query.localeCompare(b.record.query));
        const items = records.slice(0, boundedLimit).map(({ record, reasons, score }) => ({
            query: record.query,
            searches: record.searches,
            lastResultCount: record.lastResultCount,
            ...(record.zeroResultSearches > 0 && { zeroResultSearches: record.zeroResultSearches }),
            ...(record.feedbackFailures > 0 && { feedbackFailures: record.feedbackFailures }),
            ...(record.feedbackAmbiguous > 0 && { feedbackAmbiguous: record.feedbackAmbiguous }),
            usefulSelections: record.usefulSelections,
            reasons,
            score,
            ...(record.note && { note: record.note }),
            suggestedAction: reasons.includes('zero_results') ? 'Add an alias, retrieval_cue, authority term, or missing note after checking whether the concept exists.' : reasons.includes('ambiguous_results') ? 'Add a disambiguation note, stable_id, MOC, or narrower property/filter.' : 'Inspect the result projection and improve title, summary, links, or search cues before adding more content.',
        }));
        const result = { mode: 'process_local_search_improvement_candidates', items, total: records.length, truncated: records.length > items.length, privacy: 'Per-account, in-memory only; raw queries are discarded when the server stops and are never written to Markdown, Git, snapshots, or logs.' };
        while (JSON.stringify(result).length > boundedChars && result.items.length > 1) {
            result.items.pop();
            result.truncated = true;
        }
        return result;
    }
    async loadSnapshot() {
        try {
            const binary = await readSnapshotBytes(join(this.vaultPath, SEARCH_SNAPSHOT_FILE), { maxBytes: MAX_SNAPSHOT_BYTES });
            const parsed = decodeSnapshot(binary);
            if (parsed)
                this.restoreSnapshot(parsed);
            return;
        }
        catch {
            // Try the previous compressed-JSON format for a one-release migration.
        }
        try {
            const raw = await readSnapshotBytes(join(this.vaultPath, LEGACY_SEARCH_SNAPSHOT_FILE), {
                maxBytes: 32 * 1024 * 1024, maxDecodedBytes: MAX_SNAPSHOT_BYTES,
            });
            const parsed = JSON.parse(raw.toString('utf8'));
            if (parsed.version === SEARCH_SNAPSHOT_VERSION && Array.isArray(parsed.documents))
                this.restoreSnapshot(parsed);
        }
        catch {
            // A missing, corrupt, or old snapshot is harmless; refreshAll rebuilds
            // the derived index from Markdown and replaces it atomically.
        }
    }
    restoreSnapshot(snapshot) {
        if (snapshot.documents.length > MAX_SNAPSHOT_ENTRIES)
            return;
        for (const value of snapshot.grams) {
            if (typeof value !== 'string' || value.length === 0 || this.gramIds.has(value))
                continue;
            const id = this.gramsById.length;
            this.gramIds.set(value, id);
            this.gramsById.push(value);
        }
        for (const item of snapshot.documents) {
            if (!item || typeof item !== 'object')
                continue;
            const relativePath = normalizeSubtree(String(item.relativePath || ''));
            if (!relativePath || !this.pathFilter.isAllowed(relativePath))
                continue;
            if (!Array.isArray(item.bodyGramIds) || !Array.isArray(item.frontmatterGramIds) || !Array.isArray(item.titleGramIds))
                continue;
            if (![item.size, item.mtimeMs, item.bodyLength, item.frontmatterLength, item.textBytes].every(value => typeof value === 'number' && Number.isFinite(value)))
                continue;
            const document = {
                relativePath,
                documentId: this.nextDocumentId++,
                title: String(item.title || relativePath),
                authorityTerms: Array.isArray(item.authorityTerms)
                    ? item.authorityTerms.filter(value => typeof value === 'string').slice(0, 64)
                    : [String(item.title || relativePath)],
                authorityIds: Array.isArray(item.authorityIds) ? item.authorityIds.filter(value => typeof value === 'string').slice(0, 8) : [],
                sameAsTerms: Array.isArray(item.sameAsTerms) ? item.sameAsTerms.filter(value => typeof value === 'string').slice(0, 20) : [],
                closeMatchTerms: Array.isArray(item.closeMatchTerms) ? item.closeMatchTerms.filter(value => typeof value === 'string').slice(0, 20) : [],
                broaderTerms: Array.isArray(item.broaderTerms) ? item.broaderTerms.filter(value => typeof value === 'string').slice(0, 20) : [],
                relatedTerms: Array.isArray(item.relatedTerms) ? item.relatedTerms.filter(value => typeof value === 'string').slice(0, 20) : [],
                retrievalCues: Array.isArray(item.retrievalCues) ? item.retrievalCues.filter(value => typeof value === 'string').slice(0, 8) : [],
                ...(typeof item.useWhen === 'string' && item.useWhen && { useWhen: item.useWhen }),
                isWiki: item.isWiki === true,
                moderationHidden: item.moderationHidden === true,
                revision: String(item.revision || ''),
                size: item.size,
                mtimeMs: item.mtimeMs,
                bodyLength: item.bodyLength,
                frontmatterLength: item.frontmatterLength,
                textBytes: item.textBytes,
                textCached: false,
                lastAccessAt: 0,
                bodyGrams: new Set(item.bodyGramIds.filter(value => Number.isInteger(value) && value > 0 && value < this.gramsById.length)),
                frontmatterGrams: new Set(item.frontmatterGramIds.filter(value => Number.isInteger(value) && value > 0 && value < this.gramsById.length)),
                titleGrams: new Set(item.titleGramIds.filter(value => Number.isInteger(value) && value > 0 && value < this.gramsById.length)),
            };
            this.setDocument(document);
        }
        this.snapshotSavedGeneration = this.indexGeneration;
    }
    scheduleSnapshotSave() {
        this.snapshotPending = true;
        if (this.snapshotTimer)
            return;
        this.snapshotTimer = setTimeout(() => {
            this.snapshotTimer = undefined;
            void this.flushSnapshot();
        }, SNAPSHOT_SAVE_DEBOUNCE_MS);
        this.snapshotTimer.unref?.();
    }
    async flushSnapshot() {
        if (this.snapshotWrite)
            return;
        if (!this.snapshotPending)
            return;
        this.snapshotPending = false;
        if (this.snapshotSavedGeneration === this.indexGeneration)
            return;
        const generation = this.indexGeneration;
        const snapshot = {
            version: SEARCH_SNAPSHOT_VERSION,
            documents: [...this.documents.values()].map(document => ({
                relativePath: document.relativePath,
                title: document.title,
                authorityTerms: document.authorityTerms,
                authorityIds: document.authorityIds,
                sameAsTerms: document.sameAsTerms,
                closeMatchTerms: document.closeMatchTerms,
                broaderTerms: document.broaderTerms,
                relatedTerms: document.relatedTerms,
                retrievalCues: document.retrievalCues,
                ...(document.useWhen && { useWhen: document.useWhen }),
                isWiki: document.isWiki,
                moderationHidden: document.moderationHidden,
                revision: document.revision,
                size: document.size,
                mtimeMs: document.mtimeMs,
                bodyLength: document.bodyLength,
                frontmatterLength: document.frontmatterLength,
                textBytes: document.textBytes,
                bodyGramIds: [...document.bodyGrams],
                frontmatterGramIds: [...document.frontmatterGrams],
                titleGramIds: [...document.titleGrams],
            })),
            grams: this.gramsById.slice(1),
        };
        this.snapshotWrite = (async () => {
            const snapshotPath = join(this.vaultPath, SEARCH_SNAPSHOT_FILE);
            await mkdir(join(this.vaultPath, '.mcpvault'), { recursive: true });
            const encoded = encodeSnapshot(snapshot);
            const temporaryPath = `${snapshotPath}.${process.pid}.tmp`;
            await writeFile(temporaryPath, encoded);
            await rename(temporaryPath, snapshotPath);
            this.snapshotSavedGeneration = generation;
        })().catch(() => {
            // The snapshot is an optional acceleration cache. Search correctness
            // must never depend on being able to write it (for example on NAS).
        });
        try {
            await this.snapshotWrite;
        }
        finally {
            this.snapshotWrite = undefined;
            if (this.snapshotPending)
                this.scheduleSnapshotSave();
        }
    }
    async search(params) {
        const { query, limit = 5, searchContent = true, searchFrontmatter = false, caseSensitive = false, pathPrefix, excludePaths } = params;
        if (!query || query.trim().length === 0) {
            throw new Error('Search query cannot be empty');
        }
        const normalizedQuery = query.trim();
        const parsedQuery = parseSearchQuery(normalizedQuery);
        const normalizedPrefix = pathPrefix ? normalizeSubtree(pathPrefix) : '';
        const normalizedExcludes = (excludePaths || []).map(normalizeSubtree).filter(Boolean).sort();
        const cacheKey = JSON.stringify({
            query: normalizedQuery,
            limit,
            searchContent,
            searchFrontmatter,
            caseSensitive,
            pathPrefix: normalizedPrefix,
            excludePaths: normalizedExcludes,
            maxChars: params.maxChars,
            includeRevisions: params.includeRevisions === true,
            expandAuthority: params.expandAuthority === true,
        });
        // Delivered filesystem changes must invalidate even the result-cache fast
        // path (including cached misses and notes newly hidden by moderation).
        await this.catalog?.flushPendingEvents();
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            this.cache.delete(cacheKey);
            this.cache.set(cacheKey, cached);
            derivedCacheBudget.touch(this.cacheOwner, cacheKey);
            return cached.results.map(result => ({ ...result }));
        }
        if (cached) {
            this.cache.delete(cacheKey);
            derivedCacheBudget.remove(this.cacheOwner, cacheKey);
        }
        const running = this.inFlight.get(cacheKey);
        if (running)
            return (await running).map(result => ({ ...result }));
        const generation = this.cacheGeneration;
        const computation = (async () => {
            await this.ensureIndex();
            const maxLimit = normalizeSearchLimit(limit);
            const maxChars = normalizeSearchMaxChars(params.maxChars);
            // Corpus stats for reranking. Lengths are prepared during indexing, and
            // the bounded cache lets different queries reuse the same scope stats.
            const termDocFreq = new Map();
            // Keep quoted tokens as one exact phrase. Unquoted tokens are already
            // separated by the tokenizer, so this also avoids turning a quoted phrase
            // back into an unconstrained AND/OR sequence.
            const terms = parsedQuery.terms
                .map(term => caseSensitive ? term : term.toLowerCase())
                .filter(Boolean);
            const excludeTerms = parsedQuery.excludeTerms
                .map(term => caseSensitive ? term : term.toLowerCase())
                .filter(Boolean);
            const scoringTerms = terms;
            const authorityExpansionEnabled = params.expandAuthority === true;
            // The server-owned document index has already performed the filesystem
            // reads. Search only the visible in-memory documents on this pass.
            const scopedDocumentIds = this.scopedDocumentIds(normalizedPrefix, normalizedExcludes);
            const corpusStats = this.getCorpusStats(scopedDocumentIds, searchContent, searchFrontmatter, normalizedPrefix, normalizedExcludes);
            const { totalDocLength, docCount } = corpusStats;
            const candidateIds = this.candidateIds(terms, searchContent, searchFrontmatter, caseSensitive, scopedDocumentIds);
            const filteredCandidateIds = new Set();
            for (const documentId of candidateIds) {
                const document = this.documentsById.get(documentId);
                if (!document || !this.pathFilter.isAllowed(document.relativePath) || document.moderationHidden)
                    continue;
                if (Object.keys(parsedQuery.filters).length > 0 || excludeTerms.length > 0)
                    await this.loadText(document);
                if (matchesSearchFilters(document, parsedQuery.filters))
                    filteredCandidateIds.add(documentId);
            }
            // First pass loads text only as needed and computes corpus document
            // frequencies. Candidate objects are deliberately not retained yet.
            for (const documentId of filteredCandidateIds) {
                const document = this.documentsById.get(documentId);
                if (!document || !this.pathFilter.isAllowed(document.relativePath))
                    continue;
                if (document.moderationHidden)
                    continue;
                if (searchContent || searchFrontmatter)
                    await this.loadText(document);
                const searchIn = caseSensitive
                    ? searchableTextFor(document, searchContent, searchFrontmatter)
                    : searchableTextFor(document, searchContent, searchFrontmatter).toLowerCase();
                const discoveryText = `${document.authorityTerms.join('\n')}\n${document.authorityIds.join('\n')}\n${authorityExpansionEnabled ? `${document.sameAsTerms.join('\n')}\n${document.closeMatchTerms.join('\n')}\n${document.broaderTerms.join('\n')}\n${document.relatedTerms.join('\n')}` : ''}\n${document.retrievalCues.join('\n')}\n${document.useWhen || ''}`;
                const discoveryIn = caseSensitive ? discoveryText : discoveryText.toLowerCase();
                const title = document.relativePath.split('/').pop()?.replace(/\.md$/, '') || document.relativePath;
                const exclusionSearch = `${searchIn}\n${discoveryIn}\n${caseSensitive ? title : title.toLowerCase()}`;
                if (excludeTerms.some(term => exclusionSearch.includes(term)))
                    filteredCandidateIds.delete(documentId);
                for (const term of scoringTerms) {
                    if (searchIn.includes(term) || discoveryIn.includes(term))
                        termDocFreq.set(term, (termDocFreq.get(term) || 0) + 1);
                }
            }
            const service = this;
            const candidates = (function* () {
                for (const documentId of filteredCandidateIds) {
                    const document = service.documentsById.get(documentId);
                    if (!document || !service.pathFilter.isAllowed(document.relativePath) || document.moderationHidden)
                        continue;
                    const candidate = rankCandidateFor(document, documentId, terms, scoringTerms, searchContent, searchFrontmatter, caseSensitive, authorityExpansionEnabled);
                    if (candidate)
                        yield candidate;
                }
            })();
            const ranked = this.rerank(candidates, scoringTerms, termDocFreq, docCount, totalDocLength, maxLimit);
            const filterReasons = [
                ...(parsedQuery.filters.pathPrefix ? ['filter_path'] : []),
                ...(parsedQuery.filters.tag ? ['filter_tag'] : []),
                ...(parsedQuery.filters.property ? ['filter_property'] : []),
                ...(parsedQuery.filters.sectionTerms ? ['filter_section'] : []),
                ...(parsedQuery.filters.blockTerms ? ['filter_block'] : []),
                ...(parsedQuery.filters.taskTerms ? ['filter_task'] : []),
            ];
            const results = boundSearchResults(ranked.map(candidate => this.materializeResult(candidate, terms, scoringTerms, searchContent, searchFrontmatter, caseSensitive, params.includeRevisions === true, filterReasons)), maxChars);
            if (generation === this.cacheGeneration) {
                const cachedResults = results.map(result => ({ ...result }));
                const entry = { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, results: cachedResults };
                this.cache.set(cacheKey, entry);
                derivedCacheBudget.register(this.cacheOwner, cacheKey, estimateCacheBytes(cachedResults) + Buffer.byteLength(cacheKey, 'utf8') + 128, () => {
                    if (this.cache.get(cacheKey) === entry)
                        this.cache.delete(cacheKey);
                });
                while (this.cache.size > SEARCH_CACHE_MAX_ENTRIES) {
                    const oldest = this.cache.keys().next();
                    if (oldest.done)
                        break;
                    this.cache.delete(oldest.value);
                    derivedCacheBudget.remove(this.cacheOwner, oldest.value);
                }
            }
            return results;
        })();
        this.inFlight.set(cacheKey, computation);
        try {
            return await computation;
        }
        finally {
            if (this.inFlight.get(cacheKey) === computation)
                this.inFlight.delete(cacheKey);
        }
    }
    async ensureIndex() {
        this.startWatcher();
        await this.snapshotReady;
        if (!this.indexReady)
            this.indexReady = this.refreshAll().catch(error => {
                this.indexReady = undefined;
                throw error;
            });
        await this.indexReady;
        if (this.dirtyDocuments.size > 0)
            await this.refreshDirty();
        const interval = this.watcher ? INDEX_RECONCILE_INTERVAL_MS : NO_WATCHER_RECONCILE_INTERVAL_MS;
        if (this.needsFullReconcile || Date.now() - this.lastIndexReconcileAt >= interval)
            await this.refreshAll();
    }
    startWatcher() {
        if (this.catalog)
            return;
        if (this.watcher)
            return;
        try {
            this.watcher = watch(this.vaultPath, { recursive: true }, (_event, filename) => {
                this.directoryCache.clear();
                derivedCacheBudget.clearOwner(this.directoryCacheOwner);
                if (!filename) {
                    this.needsFullReconcile = true;
                    return;
                }
                const normalized = String(filename).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
                if (/\.md$/i.test(normalized) && this.pathFilter.isAllowed(normalized)) {
                    this.dirtyDocuments.add(normalized);
                }
                else
                    this.needsFullReconcile = true;
            });
            this.watcher.on('error', () => {
                this.watcher?.close();
                this.watcher = undefined;
                this.needsFullReconcile = true;
            });
            this.watcher.unref?.();
        }
        catch {
            // Network mounts and some Windows filesystems do not support recursive
            // watchers. The shorter reconciliation interval remains authoritative.
            this.watcher = undefined;
        }
    }
    async refreshAll() {
        if (this.indexRefresh)
            return this.indexRefresh;
        this.indexRefresh = (async () => {
            const paths = this.catalog
                ? (await this.catalog.notePathsSnapshot()).filter(path => path.toLowerCase().endsWith('.md')).map(path => join(this.vaultPath, path))
                : await this.findMarkdownFiles(this.vaultPath);
            const next = new Map();
            for (let start = 0; start < paths.length; start += INDEX_READ_BATCH_SIZE) {
                const batch = paths.slice(start, start + INDEX_READ_BATCH_SIZE);
                const sharedStats = this.catalog ? await this.catalog.statPaths(batch.map(fullPath => fullPath.substring(this.vaultPath.length + 1).replace(/\\/g, '/'))) : undefined;
                const documents = await Promise.all(batch.map(fullPath => {
                    const relativePath = fullPath.substring(this.vaultPath.length + 1).replace(/\\/g, '/');
                    return this.readIndexedDocument(fullPath, this.documents.get(relativePath), sharedStats?.get(relativePath));
                }));
                for (const document of documents) {
                    if (document)
                        next.set(document.relativePath, document);
                }
            }
            for (const path of this.documents.keys()) {
                if (!next.has(path))
                    this.removeDocument(path);
            }
            for (const document of next.values())
                this.setDocument(document);
            this.maybeCompactGramDictionary();
            this.dirtyDocuments.clear();
            this.needsFullReconcile = false;
            this.lastIndexReconcileAt = Date.now();
            this.trimTextCache();
            this.scheduleSnapshotSave();
        })();
        try {
            await this.indexRefresh;
        }
        finally {
            this.indexRefresh = undefined;
        }
    }
    async refreshDirty() {
        if (this.indexRefresh)
            return this.indexRefresh;
        this.indexRefresh = (async () => {
            const paths = [...this.dirtyDocuments];
            this.dirtyDocuments.clear();
            let documents;
            try {
                documents = await Promise.all(paths.map(path => this.readIndexedDocument(join(this.vaultPath, path))));
            }
            catch (error) {
                for (const path of paths)
                    this.dirtyDocuments.add(path);
                throw error;
            }
            for (let index = 0; index < paths.length; index += 1) {
                const path = paths[index];
                const document = documents[index];
                if (document)
                    this.setDocument(document);
                else
                    this.removeDocument(path);
            }
            this.maybeCompactGramDictionary();
            this.trimTextCache();
            this.scheduleSnapshotSave();
        })();
        try {
            await this.indexRefresh;
        }
        finally {
            this.indexRefresh = undefined;
        }
    }
    async readIndexedDocument(fullPath, existing, sharedStat) {
        const relativePath = fullPath.substring(this.vaultPath.length + 1).replace(/\\/g, '/');
        if (!this.pathFilter.isAllowed(relativePath))
            return undefined;
        try {
            let size;
            let mtimeMs;
            if (sharedStat) {
                size = sharedStat.size;
                mtimeMs = sharedStat.mtimeMs;
            }
            else {
                const info = await stat(fullPath);
                if (!info.isFile())
                    return undefined;
                size = info.size;
                mtimeMs = info.mtimeMs;
            }
            if (existing && existing.size === size && existing.mtimeMs === mtimeMs)
                return existing;
            const content = await this.vaultIo.readUtf8(fullPath);
            const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
            const body = frontmatterMatch ? content.slice(frontmatterMatch[0].length) : content;
            const frontmatterText = frontmatterMatch?.[1] || '';
            const parsedFrontmatter = parseSearchFrontmatter(frontmatterText);
            const title = relativePath.split('/').pop()?.replace(/\.md$/i, '') || relativePath;
            const authorityMetadata = authorityMetadataFromFrontmatter(parsedFrontmatter);
            const authorityTerms = [title, ...authorityMetadata.authorityTerms];
            const retrievalMetadata = retrievalMetadataFromFrontmatter(parsedFrontmatter);
            return {
                relativePath,
                documentId: existing?.documentId ?? this.nextDocumentId++,
                body,
                frontmatterText,
                ...(parsedFrontmatter ? { frontmatter: parsedFrontmatter } : {}),
                title,
                authorityTerms,
                authorityIds: authorityMetadata.authorityIds,
                sameAsTerms: authorityMetadata.sameAsTerms,
                closeMatchTerms: authorityMetadata.closeMatchTerms,
                broaderTerms: authorityMetadata.broaderTerms,
                relatedTerms: authorityMetadata.relatedTerms,
                retrievalCues: retrievalMetadata.cues,
                ...(retrievalMetadata.useWhen && { useWhen: retrievalMetadata.useWhen }),
                isWiki: isWikiPath(relativePath) || wikiType(content) !== undefined,
                moderationHidden: isMarkdownModerationHidden(content),
                revision: revision(content),
                size,
                mtimeMs,
                bodyLength: countWords(body),
                frontmatterLength: countWords(frontmatterText),
                textBytes: Buffer.byteLength(content, 'utf8'),
                textCached: true,
                lastAccessAt: Date.now(),
                bodyGrams: this.gramIdsForText(body.toLowerCase()),
                frontmatterGrams: this.gramIdsForText(frontmatterText.toLowerCase()),
                titleGrams: this.gramIdsForText([...authorityTerms, ...authorityMetadata.authorityIds, ...authorityMetadata.sameAsTerms, ...authorityMetadata.closeMatchTerms, ...authorityMetadata.broaderTerms, ...authorityMetadata.relatedTerms, ...retrievalMetadata.cues, ...(retrievalMetadata.useWhen ? [retrievalMetadata.useWhen] : [])].join('\n').toLowerCase()),
            };
        }
        catch (error) {
            if (isMissingVaultPath(error))
                return undefined;
            throw new VaultReadUnavailableError();
        }
    }
    gramIdsForText(value) {
        const output = new Set();
        for (const gram of grams(value)) {
            let id = this.gramIds.get(gram);
            if (id === undefined) {
                id = this.gramsById.length;
                this.gramIds.set(gram, id);
                this.gramsById.push(gram);
            }
            output.add(id);
        }
        return output;
    }
    postingKey(field, gram) {
        return `${field}\u0000${gram}`;
    }
    updatePostings(document, add) {
        const fields = [
            ['body', document.bodyGrams],
            ['frontmatter', document.frontmatterGrams],
            ['title', document.titleGrams],
        ];
        for (const [field, values] of fields) {
            for (const value of values) {
                const key = this.postingKey(field, value);
                if (add) {
                    let paths = this.postings.get(key);
                    if (!paths) {
                        paths = new Set();
                        this.postings.set(key, paths);
                    }
                    paths.add(document.documentId);
                }
                else {
                    const paths = this.postings.get(key);
                    paths?.delete(document.documentId);
                    if (paths && paths.size === 0)
                        this.postings.delete(key);
                }
            }
        }
    }
    updateGramUsage(document, add) {
        for (const values of [document.bodyGrams, document.frontmatterGrams, document.titleGrams]) {
            for (const value of values) {
                const next = (this.gramUsage.get(value) || 0) + (add ? 1 : -1);
                if (next > 0)
                    this.gramUsage.set(value, next);
                else
                    this.gramUsage.delete(value);
            }
        }
    }
    maybeCompactGramDictionary() {
        const total = this.gramIds.size;
        const live = this.gramUsage.size;
        const stale = total - live;
        if (total < GRAM_COMPACTION_MIN_ENTRIES
            || stale < GRAM_COMPACTION_MIN_STALE_ENTRIES
            || stale / total < GRAM_COMPACTION_STALE_RATIO)
            return;
        const remap = new Map();
        const nextGrams = [''];
        const nextIds = new Map();
        for (const [gram, oldId] of this.gramIds) {
            if (!this.gramUsage.has(oldId))
                continue;
            const nextId = nextGrams.length;
            remap.set(oldId, nextId);
            nextIds.set(gram, nextId);
            nextGrams.push(gram);
        }
        for (const document of this.documents.values()) {
            document.bodyGrams = this.remapGramSet(document.bodyGrams, remap);
            document.frontmatterGrams = this.remapGramSet(document.frontmatterGrams, remap);
            document.titleGrams = this.remapGramSet(document.titleGrams, remap);
        }
        this.gramIds.clear();
        for (const [gram, id] of nextIds)
            this.gramIds.set(gram, id);
        this.gramsById.splice(0, this.gramsById.length, ...nextGrams);
        this.postings.clear();
        this.gramUsage.clear();
        for (const document of this.documents.values()) {
            this.updatePostings(document, true);
            this.updateGramUsage(document, true);
        }
    }
    remapGramSet(values, remap) {
        const next = new Set();
        for (const value of values) {
            const mapped = remap.get(value);
            if (mapped !== undefined)
                next.add(mapped);
        }
        return next;
    }
    setDocument(document) {
        const old = this.documents.get(document.relativePath);
        if (old === document)
            return;
        this.corpusStatsCache.clear();
        derivedCacheBudget.clearOwner(this.corpusCacheOwner);
        if (old) {
            this.updatePostings(old, false);
            this.updateGramUsage(old, false);
            this.removePathIndex(old);
            this.documentsById.delete(old.documentId);
            if (old.textCached)
                this.indexedTextBytes -= old.textBytes;
        }
        this.documents.set(document.relativePath, document);
        this.documentsById.set(document.documentId, document);
        this.updatePostings(document, true);
        this.updateGramUsage(document, true);
        this.addPathIndex(document);
        if (document.textCached)
            this.indexedTextBytes += document.textBytes;
        this.indexGeneration += 1;
    }
    removeDocument(path) {
        const document = this.documents.get(path);
        if (!document)
            return;
        this.corpusStatsCache.clear();
        derivedCacheBudget.clearOwner(this.corpusCacheOwner);
        this.updatePostings(document, false);
        this.updateGramUsage(document, false);
        this.removePathIndex(document);
        this.documentsById.delete(document.documentId);
        if (document.textCached)
            this.indexedTextBytes -= document.textBytes;
        this.documents.delete(path);
        this.indexGeneration += 1;
    }
    pathKeys(path) {
        const parts = path.split('/');
        const keys = [''];
        for (let index = 1; index <= parts.length; index += 1)
            keys.push(parts.slice(0, index).join('/'));
        return keys;
    }
    addPathIndex(document) {
        const keys = this.pathKeys(document.relativePath);
        this.documentPathKeys.set(document.documentId, keys);
        for (const key of keys) {
            let ids = this.pathDocuments.get(key);
            if (!ids) {
                ids = new Set();
                this.pathDocuments.set(key, ids);
            }
            ids.add(document.documentId);
        }
    }
    removePathIndex(document) {
        for (const key of this.documentPathKeys.get(document.documentId) || []) {
            const ids = this.pathDocuments.get(key);
            ids?.delete(document.documentId);
            if (ids && ids.size === 0)
                this.pathDocuments.delete(key);
        }
        this.documentPathKeys.delete(document.documentId);
    }
    scopedDocumentIds(pathPrefix, excludePaths) {
        const base = this.pathDocuments.get(pathPrefix || '');
        if (!base || excludePaths.length === 0)
            return base || new Set();
        const output = new Set(base);
        for (const exclude of excludePaths) {
            for (const documentId of this.pathDocuments.get(exclude) || [])
                output.delete(documentId);
        }
        return output;
    }
    getCorpusStats(scopedIds, searchContent, searchFrontmatter, pathPrefix, excludePaths) {
        const key = JSON.stringify({
            searchContent,
            searchFrontmatter,
            pathPrefix,
            excludePaths: [...excludePaths].sort(),
        });
        const cached = this.corpusStatsCache.get(key);
        if (cached) {
            this.corpusStatsCache.delete(key);
            this.corpusStatsCache.set(key, cached);
            derivedCacheBudget.touch(this.corpusCacheOwner, key);
            return cached;
        }
        let totalDocLength = 0;
        let docCount = 0;
        for (const documentId of scopedIds) {
            const document = this.documentsById.get(documentId);
            if (!document || !this.pathFilter.isAllowed(document.relativePath) || document.moderationHidden)
                continue;
            totalDocLength += (searchContent ? document.bodyLength : 0)
                + (searchFrontmatter ? document.frontmatterLength : 0);
            docCount += 1;
        }
        const stats = { docCount, totalDocLength };
        this.corpusStatsCache.set(key, stats);
        derivedCacheBudget.register(this.corpusCacheOwner, key, estimateCacheBytes(stats) + Buffer.byteLength(key, 'utf8') + 64, () => {
            if (this.corpusStatsCache.get(key) !== stats)
                return;
            this.corpusStatsCache.delete(key);
        });
        while (this.corpusStatsCache.size > CORPUS_STATS_CACHE_MAX_ENTRIES) {
            const oldest = this.corpusStatsCache.keys().next();
            if (oldest.done)
                break;
            this.corpusStatsCache.delete(oldest.value);
            derivedCacheBudget.remove(this.corpusCacheOwner, oldest.value);
        }
        return stats;
    }
    async loadText(document) {
        if (document.body !== undefined && document.frontmatterText !== undefined) {
            document.lastAccessAt = Date.now();
            return;
        }
        try {
            const content = await readFile(join(this.vaultPath, document.relativePath), 'utf-8');
            const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
            document.body = frontmatterMatch ? content.slice(frontmatterMatch[0].length) : content;
            document.frontmatterText = frontmatterMatch?.[1] || '';
            const parsedFrontmatter = parseSearchFrontmatter(document.frontmatterText);
            if (parsedFrontmatter)
                document.frontmatter = parsedFrontmatter;
            else
                delete document.frontmatter;
            const title = document.relativePath.split('/').pop()?.replace(/\.md$/i, '') || document.relativePath;
            const authorityMetadata = authorityMetadataFromFrontmatter(parsedFrontmatter);
            document.authorityTerms = [title, ...authorityMetadata.authorityTerms];
            document.authorityIds = authorityMetadata.authorityIds;
            document.sameAsTerms = authorityMetadata.sameAsTerms;
            document.closeMatchTerms = authorityMetadata.closeMatchTerms;
            document.broaderTerms = authorityMetadata.broaderTerms;
            document.relatedTerms = authorityMetadata.relatedTerms;
            const retrievalMetadata = retrievalMetadataFromFrontmatter(parsedFrontmatter);
            document.retrievalCues = retrievalMetadata.cues;
            if (retrievalMetadata.useWhen)
                document.useWhen = retrievalMetadata.useWhen;
            else
                delete document.useWhen;
            if (!document.textCached) {
                this.indexedTextBytes += document.textBytes;
                document.textCached = true;
            }
            document.lastAccessAt = Date.now();
            this.trimTextCache(document.relativePath);
        }
        catch (error) {
            if (!isMissingVaultPath(error))
                throw new VaultReadUnavailableError();
            document.body = '';
            document.frontmatterText = '';
        }
    }
    trimTextCache(protectedPath) {
        if (this.indexedTextBytes <= MAX_INDEXED_TEXT_BYTES)
            return;
        const loaded = [...this.documents.values()]
            .filter(document => document.body !== undefined || document.frontmatterText !== undefined)
            .filter(document => document.relativePath !== protectedPath)
            .sort((a, b) => a.lastAccessAt - b.lastAccessAt);
        for (const document of loaded) {
            if (this.indexedTextBytes <= MAX_INDEXED_TEXT_BYTES)
                break;
            delete document.body;
            delete document.frontmatterText;
            delete document.frontmatter;
            document.textCached = false;
            this.indexedTextBytes -= document.textBytes;
        }
    }
    candidateIds(terms, searchContent, searchFrontmatter, caseSensitive, scopedIds) {
        const all = scopedIds;
        if (terms.length === 0 || caseSensitive)
            return all;
        if (!searchContent && !searchFrontmatter)
            return this.matchingPostingCandidates(terms, ['title'], all);
        if (terms.some(term => term.length < NGRAM_SIZE))
            return all;
        const fields = ['title'];
        if (searchContent)
            fields.push('body');
        if (searchFrontmatter)
            fields.push('frontmatter');
        return this.matchingPostingCandidates(terms, fields, all);
    }
    matchingPostingCandidates(terms, fields, all) {
        const output = new Set();
        for (const rawTerm of terms) {
            const term = rawTerm.toLowerCase();
            if (term.length < NGRAM_SIZE)
                return all;
            for (const field of fields) {
                for (const documentId of this.postingCandidates(field, term)) {
                    if (all.has(documentId))
                        output.add(documentId);
                }
            }
        }
        return output;
    }
    postingCandidates(field, term) {
        const termGramIds = [];
        for (const value of grams(term)) {
            const gramId = this.gramIds.get(value);
            if (gramId === undefined)
                return new Set();
            termGramIds.push(gramId);
        }
        const postings = [];
        for (const gramId of termGramIds) {
            const posting = this.postings.get(this.postingKey(field, gramId));
            if (!posting)
                return new Set();
            postings.push(posting);
        }
        postings.sort((a, b) => a.size - b.size);
        const first = postings[0];
        if (!first)
            return new Set();
        const output = new Set(first);
        for (let index = 1; index < postings.length; index += 1) {
            const posting = postings[index];
            for (const documentId of output)
                if (!posting.has(documentId))
                    output.delete(documentId);
            if (output.size === 0)
                break;
        }
        return output;
    }
    async findMarkdownFiles(dirPath) {
        const cached = this.directoryCache.get(dirPath);
        if (cached && cached.expiresAt > Date.now()) {
            this.directoryCache.delete(dirPath);
            this.directoryCache.set(dirPath, cached);
            derivedCacheBudget.touch(this.directoryCacheOwner, dirPath);
            return cached.paths;
        }
        if (cached) {
            this.directoryCache.delete(dirPath);
            derivedCacheBudget.remove(this.directoryCacheOwner, dirPath);
        }
        const markdownFiles = [];
        try {
            const entries = await readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    // Recursively search subdirectories
                    const subFiles = await this.findMarkdownFiles(fullPath);
                    markdownFiles.push(...subFiles);
                }
                else if (entry.isFile() && entry.name.endsWith('.md')) {
                    markdownFiles.push(fullPath);
                }
            }
        }
        catch (error) {
            if (dirPath === this.vaultPath || !isMissingVaultPath(error))
                throw new VaultReadUnavailableError();
        }
        const entry = { expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS, paths: markdownFiles };
        this.directoryCache.set(dirPath, entry);
        derivedCacheBudget.register(this.directoryCacheOwner, dirPath, estimateCacheBytes(entry) + 64, () => {
            if (this.directoryCache.get(dirPath) !== entry)
                return;
            this.directoryCache.delete(dirPath);
        });
        while (this.directoryCache.size > DIRECTORY_CACHE_MAX_ENTRIES) {
            const oldest = this.directoryCache.keys().next();
            if (oldest.done)
                break;
            this.directoryCache.delete(oldest.value);
            derivedCacheBudget.remove(this.directoryCacheOwner, oldest.value);
        }
        return markdownFiles;
    }
    rerank(candidates, terms, termDocFreq, docCount, totalDocLength, maxLimit) {
        const avgdl = docCount > 0 ? totalDocLength / docCount : 1;
        const k1 = 1.2;
        const b = 0.75;
        const idfByTerm = new Map(terms.map(term => {
            const df = termDocFreq.get(term) || 0;
            return [term, Math.log(1 + (docCount - df + 0.5) / (df + 0.5))];
        }));
        const scoreCandidate = (c, index) => {
            let score = 0;
            for (const term of terms) {
                const tf = c.termFreqs.get(term) || 0;
                const idf = idfByTerm.get(term) || 0;
                score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * c.docLength / avgdl));
            }
            score += c.authorityExpansion?.relation === 'authority_id' ? 2.0
                : c.authorityExpansion?.relation === 'same_as' ? 1.6
                    : c.authorityExpansion?.relation === 'close_match' ? 1.2
                        : c.authorityExpansion?.relation === 'broader' ? 0.8
                            : c.authorityExpansion?.relation === 'related' ? 0.4
                                : 0;
            return { score, candidate: c, wiki: c.wiki, index };
        };
        const compare = (a, b) => Number(b.wiki) - Number(a.wiki) || b.score - a.score || a.index - b.index;
        function* scoreStream() {
            let index = 0;
            for (const candidate of candidates)
                yield scoreCandidate(candidate, index++);
        }
        return boundedTopK(scoreStream(), maxLimit, compare).map(s => s.candidate);
    }
    materializeResult(candidate, terms, scoringTerms, searchContent, searchFrontmatter, caseSensitive, includeRevision, filterReasons = []) {
        const document = this.documentsById.get(candidate.documentId);
        if (!document)
            throw new Error(`Search document disappeared: ${candidate.documentId}`);
        let searchableText = '';
        if (searchContent && searchFrontmatter)
            searchableText = `${document.frontmatterText || ''}\n${document.body || ''}`;
        else if (searchContent)
            searchableText = document.body || '';
        else if (searchFrontmatter)
            searchableText = document.frontmatterText || '';
        const searchIn = caseSensitive ? searchableText : searchableText.toLowerCase();
        let excerpt;
        let matchCount = candidate.filenameMatch ? 1 : 0;
        if (candidate.authorityTermMatch)
            matchCount += 1;
        if (candidate.authorityExpansion)
            matchCount += 1;
        if (candidate.retrievalCueMatch)
            matchCount += 1;
        let lineNumber = 0;
        if (candidate.firstIndex !== -1) {
            const firstTerm = terms[candidate.firstTermIndex];
            const excerptStart = Math.max(0, candidate.firstIndex - 21);
            const excerptEnd = Math.min(searchableText.length, candidate.firstIndex + firstTerm.length + 21);
            excerpt = searchableText.slice(excerptStart, excerptEnd).trim();
            if (excerptStart > 0)
                excerpt = `...${excerpt}`;
            if (excerptEnd < searchableText.length)
                excerpt = `${excerpt}...`;
            for (const term of scoringTerms) {
                let count = 0;
                let searchIndex = 0;
                while ((searchIndex = searchIn.indexOf(term, searchIndex)) !== -1) {
                    count += 1;
                    searchIndex += term.length;
                }
                matchCount += count;
            }
            lineNumber = searchableText.slice(0, candidate.firstIndex).split('\n').length;
        }
        else {
            excerpt = searchableText.slice(0, 50).trim();
            if (searchableText.length > 50)
                excerpt = `${excerpt}...`;
        }
        const next = document.isWiki
            ? (candidate.authorityTermMatch || candidate.authorityExpansion || candidate.retrievalCueMatch
                ? 'read_projection'
                : candidate.firstIndex !== -1 ? 'read_section' : 'verify_evidence')
            : 'read_section';
        const authorityReason = candidate.authorityExpansion?.relation === 'authority_id' ? 'authority_id_match'
            : candidate.authorityExpansion?.relation === 'same_as' ? 'same_as_match'
                : candidate.authorityExpansion?.relation === 'close_match' ? 'close_match'
                    : candidate.authorityExpansion?.relation === 'broader' ? 'broader_term_match'
                        : candidate.authorityExpansion?.relation === 'related' ? 'related_term_match'
                            : undefined;
        return {
            p: document.relativePath,
            t: candidate.title,
            ex: excerpt,
            mc: matchCount,
            ln: lineNumber,
            uri: generateObsidianUri(this.vaultPath, document.relativePath),
            ...(document.isWiki && { wk: true }),
            why: [
                ...filterReasons,
                ...(document.isWiki ? ['wiki_priority'] : []),
                ...(candidate.filenameMatch ? ['title_match'] : []),
                ...(candidate.authorityTermMatch && !candidate.filenameMatch ? ['alias_match'] : []),
                ...(authorityReason ? [authorityReason] : []),
                ...(candidate.retrievalCueMatch ? ['retrieval_cue_match'] : []),
                ...(candidate.firstIndex !== -1 && searchFrontmatter && candidate.firstIndex < (document.frontmatterText || '').length ? ['frontmatter_match'] : []),
                ...(candidate.firstIndex !== -1 && (!searchFrontmatter || candidate.firstIndex >= (document.frontmatterText || '').length) ? ['content_match'] : []),
            ],
            fresh: 'current',
            next,
            ...(candidate.retrievalCueMatch && document.retrievalCues.length > 0 && { rc: document.retrievalCues.slice(0, 4) }),
            ...(candidate.retrievalCueMatch && document.useWhen && { uw: document.useWhen.slice(0, 280) }),
            ...(includeRevision && { rv: document.revision }),
            ...(candidate.authorityExpansion && { au: candidate.authorityExpansion }),
        };
    }
}
function countWords(value) {
    let count = 0;
    let inWord = false;
    for (const character of value) {
        if (/\s/.test(character)) {
            inWord = false;
        }
        else if (!inWord) {
            inWord = true;
            count += 1;
        }
    }
    return count;
}
function grams(value) {
    const output = new Set();
    for (let index = 0; index <= value.length - NGRAM_SIZE; index += 1) {
        output.add(value.slice(index, index + NGRAM_SIZE));
    }
    return output;
}
