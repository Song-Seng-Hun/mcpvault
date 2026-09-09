import { describe, expect, test } from "vitest";
import { parseCliArgs } from "./cli.js";

test('parses skill evolution host configuration without consuming the NAS path or enabling other services', () => {
  const vault = '\\\\172.30.1.24\\MCPVault';
  for (const args of [['--skill-evolution-config=C:\\Private\\skill.json'], ['--skill-evolution-config', 'C:\\Private\\skill.json']]) {
    expect(parseCliArgs([vault, ...args])).toEqual({ vaultPathArg: vault, readOnly: false, skillEvolutionConfig: 'C:\\Private\\skill.json' });
  }
  for (const args of [['--skill-evolution-config'], ['--skill-evolution-config='], ['--skill-evolution-config', '--read-only'], ['--skill-evolution-config=a', '--skill-evolution-config=b']]) {
    expect(() => parseCliArgs(['/vault', ...args])).toThrow(/skill-evolution-config/);
  }
});

test('parses host-only roleplay configuration without enabling economy or changing the vault', () => {
  expect(parseCliArgs(['E:\\Vault', '--roleplay-config=E:\\Private\\roleplay.json'])).toMatchObject({ vaultPathArg: 'E:\\Vault', roleplayConfig: 'E:\\Private\\roleplay.json' });
  expect(parseCliArgs(['E:\\Vault', '--roleplay-config', 'E:\\Private\\roleplay.json']).economyConfig).toBeUndefined();
  expect(() => parseCliArgs(['E:\\Vault', '--roleplay-config'])).toThrow(/config/i);
  expect(() => parseCliArgs(['E:\\Vault', '--roleplay-config=a', '--roleplay-config=b'])).toThrow();
});

test('parses private economy config separately from the vault path',()=>{
  expect(parseCliArgs(['E:\\Vault','--economy-config=E:\\Private\\economy.json']).economyConfig).toBe('E:\\Private\\economy.json');
  expect(parseCliArgs(['E:\\Vault','--economy-config','E:\\Private\\economy.json']).vaultPathArg).toBe('E:\\Vault');
  expect(()=>parseCliArgs(['E:\\Vault','--economy-config'])).toThrow(/config/i);
});

describe("parseCliArgs", () => {
  test("starts a dedicated HTTP runtime without stdio using one option", () => {
    expect(parseCliArgs(['/My', 'Vault', '--mcp-http-only'])).toEqual({ vaultPathArg: '/My Vault', readOnly: false, mcpHttpPort: 8788, stdio: false });
    expect(parseCliArgs(['/vault', '--mcp-http-only=0'])).toMatchObject({ vaultPathArg: '/vault', mcpHttpPort: 0, stdio: false });
    expect(parseCliArgs(['--mcp-http-only', '9010', '/vault'])).toMatchObject({ vaultPathArg: '/vault', mcpHttpPort: 9010, stdio: false });
    expect(() => parseCliArgs(['/vault', '--mcp-http-only=bad'])).toThrow('--mcp-http-only must be a numeric port');
  });
  test("defaults to writable mode and preserves a vault path", () => {
    expect(parseCliArgs(["/path/to/vault"])).toEqual({
      vaultPathArg: "/path/to/vault",
      readOnly: false,
    });
  });

  test("supports a bare read-only flag in any position", () => {
    expect(parseCliArgs(["/path/to/vault", "--read-only"])).toEqual({
      vaultPathArg: "/path/to/vault",
      readOnly: true,
    });
    expect(parseCliArgs(["--read-only", "/path/to/vault"])).toEqual({
      vaultPathArg: "/path/to/vault",
      readOnly: true,
    });
  });

  test("accepts explicit boolean values used by JSON MCP configs", () => {
    expect(parseCliArgs(["/vault", "--read-only", "true"]).readOnly).toBe(true);
    expect(parseCliArgs(["/vault", "--read-only", "false"]).readOnly).toBe(false);
    expect(parseCliArgs(["/vault", "--read-only=true"]).readOnly).toBe(true);
    expect(parseCliArgs(["/vault", "--read-only=false"]).readOnly).toBe(false);
  });

  test("preserves unquoted vault paths with spaces after removing options", () => {
    expect(parseCliArgs(["/Users/me/My", "Vault", "--read-only", "true"])).toEqual({
      vaultPathArg: "/Users/me/My Vault",
      readOnly: true,
    });
  });

  test("rejects invalid equals-form boolean values", () => {
    expect(() => parseCliArgs(["/vault", "--read-only=yes"])).toThrow(
      "--read-only must be true or false",
    );
  });

  test("enables the optional localhost REST adapter", () => {
    expect(parseCliArgs(["/vault", "--http"])).toEqual({
      vaultPathArg: "/vault",
      readOnly: false,
      restPort: 8787,
    });
    expect(parseCliArgs(["/vault", "--http=9123"]).restPort).toBe(9123);
    expect(parseCliArgs(["/vault", "--http", "9124"]).restPort).toBe(9124);
  });

  test("enables the MCP 2026 Stateless HTTP adapter", () => {
    expect(parseCliArgs(["/vault", "--mcp-http"])).toEqual({
      vaultPathArg: "/vault",
      readOnly: false,
      mcpHttpPort: 8788,
    });
    expect(parseCliArgs(["/vault", "--mcp-http=9124"]).mcpHttpPort).toBe(9124);
    expect(parseCliArgs(["/vault", "--mcp-http", "9125"]).mcpHttpPort).toBe(9125);
  });

  test("accepts explicit LAN host and TLS files for MCP HTTP", () => {
    expect(parseCliArgs([
      "/vault",
      "--mcp-http=9125",
      "--mcp-http-host=192.168.1.20",
      "--mcp-http-cert", "server.crt",
      "--mcp-http-key", "server.key",
    ])).toMatchObject({
      mcpHttpPort: 9125,
      mcpHttpHost: "192.168.1.20",
      mcpHttpTlsCert: "server.crt",
      mcpHttpTlsKey: "server.key",
    });
  });

  test("requires values for MCP HTTP LAN/TLS options", () => {
    expect(() => parseCliArgs(["/vault", "--mcp-http-host"])).toThrow("--mcp-http-host requires a host");
    expect(() => parseCliArgs(["/vault", "--mcp-http-cert"])).toThrow("--mcp-http-cert requires a file path");
    expect(() => parseCliArgs(["/vault", "--mcp-http-key"])).toThrow("--mcp-http-key requires a file path");
  });

  test("rejects invalid REST ports", () => {
    expect(() => parseCliArgs(["/vault", "--http=abc"])).toThrow("--http must be a numeric port");
  });

  test("rejects invalid MCP HTTP ports", () => {
    expect(() => parseCliArgs(["/vault", "--mcp-http=abc"])).toThrow("--mcp-http must be a numeric port");
  });
});
