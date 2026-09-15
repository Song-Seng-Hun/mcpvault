/** Fixed, host-owned subprocess entry. Bundled skill files are DATA only. */
import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, readSync, fstatSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { snapshotSkillBundle } from './skill-review-inventory.js';
import { FrontmatterHandler } from './frontmatter.js';
import { isModerationHidden } from './moderation-policy.js';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const stamp = (s) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.nlink}`;
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
async function inspect(input) {
    if (!input || typeof input !== 'object' || Object.keys(input).length !== 1 || !('root' in input) || typeof input.root !== 'string' || !isAbsolute(input.root))
        return null;
    const root = resolve(input.root), inventory = await snapshotSkillBundle(root);
    if (!inventory.complete || !inventory.files.some(f => f.path === 'SKILL.md'))
        return null;
    let visible = true;
    const parser = new FrontmatterHandler();
    for (const file of inventory.files) {
        if (!/\.md$/i.test(file.path))
            continue;
        if (file.bytes > 2 * 1024 * 1024)
            return null;
        const path = join(root, file.path), before = lstatSync(path);
        if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1 || before.size !== file.bytes || !same(realpathSync(path), path))
            return null;
        const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        let bytes;
        try {
            if (stamp(fstatSync(fd)) !== stamp(before))
                return null;
            bytes = Buffer.alloc(file.bytes);
            let offset = 0;
            while (offset < bytes.length) {
                const n = readSync(fd, bytes, offset, bytes.length - offset, offset);
                if (!n)
                    return null;
                offset += n;
            }
            if (stamp(fstatSync(fd)) !== stamp(before) || stamp(lstatSync(path)) !== stamp(before) || !same(realpathSync(path), path) || sha(bytes) !== file.sha256)
                return null;
        }
        finally {
            closeSync(fd);
        }
        const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes), parsed = parser.parse(content);
        if (content.replace(/^\uFEFF/, '').startsWith('---') && !parsed.matter)
            visible = false;
        if (isModerationHidden(parsed.frontmatter))
            visible = false;
    }
    const result = { inventory, visible };
    return JSON.stringify(result).length <= 2 * 1024 * 1024 ? result : null;
}
if (process.send) {
    process.once('message', input => {
        void inspect(input).catch(() => null).then(result => {
            process.send?.(result, () => { process.disconnect?.(); });
        });
    });
}
