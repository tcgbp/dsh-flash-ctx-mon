// src-client/ctx-window.js — pure context-window resolution + error parsing.
//
// Stateless: every function derives everything from its arguments. These were
// extracted from factory-body's createSessionEventTokenSource closure so the
// parsing/resolution rules can be unit-tested without DOM / react / settings.
//
// The pure resolver `resolveWindowFromMaps` is wrapped in the browser half by
// the pref-coupled `_resolveWindow`; the two error helpers are used directly.

import {
  CWS_USER_MAPPING,
  CWS_APPROX_DEFAULT,
} from './tokens.js'

export { CWS_USER_MAPPING, CWS_APPROX_DEFAULT } from './tokens.js'

/**
 * Try to extract a token count from a context-window-exceeded error message.
 * Providers typically include phrasing like "maximum context length is
 * 131072 tokens" or "context window of 128000". Returns the number or null.
 */
export function extractWindowFromError(msg) {
  if (typeof msg !== 'string') return null
  // Pattern: "maximum context length is NNN" / "context length of NNN" / "context window of NNN"
  const m = msg.match(/(?:maximum|max(?:imum)?\s+)?context\s+(?:length|window)(?:\s+is)?\s+(\d[\d,]*)/i)
    || msg.match(/(\d[\d,]*)\s+tokens?(?:\s+context)?/i)   // "131072 tokens context"
  if (!m) return null
  const num = parseInt(m[1].replace(/,/g, ''), 10)
  return (Number.isFinite(num) && num > 0) ? num : null
}

/**
 * Detect whether an error is a context-window-exceeded type.
 * Matches the CONTEXT_WINDOW_EXCEEDED code or common message patterns
 * used by providers (including Chinese "上下文超限").
 */
export function isContextLimitError(code, message) {
  if (code === 'CONTEXT_WINDOW_EXCEEDED') return true
  if (typeof message !== 'string') return false
  // Match English context-limit phrases
  if (/\b(?:context\s+(?:length|window)|maximum\s+context|exceeds?\s+(?:the\s+)?(?:model'?s?\s+)?(?:maximum\s+)?context)\b/i.test(message)) return true
  if (/\b(?:input|prompt|request)\s+(?:is\s+)?too\s+(?:long|large)\s+for\b/i.test(message)) return true
  // Match Chinese "上下文超限" (context limit exceeded)
  if (/上下文.*(?:超限|超出|溢出|超过)|exceed.*context|context.*exceed/i.test(message)) return true
  return false
}

/**
 * Pure core of the window-resolution chain. Given a model name and the two
 * user-mapped tables (modelContextWindows / modelContextWindowSources), return
 * `{ window, source }`. A model not present in the map resolves to
 * `{ window: null, source: CWS_APPROX_DEFAULT }` — the caller then falls back
 * to ctxApproxWindow. `source` for a mapped model comes from the provenance
 * table, defaulting to CWS_USER_MAPPING.
 */
export function resolveWindowFromMaps(modelName, userMap, userSources) {
  if (!modelName) return { window: null, source: CWS_APPROX_DEFAULT }
  if (userMap && typeof userMap === 'object' && userMap[modelName]) {
    const src = (userSources && typeof userSources === 'object' && userSources[modelName])
      ? userSources[modelName]
      : CWS_USER_MAPPING
    return { window: userMap[modelName], source: src }
  }
  return { window: null, source: CWS_APPROX_DEFAULT }
}