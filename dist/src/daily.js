import { guidanceError } from './guidance-runtime.js';
export function resolveDailyDate(input = 'today', now = new Date()) {
    const value = input.trim().toLowerCase();
    const offset = value === 'yesterday' ? -1 : value === 'tomorrow' ? 1 : 0;
    if (value !== 'today' && value !== 'yesterday' && value !== 'tomorrow') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            throw guidanceError(new Error('date must be today, yesterday, tomorrow, or YYYY-MM-DD'), 'guid-238785a1b8d06f0c');
        }
        const [year, month, day] = value.split('-').map(Number);
        const parsed = new Date(Date.UTC(year, month - 1, day));
        if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
            throw guidanceError(new Error(`Invalid calendar date: ${input}`), 'guid-ce4ce1aa31c833ea');
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
