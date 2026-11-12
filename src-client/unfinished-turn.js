// src-client/unfinished-turn.js — pure open-turn ledger & watchdog primitives.
//
// Detects the DSH persistence gap "a session/run started (a turn produced
// events) but then stopped without ever producing a closing turn/end"
// (form ① of docs/detecting-unfinished-session.zh-CN.md, §2). Per that doc
// and architecture.zh.md, ordinary interruption residuals are NOT auto-closed
// by a closing turn/end — only a later turn/start seals the rolled-out
// restart — and a hard process loss never emits one at all. So "unsettled yet
// stopped" can never be decided by a future event; it is an inference the
// consumer must make from silence. That inference is what this module helps
// express, in a form that is unit-testable.
//
// Like src-client/auto-retry.js this module is deliberately STATELESS and
// PURE (data + guards only). No timers, no session access, no DOM: the
// stateful ledger lives inline in factory-body.js (wired into _processEntries
// on turn/start and turn/end) and composes these helpers against each session
// binding. The ledger is isolated PER SESSION ID: each session keeps its own
// set of open turns, so switching the tracked session never destroys another
// session's accounting and an un-visited session is never falsely judged.
//
// The module only REMINDS/FLAGS; it never auto-continues. Form ① may signal a
// host anomaly, and blindly re-prompting would repeatedly fail and bill tokens
// (as opposed to auto-retry, which deliberately continues on a known retryable
// end reason).

/** One open turn: the wall-clock it was first observed opened, plus which
 *  token-source binding observed it (informational only, survives session
 *  switches). Identity is the openedAt timestamp: DSH handles turns
 *  sequentially per session, so the ledger is an ordered list and a closing
 *  turn/end retires the OLDEST open turn (FIFO). */
var LEDGER = 'openTurns'

/** Create a fresh, empty ledger state. Shape: { openTurns: { } } where each
 *  value is an ordered array of open-turn records. */
export function makeLedger() {
  return { openTurns: Object.create(null) }
}

/**
 * noteOpenTurn — record that a turn started for `sessionId` at `openedAt`.
 * Returns a NEW state (immutable copy of the touched session's array) so the
 * caller can keep treating state functionally; an absent/blank sessionId is a
 * no-op returning the same state reference.
 * @param state the current ledger ({ openTurns })
 * @param opts { sessionId, openedAt, tokenSourceId? }
 * @returns a ledger state
 */
export function noteOpenTurn(state, opts) {
  var sid = opts && opts.sessionId
  if (!sid) return state
  var list = (state.openTurns[sid] || []).slice()
  var rec = { openedAt: typeof opts.openedAt === 'number' ? opts.openedAt : 0 }
  if (opts.tokenSourceId != null) rec.tokenSourceId = opts.tokenSourceId
  list.push(rec)
  var next = { openTurns: Object.assign(Object.create(null), state.openTurns) }
  next.openTurns[sid] = list
  return next
}

/**
 * noteClosedTurn — retire the OLDEST open turn of `sessionId`. DSH resolves a
 * session's turns sequentially, so the matching turn/end that finally arrives
 * closes the earliest still-open ledger entry (the residual tail). The reason
 * kind is recorded for diagnostics; a `completion`/normal close just empties
 * the slot. Absent/blank sessionId or no open turn is a no-op (same state).
 */
export function noteClosedTurn(state, opts) {
  var sid = opts && opts.sessionId
  if (!sid) return state
  var list = state.openTurns[sid]
  if (!list || !list.length) return state
  var next = { openTurns: Object.assign(Object.create(null), state.openTurns) }
  // Drop the oldest and keep any later residuals (DSH may start a fresh turn
  // that then also goes quiet; each is tracked). `opts.reasonKind` is carried
  // through the returned state purely for callers that want to log *how* the
  // retired residual finally resolved — it does not change the accounting.
  var rest = list.slice(1)
  if (rest.length) {
    next.openTurns[sid] = rest
  } else {
    delete next.openTurns[sid]
  }
  return next
}

/** Immutable array copy of the open turns currently recorded for sessionId
 *  (empty array when none). The returned records must never be mutated by the
 *  caller. */
export function openTurnsOf(state, sessionId) {
  if (!state || !state.openTurns || !sessionId) return []
  var list = state.openTurns[sessionId]
  return list ? list.slice() : []
}

/** True when `sessionId` has at least one open turn in the ledger. */
export function hasOpenTurn(state, sessionId) {
  return openTurnsOf(state, sessionId).length > 0
}

/** True when `sessionId` is holding an open turn whose `openedAt` falls WITHIN
 *  the last `cutoffMs` before `nowMs` — i.e. the turn opened recently enough to
 *  still count, and it is still open. A session with no open turn is never
 *  "open after" the cutoff. */
export function openTurnAfter(state, sessionId, cutoffMs, nowMs) {
  var turns = openTurnsOf(state, sessionId)
  if (!turns.length) return false
  var now = typeof nowMs === 'number' ? nowMs : Date.now()
  var cutoff = cutoffMs > 0 ? cutoffMs : 0
  for (var i = 0; i < turns.length; i++) {
    if (turns[i].openedAt >= now - cutoff) return true
  }
  return false
}

/** Age in ms of the OLDEST still-open turn for `sessionId`, or -1 when the
 *  session has no open turn. This is the figure the watchdog compares against
 *  the grace window: once the oldest residual passes grace+settle, the turn is
 *  "unsettled and stopped". */
export function openTurnAgeMs(state, sessionId, nowMs) {
  var turns = openTurnsOf(state, sessionId)
  if (!turns.length) return -1
  var now = typeof nowMs === 'number' ? nowMs : Date.now()
  var oldest = turns[0].openedAt
  return now - oldest
}

/** Drop every open-turn record for a session (used on genuine human input /
 *  manual reset — the tail is acknowledged so the watchdog stops flagging).
 *  Returns a new state; unknown/absent session is a no-op. */
export function clearOpenTurns(state, sessionId) {
  if (!sessionId || !state.openTurns[sessionId]) return state
  var next = { openTurns: Object.assign(Object.create(null), state.openTurns) }
  delete next.openTurns[sessionId]
  return next
}

/**
 * unsettledTurnsAt — sessions holding at least one open turn whose OLDEST
 * residual is at least `graceMs` old as of `nowMs`. Returns an array of
 * { sessionId, oldestOpenedAt, openCount, ageMs }. This is the set the UI
 * should warn about: they *look* unfinished (turn started, events seen) yet no
 * closing turn/end ever arrived within the grace window.
 */
export function unsettledTurnsAt(state, nowMs, graceMs) {
  var now = typeof nowMs === 'number' ? nowMs : Date.now()
  var grace = graceMs > 0 ? graceMs : 0
  var out = []
  var ids = state && state.openTurns ? Object.keys(state.openTurns) : []
  for (var i = 0; i < ids.length; i++) {
    var sid = ids[i]
    var turns = state.openTurns[sid]
    if (!turns || !turns.length) continue
    var age = now - turns[0].openedAt
    if (age >= grace) {
      out.push({
        sessionId: sid,
        oldestOpenedAt: turns[0].openedAt,
        openCount: turns.length,
        ageMs: age,
      })
    }
  }
  return out
}

/**
 * isUnsettledAndStopped — the single decision the watchdog is built to make.
 * Accepts either a ledger + session context, or a precomputed view:
 *
 *   isUnsettledAndStopped({ openTurns, sessionId, nowMs, graceMs })
 *     → true when `sessionId` has an open turn older than `graceMs`.
 *
 * The function is PURE (no side effects, no timers): deciding is only ever the
 * first half — acting on it (showing a notice) is the caller's job, and per
 * the module contract that notice never auto-continues the turn.
 */
export function isUnsettledAndStopped(cfg) {
  var graceMs = cfg && cfg.graceMs
  var nowMs = (cfg && cfg.nowMs) != null && typeof cfg.nowMs === 'number' ? cfg.nowMs : Date.now()
  var sessionId = cfg && cfg.sessionId
  if (!sessionId) return false
  var age = openTurnAgeMs(cfg ? cfg.openTurns : null, sessionId, nowMs)
  return age >= 0 && age >= (graceMs > 0 ? graceMs : 0)
}
