export interface CurationDelivery {
    actor: string;
    eventId: string;
    observedAt: number;
    documents: Array<{
        document: string;
        revision: string;
    }>;
}
export interface CurationDeliverySink {
    recordCurationDelivery(event: CurationDelivery): Promise<void>;
}
export interface CurationDeliveryFact {
    observedAt: number;
    revision: string;
}
export declare const curationActor: (account: string) => string;
export declare const curationDocument: (path: string) => string;
/** Positive server-result evidence only. Search cards, suggested reads and text
 * instructions never count as reading or using a document. No raw path persists. */
export declare function deliveredDocuments(endpoint: string, result: any): CurationDelivery['documents'];
//# sourceMappingURL=delivery.d.ts.map