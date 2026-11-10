// src-client/auto-retry.js — pure auto-retry / auto-continue decision primitives.
//
// This module is deliberately STATELESS and PURE (data + guards only), the same
// shape as src-client/tokens.js. No timers, no session access, no DOM: the
// AutoRetryRunner lives inline in factory-body.js (§6 of the auto-retry design)
// and composes these helpers against the current session binding. Keeping the
// decision logic here makes it directly unit-testable with Vitest.

/** turn/end reason kinds that warrant an automatic continue. */
export var RETRYABLE_END_REASONS = ['error', 'interrupted', 'max-tokens']

/**
 * isRetryableEnd — true when a turn/end `reason` matches the retryable kinds
 * (error / interrupted / max-tokens, §4 of the design).
 */
export function isRetryableEnd(reason) {
  return !!(reason && reason.kind && RETRYABLE_END_REASONS.indexOf(reason.kind) >= 0)
}

/**
 * backoffDelayMs — exponential backoff with a hard cap.
 *
 * delay = min(graceMs * 2^level, maxBackoffMs). A non-positive graceMs yields
 * 0; a non-positive/absent maxBackoffMs disables the cap. The exponent is
 * clamped so absurdly high retry levels can never overflow to NaN.
 */
export function backoffDelayMs(graceMs, level, maxBackoffMs) {
  if (!(graceMs > 0)) return 0
  var n = typeof level === 'number' && level > 0 ? level : 0
  if (n > 20) n = 20 // 2^20 * grace is already past every real cap
  var raw = graceMs * Math.pow(2, n)
  if (!isFinite(raw)) raw = Number.MAX_SAFE_INTEGER
  return maxBackoffMs > 0 ? Math.min(raw, maxBackoffMs) : raw
}

/**
 * scheduleCooldown — deadline after which a same-session action is allowed
 * again. Returns null when cooldownMs is absent or non-positive (no cooldown).
 */
export function scheduleCooldown(nowMs, cooldownMs) {
  if (!(cooldownMs > 0) || nowMs == null) return null
  return nowMs + cooldownMs
}

/**
 * inCooldown — true when `nowMs` is still before `cooldownUntil`.
 * A null deadline (no cooldown) is never "in cooldown".
 */
export function inCooldown(cooldownUntil, nowMs) {
  return cooldownUntil != null && nowMs != null && nowMs < cooldownUntil
}

/**
 * makeDisarmedState — the base state before arming (just the button exists).
 * All fields are session-agnostic until `armState` keys them to a session.
 */
export function makeDisarmedState() {
  return {
    armed: false,
    paused: false,
    sessionId: null,
    remaining: 0,
    backoffLevel: 0,
    cooldownUntil: null,
    lastSendAt: null,
    lastRequestId: null,
  }
}

/**
 * armState — transition a state into "armed · waiting" for `sessionId` with a
 * fresh consecutive budget. Whether the budget is the configured
 * `maxConsecutive` or the remaining slot is up to the caller (the runner always
 * re-arms the current session from its starting budget).
 */
export function armState(state, sessionId, remaining, nowMs) {
  return {
    armed: true,
    paused: false,
    sessionId: sessionId == null ? null : String(sessionId),
    remaining: remaining > 0 ? remaining : 0,
    backoffLevel: 0,
    cooldownUntil: null,
    lastSendAt: nowMs == null ? null : nowMs,
    lastRequestId: null,
  }
}

/**
 * shouldAutoContinue — the armed-but-idle gate (§4 "已武装·等待"). True only
 * when armed, not paused, still has budget, and is not inside cooldown.
 */
export function shouldAutoContinue(state, nowMs) {
  if (!state || !state.armed) return false
  if (state.paused) return false
  if (!(state.remaining > 0)) return false
  if (inCooldown(state.cooldownUntil, nowMs)) return false
  return true
}

/**
 * consumeContinuation — immutable transition for the moment a continue is
 * actually dispatched: spends one slot, raises the backoff level (each
 * successive failure waits longer), and opens the cooldown window.
 */
export function consumeContinuation(state, nowMs, cooldownMs) {
  var prev = state || {}
  return {
    armed: !!prev.armed,
    paused: !!prev.paused,
    sessionId: prev.sessionId == null ? null : String(prev.sessionId),
    remaining: Math.max(0, (prev.remaining || 0) - 1),
    backoffLevel: (prev.backoffLevel || 0) + 1,
    cooldownUntil: scheduleCooldown(nowMs, cooldownMs),
    lastSendAt: nowMs == null ? null : nowMs,
    lastRequestId: prev.lastRequestId == null ? null : String(prev.lastRequestId),
  }
}

/**
 * isSelfEcho — §5.4 echo recognition.
 *
 * An entry `{ source, text, ts }` is our own "继续" echo when ALL hold:
 *  - source.kind === 'user'  (self-sent prompts land as a user-rpc source),
 *  - if the source carries an `rpcId` it must EXACTLY equal the requestId of
 *    the pending auto-continue (so the UI's own rpc-carrying messages never
 *    read as our echo, and an echoed prompt is provably ours), and
 *  - text equals `continueText` AND (when echoWindowMs / timestamps are
 *    supplied) it arrived within `echoWindowMs` of `sentAtMs`.
 *
 * A matching entry is OURS: it must not clear the loop nor count against the
 * consecutive budget; a user message that does NOT match is human input and
 * disarms (§5.5).
 */
export function isSelfEcho(entry, selfRequestId, continueText, echoWindowMs, sentAtMs, nowMs) {
  if (!entry) return false
  var source = entry.source
  if (!source || source.kind !== 'user') return false
  if (source.rpcId != null) {
    if (selfRequestId == null || source.rpcId !== selfRequestId) return false
  }
  if (entry.text !== continueText) return false
  if (echoWindowMs > 0 && sentAtMs != null && nowMs != null) {
    if (nowMs - sentAtMs > echoWindowMs) return false
  }
  return true
}

/**
 * retryAttemptKey — stable identity for a continuation attempt so the
 * self-signed requestId stays idempotent across network re-sends (§5.8).
 */
export function retryAttemptKey(sessionId, attemptSeq) {
  return String(sessionId == null ? '' : sessionId) + '#' + String(attemptSeq)
}

/**
 * requestIdForAttempt — memoize the minted requestId for an attempt key.
 * `mint` is called at most once per key (per session + attempt token), so an
 * idempotent, stable requestId survives retries of the same logical send.
 */
export function requestIdForAttempt(cache, attemptKey, mint) {
  if (!cache) return null
  if (!cache.has(attemptKey)) cache.set(attemptKey, mint(attemptKey))
  return cache.get(attemptKey)
}
