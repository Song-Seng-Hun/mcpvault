# Reusable learning paths and procedural bundles

`configuration.check` is a read-only dynamic endpoint using the same bounded
prerequisite/exclusion validator as TRPG skills. It validates caller-supplied data:
it does not read host files, change a learning path, execute procedures, certify
model competency or grant permissions. Both kinds use this shape:

```json
{
  "kind": "learning-path",
  "configuration": {
    "id": "intro-path",
    "version": "1.0.0",
    "nodes": [
      { "id": "read-source", "requires": [], "excludes": [], "cost": 1 },
      { "id": "review-evidence", "requires": ["read-source"], "excludes": [], "cost": 2 }
    ],
    "selected": ["read-source", "review-evidence"]
  },
  "maxChars": 1000
}
```

For a procedure template use `kind: "procedural-bundle"`. Costs are declarative
configuration units, not wallet XP or a tool budget. The response includes validity,
selected count, total cost, a version-bound fingerprint, `executable: false` and
`permissionsGranted: false`. A caller can retain that fingerprint as provenance,
but must validate changed input again and separately authorize any real activity.

Limits: 128 nodes/selections, 16 prerequisites/exclusions per node, costs 0–1000,
and output budgets 512–12000 characters. Unknown/executable fields, cycles, missing
prerequisites, incompatible selections and unsupported versions are rejected.
Game capabilities remain separate from document Skills; neither selection nor
learning completion changes MCP authentication or access.
