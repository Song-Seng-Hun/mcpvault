export interface ProjectPacketOptions {
    offset?: number;
    expectedSnapshot?: string;
    prettyPrint?: boolean;
}
/** Budget the final public representation; never clip source identities. */
export declare function packProjectPacket(rows: Array<Record<string, any>>, metadata: Record<string, any>, limit: number, maxChars: number, options?: ProjectPacketOptions): Record<string, any>;
//# sourceMappingURL=project-packet.d.ts.map