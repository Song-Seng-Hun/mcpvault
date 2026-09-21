import type { IncomingMessage } from 'node:http';
import type { Server as HttpServer } from 'node:http';
export declare const MAX_HTTP_BODY_BYTES: number;
export declare function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<string>;
export declare function isLoopbackHost(host: string): boolean;
export declare function requestHost(request: IncomingMessage): string | undefined;
export declare function originAllowed(request: IncomingMessage, allowedOrigins: readonly string[]): boolean;
export declare function createRateLimiter(windowMs: number, maxRequests: number, maxBuckets: number): (key: string) => boolean;
export declare function configureHttpServer(server: HttpServer, maxConnections: number | undefined): void;
//# sourceMappingURL=http-request-utils.d.ts.map