import { FrontmatterHandler } from './frontmatter.js';
/** Fiction is a content-routing marker, never an authorization grant. */
export function isFictionDomain(frontmatter, path) {
    // Raw export formats cannot all carry YAML. The managed story tree is an
    // explicit fiction-routing boundary, not an ACL or an evidence guarantee.
    if (path && /^Community\/Stories\/[a-z0-9][a-z0-9-]{0,63}\//i.test(path.replace(/\\/g, '/')))
        return true;
    if (frontmatter.mcpvault_type === 'roleplay_turn')
        return true;
    const value = frontmatter.fiction_domain;
    if (typeof value === 'string')
        return value.length > 0;
    if (Array.isArray(value))
        return value.length > 0;
    return value !== undefined && value !== null && value !== false;
}
/** Index preparation uses the same data-only Markdown parser as current reads,
 * including BOM and JSON Properties. Classification is never an ACL. */
export function isFictionMarkdown(raw, path) {
    return isFictionDomain(new FrontmatterHandler().parse(raw).frontmatter, path);
}
/** Roleplay services must opt in explicitly and still enforce normal access. */
export function roleplayOnly() {
    return { fictionDomain: 'only' };
}
