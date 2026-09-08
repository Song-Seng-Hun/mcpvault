#!/usr/bin/env node
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startPublicFederationHub } from './src/public-federation-http.js';
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function isMissing(error) {
    return isRecord(error) && error.code === 'ENOENT';
}
function isInside(parent, target) {
    const relation = relative(parent.toLowerCase(), target.toLowerCase());
    return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}
/** Resolve existing symlink/junction ancestors even when the final path will be created. */
async function canonicalPotentialPath(path) {
    const suffix = [];
    let candidate = resolve(path);
    while (true) {
        try {
            return join(await realpath(candidate), ...suffix.reverse());
        }
        catch (error) {
            if (!isMissing(error))
                throw error;
            const parent = dirname(candidate);
            if (parent === candidate)
                throw error;
            suffix.push(basename(candidate));
            candidate = parent;
        }
    }
}
async function assertFile(path, label) {
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isFile())
        throw new Error(`${label} must identify a file`);
    return canonical;
}
/** The config contains Hub publishing credentials and belongs in the host secret directory. */
export async function runPublicFederationServer(args, log = console.error) {
    if (args.length === 1 && (args[0] === '--help' || args[0] === 'help')) {
        log('Usage: mcpvault-public-hub ABSOLUTE_PRIVATE_CONFIG_JSON');
        return undefined;
    }
    if (args.length !== 1 || !isAbsolute(args[0]))
        throw new Error('An explicit absolute private configuration file is required');
    const configPath = await realpath(args[0]);
    const moduleDirectory = dirname(fileURLToPath(import.meta.url));
    const serviceDirectory = basename(moduleDirectory).toLowerCase() === 'dist' ? dirname(moduleDirectory) : moduleDirectory;
    const service = await realpath(serviceDirectory);
    if (isInside(service, configPath))
        throw new Error('Hub secret configuration must be outside the service checkout');
    if (!(await stat(configPath)).isFile())
        throw new Error('Hub secret configuration must identify a file');
    if ((await stat(configPath)).size > 1024 * 1024)
        throw new Error('Hub configuration exceeds its size limit');
    let parsed;
    try {
        parsed = JSON.parse(await readFile(configPath, 'utf8'));
    }
    catch {
        throw new Error('Hub configuration is invalid JSON');
    }
    if (!isRecord(parsed))
        throw new Error('Hub configuration must be an object');
    const config = parsed;
    const absolute = (key) => {
        if (typeof config[key] !== 'string' || !isAbsolute(config[key]))
            throw new Error(`${key} must be an absolute host-private path`);
        return resolve(config[key]);
    };
    const root = await canonicalPotentialPath(absolute('root'));
    const signingKeyPath = await canonicalPotentialPath(absolute('signingKeyPath'));
    const keyPath = await assertFile(absolute('keyPath'), 'keyPath');
    const certPath = await assertFile(absolute('certPath'), 'certPath');
    for (const [label, path] of [['root', root], ['signingKeyPath', signingKeyPath], ['keyPath', keyPath], ['certPath', certPath]]) {
        if (isInside(service, path))
            throw new Error(`${label} must be outside the service checkout`);
    }
    if (typeof config.host !== 'string' || !config.host || !Number.isSafeInteger(config.port) || Number(config.port) < 1 || Number(config.port) > 65535)
        throw new Error('host and a port from 1-65535 are required');
    if (!config.credentials || typeof config.credentials !== 'object' || Array.isArray(config.credentials) || Object.keys(config.credentials).length > 4096)
        throw new Error('credentials must be a bounded server credential map');
    const [key, cert] = await Promise.all([readFile(keyPath, 'utf8'), readFile(certPath, 'utf8')]);
    const handle = await startPublicFederationHub(root, { host: config.host, port: Number(config.port), signingKeyPath,
        credentials: config.credentials, tls: { key, cert },
        ...(typeof config.hubId === 'string' && { hubId: config.hubId }), });
    let closing;
    const safeHandle = {
        ...handle,
        close: () => closing ??= handle.close(),
    };
    try {
        log(`Public Federation Hub listening on https://${handle.host}:${handle.port}`);
        log(`Pin this public verification key on replicas:\n${handle.hub.getPublicKey()}`);
        return safeHandle;
    }
    catch (error) {
        await safeHandle.close().catch(() => undefined);
        throw error;
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    runPublicFederationServer(process.argv.slice(2)).then(handle => {
        if (!handle)
            return;
        const close = () => {
            void handle.close().then(() => { process.exitCode = 0; }, error => { console.error(error instanceof Error ? error.message : 'Public Hub shutdown failed'); process.exitCode = 1; });
        };
        process.once('SIGINT', close);
        process.once('SIGTERM', close);
    }).catch(error => { console.error(error instanceof Error ? error.message : 'Public Hub startup failed'); process.exitCode = 1; });
}
