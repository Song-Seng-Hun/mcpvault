# Deploying website-shibumi

The site deploys via [`shibumi-server`](https://github.com/bitbonsai/shibumi-server)
running on the Hetzner host, not a registry pipeline. CI in
`.github/workflows/website-shibumi.yml` is test-only (it builds the
Containerfile to catch breakage, but never pushes an image anywhere).

```text
GitHub push webhook
      |
Cloudflare -> Caddy (host HTTPS)
      |-- /hooks/github/mcpvault-web -> shibumi-server (127.0.0.1:8787)
      `-- everything else            -> mcpvault-web container (127.0.0.1:9100)
```

A signed push to `main` makes shibumi-server fetch that exact commit,
build `website-shibumi/compose.yaml` in place with rootless `podman compose`,
health-check the new container on `/healthz`, and keep the previous two
images for rollback. See `~/bit/shibumi-server/docs/architecture.md` for the
full request-validation and resource-guard contract; this file only covers
the pieces specific to this app.

## shibumi-server config

Add this entry to the host's `apps` object (alongside any other apps
shibumi-server manages; do not create a second `listen` block):

```json
{
  "apps": {
    "mcpvault-web": {
      "repository": "bitbonsai/mcpvault",
      "ref": "refs/heads/main",
      "checkout": "/srv/shibumi/apps/mcpvault-web",
      "composeFile": "website-shibumi/compose.yaml",
      "composeCommand": ["podman", "compose"],
      "composeProject": "mcpvault-web",
      "service": "web",
      "hostPort": 9100,
      "healthUrl": "http://127.0.0.1:9100/healthz",
      "secretEnvironmentVariable": "SHIBUMI_SECRET_MCPVAULT_WEB",
      "minimumFreeMemoryMb": 1024,
      "minimumFreeDiskMb": 2048,
      "buildTimeoutMs": 300000,
      "healthAttempts": 20,
      "healthIntervalMs": 500,
      "retainedRollbackImages": 2
    }
  }
}
```

The lower `minimumFreeMemoryMb`/`minimumFreeDiskMb` floors (vs. the
2048/4096 shipped in shibumi-server's example) reflect that this is a small
static-ish Bun/Hono site, not a heavy build. Raise them if the host also
runs other apps that need headroom. `checkout` is the app's dedicated,
shibumi-server-owned clone; it must stay clean between deploys per the
architecture doc's deterministic-checkout contract, so don't reuse a path
you also work in by hand.

Use `["podman-compose"]` for `composeCommand` instead if the host only has
the standalone Python frontend rather than the `podman compose` v2 plugin;
the standalone frontend has historically been less complete about honoring
`cap_drop`/`security_opt`, so confirm the hardening flags actually apply
with `podman compose config` (or `podman-compose config`) on the host once
it's provisioned, the same way `docker compose config` was used to validate
`website-shibumi/compose.yaml` locally.

## Secrets

Resend credentials are not committed and are not baked into the image.
Create the env file the compose service reads before the first deploy:

```sh
install -m 600 -o <shibumi-user> -g <shibumi-user> /dev/null \
  /srv/shibumi/secrets/mcpvault-web.env
# then edit it in place:
#   RESEND_API_KEY=...
#   RESEND_AUDIENCE_ID=...
```

`website-shibumi/compose.yaml` marks this `env_file` as `required: false`
so a missing file doesn't block the whole site from starting; only the
`/api/subscribe` and `/api/unsubscribe` routes fail until it's created.
Don't treat that as license to skip it.

The webhook HMAC secret is separate from the Resend env file: it's
generated per-app by shibumi-server itself (see below), not something this
repo or the compose file ever sees.

## Caddyfile

```caddyfile
mcpvault.org, www.mcpvault.org {
	handle /hooks/github/mcpvault-web {
		reverse_proxy 127.0.0.1:8787
	}

	handle {
		reverse_proxy 127.0.0.1:9100
	}
}
```

If the host will front more than one shibumi-server-managed app, a single
`handle /hooks/github/*` block routing everything to `127.0.0.1:8787` also
works: shibumi-server itself demuxes by the `/hooks/github/<appId>` path
(see its `src/server.ts`), so one Caddy route can cover every app's webhook
without an edit each time a new app is added.

## GitHub webhook registration

On `bitbonsai/mcpvault` -> Settings -> Webhooks -> Add webhook:

| Field | Value |
| --- | --- |
| Payload URL | `https://mcpvault.org/hooks/github/mcpvault-web` |
| Content type | `application/json` |
| Secret | generated per-app by shibumi-server; see below |
| Events | just the `push` event |
| Active | yes |

The secret is **not** something to invent by hand in this repo or paste
into GitHub from a scratch value. Generate it as part of registering the
app with shibumi-server (its `add`/`init` flow creates a random 32-byte
HMAC secret per app and writes it to a mode-0600 file on the host); if you
need a throwaway value to test the registration form's shape before that
exists, `openssl rand -hex 32` produces one of the right size, but the real
secret used in production must come from shibumi-server, never be typed in
by a human, and never be committed or logged anywhere.
