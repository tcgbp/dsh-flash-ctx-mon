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
    // These MUST be volatile, even though they are durable user data rather than
    // live scalars. The settings service only accepts edits to fields under a
    // volatile node — `settings.write()` rejects any patched path that is not:
    //
    //   throw new Error(`Config field "${path.join('.')}" is not volatile`)
    //
    // Both fields used to be non-volatile, so every model-window mapping the
    // panel wrote was rejected by the host, rolled back by the client, and lost —
    // which is why a mapped model kept falling back to `ctxApproxWindow`.
    // Volatile does NOT mean transient here: the write lands in the profile
    // patch like every other edited field (the patch already carries the
    // volatile `ctxApproxWindow`), so the mapping and its provenance survive a
    // restart, which is what the priority guard in the client needs.
    modelContextWindows: Schema.dict(Schema.number()).default({}).volatile(),
    modelContextWindowSources: Schema.dict(Schema.string()).default({}).volatile(),
});
// ── apply() ─────────────────────────────────────────────────────────────
export function apply(ctx, config) {
    // ── Settings namespace registration ──────────────────────────────────
    ctx.inject(['settings'], (settingsCtx) => {
        settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber));
    });
}
