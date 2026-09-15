---
id: skill-metadata-example
description: Inert bilingual discovery example for a read-only invoice procedure.
keywords: [example, tool, invoice, 청구서, metadata.mcpvault]
use_when: Writing searchable tool examples; do not execute this example.
position: Chapter 2 of 3; minimal native declaration.
parent: skill-metadata.md
previous: skill-metadata-fields.md
next: skill-metadata-observation.md
---
# Native SKILL.md frontmatter example

```yaml
name: invoice-reader
description: Read invoice totals with exact source locations.
metadata:
  mcpvault:
    version: 1
    kind: tool
    domains: [finance/accounting]
    purpose: Read totals without executing payments.
    useWhen: [Extract an invoice total]
    avoidWhen: [Transfer money]
    keywords: [invoice, 청구서]
    inputs: [An accessible invoice locator]
    outputs: [Totals and source locations]
    effects: [read_private]
    connections:
      - kind: mcp
        target: documents.read
        effects: [read_private]
    examples:
      - query: 청구서 합계만 읽어줘
        action: documents.read
        expected: Totals with exact source locations.
        avoid: Do not pay the invoice.
```

This example does not install MCP, fetch documents or grant private-data access.
Finance classification alone does not label the procedure malicious or unlawful.
Read-private potential impact remains high even with a correct implementation.
Discovery: `skill.resolve {skillId: invoice-reader, view: metadata, section: summary}`.
Detail: follow returned description, impact, connections or usage action.
Procedure: `skill.resolve {skillId: invoice-reader}`; current host permission still applies.
