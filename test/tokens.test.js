// test/tokens.test.js — pure context-window formatting + source tags.
import { describe, it, expect } from 'vitest'
import {
  formatTokenK,
  formatTokenK1,
  effectiveSource,
  sourceLabelKey,
  sourceIcon,
  CWS_CATALOG_AUTO,
  CWS_BUILTIN_TABLE,
  CWS_ERROR_EXTRACTED,
  CWS_USER_MAPPING,
  CWS_APPROX_DEFAULT,
} from '../src-client/tokens.js'

describe('formatTokenK', () => {
  it('returns numbers below 1000 unchanged', () => {
    expect(formatTokenK(0)).toBe('0')
    expect(formatTokenK(999)).toBe('999')
    expect(formatTokenK(512)).toBe('512')
  })

  it('uses binary K for exact powers-of-two windows', () => {
    expect(formatTokenK(131072)).toBe('128K')
    expect(formatTokenK(65536)).toBe('64K')
    expect(formatTokenK(32768)).toBe('32K')
    expect(formatTokenK(1024)).toBe('1K')
  })

  it('uses decimal K for round-thousand approximations', () => {
    expect(formatTokenK(128000)).toBe('128K')
    expect(formatTokenK(1000)).toBe('1K')
    expect(formatTokenK(200000)).toBe('200K')
  })

  it('handles null / Infinity gracefully', () => {
    expect(formatTokenK(null)).toBe('null')
    expect(formatTokenK(Infinity)).toBe('Infinity')
    expect(formatTokenK(undefined)).toBe('undefined')
  })
})

describe('formatTokenK1 (one decimal)', () => {
  it('formats one-decimal K values', () => {
    expect(formatTokenK1(12300)).toBe('12.3K')
    expect(formatTokenK1(123456)).toBe('123.5K')
  })

  it('keeps sub-thousand values unchanged', () => {
    expect(formatTokenK1(500)).toBe('500')
  })
})

describe('effectiveSource', () => {
  it('passes through tags without a colon', () => {
    expect(effectiveSource(CWS_USER_MAPPING)).toBe(CWS_USER_MAPPING)
    expect(effectiveSource(null)).toBe(null)
  })

  it('unwraps catalog-auto compound sources to the inner tag', () => {
    const compound = CWS_CATALOG_AUTO + ':' + CWS_BUILTIN_TABLE
    expect(effectiveSource(compound)).toBe(CWS_BUILTIN_TABLE)
  })

  it('keeps the outer tag for error-extracted compound sources', () => {
    const compound = CWS_ERROR_EXTRACTED + ':CONTEXT_WINDOW_EXCEEDED'
    expect(effectiveSource(compound)).toBe(CWS_ERROR_EXTRACTED)
  })
})

describe('sourceLabelKey / sourceIcon', () => {
  it('maps known sources to i18n keys', () => {
    expect(sourceLabelKey(CWS_USER_MAPPING)).toBe('ctxSrcUserMapping')
    expect(sourceLabelKey(CWS_BUILTIN_TABLE)).toBe('ctxSrcBuiltinTable')
    expect(sourceLabelKey(CWS_APPROX_DEFAULT)).toBe('ctxSrcApproxDefault')
    expect(sourceLabelKey(CWS_ERROR_EXTRACTED)).toBe('ctxSrcErrorExtracted')
  })

  it('falls back to unknown for garbage', () => {
    expect(sourceLabelKey('nonsense')).toBe('ctxSrcUnknown')
    expect(sourceLabelKey(null)).toBe('ctxSrcUnknown')
    expect(sourceIcon('nonsense')).toBe('?')
  })
})
