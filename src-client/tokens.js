// src-client/tokens.js — pure token/window formatting + context-window source tags.
//
// This module is intentionally stateless: every function derives everything
// from its arguments, so it is a safe unit-test target with no DOM / react /
// settings-service dependency.

/**
 * Format a token count as a human-readable binary-K string.
 *
 * Context windows are conventionally powers of two expressed as KiB
 * (131072 = 128K, 65536 = 64K, 32768 = 32K), so formatting always divides
 * by 1024, regardless of whether the value is 2^n-aligned or a round
 * thousand like 128000 (→ 125K). No special-casing between binary and
 * decimal K — one rule, 1024-based.
 */
export function formatTokenK(v) {
  if (v == null || !isFinite(v)) return '' + v
  if (v < 1024) return '' + v
  return Math.round(v / 1024) + 'K'
}

/**
 * Format a token count with one decimal place as binary K (e.g. "133.8K").
 * Used for live pressure/breakdown values that aren't exact 2^n; also 1024-based.
 */
export function formatTokenK1(v) {
  if (v == null || !isFinite(v)) return '' + v
  if (v < 1024) return '' + v
  return (v / 1024).toFixed(1) + 'K'
}

// ── Context window source tags ─────────────────────────────────────────────

export const CWS_REQUEST_CONTEXT = 'request-context' // DSH request/context event (adapter-resolved)
export const CWS_CATALOG_AUTO = 'catalog-auto' // Auto-filled from DSH model catalog + _resolveWindow
export const CWS_ERROR_EXTRACTED = 'error-extracted' // Parsed from CONTEXT_WINDOW_EXCEEDED error
export const CWS_USER_MAPPING = 'user-mapping' // User modelContextWindows override
export const CWS_BUILTIN_TABLE = 'builtin-table' // Built-in _KNOWN_WINDOWS
export const CWS_FUZZY_MATCH = 'fuzzy-match' // Fuzzy-matched into _KNOWN_WINDOWS
export const CWS_CATALOG_UNKNOWN = 'catalog-unknown' // Catalog model with no resolved window
export const CWS_APPROX_DEFAULT = 'approximate-default' // ctxApproxWindow fallback

/**
 * Extract the meaningful source tag from a (possibly compound) source.
 * Compound format: 'catalog-auto:builtin-table' — the inner part is a valid
 * source tag (the original source the auto-fill derived from). Other compounds
 * like 'error-extracted:CONTEXT_WINDOW_EXCEEDED' carry metadata after the
 * colon (an error code), NOT a source tag — the outer part is the real source.
 */
export function effectiveSource(sourceTag) {
  if (!sourceTag || sourceTag.indexOf(':') < 0) return sourceTag
  const outer = sourceTag.slice(0, sourceTag.indexOf(':'))
  const inner = sourceTag.slice(sourceTag.indexOf(':') + 1)
  // Only catalog-auto uses the inner part as a valid source tag
  if (outer === CWS_CATALOG_AUTO) return inner
  return outer
}

/** Map a context-window source tag to a human-readable i18n key. */
export function sourceLabelKey(sourceTag) {
  if (!sourceTag) return 'ctxSrcUnknown'
  switch (effectiveSource(sourceTag)) {
    case CWS_REQUEST_CONTEXT: return 'ctxSrcRequestContext'
    case CWS_CATALOG_AUTO: return 'ctxSrcCatalogAuto'
    case CWS_CATALOG_UNKNOWN: return 'ctxSrcCatalogUnknown'
    case CWS_ERROR_EXTRACTED: return 'ctxSrcErrorExtracted'
    case CWS_USER_MAPPING: return 'ctxSrcUserMapping'
    case CWS_BUILTIN_TABLE: return 'ctxSrcBuiltinTable'
    case CWS_FUZZY_MATCH: return 'ctxSrcFuzzyMatch'
    case CWS_APPROX_DEFAULT: return 'ctxSrcApproxDefault'
    default: return 'ctxSrcUnknown'
  }
}

/** Short source icon for the badge in the editor. */
export function sourceIcon(sourceTag) {
  if (!sourceTag) return '?'
  switch (effectiveSource(sourceTag)) {
    case CWS_REQUEST_CONTEXT: return '📡'
    case CWS_CATALOG_AUTO: return '📋'
    case CWS_CATALOG_UNKNOWN: return '📋'
    case CWS_ERROR_EXTRACTED: return '⚠️'
    case CWS_USER_MAPPING: return '👤'
    case CWS_BUILTIN_TABLE: return '📖'
    case CWS_FUZZY_MATCH: return '🔍'
    case CWS_APPROX_DEFAULT: return '📐'
    default: return '?'
  }
}
