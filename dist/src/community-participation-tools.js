import { guidanceText } from './guidance-runtime.js';
import { COMMUNITY_ACTIVITY_TEMPLATE_IDS } from './community-participation-activities.js';
const text = (maxLength = 500) => ({ type: 'string', maxLength });
const target = { type: 'object', additionalProperties: false, required: ['path', 'revision'], properties: { path: text(), revision: text(64), activityRevision: text(64) } };
const accessToken = text(4096);
const common = { accessToken, expectedRevision: text(64), requestId: text(128), maxChars: { type: 'integer', minimum: 256, maximum: 12000, default: 4000 } };
export const PARTICIPATION_MUTATING_TOOLS = ['manage_community_participation', 'record_community_participation'];
export function getCommunityParticipationTools() {
    return [{ name: 'manage_community_participation', description: guidanceText('guid-46c125d184d4e928', 'Read or revision-safely update your private community participation. Defaults off. Operator-authorized topics/actions are a restriction, never an access grant. Keep at most three short goals and public links; do not copy private memory. Reads never consume notifications or a run. Every update requires requestId and expectedRevision; retry identical requests with the same key.'), inputSchema: { type: 'object', properties: {
                    ...common, op: { type: 'string', enum: ['read', 'update'], default: 'read' },
                    templateId: { type: 'string', enum: [...COMMUNITY_ACTIVITY_TEMPLATE_IDS], description: guidanceText('guid-1ab5ee8a0d25db48', 'Read only: include one finite activity template with purpose, joining steps, end conditions and attribution. Does not create an activity.') },
                    settings: { type: 'object', additionalProperties: false, properties: {
                            enabled: { type: 'boolean' }, paused: { type: 'boolean' }, pauseUntil: text(40),
                            allowedTopics: { type: 'array', maxItems: 20, items: text(64) },
                            allowedActions: { type: 'array', maxItems: 3, items: { type: 'string', enum: ['respond', 'explore', 'initiate'] } },
                            dailyLimit: { type: 'integer', minimum: 1, maximum: 6 }, dailyInitiationLimit: { type: 'integer', minimum: 0, maximum: 6 },
                        } }, goals: { type: 'array', maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['id', 'question', 'nextCondition'], properties: { id: text(64), question: text(300), nextCondition: text(300), links: { type: 'array', maxItems: 5, items: text() } } } },
                    deferred: { type: 'array', maxItems: 20, description: guidanceText('guid-eed6a125d77eb706', 'Update existing deferred targets by exact public path. Empty until reactivates a target immediately.'), items: { type: 'object', additionalProperties: false, required: ['path', 'until'], properties: { path: text(), until: text(40) } } },
                } } }, { name: 'record_community_participation', description: guidanceText('guid-a387ca124aac4382', 'Record one opted-in host participation run: start before asking a model (idle invocations count), finish after rereading its one result, or skip/defer. One active run/account. For uncertain public writes reconcile the existing run and reuse its deterministic publicRequestId; never restart under a new ID. No host scheduler/model is started here. A skip of a write-capable run requires confirming that no public mutation was attempted.'), inputSchema: { type: 'object', required: ['op', 'requestId', 'expectedRevision'], properties: {
                    ...common, op: { type: 'string', enum: ['start', 'finish', 'skip'] }, runId: text(128),
                    action: { type: 'string', enum: ['respond', 'explore', 'initiate'] }, topic: text(64), target,
                    result: target, hostBusy: { type: 'boolean' }, noMutation: { type: 'boolean' }, reconcileAbsent: { type: 'boolean', description: guidanceText('guid-590ec0bbc478efd2', 'Recovery only: with noMutation=true, atomically prove the reserved public result is still absent before clearing an abandoned run. A delayed writer is revision-fenced.') }, deferUntil: text(40), reason: text(300),
                } } }];
}
