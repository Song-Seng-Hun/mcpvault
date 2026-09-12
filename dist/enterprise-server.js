#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { enterpriseServerHelp, startEnterpriseServer, } from './src/enterprise-server.js';
const OPTION_NAMES = new Set(['registry', 'realm', 'host', 'port', 'cert', 'key', 'ca', 'federation-config', 'global-import-config', 'features-config', 'owner-activity-config']);
function required(options, name) {
    const value = options.get(name);
    if (!value)
        throw new Error(`--${name} is required`);
    return value;
}
export function parseEnterpriseServerArgs(argv) {
    const options = new Map();
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--') || token.length === 2)
            throw new Error(`Unexpected argument: ${token}`);
        const name = token.slice(2);
        if (!OPTION_NAMES.has(name))
            throw new Error(`Unknown option: --${name}`);
        if (options.has(name))
            throw new Error(`Duplicate option: --${name}`);
        const value = argv[index + 1];
        if (!value || value.startsWith('--'))
            throw new Error(`--${name} requires a value`);
        options.set(name, value);
        index += 1;
    }
    const portValue = required(options, 'port');
    if (!/^\d+$/.test(portValue))
        throw new Error('--port must be an integer from 0 through 65535');
    const port = Number(portValue);
    if (!Number.isSafeInteger(port) || port < 0 || port > 65_535)
        throw new Error('--port must be an integer from 0 through 65535');
    const federationConfigPath = options.get('federation-config');
    const globalImportConfigPath = options.get('global-import-config');
    const featuresConfigPath = options.get('features-config');
    const ownerActivityConfigPath = options.get('owner-activity-config');
    return {
        registryPath: required(options, 'registry'),
        realmId: required(options, 'realm'),
        host: required(options, 'host'),
        port,
        certPath: required(options, 'cert'),
        keyPath: required(options, 'key'),
        caPath: required(options, 'ca'),
        ...(federationConfigPath && { federationConfigPath }),
        ...(globalImportConfigPath && { globalImportConfigPath }),
        ...(featuresConfigPath && { featuresConfigPath }),
        ...(ownerActivityConfigPath && { ownerActivityConfigPath }),
    };
}
export async function runEnterpriseServer(argv, io = { stdout: console.log, stderr: console.error }) {
    if (argv.length === 1 && argv[0] === '--help') {
        io.stdout(enterpriseServerHelp());
        return undefined;
    }
    if (argv.length === 0)
        throw new Error(enterpriseServerHelp());
    const handle = await startEnterpriseServer(parseEnterpriseServerArgs(argv));
    if (handle.globalImport) {
        const progress = handle.globalImport;
        io.stderr(`Global import: ${progress.status}; cursor=${progress.cursor}; pages=${progress.pages}; hasMore=${progress.hasMore}; conflicts=${progress.conflicts.length}; appliedListComplete=${progress.appliedListComplete}`);
    }
    io.stderr(`MCPVault enterprise server listening on https://${handle.host}:${handle.port}${handle.path} (realm ${handle.realmId})`);
    return handle;
}
async function main() {
    let handle;
    try {
        handle = await runEnterpriseServer(process.argv.slice(2));
    }
    catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
    }
    if (!handle)
        return;
    let closing = false;
    const close = async () => {
        if (closing)
            return;
        closing = true;
        try {
            await handle.close();
        }
        catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    await main();
}
