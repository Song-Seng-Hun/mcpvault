---
id: "readme-host-options"
kind: "manual"
description: "Separate normal and Enterprise launchers and opt-in host-owned subsystems."
keywords: ["host-options","MCPVault","manual","안내"]
use_when: "Configuring or upgrading a host."
position: "Chapter 8 of 11; source README navigation."
parent: "../../README.md"
previous: "workflows.md"
next: "trust.md"
source_revision: "6bf6656271dda225841d3018dfe9e959a2ee27d6"
---
# Explicit host configuration

New hosts default to `wiki-core`; optional features require an explicit private
`--features-config` selection. See [original preservation, selective features,
private derivatives and department navigation](../../docs/preservation-features.md)
before upgrading an existing host. Selecting a feature does not grant document,
owner-activity, provider or model-execution permission.

The normal launcher supports optional `--roleplay-config`, `--economy-config`
and `--skill-evolution-config` host-private files. They do not become enabled
through registration or capability discovery. World administrators, durable
checkpoints, approved owners and evaluation profiles remain explicit host work.
Keep operator configs, credentials and checkpoints outside the Vault and source.

The separate Enterprise launcher supplies registry-bound identities and mTLS;
it does not inherit the normal launcher's optional host configuration support.
See [enterprise architecture](../../docs/enterprise-architecture.md),
[administrator CLI](../../docs/enterprise-admin.md) and
[deployment, Global import and hub operation](../../docs/enterprise-deployment.md).
Do not copy normal-server flags into an Enterprise deployment or silently
enable unsupported subsystems.

Example: Do not copy normal-server options into an unsupported Enterprise launcher.
