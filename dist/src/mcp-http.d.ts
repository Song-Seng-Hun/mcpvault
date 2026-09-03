import { type Server as HttpServer } from 'node:http';
import { type Server as HttpsServer } from 'node:https';
import { type Server } from '@modelcontextprotocol/server';
export interface McpHttpOptions {
    host?: string;
    port?: number;
    path?: string;
    maxBodyBytes?: number;
    allowedOrigins?: string[];
    allowedHosts?: string[];
    maxConnections?: number;
    tls?: {
        key: string | Buffer;
        cert: string | Buffer;
        ca?: string | Buffer;
        requestCert?: boolean;
        rejectUnauthorized?: boolean;
    };
}
export interface McpHttpHandle {
    server: HttpServer | HttpsServer;
    host: string;
    port: number;
    path: string;
    protocol: 'http' | 'https';
    close(): Promise<void>;
}
/**
 * Expose MCP 2026-07-28 Stateless Streamable HTTP. The long-lived MCPVault
 * runtime stays behind the adapter; createMcpHandler receives a fresh low-level
 * Server for every HTTP request, preventing transport/server state from being
 * shared across clients.
 */
export declare function startMcpHttpApi(server: Server, options?: McpHttpOptions): Promise<McpHttpHandle>;
//# sourceMappingURL=mcp-http.d.ts.map