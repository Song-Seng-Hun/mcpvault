/** Fiction is a content-routing marker, never an authorization grant. */
export function isFictionDomain(frontmatter) {
    if (frontmatter.mcpvault_type === 'roleplay_turn')
        return true;
    const value = frontmatter.fiction_domain;
    if (typeof value === 'string')
        return value.length > 0;
    if (Array.isArray(value))
        return value.length > 0;
    return value !== undefined && value !== null && value !== false;
}
/** Roleplay services must opt in explicitly and still enforce normal access. */
export function roleplayOnly() {
    return { fictionDomain: 'only' };
}
