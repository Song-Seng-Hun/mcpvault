type Row = Record<string, any>;
export type OrganizationQueuePacket = Row & {
    items: Row[];
    total: number;
    truncated: boolean;
};
/** Final wire projection over an already ranked, visibility-filtered queue. */
export declare function packOrganizationQueue(result: OrganizationQueuePacket, endpointId: string, maxChars: number, ceiling: number, prettyPrint?: boolean): OrganizationQueuePacket;
export {};
//# sourceMappingURL=organization-queue-packet.d.ts.map