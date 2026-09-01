import { type Server as HttpServer } from 'node:http';
import type { Server } from '@modelcontextprotocol/server';
export interface RestApiOptions {
    host?: string;
    port?: number;
    maxBodyBytes?: number;
}
export interface RestApiHandle {
    server: HttpServer;
    host: string;
    port: number;
    close(): Promise<void>;
}
/**
 * Start the optional HTTP adapter on the same service runtime as the MCP
 * server. The adapter is localhost-only by default and never starts unless a
 * host explicitly opts into it.
 */
export declare function startRestApi(server: Server, options?: RestApiOptions): Promise<RestApiHandle>;
//# sourceMappingURL=rest-api.d.ts.map