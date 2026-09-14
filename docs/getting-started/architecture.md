---
id: "readme-architecture"
kind: "manual"
description: "Locate the owner of control-plane, path, domain or read-model behavior."
keywords: ["architecture","MCPVault","manual","안내"]
use_when: "Changing code or locating relevant implementation tests."
position: "Chapter 10 of 11; source README navigation."
parent: "../../README.md"
previous: "trust.md"
next: "development.md"
source_revision: "6bf6656271dda225841d3018dfe9e959a2ee27d6"
---
# Service ownership

| Owner | Responsibility |
| --- | --- |
| `server.ts`, `enterprise-server.ts` | Explicit launch configuration and process ownership |
| `src/createServer.ts` | Fixed five-tool control plane and shared service adapters |
| `src/endpoint-registry.ts` | Dynamic IDs, schemas, availability and discovery |
| `src/filesystem.ts`, `src/pathfilter.ts`, `src/scope-access.ts` | Paths, immutability and caller visibility |
| `src/llm-wiki.ts`, `src/organization.ts` | Knowledge workflows and organization contracts |
| Domain services | Work, community, Story, Roleplay and economy business rules shared by MCP/REST |
| Read models | Rebuildable metadata/search/semantic/graph/notification/reputation projections |

Keep one owner per shared file. Inspect nearby tests; add a regression before
changing behavior. Evaluation assets live under `tests/fixtures`, not the
production build. Resource-bundle, skill-library and recovery hosts remain
operational utilities with script consumers.

Example: Put shared business rules in the domain service, not duplicate adapters.
