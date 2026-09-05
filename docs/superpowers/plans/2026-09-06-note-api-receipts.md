# Ordinary note API receipts

## Gap

Unlike patch and knowledge workflows, `write_note` and `update_frontmatter`
returned only plain success text. Agents could not compare their write's
revision with the mandatory post-mutation read. Six actual MCP tests reproduced
the missing structured result; read-only rejection already worked.

## Change

- Use the existing shared own-write receipt methods in both dispatch adapters.
- Return compact JSON with success, public path, revision, message and write mode.
- Preserve the REST message field; stop requiring clients to parse success prose.
- No raw body/Properties echo, new endpoint/tool, permission or server setting.
- Explain the response change and re-read/intervening-edit workflow in capability
  descriptions, README and schema.

## Verification

- Three write modes, Properties merge/replace, long body/Properties with compact
  outputs, scope URI identity, stale follow-up and read-only rejection.
- REST generic and friendly routes preserve message and identify written bytes.
- Build, full tests, focused review, compiled MCP check and diff check before
  committing generated dist and source to the user fork only.

Verified: full suite 1,551 passed, one skipped, 116 files; build passed. Compiled
MCP receipts were 189/179 characters for a 1,000-line body and large Properties,
kept private scope URIs, omitted payload echo, and rejected stale follow-up.
Temporary Vault/account removed. Luna independently passed 11 targeted tests
and approved the adapters; two stale README response examples found in review
were corrected. The reviewer was closed. `git diff --check` passed.

## Scope

This makes ordinary note writes consistent with the knowledge receipt contract.
It is not a guarantee of unchanged disk state or cross-process atomicity.
Other services' post-write read semantics still require individual auditing.
