import { describe, it, expect } from 'vitest'
import { parseWikiLink, resolveWikiLink } from './resolveWikiLink.js'

describe('parseWikiLink', () => {
  it('parses bare name', () => {
    expect(parseWikiLink('My Document')).toEqual({
      document: 'My Document',
      fragment: undefined,
    })
  })

  it('strips [[ ]] brackets', () => {
    expect(parseWikiLink('[[My Document]]')).toEqual({
      document: 'My Document',
      fragment: undefined,
    })
  })

  it('extracts heading fragment', () => {
    expect(parseWikiLink('[[My Document#Summary]]')).toEqual({
      document: 'My Document',
      fragment: 'Summary',
    })
  })

  it('extracts block-id fragment', () => {
    expect(parseWikiLink('[[My Document#^blockId]]')).toEqual({
      document: 'My Document',
      fragment: '^blockId',
    })
  })

  it('strips display text', () => {
    expect(parseWikiLink('[[My Document|Displayed Name]]')).toEqual({
      document: 'My Document',
      fragment: undefined,
    })
  })

  it('handles fragment + display text', () => {
    expect(parseWikiLink('[[My Document#Summary|The Summary]]')).toEqual({
      document: 'My Document',
      fragment: 'Summary',
    })
  })

  it('preserves .ts in basename (module convention)', () => {
    expect(parseWikiLink('[[Module-Foo.ts]]')).toEqual({
      document: 'Module-Foo.ts',
      fragment: undefined,
    })
  })

  it('preserves .md in basename', () => {
    expect(parseWikiLink('[[document.md]]')).toEqual({
      document: 'document.md',
      fragment: undefined,
    })
  })

  it('handles bare name with fragment (no brackets)', () => {
    expect(parseWikiLink('My Document#Details')).toEqual({
      document: 'My Document',
      fragment: 'Details',
    })
  })

  it('returns undefined fragment for empty hash', () => {
    expect(parseWikiLink('[[My Document#]]')).toEqual({
      document: 'My Document',
      fragment: undefined,
    })
  })
})

describe('resolveWikiLink', () => {
  const CONTENT = `# Title

## Summary

Summary text.

## Details

Details text.
`

  it('returns full content when no fragment', () => {
    const result = resolveWikiLink(CONTENT, undefined)
    expect(result.type).toBe('full')
    if (result.type !== 'full') return
    expect(result.content).toBe(CONTENT)
  })

  it('returns fragment extraction for heading', () => {
    const result = resolveWikiLink(CONTENT, 'Summary')
    expect(result.type).toBe('fragment')
    if (result.type !== 'fragment') return
    expect(result.extraction.found).toBe(true)
    if (!result.extraction.found) return
    expect(result.extraction.content).toContain('Summary text.')
    expect(result.extraction.content).not.toContain('Details text.')
  })

  it('returns fragment error for missing heading', () => {
    const result = resolveWikiLink(CONTENT, 'Nonexistent')
    expect(result.type).toBe('fragment')
    if (result.type !== 'fragment') return
    expect(result.extraction.found).toBe(false)
  })
})
