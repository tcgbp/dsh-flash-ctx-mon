// test/auto-retry.test.js — unit tests for the pure auto-retry primitives.
import { describe, it, expect } from 'vitest'
import {
  RETRYABLE_END_REASONS,
  isRetryableEnd,
  backoffDelayMs,
  scheduleCooldown,
  inCooldown,
  makeDisarmedState,
  armState,
  shouldAutoContinue,
  consumeContinuation,
  isSelfEcho,
  retryAttemptKey,
  requestIdForAttempt,
} from '../src-client/auto-retry.js'

describe('isRetryableEnd', () => {
  it('accepts error, interrupted and max-tokens reasons', () => {
    expect(RETRYABLE_END_REASONS).toContain('error')
    expect(RETRYABLE_END_REASONS).toContain('interrupted')
    expect(RETRYABLE_END_REASONS).toContain('max-tokens')
    expect(isRetryableEnd({ kind: 'error' })).toBe(true)
    expect(isRetryableEnd({ kind: 'interrupted' })).toBe(true)
    expect(isRetryableEnd({ kind: 'max-tokens' })).toBe(true)
    expect(isRetryableEnd({ kind: 'error', error: { message: 'CONTEXT_WINDOW_EXCEEDED' } })).toBe(true)
  })

  it('rejects completion, unknown kinds and garbage', () => {
    expect(isRetryableEnd({ kind: 'completion' })).toBe(false)
    expect(isRetryableEnd({ kind: 'watched-arithmetic' })).toBe(false)
    expect(isRetryableEnd({ kind: 'canceled' })).toBe(false)
    expect(isRetryableEnd(null)).toBe(false)
    expect(isRetryableEnd(undefined)).toBe(false)
    expect(isRetryableEnd({})).toBe(false)
    expect(isRetryableEnd({ kind: '' })).toBe(false)
  })

  // The split the user asked for: process/environment hard interruption
  // (→ session-level `interrupted` turn/end) MUST auto-continue, while a
  // user clicking Stop / new input taking over the turn (→ session-level
  // `aborted` turn/end carrying an `AgentCancelCause`) must NOT. DSH's
  // TurnEndReasonMap already spells these as distinct `reason.kind` values,
  // so the retryable whitelist alone implements the whole distinction —
  // `aborted` is never in RETRYABLE_END_REASONS.
  it('auto-continues on environment/process interruption (kind "interrupted")', () => {
    // Crash-orphaned turn closed after the fact / live-recovery closer.
    expect(isRetryableEnd({ kind: 'interrupted' })).toBe(true)
  })

  it('never auto-continues on a user stop / new-input takeover (kind "aborted")', () => {
    // `aborted` groups all AgentCancelCause origins (user, parent, hook,
    // disposed) and is explicitly excluded from the retryable whitelist.
    expect(isRetryableEnd({ kind: 'aborted' })).toBe(false)
    expect(isRetryableEnd({ kind: 'aborted', reason: { kind: 'user' } })).toBe(false)
    expect(isRetryableEnd({ kind: 'aborted', reason: { kind: 'parent' } })).toBe(false)
    expect(isRetryableEnd({ kind: 'aborted', reason: { kind: 'hook', reason: 'test' } })).toBe(false)
    expect(isRetryableEnd({ kind: 'aborted', reason: { kind: 'disposed' } })).toBe(false)
  })
})

describe('backoffDelayMs', () => {
  it('starts at the grace period and doubles each level', () => {
    expect(backoffDelayMs(5000, 0, null)).toBe(5000)
    expect(backoffDelayMs(5000, 1, null)).toBe(10000)
    expect(backoffDelayMs(5000, 2, null)).toBe(20000)
    expect(backoffDelayMs(5000, 3, null)).toBe(40000)
  })

  it('caps at maxBackoffMs and never overflows', () => {
    expect(backoffDelayMs(5000, 10, 300000)).toBe(300000)
    expect(backoffDelayMs(5000, 2, 15000)).toBe(15000)
    expect(backoffDelayMs(5000, 999, 300000)).toBe(300000)
    expect(Number.isFinite(backoffDelayMs(999999, 999, null))).toBe(true)
  })

  it('treats a non-positive grace as zero delay and negative level as level 0', () => {
    expect(backoffDelayMs(0, 3, null)).toBe(0)
    expect(backoffDelayMs(-100, 3, null)).toBe(0)
    expect(backoffDelayMs(5000, -3, null)).toBe(5000)
    expect(backoffDelayMs(5000, undefined, null)).toBe(5000)
  })
})

describe('cooldown scheduling', () => {
  it('scheduleCooldown returns now + cooldownMs for positive intervals', () => {
    expect(scheduleCooldown(1000, 20000)).toBe(21000)
    expect(scheduleCooldown(123456, 5000)).toBe(128456)
  })

  it('scheduleCooldown returns null for absent or non-positive intervals', () => {
    expect(scheduleCooldown(1000, 0)).toBe(null)
    expect(scheduleCooldown(1000, -5)).toBe(null)
    expect(scheduleCooldown(1000, null)).toBe(null)
    expect(scheduleCooldown(1000, undefined)).toBe(null)
  })

  it('inCooldown respects the deadline boundaries', () => {
    var until = scheduleCooldown(1000, 20000) // 21000 → next action allowed at/after 21000
    expect(inCooldown(until, 500)).toBe(true)    // any time before the deadline is still cooldown
    expect(inCooldown(until, 20000)).toBe(true)  // just before the deadline
    expect(inCooldown(until, 21000)).toBe(false) // exactly at the deadline → allowed
    expect(inCooldown(until, 999999)).toBe(false) // after → allowed
    expect(inCooldown(null, 20000)).toBe(false)  // no cooldown configured
    expect(inCooldown(21000, null)).toBe(false)
  })
})

describe('armed-state machine helpers', () => {
  it('makeDisarmedState starts disarmed with no budget', () => {
    var s = makeDisarmedState()
    expect(s.armed).toBe(false)
    expect(s.paused).toBe(false)
    expect(s.remaining).toBe(0)
    expect(s.sessionId).toBe(null)
    expect(s.cooldownUntil).toBe(null)
  })

  it('armState keys the budget to a session and resets backoff', () => {
    var s = armState(makeDisarmedState(), 'sess-1', 4, 5000)
    expect(s.armed).toBe(true)
    expect(s.paused).toBe(false)
    expect(s.sessionId).toBe('sess-1')
    expect(s.remaining).toBe(4)
    expect(s.backoffLevel).toBe(0)
    expect(s.lastSendAt).toBe(5000)
    expect(s.cooldownUntil).toBe(null)
  })

  it('armState clamps a non-positive budget to 0', () => {
    var s = armState(makeDisarmedState(), 'sess-1', 0, 1)
    expect(s.remaining).toBe(0)
    expect(s.sessionId).toBe('sess-1')
  })

  it('shouldAutoContinue requires armed + budget + no cooldown + not paused', () => {
    var armed = armState(makeDisarmedState(), 'sess-1', 4, 0)
    expect(shouldAutoContinue(armed, 1)).toBe(true)

    expect(shouldAutoContinue(makeDisarmedState(), 1)).toBe(false)

    var exhausted = consumeContinuation(armed, 1, 100) // last slot spent
    expect(exhausted.remaining).toBe(3)
    expect(shouldAutoContinue(exhausted, 1)).toBe(false) // now inside cooldown

    var afterCooldown = { ...exhausted, cooldownUntil: scheduleCooldown(1, 100) }
    expect(shouldAutoContinue(afterCooldown, 1)).toBe(false)
    expect(shouldAutoContinue(afterCooldown, 200)).toBe(true)

    expect(shouldAutoContinue({ ...armed, paused: true }, 1)).toBe(false)
    expect(shouldAutoContinue({ ...armed, remaining: 0 }, 1)).toBe(false)
  })

  it('consumeContinuation spends budget, raises level and opens cooldown', () => {
    var s = armState(makeDisarmedState(), 'sess-1', 4, 1000)
    var c1 = consumeContinuation(s, 1000, 20000)
    expect(c1.remaining).toBe(3)
    expect(c1.backoffLevel).toBe(1)
    expect(c1.cooldownUntil).toBe(21000)

    var c2 = consumeContinuation(c1, 21000, 20000)
    expect(c2.remaining).toBe(2)
    expect(c2.backoffLevel).toBe(2)
    expect(c2.cooldownUntil).toBe(41000)

    var c3 = consumeContinuation({ ...c2, remaining: 1 }, 41000, 20000)
    expect(c3.remaining).toBe(0) // floored at 0, never negative
    expect(c3.backoffLevel).toBe(3)
  })
})

describe('isSelfEcho (§5.4 echo recognition)', () => {
  var entry = { source: { kind: 'user', rpcId: 'req-1' }, text: '继续', ts: 1000 }
  var CONT = '继续'
  var WINDOW = 30000

  it('matches our own echoed continue when rpcId exactly matches and it lands in-window', () => {
    expect(isSelfEcho(entry, 'req-1', CONT, WINDOW, 500, 1000)).toBe(true)
  })

  it('matches an rpcId-less user message with the same text inside the window', () => {
    var noRpc = { source: { kind: 'user' }, text: CONT, ts: 1000 }
    expect(isSelfEcho(noRpc, 'req-1', CONT, WINDOW, 500, 1000)).toBe(true)
  })

  it('rejects a user message whose rpcId differs from our pending requestId', () => {
    // A UI/other-rpc user message with the same text must NOT read as our echo.
    var otherRpc = { source: { kind: 'user', rpcId: 'req-OTHER' }, text: CONT, ts: 1000 }
    expect(isSelfEcho(otherRpc, 'req-1', CONT, WINDOW, 500, 1000)).toBe(false)
  })

  it('rejects an rpc-carrying entry when there is no pending requestId', () => {
    expect(isSelfEcho(entry, null, CONT, WINDOW, 500, 1000)).toBe(false)
  })

  it('rejects non-user sources', () => {
    var bot = { source: { kind: 'other' }, text: CONT, ts: 1000 }
    expect(isSelfEcho(bot, 'req-1', CONT, WINDOW, 500, 1000)).toBe(false)
    var noSource = { text: CONT, ts: 1000 }
    expect(isSelfEcho(noSource, 'req-1', CONT, WINDOW, 500, 1000)).toBe(false)
    expect(isSelfEcho(null, 'req-1', CONT, WINDOW, 500, 1000)).toBe(false)
  })

  it('rejects different text', () => {
    var cont = { source: { kind: 'user', rpcId: 'req-1' }, text: '说下去', ts: 1000 }
    expect(isSelfEcho(cont, 'req-1', CONT, WINDOW, 500, 1000)).toBe(false)
  })

  it('rejects an entry outside the echo window', () => {
    expect(isSelfEcho(entry, 'req-1', CONT, WINDOW, 500, 500 + WINDOW + 1)).toBe(false)
  })

  it('treats a missing window as no window constraint', () => {
    expect(isSelfEcho(entry, 'req-1', CONT, 0, 500, 999999)).toBe(true)
    expect(isSelfEcho(entry, 'req-1', CONT, null, 500, 999999)).toBe(true)
  })
})

describe('idempotent requestId (§5.8)', () => {
  it('retryAttemptKey is distinct per session and attempt', () => {
    expect(retryAttemptKey('a', 1)).toBe('a#1')
    expect(retryAttemptKey('b', 1)).not.toBe(retryAttemptKey('a', 1))
    expect(retryAttemptKey('a', 2)).not.toBe(retryAttemptKey('a', 1))
    expect(retryAttemptKey(null, 1)).toBe('#1')
  })

  it('requestIdForAttempt mints at most once per key', () => {
    var cache = new Map()
    var calls = 0
    function mint(key) { calls += 1; return 'req-' + calls }
    var first = requestIdForAttempt(cache, retryAttemptKey('a', 1), mint)
    var again = requestIdForAttempt(cache, retryAttemptKey('a', 1), mint)
    expect(first).toBe(again)
    expect(calls).toBe(1)

    var other = requestIdForAttempt(cache, retryAttemptKey('a', 2), mint)
    expect(other).not.toBe(first)
    expect(calls).toBe(2)
    // A different session shares no cache slot.
    var sessB = requestIdForAttempt(cache, retryAttemptKey('b', 1), mint)
    expect(sessB).not.toBe(first)
    expect(calls).toBe(3)
  })

  it('requestIdForAttempt tolerates a missing cache without minting', () => {
    expect(requestIdForAttempt(null, 'x#1', function () { throw new Error('should not mint') })).toBe(null)
  })
})
