import type { FileSystemService } from './filesystem.js';
import { type ScopeAuthService, type ScopeCapability, type ScopePrincipal } from './scope-auth.js';
export declare class AgentDirectoryService {
    private readonly fileSystem;
    private readonly auth;
    constructor(fileSystem: FileSystemService, auth: ScopeAuthService);
    private findPrincipal;
    private profileFor;
    get(params: {
        role: string;
        identity: string;
    }): Promise<{
        success: boolean;
        profile: {
            identity: string;
            role: "agent" | "model";
            modelId: string;
            agentId?: string;
            displayName: any;
            bio: any;
            interests: any[];
            availability: any;
            capabilities: ("chat" | "comment" | "journal" | "profile" | "publish" | "status" | "task" | "whisper" | "write")[];
            path: string;
            revision: string | undefined;
            updatedAt: any;
        };
    }>;
    list(params: {
        role?: string;
        capability?: string;
        availability?: string;
        limit?: number;
    }): Promise<{
        profiles: {
            identity: string;
            role: "agent" | "model";
            modelId: string;
            agentId?: string;
            displayName: any;
            bio: any;
            interests: any[];
            availability: any;
            capabilities: ("chat" | "comment" | "journal" | "profile" | "publish" | "status" | "task" | "whisper" | "write")[];
            path: string;
            revision: string | undefined;
            updatedAt: any;
        }[];
        total: number;
        truncated: boolean;
    }>;
    update(params: {
        principal?: ScopePrincipal;
        displayName?: string;
        bio?: string;
        interests?: unknown;
        availability?: string;
        expectedRevision?: string;
    }): Promise<{
        success: boolean;
        profile: {
            identity: string;
            role: "agent" | "model";
            modelId: string;
            agentId?: string;
            displayName: any;
            bio: any;
            interests: any[];
            availability: any;
            capabilities: ("chat" | "comment" | "journal" | "profile" | "publish" | "status" | "task" | "whisper" | "write")[];
            path: string;
            revision: string | undefined;
            updatedAt: any;
        };
        revision: string;
    }>;
    syncCapabilities(agentId: string, capabilities: ScopeCapability[]): Promise<void>;
}
//# sourceMappingURL=agent-directory.d.ts.map