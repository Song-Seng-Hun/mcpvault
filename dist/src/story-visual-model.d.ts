export interface StoryVisualEvent {
    id: string;
    actorId: string;
    targetId?: string;
    locationId?: string;
    action: string;
    basis: 'stated' | 'inferred' | 'uncertain';
    passage: {
        start: number;
        end: number;
        quote: string;
    };
}
export interface StoryVisualModel {
    events: StoryVisualEvent[];
}
export type StoryVisualIntent = {
    type: 'move_entity';
    eventIds: string[];
    actorId: string;
    locationId: string;
} | {
    type: 'set_action';
    eventIds: string[];
    action: string;
} | {
    type: 'reorder_events';
    eventIds: string[];
};
export interface StoryVisualChange {
    eventId: string;
    start: number;
    end: number;
    before: string;
    after: string;
}
export declare function parseStoryVisual(value: unknown): StoryVisualModel;
export declare function assertStoryVisualPassages(model: StoryVisualModel, content: string): void;
export declare function parseStoryVisualIntent(value: unknown, model: StoryVisualModel): StoryVisualIntent;
export declare function applyStoryVisualEdits(model: StoryVisualModel, content: string, intent: StoryVisualIntent, replacements?: unknown): {
    content: string;
    changes: StoryVisualChange[];
};
//# sourceMappingURL=story-visual-model.d.ts.map