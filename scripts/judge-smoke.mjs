// Deterministic smoke test for the log-only LLM turn-ending judge.
// Imports the COMPILED host half (dist/index.js) and exercises
// runEndingJudgement with mock llm + mock session projection, so the
// verify step needs no network and no real LLM provider.
//
//   node scripts/judge-smoke.mjs
//
// Exit code 0 => all assertions passed; non-zero with a message otherwise.

import assert from 'node:assert/strict'
import { runEndingJudgement } from '../dist/index.js'

// A mock llm that emits text-delta chunks then a stop, folding into a JSON
// judgement. `chunk.type === 'text-delta'` and text on `chunk.text` is exactly
// the documented StreamChunk shape we must assemble.
function mockLlm(finalText, options = {}) {
  return {
    async prepareCall(config, signal) {
      // Sanity: the judge must route the configured provider/model.
      assert.equal(config.provider, 'mock-provider')
      assert.equal(config.model, 'mock-model')
      return {
        stream(opts) {
          assert.equal(opts.temperature, 0)
          assert.equal(opts.maxTokens, 400)
          assert.ok(Array.isArray(opts.messages) && opts.messages.length === 1)
          return {
            async *[Symbol.asyncIterator]() {
              // Emit as a StreamChunk (the shape PreparedLlmCall.stream yields):
              // text-delta is a TOP-LEVEL variant { type, index, text }.
              yield { type: 'text-delta', index: 0, text: finalText }
              if (options.extra) yield options.extra
            },
          }
        },
      }
    },
  }
}

// A mock session projection exposing deriveMessages() (read-only).
function mockSession(messages) {
  return {
    deriveMessages() {
      return messages
    },
  }
}

function baseMessages() {
  return [
    { role: 'system', content: 'you are a helpful assistant' },
    { role: 'user', content: 'Please write a short poem.' },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Here is a short poem:\n\nRoses are red.' },
      ],
    },
  ]
}

async function main() {
  // 1) Happy path: judge returns structured JSON.
  {
    const j = await runEndingJudgement({
      session: mockSession(baseMessages()),
      llm: mockLlm(JSON.stringify({ endedNormally: true, reason: 'coherent reply given', confidence: 0.9 })),
      provider: 'mock-provider',
      model: 'mock-model',
    })
    assert.equal(j.endedNormally, true)
    assert.equal(j.reason, 'coherent reply given')
    assert.equal(j.confidence, 0.9)
    assert.ok(j.raw?.includes('endedNormally'))
    console.log('ok  1  happy path JSON judgement')
  }

  // 2) Judgement says the turn was NOT normal (tool chain / cut off).
  {
    const j = await runEndingJudgement({
      session: mockSession(baseMessages()),
      llm: mockLlm(JSON.stringify({ endedNormally: false, reason: 'response cut off mid-tool', confidence: 0.7 })),
      provider: 'mock-provider',
      model: 'mock-model',
    })
    assert.equal(j.endedNormally, false)
    assert.equal(j.reason, 'response cut off mid-tool')
    console.log('ok  2  abnormal-turn judgement')
  }

  // 3) Fail-soft: non-JSON model output must NOT throw and must default to
  //    endedNormally:true (never mis-report an interruption from a parse error).
  {
    const j = await runEndingJudgement({
      session: mockSession(baseMessages()),
      llm: mockLlm('Sure, here is a nice poem for you...'),
      provider: 'mock-provider',
      model: 'mock-model',
    })
    assert.equal(j.endedNormally, true)
    assert.equal(j.reason, 'judge output not JSON; kept as observation')
    assert.equal(j.raw, 'Sure, here is a nice poem for you...')
    console.log('ok  3  fail-soft on non-JSON output')
  }

  // 4) Empty model output is reported as an observation, not a crash.
  {
    const j = await runEndingJudgement({
      session: mockSession(baseMessages()),
      llm: mockLlm('   '),
      provider: 'mock-provider',
      model: 'mock-model',
    })
    assert.equal(j.endedNormally, false)
    assert.ok(j.raw === '   ' || j.raw === '')
    console.log('ok  4  empty output handled')
  }

  // ────────────────────────────────────────────────────────────────────────
  // Log-wiring assertions. These replicate the EXACT log callbacks the
  // `agent/turn-stopping` listener registers in src/index.ts (see the
  // `.then(...)` / `.catch(...)` on `runEndingJudgement`), against a mock
  // logger, to prove the emitted log text carries the documented fields.
  // This exercises no new runtime behaviour — only what apply() already does.
  // ────────────────────────────────────────────────────────────────────────

  function mockLogger() {
    const calls = { info: [], warn: [] }
    return {
      calls,
      logger: {
        info: (...a) => calls.info.push(a),
        warn: (...a) => calls.warn.push(a),
      },
    }
  }

  // Field-by-field replica of the listener's success log callback.
  function successLog(ctxLogger, turn, j) {
    ctxLogger?.info?.(
      '[ctx-mon] LLM turn-ending judgement',
      JSON.stringify({ turn, endedNormally: j.endedNormally, reason: j.reason, confidence: j.confidence }),
    )
  }

  function failureLog(ctxLogger, err) {
    ctxLogger?.warn?.('[ctx-mon] LLM turn-ending judgement failed:', err instanceof Error ? err.message : String(err))
  }

  // Replica of the listener's fire-and-forget spine (src/index.ts): the
  // serial listener returns void immediately and the judgement + its log land
  // asynchronously. Exactly mirrors apply()'s `void runEndingJudgement(...)
  // .then(...).catch(...)`.
  function emitJudgementLog(ctxLogger, p, turn) {
    void p.then((j) => successLog(ctxLogger, turn, j)).catch((err) => failureLog(ctxLogger, err))
  }

  // 5) Success: one info call, label exact, payload JSON-parses back correct.
  {
    const { calls, logger } = mockLogger()
    const p = runEndingJudgement({
      session: mockSession(baseMessages()),
      llm: mockLlm(JSON.stringify({ endedNormally: false, reason: 'response cut off mid-tool', confidence: 0.7 })),
      provider: 'mock-provider',
      model: 'mock-model',
    })
    emitJudgementLog(logger, p, 7) // turn = 7; void, non-blocking
    await p // wait for judgement to settle so the log has fired
    assert.equal(calls.info.length, 1, 'exactly one info call')
    assert.equal(calls.warn.length, 0, 'no warn call on success')
    assert.equal(calls.info[0][0], '[ctx-mon] LLM turn-ending judgement')
    const payload = JSON.parse(calls.info[0][1])
    assert.equal(payload.turn, 7)
    assert.equal(payload.endedNormally, false)
    assert.equal(payload.reason, 'response cut off mid-tool')
    assert.equal(payload.confidence, 0.7)
    console.log('ok  5  success log carries label + structured judgement')
  }

  // 6) Failure of the auxiliary call: listener never throws and lands on the
  //    documented warn branch (the fail-soft path).
  {
    const { calls, logger } = mockLogger()
    const failingLlm = {
      async prepareCall() {
        throw new Error('provider unreachable')
      },
    }
    const p = runEndingJudgement({
      session: mockSession(baseMessages()),
      llm: failingLlm,
      provider: 'mock-provider',
      model: 'mock-model',
    })
    // The fire-and-forget spine must NOT reject the caller: the .catch() wrap
    // converts the rejection into the warn log. Assert that here.
    await assert.doesNotReject(async () => {
      await emitJudgementLog(logger, p, 7)
      // give the detached catch() a tick to run
      await new Promise((r) => setTimeout(r, 0))
    })
    assert.equal(calls.info.length, 0, 'no success log on failure')
    assert.equal(calls.warn.length, 1, 'exactly one warn log on failure')
    assert.equal(calls.warn[0][0], '[ctx-mon] LLM turn-ending judgement failed:')
    assert.match(calls.warn[0][1], /provider unreachable/)
    console.log('ok  6  failure goes to warn branch, never blocks')
  }

  console.log('ALL JUDGE SMOKE CHECKS PASSED')
}

main().catch((err) => {
  console.error('JUDGE SMOKE FAILED:', err)
  process.exit(1)
})
