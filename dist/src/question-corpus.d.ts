export type CorpusLanguage = 'ko' | 'en' | 'mixed';
export interface CorpusNote {
    path: string;
    content: string;
}
export interface CorpusQuestion {
    id: string;
    language: CorpusLanguage;
    category: string;
    query: string;
    expectedPaths: string[];
    expectedEvidence: Record<string, string[]>;
}
export interface AnswerPacket {
    sources?: readonly ({
        path: string;
        passages?: readonly {
            text: string;
        }[];
    } | string)[];
    candidates?: readonly ({
        path: string;
    } | string)[];
    passages?: readonly {
        text: string;
    }[];
}
export interface BaselineMetrics {
    recallAt5: number;
    mrr: number;
}
export interface PacketEvaluation {
    rankings: string[][];
    recallAt5: number;
    mrr: number;
    evidenceCoverage: number;
    resultChars: number;
    latencyMs: number[];
    bodyReads: number;
}
/** Measured before answer_packet existed; do not replace with post-change values. */
export declare const fixedLexicalBaseline: BaselineMetrics;
export declare const corpusNotes: CorpusNote[];
export declare const corpusQuestions: CorpusQuestion[];
export declare function recallAt5(questions: readonly CorpusQuestion[], rankings: readonly (readonly string[])[]): number;
export declare function meanReciprocalRank(questions: readonly CorpusQuestion[], rankings: readonly (readonly string[])[]): number;
export declare function answerPacketRanking(packet: AnswerPacket): string[];
export declare function evaluateAnswerPackets(questions: readonly CorpusQuestion[], packets: readonly AnswerPacket[], timings?: readonly number[], bodyReads?: number): PacketEvaluation;
export declare function hasNoMetricRegression(metrics: Pick<PacketEvaluation, 'recallAt5' | 'mrr'>, baseline?: BaselineMetrics): boolean;
//# sourceMappingURL=question-corpus.d.ts.map