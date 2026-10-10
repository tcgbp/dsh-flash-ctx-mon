// src-client/skill-detect.js — pure detection of loaded-skill blocks.
//
// The one authoritative signal that a skill body was loaded is the
// `<skill_content name="X">` block DSH emits. Two surrounding behaviors matter:
//
//   1. FAILED skill calls carry no such block, so requiring the tag to START a
//      text block keeps failures out without inspecting any error field.
//   2. Prose that merely QUOTES the tag (a chat message discussing this feature,
//      a grep hit in a tool result) never matches — a naive substring scan used
//      to produce 20 false hits, all of them assistant messages quoting the tag
//      mid-sentence.
//
// Both functions are pure (`text`/`value` in, name-or-null out), so they are
// safe, dependency-free unit-test targets.

/** The tag a loaded skill body always starts with. */
export const SKILL_CONTENT_PREFIX = '<skill_content name="'

/**
 * Parse the skill name out of a text block that IS a skill-content block.
 * Returns null for anything else, including prose that mentions the tag
 * part-way through.
 */
export function parseSkillBlock(text) {
  if (typeof text !== 'string') return null
  const s = text.replace(/^\s+/, '')
  if (s.indexOf(SKILL_CONTENT_PREFIX) !== 0) return null
  const rest = s.slice(SKILL_CONTENT_PREFIX.length)
  const end = rest.indexOf('"')
  if (end <= 0) return null
  const name = rest.slice(0, end)
  if (!name || name.length > 200) return null
  return name
}

/**
 * Depth-first search for the first text block that IS a skill-content block.
 * `value` is a message-content tree from a session event: either user/message's
 * `data.content` or tool/result's `data.message.content`.
 */
export function findSkillBlock(value, depth) {
  if (value == null || depth > 4) return null
  if (typeof value === 'string') return parseSkillBlock(value)
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findSkillBlock(value[i], depth + 1)
      if (hit) return hit
    }
    return null
  }
  if (typeof value === 'object') {
    if (typeof value.text === 'string') {
      const direct = parseSkillBlock(value.text)
      if (direct) return direct
    }
    const keys = Object.keys(value)
    for (let k = 0; k < keys.length; k++) {
      const child = value[keys[k]]
      if (child && typeof child === 'object') {
        const nested = findSkillBlock(child, depth + 1)
        if (nested) return nested
      }
    }
  }
  return null
}
