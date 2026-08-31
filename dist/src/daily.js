export function resolveDailyDate(input = 'today', now = new Date()) {
    const value = input.trim().toLowerCase();
    const offset = value === 'yesterday' ? -1 : value === 'tomorrow' ? 1 : 0;
    if (value !== 'today' && value !== 'yesterday' && value !== 'tomorrow') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            throw new Error('date must be today, yesterday, tomorrow, or YYYY-MM-DD');
        }
        const [year, month, day] = value.split('-').map(Number);
        const parsed = new Date(Date.UTC(year, month - 1, day));
        if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
            throw new Error(`Invalid calendar date: ${input}`);
        }
        return value;
    }
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
        .map((part, index) => index === 0 ? String(part).padStart(4, '0') : String(part).padStart(2, '0'))
        .join('-');
}
export function buildDailyNotePath(folder = 'Daily Notes', date = resolveDailyDate()) {
    const normalizedFolder = folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return normalizedFolder ? `${normalizedFolder}/${date}.md` : `${date}.md`;
}
