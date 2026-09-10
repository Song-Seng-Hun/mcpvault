import { guidanceError } from './guidance-runtime.js';
import { open, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { FrontmatterHandler } from './frontmatter.js';
import { isModerationHidden } from './moderation-policy.js';
import { assertEnterpriseStorageAccess } from './enterprise-storage-context.js';
import { resourceBundleLocation, parseResourceBundleManifest } from './resource-bundle.js';
const TEXT_MEDIA = {
    '.md': 'text/markdown', '.markdown': 'text/markdown', '.txt': 'text/plain',
    '.sh': 'text/x-shellscript', '.bash': 'text/x-shellscript', '.zsh': 'text/x-shellscript',
    '.ps1': 'text/plain', '.py': 'text/x-python', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.cjs': 'text/javascript', '.ts': 'text/plain', '.json': 'application/json',
    '.yaml': 'application/yaml', '.yml': 'application/yaml', '.toml': 'application/toml',
    '.csv': 'text/csv', '.ini': 'text/plain', '.cfg': 'text/plain', '.sql': 'text/plain',
    '.css': 'text/css', '.html': 'text/html', '.xml': 'application/xml', '.svg': 'image/svg+xml',
    '.base': 'application/yaml', '.canvas': 'application/json', '.fountain': 'text/plain',
};
const BINARY_MEDIA = {
    '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp',
};
export function documentMedia(path) {
    const extension = extname(path).toLowerCase();
    if (Object.hasOwn(TEXT_MEDIA, extension))
        return { mediaType: TEXT_MEDIA[extension], text: true };
    if (Object.hasOwn(BINARY_MEDIA, extension))
        return { mediaType: BINARY_MEDIA[extension], text: false };
    if (/(?:^|\/)(?:license|copying)(?:\.[a-z0-9_-]+)?$/i.test(path))
        return { mediaType: 'text/plain', text: true };
    return { mediaType: 'application/octet-stream', text: false };
}
/** Dedicated data-only reader. This does not broaden the ordinary note API or
 * grant execution, host-path, private-scope or managed-resource access. */
export class DocumentResourceReader {
    fs;
    filter;
    access;
    admitted;
    constructor(fs, filter, access, admitted = () => true) {
        this.fs = fs;
        this.filter = filter;
        this.access = access;
        this.admitted = admitted;
    }
    resolve(input, principal) {
        if (typeof input !== 'string' || input.length > 500 || input !== input.trim())
            throw guidanceError(new Error('Invalid document path'), 'guid-4227bee1a646d713');
        const path = this.access.resolveExternalPath(input, principal).replace(/\\/g, '/');
        if (!path || path.split('/').some(part => !part || part === '.' || part === '..' || /[:\x00-\x1f\x7f]/.test(part)
            || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))
            throw guidanceError(new Error('Invalid document path'), 'guid-4227bee1a646d713');
        if (!this.filter.isAllowedForListing(path) || !this.access.canAccessPhysicalPath(path, principal) || !this.admitted(path))
            throw guidanceError(new Error('Document unavailable: access denied'), 'guid-5c944d79d84db6a0');
        assertEnterpriseStorageAccess(path);
        return path;
    }
    canonical(path, principal) {
        // path has already crossed resolveExternalPath. Resolving this physical
        // spelling again would reject an authorized scope://agent URI after expansion.
        if (!this.filter.isAllowedForListing(path) || !this.access.canAccessPhysicalPath(path, principal) || !this.admitted(path))
            throw guidanceError(new Error('Document unavailable'), 'guid-9ef06b8861d9b3c6');
        const actual = this.fs.canonicalReferencePath(path);
        const equal = process.platform === 'win32' ? actual.toLowerCase() === path.toLowerCase() : actual === path;
        if (!equal)
            throw guidanceError(new Error('Document canonical aliases and symbolic links are not permitted'), 'guid-3f434b864145afc9');
        if (!this.filter.isAllowedForListing(actual) || !this.access.canAccessPhysicalPath(actual, principal))
            throw guidanceError(new Error('Document unavailable'), 'guid-9ef06b8861d9b3c6');
        assertEnterpriseStorageAccess(actual);
    }
    async read(input, principal, options = {}) {
        const path = this.resolve(input, principal);
        const media = documentMedia(path), ceiling = media.mediaType === 'application/pdf' ? 50 * 1024 * 1024 : 8 * 1024 * 1024;
        const maxBytes = options.maxBytes ?? ceiling;
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > ceiling)
            throw guidanceError(new Error('Invalid document byte budget'), 'guid-cfd4d5b99b1b3c9b');
        if (options.expectedRevision !== undefined && !/^[a-f0-9]{64}$/.test(options.expectedRevision))
            throw guidanceError(new Error('Invalid document revision'), 'guid-5fa1120c58291289');
        this.canonical(path, principal);
        const fullPath = join(this.fs.getVaultPath(), path);
        const handle = await open(fullPath, 'r');
        try {
            const before = await handle.stat();
            if (!before.isFile() || before.size > maxBytes)
                throw guidanceError(new Error('Document byte budget exceeded or not a regular file'), 'guid-c06d934164e04bc6');
            const chunks = [];
            let length = 0;
            for (;;) {
                const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - length + 1));
                const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
                if (!bytesRead)
                    break;
                length += bytesRead;
                if (length > maxBytes)
                    throw guidanceError(new Error('Document byte budget exceeded'), 'guid-5ffca210c6cbab4b');
                chunks.push(buffer.subarray(0, bytesRead));
            }
            const after = await handle.stat(), current = await stat(fullPath);
            for (const candidate of [after, current]) {
                if (before.size !== candidate.size || before.mtimeMs !== candidate.mtimeMs || before.ctimeMs !== candidate.ctimeMs
                    || before.ino !== candidate.ino || before.dev !== candidate.dev)
                    throw guidanceError(new Error('Document changed during snapshot read'), 'guid-4009a30550b5eaa1');
            }
            this.canonical(path, principal);
            const bytes = Buffer.concat(chunks, length), revision = createHash('sha256').update(bytes).digest('hex');
            if (options.expectedRevision !== undefined && options.expectedRevision !== revision)
                throw guidanceError(new Error('Stale document revision; reread the current outline'), 'guid-c5a49801a6dd4e7b');
            const bundle = resourceBundleLocation(path);
            if (bundle && bundle.relative !== 'manifest.md') {
                if (!bundle.relative.startsWith('files/'))
                    throw guidanceError(new Error('Resource bundle member unavailable'), 'guid-f561038c0f652993');
                const metadata = await this.read(this.access.toPublicPath(`${bundle.root}/manifest.md`), principal, { maxBytes: 256 * 1024 });
                const manifest = parseResourceBundleManifest(metadata.text, bundle.hash);
                const entry = manifest.entries.find(e => e.path === bundle.relative.slice(6));
                if (!entry || entry.status !== 'available' || entry.sha256 !== revision || entry.byteLength !== bytes.length)
                    throw guidanceError(new Error('Resource bundle original hash mismatch or unavailable member'), 'guid-ae671ae1cd8a7579');
            }
            const result = { path, revision, bytes, mediaType: media.mediaType };
            // Raw export must still enforce Markdown/text moderation.
            if (media.text && (options.decodeText !== false || /\.(?:md|markdown|txt)$/i.test(path))) {
                try {
                    result.text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
                }
                catch {
                    throw guidanceError(new Error('Document is not valid UTF-8; retrieve its original bytes instead'), 'guid-77a46a4da95b1c28');
                }
                if (/\.(?:md|markdown|txt)$/i.test(path)) {
                    const parsed = new FrontmatterHandler().parse(result.text);
                    if (isModerationHidden(parsed.frontmatter))
                        throw guidanceError(new Error('Document unavailable'), 'guid-9ef06b8861d9b3c6');
                }
            }
            return result;
        }
        finally {
            await handle.close();
        }
    }
    async assertCurrent(snapshot, principal) {
        await this.read(this.access.toPublicPath(snapshot.path), principal, { expectedRevision: snapshot.revision, decodeText: snapshot.text !== undefined });
    }
}
