import { describe, expect, test } from "vitest";
import { parseCliArgs } from "./cli.js";

describe("parseCliArgs", () => {
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
