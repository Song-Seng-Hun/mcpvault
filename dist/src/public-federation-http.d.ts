import type { Server as NetServer } from 'node:net';
import { PublicFederationHub, type PublicFederationEvent, type PublicFederationFeed, type PublicFederationHubOptions, type PublicFederationIdentity, type PublicModerationInput, type PublicPublishInput } from './public-federation.js';
export interface PublicFederationClientOptions {
    baseUrl: string;
    authToken?: string;
}
export declare class PublicFederationHttpError extends Error {
    readonly status: number;
    readonly retryable: boolean;
    constructor(message: string, status: number, retryable: boolean);
}
export declare class PublicFederationClient {
    private readonly baseUrl;
    private readonly authToken;
    constructor(options: PublicFederationClientOptions);
    private request;
    publish(input: PublicPublishInput, idempotencyKey: string): Promise<PublicFederationEvent>;
    moderate(input: PublicModerationInput, idempotencyKey: string): Promise<PublicFederationEvent>;
    getFeed(after?: number, limit?: number): Promise<PublicFederationFeed>;
}
export interface PublicFederationHubHttpOptions extends Omit<PublicFederationHubOptions, 'signingPrivateKey'> {
    host?: string;
    port?: number;
    credentials: Record<string, PublicFederationIdentity>;
    signingKeyPath?: string;
    maxBodyBytes?: number;
    maxConnections?: number;
    tls?: {
        key: string | Buffer;
        cert: string | Buffer;
        ca?: string | Buffer;
        requestCert?: boolean;
        rejectUnauthorized?: boolean;
    };
}
export interface PublicFederationHubHttpHandle {
    server: NetServer;
    host: string;
    port: number;
    hub: PublicFederationHub;
    close(): Promise<void>;
}
export declare function startPublicFederationHub(root: string, options: PublicFederationHubHttpOptions): Promise<PublicFederationHubHttpHandle>;
//# sourceMappingURL=public-federation-http.d.ts.map