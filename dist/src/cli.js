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
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
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
        if (arg === "--mcp-http") {
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
        if (arg.startsWith("--mcp-http=")) {
            const value = arg.slice("--mcp-http=".length);
            if (!/^\d+$/.test(value))
                throw new Error("--mcp-http must be a numeric port");
            mcpHttpPort = Number(value);
            continue;
        }
        pathArgs.push(arg);
    }
    return {
        vaultPathArg: pathArgs.join(" ").trim(),
        readOnly,
        ...(restPort !== undefined && { restPort }),
        ...(mcpHttpPort !== undefined && { mcpHttpPort }),
    };
}
