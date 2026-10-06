import { guidanceError } from './guidance-runtime.js';
import { isLoopbackHost } from './http-request-utils.js';
/** Options of removed features. Unknown arguments join the Vault path, so these
 * must fail loudly instead of silently pointing the server at another folder. */
const REMOVED_FEATURE_FLAGS = {
    '--roleplay-config': 'roleplay', '--economy-config': 'economy',
    '--explanation-config': 'explanation-translation', '--benchmark-config': 'benchmarks',
};
/**
 * Parse runtime options without importing server.ts, which starts the MCP
 * server as a side effect. Unknown positional arguments remain part of the
 * vault path so unquoted paths with spaces continue to work.
 */
export function parseCliArgs(args) {
    const pathArgs = [];
    let readOnly = false;
    let accountStorePath;
    let auth0Config;
    let quarantineSkills;
    let restPort;
    let mcpHttpPort;
    let mcpHttpHost;
    let mcpHttpTlsCert;
    let mcpHttpTlsKey;
    let stdio;
    let skillEvolutionConfig;
    let reviewedSkillsConfig;
    let featuresConfig;
    let ownerActivityConfig;
    let maintenanceConfig;
    let compilationConfig;
    let evolutionConfig;
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--account-store' || arg.startsWith('--account-store=')) {
            const value = arg === '--account-store' ? args[++index] : arg.slice('--account-store='.length);
            if (!value || !value.trim() || value.startsWith('--') || accountStorePath !== undefined)
                throw guidanceError(new Error('--account-store requires one existing private host account file'), 'guid-7d69fdf2de6d53d1');
            accountStorePath = value;
            continue;
        }
        if (arg === '--auth0-config' || arg.startsWith('--auth0-config=')) {
            const value = arg === '--auth0-config' ? args[++index] : arg.slice('--auth0-config='.length);
            if (!value || !value.trim() || value.startsWith('--') || auth0Config !== undefined)
                throw guidanceError(new Error('--auth0-config requires one existing private host configuration file'), 'guid-ad4f0d80c2047ed3');
            auth0Config = value;
            continue;
        }
        if (arg === '--evolution-config' || arg.startsWith('--evolution-config=')) {
            const value = arg === '--evolution-config' ? args[++index] : arg.slice('--evolution-config='.length);
            if (!value || !value.trim() || value.startsWith('--') || evolutionConfig !== undefined)
                throw guidanceError(new Error('--evolution-config requires one private host configuration file'), 'guid-8d3e7e6f120aced5');
            evolutionConfig = value;
            continue;
        }
        if (arg === '--reviewed-skills-config' || arg.startsWith('--reviewed-skills-config=')) {
            const value = arg === '--reviewed-skills-config' ? args[++index] : arg.slice('--reviewed-skills-config='.length);
            if (!value || !value.trim() || value.startsWith('--') || reviewedSkillsConfig !== undefined)
                throw guidanceError(new Error('--reviewed-skills-config requires one private host configuration file'), 'guid-d99fac916b807fb7');
            reviewedSkillsConfig = value;
            continue;
        }
        if (arg === '--quarantine-skills' || arg.startsWith('--quarantine-skills=')) {
            if (arg !== '--quarantine-skills' || quarantineSkills)
                throw guidanceError(new Error('--quarantine-skills accepts one flag without a value'), 'guid-10e73a69510fff52');
            quarantineSkills = true;
            continue;
        }
        if (arg === '--compilation-config' || arg.startsWith('--compilation-config=')) {
            const value = arg === '--compilation-config' ? args[++index] : arg.slice('--compilation-config='.length);
            if (!value || !value.trim() || value.startsWith('--') || compilationConfig !== undefined)
                throw guidanceError(new Error('--compilation-config requires one private host configuration file'), 'guid-a5df95d10a0e23ce');
            compilationConfig = value;
            continue;
        }
        if (arg === '--maintenance-config' || arg.startsWith('--maintenance-config=')) {
            const value = arg === '--maintenance-config' ? args[++index] : arg.slice('--maintenance-config='.length);
            if (!value || !value.trim() || value.startsWith('--') || maintenanceConfig !== undefined)
                throw guidanceError(new Error('--maintenance-config requires one private host configuration file'), 'guid-07f33594579e4cf0');
            maintenanceConfig = value;
            continue;
        }
        if (arg === '--owner-activity-config' || arg.startsWith('--owner-activity-config=')) {
            const value = arg === '--owner-activity-config' ? args[++index] : arg.slice('--owner-activity-config='.length);
            if (!value || !value.trim() || value.startsWith('--') || ownerActivityConfig !== undefined)
                throw guidanceError(new Error('--owner-activity-config requires one host configuration file'), 'guid-e95fe85bad0b4904');
            ownerActivityConfig = value;
            continue;
        }
        if (arg === '--features-config' || arg.startsWith('--features-config=')) {
            const value = arg === '--features-config' ? args[++index] : arg.slice('--features-config='.length);
            if (!value || !value.trim() || value.startsWith('--') || featuresConfig !== undefined)
                throw guidanceError(new Error('--features-config requires one host configuration file'), 'guid-fc0e1ded2f8c054c');
            featuresConfig = value;
            continue;
        }
        if (arg === '--skill-evolution-config' || arg.startsWith('--skill-evolution-config=')) {
            const value = arg === '--skill-evolution-config' ? args[++index] : arg.slice('--skill-evolution-config='.length);
            if (!value || !value.trim() || value.startsWith('--') || skillEvolutionConfig !== undefined)
                throw guidanceError(new Error('--skill-evolution-config requires one host configuration file'), 'guid-f1b0524458043f1b');
            skillEvolutionConfig = value;
            continue;
        }
        if (arg === "--read-only") {
            const next = args[index + 1]?.toLowerCase();
            if (next === "true" || next === "false") {
                readOnly = next === "true";
                index += 1;
            }
            else {
                readOnly = true;
            }
            continue;
        }
        if (arg.startsWith("--read-only=")) {
            const value = arg.slice("--read-only=".length).toLowerCase();
            if (value !== "true" && value !== "false") {
                throw guidanceError(new Error("--read-only must be true or false"), 'guid-b5e3941a61f81d1f');
            }
            readOnly = value === "true";
            continue;
        }
        if (arg === "--http") {
            const next = args[index + 1];
            if (next && /^\d+$/.test(next)) {
                restPort = Number(next);
                index += 1;
            }
            else {
                restPort = 8787;
            }
            continue;
        }
        if (arg.startsWith("--http=")) {
            const value = arg.slice("--http=".length);
            if (!/^\d+$/.test(value))
                throw guidanceError(new Error("--http must be a numeric port"), 'guid-8af817def011ca06');
            restPort = Number(value);
            continue;
        }
        if (arg === "--mcp-http" || arg === "--mcp-http-only") {
            if (arg === "--mcp-http-only")
                stdio = false;
            const next = args[index + 1];
            if (next && /^\d+$/.test(next)) {
                mcpHttpPort = Number(next);
                index += 1;
            }
            else {
                mcpHttpPort = 8788;
            }
            continue;
        }
        if (arg.startsWith("--mcp-http=") || arg.startsWith("--mcp-http-only=")) {
            const option = arg.slice(0, arg.indexOf('='));
            if (option === "--mcp-http-only")
                stdio = false;
            const value = arg.slice(option.length + 1);
            if (!/^\d+$/.test(value))
                throw guidanceError(new Error(`${option} must be a numeric port`), 'guid-5811340913730a1b');
            mcpHttpPort = Number(value);
            continue;
        }
        if (arg === "--mcp-http-host") {
            const value = args[index + 1];
            if (!value || value.startsWith("--"))
                throw guidanceError(new Error("--mcp-http-host requires a host"), 'guid-75d34e38bdcbe05b');
            mcpHttpHost = value;
            index += 1;
            continue;
        }
        if (arg.startsWith("--mcp-http-host=")) {
            const value = arg.slice("--mcp-http-host=".length).trim();
            if (!value)
                throw guidanceError(new Error("--mcp-http-host requires a host"), 'guid-75d34e38bdcbe05b');
            mcpHttpHost = value;
            continue;
        }
        if (arg === "--mcp-http-cert") {
            const value = args[index + 1];
            if (!value || value.startsWith("--"))
                throw guidanceError(new Error("--mcp-http-cert requires a file path"), 'guid-a0f7177f1fdb45ac');
            mcpHttpTlsCert = value;
            index += 1;
            continue;
        }
        if (arg.startsWith("--mcp-http-cert=")) {
            const value = arg.slice("--mcp-http-cert=".length).trim();
            if (!value)
                throw guidanceError(new Error("--mcp-http-cert requires a file path"), 'guid-a0f7177f1fdb45ac');
            mcpHttpTlsCert = value;
            continue;
        }
        if (arg === "--mcp-http-key") {
            const value = args[index + 1];
            if (!value || value.startsWith("--"))
                throw guidanceError(new Error("--mcp-http-key requires a file path"), 'guid-ff222f265ccf63a0');
            mcpHttpTlsKey = value;
            index += 1;
            continue;
        }
        if (arg.startsWith("--mcp-http-key=")) {
            const value = arg.slice("--mcp-http-key=".length).trim();
            if (!value)
                throw guidanceError(new Error("--mcp-http-key requires a file path"), 'guid-ff222f265ccf63a0');
            mcpHttpTlsKey = value;
            continue;
        }
        const removedFlag = Object.keys(REMOVED_FEATURE_FLAGS).find(flag => arg === flag || arg.startsWith(`${flag}=`));
        if (removedFlag)
            throw guidanceError(new Error(`${removedFlag} belongs to the removed ${REMOVED_FEATURE_FLAGS[removedFlag]} feature; remove this option`), 'guid-69825747c6cad30b');
        pathArgs.push(arg);
    }
    if (auth0Config !== undefined && (accountStorePath === undefined || mcpHttpPort === undefined || restPort !== undefined || readOnly
        || (mcpHttpHost !== undefined && !isLoopbackHost(mcpHttpHost)))) {
        throw guidanceError(new Error('--auth0-config requires --account-store, writable --mcp-http, and loopback binding'), 'guid-0afc825b92b6ed1e');
    }
    return {
        vaultPathArg: pathArgs.join(" ").trim(),
        readOnly,
        ...(accountStorePath !== undefined && { accountStorePath }),
        ...(auth0Config !== undefined && { auth0Config }),
        ...(quarantineSkills && { quarantineSkills }),
        ...(stdio === false && { stdio }),
        ...(restPort !== undefined && { restPort }),
        ...(mcpHttpPort !== undefined && { mcpHttpPort }),
        ...(mcpHttpHost !== undefined && { mcpHttpHost }),
        ...(mcpHttpTlsCert !== undefined && { mcpHttpTlsCert }),
        ...(mcpHttpTlsKey !== undefined && { mcpHttpTlsKey }),
        ...(skillEvolutionConfig !== undefined && { skillEvolutionConfig }),
        ...(reviewedSkillsConfig !== undefined && { reviewedSkillsConfig }),
        ...(featuresConfig !== undefined && { featuresConfig }),
        ...(ownerActivityConfig !== undefined && { ownerActivityConfig }),
        ...(maintenanceConfig !== undefined && { maintenanceConfig }),
        ...(compilationConfig !== undefined && { compilationConfig }),
        ...(evolutionConfig !== undefined && { evolutionConfig }),
    };
}
