import { describe, it, expect } from 'vitest'
import { parseFragment } from './parseFragment.js'

describe('parseFragment', () => {
  it('parses heading with leading #', () => {
    expect(parseFragment('#Heading Text')).toEqual({
      type: 'heading',
      target: 'Heading Text',
    })
  })

  it('parses heading without leading #', () => {
    expect(parseFragment('Heading Text')).toEqual({
      type: 'heading',
      target: 'Heading Text',
    })
  })

  it('parses block ID with leading #', () => {
    expect(parseFragment('#^block-id')).toEqual({
      type: 'blockId',
      target: 'block-id',
    })
  })

  it('parses block ID without leading #', () => {
    expect(parseFragment('^block-id')).toEqual({
      type: 'blockId',
      target: 'block-id',
    })
  })

  it('parses camelCase block ID', () => {
    expect(parseFragment('#^infoHowCodeLooks')).toEqual({
      type: 'blockId',
      target: 'infoHowCodeLooks',
    })
  })

  it('handles empty string gracefully', () => {
    expect(parseFragment('')).toEqual({
      type: 'heading',
      target: '',
    })
  })

  it('handles whitespace-only string gracefully', () => {
    expect(parseFragment('   ')).toEqual({
      type: 'heading',
      target: '',
    })
  })
})
