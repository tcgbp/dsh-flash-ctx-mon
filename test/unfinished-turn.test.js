// test/unfinished-turn.test.js — unit tests for the pure open-turn ledger &
// watchdog primitives (form ① detection, docs/detecting-unfinished-session.zh-CN.md).
import { describe, it, expect } from 'vitest'
import {
  makeLedger,
  noteOpenTurn,
  noteClosedTurn,
  openTurnsOf,
  hasOpenTurn,
  openTurnAfter,
  openTurnAgeMs,
  clearOpenTurns,
  unsettledTurnsAt,
  isUnsettledAndStopped,
} from '../src-client/unfinished-turn.js'

describe('makeLedger', () => {
  it('starts empty with a per-session null-prototype map', () => {
    var s = makeLedger()
    expect(s.openTurns).toBeTruthy()
    expect(Object.keys(s.openTurns)).toHaveLength(0)
  })
})

describe('noteOpenTurn / noteClosedTurn', () => {
  it('records an open turn and returns a new state (no mutation)', () => {
    var s0 = makeLedger()
    var s1 = noteOpenTurn(s0, { sessionId: 'a', openedAt: 1000 })
    // s0 untouched
    expect(openTurnsOf(s0, 'a')).toHaveLength(0)
    // s1 has the open turn
    var turns = openTurnsOf(s1, 'a')
    expect(turns).toHaveLength(1)
    expect(turns[0].openedAt).toBe(1000)
    expect(hasOpenTurn(s1, 'a')).toBe(true)
  })

  it('ignores a blank/absent sessionId without changing state', () => {
    var s = makeLedger()
    expect(noteOpenTurn(s, {})).toBe(s)
    expect(noteOpenTurn(s, { sessionId: '' })).toBe(s)
    expect(openTurnsOf(s, 'x')).toHaveLength(0)
  })

  it('tracks multiple open turns in FIFO order and closes the OLDEST', () => {
    var s = makeLedger()
    s = noteOpenTurn(s, { sessionId: 'a', openedAt: 1000 })
    s = noteOpenTurn(s, { sessionId: 'a', openedAt: 2000 })
    expect(openTurnsOf(s, 'a')).toHaveLength(2)
    // close → oldest (1000) goes away, the 2000 residual remains
    s = noteClosedTurn(s, { sessionId: 'a', closedAt: 2500, reasonKind: 'interrupted' })
    var turns = openTurnsOf(s, 'a')
    expect(turns).toHaveLength(1)
    expect(turns[0].openedAt).toBe(2000)
    // closing the last one empties the slot
    s = noteClosedTurn(s, { sessionId: 'a', closedAt: 2600 })
    expect(openTurnsOf(s, 'a')).toHaveLength(0)
    expect(hasOpenTurn(s, 'a')).toBe(false)
  })

  it('noteClosedTurn is a no-op without an open turn or a blank session', () => {
    var s = makeLedger()
    expect(noteClosedTurn(s, { sessionId: 'a' })).toBe(s)
    expect(noteClosedTurn(s, {})).toBe(s)
    s = noteOpenTurn(s, { sessionId: 'b', openedAt: 100 })
    // closing a DIFFERENT session leaves b unchanged
    var s2 = noteClosedTurn(s, { sessionId: 'a' })
    expect(openTurnsOf(s2, 'b')).toHaveLength(1)
  })

  it('isolates accounting per session (switching never destroys another session)', () => {
    var s = makeLedger()
    s = noteOpenTurn(s, { sessionId: 'a', openedAt: 100 })
    s = noteOpenTurn(s, { sessionId: 'b', openedAt: 200 })
    // closing a leaves b intact
    s = noteClosedTurn(s, { sessionId: 'a' })
    expect(hasOpenTurn(s, 'a')).toBe(false)
    expect(openTurnsOf(s, 'b')).toHaveLength(1)
  })
})

describe('openTurnAfter', () => {
  it('true only when a session has an open turn opened within the cutoff window', () => {
    var s = makeLedger()
    s = noteOpenTurn(s, { sessionId: 'a', openedAt: 1000 })
    // at now=2000 with cutoff 1500 → opened 1000 is within [500,2000] → true
    expect(openTurnAfter(s, 'a', 1500, 2000)).toBe(true)
    // at now=3000 cutoff 1500 → opened 1000 older than window → false
    expect(openTurnAfter(s, 'a', 1500, 3000)).toBe(false)
  })

  it('never true for a session with no open turn', () => {
    var s = makeLedger()
    expect(openTurnAfter(s, 'a', 1500, 2000)).toBe(false)
  })
})

describe('openTurnAgeMs', () => {
  it('is the age of the OLDEST open turn, or -1 when none', () => {
    var s = makeLedger()
    expect(openTurnAgeMs(s, 'a', 5000)).toBe(-1)
    s = noteOpenTurn(s, { sessionId: 'a', openedAt: 3000 })
    s = noteOpenTurn(s, { sessionId: 'a', openedAt: 4000 })
    expect(openTurnAgeMs(s, 'a', 5000)).toBe(2000)
  })
})

describe('clearOpenTurns', () => {
  it('drops a session slot and leaves others alone', () => {
    var s = makeLedger()
    s = noteOpenTurn(s, { sessionId: 'a', openedAt: 100 })
    s = noteOpenTurn(s, { sessionId: 'b', openedAt: 200 })
    var s2 = clearOpenTurns(s, 'a')
    expect(hasOpenTurn(s2, 'a')).toBe(false)
    expect(openTurnsOf(s2, 'b')).toHaveLength(1)
    // s itself is untouched
    expect(hasOpenTurn(s, 'a')).toBe(true)
  })

  it('is a no-op for an unknown session', () => {
    var s = makeLedger()
    expect(clearOpenTurns(s, 'nope')).toBe(s)
  })
})

describe('unsettledTurnsAt', () => {
  it('reports only sessions whose oldest residual is at least the grace', () => {
    var s = makeLedger()
    s = noteOpenTurn(s, { sessionId: 'a', openedAt: 1000 }) // age 3000 at now 4000, grace 2000 → settled-ish
    s = noteOpenTurn(s, { sessionId: 'b', openedAt: 1000 }) // same age
    s = noteOpenTurn(s, { sessionId: 'a', openedAt: 2500 }) // newest, but a's oldest governs
    var list = unsettledTurnsAt(s, 4000, 2000)
    expect(list).toHaveLength(2)
    var a = list.find((x) => x.sessionId === 'a')
    expect(a.oldestOpenedAt).toBe(1000)
    expect(a.openCount).toBe(2)
    expect(a.ageMs).toBe(3000)
  })

  it('grace 0 flags any open turn; negative grace behaves like 0', () => {
    var s = makeLedger()
    s = noteOpenTurn(s, { sessionId: 'a', openedAt: 1000 })
    expect(unsettledTurnsAt(s, 1001, 0)).toHaveLength(1)
    expect(unsettledTurnsAt(s, 1001, -5)).toHaveLength(1)
    expect(unsettledTurnsAt(s, 1100, 200)).toHaveLength(0)
  })
})

describe('isUnsettledAndStopped', () => {
  it('true when the session\'s oldest open turn is past the grace', () => {
    var s = makeLedger()
    s = noteOpenTurn(s, { sessionId: 'a', openedAt: 1000 })
    expect(isUnsettledAndStopped({ openTurns: s, sessionId: 'a', nowMs: 4000, graceMs: 2000 })).toBe(true)
    expect(isUnsettledAndStopped({ openTurns: s, sessionId: 'a', nowMs: 2500, graceMs: 2000 })).toBe(false)
  })

  it('never true without a sessionId or without an open turn', () => {
    var s = makeLedger()
    expect(isUnsettledAndStopped({ openTurns: s, sessionId: null })).toBe(false)
    expect(isUnsettledAndStopped({ openTurns: s, sessionId: 'a', nowMs: 9000, graceMs: 0 })).toBe(false)
  })

  it('never auto-continues: it only returns a boolean decision', () => {
    var s = makeLedger()
    s = noteOpenTurn(s, { sessionId: 'a', openedAt: 1000 })
    var before = openTurnsOf(s, 'a').length
    var decision = isUnsettledAndStopped({ openTurns: s, sessionId: 'a', nowMs: 9000, graceMs: 1000 })
    expect(decision).toBe(true)
    // The ledger is untouched by merely asking.
    expect(openTurnsOf(s, 'a').length).toBe(before)
  })
})
