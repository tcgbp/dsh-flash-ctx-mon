// test/skill-detect.test.js — skill-content block detection.
import { describe, it, expect } from 'vitest'
import { parseSkillBlock, findSkillBlock, SKILL_CONTENT_PREFIX } from '../src-client/skill-detect.js'

// NOTE: SKILL_CONTENT_PREFIX already includes the leading '<', so tests build
// a real block as `${SKILL_CONTENT_PREFIX}name">...` — no extra '<'.
function block(name, body) {
  return `${SKILL_CONTENT_PREFIX}${name}">${body || 'body'}</${'skill_content'}>`
}

describe('parseSkillBlock', () => {
  it('extracts the name from a leading skill-content block', () => {
    expect(parseSkillBlock(block('dsh-repo-analysis'))).toBe('dsh-repo-analysis')
  })

  it('trims leading whitespace before matching', () => {
    expect(parseSkillBlock(`   ${block('my-skill')}`)).toBe('my-skill')
  })

  it('returns null when the tag does not start the block', () => {
    // Prose that merely QUOTES the tag mid-sentence must NOT match.
    const prose = `The skill loads a ${block('foo')} snippet.`
    expect(parseSkillBlock(prose)).toBe(null)
  })

  it('returns null for a bare tag with no closing quote', () => {
    expect(parseSkillBlock(`${SKILL_CONTENT_PREFIX}unclosed`)).toBe(null)
  })

  it('returns null for non-string input', () => {
    expect(parseSkillBlock(null)).toBe(null)
    expect(parseSkillBlock(42)).toBe(null)
  })

  it('rejects unreasonably long names', () => {
    expect(parseSkillBlock(block('x'.repeat(300)))).toBe(null)
  })
})

describe('findSkillBlock (depth-first over message trees)', () => {
  it('finds a block in a plain string', () => {
    expect(findSkillBlock(block('alpha'), 0)).toBe('alpha')
  })

  it('finds a block inside an array of text blocks', () => {
    const tree = [
      { type: 'text', text: 'intro' },
      block('beta'),
    ]
    expect(findSkillBlock(tree, 0)).toBe('beta')
  })

  it('finds a block nested deep in an object tree', () => {
    const tree = { a: { b: { content: { text: block('gamma') } } } }
    expect(findSkillBlock(tree, 0)).toBe('gamma')
  })

  it('respects the depth cap and does not recurse forever', () => {
    let root = {}
    let node = root
    for (let i = 0; i < 20; i++) { node.k = {}; node = node.k }
    node.leaf = block('deep')
    expect(findSkillBlock(root, 0)).toBe(null)
    expect(findSkillBlock(root, 4)).toBe(null)
  })

  it('returns null for trees with no skill block', () => {
    expect(findSkillBlock('plain text', 0)).toBe(null)
    expect(findSkillBlock([1, 2, 3], 0)).toBe(null)
    expect(findSkillBlock(null, 0)).toBe(null)
  })
})