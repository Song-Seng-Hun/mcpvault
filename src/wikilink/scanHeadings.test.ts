import { describe, it, expect } from 'vitest'
import { scanHeadings } from './scanHeadings.js'

const FIXTURE = `# Title

Some intro text.

## Summary

Summary content here.

### Sub-section

Sub-section content.

## Details

### Protocol First

Protocol content.

#### Step 1

Step 1 content.

#### Step 2

Step 2 content.

### How Code Looks

#### General Principles

Principle content here.
More principle content.

#### Opportunistic Legibility in Changed Chunks

When a code change touches a line that packs multiple items, split it.

This applies to anything: conditionals, arrays, dependency lists.

#### Function Naming

Start function names with a verb.
`

describe('scanHeadings', () => {
  const headings = scanHeadings(FIXTURE)
  const lines = FIXTURE.split('\n')

  it('returns correct count of headings', () => {
    expect(headings).toHaveLength(11)
  })

  it('# Title starts at line 1, section extends to end (no other h1 to terminate it)', () => {
    const title = headings[0]
    expect(title!.text).toBe('Title')
    expect(title!.level).toBe(1)
    expect(title!.startLine).toBe(1)
    expect(title!.endLine).toBe(lines.length)
  })

  it('## Summary section includes ### Sub-section content', () => {
    const summary = headings[1]
    expect(summary!.text).toBe('Summary')
    expect(summary!.level).toBe(2)
    expect(summary!.startLine).toBe(5)
    expect(summary!.endLine).toBe(12)
  })

  it('#### Opportunistic Legibility section ends before #### Function Naming', () => {
    const opp = headings.find(
      (h) => h.text === 'Opportunistic Legibility in Changed Chunks',
    )
    expect(opp).toBeDefined()
    expect(opp!.level).toBe(4)
    expect(opp!.startLine).toBe(34)

    const fn = headings.find((h) => h.text === 'Function Naming')
    expect(fn).toBeDefined()
    expect(opp!.endLine).toBe(fn!.startLine - 1)
  })

  it('last heading section extends to end of content', () => {
    const last = headings[headings.length - 1]
    expect(last!.text).toBe('Function Naming')
    expect(last!.endLine).toBe(FIXTURE.split('\n').length)
  })

  it('returns empty array for empty content', () => {
    expect(scanHeadings('')).toEqual([])
  })

  it('returns empty array for content with no headings', () => {
    expect(scanHeadings('Just some text.\nNo headings here.')).toEqual([])
  })

  it('single heading — section extends to end of content', () => {
    const result = scanHeadings('## Only One\n\nSome content.\n')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      text: 'Only One',
      level: 2,
      startLine: 1,
      endLine: 4,
    })
  })
})
