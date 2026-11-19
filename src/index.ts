// dsh-flash-ctx-mon — HOST half of the context monitor provider.
//
// Migrated from dock-flash/src/index.ts:
// - Context config fields (original :110-127 interface, :192-199 defaults, :273-285 schema)
//
// Settings namespace changed from 'dock-flash' to 'dsh-flash-ctx-mon'.
//
// NOTE: Unlike dsh-flash-mem-mon, this plugin has NO host-side collector
// or HTTP route. The context monitor is entirely client-side: it consumes
// DSH session events via ctx.get('sessions') and remote.session.modelCatalog().
// This host half exists ONLY to hold the config namespace/schema.
//
// This half is ESM (`"type": "module"`, and DSH's own entry is ESM too), so
// `require` does not exist here — every host dependency is a static import
// declared in package.json.
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type { Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { writeFileSync, mkdirSync } from 'node:fs'

// ── Log-only LLM turn-ending judge (observational only) ────────────────
//
// This hook answers the user's question — "Can an LLM help decide whether a
// session/turn ended normally?" — in its WEAKEST sufficient form:
//
//   * it only *observes*; it never rewrites the inbox, never appends a
//     `session/event`, never changes the agent-loop, never intercepts.
//   * its LLM input is derived from the durable session log
//     (`agent.session.deriveMessages()` — the exact model-visible history),
//     satisfying "model-visible ⟺ recorded".
//
// A judgement only produces a log line. This is deliberately warn-only, as
// the official docs recommend for hand-back control (no double billing).

/** Structured judgement from a single auxiliary LLM call. */
export interface TurnEndingJudgement {
  /** Whether the turn appears to have ended in a normal, settled state. */
  endedNormally: boolean
  /** Human-readable reason from the model. */
  reason: string
  /** 0..1 self-reported confidence, when the model supplies one. */
  confidence?: number
  /** Raw text when the model output was not parseable JSON. */
  raw?: string
}

/** Minimal structural view of the optional `llm` host service (LlmRuntime).
 *  Field shapes are documented on subsystems/llm-streaming.md. */
interface LlmService {
  prepareCall(
    config: { provider: string; model: string },
    signal?: AbortSignal,
  ): Promise<{ stream(options: unknown): AsyncIterable<unknown> }>
}

interface AssembledChunk {
  type?: string
  text?: string
  finish?: { reason?: string }
}

/** Fold a judge's StreamChunk stream into plain text (minimal assembler).
 *  Auxiliary judge output is tiny, so we only need [text-delta] deltas and a
 *  stop signal — no tool-call/reasoning assembly is required. */
function assembleJudgeText(stream: AsyncIterable<unknown>): Promise<string> {
  return (async () => {
    let out = ''
    for await (const chunk of stream as AsyncIterable<AssembledChunk>) {
      if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        out += chunk.text
      }
    }
    return out.trim()
  })()
}

/** Extract a compact prompt from a projected Message[] (last user ask + last
 *  assistant reply). We never mutate the projection — read-only. */
function lastExchange(messages: ReadonlyArray<{ role?: string; content?: unknown }>): string {
  const snippets: string[] = []
  for (let i = messages.length - 1; i >= 0 && snippets.length < 2; i -= 1) {
    const m = messages[i]
    if (m.role !== 'user' && m.role !== 'assistant') continue
    const c = m.content
    let text = ''
    if (typeof c === 'string') text = c
    else if (Array.isArray(c)) {
      text = c
        .map((b: { type?: string; text?: string }) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : ''))
        .join(' ')
    }
    if (text.trim()) snippets.unshift(`${m.role}: ${text.slice(0, 600)}`)
  }
  return snippets.join('\n')
}

/** Run one auxiliary LLM call that judges whether the closing turn ended
 *  normally. Pure input (durable projection), side-effect-free, fail-soft. */
export async function runEndingJudgement(params: {
  session: { deriveMessages(): ReadonlyArray<{ role?: string; content?: unknown }> }
  llm: LlmService
  provider: string
  model: string
  signal?: AbortSignal
}): Promise<TurnEndingJudgement> {
  const { session, llm, provider, model, signal } = params
  const messages = session.deriveMessages()
  const context = lastExchange(messages)

  const system =
    'You are a session-health observer. Given the tail of a conversation, decide ' +
    'whether the turn appears to have ended NORMALLY (a settled, coherent response ' +
    'that answered/advanced the user request) vs ABRUPTLY (cut off, an unfinished ' +
    'tool chain, an error, or a stall the model should have continued). ' +
    'Reply with JSON only: {"endedNormally": boolean, "reason": string, "confidence": number}.'

  const prepared = await llm.prepareCall(
    { provider, model },
    signal,
  )
  const stream = prepared.stream({
    provider,
    model,
    system,
    messages: [
      { role: 'user', content: `End of the conversation tail:\n${context || '(empty)'}` },
    ],
    temperature: 0,
    maxTokens: 400,
  })
  const text = await assembleJudgeText(stream)
  if (!text) return { endedNormally: false, reason: 'judge returned no output', raw: text }

  try {
    const parsed = JSON.parse(text) as Partial<TurnEndingJudgement>
    return {
      endedNormally: parsed.endedNormally === true,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '(no reason)',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
      raw: text,
    }
  } catch {
    return { endedNormally: true, reason: 'judge output not JSON; kept as observation', raw: text }
  }
}

export const name = 'dsh-flash-ctx-mon'

// No host-side service dependencies; all services are injected lazily.
export const inject: string[] = []

// ── Context alert thresholds (% of estimated window) and poll intervals ──
// Memory/GC thresholds extracted to dsh-flash-mem-mon.

/** Context window approximation (tokens). Used as default when the model
 *  is not in the built-in or user-configured window table. */
const DEFAULT_CTX_APPROX_WINDOW = 128000
/** Context alert thresholds (% of estimated window). */
const DEFAULT_CTX_THRESHOLD_INFO = 70
const DEFAULT_CTX_THRESHOLD_WARNING = 85
const DEFAULT_CTX_THRESHOLD_ERROR = 95
/** Context polling: base interval and minimum (ms). */
const DEFAULT_CTX_POLL_BASE = 20000
const DEFAULT_CTX_POLL_MIN = 2000

// ── Auto-continue (context-limit self-rescue) tunables ────────────────
// Auto-continue is invoked only for the CURRENT session, never a background one.
/** Grace period between a trigger and the first auto-continue (ms). */
const DEFAULT_AUTO_RETRY_GRACE_MS = 5000
/** Minimum interval between two auto-continues within the same session (ms). */
const DEFAULT_AUTO_RETRY_COOLDOWN_MS = 20000
/** Max consecutive auto-continues within one session before handing back to the user. */
const DEFAULT_AUTO_RETRY_MAX_CONSECUTIVE = 4
/** Exponential backoff cap for repeated auto-continues (ms). */
const DEFAULT_AUTO_RETRY_MAX_BACKOFF_MS = 300000
/** The exact prompt text sent to continue a stalled session (must match model output). */
const DEFAULT_AUTO_RETRY_CONTINUE_TEXT = '继续'
/** Window (ms) in which our own continued echo is recognised and swallowed. */
const DEFAULT_AUTO_RETRY_ECHO_WINDOW_MS = 30000

/** Resolved volatile config — each field is a live reference read with .get(). */
export interface CtxMonConfig {
  ctxApproxWindow: Volatile<number>
  ctxThresholdInfo: Volatile<number>
  ctxThresholdWarning: Volatile<number>
  ctxThresholdError: Volatile<number>
  ctxPollBase: Volatile<number>
  ctxPollMin: Volatile<number>
  // Auto-continue tunables. Volatile so users can edit through settings, but
  // read live through .get() on the client side.
  autoRetryGraceMs: Volatile<number>
  autoRetryCooldownMs: Volatile<number>
  autoRetryMaxConsecutive: Volatile<number>
  autoRetryMaxBackoffMs: Volatile<number>
  autoRetryContinueText: Volatile<string>
  autoRetryEchoWindowMs: Volatile<number>
  /** Optional route override for the log-only LLM judge (empty = use agent's own). */
  judgeProvider?: string
  judgeModel?: string
}

export const Config = Schema.object({
  ctxApproxWindow: Schema.number().default(DEFAULT_CTX_APPROX_WINDOW).volatile(),
  ctxThresholdInfo: Schema.number().default(DEFAULT_CTX_THRESHOLD_INFO).volatile(),
  ctxThresholdWarning: Schema.number().default(DEFAULT_CTX_THRESHOLD_WARNING).volatile(),
  ctxThresholdError: Schema.number().default(DEFAULT_CTX_THRESHOLD_ERROR).volatile(),
  ctxPollBase: Schema.number().default(DEFAULT_CTX_POLL_BASE).volatile(),
  ctxPollMin: Schema.number().default(DEFAULT_CTX_POLL_MIN).volatile(),
  // Auto-continue tunables — live-read via .get() on the client side.
  autoRetryGraceMs: Schema.number().default(DEFAULT_AUTO_RETRY_GRACE_MS).volatile(),
  autoRetryCooldownMs: Schema.number().default(DEFAULT_AUTO_RETRY_COOLDOWN_MS).volatile(),
  autoRetryMaxConsecutive: Schema.number().default(DEFAULT_AUTO_RETRY_MAX_CONSECUTIVE).volatile(),
  autoRetryMaxBackoffMs: Schema.number().default(DEFAULT_AUTO_RETRY_MAX_BACKOFF_MS).volatile(),
  autoRetryContinueText: Schema.string().default(DEFAULT_AUTO_RETRY_CONTINUE_TEXT).volatile(),
  autoRetryEchoWindowMs: Schema.number().default(DEFAULT_AUTO_RETRY_ECHO_WINDOW_MS).volatile(),
  // Optional route override for the log-only LLM turn-ending judge. Empty
  // string = unset; we then fall back to the closing agent's own provider/model.
  judgeProvider: Schema.string().default(''),
  judgeModel: Schema.string().default(''),
})

// ── apply() ─────────────────────────────────────────────────────────────

export function apply(ctx: Context, config: CtxMonConfig) {
  // ── Log-only LLM turn-ending judge — agent/turn-stopping ────────────
  // Observational only: logs whether a closing turn looks normally-ended.
  // Never blocks turn closure (listener returns void; judgement runs detached),
  // never touches inbox, never appends a session/event, never edits the loop.
  // Fail-safe: any absence/error -> warn log, never throw, never intercept.
  // `agent/turn-stopping` is a DSH runtime event not typed in this package's
  // Cordis `Events`; register through the untyped overload for observation.
  ;(ctx as unknown as {
    on(event: string, listener: (payload: { agent: any; turn: number; signal?: AbortSignal }) => void): unknown
  }).on('agent/turn-stopping', (payload) => {
    try {
      const { agent, turn, signal } = payload
      const llm = (ctx as any).get?.('llm') as LlmService | undefined
      if (!llm) {
        ctx.logger?.info?.(
          '[ctx-mon] LLM judge: "llm" service unavailable — no host-side route; skipping judgement',
        )
        return
      }
      const session = agent?.session
      if (!session || typeof session.deriveMessages !== 'function') {
        ctx.logger?.info?.('[ctx-mon] LLM judge: agent has no session projection; skipping judgement')
        return
      }
      const provider = config?.judgeProvider || agent?.options?.provider
      const model = config?.judgeModel || agent?.options?.model
      if (!provider || !model) {
        ctx.logger?.info?.('[ctx-mon] LLM judge: no provider/model route known; skipping judgement')
        return
      }
      // Fire-and-forget: keep this serial listener async-non-blocking so the
      // turn can close immediately; the judgement and its log land when ready.
      void runEndingJudgement({ session, llm, provider, model, signal })
        .then((j) => {
          ctx.logger?.info?.(
            '[ctx-mon] LLM turn-ending judgement',
            JSON.stringify({ turn, endedNormally: j.endedNormally, reason: j.reason, confidence: j.confidence }),
          )
        })
        .catch((err: unknown) => {
          ctx.logger?.warn?.('[ctx-mon] LLM turn-ending judgement failed:', (err as Error)?.message ?? String(err))
        })
    } catch (err) {
      ctx.logger?.warn?.('[ctx-mon] agent/turn-stopping listener error:', (err as Error)?.message ?? String(err))
    }
  })

  // ── Settings namespace registration ──────────────────────────────────
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => {
      // Runtime diagnostic for the "Configuration for \"dsh-flash-ctx-mon\"
      // is overridden by a home patch or command-line overlay" rejection.
      // The host's config-editor refuses an edit when its recomposed profile
      // patches for this id differ from the candidate config. This prints the
      // SAME composition the guard sees, so a rejected edit can be traced to
      // its exact source (bundle layer, profile patch, home patch, overlay).
      try {
        const pc = settingsCtx.get('profileContext') as
          | { patchPath?: string; home?: string; dir?: string; overlays?: unknown[]; startedBundles?: readonly string[] }
          | undefined
        const editor = settingsCtx.get<any>('configEditor')
        const watchContext = editor?.['ownerContext']?.profileContext as
          | { patchPath?: string; dir?: string; installAnchor?: string; overlays?: unknown[] }
          | undefined
        const CE_ID = 'dsh-flash-ctx-mon'
        let entryInfo: unknown
        try {
          const cfg = editor?.configuration?.()
          const row = (cfg as Array<{ entry?: { options?: { id?: string } }; inherited?: unknown; override?: unknown }> | undefined)
            ?.find?.((r) => r.entry?.options?.id === CE_ID)
          entryInfo = row
            ? { inheritedKeys: Object.keys((row.inherited ?? {}) as object), override: row.override }
            : { found: false, ids: (cfg as Array<{ entry?: { options?: { id?: string } } }> | undefined)?.map((r) => r.entry?.options?.id) }
        } catch (e2) {
          entryInfo = { configurationErr: e2 && (e2 as Error).message }
        }
        console.log(
          '[dsh-flash-ctx-mon] host profileContext:',
          JSON.stringify(
            {
              patchPath: pc?.patchPath ?? watchContext?.patchPath,
              profileDir: pc?.dir ?? watchContext?.dir,
              home: pc?.home,
              startedBundles: pc?.startedBundles,
              overlays: (pc ?? watchContext)?.overlays,
              hasEditor: editor !== undefined,
              entryId: editor?.entries?.()?.find?.((en: any) => en.options?.id === CE_ID)?.options?.id,
              entryInfo,
            },
            null, 2,
          ),
        )
        // ALSO persist to a file in the plugin source dir so the agent can read it
        // without the user's host console (the desktop host stdout is not on disk).
        try {
          try { mkdirSync('C:/codes/ai-test/dsh-flash-ctx-mon/.diag', { recursive: true }) } catch { /* noop */ }
          writeFileSync(
            'C:/codes/ai-test/dsh-flash-ctx-mon/.diag/host-profileContext.json',
            JSON.stringify(
              {
                ts: new Date().toISOString(),
                pid: process.pid,
                patchPath: pc?.patchPath ?? watchContext?.patchPath,
                profileDir: pc?.dir ?? watchContext?.dir,
                home: pc?.home,
                startedBundles: pc?.startedBundles,
                overlays: (pc ?? watchContext)?.overlays,
                hasEditor: editor !== undefined,
                entryId: editor?.entries?.()?.find?.((en: any) => en.options?.id === CE_ID)?.options?.id,
                entryInfo,
              },
              null, 2,
            ),
          )
        } catch (e3) {
          console.warn('[dsh-flash-ctx-mon] diag-file error:', e3 && (e3 as Error).message)
        }
      } catch (e) {
        console.warn('[dsh-flash-ctx-mon] diagnostic error:', e && (e as Error).message)
      }
      return settingsCtx.settings.configure({ auto: false }, ctx.fiber)
    })
  })
}
