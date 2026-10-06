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
// Default export only (`export default Schema`); there is no named `Schema`.
import Schema from '@deepseek-ai/schemastery'

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

/** Resolved volatile config — each field is a live reference read with .get(). */
export interface CtxMonConfig {
  ctxApproxWindow: Volatile<number>
  ctxThresholdInfo: Volatile<number>
  ctxThresholdWarning: Volatile<number>
  ctxThresholdError: Volatile<number>
  ctxPollBase: Volatile<number>
  ctxPollMin: Volatile<number>
  modelContextWindows: Record<string, number>
  modelContextWindowSources: Record<string, string>
}

export const Config = Schema.object({
  ctxApproxWindow: Schema.number().default(DEFAULT_CTX_APPROX_WINDOW).volatile(),
  ctxThresholdInfo: Schema.number().default(DEFAULT_CTX_THRESHOLD_INFO).volatile(),
  ctxThresholdWarning: Schema.number().default(DEFAULT_CTX_THRESHOLD_WARNING).volatile(),
  ctxThresholdError: Schema.number().default(DEFAULT_CTX_THRESHOLD_ERROR).volatile(),
  ctxPollBase: Schema.number().default(DEFAULT_CTX_POLL_BASE).volatile(),
  ctxPollMin: Schema.number().default(DEFAULT_CTX_POLL_MIN).volatile(),
  // NOT volatile: user overrides and their provenance must survive restarts.
  // When volatile, the source map is lost on restart and request/context events
  // overwrite the user's manual setting (the priority guard depends on
  // modelContextWindowSources recording 'user-mapping', but it's gone after a
  // restart — so the guard passes and the adapter value clobbers the override).
  modelContextWindows: Schema.dict(Schema.number()).default({}),
  modelContextWindowSources: Schema.dict(Schema.string()).default({}),
})

// ── apply() ─────────────────────────────────────────────────────────────

export function apply(ctx: Context, config: CtxMonConfig) {
  // ── Settings namespace registration ──────────────────────────────────
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })
}
