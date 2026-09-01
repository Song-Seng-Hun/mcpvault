import type { ScopePrincipal } from './scope-auth.js';
import type { SocialService } from './social.js';
import type { ChatService } from './chat.js';
type ContextType = 'post' | 'comment' | 'room' | 'message';
/**
 * Builds a bounded, navigable context packet from the existing Markdown
 * services. It is deliberately a read model, not a second content database.
 */
export declare class ContextService {
    private readonly social;
    private readonly chat;
    constructor(social: SocialService, chat: ChatService);
    read(params: {
        principal?: ScopePrincipal;
        targetType: ContextType;
        slug?: string;
        commentId?: string;
        roomId?: string;
        messageId?: string;
        contextBefore?: number;
        contextAfter?: number;
        maxChars?: number;
        includeReferences?: boolean;
    }): Promise<Record<string, unknown>>;
}
export {};
//# sourceMappingURL=context.d.ts.map