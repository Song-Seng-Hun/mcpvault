import { expect, test } from 'vitest';
import { decodeCodexHookEvent, validateCodexHookConfig } from './codex-hook-policy.js';

const definition = { version: 1, enabled: true, accountId: 'operator', projects: [{ id: 'p', workspace: 'E:/dev/wiki',
  definitionHash: 'a'.repeat(64), events: ['SessionStart', 'Stop'], actions: ['resume', 'compilation'], paths: ['Note.md'] }] };
test('hook input keeps only bounded routing metadata; transcripts, prompts and permissions are never authority', () => {
  expect(decodeCodexHookEvent(JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'session-1',
    transcript_path: 'secret', prompt: 'secret', permission_mode: 'default', cwd: 'elsewhere', tool_response: { secret: true } })))
    .toEqual({ event: 'SessionStart', sessionId: 'session-1', reentrant: false });
});
test.each(['PostToolUse', 'PreCompact', 'PostCompact', 'SessionEnd', 'UserPromptSubmit', 'Stop', 'Interrupt'])('recognizes %s without collecting text', event => {
  expect(decodeCodexHookEvent(JSON.stringify({ hook_event_name: event, session_id: 's', stop_hook_active: true })))
    .toEqual({ event, sessionId: 's', reentrant: true });
});
test.each([{}, { hook_event_name: 'PreToolUse', session_id: 's' }, { hook_event_name: 'SessionStart', session_id: '../s' },
  { hook_event_name: 'Stop', session_id: 's', stop_hook_active: 'false' }])('rejects unsupported or malformed routing data', value => {
  expect(() => decodeCodexHookEvent(JSON.stringify(value))).toThrow('Hook input unavailable');
});
test('limits UTF8 payload before parsing and hides parse errors', () => {
  for (const input of ['{private-secret', '😀'.repeat(9000)]) expect(() => decodeCodexHookEvent(input)).toThrow('Hook input unavailable');
});
test('host configuration is separate, explicit and immutable after validation', () => {
  const input = structuredClone(definition), result = validateCodexHookConfig(input);
  input.projects[0]!.paths.push('Other.md'); expect(result.projects[0]!.paths).toEqual(['Note.md']);
});
test.each([
  { maintenance: true }, { projects: [] }, { accountId: 'ADMIN' },
  { projects: [{ ...definition.projects[0], workspace: 'relative' }] },
  { projects: [{ ...definition.projects[0], workspace: 'E:/dev/../secret' }] },
  { projects: [{ ...definition.projects[0], paths: ['../Secret.md'] }] },
  { projects: [{ ...definition.projects[0], actions: ['arbitrary_endpoint'] }] },
  { projects: [{ ...definition.projects[0], events: ['WebSearch'] }] },
  { projects: [{ ...definition.projects[0], definitionHash: 'trusted' }] },
])('rejects implicit grants, ambiguous paths and unverified definitions', change => {
  expect(() => validateCodexHookConfig({ ...definition, ...change })).toThrow('Invalid hook configuration');
});
