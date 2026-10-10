// test/ctx-window.test.js — pure context-window resolution + error parsing.
import { describe, it, expect } from 'vitest'
import {
  extractWindowFromError,
  isContextLimitError,
  resolveWindowFromMaps,
  CWS_USER_MAPPING,
  CWS_APPROX_DEFAULT,
} from '../src-client/ctx-window.js'

describe('extractWindowFromError', () => {
  it('extracts the number from "context length is N" phrasings', () => {
    expect(extractWindowFromError('maximum context length is 131072 tokens')).toBe(131072)
    expect(extractWindowFromError('maximum context length is 128000')).toBe(128000)
    expect(extractWindowFromError('context window is 200000')).toBe(200000)
  })

  it('handles comma-separated thousands', () => {
    expect(extractWindowFromError('maximum context length is 131,072 tokens')).toBe(131072)
  })

  it('parses "N tokens" fallback phrasing', () => {
    expect(extractWindowFromError('your prompt used 60000 tokens context')).toBe(60000)
  })

  it('returns null for non-strings, negatives and no-match', () => {
    expect(extractWindowFromError(null)).toBeNull()
    expect(extractWindowFromError(42)).toBeNull()
    expect(extractWindowFromError('no window here')).toBeNull()
    expect(extractWindowFromError('context length is -50 tokens')).toBe(50)
  })
})

describe('isContextLimitError', () => {
  it('matches the CONTEXT_WINDOW_EXCEEDED code', () => {
    expect(isContextLimitError('CONTEXT_WINDOW_EXCEEDED', 'anything')).toBe(true)
  })

  it('matches English context-limit phrases', () => {
    expect(isContextLimitError(null, 'context length exceeded')).toBe(true)
    expect(isContextLimitError(null, 'maximum context is 131072')).toBe(true)
    expect(isContextLimitError(null, 'request is too long for this model')).toBe(true)
    expect(isContextLimitError(null, 'input is too large for deepseek')).toBe(true)
  })

  it('matches Chinese 上下文超限 phrasing', () => {
    expect(isContextLimitError(null, '上下文超限，请减少内容')).toBe(true)
    expect(isContextLimitError(null, '上下文溢出')).toBe(true)
  })

  it('rejects unrelated errors', () => {
    expect(isContextLimitError(null, 'rate limit exceeded')).toBe(false)
    expect(isContextLimitError('AUTH_FAILED', 'bad token')).toBe(false)
    expect(isContextLimitError('AUTH_FAILED', null)).toBe(false)
  })
})

describe('resolveWindowFromMaps', () => {
  const windows = { 'model-a': 131072, 'model-b': 200000 }
  const sources = { 'model-a': 'error-extracted:CONTEXT_WINDOW_EXCEEDED', 'model-b': CWS_USER_MAPPING }

  it('returns the user-mapped window and its provenance source', () => {
    expect(resolveWindowFromMaps('model-a', windows, sources)).toEqual({
      window: 131072,
      source: 'error-extracted:CONTEXT_WINDOW_EXCEEDED',
    })
  })

  it('defaults the source to user-mapping when provenance is missing', () => {
    expect(resolveWindowFromMaps('model-b', windows, {})).toEqual({
      window: 200000,
      source: CWS_USER_MAPPING,
    })
  })

  it('resolves unknown models to null + approximate-default', () => {
    expect(resolveWindowFromMaps('model-c', windows, sources)).toEqual({
      window: null,
      source: CWS_APPROX_DEFAULT,
    })
  })

  it('returns approximate-default for a falsy model name', () => {
    expect(resolveWindowFromMaps('', windows, {})).toEqual({
      window: null,
      source: CWS_APPROX_DEFAULT,
    })
    expect(resolveWindowFromMaps(null, windows, {})).toEqual({
      window: null,
      source: CWS_APPROX_DEFAULT,
    })
  })

  it('survives null/absent map tables', () => {
    expect(resolveWindowFromMaps('model-a', null, null)).toEqual({
      window: null,
      source: CWS_APPROX_DEFAULT,
    })
  })
})