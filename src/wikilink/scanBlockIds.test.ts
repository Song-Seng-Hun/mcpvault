import { describe, it, expect } from 'vitest'
import { scanBlockIds } from './scanBlockIds.js'

const FIXTURE = `# Document

First paragraph of intro. ^introBlock

## Section One

A paragraph here.

Another paragraph with
multiple lines and a block id. ^multiLine

> [!info] Important callout
> This is a callout block
> with multiple lines. ^calloutBlock

\`\`\`typescript
const x = 1;
const y = 2;
\`\`\` ^codeBlock

- List item one
- List item two ^listBlock

## Section Two

Final paragraph. ^finalBlock
`

describe('scanBlockIds', () => {
  it('finds all 6 block IDs', () => {
    const results = scanBlockIds(FIXTURE)
    const ids = results.map((r) => r.id)
    expect(ids).toEqual([
      'introBlock',
      'multiLine',
      'calloutBlock',
      'codeBlock',
      'listBlock',
      'finalBlock',
    ])
  })

  it('^introBlock is a single-line paragraph', () => {
    const results = scanBlockIds(FIXTURE)
    const block = results.find((r) => r.id === 'introBlock')
    expect(block).toEqual({
      id: 'introBlock',
      startLine: 3,
      endLine: 3,
    })
  })

  it('^multiLine spans a multi-line paragraph', () => {
    const results = scanBlockIds(FIXTURE)
    const block = results.find((r) => r.id === 'multiLine')
    expect(block).toEqual({
      id: 'multiLine',
      startLine: 9,
      endLine: 10,
    })
  })

  it('^calloutBlock spans the callout from > [!info]', () => {
    const results = scanBlockIds(FIXTURE)
    const block = results.find((r) => r.id === 'calloutBlock')
    expect(block).toEqual({
      id: 'calloutBlock',
      startLine: 12,
      endLine: 14,
    })
  })

  it('^codeBlock spans the entire fenced code block', () => {
    const results = scanBlockIds(FIXTURE)
    const block = results.find((r) => r.id === 'codeBlock')
    expect(block).toEqual({
      id: 'codeBlock',
      startLine: 16,
      endLine: 19,
    })
  })

  it('^listBlock spans the list items', () => {
    const results = scanBlockIds(FIXTURE)
    const block = results.find((r) => r.id === 'listBlock')
    expect(block).toEqual({
      id: 'listBlock',
      startLine: 21,
      endLine: 22,
    })
  })

  it('returns empty array for empty content', () => {
    expect(scanBlockIds('')).toEqual([])
  })

  it('returns empty array for content with no block IDs', () => {
    const content = `# Heading

Just a paragraph with no anchors.

Another paragraph.
`
    expect(scanBlockIds(content)).toEqual([])
  })
})
