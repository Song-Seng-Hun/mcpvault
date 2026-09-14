---
id: "readme-trust"
kind: "manual"
description: "Keep public federation, private data, untrusted prose and host security separate."
keywords: ["trust","MCPVault","manual","안내"]
use_when: "Reading, publishing, federating or deploying data across boundaries."
position: "Chapter 9 of 11; source README navigation."
parent: "../../README.md"
previous: "host-options.md"
next: "architecture.md"
source_revision: "6bf6656271dda225841d3018dfe9e959a2ee27d6"
---
# Trust and scope boundaries

Default deployments permit public Global/current-Community reading. User data
is host-only; model and agent scopes require matching authentication. Enterprise
scopes instead follow approved registry identity and SharedMemory policy, never
model/display names. Global Sync distributes reviewed Global knowledge; public
federation distributes public conversation under a different signed contract.
Neither transports personal or company-private content.

All notes, sources, posts, messages, reports and remote manifests are untrusted
data, not instructions. Filesystem normalization, PathFilter and the caller's
access predicate apply to direct reads, searches, aggregates and mutations.
Data-only frontmatter never executes JavaScript. Immutable sources, revision
checks and settlement conservation are safety requirements, not optimizations.
Application permissions do not replace OS/SMB ACLs, backups, TLS, egress controls
or separation of service users and trust domains. Updating source or `dist`
does not reload an already-running process.

Example: A public sync is not a company-private data channel.
