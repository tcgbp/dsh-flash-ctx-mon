import Schema from '@deepseek-ai/schemastery';
import { writeFileSync, mkdirSync } from 'node:fs';
/** Fold a judge's StreamChunk stream into plain text (minimal assembler).
 *  Auxiliary judge output is tiny, so we only need [text-delta] deltas and a
 *  stop signal — no tool-call/reasoning assembly is required. */
function assembleJudgeText(stream) {
    return (async () => {
        let out = '';
        for await (const chunk of stream) {
            if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') {
                out += chunk.text;
            }
        }
        return out.trim();
    })();
}
/** Extract a compact prompt from a projected Message[] (last user ask + last
 *  assistant reply). We never mutate the projection — read-only. */
function lastExchange(messages) {
    const snippets = [];
    for (let i = messages.length - 1; i >= 0 && snippets.length < 2; i -= 1) {
        const m = messages[i];
        if (m.role !== 'user' && m.role !== 'assistant')
            continue;
        const c = m.content;
        let text = '';
        if (typeof c === 'string')
            text = c;
        else if (Array.isArray(c)) {
            text = c
                .map((b) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : ''))
                .join(' ');
        }
        if (text.trim())
            snippets.unshift(`${m.role}: ${text.slice(0, 600)}`);
    }
    return snippets.join('\n');
}
/** Run one auxiliary LLM call that judges whether the closing turn ended
 *  normally. Pure input (durable projection), side-effect-free, fail-soft. */
export async function runEndingJudgement(params) {
    const { session, llm, provider, model, signal } = params;
    const messages = session.deriveMessages();
    const context = lastExchange(messages);
    const system = 'You are a session-health observer. Given the tail of a conversation, decide ' +
        'whether the turn appears to have ended NORMALLY (a settled, coherent response ' +
        'that answered/advanced the user request) vs ABRUPTLY (cut off, an unfinished ' +
        'tool chain, an error, or a stall the model should have continued). ' +
        'Reply with JSON only: {"endedNormally": boolean, "reason": string, "confidence": number}.';
    const prepared = await llm.prepareCall({ provider, model }, signal);
    const stream = prepared.stream({
        provider,
        model,
        system,
        messages: [
            { role: 'user', content: `End of the conversation tail:\n${context || '(empty)'}` },
        ],
        temperature: 0,
        maxTokens: 400,
    });
    const text = await assembleJudgeText(stream);
    if (!text)
        return { endedNormally: false, reason: 'judge returned no output', raw: text };
    try {
        const parsed = JSON.parse(text);
        return {
            endedNormally: parsed.endedNormally === true,
            reason: typeof parsed.reason === 'string' ? parsed.reason : '(no reason)',
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
            raw: text,
        };
    }
    catch {
        return { endedNormally: true, reason: 'judge output not JSON; kept as observation', raw: text };
    }
}
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
// ── Auto-continue (context-limit self-rescue) tunables ────────────────
// Auto-continue is invoked only for the CURRENT session, never a background one.
/** Grace period between a trigger and the first auto-continue (ms). */
const DEFAULT_AUTO_RETRY_GRACE_MS = 5000;
/** Minimum interval between two auto-continues within the same session (ms). */
const DEFAULT_AUTO_RETRY_COOLDOWN_MS = 20000;
/** Max consecutive auto-continues within one session before handing back to the user. */
const DEFAULT_AUTO_RETRY_MAX_CONSECUTIVE = 4;
/** Exponential backoff cap for repeated auto-continues (ms). */
const DEFAULT_AUTO_RETRY_MAX_BACKOFF_MS = 300000;
/** The exact prompt text sent to continue a stalled session (must match model output). */
const DEFAULT_AUTO_RETRY_CONTINUE_TEXT = '继续';
/** Window (ms) in which our own continued echo is recognised and swallowed. */
const DEFAULT_AUTO_RETRY_ECHO_WINDOW_MS = 30000;
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
});
// ── apply() ─────────────────────────────────────────────────────────────
export function apply(ctx, config) {
    // ── Log-only LLM turn-ending judge — agent/turn-stopping ────────────
    // Observational only: logs whether a closing turn looks normally-ended.
    // Never blocks turn closure (listener returns void; judgement runs detached),
    // never touches inbox, never appends a session/event, never edits the loop.
    // Fail-safe: any absence/error -> warn log, never throw, never intercept.
    // `agent/turn-stopping` is a DSH runtime event not typed in this package's
    // Cordis `Events`; register through the untyped overload for observation.
    ;
    ctx.on('agent/turn-stopping', (payload) => {
        try {
            const { agent, turn, signal } = payload;
            const llm = ctx.get?.('llm');
            if (!llm) {
                ctx.logger?.info?.('[ctx-mon] LLM judge: "llm" service unavailable — no host-side route; skipping judgement');
                return;
            }
            const session = agent?.session;
            if (!session || typeof session.deriveMessages !== 'function') {
                ctx.logger?.info?.('[ctx-mon] LLM judge: agent has no session projection; skipping judgement');
                return;
            }
            const provider = config?.judgeProvider || agent?.options?.provider;
            const model = config?.judgeModel || agent?.options?.model;
            if (!provider || !model) {
                ctx.logger?.info?.('[ctx-mon] LLM judge: no provider/model route known; skipping judgement');
                return;
            }
            // Fire-and-forget: keep this serial listener async-non-blocking so the
            // turn can close immediately; the judgement and its log land when ready.
            void runEndingJudgement({ session, llm, provider, model, signal })
                .then((j) => {
                ctx.logger?.info?.('[ctx-mon] LLM turn-ending judgement', JSON.stringify({ turn, endedNormally: j.endedNormally, reason: j.reason, confidence: j.confidence }));
            })
                .catch((err) => {
                ctx.logger?.warn?.('[ctx-mon] LLM turn-ending judgement failed:', err?.message ?? String(err));
            });
        }
        catch (err) {
            ctx.logger?.warn?.('[ctx-mon] agent/turn-stopping listener error:', err?.message ?? String(err));
        }
    });
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
                const pc = settingsCtx.get('profileContext');
                const editor = settingsCtx.get('configEditor');
                const watchContext = editor?.['ownerContext']?.profileContext;
                const CE_ID = 'dsh-flash-ctx-mon';
                let entryInfo;
                try {
                    const cfg = editor?.configuration?.();
                    const row = cfg
                        ?.find?.((r) => r.entry?.options?.id === CE_ID);
                    entryInfo = row
                        ? { inheritedKeys: Object.keys((row.inherited ?? {})), override: row.override }
                        : { found: false, ids: cfg?.map((r) => r.entry?.options?.id) };
                }
                catch (e2) {
                    entryInfo = { configurationErr: e2 && e2.message };
                }
                console.log('[dsh-flash-ctx-mon] host profileContext:', JSON.stringify({
                    patchPath: pc?.patchPath ?? watchContext?.patchPath,
                    profileDir: pc?.dir ?? watchContext?.dir,
                    home: pc?.home,
                    startedBundles: pc?.startedBundles,
                    overlays: (pc ?? watchContext)?.overlays,
                    hasEditor: editor !== undefined,
                    entryId: editor?.entries?.()?.find?.((en) => en.options?.id === CE_ID)?.options?.id,
                    entryInfo,
                }, null, 2));
                // ALSO persist to a file in the plugin source dir so the agent can read it
                // without the user's host console (the desktop host stdout is not on disk).
                try {
                    try {
                        mkdirSync('C:/codes/ai-test/dsh-flash-ctx-mon/.diag', { recursive: true });
                    }
                    catch { /* noop */ }
                    writeFileSync('C:/codes/ai-test/dsh-flash-ctx-mon/.diag/host-profileContext.json', JSON.stringify({
                        ts: new Date().toISOString(),
                        pid: process.pid,
                        patchPath: pc?.patchPath ?? watchContext?.patchPath,
                        profileDir: pc?.dir ?? watchContext?.dir,
                        home: pc?.home,
                        startedBundles: pc?.startedBundles,
                        overlays: (pc ?? watchContext)?.overlays,
                        hasEditor: editor !== undefined,
                        entryId: editor?.entries?.()?.find?.((en) => en.options?.id === CE_ID)?.options?.id,
                        entryInfo,
                    }, null, 2));
                }
                catch (e3) {
                    console.warn('[dsh-flash-ctx-mon] diag-file error:', e3 && e3.message);
                }
            }
            catch (e) {
                console.warn('[dsh-flash-ctx-mon] diagnostic error:', e && e.message);
            }
            return settingsCtx.settings.configure({ auto: false }, ctx.fiber);
        });
    });
}
