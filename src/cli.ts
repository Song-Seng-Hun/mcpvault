import { guidanceError } from './guidance-runtime.js';
export interface ParsedCliArgs {
  vaultPathArg: string;
  readOnly: boolean;
  restPort?: number;
  mcpHttpPort?: number;
  mcpHttpHost?: string;
  mcpHttpTlsCert?: string;
  mcpHttpTlsKey?: string;
  economyConfig?: string;
  roleplayConfig?: string;
  skillEvolutionConfig?: string;
  explanationConfig?: string;
  benchmarkConfig?: string;
  featuresConfig?: string;
  ownerActivityConfig?: string;
  /** Dedicated HTTP process; omitted preserves legacy stdio behavior. */
  stdio?: false;
}

/**
 * Parse runtime options without importing server.ts, which starts the MCP
 * server as a side effect. Unknown positional arguments remain part of the
 * vault path so unquoted paths with spaces continue to work.
 */
export function parseCliArgs(args: string[]): ParsedCliArgs {
  const pathArgs: string[] = [];
  let readOnly = false;
  let restPort: number | undefined;
  let mcpHttpPort: number | undefined;
  let mcpHttpHost: string | undefined;
  let mcpHttpTlsCert: string | undefined;
  let mcpHttpTlsKey: string | undefined;
  let stdio: false | undefined;
  let economyConfig:string|undefined;
  let roleplayConfig: string | undefined;
  let skillEvolutionConfig: string | undefined;
  let explanationConfig: string | undefined;
  let benchmarkConfig: string | undefined;
  let featuresConfig: string | undefined;
  let ownerActivityConfig: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--owner-activity-config' || arg.startsWith('--owner-activity-config=')) {
      const value = arg === '--owner-activity-config' ? args[++index] : arg.slice('--owner-activity-config='.length);
      if (!value || !value.trim() || value.startsWith('--') || ownerActivityConfig !== undefined) throw new Error('--owner-activity-config requires one host configuration file');
      ownerActivityConfig = value; continue;
    }
    if (arg === '--features-config' || arg.startsWith('--features-config=')) {
      const value = arg === '--features-config' ? args[++index] : arg.slice('--features-config='.length);
      if (!value || !value.trim() || value.startsWith('--') || featuresConfig !== undefined) throw new Error('--features-config requires one host configuration file');
      featuresConfig = value; continue;
    }
    if (arg === '--benchmark-config' || arg.startsWith('--benchmark-config=')) {
      const value = arg === '--benchmark-config' ? args[++index] : arg.slice('--benchmark-config='.length);
      if (!value || !value.trim() || value.startsWith('--') || benchmarkConfig !== undefined) throw guidanceError(Error('--benchmark-config requires one private host configuration file'), 'guid-fed1ae3b67da7da1');
      benchmarkConfig = value; continue;
    }
    if (arg === '--explanation-config' || arg.startsWith('--explanation-config=')) {
      const value = arg === '--explanation-config' ? args[++index] : arg.slice('--explanation-config='.length);
      if (!value || !value.trim() || value.startsWith('--') || explanationConfig !== undefined) throw guidanceError(Error('--explanation-config requires one private host configuration file'), 'guid-2fd6b72137024d82');
      explanationConfig = value; continue;
    }
    if (arg === '--skill-evolution-config' || arg.startsWith('--skill-evolution-config=')) {
      const value = arg === '--skill-evolution-config' ? args[++index] : arg.slice('--skill-evolution-config='.length);
      if (!value || !value.trim() || value.startsWith('--') || skillEvolutionConfig !== undefined) throw guidanceError(new Error('--skill-evolution-config requires one host configuration file'), 'guid-f1b0524458043f1b');
      skillEvolutionConfig = value; continue;
    }
    if (arg === '--roleplay-config' || arg.startsWith('--roleplay-config=')) {
      const value = arg === '--roleplay-config' ? args[++index] : arg.slice('--roleplay-config='.length);
      if (!value || value.startsWith('--') || roleplayConfig !== undefined) throw guidanceError(new Error('--roleplay-config requires one host configuration file'), 'guid-b7dd3ed6ef7f8115');
      roleplayConfig = value; continue;
    }

    if(arg==='--economy-config'||arg.startsWith('--economy-config=')) {
      const value=arg==='--economy-config'?args[++index]:arg.slice('--economy-config='.length);
      if(!value||value.startsWith('--'))throw guidanceError(new Error('--economy-config requires a private host file path'), 'guid-99262a989a3c3643');
      if(economyConfig!==undefined)throw guidanceError(new Error('--economy-config may be supplied only once'), 'guid-a085d216b3513911');
      economyConfig=value;continue;
    }

    if (arg === "--read-only") {
      const next = args[index + 1]?.toLowerCase();
      if (next === "true" || next === "false") {
        readOnly = next === "true";
        index += 1;
      } else {
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
      } else {
        restPort = 8787;
      }
      continue;
    }

    if (arg.startsWith("--http=")) {
      const value = arg.slice("--http=".length);
      if (!/^\d+$/.test(value)) throw guidanceError(new Error("--http must be a numeric port"), 'guid-8af817def011ca06');
      restPort = Number(value);
      continue;
    }

    if (arg === "--mcp-http" || arg === "--mcp-http-only") {
      if (arg === "--mcp-http-only") stdio = false;
      const next = args[index + 1];
      if (next && /^\d+$/.test(next)) {
        mcpHttpPort = Number(next);
        index += 1;
      } else {
        mcpHttpPort = 8788;
      }
      continue;
    }

    if (arg.startsWith("--mcp-http=") || arg.startsWith("--mcp-http-only=")) {
      const option = arg.slice(0, arg.indexOf('='));
      if (option === "--mcp-http-only") stdio = false;
      const value = arg.slice(option.length + 1);
      if (!/^\d+$/.test(value)) throw guidanceError(new Error(`${option} must be a numeric port`), 'guid-5811340913730a1b');
      mcpHttpPort = Number(value);
      continue;
    }

    if (arg === "--mcp-http-host") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw guidanceError(new Error("--mcp-http-host requires a host"), 'guid-75d34e38bdcbe05b');
      mcpHttpHost = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--mcp-http-host=")) {
      const value = arg.slice("--mcp-http-host=".length).trim();
      if (!value) throw guidanceError(new Error("--mcp-http-host requires a host"), 'guid-75d34e38bdcbe05b');
      mcpHttpHost = value;
      continue;
    }

    if (arg === "--mcp-http-cert") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw guidanceError(new Error("--mcp-http-cert requires a file path"), 'guid-a0f7177f1fdb45ac');
      mcpHttpTlsCert = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--mcp-http-cert=")) {
      const value = arg.slice("--mcp-http-cert=".length).trim();
      if (!value) throw guidanceError(new Error("--mcp-http-cert requires a file path"), 'guid-a0f7177f1fdb45ac');
      mcpHttpTlsCert = value;
      continue;
    }

    if (arg === "--mcp-http-key") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw guidanceError(new Error("--mcp-http-key requires a file path"), 'guid-ff222f265ccf63a0');
      mcpHttpTlsKey = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--mcp-http-key=")) {
      const value = arg.slice("--mcp-http-key=".length).trim();
      if (!value) throw guidanceError(new Error("--mcp-http-key requires a file path"), 'guid-ff222f265ccf63a0');
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
    ...(economyConfig!==undefined && {economyConfig}),
    ...(roleplayConfig !== undefined && { roleplayConfig }),
    ...(skillEvolutionConfig !== undefined && { skillEvolutionConfig }),
    ...(explanationConfig !== undefined && { explanationConfig }),
    ...(benchmarkConfig !== undefined && { benchmarkConfig }),
    ...(featuresConfig !== undefined && { featuresConfig }),
    ...(ownerActivityConfig !== undefined && { ownerActivityConfig }),
  };
}
