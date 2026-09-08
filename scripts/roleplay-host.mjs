#!/usr/bin/env node
// Deliberately not a package command or MCP endpoint: this is explicit host-only recovery.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [operation, vaultPath, configPath, expectedFingerprint, reason] = process.argv.slice(2);
const usage = 'Usage: node scripts/roleplay-host.mjs inspect <vaultPath> <privateConfigPath> | recover <vaultPath> <privateConfigPath> <expectedFingerprint> <reason>';
const argumentCount = process.argv.length - 2;
if (!['inspect', 'recover'].includes(operation) || !vaultPath || !configPath || (operation === 'inspect' && argumentCount !== 3) || (operation === 'recover' && (argumentCount !== 5 || !expectedFingerprint || !reason))) {
  console.error(usage); process.exitCode = 2;
} else {
  try {
    const { loadRoleplayHostConfig } = await import(pathToFileURL(resolve('dist/src/roleplay-host.js')).href);
    const { inspectRoleplayRecovery, recoverRoleplayWriter } = await import(pathToFileURL(resolve('dist/src/roleplay-recovery.js')).href);
    const options = await loadRoleplayHostConfig(resolve(configPath), resolve(vaultPath));
    const result = operation === 'inspect'
      ? await inspectRoleplayRecovery(options)
      : await recoverRoleplayWriter(options, { expectedFingerprint, reason });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Roleplay host recovery failed'); process.exitCode = 1;
  }
}
