import type { Tool } from '@modelcontextprotocol/server';
/** Parent wiring: register this tool as roleplay.trpg, dispatch to service.execute('trpg'),
 * and classify only read/export/respec_preview as reads. */
export declare const ROLEPLAY_TRPG_ENDPOINT: {
    readonly toolName: 'manage_roleplay_trpg';
    readonly endpointId: 'roleplay.trpg';
    readonly serviceEndpoint: 'trpg';
    readonly readOperations: readonly ['read', 'export', 'respec_preview'];
    readonly publicReadOperations: readonly ['read', 'export'];
    readonly authenticatedCapability: 'chat';
    readonly aliases: {
        readonly read_roleplay_trpg: readonly ['read', 'export'];
        readonly preview_roleplay_trpg: readonly ['respec_preview'];
    };
    readonly projectionOperations: readonly ['project'];
    readonly operationMap: {
        readonly adopt: 'trpg_adopt';
        readonly learn: 'trpg_learn';
        readonly loadout: 'trpg_loadout';
        readonly switch: 'trpg_switch';
        readonly respec: 'trpg_respec';
        readonly rest: 'trpg_rest';
        readonly growth: 'trpg_growth';
        readonly encounter_start: 'trpg_encounter_start';
        readonly encounter_end: 'trpg_encounter_end';
        readonly turn_end: 'trpg_turn_end';
        readonly act: 'trpg_act';
    };
};
export declare const ROLEPLAY_MUTATING_TOOLS: readonly ['manage_roleplay_world', 'manage_roleplay_character', 'manage_roleplay_scene', 'submit_roleplay_action', 'resolve_roleplay_action', 'correct_roleplay_turn', 'manage_roleplay_evolution', 'manage_roleplay_trpg'];
export declare function getRoleplayTools(): Tool[];
//# sourceMappingURL=roleplay-tools.d.ts.map