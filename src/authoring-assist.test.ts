import { expect, test } from 'vitest';
import { authoringAssist, hostPluginBundle, propertyContractFingerprint } from './authoring-assist.js';
import { getOrganizationPropertyContract, organizationNoteTemplate } from './organization.js';

test('authoring routes knowledge and capture to existing executors', () => {
  expect(authoringAssist('atomic', {}).nextAction.endpointId).toBe('wiki.preflight');
  expect(authoringAssist('atomic', { intent: 'capture' }).nextAction.endpointId).toBe('wiki.capture');
  expect(authoringAssist('project', {}).missing).toContain('desired_outcome');
});
test('template fields and host fileClass share one canonical contract fingerprint with safe types only', () => {
  const assist = authoringAssist('atomic', {}); const bundle = hostPluginBundle();
  expect(assist.contractFingerprint).toBe(propertyContractFingerprint());
  expect(bundle.fingerprint).toBe(`sha256:${assist.contractFingerprint}`);
  expect(assist.defaults).toEqual(organizationNoteTemplate('atomic').properties);
  expect(getOrganizationPropertyContract().find(row => row.name === 'title')?.type).toBe('text');
  expect(bundle.templates[0]!.path).toBe('Templates/MCPVault/Inbox.md');
  expect(bundle.templates[0]!.content).not.toMatch(/<%|\{\{JS|title:.*VALUE/);
  expect(bundle.fileClasses[0]!.content).toContain('name: title');
  expect(bundle.fileClasses[0]!.content).toContain('name: tags');
  expect(bundle.fileClasses[0]!.content).not.toMatch(/name: (scope|review|auth)/);
});
test('authoring accepts values as inert data and never echoes executable or hidden input', () => {
  const result = authoringAssist('atomic', { provided: { title: '<% process.exit() %>', scope: 'private', content: 'secret body' } });
  expect(result.missing).not.toContain('title');
  expect(JSON.stringify(result)).not.toMatch(/process.exit|secret body/);
});
