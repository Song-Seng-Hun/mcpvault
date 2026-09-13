const safe = (text) => typeof text === 'string' && text.length > 0 && text.length <= 200
    && text.trim() === text && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(text);
export function displayScopedName(names, basis, mode = 'en') {
    if (!Array.isArray(names) || names.length > 128 || !basis || ![basis.entityId, basis.project, basis.version, basis.language].every(safe)
        || !['en', 'ko-ui'].includes(mode))
        return { status: 'unavailable' };
    const matches = names.filter(n => n && n.entityId === basis.entityId && n.project === basis.project && n.version === basis.version && n.language === basis.language);
    if (matches.length > 1)
        return { status: 'ambiguous' };
    const name = matches[0];
    if (!name || !safe(name.original) || typeof name.englishVerified !== 'boolean'
        || name.english !== undefined && !safe(name.english))
        return { status: 'unavailable' };
    if (!name.englishVerified || !name.english || name.english === name.original)
        return { status: 'resolved', text: name.original };
    return { status: 'resolved', text: mode === 'ko-ui' ? `${name.original} (${name.english})` : `${name.english} (${name.original})` };
}
