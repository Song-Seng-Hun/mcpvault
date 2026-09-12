import { expect, test } from 'vitest';
import { parseEnterpriseServerArgs } from '../enterprise-server.js';

const required = ['--registry', 'registry.json', '--realm', 'realm', '--host', '127.0.0.1', '--port', '0', '--cert', 'cert.pem', '--key', 'key.pem', '--ca', 'ca.pem'];
test('enterprise host feature selection uses the same explicit config file without granting federation', () => {
  expect(parseEnterpriseServerArgs([...required, '--features-config', 'features.json'])).toMatchObject({ featuresConfigPath: 'features.json' });
  expect(parseEnterpriseServerArgs(required)).not.toHaveProperty('featuresConfigPath');
  expect(() => parseEnterpriseServerArgs([...required, '--features-config', 'one', '--features-config', 'two'])).toThrow(/duplicate/i);
});

test('enterprise CLI accepts a separately approved owner activity configuration', () => {
  expect(parseEnterpriseServerArgs([...required, '--owner-activity-config', 'owner.json'])).toMatchObject({ ownerActivityConfigPath: 'owner.json' });
  expect(parseEnterpriseServerArgs(required)).not.toHaveProperty('ownerActivityConfigPath');
});
