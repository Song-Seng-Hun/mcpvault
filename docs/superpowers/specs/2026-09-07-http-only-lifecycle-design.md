# Dedicated shared HTTP process lifecycle

Design approval is delegated by the user. Scope: repository implementation and
disposable child processes only; no live plugin/configuration/server changes.

## Choice

Use the existing native HTTP transport directly. Add `--mcp-http-only[=PORT]`
(8788 by default) to start one explicitly owned HTTP process without reading
MCP from stdin. Multiple clients register the same endpoint. This requires no
extra client program or automatic discovery. Existing `--mcp-http` remains dual
transport and the default remains stdio with EOF exit.

Alternatives: automatic attach/spawn with a discovery file would need trusted
endpoint identity, locks, stale ownership recovery and lifecycle arbitration;
a stdio-to-HTTP bridge would leave a bridge process per client. Neither is
necessary for clients that accept an MCP URL, so neither is introduced here.

## Ownership and errors

The CLI owns one createServer runtime. Stdio gets a lightweight protocol wrapper
from createRequestServer, just like HTTP; a protocol close must not own the
shared services. CLI shutdown closes acquired transport handles before the root
runtime, even when one close fails or stdio never accepted a request. Startup
errors also clean acquired resources and return a nonzero exit. Shutdown is
idempotent. No process-name scans, orphan kills, background launcher or new
network binding defaults. HTTP-only retains loopback/TLS/host/origin guards.

Keep resource disposal in a small lifecycle module, not copied error branches.
Entrypoint startup remains sequential; signal handlers are installed after
successful startup. No promise of native model/RSS savings without measurements.

## Verification

CLI parsing covers bare/separate/equals ports, spaces, invalid values, and
unchanged dual/default modes. Real published-entrypoint fixtures use ephemeral
loopback ports and two SDK clients: HTTP search succeeds despite stdin protocol
input and EOF; stdout stays unused in HTTP-only mode; a detached client does
not stop the other. Startup failure exits nonzero. Existing stdio EOF/signal
tests stay green. A focused lifecycle test proves order, idempotence, all-owner
cleanup after one closer rejects, and cleanup without a stdio connection.

No native embedding/download needed. Run targets, build, independent review,
full one-worker suite and diff check. Commit source/dist/docs to the user fork
main only. Never infer that installed clients migrated from repository tests.
