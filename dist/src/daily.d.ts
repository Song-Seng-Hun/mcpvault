export type DailyDateInput = 'today' | 'yesterday' | 'tomorrow' | string;
export declare function resolveDailyDate(input?: DailyDateInput, now?: Date): string;
export declare function buildDailyNotePath(folder?: string, date?: string): string;
//# sourceMappingURL=daily.d.ts.map