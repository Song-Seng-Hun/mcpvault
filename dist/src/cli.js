/**
 * Parse runtime options without importing server.ts, which starts the MCP
 * server as a side effect. Unknown positional arguments remain part of the
 * vault path so unquoted paths with spaces continue to work.
 */
export function parseCliArgs(args) {
    const pathArgs = [];
    let readOnly = false;
    let restPort;
    let mcpHttpPort;
    let mcpHttpHost;
    let mcpHttpTlsCert;
    let mcpHttpTlsKey;
    let stdio;
    let economyConfig;
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--economy-config' || arg.startsWith('--economy-config=')) {
            const value = arg === '--economy-config' ? args[++index] : arg.slice('--economy-config='.length);
            if (!value || value.startsWith('--'))
                throw new Error('--economy-config requires a private host file path');
            if (economyConfig !== undefined)
                throw new Error('--economy-config may be supplied only once');
            economyConfig = value;
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
                throw new Error("--read-only must be true or false");
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
                throw new Error("--http must be a numeric port");
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
                throw new Error(`${option} must be a numeric port`);
            mcpHttpPort = Number(value);
            continue;
        }
        if (arg === "--mcp-http-host") {
            const value = args[index + 1];
            if (!value || value.startsWith("--"))
                throw new Error("--mcp-http-host requires a host");
            mcpHttpHost = value;
            index += 1;
            continue;
        }
        if (arg.startsWith("--mcp-http-host=")) {
            const value = arg.slice("--mcp-http-host=".length).trim();
            if (!value)
                throw new Error("--mcp-http-host requires a host");
            mcpHttpHost = value;
            continue;
        }
        if (arg === "--mcp-http-cert") {
            const value = args[index + 1];
            if (!value || value.startsWith("--"))
                throw new Error("--mcp-http-cert requires a file path");
            mcpHttpTlsCert = value;
            index += 1;
            continue;
        }
        if (arg.startsWith("--mcp-http-cert=")) {
            const value = arg.slice("--mcp-http-cert=".length).trim();
            if (!value)
                throw new Error("--mcp-http-cert requires a file path");
            mcpHttpTlsCert = value;
            continue;
        }
        if (arg === "--mcp-http-key") {
            const value = args[index + 1];
            if (!value || value.startsWith("--"))
                throw new Error("--mcp-http-key requires a file path");
            mcpHttpTlsKey = value;
            index += 1;
            continue;
        }
        if (arg.startsWith("--mcp-http-key=")) {
            const value = arg.slice("--mcp-http-key=".length).trim();
            if (!value)
                throw new Error("--mcp-http-key requires a file path");
            mcpHttpTlsKey = value;
            continue;
        }
        pathArgs.push(arg);
    }
    return {
        vaultPathArg: pathArgs.join(" ").trim(),
        readOnly,
        ...(stdio === false && { stdio }),
        ...(restPort !== undefined && { restPort }),
        ...(mcpHttpPort !== undefined && { mcpHttpPort }),
        ...(mcpHttpHost !== undefined && { mcpHttpHost }),
        ...(mcpHttpTlsCert !== undefined && { mcpHttpTlsCert }),
        ...(mcpHttpTlsKey !== undefined && { mcpHttpTlsKey }),
        ...(economyConfig !== undefined && { economyConfig }),
    };
}
