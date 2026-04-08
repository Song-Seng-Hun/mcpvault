import { describe, it, expect } from 'vitest'
import { extractFragment } from './extractFragment.js'

const FIXTURE = `# Document Title

Intro paragraph.

## Summary

Summary content here.

### Details Within Summary

Some details.

## Details

### How Code Works

Code explanation.

#### Step 1

Step 1 content.
More step 1 content.

#### Step 2

Step 2 content.

## References

- [[SomeLink]]
- [[AnotherLink]] ^refBlock
`

describe('extractFragment', () => {
  describe('heading extraction', () => {
    it('extracts h2 section with sub-headings included', () => {
      const result = extractFragment(FIXTURE, 'Summary')
      expect(result.found).toBe(true)
      if (!result.found) return
      expect(result.heading).toBe('Summary')
      expect(result.level).toBe(2)
      expect(result.content).toContain('## Summary')
      expect(result.content).toContain('### Details Within Summary')
      expect(result.content).toContain('Some details.')
      // Should NOT contain the next h2 section's content
      expect(result.content).not.toContain('### How Code Works')
    })

    it('extracts h4 section stopping at next h4', () => {
      const result = extractFragment(FIXTURE, 'Step 1')
      expect(result.found).toBe(true)
      if (!result.found) return
      expect(result.heading).toBe('Step 1')
      expect(result.level).toBe(4)
      expect(result.content).toContain('Step 1 content.')
      expect(result.content).toContain('More step 1 content.')
      expect(result.content).not.toContain('Step 2 content.')
    })

    it('is case-sensitive for heading matching (matches Obsidian behavior)', () => {
      const result = extractFragment(FIXTURE, 'how code works')
      expect(result.found).toBe(false)
      if (result.found) return
      expect(result.error).toBe('fragment_not_found')
      expect(result.fragment).toBe('how code works')
      expect(result.availableHeadings.some((h) => h.text === 'How Code Works')).toBe(true)
    })

    it('matches exact case', () => {
      const result = extractFragment(FIXTURE, 'How Code Works')
      expect(result.found).toBe(true)
      if (!result.found) return
      expect(result.heading).toBe('How Code Works')
    })

    it('accepts # prefix in fragment', () => {
      const result = extractFragment(FIXTURE, '#Summary')
      expect(result.found).toBe(true)
      if (!result.found) return
      expect(result.heading).toBe('Summary')
    })

    it('last section extends to end of content', () => {
      const result = extractFragment(FIXTURE, 'References')
      expect(result.found).toBe(true)
      if (!result.found) return
      expect(result.content).toContain('[[SomeLink]]')
      expect(result.content).toContain('[[AnotherLink]]')
    })

    it('returns structured error when heading not found', () => {
      const result = extractFragment(FIXTURE, 'Nonexistent Heading')
      expect(result.found).toBe(false)
      if (result.found) return
      expect(result.error).toBe('fragment_not_found')
      expect(result.fragment).toBe('Nonexistent Heading')
      expect(result.availableHeadings.length).toBeGreaterThan(0)
      expect(result.availableHeadings.some((h) => h.text === 'Summary')).toBe(true)
    })
  })

  describe('block-id extraction', () => {
    it('extracts block by ^block-id', () => {
      const result = extractFragment(FIXTURE, '^refBlock')
      expect(result.found).toBe(true)
      if (!result.found) return
      expect(result.content).toContain('[[SomeLink]]')
      expect(result.content).toContain('[[AnotherLink]]')
    })

    it('accepts #^ prefix', () => {
      const result = extractFragment(FIXTURE, '#^refBlock')
      expect(result.found).toBe(true)
      if (!result.found) return
      expect(result.content).toContain('[[AnotherLink]]')
    })

    it('returns structured error when block-id not found', () => {
      const result = extractFragment(FIXTURE, '^nonexistent')
      expect(result.found).toBe(false)
      if (result.found) return
      expect(result.error).toBe('fragment_not_found')
      expect(result.fragment).toBe('^nonexistent')
      expect(result.availableBlockIds).toContain('refBlock')
    })
  })

  describe('complex headings (real-world Obsidian patterns)', () => {
    const COMPLEX_FIXTURE = `# Analysis Plan

## Current State (2026-02-26)

Some status info.

### What Works

Things that work.

### Open Questions — RESOLVED (2026-02-26)

All resolved.

#### Q1: Regex Matcher Flavor — RESOLVED

ECMAScript regex confirmed.

## Decisions

### D1: Matcher Strategy — DECIDED: Option A

Using single grouped regex.

### D2: Hook Reload — DECIDED: Option B

Manual reload for now.

## Files

- hook.sh
- settings.json

## Status: COMPLETE (2026-02-26)

Done.

### Remaining Nice-to-Have

Some ideas. ^niceToHaveBlock
`

    it('matches heading with em-dash and colon', () => {
      const result = extractFragment(COMPLEX_FIXTURE, 'D1: Matcher Strategy — DECIDED: Option A')
      expect(result.found).toBe(true)
      if (!result.found) return
      expect(result.heading).toBe('D1: Matcher Strategy — DECIDED: Option A')
      expect(result.content).toContain('Using single grouped regex.')
      expect(result.content).not.toContain('Manual reload')
    })

    it('matches heading with parenthesized date', () => {
      const result = extractFragment(COMPLEX_FIXTURE, 'Current State (2026-02-26)')
      expect(result.found).toBe(true)
      if (!result.found) return
      expect(result.level).toBe(2)
      expect(result.content).toContain('What Works')
      expect(result.content).toContain('Open Questions')
      expect(result.content).not.toContain('## Decisions')
    })

    it('matches heading with em-dash and parenthesized date', () => {
      const result = extractFragment(COMPLEX_FIXTURE, 'Open Questions — RESOLVED (2026-02-26)')
      expect(result.found).toBe(true)
      if (!result.found) return
      expect(result.content).toContain('Q1: Regex Matcher Flavor')
    })

    it('matches heading with colon prefix pattern', () => {
      const result = extractFragment(COMPLEX_FIXTURE, 'Status: COMPLETE (2026-02-26)')
      expect(result.found).toBe(true)
      if (!result.found) return
      expect(result.content).toContain('Remaining Nice-to-Have')
    })

    it('case mismatch fails with available headings showing correct form', () => {
      const result = extractFragment(COMPLEX_FIXTURE, 'files')
      expect(result.found).toBe(false)
      if (result.found) return
      expect(result.error).toBe('fragment_not_found')
      expect(result.fragment).toBe('files')
      expect(result.availableHeadings.some((h) => h.text === 'Files')).toBe(true)
    })

    it('extracts block-id within a complex heading structure', () => {
      const result = extractFragment(COMPLEX_FIXTURE, '^niceToHaveBlock')
      expect(result.found).toBe(true)
      if (!result.found) return
      expect(result.content).toContain('Some ideas.')
    })
  })

  describe('content is bare', () => {
    it('returns raw text with no wrappers or metadata markers', () => {
      const result = extractFragment(FIXTURE, 'Step 1')
      expect(result.found).toBe(true)
      if (!result.found) return
      expect(result.content).not.toContain('<!-- Excerpt')
      expect(result.content).not.toContain('<!-- End excerpt')
      expect(result.content).not.toContain('![[')
      expect(result.content.startsWith('#### Step 1')).toBe(true)
    })
  })
})
