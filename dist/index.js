// Default export only (`export default Schema`); there is no named `Schema`.
import Schema from '@deepseek-ai/schemastery';
export const name = 'dsh-flash-ctx-mon';
// No host-side service dependencies; all services are injected lazily.
export const inject = [];
// ── Context alert thresholds (% of estimated window) and poll intervals ──
// Memory/GC thresholds extracted to dsh-flash-mem-mon.
/** Context window approximation (tokens). Used as default when the model
 *  is not in the built-in or user-configured window table. */
const DEFAULT_CTX_APPROX_WINDOW = 128000;
/** Context alert thresholds (% of estimated window). */
const DEFAULT_CTX_THRESHOLD_INFO = 70;
const DEFAULT_CTX_THRESHOLD_WARNING = 85;
const DEFAULT_CTX_THRESHOLD_ERROR = 95;
/** Context polling: base interval and minimum (ms). */
const DEFAULT_CTX_POLL_BASE = 20000;
const DEFAULT_CTX_POLL_MIN = 2000;
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
});
// ── apply() ─────────────────────────────────────────────────────────────
export function apply(ctx, config) {
    // ── Settings namespace registration ──────────────────────────────────
    ctx.inject(['settings'], (settingsCtx) => {
        settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber));
    });
}
