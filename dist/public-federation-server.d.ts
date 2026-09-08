#!/usr/bin/env node
import { type PublicFederationHubHttpHandle } from './src/public-federation-http.js';
/** The config contains Hub publishing credentials and belongs in the host secret directory. */
export declare function runPublicFederationServer(args: string[], log?: (line: string) => void): Promise<PublicFederationHubHttpHandle | undefined>;
//# sourceMappingURL=public-federation-server.d.ts.map