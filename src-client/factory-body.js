// dsh-flash-ctx-mon — Context monitor client half
// Single file, no build step. Loaded via window.__ModuleLoader__.
//
// Migrated from dock-flash/lib/client.js:
// - Context i18n keys (zh/en)
// - createSessionEventTokenSource() → reads DSH session events
// - createSessionContextProvider() → provider id dsh-flash-ctx-mon:context-alert
// - Context enable toggle → dsh-flash-ctx-mon:monitor-context
// - MONITOR_SLIDER_FIELDS.context (6 sliders)
// - MonitorConfigModal (context-only branch)
// - _ctxPrefs preference system
//
// No HTTP routes — entirely client-side. Reads token usage from DSH session
// events via ctx.get('sessions'); a model's context window is resolved read-time
// from the llm-pi-ai model config or the request/context event, never persisted.
//
// Provider id: dsh-flash-ctx-mon:context-alert
// Toggle key: dsh-flash-ctx-mon:monitor-context
// Settings namespace: dsh-flash-ctx-mon

// Pure logic is extracted to sibling modules and unit-tested under test/.
// The factory imports the pure (stateless) helpers and constants so the
// presentational layer is not a second source of truth for those algorithms.
// The stateful logic (prefs / token-source / skill-tracker / model-catalog /
// context provider) intentionally stays inline below because it is coupled to
// this closure's private state — splitting it further risks the session-event
// binding that this plugin depends on.
import {
  formatTokenK,
  formatTokenK1,
  CWS_REQUEST_CONTEXT,
  CWS_USER_MAPPING,
  CWS_APPROX_DEFAULT,
} from './tokens.js'
import { SKILL_CONTENT_PREFIX, parseSkillBlock, findSkillBlock } from './skill-detect.js'
import { extractWindowFromError, isContextLimitError } from './ctx-window.js'
// stateful AutoRetryRunner is composed inline below against the current session
// binding, but the guards/transitions are pure and unit-tested here).
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
  isHandoffStub,
  textHasQuestionMark,
  retryAttemptKey,
  requestIdForAttempt,
  isPersistenceArmed,
  applyAutoRetryPref,
  AUTORETRY_SESSION_KEY,
} from './auto-retry.js'
import {
  makeLedger,
  noteOpenTurn,
  noteClosedTurn,
  clearOpenTurns,
  unsettledTurnsAt,
} from './unfinished-turn.js'

window.__ModuleLoader__.load({
  id: 'dsh-flash-ctx-mon',
  factory: (require) => {

    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useRef = React.useRef
    var Component = React.Component
    var ReactDOMClient = null
    try { ReactDOMClient = require('react-dom/client') } catch (_) {}

    // ═══════════════════════════════════════════════════════════════════════
    //#region i18n ────────────────────────────────────────────────────────────

    var zh = {
      alertContextInfo: '会话上下文较长',
      alertContextWarning: '会话上下文即将用尽',
      alertContextError: '会话上下文几乎用尽',
      alertCtxCluster: '上下文监控',
      alertOpenMonitorConfig: '打开监控配置',
      alertWindowMismatch: '上下文窗口不匹配',
      alertWindowMismatchDetail: '模型 {model} 的映射窗口 {mapped} 与请求上下文窗口 {actual} 不一致',
      alertAdoptWindow: '采纳此窗口',
      alertAdoptWindowDone: '已采纳 {model} 的上下文窗口 {actual}',
      alertIgnoreMismatch: '忽略',
      alertIgnoreMismatchDone: '已忽略 {model} 的窗口不匹配提醒',
      // Skills used in this session
      alertSkillUsed: '使用了技能',
      ctxSkillsSection: '本会话使用的技能',
      ctxSkillsEmpty: '本会话尚未使用技能',
      ctxSkillsScope: '仅统计当前会话，不含子代理与其他会话',
      ctxSkillsViaModel: '模型调用',
      ctxSkillsViaUser: '用户调用',
      ctxSkillsCount: '次数',
      ctxSkillsFirst: '首次',
      ctxSkillsLast: '最近',
      ctxSkillsOpen: '在侧栏打开',
      ctxSkillsLoading: '正在读取技能目录…',
      ctxSkillsFailed: '技能目录读取失败',
      ctxSkillsRetry: '重试',
      ctxSkillsNoDesc: '（目录中没有描述）',
      monitorConfig: '配置',
      // Context thresholds
      ctxApproxWindow: '上下文窗口大小',
      ctxThresholdInfo: '信息阈值',
      ctxThresholdInfoTip: '上下文使用量占窗口比例超过此值时触发信息级告警。例如设为 70%，则使用 70% 窗口时提示。建议 60–75%。',
      ctxThresholdWarning: '警告阈值',
      ctxThresholdWarningTip: '上下文占比超过此值时触发警告级告警。对话即将接近窗口上限，新消息可能被截断。建议 80–88%。',
      ctxThresholdError: '错误阈值',
      ctxThresholdErrorTip: '上下文占比超过此值时触发错误级告警。对话几乎用尽窗口，模型已无法获得完整上下文。建议 90–95%。必须大于警告阈值。',
      ctxPollBase: '上下文轮询基础间隔',
      ctxPollBaseTip: '上下文占比低时的采样间隔（天花板）。占比越高采样越密。精确模式下会自动加倍间隔，因为事件源会主动推送。',
      ctxPollMin: '上下文轮询最小间隔',
      ctxPollMinTip: '上下文占比很高时的采样间隔（地板）。防止采样过于频繁。默认 2 秒。',
      // Context data source quality
      ctxParamsSection: '配置参数',
      ctxApproxWindowHint: '未知模型的默认窗口',
      ctxSrcRequestContext: '会话事件',
      ctxSrcCatalogAuto: '模型目录',
      ctxSrcCatalogUnknown: '目录未知',
      ctxSrcErrorExtracted: '错误解析',
      ctxSrcBuiltinTable: '内置表',
      ctxSrcFuzzyMatch: '模糊匹配',
      ctxSrcApproxDefault: '估算默认',
      ctxSrcUnknown: '未知',
      ctxNoWindow: '—',
      // Auto-Retry / auto-continue
      ctxAutoRetrySection: '自动继续',
      autoRetryGraceMs: '重试宽限期',
      autoRetryGraceMsTip: '回合异常结束后等待多久才自动补发“继续”。建议 3–8 秒，给模型长输出留出收尾时间。',
      autoRetryCooldownMs: '冷却间隔',
      autoRetryCooldownMsTip: '同一会话两次自动补发的最大频率（间隔上限）。防止“继续”连发烧钱。',
      autoRetryMaxConsecutive: '连续次数上限',
      autoRetryMaxConsecutiveTip: '连续补发达到此次数仍未完成即暂停，等待人工介入。',
      autoRetryMaxBackoffMs: '最大退避',
      autoRetryMaxBackoffMsTip: '指数退避的上限：连续失败越久，两次补发的间隔越长，但不会超过此值。',
      autoRetryContinueText: '“继续”文本',
      autoRetryContinueTextTip: '自动补发的消息内容。连同请求 ID 一起用于识别自身回显，请保持默认值。',
      autoRetryEchoWindowMs: '回显识别窗口',
      autoRetryEchoWindowMsTip: '发送“继续”后，在该窗口内收到的同名消息视为自身回显，不计入人工输入。',
      // Auto-retry runner live status (resident overlay)
      autoRetryRunnerSection: '自动继续状态',
      autoRetryStateStopped: '已停止',
      autoRetryStateArmed: '待命中',
      autoRetryStateScheduled: '已排程',
      autoRetryStatePaused: '已暂停，等待人工输入',
      autoRetryRearmHint: '重新开启自动继续（预算重置为满，恢复待命）',
      autoRetryAccumLabel: '累计重试',
      autoRetryCooldownLabel: '冷却剩余',
      autoRetryScheduledLabel: '即将补发',
      autoRetryArmNow: '立即补发一次（发送“继续”）',
      autoRetryDisarm: '停止自动继续',
      autoRetryHint: '自动继续已开启',
      // Composer send-button indicator (§8b) — compact per-state labels
      autoRetrySendArmed: '自动继续',
      autoRetrySendScheduled: '即将自动继续',
      autoRetrySendPaused: '已暂停',
      // Auto-continue exited (info alert with the reason)
      alertAutoRetryExited: '已退出自动继续',
      autoRetryExitedReasonBudget: '已连续自动继续达到上限，暂停等待人工输入',
      autoRetryExitedReasonPromptFailed: '自动补发「继续」失败，已停止自动继续',
      autoRetryExitedReasonSettled: '本轮已正常收尾，将暂停本会话的自动继续状态',
      // Location suffix appended to the exited-alert so the user can locate the
      // workspace + session that just left auto-continue.
      autoRetryExitedLocSid: '会话 {value}',
      autoRetryExitedLocWs: '工作区 {value}',
      autoRetryExitedLocSep: '，',
      autoRetryExitedLocOpen: '（',
      autoRetryExitedLocClose: '）',
      // Turn-ending judgement (info alert naming how the settled turn ended)
      turnVerdictTitle: '本轮对话判定',
      turnVerdictNormal: '正常收尾',
      turnVerdictError: '出错结束',
      turnVerdictInterrupted: '被打断',
      turnVerdictMaxTokens: '达到输出上限',
      turnVerdictQuestion: '模型在等待你的回答',
      turnVerdictHandoff: '模型只承诺了后续（待继续）',
      turnVerdictDetail: '（{value}）',
      // Quick-control switch label (one-click manual off / re-arm)
      autoRetryQuickLabel: '自动继续',
      // Alert preview
      alertPreviewToggle: '查看告警消息样例',
    }

    var en = {
      alertContextInfo: 'Session context getting long',
      alertContextWarning: 'Session context nearly exhausted',
      alertContextError: 'Session context almost exhausted',
      alertCtxCluster: 'Context Monitor',
      alertOpenMonitorConfig: 'Open monitor config',
      alertWindowMismatch: 'Context window mismatch',
      alertWindowMismatchDetail: 'Model {model}: mapped window {mapped} differs from the request/context window {actual}',
      alertAdoptWindow: 'Adopt this window',
      alertAdoptWindowDone: 'Adopted {model} context window {actual}',
      alertIgnoreMismatch: 'Ignore',
      alertIgnoreMismatchDone: 'Ignored window-mismatch alerts for {model}',
      // Skills used in this session
      alertSkillUsed: 'Skill used',
      ctxSkillsSection: 'Skills used in this session',
      ctxSkillsEmpty: 'No skills used in this session yet',
      ctxSkillsScope: 'Current session only — subagents and other sessions are excluded',
      ctxSkillsViaModel: 'Model',
      ctxSkillsViaUser: 'User',
      ctxSkillsCount: 'Uses',
      ctxSkillsFirst: 'First',
      ctxSkillsLast: 'Last',
      ctxSkillsOpen: 'Open in sidebar',
      ctxSkillsLoading: 'Reading the skill catalog…',
      ctxSkillsFailed: 'Skill catalog unavailable',
      ctxSkillsRetry: 'Retry',
      ctxSkillsNoDesc: '(no description in catalog)',
      monitorConfig: 'Configure',
      // Context thresholds
      ctxApproxWindow: 'Context Window Size',
      ctxThresholdInfo: 'Info Threshold',
      ctxThresholdInfoTip: 'Triggers an info alert when context usage exceeds this percentage of the window. E.g. 70% means alerting when 70% of the window is consumed. Recommended: 60–75%.',
      ctxThresholdWarning: 'Warning Threshold',
      ctxThresholdWarningTip: 'Triggers a warning when context usage exceeds this percentage. The conversation is nearing the window limit — new messages may be truncated. Recommended: 80–88%.',
      ctxThresholdError: 'Error Threshold',
      ctxThresholdErrorTip: 'Triggers an error when context usage exceeds this percentage. The window is almost exhausted and the model cannot see the full context. Recommended: 90–95%. Must be greater than the Warning threshold.',
      ctxPollBase: 'Context Poll Base Interval',
      ctxPollBaseTip: 'Sampling interval when context usage is low (the ceiling). The higher the usage, the denser the sampling. In precise mode the interval is doubled automatically since the event source pushes updates.',
      ctxPollMin: 'Context Poll Min Interval',
      ctxPollMinTip: 'Minimum sampling interval even when context usage is high (the floor). Prevents excessive polling. Default 2s.',
      // Context data source quality
      ctxParamsSection: 'Configuration',
      ctxApproxWindowHint: 'Default for unknown models',
      ctxSrcRequestContext: 'Session Event',
      ctxSrcCatalogAuto: 'Model Catalog',
      ctxSrcCatalogUnknown: 'Catalog (unknown)',
      ctxSrcErrorExtracted: 'Error Parsed',
      ctxSrcBuiltinTable: 'Built-in',
      ctxSrcFuzzyMatch: 'Fuzzy Match',
      ctxSrcApproxDefault: 'Fallback',
      ctxSrcUnknown: 'Unknown',
      ctxNoWindow: '—',
      // Auto-Retry / auto-continue
      ctxAutoRetrySection: 'Auto-Retry',
      autoRetryGraceMs: 'Retry grace period',
      autoRetryGraceMsTip: 'How long to wait after an abnormal turn/end before auto-sending “continue”. Recommended 3–8s so a long model output can finish.',
      autoRetryCooldownMs: 'Cooldown interval',
      autoRetryCooldownMsTip: 'Minimum spacing between two auto-continues in the same session. Prevents “continue” from burning tokens.',
      autoRetryMaxConsecutive: 'Max consecutive',
      autoRetryMaxConsecutiveTip: 'Pause and wait for the user once this many consecutive auto-continues still did not finish the turn.',
      autoRetryMaxBackoffMs: 'Max backoff',
      autoRetryMaxBackoffMsTip: 'Ceiling of the exponential backoff: the more times it fails, the longer the gap — but never more than this.',
      autoRetryContinueText: '“Continue” text',
      autoRetryContinueTextTip: 'The message auto-continue sends. Used (with the request id) to recognize self-echo; keep the default.',
      autoRetryEchoWindowMs: 'Echo window',
      autoRetryEchoWindowMsTip: 'Messages with the same text received within this window after a “continue” are treated as self-echo, not user input.',
      // Auto-retry runner live status (resident overlay)
      autoRetryRunnerSection: 'Auto-retry runner',
      autoRetryStateStopped: 'Stopped',
      autoRetryStateArmed: 'Armed',
      autoRetryStateScheduled: 'Scheduled',
      autoRetryStatePaused: 'Paused — waiting for you',
      autoRetryRearmHint: 'Re-open auto-continue (resets the budget and returns to armed)',
      autoRetryAccumLabel: 'Retried',
      autoRetryCooldownLabel: 'Cooldown',
      autoRetryScheduledLabel: 'Sends in',
      autoRetryArmNow: 'Continue now (send “continue”)',
      autoRetryDisarm: 'Stop auto-continue',
      autoRetryHint: 'auto-continue active',
      // Composer send-button indicator (§8b) — compact per-state labels
      autoRetrySendArmed: 'auto-continue',
      autoRetrySendScheduled: 'auto-send soon',
      autoRetrySendPaused: 'paused',
      // Auto-continue exited (info alert with the reason)
      alertAutoRetryExited: 'Auto-continue turned off',
      autoRetryExitedReasonBudget: 'Reached the auto-continue limit — paused for your input',
      autoRetryExitedReasonPromptFailed: 'Auto-continue was rejected — stopped sending "继续"',
      autoRetryExitedReasonSettled: 'This turn ended normally — auto-continue for this session is now paused',
      // Location suffix appended to the exited-alert so the user can locate the
      // workspace + session that just left auto-continue.
      autoRetryExitedLocSid: 'session {value}',
      autoRetryExitedLocWs: 'workspace {value}',
      autoRetryExitedLocSep: ', ',
      autoRetryExitedLocOpen: ' (',
      autoRetryExitedLocClose: ')',
      // Turn-ending judgement (info alert naming how the settled turn ended)
      turnVerdictTitle: 'Turn ending judgement',
      turnVerdictNormal: 'Ended normally',
      turnVerdictError: 'Ended with an error',
      turnVerdictInterrupted: 'Was interrupted',
      turnVerdictMaxTokens: 'Hit the output limit',
      turnVerdictQuestion: 'Model is waiting for your answer',
      turnVerdictHandoff: 'Model only promised a follow-up (to continue)',
      turnVerdictDetail: ' ({value})',
      // Quick-control switch label (one-click manual off / re-arm)
      autoRetryQuickLabel: 'Auto-continue',
      // Alert preview
      alertPreviewToggle: 'View alert message samples',
    }

    var LOCALES = { zh: zh, en: en }

    /** Read the current BCP-47 tag from <html lang> (or navigator fallback). */
    function detectLocaleTag() {
      try {
        var tag = document.documentElement.lang
        if (tag) return tag
      } catch (_) {}
      try { return navigator.language || 'en' } catch (_) { return 'en' }
    }

    /** Map a BCP-47 tag to one of our locale keys ('zh' | 'en'). */
    function resolveLocaleKey(tag) {
      var lower = (tag || '').toLowerCase()
      if (lower.startsWith('zh')) return 'zh'
      return 'en'
    }

    var _currentLocaleKey = resolveLocaleKey(detectLocaleTag())

    /** Observe <html lang> changes so the UI updates on language switch. */
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      try {
        var _langObserver = new MutationObserver(function () {
          var next = resolveLocaleKey(detectLocaleTag())
          if (next !== _currentLocaleKey) _currentLocaleKey = next
        })
        _langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
      } catch (_) {}
    }

    /** i18n lookup — returns the string for the current locale. */
    function t(key) {
      var locale = LOCALES[_currentLocaleKey] || LOCALES.en
      return locale[key] !== undefined ? locale[key] : (LOCALES.en[key] !== undefined ? LOCALES.en[key] : key)
    }

    /** Map an auto-continue exit reason to its i18n key. A manual stop never
     *  alerts (see AUTO_RETRY_EXIT_REASONS), and only reasons that survive the
     *  gating in _noteAutoRetryExit are surfaced — consecutive-budget exhaustion,
     *  a host-rejected auto-continue prompt, and a normal settled turn (which,
     *  per the restored product decision in _handleTurnEnd, pauses the current
     *  session's auto-continue). */
    function autoRetryExitedReasonKey(reason) {
      if (reason === 'prompt-failed') return 'autoRetryExitedReasonPromptFailed'
      if (reason === 'settled') return 'autoRetryExitedReasonSettled'
      return 'autoRetryExitedReasonBudget'
    }

    /** Build the location suffix for the "exited auto-continue" alert so the
     *  user can locate the workspace + session that just left auto-continue.
     *  Displays human-friendly NAMES rather than raw ids: `sessionName` is the
     *  session's displayTitle (durable title / project basename / session id),
     *  and `workspace` is the cwd basename. Only renders the context that is
     *  actually resolvable — the id fallback is always present (the alert only
     *  fires for the current session), and the workspace is included when the
     *  session list reports a cwd. Returns an empty string when neither is
     *  available (defensive; should not happen). */
    function autoRetryExitedLocate(sessionId, workspace, sessionName) {
      var bits = []
      var sidShown = (typeof sessionName === 'string' && sessionName) ? sessionName : sessionId
      if (sidShown != null && sidShown !== '') bits.push(t('autoRetryExitedLocSid').replace('{value}', String(sidShown)))
      if (workspace) bits.push(t('autoRetryExitedLocWs').replace('{value}', workspace))
      if (!bits.length) return ''
      return t('autoRetryExitedLocOpen') + bits.join(t('autoRetryExitedLocSep')) + t('autoRetryExitedLocClose')
    }

    /** Functional label helper — returns a function that calls t() so the label updates on locale change. */
    function L(key) {
      return function () { return t(key) }
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region Preference system ──────────────────────────────────────────────

    var _CTX_ALERT_DEFAULTS = {
      ctxApproxWindow: 128000,
      ctxThresholdInfo: 70,
      ctxThresholdWarning: 85,
      ctxThresholdError: 95,
      ctxPollBase: 20000,
      ctxPollMin: 2000,
      // Auto-Retry / auto-continue tuning (mirrors src/index.ts volatile fields)
      autoRetryGraceMs: 5000,
      autoRetryCooldownMs: 20000,
      autoRetryMaxConsecutive: 4,
      autoRetryMaxBackoffMs: 300000,
      autoRetryContinueText: '继续',
      autoRetryEchoWindowMs: 30000,
    }

    var _ctxPrefs = Object.assign({}, _CTX_ALERT_DEFAULTS)
    var _prefCtx = null
    var CTX_MON_NS = 'dsh-flash-ctx-mon'
    var LLM_PI_AI_NS = 'llm-pi-ai'
    var _llmPiAiState = { providers: Object.create(null), revision: 0, present: false }
    var _hostRevision = null
    var _prefWriteTail = Promise.resolve()
    var _pendingRevision = null

    function _fenceRevision() {
      if (_pendingRevision !== null) return _pendingRevision
      return _hostRevision === null ? undefined : _hostRevision
    }

    function _remoteSettings(ctx) {
      try {
        if (ctx && ctx.remote && ctx.remote.settings) return ctx.remote.settings
      } catch (e) {
        console.warn('[dsh-flash-ctx-mon] ctx.remote.settings threw:', e && e.message)
      }
      try {
        var remote = ctx && ctx.get ? ctx.get('remote') : undefined
        if (remote && remote.settings) return remote.settings
      } catch (e) { console.warn('[dsh-flash-ctx-mon] ctx.get("remote") threw:', e && e.message) }
      return undefined
    }

    /** Normalize a `describe()` result into a promise. NEVER let this throw.
     *
     *  Calling `.then` directly on a `describe()` result is not safe: the SAME
     *  method name has two implementations. The typert WIRE form returns a Promise, but the DIRECT
     *  form — `SettingsController.describe()` in
     *  `@deepseek-ai/dsh-api-settings-controller` — is SYNCHRONOUS and returns the
     *  view object itself; and it can THROW instead ("settings service is absent:
     *  mount @deepseek-ai/dsh-settings …"). So `.then` may not exist at all, and
     *  the TypeError is thrown SYNCHRONOUSLY, ahead of any `.catch`.
     *
     *  WHY THAT IS NOT JUST A LOG LINE: `apply()` here is `async` with no internal
     *  try/catch, so the throw becomes a REJECTED apply — the Cordis fiber goes
     *  FAILED and the plugin never activates. Its switches simply never appear:
     *  the "the plugin was registered and then silently disappeared" symptom,
     *  with `TypeError: settings.describe(...).then is not a function` as the
     *  only clue. Verified in dock-flash's check:overlay section 23. */
    function _describeAsync(settings) {
      try { return Promise.resolve(settings.describe()) }
      catch (err) { return Promise.reject(err) }
    }

var _PREFS_MAX_RETRIES = 8
    var _PREFS_RETRY_DELAY_MS = 750

    function loadCtxPrefs(ctx, _retryCount) {
      if (typeof _retryCount !== 'number') _retryCount = 0
      var settings = _remoteSettings(ctx)
      if (!settings) return Promise.resolve(false)
      if (typeof settings.describe !== 'function') return Promise.resolve(false)
      return _describeAsync(settings).then(function (desc) {
        if (!desc) return false
        var view = desc.value || desc
        var list = view && Array.isArray(view.namespaces)
          ? view.namespaces
          : (Array.isArray(view) ? view : null)
        if (!list) return false
        var ns = list.find(function (n) {
          return (n && (n.ns || n.namespace)) === CTX_MON_NS
        })
        if (!ns) {
          if (_retryCount < _PREFS_MAX_RETRIES) {
            return new Promise(function (resolve) {
              setTimeout(function () {
                resolve(loadCtxPrefs(ctx, _retryCount + 1))
              }, _PREFS_RETRY_DELAY_MS)
            })
          }
          return false
        }
        var resolved = ns.value || ns.resolved
        if (!resolved) return false
        _ctxPrefs = {
          ctxApproxWindow: resolved.ctxApproxWindow,
          ctxThresholdInfo: resolved.ctxThresholdInfo,
          ctxThresholdWarning: resolved.ctxThresholdWarning,
          ctxThresholdError: resolved.ctxThresholdError,
          ctxPollBase: resolved.ctxPollBase,
          ctxPollMin: resolved.ctxPollMin,
          autoRetryGraceMs: resolved.autoRetryGraceMs,
          autoRetryCooldownMs: resolved.autoRetryCooldownMs,
          autoRetryMaxConsecutive: resolved.autoRetryMaxConsecutive,
          autoRetryMaxBackoffMs: resolved.autoRetryMaxBackoffMs,
          autoRetryContinueText: resolved.autoRetryContinueText,
          autoRetryEchoWindowMs: resolved.autoRetryEchoWindowMs,
        }
        if (typeof ns.revision === 'number') _hostRevision = ns.revision
        console.log('[dsh-flash-ctx-mon] preferences loaded from ' + CTX_MON_NS + ' namespace')
        var _pi = list.find(function (n) {
          return (n && (n.ns || n.namespace)) === LLM_PI_AI_NS
        })
        if (_pi) {
          var _pv = _pi.value || _pi.resolved
          _llmPiAiState.providers = _pv && _pv.providers ? _pv.providers : Object.create(null)
          _llmPiAiState.revision = typeof _pi.revision === 'number' ? _pi.revision : 0
          _llmPiAiState.present = true
        }
        return true
      }).catch(function () {
        return false
      })
    }

    /** Read an alert preference from _ctxPrefs, falling back to the built-in default. */
    function _alertPref(key) {
      var v = _ctxPrefs && _ctxPrefs[key]
      if (typeof v === 'number' && isFinite(v)) return v
      if (v != null && typeof v === 'object') return v   // Record<string,*> values
      return _CTX_ALERT_DEFAULTS[key]
    }

    /** Read a string alert preference (e.g. the continue text), with default. */
    function _alertStr(key) {
      var v = _ctxPrefs && _ctxPrefs[key]
      return (typeof v === 'string' && v) || _CTX_ALERT_DEFAULTS[key] || ''
    }

    /** Write an alert preference through the preference bridge (host + memory). */
    function _writeAlertPref(ctx, key, value, onError) {
      savePrefs(ctx, Object.fromEntries([[key, value]]), null, onError)
    }

    /** Save preferences: update _ctxPrefs in memory, then serialize a write to the 'dsh-flash-ctx-mon' settings namespace. */
    function savePrefs(ctx, patch, localWrites, onError) {
      var saved = {}
      for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) saved[k] = _ctxPrefs && _ctxPrefs[k]
      if (_ctxPrefs) {
        for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) _ctxPrefs[k] = patch[k]
      }
      try { if (localWrites) localWrites() } catch (_) {}
      return _queuePrefWrite(ctx, patch, onError, saved)
    }

    /** Roll the optimistic in-memory write back after the host refused it. A
     *  rejected write used to be completely silent, which is what let stale
     *  preference reads survive: the value appeared in the panel, the host
     *  rejected it, and the in-memory copy was rolled back with no trace. Here
     *  the rollback is logged so a refusal is never invisible. */
    function _revertPrefs(patch, saved, reason) {
      try {
        console.warn('[dsh-flash-ctx-mon] preference write rejected: ' + reason
          + ' — reverted [' + Object.keys(patch || {}).join(', ') + ']')
      } catch (_) {}
      for (var k in saved) {
        if (Object.prototype.hasOwnProperty.call(saved, k)) _ctxPrefs[k] = saved[k]
      }
    }

    function _queuePrefWrite(ctx, patch, onError, saved) {
      var task = _prefWriteTail.then(function () {
        var settings = _remoteSettings(ctx || _prefCtx)
        if (!settings || typeof settings.update !== 'function') {
          if (onError) onError(patch, function () { _revertPrefs(patch, saved, 'settings service unavailable') })
          return false
        }
        return settings.update(CTX_MON_NS, patch, _fenceRevision())
          .then(function (res) {
            try {
              if (res && res.ok === false) {
                _pendingRevision = null
                var err = res.error || {}
                if (onError) onError(patch, function () {
                  _revertPrefs(patch, saved, (err.code || 'rejected') + (err.message ? ': ' + err.message : ''))
                })
                try {
                  _describeAsync(settings).then(function (desc) {
                    if (desc && desc.ok !== false) {
                      var view2 = desc.value || desc
                      var list2 = view2 && Array.isArray(view2.namespaces)
                        ? view2.namespaces
                        : (Array.isArray(view2) ? view2 : null)
                      var ns2 = list2 && list2.find(function (n) {
                        return (n && (n.ns || n.namespace)) === CTX_MON_NS
                      })
                      if (ns2 && typeof ns2.revision === 'number') _hostRevision = ns2.revision
                    }
                  }).catch(function () {})
                } catch (_) {}
                return false
              }
              var v = res && res.value
              if (v && typeof v.revision === 'number') {
                _pendingRevision = v.revision
                _hostRevision = v.revision
              }
            } catch (_) {}
            return true
          }).catch(function (err) {
            _pendingRevision = null
            if (onError) onError(patch, function () {
              _revertPrefs(patch, saved, 'threw: ' + ((err && err.message) || err))
            })
            return false
          })
      })
      _prefWriteTail = task.then(function () {}, function () {})
      return task
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region Context window source state & helpers ──────────────────────────

    // formatTokenK / formatTokenK1 and the CWS_* constants are imported from
    // modules/tokens.js (single source of truth, unit-tested).  Only the
    // stateful, closure-bound pieces below stay inline.

    /** Resolve one Client Remote namespace, e.g. 'session' or 'skills'.
     *
     *  The reliable route is the SERVICE KEY `remote.<namespace>` — the same
     *  lookup `ctx.get("remote.costMeter")` uses elsewhere in the plugin set.
     *  Reading the namespace as a PROPERTY of the root Remote service
     *  (`ctx.get('remote').session`) is NOT equivalent: cordis resolves a
     *  nested service name through the accessing fiber's inject chain and
     *  throws `cannot get property "remote.session" without inject` for a
     *  plugin that never injected that name. That is what broke the model
     *  window map: the property route threw and aborted the lookup before the
     *  service-key route could run.
     *
     *  Every route is therefore guarded individually, so one that throws cannot
     *  take the others down with it. */
    function resolveRemoteNamespace(ctx, name) {
      if (!ctx || typeof ctx.get !== 'function') return null
      try {
        var direct = ctx.get('remote.' + name)
        if (direct) return direct
      } catch (_) {}
      try {
        var root = ctx.get('remote')
        if (root && root[name]) return root[name]
      } catch (_) {}
      try {
        if (ctx.remote && ctx.remote[name]) return ctx.remote[name]
      } catch (_) {}
      return null
    }


    function _llmModelEntry(modelId) {
      if (!modelId) return null
      var providers = _llmPiAiState && _llmPiAiState.providers
      if (!providers || typeof providers !== 'object') return null
      var keys = Object.keys(providers)
      for (var i = 0; i < keys.length; i++) {
        var pid = keys[i]
        var models = providers[pid] && providers[pid].models
        if (!Array.isArray(models)) continue
        for (var j = 0; j < models.length; j++) {
          if (models[j] && models[j].id === modelId) return { providerId: pid, index: j }
        }
      }
      return null
    }

    function _resolveWindow(modelName) {
      if (!modelName) return { window: null, source: CWS_APPROX_DEFAULT }
      // 0. Authoritative llm-pi-ai model config (persisted into the DSH profile
      //    for @deepseek-ai/dsh-llm-pi-ai): providers.<pid>.models[].contextWindow.
      var _llmW = _llmModelEntry(modelName)
      if (_llmW) {
        var _pw = _llmPiAiState.providers[_llmW.providerId]
        var _mw = _pw && _pw.models && _pw.models[_llmW.index]
        if (_mw && _mw.contextWindow != null) {
          return { window: _mw.contextWindow, source: CWS_USER_MAPPING }
        }
      }
      // 1. No authoritative configured window for this model — return null
      //    (caller uses ctxApproxWindow as default).
      return { window: null, source: CWS_APPROX_DEFAULT }
    }

    /** "Adopt this window": persist the model's authoritative request/context
     *  window into the DSH profile's llm-pi-ai model config (global persisted
     *  change), then keep the in-memory view in sync.
     *
     *  This is a cross-namespace write into the DSH llm-pi-ai config the user
     *  sanctioned explicitly. It re-describes the latest llm-pi-ai view so it
     *  does not silently overwrite other providers/models the user edited since
     *  the last describe, deep-copies the whole providers object so unrelated
     *  fields survive, and writes via the settings service's revision fence to
     *  survive concurrent edits.
     *
     *  onDone(ok): ok=true means the window was persisted and in-memory state
     *  was refreshed; ok=false means the host refused (settings/conflict or
     *  settings/rejected) and nothing was changed. */
    function _persistAdopt(ctx, mm) {
      var settings = _remoteSettings(ctx)
      if (!settings || typeof settings.update !== 'function' || !mm || !mm.model) {
        return Promise.resolve(false)
      }
      return _describeAsync(settings).then(function (desc) {
        var view = desc && (desc.value || desc)
        var list = view && Array.isArray(view.namespaces) ? view.namespaces : null
        var entry = list ? list.find(function (n) {
          return (n && (n.ns || n.namespace)) === LLM_PI_AI_NS
        }) : null
        var current = entry && (entry.value || entry.resolved)
        var providers = current && current.providers
        if (!providers || typeof providers !== 'object') {
          return false
        }
        // Deep copy every provider so unrelated provider/model fields survive.
        var clone = {}
        var pids = Object.keys(providers)
        var matched = false
        for (var i = 0; i < pids.length; i++) {
          var pid = pids[i]
          var prov = providers[pid]
          if (!prov || typeof prov !== 'object') { clone[pid] = prov; continue }
          var provClone = {}
          for (var pk in prov) if (Object.prototype.hasOwnProperty.call(prov, pk)) provClone[pk] = prov[pk]
          var models = Array.isArray(provClone.models) ? provClone.models : null
          if (Array.isArray(models)) {
            provClone.models = models.slice(0)
            for (var j = 0; j < provClone.models.length; j++) {
              var m = provClone.models[j]
              if (m && typeof m === 'object' && m.id === mm.model) {
                var mClone = {}
                for (var mk in m) if (Object.prototype.hasOwnProperty.call(m, mk)) mClone[mk] = m[mk]
                mClone.contextWindow = mm.requestWindow
                provClone.models[j] = mClone
                matched = true
              }
            }
          }
          clone[pid] = provClone
        }
        if (!matched) {
          // Model no longer present in the latest llm-pi-ai view — nothing to
          // persist. Surface the refusal rather than pretending we adopted.
          return false
        }
        var rev = typeof entry.revision === 'number' ? entry.revision
          : (typeof _llmPiAiState.revision === 'number' ? _llmPiAiState.revision : undefined)
        return settings.update(LLM_PI_AI_NS, { providers: clone }, rev).then(function () {
          _llmPiAiState.providers = clone
          _llmPiAiState.revision = typeof entry.revision === 'number' ? entry.revision : _llmPiAiState.revision
          _llmPiAiState.present = true
          return true
        }).catch(function (err) {
          var msg = err && err.message ? err.message : String(err)
          console.warn('[dsh-flash-ctx-mon] adopt window rejected: ' + msg)
          return false
        })
      }).catch(function (err) {
        console.warn('[dsh-flash-ctx-mon] adopt window describe failed: ' + (err && err.message ? err.message : String(err)))
        return false
      })
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region SessionEventTokenSource ──────────────────────────────────────────
    //
    // Reads precise token usage from DSH's session event stream via the
    // `sessions` service.  Data path:
    //   ctx.get('sessions') → binding(sessionId) → eventSource
    //     → entries → filter entry.type==='event' → entry.event
    //       → assistant/message: entry.event.data.usage.inputTokens
    //       → request/header:   entry.event.data.header.config.model
    //
    // When the sessions service is unavailable, no session is active, or
    // usage is absent from events, getTokenEstimate() returns
    // source: 'unavailable' and the caller produces no estimate.

    /** Reference to the active SessionEventTokenSource, set by createSessionContextProvider.
     *  The MonitorConfigModal reads token estimates from this. */
    var _activeTokenSource = null

    /** Optional hook the quick-control auto-continue switch registers so the
     *  token source can nudge it to re-evaluate its visible()/getValue() when a
     *  session bind (or un-bind) transition happens. The switch only appears
     *  once a session is bound, so this is what makes it appear/disappear
     *  immediately on bind success instead of waiting for the user's next
     *  unrelated panel action. Null while the switch is not registered. */
    var _notifyAutoRetryQuick = null

    /** The most recent session id the rendered panel reported for binding. Kept
     *  at module scope so a SkillChip that mounts before its target source has
     *  started can still hand the id over once that source starts — otherwise
     *  the bind is skipped once and (with deps `[sessionId]`) never re-runs. */
    var _injectedSessionId = null

    /** Quick-control switch id for the manual auto-continue on/off entry. Kept
     *  distinct from TOGGLE_KEY (the context-monitor master toggle) so panel
     *  users get a dedicated one-click close for auto-continue. */
    var RUNNER_QUICK_KEY = 'dsh-flash-ctx-mon:auto-continue'

    /** Whether the CURRENT bound session has auto-continue ACTIVE. armed,
     *  scheduled and paused all count as on; stopped (and no view / no source)
     *  count as off. Shared by the quick-control switch's visible()/getValue()
     *  (registered in _registerServices) and the in-modal runner state so every
     *  surface agrees on one source of truth. */
    function _getRunnerActive() {
      var src = _activeTokenSource
      if (!src || typeof src.getAutoRetryView !== 'function') return false
      var view = null
      try { view = src.getAutoRetryView() || null } catch (_) { return false }
      if (!view) return false
      var st = view.state
      return st === 'armed' || st === 'scheduled' || st === 'paused'
    }

    /** Optional live bridge for the resident overlay (§6). Integration code may
     *  attach a `{ notify(view) }` object here to subscribe to auto-retry view
     *  publishes; while null the publishes are a no-op and the overlay reads
     *  snapshots directly from _activeTokenSource.getAutoRetryView(). */
    var _autoRetryStore = null

    // ─────────────────────────────────────────────────────────────────────────
    // Persistent auto-continue indicator on the resident flash icon (§8).
    //
    // The always-present floating flash trigger button is rendered by the
    // dsh-flash plugin itself — it carries dsh-flash's own attribute
    // `[data-dsh-flash-trigger]`, which is a stable, public selector we can
    // target without touching dsh-flash's source. This block makes that icon
    // VISIBLY reflect the auto-continue state of the current session:
    //   - armed     → a steady pulsing GREEN glow ring  (auto-continue on deck)
    //   - scheduled → a faster flashing ORANGE glow     (auto-send imminent)
    //   - paused    → a solid RED ring (no pulse)       (auto-continue halted)
    //                 + a small ↻ re-arm chip on the bottom-right corner that
    //                 restores green (armed) on click (explicit re-open).
    //   - stopped   → no effect, attributes removed
    //
    // The mechanism stays additive and DOM-light: every auto-retry view
    // publish mirrors the state onto document.documentElement as data
    // attributes + two CSS custom properties (attempt / ratio), and ONE
    // cross-plugin stylesheet (injected lazily, removal on dispose) turns
    // those into the glow on dsh-flash's button. The data layer stays pure; the
    // UI layer installs its `notify` into _autoRetryStore at apply time.
    var _autoRetryIndicatorStyle = null

    function _ensureAutoRetryIndicatorStyle() {
      if (_autoRetryIndicatorStyle || typeof document === 'undefined' || !document.head) return
      try {
        var style = document.createElement('style')
        style.id = 'ctx-mon-autoretry-indicator'
        style.textContent = [
          // Ring width scales with the attempt/retry ratio (inherited from <html>).
          '@keyframes ctxmon-glow-armed{0%,100%{box-shadow:0 0 0 2px rgba(47,158,68,.95),0 0 10px 2px rgba(47,158,68,.5)}50%{box-shadow:0 0 0 calc(3px + (var(--ctxmon-ratio,0)*5px)) rgba(47,158,68,.5),0 0 16px calc(2px + (var(--ctxmon-ratio,0)*6px)) rgba(47,158,68,.85)}}',
          '@keyframes ctxmon-glow-scheduled{0%,100%{box-shadow:0 0 0 2px rgba(232,89,12,.95),0 0 10px 2px rgba(232,89,12,.6)}50%{box-shadow:0 0 0 4px rgba(232,89,12,.5),0 0 18px 5px rgba(232,89,12,.9)}}',
          '@keyframes ctxmon-badge-pulse{0%,100%{opacity:1}50%{opacity:.65}}',
          // armed — steady green pulse
          'html[data-ctx-mon-autoretry=armed] [data-dsh-flash-trigger]{' +
            'animation:ctxmon-glow-armed 1.8s ease-in-out infinite !important;' +
          '}',
          // scheduled — faster orange flash (backoff/grace rhythm)
          'html[data-ctx-mon-autoretry=scheduled] [data-dsh-flash-trigger]{' +
            'animation:ctxmon-glow-scheduled 0.85s ease-in-out infinite !important;' +
          '}',
          // paused — solid red ring, no motion
          'html[data-ctx-mon-autoretry=paused] [data-dsh-flash-trigger]{' +
            'box-shadow:0 0 0 2px rgba(224,49,49,.9),0 0 10px 2px rgba(224,49,49,.5) !important;' +
            'animation:none !important;' +
          '}',
          // The flash icon KEEPS dsh-flash's own color and its translucent
          // outline — we do NOT repaint it per auto-continue state, so the ring
          // on the bolt itself never changes color. Only the surrounding glow
          // (above) and the attempt badge (below) carry per-state color; the
          // icon body and its outline stay at dsh-flash's default.
          // Numeric attempt badge (bottom-left pill) driven by a data attribute we
          // put on the button itself; it inherits the state color. Hidden by the
          // lack of the data attribute (stopped), so no matching element is shown.
          'html[data-ctx-mon-autoretry] [data-dsh-flash-trigger][data-ctx-mon-autoretry-attempt]::after{' +
            'content:attr(data-ctx-mon-autoretry-attempt);' +
            'position:absolute;bottom:-5px;left:-5px;min-width:15px;height:15px;' +
            'padding:0 4px;border-radius:8px;font-size:10px;line-height:15px;' +
            'text-align:center;font-weight:700;color:#fff;' +
            'z-index:1;' +
          '}',
          'html[data-ctx-mon-autoretry=armed] [data-dsh-flash-trigger][data-ctx-mon-autoretry-attempt]::after{background:rgba(47,158,68,1);}',
          'html[data-ctx-mon-autoretry=scheduled] [data-dsh-flash-trigger][data-ctx-mon-autoretry-attempt]::after{background:rgba(232,89,12,1);animation:ctxmon-badge-pulse .9s ease-in-out infinite;}',
          'html[data-ctx-mon-autoretry=paused] [data-dsh-flash-trigger][data-ctx-mon-autoretry-attempt]::after{background:rgba(224,49,49,1);}',
          // Re-arm chip pinned to the bottom-right corner of the icon, present
          // only while paused. It is a real (role=button) element so it carries
          // a click handler (see _placeAutoRetryRearm) — pure CSS cannot host a
          // click, so the chip is injected/removed from JS on each publish.
          'html[data-ctx-mon-autoretry=paused] [data-dsh-flash-trigger]{position:relative !important;overflow:visible !important;}',
          'html[data-ctx-mon-autoretry=paused] [data-dsh-flash-trigger] [data-ctx-mon-rearm]{' +
            'position:absolute;right:-3px;bottom:-3px;min-width:16px;height:16px;box-sizing:border-box;' +
            'padding:0;border-radius:999px;background:rgba(224,49,49,1);color:#fff;' +
            'outline:none;font-size:10px;line-height:16px;text-align:center;cursor:pointer;' +
            'box-shadow:0 0 0 2px rgba(255,255,255,.9),0 0 6px 1px rgba(224,49,49,.55);' +
            'z-index:2;display:block;user-select:none;font-weight:900;' +
          '}',
          'html[data-ctx-mon-autoretry=paused] [data-dsh-flash-trigger] [data-ctx-mon-rearm]:hover,' +
          'html[data-ctx-mon-autoretry=paused] [data-dsh-flash-trigger] [data-ctx-mon-rearm]:focus{' +
            'background:rgba(47,158,68,1);box-shadow:0 0 0 2px rgba(255,255,255,.9),0 0 8px 2px rgba(47,158,68,.7);' +
          '}',
        ].join('\n')
        document.head.appendChild(style)
        _autoRetryIndicatorStyle = style
      } catch (e) {
        console.error('[dsh-flash-ctx-mon] failed to inject auto-retry indicator style:', e)
      }
    }

    /** Mirror an auto-retry view onto the <html> root so the cross-plugin
     *  stylesheet can drive the flash icon. Also reaches into dsh-flash's own
     *  trigger button(s) to update the numeric attempt hint title, which is the
     *  lightest way to surface "2/10" without fighting dsh-flash's badge slot.
     *  No-op for non-armed/stopped states (clears everything). */
    function _syncAutoRetryDomIndicator(view) {
      if (typeof document === 'undefined' || !document.documentElement) return
      var root = document.documentElement
      var state = view && view.state
      if (!state || state === 'stopped') {
        _placeAutoRetryRearm(false)
        root.removeAttribute('data-ctx-mon-autoretry')
        root.removeAttribute('data-ctx-mon-autoretry-attempt')
        try { root.style.removeProperty('--ctxmon-ratio') } catch (_) {}
        try {
          var dead = document.querySelectorAll('[data-ctx-mon-autoretry-attempt]')
          for (var d = 0; d < dead.length; d++) {
            dead[d].removeAttribute('data-ctx-mon-autoretry-attempt')
            dead[d].removeAttribute('title')
          }
        } catch (_) {}
        return
      }
      if (state !== 'armed' && state !== 'scheduled' && state !== 'paused') return
      _ensureAutoRetryIndicatorStyle()
      root.setAttribute('data-ctx-mon-autoretry', state)
      _placeAutoRetryRearm(state === 'paused')
      var idx = (view && view.attemptIndex) || 0
      var max = (view && view.maxConsecutive) || 0
      var label = max > 0 ? (idx + '/' + max) : ('attempt ' + idx)
      root.setAttribute('data-ctx-mon-autoretry-attempt', label)
      var ratio = max > 0 ? Math.min(1, idx / max) : 0
      try { root.style.setProperty('--ctxmon-ratio', String(ratio)) } catch (_) {}
      // Stamp the numeric readout onto dsh-flash's own trigger button(s) as a
      // data attribute the stylesheet turns into the `::after` badge, and set
      // the title hint so hovering the glow explains it. Re-stamping is cheap.
      try {
        var btns = document.querySelectorAll('[data-dsh-flash-trigger]')
        var suffix = t('autoRetryHint') || 'auto-continue active'
        var hint = suffix
        for (var i = 0; i < btns.length; i++) {
          btns[i].setAttribute('data-ctx-mon-autoretry-attempt', label)
          btns[i].setAttribute('title', hint)
        }
      } catch (_) {}
    }

    /** Inject (or remove) the small re-arm chip pinned to the bottom-right corner
     *  of the resident flash trigger icon. It exists ONLY while the guard is
     *  parked at `paused` (consecutive budget exhausted): clicking (or
     *  Enter/Space on) it is an explicit user re-arm that re-seeds the budget and
     *  flips the ring back to green (armed). Pure CSS cannot host the click, so
     *  the chip — a real role=button element — is created/removed here on every
     *  publish, and removed again on dispose. */
    function _placeAutoRetryRearm(paused) {
      if (typeof document === 'undefined' || !document.querySelectorAll) return
      try {
        function rearm() { try { _armAutoRetry(true) } catch (_) {} }
        var hosts = document.querySelectorAll('[data-dsh-flash-trigger]')
        for (var i = 0; i < hosts.length; i++) {
          var host = hosts[i]
          var chip = host && host.querySelector ? host.querySelector('[data-ctx-mon-rearm]') : null
          if (!paused) {
            if (chip && chip.remove) chip.remove()
            continue
          }
          if (chip) continue
          chip = document.createElement('span')
          chip.setAttribute('data-ctx-mon-rearm', '1')
          chip.setAttribute('role', 'button')
          chip.setAttribute('tabindex', '0')
          chip.setAttribute('aria-label', _alertStr('autoRetryRearmHint'))
          chip.textContent = '↻'
          chip.title = _alertStr('autoRetryRearmHint')
          chip.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); rearm() })
          chip.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); rearm() }
          })
          host.appendChild(chip)
        }
      } catch (_) {}
    }

    /** Remove the injected indicator stylesheet and all root-level marks. */
    function _clearAutoRetryDomIndicator() {
      _placeAutoRetryRearm(false)
      if (_autoRetryIndicatorStyle) {
        try { _autoRetryIndicatorStyle.remove() } catch (_) {}
        _autoRetryIndicatorStyle = null
      }
      if (typeof document !== 'undefined' && document.documentElement) {
        var root = document.documentElement
        root.removeAttribute('data-ctx-mon-autoretry')
        root.removeAttribute('data-ctx-mon-autoretry-attempt')
        try { root.style.removeProperty('--ctxmon-ratio') } catch (_) {}
      }
      try {
        var btns = document.querySelectorAll('[data-ctx-mon-autoretry-attempt]')
        for (var i = 0; i < btns.length; i++) {
          btns[i].removeAttribute('data-ctx-mon-autoretry-attempt')
          btns[i].removeAttribute('title')
        }
      } catch (_) {}
    }

    /** Re-paint the auto-continue numeric badge / re-arm chip onto dsh-flash's
     *  trigger button(s) after the DOM changed underneath us.
     *
     *  dsh-flash reparents/rebuilds its `[data-dsh-flash-trigger]` element when
     *  the trigger position changes (`applyTrigger()` unmounts + remounts the
     *  button). Because we stamp the `::after` badge as a data attribute on that
     *  element and pin the paused re-arm chip INSIDE it, a rebuild silently
     *  drops both — and nothing re-publishes the auto-retry view, so the badge
     *  would stay gone until the next publish. This observer watches for that
     *  specific rebuild and re-runs the stamping with the latest view. */
    var _triggerRepaintObserver = null
    var _triggerRepaintPending = false

    /** True when a MutationRecord mounts, unmounts or moves a trigger element. */
    function _isTriggerMutation(m) {
      function isTriggerNode(n) {
        if (!n || n.nodeType !== 1) return false
        return !!(n.hasAttribute && n.hasAttribute('data-dsh-flash-trigger')) ||
          !!(n.querySelector && n.querySelector('[data-dsh-flash-trigger]'))
      }
      // Only direct add/remove/move of a trigger root counts as a rebuild; a
      // chip we pin INSIDE the trigger mutates the same parent (target) but must
      // not re-trigger a repaint — adding that would just converge, yet wastes a
      // frame. So we inspect added/removed nodes only, never m.target.
      if (m.addedNodes) for (var a = 0; a < m.addedNodes.length; a++) { if (isTriggerNode(m.addedNodes[a])) return true }
      if (m.removedNodes) for (var r = 0; r < m.removedNodes.length; r++) { if (isTriggerNode(m.removedNodes[r])) return true }
      return false
    }

    function _syncTriggerRepaint() {
      _triggerRepaintPending = false
      if (typeof document === 'undefined') return
      var src = _activeTokenSource
      var view = (src && typeof src.getAutoRetryView === 'function') ? src.getAutoRetryView() : null
      try { _syncAutoRetryDomIndicator(view) } catch (_) {}
    }

    /** Start observing rebuilds of dsh-flash's trigger button(s). Idempotent —
     *  safe to call on every apply. Only reacts to `[data-dsh-flash-trigger]`
     *  node add/remove (a position switch unmounts and remounts the button),
     *  debounced to one re-paint per mutation burst. */
    function _ensureTriggerRepaintObserver() {
      if (typeof document === 'undefined' || !document.body || !document.body.isConnected) return
      if (_triggerRepaintObserver || typeof MutationObserver === 'undefined') return
      try {
        _triggerRepaintObserver = new MutationObserver(function (records) {
          if (_triggerRepaintPending) return
          for (var i = 0; i < records.length; i++) {
            if (_isTriggerMutation(records[i])) {
              _triggerRepaintPending = true
              if (typeof requestAnimationFrame === 'function') requestAnimationFrame(_syncTriggerRepaint)
              if (typeof setTimeout === 'function') setTimeout(_syncTriggerRepaint, 50)
              break
            }
          }
        })
        _triggerRepaintObserver.observe(document.body, { childList: true, subtree: true })
      } catch (_) { _triggerRepaintObserver = null }
    }

    /** Stop the trigger-rebuild observer. Called on dispose. */
    function _stopTriggerRepaintObserver() {
      if (_triggerRepaintObserver) {
        try { _triggerRepaintObserver.disconnect() } catch (_) {}
        _triggerRepaintObserver = null
      }
      _triggerRepaintPending = false
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Open-turn ledger backing the auto-continue path (§8, form ①).
    //
    // A session whose turn STARTED but then closed WITHOUT a user-cancel
    // (i.e. it ended via `interrupted` / `error` / `max-tokens`, NOT `aborted`)
    // is eligible for an automatic one-time continue ("方案 A"). The ledger
    // below records open turns from turn/start → turn/end so we can tell an
    // interrupted-but-closed turn from one that is merely still running.
    // docs/detecting-unfinished-session.zh-CN.md.
    //
    // The red count-pill reminder UI has been REMOVED per decision: this bridge
    // still exists as a data path, but it never paints a badge or pill and only
    // ever contributes to deciding whether to auto-continue. Publish while the
    // bridge is null is a no-op.
    var _unsettledStore = null
    var _unsettledIndicatorStyle = null

    /** The unsettled (open-turn) reminder UI has been REMOVED per decision
     *  (compact-summary): no red count pill, no badge, no title tooltip is
     *  painted anywhere. The overlay remains a pure continuation primitive —
     *  it never surfaces a "N turns left open" reminder, because a bare
     *  reminder with no auto-continue merely tells the human about an
     *  unsettled bill and invites a wasted "继续" click. The three helpers
     *  below are kept ONLY as idempotent clean-up so any stale marks left on
     *  <html> / buttons by an older installed version are swept away; they
     *  never create a style element nor stamp a count. `_unsettledIndicatorStyle`
     *  stays null forever. */
    function _ensureUnsettledIndicatorStyle() {
      /* Intentionally inert: the red pill stylesheet is deleted (§§decision). */
    }

    /** No-op mirror. Kept for disposal symmetry; never paints or reads.
     *  Callers (install/prime/event loops) must not depend on DOM effects. */
    function _syncUnsettledDomIndicator(view) {
      /* Inert: no DOM indicator is ever painted. */
    }

    /** Sweep any legacy `data-ctx-mon-unsettled*` marks left by older builds. */
    function _clearUnsettledDomIndicator() {
      if (_unsettledIndicatorStyle) {
        try { _unsettledIndicatorStyle.remove() } catch (_) {}
        _unsettledIndicatorStyle = null
      }
      if (typeof document !== 'undefined' && document.documentElement) {
        try {
          var root = document.documentElement
          root.removeAttribute('data-ctx-mon-unsettled')
          var dead = document.querySelectorAll('[data-ctx-mon-unsettled-count]')
          for (var i = 0; i < dead.length; i++) {
            dead[i].removeAttribute('data-ctx-mon-unsettled-count')
            dead[i].removeAttribute('title')
          }
        } catch (_) {}
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // "Session exited auto-continue" info alert (data-layer → provider channel).
    //
    // When the CURRENT session leaves
    // an active auto-continue state (armed/scheduled/paused → stopped) for a
    // user-relevant reason (manual stop / settled turn / budget
    // exhausted), the runner records the exit and the alert provider surfaces it
    // ONCE as an info alert naming the reason. Also module scope so the
    // "don't nag again" cooldown survives a source stop/start cycle on re-bind.
    var _autoRetryExitedPending = null
    /** last-alerted timestamp per sessionId, to stop re-nagging. */
    var _autoRetryExitedAt = Object.create(null)
    /** How long to wait before alerting again for the same session (ms). */
    var AUTO_RETRY_EXIT_COOLDOWN_MS = 60000
    /** Exit reasons that warrant a user-facing info alert. Anything else
     *  (internal stand-downs — no session; a manual "stop" which is an obvious
     *  user-initiated action) carries no informative value and stays silent. A
     *  normal settled turn is, per the restored product decision in
     *  _handleTurnEnd, a real stand-down exit that pauses the session's
     *  auto-continue — so it alerts. Three reasons remain: consecutive-budget
     *  exhaustion, a host-rejected auto-continue prompt, and a normal settled
     *  completion — the first two leave auto-continue without the user acting
     *  and the last visibly pauses this session, so a toast naming the cause is
     *  genuinely useful. */
    var AUTO_RETRY_EXIT_REASONS = ['budget', 'prompt-failed', 'settled']

    // ─────────────────────────────────────────────────────────────────────────
    // "Turn-ending judgement" info alert (session-event → provider channel).
    //
    // Pure local rule-based classification of how the CURRENT session's most
    // recent turn came to an end (normal / error / interrupted / max-tokens /
    // awaiting-answer / handoff-stub). The `turn/end` handler records ONE
    // pending judgement; the alert provider claims it on the next poll and
    // surfaces it ONCE as an info toast. Every judgement carries a unique id
    // (the turn-end wall-clock), so — unlike a stable id — it can never be
    // re-toasted after registry eviction, and claiming nulls it so a single
    // turn/end never restarts the notice.
    var _turnVerdictPending = null

    /**
     * Classify how a settled turn ended, purely from its `turn/end` reason and
     * the assistant tail text. Mirrors the reason taxonomy already used by the
     * auto-retry primitives (`isRetryableEnd` / `isHandoffStub` /
     * `textHasQuestionMark`) so the two surfaces agree on terminology.
     * Returns a verdict record or null (nothing informative to report).
     */
    function _classifyTurnEnd(reason, lastText) {
      var kind = reason && reason.kind
      if (kind === 'error') {
        var failure = reason.error
        var code = failure && failure.code ? String(failure.code) : null
        return { verdictKey: 'turnVerdictError', detail: code }
      }
      if (kind === 'interrupted') return { verdictKey: 'turnVerdictInterrupted', detail: null }
      if (kind === 'max-tokens') return { verdictKey: 'turnVerdictMaxTokens', detail: null }
      if (textHasQuestionMark(lastText)) return { verdictKey: 'turnVerdictQuestion', detail: null }
      if (isHandoffStub(lastText)) return { verdictKey: 'turnVerdictHandoff', detail: null }
      return { verdictKey: 'turnVerdictNormal', detail: null }
    }

    /**
     * SessionEventTokenSource — reads precise token usage from DSH's session
     * event stream via the `sessions` service.
     *
     * Returns an object with:
     *   start(ctx)           — subscribe to session events
     *   stop()               — unsubscribe and reset
     *   getTokenEstimate()   — { pressureTokens, inputTokens, outputTokens,
     *                            cacheReadTokens, cacheWriteTokens, reasoningTokens,
     *                            contextWindow, model, source }
     *
     * DSH's TokenUsage counts are DISJOINT: inputTokens is uncached input only;
     * cached input is cacheReadTokens + cacheWriteTokens.  The "context pressure"
     * (how much of the context window is occupied) is therefore:
     *   pressureTokens = inputTokens + cacheReadTokens + cacheWriteTokens
     *
     * We track the LATEST usage from each assistant/message event (last-wins),
     * NOT an accumulation, because each event reports the FULL input for that
     * request.  Accumulating would double-count cached tokens that were already
     * present in earlier requests.
     */
    function createSessionEventTokenSource() {
      var _unsubscribe = null
      var _listUnsubscribe = null
      var _lastUsage = null   // latest usage from the most recent assistant/message
      /** Text of the latest assistant output for the CURRENT session. Kept so a
       *  turn/end can decide whether the model only promised work ("让我 / 让我来
       *  / let me …") and stopped — a handoff stub is treated as retryable even
       *  when the end reason itself is not an error/interrupt/max-tokens. Reset
       *  on session switch so one session cannot read another's tail. */
      var _lastAssistantText = null
      var _lastProcessedSeq = -1
      var _model = null
      var _contextWindow = null
      /** The model `_contextWindow` was resolved FOR. A window is only valid
       *  for the model it came from: switching models mid-session must discard
       *  it rather than size the new model's pressure against the old model's
       *  window. Null means the cached value has no model behind it. */
      var _contextWindowModel = null
      /** Pending window-mismatch record: set in request/context when the
       *  adapter's authoritative contextWindow disagrees with the
       *  user-mapped/config window for the same model. Surfaced as an explicit
       *  alert rather than a silent override. Null when they agree. */
      var _windowMismatch = null
      /** Models whose window-mismatch alert the user chose to IGNORE this
       *  session. Session-scoped by design: the request/context window is
       *  authoritative and non-persisted, so there is nothing durable to record
       *  — and an ignored model must not be silently re-alerted while the
       *  mismatch holds, but a fresh session should surface it again. */
      var _mismatchIgnored = Object.create(null)
      var _sessions = null
      var _sessionId = null
      // Session id fed from the rendered panel (slot `props.sessionId`). The
      // host does not expose a counting-host `sessions.list`/`scopeOf` store to
      // enumerate the active session from, so the runner binds to the session
      // the UI is actually rendering for instead of guessing one.
      var _boundSessionId = null
      var _ctx = null       // Cordis context for preference writes (set in start)
      var _bindRetryTimer = null
      var _bindRetryCount = 0
      var _serviceRetryTimer = null   // persistent sessions-service retry (the service may register a beat late)

      // ─────────────────────────────────────────────────────────────────────
      // Auto-retry / auto-continue runner state (§6 of the design).
      //
      // The stateful AutoRetryRunner is composed INLINE against this token
      // source so it can reuse _sessions/_sessionId/_ctx and call
      // `session.prompt(...)` directly. State is isolated per session id; the
      // persistent overlay drives it through the methods exposed on the
      // returned object (armAutoRetry / disarmAutoRetry / getAutoRetryView).
      var _retryBySession = Object.create(null)  // sessionId -> runner record
      var _retryRequestIdCache = new Map()       // per-session attempt keys -> requestIds (idempotent re-send)
      var _retryTimer = null                     // single emission timer (one-at-a-time guard)

      // ─────────────────────────────────────────────────────────────────────
      // Per-session auto-continue persistence (§"保存自动继续状态").
      //
      // The armed/stopped state of each session is remembered in localStorage
      // so that switching away from a session (or reloading the page) does not
      // silently reset the user's choice. The map stores, per session id,
      // whether auto-continue was last left ARMED (true), DISARMED (false), or
      // unknown (missing). A session with no stored entry falls back to the
      // default (not armed), preserving the pre-existing behaviour.
      //
      // A stored `true` (armed) is what must survive switching away / reloading.
      // A `false` (disarmed) and a missing entry are semantically identical
      // (both mean "do not auto-arm"), so disarm DROPS the key instead of
      // keeping a stale entry — archived/closed sessions never accumulate.
      /** Symmetric read of the persisted per-session map. Returns the parsed
       *  map (possibly empty) when a value is stored, or null when the key is
       *  missing or not valid JSON — callers treat that as "nothing persisted"
       *  and fall back to the default (not armed). */
      function _readAutoRetryPref() {
        try {
          var raw = localStorage.getItem(AUTORETRY_SESSION_KEY)
          if (raw == null) return null
          var parsed = JSON.parse(raw)
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : null
        } catch (_) {
          return null
        }
      }
      function _writeAutoRetryPref(sessionId, armed) {
        try {
          const next = applyAutoRetryPref(_readAutoRetryPref(), sessionId, armed)
          if (next) {
            localStorage.setItem(AUTORETRY_SESSION_KEY, JSON.stringify(next))
          } else {
            localStorage.removeItem(AUTORETRY_SESSION_KEY)
          }
        } catch (_) {}
      }
      /** Whether a session should be re-armed on bind: true only if the user
       *  last left it armed (an explicit stored "true"). Missing entry and a
       *  stored "false" both mean don't auto-arm. */
      function _wasAutoRetryArmed(sessionId) {
        return isPersistenceArmed(_readAutoRetryPref(), sessionId)
      }

      // ─────────────────────────────────────────────────────────────────────
      // Open-turn ledger & watchdog (form ① detection — "turn started but no
      // closing turn/end ever arrived" — docs/detecting-unfinished-session.zh-CN.md).
      //
      // The LEDGER records each turn/start on the tracked session and retires
      // the OLDEST open turn when a turn/end finally arrives (FIFO, isolated
      // per session id). It only FLAGS "unsettled yet stopped" residuals; it
      // never auto-continues them — per the module contract a fresh notice is
      // reminder-only, because form ① may signal a host anomaly and blindly
      // re-prompting would repeatedly fail and bill tokens. All transitions
      // delegate to the pure helpers in ./unfinished-turn.js so this block
      // stays thin and directly unit-tested.
      var _openTurnLedger = makeLedger()

      // ─ AutoRetryRunner — the inline stateful core (§6 of the design) ──────
      // All decisions are delegated to the pure helpers in ./auto-retry.js so
      // this block stays thin and testable. The record for the active session
      // lives in _retryBySession; every transition writes it back through the
      // pure state constructors, then republishes a snapshot to the module-
      // level _autoRetryStore bridge (created by the UI layer) so the overlay
      // never needs to know about timers.

      function _retryTimersClear() {
        if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null }
      }

      /** The runner record for the currently bound session, if any. */
      function _activeAutoRetryRecord() {
        if (!_sessionId) return null
        return _retryBySession[_sessionId] || null
      }

      /** Best-effort workspace (cwd) cache, keyed by session id, populated
       *  asynchronously from the host `remote.session` namespace (which this
       *  host exposes instead of a counting-host `sessions.list.byId`). */
      var _workspaceBySession = Object.create(null)

      function _refreshWorkspaces() {
        if (!_ctx) return
        var remote = null
        try { remote = resolveRemoteNamespace(_ctx, 'session') } catch (_) {}
        if (!remote || typeof remote.list !== 'function') return
        var signal = (typeof AbortController !== 'undefined') ? new AbortController().signal : undefined
        Promise.resolve(remote.list({}, signal)).then(function (result) {
          var items = result && result.value ? result.value : result
          var rows = null
          if (items && Array.isArray(items.items)) rows = items.items
          else if (Array.isArray(items)) rows = items
          if (!rows) return
          for (var i = 0; i < rows.length; i++) {
            var row = rows[i]
            if (!row) continue
            var id = row.id
            var cwd = null
            if (row.header && typeof row.header.cwd === 'string') cwd = row.header.cwd
            else if (typeof row.cwd === 'string') cwd = row.cwd
            if (id && cwd) _workspaceBySession[id] = cwd
          }
        }).catch(function () {})
      }

      /** Resolve the workspace (cwd) for a session id from the host-backed
       *  cache, or null when unknown yet. Used to let the "exited auto-continue"
       *  alert name the workspace the user is working in, so it is easy to
       *  locate on switch-back. */
      function _sessionWorkspace(sessionId) {
        if (!sessionId) return null
        var cwd = _workspaceBySession[sessionId]
        return (typeof cwd === 'string' && cwd) ? cwd : null
      }

      /** Human-friendly basename of a filesystem path (handles both `/` and
       *  `\` separators, so Windows cwd paths collapse to their last segment).
       *  Used to name the workspace in the "exited auto-continue" alert. */
      function _pathBase(p) {
        if (typeof p !== 'string' || !p) return p
        var parts = p.split(/[\\/]+/)
        for (var i = parts.length - 1; i >= 0; i--) {
          if (parts[i]) return parts[i]
        }
        return p
      }

      /** Human-friendly display name for a session id, resolved from the
       *  sessions controller's `SessionSummary.displayTitle` (durable title →
       *  project basename → session id). Returns null when the session list is
       *  not yet available or the summary has no usable title; callers then
       *  fall back to the raw session id. */
      function _sessionDisplayTitle(sessionId) {
        if (!sessionId) return null
        try {
          var snap = _sessions && _sessions.list && typeof _sessions.list.getSnapshot === 'function' ? _sessions.list.getSnapshot() : null
          var row = snap && snap.byId ? snap.byId[sessionId] : null
          if (row && typeof row.displayTitle === 'string' && row.displayTitle) return row.displayTitle
          if (row && typeof row.title === 'string' && row.title) return row.title
        } catch (_) {}
        return null
      }

      /** Record that the bound session just left active auto-continue, so the
       *  alert provider can surface ONE info toast naming the reason. Only the
       *  reasons in AUTO_RETRY_EXIT_REASONS alert (budget exhaustion — paused
       *  with no user action; prompt-failed — a rejected auto-continue that the
       *  user never saw; a manual stop is self-evident); per-session cooldown
       *  (mirrors the continue-offer) stops rapid re-entry/exits from spamming. */
      function _noteAutoRetryExit(reason) {
        if (AUTO_RETRY_EXIT_REASONS.indexOf(reason) < 0) return
        var sid = _sessionId
        if (!sid) return
        var now = Date.now()
        var last = _autoRetryExitedAt[sid]
        if (typeof last === 'number' && now - last < AUTO_RETRY_EXIT_COOLDOWN_MS) return
        _autoRetryExitedAt[sid] = now
        _autoRetryExitedPending = {
          sessionId: sid,
          reason: reason,
          at: now,
          workspace: _pathBase(_sessionWorkspace(sid)),
          sessionName: _sessionDisplayTitle(sid),
        }
      }

      /** Drop the guard entirely: stop any pending emission and forget the
       *  session's consecutive budget. Used on genuine human input (§5.5),
       *  on non-retryable turn/end, on a manual disarm, and on a
       *  host-rejected auto-continue prompt. Budget exhaustion and a rejected
       *  prompt surface a visible info alert (via _noteAutoRetryExit in
       *  _handleTurnEnd / _failAutoContinuePrompt); a manual disarm, being an
       *  explicit user action, is not re-announced. */
      function _disarmAutoRetry(reason) {
        _retryTimersClear()
        if (_sessionId && _retryBySession[_sessionId]) {
          var rec = _retryBySession[_sessionId]
          var wasActive = !!(rec && rec.armed)
          delete _retryBySession[_sessionId]
          // The guard was dropped for a real reason (manual disarm, genuine
          // human input, or a non-retryable end). Drop the persisted choice
          // for this session so a later bind does not unexpectedly re-arm it —
          // a dropped key and a stored `false` are equivalent (both "don't
          // auto-arm"), but dropping keeps archived sessions from accumulating.
          _writeAutoRetryPref(_sessionId, false)
          if (wasActive) _noteAutoRetryExit(reason)
        }
        _publishAutoRetryView()
      }

      /** Warm-arm the guard for the current session with a fresh budget.
       *  Safe to call repeatedly: the budget is only re-seeded when the
       *  record is missing or disarmed. When `force` is true (an explicit
       *  USER action — flipping the quick switch ON or typing a bare continue
       *  word), a budget-frozen record (armed yet `paused`, remaining 0) is
       *  re-seeded with a fresh budget and un-frozen, so a human can always
       *  re-open auto-continue after it parked for the burn limit. The
       *  internal paths (`_handleTurnEnd` retryable re-arm and the persisted
       *  choice restore) call WITHOUT force so they never resurrect a parked
       *  session on their own — the budget-pause safety gate stays closed
       *  until the user explicitly opts back in. */
      function _armAutoRetry(force) {
        if (!_sessionId) {
          // A manual arm must never SILENTLY no-op just because the runner
          // lost its session binding — the most common cause of the quick
          // switch appearing to "not turn on":
          //   - the SkillChip mounted before the provider had created the
          //     token source (its setSessionId effect then skipped the bind
          //     and, with deps `[sessionId]`, never re-ran), or
          //   - the provider was stopped/restarted, which nulls _sessionId.
          // Re-derive the open session synchronously and bind before arming
          // (same discovery _tryBindSession uses), so flipping the switch
          // works the moment a session is materialized.
          var recovered = _findMaterializedSession()
          if (recovered) {
            _boundSessionId = recovered
            _sessionId = recovered
            _bindToSession()
          } else {
            console.warn('[dsh-flash-ctx-mon] auto-continue arm skipped: no bound/open session in the UI')
            _publishAutoRetryView()
            return
          }
        }
        var rec = _activeAutoRetryRecord()
        var now = Date.now()
        if (!rec || !rec.armed) {
          var budget = _alertPref('autoRetryMaxConsecutive')
          _retryBySession[_sessionId] = armState(
            makeDisarmedState(),
            _sessionId,
            typeof budget === 'number' && budget > 0 ? budget : 0,
            now,
          )
        } else if (force && rec.paused) {
          // User explicitly re-opened a budget-parked session: reset the budget
          // and clear paused so it can run the consecutive limit again. Backoff
          // level is dropped so the next continue starts from the grace delay.
          var fresh = _alertPref('autoRetryMaxConsecutive')
          _retryBySession[_sessionId] = armState(
            Object.assign({}, rec, {
              paused: false,
              pending: false,
              nextEmitAtMs: null,
              backoffLevel: 0,
              cooldownUntil: null,
              remaining: typeof fresh === 'number' && fresh > 0 ? fresh : 0,
              lastRequestId: null,
              echoedAt: null,
            }),
            _sessionId,
            typeof fresh === 'number' && fresh > 0 ? fresh : 0,
            now,
          )
        }
        // Persist the choice: this session is now armed, so switching away
        // then back (or reloading) must restore it instead of resetting it.
        _writeAutoRetryPref(_sessionId, true)
        _publishAutoRetryView()
      }

      /** First text fragment of a content entry (may be an array of blocks or
       *  a raw string). Used to match the self-echo exactly. */
      function _firstTextOf(content) {
        if (content == null) return null
        if (typeof content === 'string') return content
        if (Array.isArray(content)) {
          for (var i = 0; i < content.length; i++) {
            var part = content[i]
            if (part == null) continue
            if (typeof part === 'string') return part
            if (part && typeof part.text === 'string') return part.text
            if (part && typeof part.content === 'string') return part.content
          }
          return null
        }
        if (typeof content === 'object' && typeof content.text === 'string') return content.text
        return null
      }

      /** Resolve the live session object for the bound id through every shape
       *  the sessions service has exposed across DSH releases. Returns null
       *  when no prompt-capable session is reachable (caller must fall back). */
      function _resolveAutoSession() {
        if (!_sessions || !_sessionId) return null
        var candidates = []
        try {
          if (_sessions.sessions && _sessions.sessions[_sessionId]) candidates.push(_sessions.sessions[_sessionId])
        } catch (_) {}
        try {
          var binding = _sessions.binding(_sessionId)
          if (binding && binding.session) candidates.push(binding.session)
          if (binding && typeof binding.prompt === 'function') candidates.push(binding)
        } catch (_) {}
        try {
          if (typeof _sessions.get === 'function') candidates.push(_sessions.get(_sessionId))
        } catch (_) {}
        for (var i = 0; i < candidates.length; i++) {
          var s = candidates[i]
          if (s && typeof s.prompt === 'function') return s
        }
        return null
      }

      /** Cont-safe one-at-a-time dispatch of the auto-continue. Runs on the
       *  guarded emitter; everything is best-effort and never rethrows. */
      function _autoContinueEntry() {
        _retryTimer = null
        var rec = _activeAutoRetryRecord()
        if (!rec || !rec.armed || rec.paused || !(rec.remaining > 0)) return
        var session = _resolveAutoSession()
        if (!session) {
          // Cannot reach a session: silently stand down rather than spin.
          console.warn('[dsh-flash-ctx-mon] auto-continue: no prompt-capable session for ' + _sessionId + ' — disarming')
          _disarmAutoRetry('internal')
          return
        }
        var now = Date.now()
        // The sent text is read live from prefs so what is echoed back and
        // what the self-echo detector expects always agree (§5.4).
        var continueText = _alertStr('autoRetryContinueText')
        if (!continueText) { _disarmAutoRetry('internal'); return }
        var attemptSeq = rec.maxConsecutive - rec.remaining + 1
        var requestId = requestIdForAttempt(
          _retryRequestIdCache,
          retryAttemptKey(_sessionId, attemptSeq),
          function () {
            return 'auto-retry-' + _sessionId + '-' + attemptSeq + '-' + String(now)
          },
        )
        var emitted = false
        // PRIMARY — DeepSeek Harness host contract: the `sessionController`
        // service backs the generated `remote.session` namespace, whose
        // `prompt({requestId, sessionId, mode, content})` remote admits one
        // prompt after explicitly resuming its Session. The counting/dsh-
        // dashboard host's per-session `session.prompt(entries, {source})`
        // shape does NOT exist here; sending that shape made the typert
        // gateway reject the `request` wire field as boundary-invalid
        // (`gateway/input-invalid`). Dispatch through the host namespace with
        // the schema it actually validates against.
        var hostSession = resolveRemoteNamespace(_ctx, 'session')
        if (hostSession && typeof hostSession.prompt === 'function') {
          try {
            // `requestId` is the client-minted, host-revalidated identity from
            // requestIdForAttempt above. The host echoes it back on the
            // admitted user/message entry (as its rpc identity), which is how
            // the self-echo detector proves the message is ours (§8.4) — no
            // change needed to the detector.
            var signal = (typeof AbortController !== 'undefined') ? new AbortController().signal : undefined
            emitted = true
            Promise.resolve(hostSession.prompt({
              requestId: requestId,
              sessionId: _sessionId,
              mode: 'queue',
              content: [{ type: 'text', text: continueText }],
            }, signal)).then(function (res) {
              if (res && res.ok === false) {
                var re = (res.error && ((res.error.code || 'failed') + (res.error.message ? ': ' + res.error.message : ''))) || JSON.stringify(res.error) || 'unknown'
                console.warn('[dsh-flash-ctx-mon] auto-continue RPC rejected: ' + re)
                _failAutoContinuePrompt(requestId, re)
              }
            }).catch(function (e) {
              console.warn('[dsh-flash-ctx-mon] auto-continue RPC threw:', e)
              var ed = (e && (e.message || e.code)) || e
              _failAutoContinuePrompt(requestId, ed ? String(ed) : 'unknown')
            })
          } catch (err) {
            emitted = false
            console.warn('[dsh-flash-ctx-mon] auto-continue prompt failed:', err)
          }
        } else {
          // FALLBACK — legacy counting-host per-session prompt shapes, kept for
          // hosts that still expose the old `sessions` adaptor surface.
          try {
            var source = { kind: 'user', rpcId: requestId, autocontinue: true }
            // The injected prompt returns into the conversation log as a
            // user/message entry whose source carries the same rpcId — that is
            // how the self-echo detector proves it is ours (§8.4).
            if (session.prompt.length >= 2) {
              session.prompt([{ type: 'text', text: continueText }], { source: source })
            } else {
              session.prompt({ content: [{ type: 'text', text: continueText }], source: source })
            }
            emitted = true
          } catch (err) {
            console.warn('[dsh-flash-ctx-mon] auto-continue prompt failed:', err)
          }
        }
        rec.lastRequestId = requestId
        rec.lastSendAt = now
        rec.echoedAt = null
        // Spend one slot, raise the backoff level and open the cooldown.
        var next = consumeContinuation(rec, now, _alertPref('autoRetryCooldownMs'))
        next.pending = false
        next.nextEmitAtMs = null
        _retryBySession[_sessionId] = next
        _publishAutoRetryView()
        if (!emitted) _disarmAutoRetry('internal')
      }

      /** Async stand-down when the host rejects an auto-continue prompt. The
       *  primary path optimistically sets `emitted` and returns to armed before
       *  the RPC settles, so if the host then refuses the queued "继续" the
       *  failure would otherwise be swallowed (only a console.warn) while the
       *  guard silently turns green with a spent budget — the exact `scheduled →
       *  green with no 继续` symptom. On a real rejection we drop the guard
       *  (→ stopped, per design §4 "prompt 失败" stands down) and surface one
       *  visible info alert naming the cause. Only acts when the record still
       *  matches the requestId this attempt sent, so a late failure of a
       *  superseded attempt cannot kill a newer scheduled emission. */
      function _failAutoContinuePrompt(requestId, detail) {
        try {
          var rec = _activeAutoRetryRecord()
          if (!rec || !rec.armed || rec.lastRequestId !== requestId) return
          _disarmAutoRetry('prompt-failed')
          if (detail && _autoRetryExitedPending) _autoRetryExitedPending.detail = detail
        } catch (_) {}
      }

      /** Schedule the guarded emission for the armed session. Backoff is
       *  purely derived from the record's level; the one-at-a-time timer
       *  guard means a second retryable end while already scheduled just
       *  reschedules (cooldown exempt), it can never queue emissions. */
      function _scheduleAutoRetryEmit() {
        _retryTimersClear()
        var rec = _activeAutoRetryRecord()
        if (!rec || !rec.armed || rec.paused) return
        var now = Date.now()
        if (inCooldown(rec.cooldownUntil, now)) {
          // Cooldown window open — stay armed but idle; the next retryable
          // end will re-arm the schedule once the window clears.
          rec.pending = false
          rec.nextEmitAtMs = null
          _publishAutoRetryView()
          return
        }
        var delay = backoffDelayMs(
          _alertPref('autoRetryGraceMs'),
          rec.backoffLevel,
          _alertPref('autoRetryMaxBackoffMs'),
        )
        rec.pending = true
        rec.nextEmitAtMs = now + delay
        _retryTimer = setTimeout(function () { _autoContinueEntry() }, Math.max(0, delay))
        _publishAutoRetryView()
      }

      /** turn/end hook: a retryable end (error / interrupted / max-tokens, or a
       *  handoff-stub tail "让我 / 让我来 / let me …" with nothing after it,
       *  §5.1 + handoff-stub fallback) arms the guard and schedules a continue.
       *  Product decision (restored 2026-11-20, reversing 2026-11-14): a NORMAL
       *  settled completion IS again a stand-down exit condition. If the guard
       *  is already armed (and not frozen) the settled turn disarms it, so the
       *  session's auto-continue pauses until the user re-opens it, and an exit
       *  alert names that the current session paused its auto-continue. An
       *  UNARMED session's normal completion stays unarmed: a plain finished
       *  turn is never passively armed (the user still opts in by typing a
       *  continue word, or by a retryable failure). A question-ending (the model
       *  asked something) keeps the guard armed and only skips this turn's
       *  auto-continue while it waits for the user's answer (§5.6). */
      function _handleTurnEnd(reason) {
        try {
          var turnRetryable = isRetryableEnd(reason) || isHandoffStub(_lastAssistantText)
          // The model's last output asks a question → this turn ends by handing
          // off to the user for an answer. Skip the automatic "继续" this turn
          // and wait for their feedback; the guard stays armed so a later
          // turn/end resumes auto-continue normally (§5.6 "question ending").
          var mustWaitForAnswer = textHasQuestionMark(_lastAssistantText)
          if (turnRetryable) {
            _armAutoRetry()
          } else if (mustWaitForAnswer) {
            // Question ending: keep the guard armed and let the shared gate
            // below skip the emission this turn (frozen budgets stay frozen).
            var qrec = _activeAutoRetryRecord()
            if (!qrec || !qrec.armed) return
          } else {
            // Normal settled completion (no question): stand the guard down.
            // A settled turn pauses this session's auto-continue until the user
            // re-opens it; an armed guard is disarmed here, alerting once with
            // the reason. Never passively arms an unarmed session.
            var prearmed = _activeAutoRetryRecord()
            if (prearmed && prearmed.armed && !prearmed.paused) {
              _disarmAutoRetry('settled')
            } else {
              _publishAutoRetryView()
            }
            return
          }
          var rec = _activeAutoRetryRecord()
          if (!rec || !rec.armed || rec.paused) return
          if (rec.remaining <= 0) {
            // Budget exhausted: freeze at "paused" until a human takes over.
            // From the user's viewpoint auto-continue has stood down, so alert
            // once (cooldown-gated) with the budget reason.
            if (!rec.paused) {
              _retryBySession[_sessionId] = Object.assign({}, rec, { paused: true, pending: false, nextEmitAtMs: null })
              _retryTimersClear()
              _noteAutoRetryExit('budget')
            }
            _publishAutoRetryView()
            return
          }
          if (mustWaitForAnswer) {
            // Last output asks a question — do not auto-send "继续"; the user is
            // expected to answer. Keep the guard armed and just re-frame the
            // view so no emission is scheduled for this turn.
            _publishAutoRetryView()
            return
          }
          _scheduleAutoRetryEmit()
        } catch (e) {
          // Non-fatal: a throwing runner must never break the event loop.
          console.warn('[dsh-flash-ctx-mon] _handleTurnEnd error:', e)
        }
      }

      /** user/message hook: OUR OWN continue echoed back is matched exactly
       *  (rpcId + text + window, §5.4) so the guard's echo-tracking advances.
       *  Any other message is genuine human input — which per product decision
       *  does NOT stand the guard down: a human steering the conversation keeps
       *  auto-continue armed so a later retryable end still auto-continues. The
       *  guard only stands down on its own (turn settles, budget exhausts) or
       *  by an explicit "stop". */
      function _handleUserMessage(entry, time) {
        try {
          var rec = _activeAutoRetryRecord()
          if (!rec || !rec.armed) return
          var matched = isSelfEcho(
            entry,
            rec.lastRequestId,
            _alertStr('autoRetryContinueText'),
            _alertPref('autoRetryEchoWindowMs'),
            rec.lastSendAt,
            time,
          )
          if (matched) {
            if (rec.lastSendAt != null && time != null) {
              _retryBySession[_sessionId] = Object.assign({}, rec, { echoedAt: time })
            }
            return
          }
          // Genuine human input while armed: keep the guard armed (deliberate
          // decision — human typing is not an auto-continue exit condition).
          // Nothing to do here; the guard resumes on the next retryable end.
        } catch (e) {
          // Non-fatal: malformed entries must not break the event loop.
        }
      }

      /** Snapshot of the runner for the bound session, shaped for the overlay.
       *  `state` is one of: stopped | armed | scheduled | paused. */
      function _makeAutoRetryView() {
        var rec = _activeAutoRetryRecord()
        var now = Date.now()
        var base = {
          state: rec ? (rec.paused ? 'paused' : (rec.pending ? 'scheduled' : 'armed')) : 'stopped',
          sessionId: _sessionId || null,
          remaining: rec ? rec.remaining : 0,
          maxConsecutive: _alertPref('autoRetryMaxConsecutive') || 0,
          backoffLevel: rec ? rec.backoffLevel : 0,
          cooldownUntil: rec ? rec.cooldownUntil : null,
          nextEmitAtMs: rec ? rec.nextEmitAtMs : null,
          lastSendAt: rec ? rec.lastSendAt : null,
          lastRequestId: rec ? rec.lastRequestId : null,
          inCooldown: !!(rec && inCooldown(rec.cooldownUntil, now)),
          continueText: _alertStr('autoRetryContinueText'),
          graceMs: _alertPref('autoRetryGraceMs'),
          cooldownMs: _alertPref('autoRetryCooldownMs'),
          maxBackoffMs: _alertPref('autoRetryMaxBackoffMs'),
          echoWindowMs: _alertPref('autoRetryEchoWindowMs'),
        }
        if (rec && rec.maxConsecutive) {
          // Sent-count: 0 right after arming, +1 per really-sent auto-continue
          // (remaining, spent by consumeContinuation only on an actual send).
          base.attemptIndex = Math.max(0, rec.maxConsecutive - rec.remaining)
        } else {
          base.attemptIndex = 0
        }
        return base
      }

      /** Live listeners + last-view replay for the composer send-status chip
       *  (§8b). The send button lives OUTSIDE the flash trigger overlay, so the
       *  cross-plugin stylesheet that recolours dsh-flash's own button cannot
       *  reach it; a React slot inside `conversation.input.right` renders this
       *  chip instead. The module-level channel decouples the component from
       *  token-source setup timing — the same "no racing" pattern the resident
       *  overlay store uses (§6), but as a plain pub/sub so a React component
       *  can subscribe and re-render on every publish. Disposed with the factory. */
      var _autoRetryViewListeners = new Set()
      var _autoRetryViewLatest = null

      /** Fan an auto-retry view out to every subscriber, keeping the last one
       *  so a component that mounts between publishes still renders correctly. */
      function _emitAutoRetryView(view) {
        _autoRetryViewLatest = view
        _autoRetryViewListeners.forEach(function (fn) {
          try { fn(view) } catch (_) {}
        })
      }

      /** Subscribe to auto-retry view publishes. The latest view (if any) is
       *  replayed immediately, so the subscriber always has current state on
       *  mount even when the source published before it subscribed. Returns an
       *  unsubscribe function for useEffect cleanup. */
      function _subscribeAutoRetryView(fn) {
        _autoRetryViewListeners.add(fn)
        if (_autoRetryViewLatest) { try { fn(_autoRetryViewLatest) } catch (_) {} }
        return function () { _autoRetryViewListeners.delete(fn) }
      }

      /** Publish the current view through the optional module-level bridge so
       *  the overlay component re-renders without racing token-source setup,
       *  and to the composer send-status subscribers (§8b). */
      function _publishAutoRetryView() {
        var view = _makeAutoRetryView()
        _emitAutoRetryView(view)
        if (_autoRetryStore && typeof _autoRetryStore.notify === 'function') {
          try { _autoRetryStore.notify(view) } catch (_) {}
        }
      }

      /** Snapshot of the open-turn ledger for the overlay / indicator, shaped
       *  for the watchdog. `unsettled` is the list of sessions whose OLDEST
       *  open turn has been silent for the guard grace. Reminder-only. */
      function _makeUnsettledView() {
        return {
          unsettled: unsettledTurnsAt(_openTurnLedger, Date.now(), 60000),
        }
      }

      /** Publish the unsettled view through the optional module-level bridge so
       *  the header/resident indicator re-renders without racing setup. */
      function _publishUnsettledView() {
        if (_unsettledStore && typeof _unsettledStore.notify === 'function') {
          try { _unsettledStore.notify(_makeUnsettledView()) } catch (_) {}
        }
      }

      /** Normalize a continue-word for matching: trim, lowercase, and collapse
       *  any internal whitespace so " 继续 " and "CONTINUE" both match. */
      function _normalizeContinue(text) {
        if (text == null) return ''
        return String(text).toLowerCase().replace(/\s+/g, '')
      }

      /** Does a human message read as a bare "continue" word?
       *  Matches the configured continue text plus the conventional Chinese and
       *  English equivalents, case- and whitespace-insensitively. Deliberately
       *  only matches when the ENTIRE message is that word (no trailing prose),
       *  so a real instruction that merely mentions "continue" is never armed. */
      function _matchesContinueWord(text) {
        var n = _normalizeContinue(text)
        if (!n) return false
        var configured = _alertStr('autoRetryContinueText')
        if (_normalizeContinue(configured) === n) return true
        return n === '继续' || n === 'continue' || n === 'cont'
          || n === 'resume' || n === 'res'
      }

      /** user/message companion hook: when auto-retry is NOT already armed and
       *  the human typed a bare continue word ("继续 / continue / resume") into
       *  THIS session, ARM auto-continue immediately — no confirmation dialog,
       *  the user typing the continue word IS the explicit opt-in. Runs in every
       *  state (not only armed like _handleUserMessage) so the mode opens before
       *  any failure has happened. Self-echoed continue messages injected by an
       *  ALREADY armed runner never reach this point because the caller
       *  short-circuits armed sessions (arming is idempotent regardless). */
      function _autoArmOnContinue(entry, time) {
        try {
          var rec = _activeAutoRetryRecord()
          if (rec && rec.armed) return                    // already running
          var text = _firstTextOf(entry.text != null ? entry.text : entry)
          if (!text || !_matchesContinueWord(text)) return
          var sid = _sessionId
          if (!sid) return
          // Typing a bare continue word opens auto-continue directly. The runner
          // (data layer) cannot render — arming just records + publishes; the
          // resident indicator reflects the now-armed state on the next poll.
          // force=true so a budget-parked (paused) session is re-opened too: the
          // user typing "继续" again IS the explicit opt-in to let it run again.
          _armAutoRetry(true)
        } catch (e) {
          // Non-fatal: arming must never disrupt message processing.
        }
      }


      /** Extract usage from an assistant/message event.
       *  DSH may place usage directly on event.data.usage, OR embed it in the
       *  last "usage"-typed chunk inside event.data.stream (the format depends
       *  on the DSH version and provider).  This mirrors dsh-token-meter's
       *  own usageOf() extraction logic. */
      function _usageOf(ev) {
        var data = ev.data
        if (!data) return null
        // Path 1: direct usage on the event data (DSH >= 0.2.0 style)
        if (data.usage !== undefined && typeof data.usage === 'object') return data.usage
        // Path 2: usage embedded in the stream's last "usage"-typed chunk
        // Stream records are { type: 'chunk', chunk: { type: 'usage', usage: {...} } }
        var stream = data.stream
        if (Array.isArray(stream)) {
          for (var i = stream.length - 1; i >= 0; i--) {
            var record = stream[i]
            if (record && record.type === 'chunk' && record.chunk && record.chunk.type === 'usage') {
              return record.chunk.usage || null
            }
          }
        }
        return null
      }

      /** Extract the assistant's own final text from an assistant/message event.
       *  DSH may put the finished output directly on ev.data.content (a string,
       *  a block array, or a {content}/{text} object), or stream it as
       *  text-typed chunks inside ev.data.stream. Returns null when no text is
       *  present. Only surfaces the tail of a real assistant message, never a
       *  usage-only packet. */
      function _lastAssistantTextOf(ev) {
        var data = ev.data
        if (!data) return null
        // Path 1: direct content on the event data.
        if (data.content != null) {
          var direct = _firstTextOf(data.content)
          if (typeof direct === 'string' && direct) return direct
        }
        // Path 2: concatenated text chunks in the stream.
        if (data.text != null && typeof data.text === 'string') return data.text
        var stream = data.stream
        if (Array.isArray(stream)) {
          var parts = []
          for (var j = 0; j < stream.length; j++) {
            var rec = stream[j]
            if (!rec) continue
            if (rec.type === 'chunk' && rec.chunk) {
              var c = rec.chunk
              if (c.type === 'text' && typeof c.text === 'string') {
                parts.push(c.text)
              } else if (typeof c.content === 'string') {
                parts.push(c.content)
              }
            } else if (rec.type === 'text' && typeof rec.text === 'string') {
              parts.push(rec.text)
            }
          }
          if (parts.length) return parts.join('')
        }
        return null
      }

      function _processEntries(entries, opts) {
        var foundUsageInBatch = false
        // `replay` marks a full-snapshot reproduction (history replace from
        // compaction/compress, or the initial bind scan) rather than a live
        // incremental event. During a replay the session provably still exists,
        // so re-delivered historical turn/end and user/message entries must be
        // re-accounted (usage, ledger, assistant tail) but must NOT mutate the
        // auto-retry armed state — a compaction replacing the history must never
        // clear a persisted arm. Only live events may arm/disarm.
        var replay = !!(opts && opts.replay)
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i]
          if (entry.type !== 'event') continue
          var ev = entry.event
          if (!ev) continue
          // Skip already-processed events (by sequence number)
          var seq = (ev.seq != null && typeof ev.seq === 'number') ? ev.seq : -1
          if (seq >= 0 && seq <= _lastProcessedSeq) continue

          if (ev.type === 'assistant/message' || ev.type === 'assistant/attempt') {
            // Track the tail of the assistant's own output so a later turn/end
            // can judge whether the model only promised work and then stopped
            // ("让我 / 让我来 / let me …") — a handoff stub is retryable even on
            // a "normal" end. Only a FINISHED assistant message that carries
            // real text updates this; a usage-only attempt packet must not
            // clobber the last complete message.
            if (ev.type === 'assistant/message') {
              var tailText = _lastAssistantTextOf(ev)
              if (typeof tailText === 'string' && tailText) _lastAssistantText = tailText
            }
            var usage = _usageOf(ev)
            if (usage && typeof usage === 'object') {
              // Last-wins: each event reports the FULL token counts for that
              // request, so accumulating would double-count cached tokens.
              _lastUsage = {
                inputTokens: typeof usage.inputTokens === 'number' ? usage.inputTokens : 0,
                outputTokens: typeof usage.outputTokens === 'number' ? usage.outputTokens : 0,
                cacheReadTokens: typeof usage.cacheReadTokens === 'number' ? usage.cacheReadTokens : 0,
                cacheWriteTokens: typeof usage.cacheWriteTokens === 'number' ? usage.cacheWriteTokens : 0,
                reasoningTokens: typeof usage.reasoningTokens === 'number' ? usage.reasoningTokens : 0,
              }
              foundUsageInBatch = true
            } else {
              // Log why we couldn't extract usage (helps debug "unavailable")
              var dataKeys = ev.data ? Object.keys(ev.data).join(',') : '(no data)'
              console.warn('[dsh-flash-ctx-mon] assistant event without usage: type=' + ev.type + ' seq=' + seq
                + ' dataKeys=[' + dataKeys + ']'
                + ' hasUsage=' + !!(ev.data && ev.data.usage)
                + ' hasStream=' + !!(ev.data && Array.isArray(ev.data.stream))
                + (ev.data && Array.isArray(ev.data.stream) ? ' streamLen=' + ev.data.stream.length : ''))
            }
            if (seq >= 0 && seq > _lastProcessedSeq) _lastProcessedSeq = seq
          }

          if (ev.type === 'request/header') {
            // header.config.model is nested under ev.data
            var data = ev.data
            if (data && data.header && data.header.config && data.header.config.model) {
              var headerModel = data.header.config.model
              if (headerModel !== _model) {
                // A different model: whatever window we cached belongs to the
                // previous one, and there may be no new turn for a while. Drop
                // it so the window reads as unconfirmed instead of silently
                // sizing this model against another model's limit.
                _model = headerModel
                _contextWindow = null
                _contextWindowModel = null
                _windowMismatch = null
              }
              // Only fill in a *local estimate* when no authoritative window has
              // arrived yet. A `request/context` set later must win (it carries
              // the window DSH's adapter actually resolved for this model).
              if (_contextWindow == null) {
                var resolved = _resolveWindow(_model)
                _contextWindow = resolved.window
                _contextWindowModel = resolved.window != null ? _model : null
              }
            }
            if (seq >= 0 && seq > _lastProcessedSeq) _lastProcessedSeq = seq
          }

          if (ev.type === 'request/context') {
            var rctx = ev.data
            if (rctx && typeof rctx.model === 'string' && rctx.model !== _model) {
              _model = rctx.model
              _contextWindow = null
              _contextWindowModel = null
              _windowMismatch = null
            }
            if (rctx && typeof rctx.contextWindow === 'number' && rctx.contextWindow > 0) {
              // The request/context window is authoritative and non-persisted:
              // cache it for read-time resolution but never write it into the
              // (removed) modelContextWindows prefs. A window is only durably
              // configured via the DSH profile's llm-pi-ai model config, and a
              // user-configured override wins when one exists.
              var resolvedCtx = _resolveWindow(_model)
              var requestWindow = rctx.contextWindow
              _contextWindow = resolvedCtx.window != null ? resolvedCtx.window : requestWindow
              _contextWindowModel = _model
              // Explicit mismatch: the adapter's own authoritative
              // request/context window disagrees with what the user mapping /
              // model config resolves for THIS model. Keeping the configured
              // override is fine, but silence would hide a stale or wrong
              // mapping, so surface it as an explicit alert panel.
              //
              // Compare at the display granularity (nearest whole K), matching
              // how formatTokenK renders both numbers in the alert. A raw `!==`
              // here flagged false positives: two allowed window sizes that
              // differ only below the K boundary (e.g. 131072 vs 131200) both
              // render as "128K" and yet were reported "inconsistent".
              var mmK = Math.round(resolvedCtx.window / 1024)
              var rqK = Math.round(requestWindow / 1024)
              if (resolvedCtx.window != null && mmK !== rqK) {
                _windowMismatch = {
                  model: _model,
                  mappingWindow: resolvedCtx.window,
                  requestWindow: requestWindow,
                  at: typeof ev.time === 'number' ? ev.time : Date.now(),
                }
              } else {
                _windowMismatch = null
              }
            }
            if (seq >= 0 && seq > _lastProcessedSeq) _lastProcessedSeq = seq
          }

          // Track open turns so we can later flag a turn that STARTED but never
          // produced a closing turn/end (form ① of the unfinished-session doc).
          // The ledger is per-session isolated; the wall-clock is the event's
          // own time (replay-safe) with Date.now() as a defensive fallback.
          if (ev.type === 'turn/start') {
            try {
              _openTurnLedger = noteOpenTurn(_openTurnLedger, {
                sessionId: _sessionId,
                openedAt: typeof ev.time === 'number' ? ev.time : Date.now(),
                tokenSourceId: 'session-event',
              })
            } catch (e) {
              // Non-fatal: malformed turn/start payload
            }
            if (seq >= 0 && seq > _lastProcessedSeq) _lastProcessedSeq = seq
            _publishUnsettledView()
          }

          // Detect turn/end errors (e.g. "上下文超限" / CONTEXT_WINDOW_EXCEEDED)
          // and extract the real context window from the error message. This
          // extraction path is independent from — and coexists with — the
          // auto-continue logic below.
          if (ev.type === 'turn/end') {
            var endData = ev.data
            // A turn/end settles the OLDEST open residual for this session
            // (FIFO, matching DSH's sequential per-session turn resolution).
            try {
              _openTurnLedger = noteClosedTurn(_openTurnLedger, {
                sessionId: _sessionId,
                closedAt: typeof ev.time === 'number' ? ev.time : Date.now(),
                reasonKind: (endData && endData.reason && endData.reason.kind) || null,
              })
            } catch (e) {
              // Non-fatal: malformed turn/end payload
            }
            _publishUnsettledView()
            if (endData && endData.reason) {
              var reason = endData.reason
              if (reason.kind === 'error') {
                var failure = reason.error
                if (failure && isContextLimitError(failure.code, failure.message)) {
                  var extractedWindow = extractWindowFromError(failure.message)
                  if (extractedWindow && _model) {
                    // Cache the error-extracted window in memory for the next
                    // read-time resolution so the panel reflects the provider's
                    // own rejection response immediately. Non-persisted: a window
                    // is only durably configured via the llm-pi-ai model config.
                    _contextWindow = extractedWindow
                  }
                }
              }
              // Auto-retry hook: retryable ends schedule a guarded auto
              // continue; any other end while armed means the turn settled on
              // its own, so the guard drops back to idle rather than firing
              // late. Only a LIVE turn/end may mutate the armed state — a
              // replayed history of completed turns (compaction) must not clear
              // a persisted arm while the session still exists.
              if (!replay) {
                _handleTurnEnd(reason)
                // Turn-ending judgement (info toast, plan A path): classify how
                // THIS live turn settled from its reason + the assistant tail,
                // and queue ONE unique-id info alert. The provider's poll claims
                // it exactly once. Replay stays silent — history is not a "this
                // turn just ended" signal and would only spam on reload/compaction.
                var verdict = _classifyTurnEnd(reason, _lastAssistantText)
                if (verdict) {
                  _turnVerdictPending = {
                    sessionId: _sessionId,
                    at: typeof ev.time === 'number' ? ev.time : Date.now(),
                    verdictKey: verdict.verdictKey,
                    detail: verdict.detail,
                  }
                }
              }
            }
            if (seq >= 0 && seq > _lastProcessedSeq) _lastProcessedSeq = seq
          } else if (ev.type === 'user/message') {
            // A user/message entry is either (a) our own auto-continue being
            // echoed back into the log (see §8.4 of the design: the injected
            // prompt lands as a user-rpc source), or (b) genuine human input.
            // The self-echo detector is pure; anything else disarms the guard.
            // During a replay (compaction/history replace) the surviving
            // historical messages must not touch that armed state, and the
            // compaction summary itself rides on user/message — so skip it.
            try {
              var udata = ev.data || {}
              var usrc = udata.source || udata.sourceMeta || null
              var ukind = (usrc && usrc.kind) || udata.kind || null
              var urpc = (udata.rpcId != null) ? udata.rpcId : ((usrc && usrc.rpcId != null) ? usrc.rpcId : null)
              // The compaction summary rides on a user/message whose surfaceOp is
              // {op:'replace'} (§ compaction.md). It is log/surface-only — never
              // a human take-over — so it must not disarm an armed guard even if
              // it arrives as a live (non-replay) event.
              var compactionSummary = !!(udata.surfaceOp && udata.surfaceOp.op === 'replace')
              if (!replay && !compactionSummary) {
                var logEntry = {
                  source: { kind: ukind, rpcId: urpc },
                  text: _firstTextOf(udata.content),
                }
                // Snapshot whether the guard was already running the instant
                // this message landed: a message that interrupts an armed retry
                // is a deliberate human take-over, so it must NOT re-offer.
                var enteredArmed = !!(_activeAutoRetryRecord() && _activeAutoRetryRecord().armed)
                _handleUserMessage(logEntry, typeof ev.time === 'number' ? ev.time : Date.now())
                if (!enteredArmed) _autoArmOnContinue(logEntry, typeof ev.time === 'number' ? ev.time : Date.now())
              }
            } catch (e) {
              // Non-fatal: malformed user/message payload
            }
            if (seq >= 0 && seq > _lastProcessedSeq) _lastProcessedSeq = seq
          }
        }
        // Diagnostic: report what we found in this batch
        if (foundUsageInBatch) {
          var p = _lastUsage
            ? _lastUsage.inputTokens + (_lastUsage.cacheReadTokens || 0) + (_lastUsage.cacheWriteTokens || 0)
            : 0
          console.log('[dsh-flash-ctx-mon] usage from events: pressure=' + p
            + ' input=' + (_lastUsage ? _lastUsage.inputTokens : '?')
            + ' cacheR=' + (_lastUsage ? _lastUsage.cacheReadTokens : '?')
            + ' cacheW=' + (_lastUsage ? _lastUsage.cacheWriteTokens : '?')
            + ' model=' + (_model || '?')
            + ' window=' + (_contextWindow || '?'))
        }
      }

      function _onEventWindowChange() {
        if (!_sessions || !_sessionId) return
        try {
          var binding = _sessions.binding(_sessionId)
          if (!binding) return
          var win = binding.eventSource.getSnapshot()
          if (!win || !win.entries) return
          // On replace (history reload from compaction/compress), reset
          // last-usage and re-scan the fresh snapshot. The full reprocessing
          // must be marked replay so historical turn/end & user/message events
          // are re-accounted without clearing a persisted auto-retry arm.
          var isReplace = !!(win.change && win.change.kind === 'replace')
          if (isReplace) {
            _lastUsage = null
            _lastProcessedSeq = -1
            _model = null
            _contextWindow = null
            _contextWindowModel = null
            _windowMismatch = null
            // Re-account the CURRENT session's open-turn ledger from the fresh
            // history. Other sessions' ledgers are left untouched (isolation).
            _openTurnLedger = clearOpenTurns(_openTurnLedger, _sessionId)
            _publishUnsettledView()
          }
          _processEntries(win.entries, { replay: isReplace })
        } catch (e) {
          // Non-fatal: event source may be mid-transition
        }
      }

      function _reset() {
        var hadSubscription = !!_unsubscribe
        if (_unsubscribe) { try { _unsubscribe() } catch (_) {} }
        _unsubscribe = null
        // A bind was torn down (session switch / start-over): nudge the quick
        // switch to re-evaluate so it hides until the new session binds.
        if (hadSubscription && _notifyAutoRetryQuick) { try { _notifyAutoRetryQuick() } catch (_) {} }
        if (_bindRetryTimer) { clearTimeout(_bindRetryTimer); _bindRetryTimer = null }
        _lastUsage = null
        _lastProcessedSeq = -1
        _lastAssistantText = null
        _model = null
        _contextWindow = null
        _contextWindowModel = null
      }

      function _bindToSession() {
        if (!_sessions || !_sessionId) return
        try {
          var binding = _sessions.binding(_sessionId)
          if (binding && binding.eventSource) {
            var win = binding.eventSource.getSnapshot()
            var entryCount = win && win.entries ? win.entries.length : 0
            console.log('[dsh-flash-ctx-mon] SessionEventTokenSource: binding to session ' + _sessionId + ', ' + entryCount + ' entries in snapshot')
            if (win && win.entries) _processEntries(win.entries, { replay: true })
            _unsubscribe = binding.eventSource.subscribe(_onEventWindowChange)
            // A session is now bound: nudge the quick-control auto-continue
            // switch to re-evaluate so it appears the moment binding succeeds.
            if (_notifyAutoRetryQuick) { try { _notifyAutoRetryQuick() } catch (_) {} }
          } else {
            console.warn('[dsh-flash-ctx-mon] SessionEventTokenSource: no binding/eventSource for session ' + _sessionId
              + ' (binding only exists for an OPEN session)')
          }
        } catch (e) {
          console.warn('[dsh-flash-ctx-mon] SessionEventTokenSource: bindToSession error: ' + (e.message || e))
        }
        // Every bind (first bind, retry, and session switch) must republish the
        // current auto-retry snapshot to the DOM indicator. The per-session rec
        // survives _reset(), so returning to a previously armed session re-lights
        // the glow immediately (regression: the indicator was lost on switch-back
        // because switching sessions never re-published the view).
        _publishAutoRetryView()
        // Restore the session's persisted choice: if the user last left auto-
        // continue armed for THIS session (e.g. after reloading the page, which
        // cleared _retryBySession), re-arm it so the state survives session
        // switches instead of silently resetting. A record already in memory
        // short-circuits inside _armAutoRetry, so this is idempotent.
        if (_wasAutoRetryArmed(_sessionId)) _armAutoRetry()
        // Same for the watchdog badge: any bind re-derives the unsettled set
        // (grace elapsed while unbound), so the red count stays live.
        _publishUnsettledView()
      }

      /** Resolve the session id to track. The host's client `sessions` face has
       *  no counting-host `list`/`scopeOf`, so discovery is driven by the id the
       *  rendered panel feeds in (its bound session). */
      function _findMaterializedSession() {
        var bound = _boundSessionId || _sessionId
        if (!bound || !_sessions) return null
        try {
          var b = _sessions.binding(bound)
          if (b && b.eventSource) return bound
        } catch (_) {}
        return bound || null
      }

      /** Background retry: when no session is materialized yet, poll
       *  periodically until one appears. */
      function _scheduleBindRetry(ctx) {
        if (_bindRetryTimer) return   // already scheduled
        _bindRetryTimer = setTimeout(function () {
          _bindRetryTimer = null
          if (_sessionId && _unsubscribe) return  // already bound
          var id = _findMaterializedSession()
          if (id) {
            console.log('[dsh-flash-ctx-mon] SessionEventTokenSource: materialized session found on retry: ' + id)
            _reset()
            _sessionId = id
            _bindToSession()
          } else if (_sessions) {
            _bindRetryCount = (typeof _bindRetryCount === 'number' ? _bindRetryCount : 0) + 1
            if (_bindRetryCount < 30) {
              _scheduleBindRetry(ctx)
            } else {
              console.warn('[dsh-flash-ctx-mon] SessionEventTokenSource: gave up waiting for materialized session after 30 retries')
            }
          }
        }, 1000)
      }

      /** Set the session id to track. Called from the rendered panel (slot
       *  `props.sessionId`) because the host exposes no enumerable session list
       *  to discover the active session from. Rebinds when the panel switches
       *  to a different session. */
      function _setBoundSession(ctx, id) {
        if (!id || id === _boundSessionId) return
        _boundSessionId = id
        if (!_sessions) {
          try { _sessions = ctx && ctx.get ? ctx.get('sessions') : undefined } catch (_) {}
        }
        if (!_sessions) {
          // The sessions service is not up yet (it may register a beat after this
          // source's start). Record the panel-reported id and keep polling so a
          // late service still binds THIS session instead of dropping the id:
          // short-circuiting here on `id === _boundSessionId` used to lock the
          // binding out forever once the first attempt failed.
          if (!_ctx) _ctx = ctx
          _scheduleServiceRetry()
          return
        }
        console.log('[dsh-flash-ctx-mon] SessionEventTokenSource: bound to injected session ' + id)
        _refreshWorkspaces()
        _reset()
        _sessionId = id
        _bindToSession()
      }

      /** Common bind logic used by start() and setSessionId(). The host's
       *  client `sessions` face has no counting-host `list`/`scopeOf`, so the
       *  tracked id comes from the injected panel session (or the first known
       *  bound id). */
      function _tryBindSession(ctx) {
        // Prefer the session fed from the rendered panel; fall back to any
        // currently-known session id. The injected register is authoritative
        // even when the panel's setSessionId sprint raced ahead of this source's
        // start (its effect writes the register unconditionally), so a chip
        // that mounted before the provider had created the token source still
        // binds here instead of being lost to a skipped one-shot bind.
        if (!_sessionId) {
          if (_injectedSessionId) {
            _boundSessionId = _injectedSessionId
            _sessionId = _injectedSessionId
          } else {
            _sessionId = _findMaterializedSession()
          }
        }
        console.log('[dsh-flash-ctx-mon] SessionEventTokenSource: sessions service found, sessionId=' + (_sessionId || '(none)')
          + (_sessionId ? ' (bound)' : ' — no session open in UI'))

        // If we already have a session, bind immediately; otherwise keep
        // polling until the panel reports one via setSessionId().
        if (_sessionId) {
          _bindToSession()
        } else {
          _bindRetryCount = 0
          _scheduleBindRetry(ctx)
        }
      }

      /** Re-resolve the sessions service until it becomes available, then bind.
       *  The service may register a beat after this source's start (the same
       *  race the skill tracker handles), so instead of a one-shot 3s retry we
       *  keep polling at a short interval and self-stop the moment the service
       *  is present — a late-registering host still arms auto-continue instead
       *  of dropping the session binding forever. Silent (no log spam): we only
       *  log the success transition, never the intermediate polls. */
      function _scheduleServiceRetry() {
        if (_serviceRetryTimer) return   // already polling
        _serviceRetryTimer = setTimeout(function () {
          _serviceRetryTimer = null
          if (_sessions) { _tryBindSession(_ctx); return }
          try { _sessions = _ctx && _ctx.get ? _ctx.get('sessions') : undefined } catch (_) {}
          if (_sessions) {
            console.log('[dsh-flash-ctx-mon] SessionEventTokenSource: sessions service available on retry')
            _tryBindSession(_ctx)
          } else {
            _scheduleServiceRetry()
          }
        }, 1000)
      }

      return {
        start: function (ctx) {
          _ctx = ctx     // service/context handle used for prefs + sessions lookups
          try {
            _sessions = ctx && ctx.get ? ctx.get('sessions') : undefined
          } catch (_) {}
          if (!_sessions) {
            console.warn('[dsh-flash-ctx-mon] SessionEventTokenSource: sessions service not available (will retry)')
            _scheduleServiceRetry()
            return
          }

          _tryBindSession(ctx)
        },

        stop: function () {
          _retryTimersClear()
          _retryBySession = Object.create(null)
          _retryRequestIdCache.clear()
          _reset()
          if (_serviceRetryTimer) { clearTimeout(_serviceRetryTimer); _serviceRetryTimer = null }
          _bindRetryCount = 0
          if (_listUnsubscribe) { try { _listUnsubscribe() } catch (_) {} }
          _listUnsubscribe = null
          _sessions = null
          _sessionId = null
          _boundSessionId = null
          _ctx = null
        },

        /** Adopt the current window mismatch: persist the model's authoritative
         *  request/context window into the llm-pi-ai profile config, and once
         *  that lands, clear the in-memory mismatch so the alert disappears.
         *  Resolves true when persisted, false when the host refused. */
        adoptWindow: function (ctx) {
          var m = _windowMismatch
          if (!m) return Promise.resolve(false)
          return _persistAdopt(ctx, m).then(function (ok) {
            if (ok && _windowMismatch === m) {
              // Persisted; from now on the authoritative request window governs
              // this model (a later request/context re-resolves equally).
              _contextWindow = m.requestWindow
              _contextWindowModel = _model
              _windowMismatch = null
            }
            return ok
          })
        },

        /** Ignore this model's window-mismatch for the rest of the session. The
         *  mismatch state itself is left intact (a fresh session must surface
         *  it again), but poll now suppresses the alert via the ignored set. */
        ignoreMismatch: function () {
          var m = _windowMismatch
          if (!m) return false
          _mismatchIgnored[m.model] = true
          return true
        },

        /** Returns the current token estimate.
         *  source: 'precise' when session events with usage are available,
         *  'unavailable' when no data has been received yet.
         *  windowConfirmed: whether `contextWindow` is a real limit for THIS
         *  model — a user mapping or the window DSH's adapter resolved. False
         *  means it is the ctxApproxWindow guess, which must never be used to
         *  judge pressure (see the provider).
         */
        getTokenEstimate: function () {
          if (_lastUsage) {
            var pressureTokens = _lastUsage.inputTokens
              + (_lastUsage.cacheReadTokens || 0)
              + (_lastUsage.cacheWriteTokens || 0)
            // Resolve the window at READ time, not only when an event lands.
            // _contextWindow is a cache that request/header and request/context
            // update, so resolving only there meant a mapping edited in the
            // panel did nothing visible — both the displayed size and the
            // ratio kept using the old window until the next turn. The user
            // mapping is authoritative and must win immediately; the cached
            // adapter value is only the fallback for unmapped models.
            var resolved = _resolveWindow(_model)
            var windowValue, windowSource, windowConfirmed
            if (resolved.window != null) {
              windowValue = resolved.window
              windowSource = resolved.source
              windowConfirmed = true
            } else if (_contextWindow != null && _contextWindowModel === _model) {
              windowValue = _contextWindow
              windowSource = CWS_REQUEST_CONTEXT
              windowConfirmed = true
            } else {
              // Nothing authoritative for this model. Report the configured
              // default so the panel can still show something, but flag it as a
              // guess — it is not a limit anybody measured.
              windowValue = _alertPref('ctxApproxWindow')
              windowSource = CWS_APPROX_DEFAULT
              windowConfirmed = false
            }
            return {
              pressureTokens: pressureTokens,
              inputTokens: _lastUsage.inputTokens,
              outputTokens: _lastUsage.outputTokens,
              cacheReadTokens: _lastUsage.cacheReadTokens || 0,
              cacheWriteTokens: _lastUsage.cacheWriteTokens || 0,
              reasoningTokens: _lastUsage.reasoningTokens || 0,
              contextWindow: windowValue,
              windowSource: windowSource,
              windowConfirmed: windowConfirmed,
              windowMismatch: (_windowMismatch && _windowMismatch.model && _mismatchIgnored[_windowMismatch.model]) ? null : _windowMismatch,
              model: _model,
              source: 'precise',
            }
          }
          return { source: 'unavailable' }
        },

          // ── Auto-retry public API (§6) ─────────────────────────────────────
          // The persistent overlay drives the guard through these three
          // methods; state stays isolated per session id and the view is a
          // live snapshot of the current session's record. armAutoRetry is
          // only ever reached from explicit user actions (the quick switch, the
          // resident Arm button), so it forces a re-arm: a budget-parked
          // (paused) session the user chooses to open again is re-seeded.
          armAutoRetry: function () { return _armAutoRetry(true) },
          disarmAutoRetry: function () { return _disarmAutoRetry('manual') },
          getAutoRetryView: _makeAutoRetryView,
          /** Current bound session id (the session an auto-continue offer belongs
           *  to). Null when no session is materialized. Used by the alert provider
           *  to reject a stale continue-offer after a session switch. */
          getSessionId: function () { return _sessionId },
          /** Whether the token source has BOUND to an open session (a known
           *  session id AND a live eventSource subscription). The quick-control
           *  auto-continue switch only appears once this is true, so a user is
           *  never shown an auto-continue toggle that has nothing to act on
           *  (e.g. while the sessions service is still registering and no
           *  session is materialized). */
          isBound: function () { return !!(_sessionId && _unsubscribe) },
          /** Bind the runner to a specific session id. The rendered panel calls
           *  this with its slot-injected `props.sessionId`; the runner needs a
           *  known id because the host exposes no enumerable session list. */
          setSessionId: function (id) { _setBoundSession(_ctx, id) },

          // ── Watchdog (unfinished-turn) public API ─────────────────────────
          // Form ① detection surface (docs/detecting-unfinished-session.zh-CN.md
          // §3.2). The ledger this token source feeds on turn/start and
          // turn/end lives in this same closure, so these read/write the SAME
          // records the event sink updates — unlike auto-retry's per-session
          // arm state, the open-turn ledger spans sessions, so the query
          // returns every currently-unsettled session, not just the tracked one.
          //
          // Both are PURE surfaces: getUnsettledTurns only COMPUTES the set to
          // REMIND about; dismissOpenTurns is the acknowledged-by-human reset
          // hook the overlay calls. Neither ever auto-continues anything.
          getUnsettledTurns: function (nowMs, graceMs) {
            var now = typeof nowMs === 'number' ? nowMs : Date.now()
            var grace = typeof graceMs === 'number' ? graceMs : 60000
            return unsettledTurnsAt(_openTurnLedger, now, grace)
          },

          dismissOpenTurns: function (sessionId) {
            _openTurnLedger = clearOpenTurns(_openTurnLedger, sessionId)
            _publishUnsettledView()
            return _openTurnLedger
          },
      }
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region SessionSkillTracker ─────────────────────────────────────────────
    //
    // Tracks which skills the CURRENT session has actually loaded.
    //
    // ── Detection ────────────────────────────────────────────────────────
    // The one authoritative signal is the `<skill_content name="X">` block
    // DSH emits when a skill body is loaded. It arrives on two paths:
    //
    //   1. The model calls the `skill` tool → a tool/call (name === 'skill')
    //      followed by the tool/result carrying the block.
    //   2. The user types `/name` in the composer → the host injects the block
    //      as its OWN user/message event. This path produces NO tool call at
    //      all (measured: session-3179d7ca seq=13 is the typed `/name`, seq=17
    //      the injected block), so a tool/call-only detector misses it.
    //
    // Requiring the tag to START a text block — rather than merely appear
    // somewhere in the payload — is what keeps the detector honest:
    //   - a FAILED skill call carries no such block, so failures are excluded
    //     without inspecting any error field;
    //   - prose that merely quotes the tag (a chat message discussing this
    //     feature, a grep hit in a tool result) never matches. Measured: a
    //     naive substring scan over the session store produced 20 false hits,
    //     all of them assistant messages quoting the tag mid-sentence.
    //
    // ── Session isolation ────────────────────────────────────────────────
    // The tracker binds ONLY to the session the workspace shows in its main
    // view (`retainedBy.mainView`) — the same test DSH's own workspace UI
    // uses. It never enumerates sessions looking for a live binding: with
    // several sessions retained at once (a sidebar subagent chat, a
    // right-sidebar preview, a gateway scope) "first session that has a
    // binding" is a coin flip, and losing that coin flip means rendering
    // another session's data. Skills live under a session id and every read
    // is keyed by that id (`getSkillsFor`), so a component rendering for a
    // different session gets an empty list rather than someone else's.

    /** The tag a loaded skill body always starts with. */
    var SKILL_CONTENT_PREFIX = '<skill_content name="'
    /** How recent a first use must be to earn a notification (ms).
     *  The tracker replays a session's whole history when it binds, so without
     *  this every skill the session ever used would announce itself at once.
     *  This is a freshness filter on the USE, not a display window: the notice
     *  itself is shown once and then withdrawn. */
    var SKILL_NOTICE_FRESH_MS = 15000
    /** Hard cap on tracked skills per session (defensive; a session cannot
     *  legitimately load anywhere near this many). */
    var SKILL_TRACK_LIMIT = 200

    /** parseSkillBlock / findSkillBlock are imported from modules/skill-detect.js
     *  (single source of truth, unit-tested under test/skill-detect.test.js). */

    /** The session the workspace holds in its main view, or null.
     *  `retainedBy` is the retention ledger the sessions service projects onto
     *  every list row; 'mainView' is the source dsh-client-ui-workspace itself
     *  retains while a session occupies that view. Sidebar previews
     *  ('sidebarView'), subagent chats ('sidebarChat') and gateway scopes are
     *  different sources and are therefore never selected here. */
    function findMainViewSessionId(sessions) {
      if (!sessions || !sessions.list || typeof sessions.list.getSnapshot !== 'function') return null
      var snap
      try { snap = sessions.list.getSnapshot() } catch (_) { return null }
      var byId = snap && snap.byId
      if (!byId) return null
      var ids = Object.keys(byId)
      for (var i = 0; i < ids.length; i++) {
        var row = byId[ids[i]]
        if (row && row.retainedBy && (row.retainedBy.mainView || 0) > 0) return ids[i]
      }
      return null
    }

    /** The active tracker. The config modal and the header chip read it. */
    var _activeSkillTracker = null

    /**
     * SessionSkillTracker — collects the skills loaded by the current session.
     *
     * Returns an object with:
     *   start(ctx)               — resolve services, bind to the main-view session
     *   stop()                   — unsubscribe and forget everything
     *   subscribe(fn)            — notify on any change; returns an unsubscribe
     *   getSessionId()           — the tracked session id, or null
     *   getSkills()              — skills of the tracked session, first-use order
     *   getSkillsFor(sessionId)  — skills for that id, [] unless it IS the tracked one
     */
    function createSessionSkillTracker() {
      var _ctx = null
      var _sessions = null
      var _sessionId = null
      var _boundSessionId = null
      var _bindingUnsub = null
      var _listUnsub = null
      var _retryTimer = null
      var _retryCount = 0
      var _bindRetryTimer = null
      var _bindRetryCount = 0
      var _skills = {}       // name → record
      var _order = []        // names in first-use order
      var _skillCalls = {}   // callId → true, skill tool calls awaiting their result
      var _lastSeq = -1
      var _listeners = []
      /** Skills whose first-use notice has already been handed out, for the
       *  session currently tracked. Deliberately NOT reset by _clearSkills():
       *  a history reload re-scans the same session and must not re-announce
       *  skills the user has already been told about. It is reset only when the
       *  tracked session changes. */
      var _notified = {}

      function _notify() {
        var ls = _listeners.slice()
        for (var i = 0; i < ls.length; i++) {
          try { ls[i]() } catch (_) {}
        }
      }

      /** Drop every collected skill. Called on session switch and on history
       *  reload — never merged across sessions. */
      function _clearSkills() {
        _skills = {}
        _order = []
        _skillCalls = {}
        _lastSeq = -1
        _notify()
      }

      /** Record one actual load of `name`. `via` is 'user' (composer `/name`)
       *  or 'model' (the skill tool). */
      function _record(name, via, ev) {
        if (_order.length >= SKILL_TRACK_LIMIT && !_skills[name]) return
        var time = (ev && typeof ev.time === 'number') ? ev.time : Date.now()
        var seq = (ev && typeof ev.seq === 'number') ? ev.seq : -1
        var rec = _skills[name]
        if (!rec) {
          rec = _skills[name] = {
            name: name,
            count: 0,
            viaModel: 0,
            viaUser: 0,
            firstTime: time,
            lastTime: time,
            firstSeq: seq,
            lastSeq: seq,
          }
          _order.push(name)
        }
        rec.count++
        if (via === 'user') rec.viaUser++
        else rec.viaModel++
        if (time < rec.firstTime) rec.firstTime = time
        if (time > rec.lastTime) rec.lastTime = time
        if (seq >= 0) {
          if (rec.firstSeq < 0 || seq < rec.firstSeq) rec.firstSeq = seq
          if (seq > rec.lastSeq) rec.lastSeq = seq
        }
      }

      function _processEntries(entries) {
        if (!entries || !entries.length) return
        var changed = false
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i]
          if (!entry || entry.type !== 'event') continue
          var ev = entry.event
          if (!ev) continue
          var seq = (typeof ev.seq === 'number') ? ev.seq : -1
          if (seq >= 0 && seq <= _lastSeq) continue
          if (seq > _lastSeq) _lastSeq = seq
          var data = ev.data || {}

          if (ev.type === 'user/message') {
            // Path 2 — the host injected the skill body into this turn.
            var injected = findSkillBlock(data.content, 0)
            if (injected) { _record(injected, 'user', ev); changed = true }
          } else if (ev.type === 'tool/call') {
            if (data.name === 'skill' && typeof data.callId === 'string') {
              _skillCalls[data.callId] = true
            }
          } else if (ev.type === 'tool/result') {
            var msg = data.message || {}
            var callId = (msg.source && msg.source.callId) || msg.toolCallId || data.callId
            if (callId && _skillCalls[callId]) {
              delete _skillCalls[callId]
              // A failed call has no skill-content block, so nothing is
              // recorded — the "failures do not count" rule needs no error
              // inspection at all.
              var loaded = findSkillBlock(msg.content, 0)
              if (loaded) { _record(loaded, 'model', ev); changed = true }
            }
          }
        }
        if (changed) _notify()
      }

      function _onWindowChange() {
        if (!_sessions || !_sessionId) return
        try {
          var binding = _sessions.binding(_sessionId)
          if (!binding || !binding.eventSource) return
          var win = binding.eventSource.getSnapshot()
          if (!win || !win.entries) return
          if (win.change && win.change.kind === 'replace') {
            // History was reloaded (re-open, fork, rewind): the snapshot is
            // the whole truth again, so rebuild rather than merge.
            _clearSkills()
          }
          _processEntries(win.entries)
        } catch (_) {}
      }

      function _unbind() {
        if (_bindingUnsub) { try { _bindingUnsub() } catch (_) {} }
        _bindingUnsub = null
        if (_bindRetryTimer) { clearTimeout(_bindRetryTimer); _bindRetryTimer = null }
      }

      /** Bind to one session's event stream. Returns false while the session
       *  is listed but not yet materialized (its binding appears a tick later). */
      function _bind(id) {
        try {
          var binding = _sessions.binding(id)
          if (!binding || !binding.eventSource) return false
          var win = binding.eventSource.getSnapshot()
          if (win && win.entries) _processEntries(win.entries)
          _bindingUnsub = binding.eventSource.subscribe(_onWindowChange)
          return true
        } catch (_) {
          return false
        }
      }

      /** Re-resolve the tracked session and rebind when it changed. Prefers the
       *  id injected from the rendered panel (slot `props.sessionId`); falls
       *  back to findMainViewSessionId when the host exposes an enumerable list
       *  (it does not on this host). */
      function _syncSession() {
        if (!_sessions) return
        // Prefer the id injected from the rendered panel. The injected register
        // is authoritative even when the panel's bind sprint raced ahead of this
        // source's start (the chip writes it unconditionally), so a chip mounted
        // before the tracker existed still binds here instead of being lost.
        var id = _boundSessionId || _injectedSessionId || findMainViewSessionId(_sessions)
        if (id === _sessionId) return
        _unbind()
        _bindRetryCount = 0
        _sessionId = id
        // A different session starts with a clean notice ledger: its skills
        // have not been announced.
        _notified = {}
        // Clear BEFORE binding the new session so a stale list can never be
        // read against the new id.
        _clearSkills()
        if (id && !_bind(id)) _scheduleBindRetry(id)
      }

      /** Bind the tracker to a specific session id, fed from the rendered panel.
       *  The host exposes no enumerable session list, so this is the
       *  authoritative "current session" signal. */
      function _bindInjected(id) {
        if (!id || id === _boundSessionId) return
        _boundSessionId = id
        if (!_sessions) {
          try { _sessions = _ctx && _ctx.get ? _ctx.get('sessions') : undefined } catch (_) {}
        }
        if (!_sessions) return
        _syncSession()
      }

      function _scheduleBindRetry(id) {
        if (_bindRetryTimer) return
        _bindRetryTimer = setTimeout(function () {
          _bindRetryTimer = null
          if (_sessionId !== id) return
          if (_bind(id)) return
          // The main-view session is retained before its list row is published,
          // so the binding is normally there on the first try; this is only a
          // guard against a one-tick gap, not an indefinite poll.
          if (++_bindRetryCount < 15) _scheduleBindRetry(id)
        }, 800)
      }

      function _scheduleServiceRetry() {
        if (_retryTimer) return
        _retryTimer = setTimeout(function () {
          _retryTimer = null
          if (_sessions && _listUnsub) return
          try { _sessions = _ctx && _ctx.get ? _ctx.get('sessions') : undefined } catch (_) {}
          if (!_sessions) {
            if (++_retryCount < 30) _scheduleServiceRetry()
            return
          }
          _attachList()
          _syncSession()
        }, 1000)
      }

      function _attachList() {
        // The host's client `sessions` face has no enumerable `list` to
        // subscribe to; session changes are instead driven by the rendered
        // panel's injected sessionId (see _bindInjected). Keep this a guarded
        // no-op so a counting host that DOES expose .list still works.
        if (_listUnsub || !_sessions) return
        try {
          if (_sessions.list && typeof _sessions.list.subscribe === 'function') {
            _listUnsub = _sessions.list.subscribe(_syncSession)
          }
        } catch (_) {}
      }

      return {
        start: function (ctx) {
          _ctx = ctx
          try { _sessions = ctx && ctx.get ? ctx.get('sessions') : undefined } catch (_) {}
          if (!_sessions) { _scheduleServiceRetry(); return }
          _attachList()
          _syncSession()
        },

        stop: function () {
          _unbind()
          if (_listUnsub) { try { _listUnsub() } catch (_) {} }
          _listUnsub = null
          if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null }
          _sessions = null
          _sessionId = null
          _boundSessionId = null
          _ctx = null
          _clearSkills()
          _listeners = []
        },

        subscribe: function (fn) {
          if (typeof fn !== 'function') return function () {}
          _listeners.push(fn)
          var alive = true
          return function () {
            if (!alive) return
            alive = false
            var i = _listeners.indexOf(fn)
            if (i >= 0) _listeners.splice(i, 1)
          }
        },

        getSessionId: function () { return _sessionId },

        /** Bind the tracker to a specific session id, fed from the rendered
         *  panel's slot-injected `props.sessionId` (the authoritative current
         *  session on hosts that expose no enumerable session list). */
        setSessionId: function (id) { _bindInjected(id) },

        getSkills: function () {
          var out = []
          for (var i = 0; i < _order.length; i++) out.push(_skills[_order[i]])
          return out
        },

        /** Skills for `sessionId`. Anything that is not the tracked session
         *  gets an empty list — this is the isolation boundary. */
        getSkillsFor: function (sessionId) {
          if (!sessionId || sessionId !== _sessionId) return []
          var out = []
          for (var i = 0; i < _order.length; i++) out.push(_skills[_order[i]])
          return out
        },

        /** Names whose first-use notice has not been handed out yet, and whose
         *  first use is recent enough to be a live event rather than replayed
         *  history. Claiming is one-way: each name is returned at most once per
         *  tracked session, so the caller can report it to the alert registry
         *  without ever having to withdraw and re-raise it.
         *  @param nowMs - current wall clock, injectable for tests
         *  @returns skill names to announce, in first-use order */
        claimNewSkills: function (nowMs) {
          var now = typeof nowMs === 'number' ? nowMs : Date.now()
          var claimed = []
          for (var i = 0; i < _order.length; i++) {
            var name = _order[i]
            if (_notified[name]) continue
            var rec = _skills[name]
            if (!rec) continue
            // Replaying history must not announce a skill the user loaded long
            // ago; only a use that just happened earns a notice.
            if (now - rec.firstTime > SKILL_NOTICE_FRESH_MS) {
              // Too old to announce, and it never will be fresh again.
              _notified[name] = true
              continue
            }
            _notified[name] = true
            claimed.push(name)
          }
          return claimed
        },
      }
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region AlertProvider ──────────────────────────────────────────────────

    /**
     * SessionContextProvider — estimates session context exhaustion.
     *
     * Data path:
     *   Reads token usage from DSH session events via
     *   SessionEventTokenSource.  The ratio is computed from
     *   pressureTokens (= inputTokens + cacheReadTokens + cacheWriteTokens),
     *   not inputTokens alone, because DeepSeek's aggressive caching means
     *   inputTokens shrinks as more context is cached while the actual
     *   context pressure grows.
     *
     * When session events are unavailable or have no usage data,
     * no estimate is produced (returns null) — there is no heuristic
     * fallback because the DOM may not contain the full conversation.
     *
     * Adaptive polling: interval = BASE * (1 - ratio)^2 + MIN
     *   Precise mode doubles the effective interval since the event source
     *   pushes updates between polls.
     */
    function createSessionContextProvider() {
      var timer = null
      var callback = null
      var tokenSource = null
      var skillUnsub = null

      function estimateContextRatio(tokenEstimate) {
        // Only precise path: reads token usage from DSH session events.
        // pressureTokens = inputTokens + cacheReadTokens + cacheWriteTokens
        // The caller guarantees a confirmed window, so this is the real limit
        // for this model — no fallback is substituted here on purpose.
        if (tokenEstimate && tokenEstimate.source === 'precise') {
          var window = tokenEstimate.contextWindow
          if (!(window > 0)) return null
          var pressure = tokenEstimate.pressureTokens || 0
          return {
            ratio: pressure / window,
            msgCount: -1,  // not meaningful for precise mode
            estTokens: pressure,
            source: 'precise',
            model: tokenEstimate.model || null,
            contextWindow: window,
            // Breakdown for detailed display
            inputTokens: tokenEstimate.inputTokens,
            outputTokens: tokenEstimate.outputTokens,
            cacheReadTokens: tokenEstimate.cacheReadTokens,
            cacheWriteTokens: tokenEstimate.cacheWriteTokens,
            reasoningTokens: tokenEstimate.reasoningTokens,
          }
        }

        // No precise data available — cannot estimate.
        return null
      }

      function poll() {
        if (!callback) return
        var alerts = []
        var tokenEstimate = tokenSource ? tokenSource.getTokenEstimate() : { source: 'unavailable' }
        // Threshold alerts require a window that is a REAL limit for the current
        // model. When nothing authoritative is known — no mapping, and no
        // request/context for this model yet — `contextWindow` is only the
        // ctxApproxWindow guess, and pressure measured against a guessed
        // denominator is meaningless: a 1M-window model guessed as 128K reports
        // ~400% and screams "context exhausted". Silence is correct until the
        // model's own window is known.
        var windowConfirmed = !!(tokenEstimate && tokenEstimate.windowConfirmed)
        var est = windowConfirmed ? estimateContextRatio(tokenEstimate) : null
        if (est) {
          var ratio = est.ratio
          var tInfo = _alertPref('ctxThresholdInfo') / 100
          var tWarn = _alertPref('ctxThresholdWarning') / 100
          var tErr  = _alertPref('ctxThresholdError') / 100
          if (!(tInfo < tWarn && tWarn < tErr)) {
            tInfo = 0.70; tWarn = 0.85; tErr = 0.95
          }

          var sourceLabel = est.source === 'precise'
            ? (est.model || '?') + ' · ' + formatTokenK(est.estTokens) + '/' + formatTokenK(est.contextWindow)
            : '~' + formatTokenK(est.estTokens) + '/' + formatTokenK(est.contextWindow) + ' (estimated)'

          if (ratio >= tErr) {
            alerts.push({
              id: 'ctx-error',
              severity: 'error',
              title: function () { return t('alertContextError') },
              message: function () { return t('alertContextError') + ' (' + Math.round(ratio * 100) + '% · ' + sourceLabel + ')' },
              icon: '🔴',
              timestamp: Date.now(),
              dismissible: true,
              // Plugin-registered dispose action (dsh-flash alert-detail panel):
              // jump straight into this monitor's config so the user can act
              // before the window runs out — inspect the source, loosen a
              // threshold, or remap the model window.
              actions: [{
                id: 'ctx-open-config',
                label: function () { return t('alertOpenMonitorConfig') },
                primary: true,
                onClick: function () { openMonitorConfig('context') },
              }],
            })
          } else if (ratio >= tWarn) {
            alerts.push({
              id: 'ctx-warning',
              severity: 'warning',
              title: function () { return t('alertContextWarning') },
              message: function () { return t('alertContextWarning') + ' (' + Math.round(ratio * 100) + '% · ' + sourceLabel + ')' },
              icon: '🟡',
              timestamp: Date.now(),
              dismissible: true,
              actions: [{
                id: 'ctx-open-config',
                label: function () { return t('alertOpenMonitorConfig') },
                primary: false,
                onClick: function () { openMonitorConfig('context') },
              }],
            })
          } else if (ratio >= tInfo) {
            alerts.push({
              id: 'ctx-info',
              severity: 'info',
              title: function () { return t('alertContextInfo') },
              message: function () { return t('alertContextInfo') + ' (' + Math.round(ratio * 100) + '% · ' + sourceLabel + ')' },
              icon: '🔵',
              timestamp: Date.now(),
              dismissible: true,
            })
          }
        }
        // ── Window mismatch (warning) ──────────────────────────────────────
        // When DSH's adapter resolves an authoritative request/context window
        // for THIS model that disagrees with the user-configured (mapped /
        // default) window, the configured override wins. That precedence is
        // intentional, but silence would hide a stale or wrong mapping, so the
        // disagreement is surfaced as an explicit alert panel. Stable id,
        // re-emitted every poll while the mismatch holds — the same persistent
        // condition pattern as the ctx-warning threshold alert above.
        var mm = tokenEstimate && tokenEstimate.windowMismatch
        if (mm) {
          alerts.push({
            id: 'ctx-window-mismatch',
            severity: 'warning',
            title: function () { return t('alertWindowMismatch') },
            message: function () {
              return t('alertWindowMismatchDetail')
                .replace('{model}', mm.model || '?')
                .replace('{mapped}', formatTokenK(mm.mappingWindow))
                .replace('{actual}', formatTokenK(mm.requestWindow))
            },
            icon: '⚠️',
            timestamp: mm.at,
            dismissible: true,
            // Two user-decided affordances:
            //   ctx-adopt-window — persist THIS model's request/context window
            //     into the llm-pi-ai profile config (global, persisted change),
            //     then clear the in-memory mismatch once the host accepts.
            //   ctx-ignore-window — silence this model's mismatch for the rest
            //     of the session (set starts empty, so the first alert still
            //     appears on a fresh session).
            actions: [{
              id: 'ctx-adopt-window',
              label: function () { return t('alertAdoptWindow') },
              primary: true,
              onClick: function () {
                tokenSource.adoptWindow(_prefCtx).then(function () {
                  if (timer) { clearTimeout(timer); timer = null }
                  poll()
                })
              },
            }, {
              id: 'ctx-ignore-window',
              label: function () { return t('alertIgnoreMismatch') },
              primary: false,
              onClick: function () {
                tokenSource.ignoreMismatch()
                if (timer) { clearTimeout(timer); timer = null }
                poll()
              },
            }],
          })
        }
        // NOTE: no alert is emitted when the token source is 'unavailable'.
        // "Cannot detect session context length" carries no actionable
        // information — it only fires when there is no data to report, and a
        // notification for "nothing to report" is pure noise. Silence is the
        // correct signal here.

        // ── Skills used in this session (info level) ─────────────────────
        // ONE alert, and it is emitted exactly once per skill.
        //
        // The registry re-derives 'is this alert new?' on every provider
        // update: it drops the provider's previous alerts and re-adds whatever
        // the provider reports, toasting anything whose id was not present a
        // moment ago. So an id that leaves the registry and comes back is
        // toasted AGAIN. An alert can leave without the provider knowing —
        // the registry keeps only MAX_ALERTS (3) globally and evicts the
        // oldest by timestamp — which is how a single skill use produced a
        // notification on every poll.
        //
        // Two rules follow, and both are required:
        //   1. the notice for a skill is CLAIMED once and then never reported
        //      again, so it cannot come back after any eviction (the claim
        //      lives in the tracker, so a provider restart cannot resurrect it
        //      either);
        //   2. no second, permanently re-reported skills alert. A stable id
        //      re-emitted every poll is fine right up until the global cap
        //      evicts it, after which it re-toasts forever. The always-on
        //      list lives on the session-header chip and in this panel's
        //      skills section, which is where a persistent view belongs.
        var skillTracker = _activeSkillTracker
        if (skillTracker) {
          var freshSkills = skillTracker.claimNewSkills(Date.now())
          for (var sj = 0; sj < freshSkills.length; sj++) {
            alerts.push((function (name) {
              return {
                id: 'ctx-skill-used-' + name,
                severity: 'info',
                title: function () { return t('alertSkillUsed') },
                message: function () { return name },
                icon: '🧩',
                timestamp: Date.now(),
                dismissible: true,
              }
            })(freshSkills[sj]))
          }
        }

        // "Session exited auto-continue" info alert — the complement of the
        // former continue-offer above. When the data layer records that the CURRENT session left
        // active auto-continue for a user-relevant reason, surface ONE info toast
        // naming that reason. The pending is CLAIMED on first read (nulled), so
        // the alert is emitted exactly once and, after it leaves the registry
        // (eviction/refresh), will never be re-toasted.
        var exitedPending = _autoRetryExitedPending
        if (exitedPending && exitedPending.sessionId === (tokenSource && tokenSource.getSessionId ? tokenSource.getSessionId() : null)) {
          _autoRetryExitedPending = null
          var exitedAt = typeof exitedPending.at === 'number' ? exitedPending.at : Date.now()
          alerts.push({
            id: 'ctx-auto-continue-exited-' + exitedAt,
            severity: 'info',
            title: function () { return t('alertAutoRetryExited') },
            message: function () {
              var reasonText = t(autoRetryExitedReasonKey(exitedPending.reason))
              var locate = autoRetryExitedLocate(exitedPending.sessionId, exitedPending.workspace, exitedPending.sessionName)
              var detail = exitedPending.detail ? (' · ' + exitedPending.detail) : ''
              return locate ? reasonText + locate + detail : reasonText + detail
            },
            icon: '🔁',
            timestamp: exitedAt,
            dismissible: true,
          })
        }

        // "Turn-ending judgement" info alert (plan A: local rule-based verdict).
        // The current session's most recent LIVE turn/end queued a judgement;
        // claim it once and surface it as an info toast. Unique id = the
        // turn-end wall clock ⇒ a judgement can never be re-toasted after the
        // registry evicts it (contrast a stable id, which would). Replay stays
        // silent because _turnVerdictPending is only set on live turn/end.
        var verdictPending = _turnVerdictPending
        if (verdictPending && verdictPending.sessionId === (tokenSource && tokenSource.getSessionId ? tokenSource.getSessionId() : null)) {
          _turnVerdictPending = null
          var verdictAt = typeof verdictPending.at === 'number' ? verdictPending.at : Date.now()
          alerts.push({
            id: 'ctx-turn-verdict-' + verdictAt,
            severity: 'info',
            title: function () { return t('turnVerdictTitle') },
            message: function () {
              var verdictText = t(verdictPending.verdictKey)
              if (verdictPending.detail) {
                return verdictText + t('turnVerdictDetail').replace('{value}', verdictPending.detail)
              }
              return verdictText
            },
            icon: '🔵',
            timestamp: verdictAt,
            dismissible: true,
          })
        }

        try { callback(alerts) } catch (_) {}

        // Adaptive interval
        var pollBase = _alertPref('ctxPollBase')
        var pollMin  = _alertPref('ctxPollMin')
        var nextInterval
        if (est) {
          var r = Math.min(est.ratio, 1)
          nextInterval = Math.max(pollMin, Math.round(pollBase * Math.pow(1 - r, 2) + pollMin))
          // Precise mode: the event source pushes updates, so poll less often.
          if (tokenEstimate && tokenEstimate.source === 'precise') {
            nextInterval = Math.max(pollMin, nextInterval * 2)
          }
        } else if (tokenEstimate && tokenEstimate.source === 'precise') {
          // Usage but no confirmed window: poll at the floor so this model's own
          // window is picked up as soon as DSH reports it, instead of leaving
          // threshold monitoring dark for a whole base interval.
          nextInterval = pollMin
        } else {
          nextInterval = pollBase
        }
        timer = setTimeout(poll, nextInterval)
      }

      return {
        id: 'dsh-flash-ctx-mon:context-alert',
        start: function (cb, ctx) {
          callback = cb
          // Start the token source (reads session events)
          tokenSource = createSessionEventTokenSource()
          tokenSource.start(ctx)
          _activeTokenSource = tokenSource
          // A skill is used between polls, and the adaptive interval can be
          // longer than the freshness window a notice is judged against (base
          // 20s doubles to ~22s in precise mode). Poll as soon as the tracker
          // sees one, so the notice is claimed while the use is still fresh.
          if (_activeSkillTracker && typeof _activeSkillTracker.subscribe === 'function') {
            skillUnsub = _activeSkillTracker.subscribe(function () {
              if (!callback) return
              if (timer) { clearTimeout(timer); timer = null }
              poll()
            })
          }
          poll()
        },
        stop: function () {
          callback = null
          if (timer) { clearTimeout(timer); timer = null }
          if (skillUnsub) { try { skillUnsub() } catch (_) {} skillUnsub = null }
          if (tokenSource) { tokenSource.stop(); tokenSource = null }
          _activeTokenSource = null
        },
      }
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region ErrorBoundary ──────────────────────────────────────────────────

    class PanelErrorBoundary extends Component {
      constructor(props) {
        super(props)
        this.state = { hasError: false, error: null }
      }
      static getDerivedStateFromError(error) {
        return { hasError: true, error: error }
      }
      componentDidCatch(error, info) {
        console.error('[dsh-flash-ctx-mon] Panel render error (caught by boundary):', error, info)
      }
      render() {
        if (this.state.hasError) {
          return h('div', {
            style: {
              padding: '12px 16px',
              color: 'var(--dsw-alias-label-secondary, #8b949e)',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: '12px',
            },
          },
            h('div', { style: { marginBottom: '6px', color: 'var(--dsw-alias-label-warning, #d29922)' } },
              '⚠ ctx-mon render error'),
            h('div', null, String(this.state.error && this.state.error.message || this.state.error || 'Unknown error')),
            h('button', {
              style: {
                marginTop: '8px',
                padding: '2px 10px',
                fontSize: '11px',
                cursor: 'pointer',
                borderRadius: '4px',
                border: '1px solid var(--dsw-alias-border-l2, #21262d)',
                background: 'var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.85))',
                color: 'var(--dsw-alias-label-primary, #c9d1d9)',
              },
              onClick: function () { this.setState({ hasError: false, error: null }) }.bind(this),
            }, 'Retry'),
          )
        }
        return this.props.children
      }
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region Styles ─────────────────────────────────────────────────────────

    var R = {
      xs: 'var(--dsw-radius-xs, 4px)',
      sm: 'var(--dsw-radius-sm, 8px)',
      md: 'var(--dsw-radius-md, 12px)',
      lg: 'var(--dsw-radius-lg, 16px)',
      xl: 'var(--dsw-radius-xl, 20px)',
      panel: 'var(--dsw-radius-panel, 28px)',
    }
    var E = {
      prominent: 'var(--dsw-elevation-prominent, 0 0 0 0.5px var(--dsw-alias-border-l4, #0003), 0 3px 8px 0 rgba(0,0,0,.04), 0 0 20px 0 rgba(0,0,0,.05))',
    }

    var S = {
      // Parameter grid (used by MonitorConfigModal): two columns of
      // label-above-slider cells.
      paramGrid: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        columnGap: '16px',
        rowGap: '6px',
        alignItems: 'start',
      },
      paramCell: {
        minWidth: 0,
        marginBottom: '6px',
      },
      paramLabel: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '12px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
      },
      paramHint: {
        fontSize: '11px',
        lineHeight: '15px',
        opacity: 0.4,
        marginBottom: '2px',
      },
      switchIcon: {
        display: 'inline-flex',
        verticalAlign: '-2px',
        marginRight: '2px',
      },
      sliderRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minWidth: 0,
        marginTop: '2px',
      },
      slider: {
        flex: 1,
        minWidth: 0,
      },
      value: {
        fontSize: '11px',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        minWidth: '42px',
        textAlign: 'right',
      },
      autoRetryTextInput: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '4px 8px',
        borderRadius: R.sm,
        border: '0.5px solid var(--dsw-alias-border-l2, #0003)',
        background: 'var(--dsw-alias-bg-layer-1, #f5f5f5)',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        fontSize: '12px',
        lineHeight: '20px',
        marginTop: '2px',
      },
      // Monitor config modal
      monitorModalMask: {
        position: 'fixed',
        inset: 0,
        zIndex: 2200,
        background: 'var(--dsw-alias-bg-mask-1, #0000003d)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
      monitorModal: {
        background: 'var(--dsw-alias-bg-layer-2, #fff)',
        border: 0,
        borderRadius: R.panel,
        width: '90vw',
        maxWidth: '680px',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: E.prominent,
      },
      monitorModalHead: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        borderBottom: '0.5px solid var(--dsw-alias-border-l2, #0003)',
      },
      monitorModalTitle: {
        fontWeight: 500,
        fontSize: '16px',
        lineHeight: '24px',
        color: 'var(--dsw-alias-label-primary, #000)',
      },
      monitorModalClose: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '28px',
        height: '28px',
        border: 0,
        borderRadius: R.sm,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #61666b)',
        cursor: 'pointer',
        fontSize: '14px',
        padding: 0,
      },
      monitorModalBody: {
        flex: 1,
        overflowY: 'auto',
        padding: '10px 14px',
        scrollbarWidth: 'thin',
        scrollbarColor: 'var(--dsw-alias-scrollbar-bg-l1, #ccc) var(--dsw-alias-bg-layer-2, transparent)',
      },
      monitorModalDivider: {
        marginTop: '12px',
        paddingTop: '10px',
        borderTop: '0.5px solid var(--dsw-alias-border-l2, #0003)',
      },
      monitorModalSectionTitle: {
        display: 'block',
        fontWeight: 500,
        fontSize: '14px',
        lineHeight: '22px',
        marginBottom: '8px',
        color: 'var(--dsw-alias-label-secondary, #61666b)',
      },
      // Alert preview
      alertPreviewToggle: {
        background: 'none',
        border: 0,
        padding: 0,
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        fontSize: '12px',
      },
      // Fold toggles for the config-params and auto-retry sections — same
      // style as the alert-preview toggle, one pattern for every collapsible
      // section in the panel. Each sits directly under its own divider, so it
      // deliberately carries no extra top margin.
      sectionFoldToggle: {
        background: 'none',
        border: 0,
        padding: 0,
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        fontSize: '12px',
      },
      // The leading skills title, emphasized with the primary label color.
      skillsSectionTitle: {
        display: 'block',
        fontWeight: 500,
        fontSize: '14px',
        lineHeight: '22px',
        marginBottom: '8px',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
      },
      // Card behind the skills table when the section leads the panel: the
      // standard card plus a brand-colored rail, so the reason the panel was
      // opened is unmistakable at a glance.
      skillsLeadCard: {
        padding: '8px 12px',
        background: 'var(--dsw-alias-bg-layer-1, #f5f5f5)',
        borderRadius: R.md,
        borderLeft: '2px solid var(--dsw-alias-brand-primary, #58a6ff)',
      },
      alertPreviewCard: {
        padding: '8px 12px',
        background: 'var(--dsw-alias-bg-layer-1, #f5f5f5)',
        borderRadius: R.md,
        fontSize: '12px',
        lineHeight: '1.5',
      },
      alertPreviewGroup: {
        marginBottom: '8px',
      },
      alertPreviewRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginBottom: '2px',
      },
      alertPreviewIcon: {
        flex: 'none',
        fontSize: '11px',
      },
      alertPreviewMsg: {
        flex: 1,
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
      },
      alertPreviewCond: {
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        fontSize: '11px',
        opacity: 0.6,
      },
      // Context live data
      memColumnCard: {
        padding: '8px 12px',
        background: 'var(--dsw-alias-bg-layer-1, #f5f5f5)',
        borderRadius: R.md,
      },
      memSubSectionLabel: {
        display: 'block',
        fontWeight: 600,
        fontSize: '11px',
        marginBottom: '6px',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
      },
      tabPageChevron: {
        display: 'inline-block',
        fontSize: '8px',
        transition: 'transform 0.15s ease',
        transform: 'rotate(0deg)',
      },
      tabPageChevronOpen: {
        display: 'inline-block',
        fontSize: '8px',
        transition: 'transform 0.15s ease',
        transform: 'rotate(90deg)',
      },
      // Skills used in this session — header chip (session-scoped slot)
      skillChip: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        maxWidth: '240px',
        height: '24px',
        padding: '0 8px',
        border: '0.5px solid var(--dsw-alias-border-l2, #0003)',
        borderRadius: '999px',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #61666b)',
        fontSize: '12px',
        lineHeight: '22px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        cursor: 'pointer',
      },
      skillChipIcon: {
        flex: 'none',
        fontSize: '11px',
      },
      // Composer send-button indicator (§8b) — compact pill that sits right
      // before the submit action (conversation.input.right). Colors mirror the
      // resident flash-icon glow: green armed / orange scheduled / red paused.
      sendAutoRetryInd: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        height: '22px',
        padding: '0 8px',
        marginRight: '6px',
        border: '0.5px solid var(--dsw-alias-border-l2, #0003)',
        borderRadius: '999px',
        background: 'var(--dsw-color-panel-bg, rgba(255,255,255,.05))',
        color: 'var(--dsw-alias-label-secondary, #61666b)',
        fontSize: '11px',
        lineHeight: '20px',
        whiteSpace: 'nowrap',
        cursor: 'default',
        userSelect: 'none',
      },
      sendAutoRetryDot: {
        flex: 'none',
        width: '8px',
        height: '8px',
        borderRadius: '999px',
      },
      // Skills used in this session — detail rows in the config modal
      skillRow: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        padding: '6px 0',
        borderTop: '0.5px solid var(--dsw-alias-border-l1, #0002)',
      },
      skillRowHead: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '12px',
      },
      skillName: {
        fontFamily: 'var(--dsw-font-markdown-code-block-small, ui-monospace, monospace)',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        fontWeight: 500,
      },
      skillBadge: {
        flex: 'none',
        padding: '0 6px',
        borderRadius: '999px',
        background: 'var(--dsw-alias-bg-layer-2, #00000010)',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        fontSize: '10px',
        lineHeight: '16px',
      },
      skillMeta: {
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        fontSize: '11px',
      },
      skillDesc: {
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        fontSize: '11px',
        lineHeight: '1.5',
      },
      skillPathRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        minWidth: 0,
      },
      skillPath: {
        flex: 1,
        minWidth: 0,
        fontFamily: 'var(--dsw-font-markdown-code-block-small, ui-monospace, monospace)',
        fontSize: '10px',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        direction: 'rtl',
        textAlign: 'left',
      },
      skillOpenBtn: {
        flex: 'none',
        padding: '1px 8px',
        border: '0.5px solid var(--dsw-alias-border-l2, #0003)',
        borderRadius: R.xs,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        fontSize: '10px',
        cursor: 'pointer',
      },
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region MonitorConfigModal (context only) ──────────────────────────────

    var MONITOR_SLIDER_FIELDS = {
      context: [
        { key: 'ctxApproxWindow',     labelKey: 'ctxApproxWindow',     hintKey: 'ctxApproxWindowHint', min: 32768, max: 1048576, step: 32768, format: function (v) { return formatTokenK(v) } },
        { key: 'ctxThresholdInfo',    labelKey: 'ctxThresholdInfo',    tooltipKey: 'ctxThresholdInfoTip',    min: 30,    max: 80,     step: 1,    format: function (v) { return v + '%' } },
        { key: 'ctxThresholdWarning', labelKey: 'ctxThresholdWarning', tooltipKey: 'ctxThresholdWarningTip', min: 50,    max: 92,     step: 1,    format: function (v) { return v + '%' } },
        { key: 'ctxThresholdError',   labelKey: 'ctxThresholdError',   tooltipKey: 'ctxThresholdErrorTip',   min: 70,    max: 98,     step: 1,    format: function (v) { return v + '%' } },
        { key: 'ctxPollBase',         labelKey: 'ctxPollBase',         tooltipKey: 'ctxPollBaseTip',         min: 5000,  max: 60000,  step: 1000, format: _fmtSeconds },
        { key: 'ctxPollMin',          labelKey: 'ctxPollMin',          tooltipKey: 'ctxPollMinTip',          min: 1000,  max: 10000,  step: 500,  format: _fmtSeconds },
      ],
    }

    // Auto-Retry tuning slider fields — the five numeric scalars rendered in
    // the same stacked cell style as the context parameters. The time scalars
    // are stored as milliseconds but displayed in seconds.
    function _fmtSeconds(v) { return (Number(v) || 0) / 1000 + 's' }
    function _fmtCount(v) { return String(v) }

    var AUTO_RETRY_SLIDER_FIELDS = [
      { key: 'autoRetryGraceMs',        labelKey: 'autoRetryGraceMs',         tooltipKey: 'autoRetryGraceMsTip',         min: 1000,   max: 30000,   step: 500,   format: _fmtSeconds },
      { key: 'autoRetryCooldownMs',     labelKey: 'autoRetryCooldownMs',      tooltipKey: 'autoRetryCooldownMsTip',      min: 5000,   max: 120000,  step: 5000,  format: _fmtSeconds },
      { key: 'autoRetryMaxConsecutive', labelKey: 'autoRetryMaxConsecutive',  tooltipKey: 'autoRetryMaxConsecutiveTip',  min: 1,      max: 12,      step: 1,     format: _fmtCount },
      { key: 'autoRetryMaxBackoffMs',   labelKey: 'autoRetryMaxBackoffMs',    tooltipKey: 'autoRetryMaxBackoffMsTip',    min: 10000,  max: 900000,  step: 10000, format: _fmtSeconds },
      { key: 'autoRetryEchoWindowMs',   labelKey: 'autoRetryEchoWindowMs',    tooltipKey: 'autoRetryEchoWindowMsTip',    min: 5000,   max: 120000,  step: 1000,  format: _fmtSeconds },
    ]

    var MONITOR_TITLE_KEY = {
      context: 'alertCtxCluster',
    }

    var _monitorConfigRoot = null
    var _monitorConfigHost = null

    function closeMonitorConfig() {
      if (_monitorConfigRoot) { try { _monitorConfigRoot.unmount() } catch (_) {} _monitorConfigRoot = null }
      if (_monitorConfigHost) { try { _monitorConfigHost.remove() } catch (_) {} _monitorConfigHost = null }
    }

    function openMonitorConfig(monitor) {
      if (!ReactDOMClient || !ReactDOMClient.createRoot) return
      closeMonitorConfig()
      var host = document.createElement('div')
      host.style.cssText = 'position:fixed;inset:0;z-index:2200;'
      document.body.appendChild(host)
      _monitorConfigHost = host
      try {
        _monitorConfigRoot = ReactDOMClient.createRoot(host)
        _monitorConfigRoot.render(h(MonitorConfigModal, {
          monitor: monitor,
          onClose: closeMonitorConfig,
        }))
      } catch (e) {
        console.error('[dsh-flash-ctx-mon] failed to open monitor config:', e)
        closeMonitorConfig()
      }
    }

    /** React component: the per-monitor configuration popup. */
    function MonitorConfigModal(props) {
      var monitor = props.monitor
      var onClose = props.onClose
      var fields = MONITOR_SLIDER_FIELDS[monitor] || []
      var _tick = useState(0)
      var tick = _tick[0], setTick = _tick[1]

      // Configuration parameters and the alert preview are folded by default:
      // the panel is opened far more often to read this session's skills than
      // to move a slider, so the reference sections stay out of the way until
      // asked for.
      var _paramsFolded = useState(true)
      var paramsFolded = _paramsFolded[0], setParamsFolded = _paramsFolded[1]

      // Auto-Retry tuning is also a reference section — folded by default.
      var _autoFolded = useState(true)
      var autoFolded = _autoFolded[0], setAutoFolded = _autoFolded[1]

      // Close on Escape.
      useEffect(function () {
        function onKey(e) { if (e.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        return function () { document.removeEventListener('keydown', onKey) }
      }, [onClose])

      // Keep the auto-retry runner status live while the panel is open: the
      // 1s tick refreshes the cooldown / scheduled countdown badges below.
      useEffect(function () {
        var iv = setInterval(function () { setTick(function (v) { return v + 1 }) }, 1000)
        return function () { clearInterval(iv) }
      }, [])

      // Render one parameter cell: label (and optional hint) above the slider.
      // Stacked rather than label-left because a two-column grid leaves each
      // cell about 320px, which is not enough for a 120px label plus a usable
      // track once the labels wrap in English.
      function renderSliderField(f) {
        var val = Number(_alertPref(f.key)) || 0
        var hintEl = f.hintKey
          ? h('div', { style: S.paramHint }, t(f.hintKey))
          : null
        return h('div', { key: f.key, style: S.paramCell },
          h('div', { style: S.paramLabel },
            h('span', { style: S.switchIcon }, '⚙'),
            h('span', null, t(f.labelKey)),
          ),
          hintEl,
          h('div', { style: S.sliderRow },
            h('input', {
              type: 'range',
              min: f.min, max: f.max, step: f.step,
              value: val,
              style: S.slider,
              onChange: function (e) {
                var next = Number(e.target.value)
                _writeAlertPref(_prefCtx, f.key, next, function (patch, rollback) { rollback() })
                setTick(function (v) { return v + 1 })
              },
            }),
            h('span', { style: S.value }, f.format(val)),
          ),
        )
      }

      // ── Auto-retry runner live status (resident overlay, §6 of the design) ──
      function getRunnerView() {
        var src = _activeTokenSource
        if (!src || typeof src.getAutoRetryView !== 'function') return null
        try { return src.getAutoRetryView() || null } catch (_) { return null }
      }
      function fmtSeconds(ms) {
        var s = Math.max(0, Math.ceil((Number(ms) || 0) / 1000))
        if (s >= 60) { var m = Math.floor(s / 60); return m + 'm ' + (s % 60) + 's' }
        return s + 's'
      }
      function runnerCountdown(rv) {
        if (!rv) return null
        var now = Date.now()
        if (rv.state === 'scheduled' && rv.nextEmitAtMs != null && rv.nextEmitAtMs > now) {
          return { key: t('autoRetryScheduledLabel'), value: fmtSeconds(rv.nextEmitAtMs - now) }
        }
        if (rv.cooldownUntil && rv.cooldownUntil > now) {
          return { key: t('autoRetryCooldownLabel'), value: fmtSeconds(rv.cooldownUntil - now) }
        }
        return null
      }
      function runnerTrigger(which) {
        var src = _activeTokenSource
        if (!src || typeof src[which] !== 'function') return
        try { src[which]() } catch (_) {}
        setTick(function (v) { return v + 1 })
      }

      var runnerView = getRunnerView()
      var runnerState = runnerView && runnerView.state ? runnerView.state : 'stopped'
      var runnerStateText = {
        stopped: t('autoRetryStateStopped'),
        armed: t('autoRetryStateArmed'),
        scheduled: t('autoRetryStateScheduled'),
        paused: t('autoRetryStatePaused'),
      }[runnerState] || t('autoRetryStateStopped')
      var runnerStateColor = {
        stopped: '#868e96',
        armed: '#2f9e44',
        scheduled: '#e8590c',
        paused: '#e03131',
      }[runnerState] || '#868e96'
      var runnerAtt = null
      if (runnerView) {
        var _max = Number(runnerView.maxConsecutive) || 0
        var _rem = runnerView.remaining
        var _idx = runnerView.attemptIndex != null
          ? runnerView.attemptIndex
          : (_rem != null && _max > 0 ? String(Math.max(0, _max - _rem)) : '?')
        runnerAtt = t('autoRetryAccumLabel') + ' ' + _idx + '/' + _max
      }
      var runnerCd = runnerCountdown(runnerView)
      // Arm is meaningful when the guard is OFF (stopped — normal turn-on) or
      // parked for the burn limit (paused / armed with no budget left — clicking
      // re-seeds via armAutoRetry(true), the user's explicit re-open). It is
      // disabled only when there is nothing to arm: no view/source, a continue
      // already queued (scheduled), or an actively-armed runner that still has
      // budget left to spend.
      var armDisabled = !runnerView || runnerState === 'scheduled'
        || (runnerState === 'armed' && runnerView.remaining != null && Number(runnerView.remaining) > 0)
      var disarmDisabled = !runnerView || runnerState === 'stopped'
      var RUNNER_MUTED = { fontSize: '12px', color: '#868e96', marginRight: '8px' }
      var RUNNER_BTN = {
        border: '1px solid currentColor',
        borderRadius: '4px',
        padding: '3px 10px',
        fontSize: '11px',
        lineHeight: '1.5',
        background: 'transparent',
        marginRight: '8px',
      }
      var autoRetryRunnerEl = h('div', { key: 'auto-retry-runner-status' },
        h('div', { style: S.memSubSectionLabel }, t('autoRetryRunnerSection')),
        h('div', { style: { marginTop: '6px', display: 'flex', alignItems: 'center', flexWrap: 'wrap' } },
          h('span', {
            style: {
              display: 'inline-block',
              border: '1px solid ' + runnerStateColor,
              color: runnerStateColor,
              borderRadius: '999px',
              padding: '1px 8px',
              fontSize: '11px',
              marginRight: '8px',
            },
          }, runnerStateText),
          runnerAtt ? h('span', { style: RUNNER_MUTED }, runnerAtt) : null,
          runnerCd ? h('span', { style: RUNNER_MUTED }, runnerCd.key + ' ' + runnerCd.value) : null,
        ),
        h('div', { style: { marginTop: '8px', display: 'flex', alignItems: 'center' } },
          h('button', {
            type: 'button',
            style: Object.assign({}, RUNNER_BTN, { color: '#2f9e44', opacity: armDisabled ? 0.45 : 1, cursor: armDisabled ? 'not-allowed' : 'pointer' }),
            disabled: armDisabled,
            onClick: function () { runnerTrigger('armAutoRetry') },
          }, t('autoRetryArmNow')),
          h('button', {
            type: 'button',
            style: Object.assign({}, RUNNER_BTN, { color: '#e03131', opacity: disarmDisabled ? 0.45 : 1, cursor: disarmDisabled ? 'not-allowed' : 'pointer' }),
            disabled: disarmDisabled,
            onClick: function () { runnerTrigger('disarmAutoRetry') },
          }, t('autoRetryDisarm')),
        ),
      )

      // Configuration parameters — folded by default, like the alert preview.
      var fieldEls = h('div', { key: 'ctx-params-section' },
        // The skills section leads the body for the context monitor, so the
        // rule belongs on top of this section; without it this is the first
        // child and the rule would double the header border.
        monitor === 'context' ? h('div', { style: S.monitorModalDivider }) : null,
        h('button', {
          type: 'button',
          style: S.sectionFoldToggle,
          onClick: function () { setParamsFolded(function (v) { return !v }) },
        },
          (paramsFolded ? '▸ ' : '▾ ') + t('ctxParamsSection'),
        ),
        !paramsFolded
          ? h('div', { style: Object.assign({}, S.paramGrid, { marginTop: '10px' }) }, fields.map(renderSliderField))
          : null,
      )

      // Auto-Retry tuning — the resident continue/stop runner's safety scalars
      // plus the exact continue text it resends. Folded by default like the
      // rest of the reference sections.
      var continueText = _alertStr('autoRetryContinueText')
      var autoRetryEl = h('div', { key: 'ctx-auto-retry-section' },
        h('div', { style: S.monitorModalDivider }),
        h('button', {
          type: 'button',
          style: S.sectionFoldToggle,
          onClick: function () { setAutoFolded(function (v) { return !v }) },
        },
          (autoFolded ? '▸ ' : '▾ ') + t('ctxAutoRetrySection'),
        ),
        !autoFolded
          ? h('div', { style: Object.assign({}, S.paramGrid, { marginTop: '10px' }) },
              AUTO_RETRY_SLIDER_FIELDS.map(renderSliderField),
              h('div', { key: 'autoRetryContinueText', style: S.paramCell },
                h('div', { style: S.paramLabel },
                  h('span', { style: S.switchIcon }, '✎'),
                  h('span', null, t('autoRetryContinueText')),
                ),
                h('input', {
                  type: 'text',
                  style: S.autoRetryTextInput,
                  value: continueText,
                  placeholder: _CTX_ALERT_DEFAULTS.autoRetryContinueText,
                  onChange: function (e) {
                    _writeAlertPref(_prefCtx, 'autoRetryContinueText', e.target.value, function (patch, rollback) { rollback() })
                    setTick(function (v) { return v + 1 })
                  },
                }),
              ),
              autoRetryRunnerEl,
            )
          : null,
      )

      // ── Alert preview section ──────────────────────────────────────────
      var _showPreview = useState(false)
      var showPreview = _showPreview[0], setShowPreview = _showPreview[1]

      var alertPreviewEl = null
      if (monitor === 'context') {
        var alertRows = []

        // ── Context ratio ──
        var _cI = _alertPref('ctxThresholdInfo')
        var _cW = _alertPref('ctxThresholdWarning')
        var _cE = _alertPref('ctxThresholdError')
        if (!(_cI < _cW && _cW < _cE)) { _cI = 70; _cW = 85; _cE = 95 }

        alertRows.push(
          h('div', { key: 'ctx', style: S.alertPreviewGroup },
            h('div', { style: S.alertPreviewRow },
              h('span', { style: S.alertPreviewIcon }, '🔵'),
              h('span', { style: S.alertPreviewMsg }, t('alertContextInfo')),
              h('span', { style: S.alertPreviewCond }, '≥ ' + _cI + '%'),
            ),
            h('div', { style: S.alertPreviewRow },
              h('span', { style: S.alertPreviewIcon }, '🟡'),
              h('span', { style: S.alertPreviewMsg }, t('alertContextWarning')),
              h('span', { style: S.alertPreviewCond }, '≥ ' + _cW + '%'),
            ),
            h('div', { style: S.alertPreviewRow },
              h('span', { style: S.alertPreviewIcon }, '🔴'),
              h('span', { style: S.alertPreviewMsg }, t('alertContextError')),
              h('span', { style: S.alertPreviewCond }, '≥ ' + _cE + '%'),
            ),
          ),
        )

        alertPreviewEl = h('div', { key: 'alert-preview' },
          h('div', { style: S.monitorModalDivider }),
          h('button', {
            type: 'button',
            style: S.alertPreviewToggle,
            onClick: function () { setShowPreview(function (v) { return !v }) },
          },
            (showPreview ? '▾ ' : '▸ ') + t('alertPreviewToggle'),
          ),
          showPreview ? h('div', { style: Object.assign({}, S.alertPreviewCard, { marginTop: '6px' }) },
            alertRows,
          ) : null,
        )
      }

      // ── Skills used in this session (detail section) ───────────────────
      // The alert and the header chip both open THIS modal, so this is the
      // detail page: it carries everything the one-line summaries cannot.
      var skillSectionEl = null
      if (monitor === 'context') {
        skillSectionEl = h(SessionSkillsSection, { key: 'ctx-skills-section', lead: true })
      }

      return h('div', {
        style: S.monitorModalMask,
        onMouseDown: function (e) { if (e.target === e.currentTarget) onClose() },
      },
        h('div', { style: S.monitorModal },
          // Header
          h('div', { style: S.monitorModalHead },
            h('span', { style: S.monitorModalTitle },
              t(MONITOR_TITLE_KEY[monitor] || 'alertCtxCluster') + ' — ' + t('monitorConfig')),
            h('button', {
              type: 'button',
              'data-dock-flash-focus': '',
              style: S.monitorModalClose,
              onClick: onClose,
            }, '✕'),
          ),
          // Body: session skills first (the reason this panel is usually
          // opened), then the folded reference sections below it.
          h('div', { style: S.monitorModalBody },
            skillSectionEl,
            fieldEls,
            autoRetryEl,
            alertPreviewEl,
          ),
        ),
      )
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region Skills UI (header chip + detail section) ───────────────────────

    // Two surfaces, one data source (the SessionSkillTracker):
    //   - the header chip (session-scoped slot) — the always-on summary;
    //   - the detail section inside the config modal — everything else.
    // Both open the same modal, and both are keyed by the session they are
    // rendering for, so neither can show another session's skills.

    /** Skill-catalog cache, keyed by session id. Only holds sessions we were
     *  asked about, and never merges two sessions' catalogs. */
    var _skillCatalogCache = {}

    /** Build a dsh-resource:// file address. Mirrors the utility DSH ships in
     *  @deepseek-ai/dsh-util-workspace-path (component-encoded, `:` kept
     *  literal for drive letters) so `sidebarRight.openResource` accepts it. */
    function encodeSkillPathSegment(segment) {
      return encodeURIComponent(segment).replace(/%3A/gi, ':')
    }

    function fileAddressForSession(sessionId, cwd, path) {
      var normalized = String(path).replace(/\\/g, '/')
      var root = (typeof cwd === 'string' && cwd) ? cwd.replace(/\\/g, '/').replace(/\/+$/, '') : ''
      var relative = normalized
      if (root && normalized.indexOf(root + '/') === 0) relative = normalized.slice(root.length + 1)
      var encoded = relative.split('/').map(encodeSkillPathSegment).join('/')
      return 'dsh-resource://file/session/' + encodeSkillPathSegment(sessionId) + '/' + encoded
    }

    /**
     * Fetch the skill catalog for one session.
     *
     * Mirrors the first-party path in @deepseek-ai/dsh-client-ui-skill, because
     * the host serves skills/list only for a session that is retained AND fully
     * open. The first-party code retains with `sessions.using()`, which awaits
     * the session's initial history open before the RPC goes out; testing
     * `openState` once and giving up otherwise loses the race against a session
     * whose tail page is still loading ('cold' → 'loading' → 'open').
     *
     * Resolves to `{ skills }` on success or `{ error }` naming the exact
     * reason, so the panel can say WHICH failure happened instead of a blanket
     * "catalog unavailable". A failure is never cached — reopening the panel
     * (or pressing retry) tries again.
     */
    function fetchSkillCatalog(ctx, sessionId) {
      if (!ctx || !sessionId) return Promise.resolve({ error: 'no-session' })
      var cached = _skillCatalogCache[sessionId]
      if (cached) return cached.promise

      // Bound the cache: sessions come and go, and a catalog is only held to
      // serve the panel that asked for it.
      var cachedIds = Object.keys(_skillCatalogCache)
      if (cachedIds.length >= 8) delete _skillCatalogCache[cachedIds[0]]

      var entry = { skills: null, error: null }
      _skillCatalogCache[sessionId] = entry

      function fail(reason) {
        delete _skillCatalogCache[sessionId]
        entry.error = reason
        try { console.warn('[dsh-flash-ctx-mon] skill catalog unavailable: ' + reason) } catch (_) {}
        return { error: reason }
      }

      entry.promise = (function () {
        var remote = resolveRemoteNamespace(ctx, 'skills')
        if (!remote || typeof remote.list !== 'function') return Promise.resolve(fail('no remote.skills namespace'))

        var sessions = null
        try { sessions = ctx.get('sessions') } catch (_) {}
        if (!sessions || typeof sessions.using !== 'function' || typeof sessions.binding !== 'function') {
          return Promise.resolve(fail('no sessions service'))
        }
        // An unretained session rejects without sending the RPC at all.
        try {
          if (sessions.binding(sessionId) === undefined) return Promise.resolve(fail('session not retained'))
        } catch (_) {
          return Promise.resolve(fail('session lookup threw'))
        }

        var signal
        try { signal = new AbortController().signal } catch (_) { signal = undefined }

        return Promise.resolve()
          .then(function () {
            return sessions.using(sessionId, { source: 'skillCatalog', signal: signal }, function (reference) {
              var state = reference.binding.session.getSnapshot()
              if (state.openState !== 'open') {
                // `using` already awaited this; reaching here means the open
                // genuinely failed rather than merely being in flight.
                return { error: 'session ' + state.openState + (state.openError ? ': ' + state.openError : '') }
              }
              return Promise.resolve(remote.list({ sessionId: sessionId }, signal)).then(function (result) {
                if (result && result.ok && result.value && Array.isArray(result.value.skills)) {
                  return { skills: result.value.skills }
                }
                var err = (result && result.error) || {}
                return { error: 'rpc ' + (err.code || 'failed') + (err.message ? ': ' + err.message : '') }
              })
            })
          })
          .then(function (outcome) {
            if (!outcome || outcome.error) return fail((outcome && outcome.error) || 'unknown')
            entry.skills = outcome.skills
            return outcome
          }, function (e) {
            return fail('threw: ' + ((e && e.message) || String(e)))
          })
      })()
      return entry.promise
    }

    function openSkillFileInSidebar(ctx, sessionId, path) {
      if (!ctx || !sessionId || !path) return false
      var sidebar = null
      try { sidebar = ctx.get('sidebarRight') } catch (_) {}
      if (!sidebar || typeof sidebar.openResource !== 'function') return false
      var cwd = ''
      try {
        var sessions = ctx.get('sessions')
        var row = sessions.list.getSnapshot().byId[sessionId]
        if (row && typeof row.cwd === 'string') cwd = row.cwd
      } catch (_) {}
      try {
        sidebar.openResource(fileAddressForSession(sessionId, cwd, path))
        return true
      } catch (e) {
        console.warn('[dsh-flash-ctx-mon] failed to open skill file in sidebar:', e)
        return false
      }
    }

    /** The chip's one-line summary — shared by the header chip and its tab-strip twin. */
    function skillChipSummary(skills) {
      var names = []
      for (var i = 0; i < skills.length; i++) names.push(skills[i].name)
      return {
        names: names,
        label: skills.length === 1 ? names[0] : names[0] + ' +' + (skills.length - 1),
      }
    }

    // ── The same chip, on the session tab strip ─────────────────────────────
    //
    // Why DOM injection instead of a slot: the strip the user means is
    // `[data-conversation-tabs]` (dsh-client-ui-conversation), rendered as
    // `tabs.map(...)` — plain React output with no slot inside it. Its only
    // slots (.actions/.utilities/.corner) all live in the title row we are
    // leaving, and `conversation.view` is a whole page, not a corner of a bar.
    // So the chip is appended to the strip itself.
    //
    // Why that is safe enough: the strip is a plain flex row of buttons with a
    // 36px gap and `position: relative`, so one more child costs the framework
    // no layout it did not already have — and the chip hides itself while empty
    // so that gap never appears. React never learns about the appended node, so
    // it cannot reconcile it away, and `order` keeps it at the right end even
    // if a tab button is appended after it.
    //
    // Which session a strip belongs to is never guessed: the strip is rendered
    // by the same header component as the slot the header chip renders in, so
    // walking up from that chip's own (hidden) anchor finds exactly this
    // session's strip — a subagent's chip can never land on its parent's bar.
    var TABS_STRIP_SELECTOR = '[data-conversation-tabs]'
    var CHIP_HOST_ATTR = 'data-dsh-flash-ctx-mon-chip'
    var SKILLS_TAB_CHIP_STYLE = Object.assign({}, S.skillChip, {
      // Directly after the last view tab, inside the strip's own 36px gap plus a
      // little more: enough distance to read as a status pill rather than one
      // more tab, and it stays next to the tabs instead of drifting to the far
      // right edge where it goes unnoticed.
      alignSelf: 'center',
      maxWidth: '208px',
      flex: 'none',
      marginLeft: '12px',
    })

    /**
     * findSessionStrip — the tab strip of the session whose header holds `anchor`.
     *
     * The nearest ancestor containing exactly one strip is that header's own
     * container, since the strip is a sibling of the title row inside the header.
     * An ancestor holding more than one strip is shared with another session, so
     * we give up there: keeping the chip in the header beats putting it on the
     * wrong bar.
     */
    function findSessionStrip(anchor) {
      var node = anchor.parentElement
      while (node && node !== document.body) {
        var strips = node.querySelectorAll(TABS_STRIP_SELECTOR)
        if (strips.length === 1) return strips[0]
        if (strips.length > 1) return null
        node = node.parentElement
      }
      return null
    }

    /** The chip currently living on each session's tab strip, by session id. */
    var _skillsChipHosts = {}

    function disposeSkillsChipHost(sessionId) {
      var record = _skillsChipHosts[sessionId]
      if (!record) return
      delete _skillsChipHosts[sessionId]
      if (record.root) {
        try { record.root.unmount() } catch (_) {}
      }
      if (record.host && record.host.parentNode) record.host.parentNode.removeChild(record.host)
    }

    /**
     * placeSkillsChipAfterTabs — keep the chip immediately after the last tab.
     *
     * React owns the tab buttons and only re-inserts its own nodes, so our
     * untracked chip survives a re-render; this re-asserts its position after a
     * strip is repopulated or another tab is appended.
     */
    function placeSkillsChipAfterTabs(strip, host) {
      if (strip.lastChild === host) return
      strip.appendChild(host)
    }

    /**
     * hostSkillsChip — mount (or re-adopt) this session's chip on `strip`.
     *
     * Returns false when there is no ReactDOM root to mount into, so the caller
     * can keep showing the header chip instead of losing the information.
     */
    function hostSkillsChip(sessionId, strip, anchor) {
      var record = _skillsChipHosts[sessionId]
      if (record && record.strip === strip && record.host && record.host.parentNode === strip) {
        placeSkillsChipAfterTabs(strip, record.host)
        record.anchor = anchor
        return true
      }
      if (!ReactDOMClient || !ReactDOMClient.createRoot) return false
      if (record) disposeSkillsChipHost(sessionId)
      var host = document.createElement('button')
      host.type = 'button'
      host.setAttribute(CHIP_HOST_ATTR, '')
      for (var key in SKILLS_TAB_CHIP_STYLE) {
        if (Object.prototype.hasOwnProperty.call(SKILLS_TAB_CHIP_STYLE, key)) {
          host.style[key] = SKILLS_TAB_CHIP_STYLE[key]
        }
      }
      // Empty until the chip has something to say: the strip is a flex row, so
      // an empty child would still pay its gap.
      host.style.display = 'none'
      host.onclick = function () { openMonitorConfig('context') }
      var root = ReactDOMClient.createRoot(host)
      root.render(h(SkillsTabChip, { sessionId: sessionId, host: host }))
      placeSkillsChipAfterTabs(strip, host)
      _skillsChipHosts[sessionId] = {
        sessionId: sessionId,
        strip: strip,
        host: host,
        root: root,
        anchor: anchor,
      }
      return true
    }

    /**
     * syncSkillsChipHosts — put every displaced chip back.
     *
     * A tab strip is recreated whenever a session's view list crosses the
     * one-view/two-view boundary, which detaches the chip along with it. Each
     * record keeps the anchor it was mounted from, so a new strip can be found
     * even when the header chip itself does not re-render.
     */
    function syncSkillsChipHosts() {
      Object.keys(_skillsChipHosts).forEach(function (sessionId) {
        var record = _skillsChipHosts[sessionId]
        if (!record.anchor || !record.anchor.isConnected) {
          disposeSkillsChipHost(sessionId)
          return
        }
        if (record.host && record.strip && record.strip.isConnected &&
            record.host.parentNode === record.strip &&
            record.strip.lastChild === record.host) {
          return
        }
        var strip = findSessionStrip(record.anchor)
        if (strip) hostSkillsChip(sessionId, strip, record.anchor)
        else disposeSkillsChipHost(sessionId)
      })
    }

    // A strip appearing or disappearing moves the chip's home, and a tab added
    // inside an existing strip belongs after the chip's slot — so the touched
    // strip is checked too, rather than every mutation target. Streaming
    // transcript text then costs one small match per added node, and our own
    // reposition settles in a single extra sweep.
    function subtreeHasStrip(node) {
      if (!node || node.nodeType !== 1) return false
      if (node.matches && node.matches(TABS_STRIP_SELECTOR)) return true
      return !!(node.querySelector && node.querySelector(TABS_STRIP_SELECTOR))
    }

    function skillsChipMutationMatters(records) {
      for (var i = 0; i < records.length; i++) {
        var target = records[i].target
        if (target && target.nodeType === 1 && target.matches &&
            target.matches(TABS_STRIP_SELECTOR)) return true
        var nodes = records[i].addedNodes
        for (var a = 0; a < nodes.length; a++) if (subtreeHasStrip(nodes[a])) return true
        nodes = records[i].removedNodes
        for (var r = 0; r < nodes.length; r++) if (subtreeHasStrip(nodes[r])) return true
      }
      return false
    }

    var _skillsChipObserver = null
    var _skillsChipSweepPending = false

    /** Watch for tab strips being rebuilt, coalescing a sweep into one frame. */
    function startSkillsChipObserver() {
      if (_skillsChipObserver || typeof MutationObserver !== 'function' || !document.body) return
      _skillsChipObserver = new MutationObserver(function (records) {
        if (_skillsChipSweepPending || !skillsChipMutationMatters(records)) return
        _skillsChipSweepPending = true
        var run = function () {
          _skillsChipSweepPending = false
          syncSkillsChipHosts()
        }
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
        else setTimeout(run, 16)
      })
      _skillsChipObserver.observe(document.body, { childList: true, subtree: true })
    }

    function stopSkillsChipObserver() {
      if (_skillsChipObserver) {
        try { _skillsChipObserver.disconnect() } catch (_) {}
        _skillsChipObserver = null
      }
      Object.keys(_skillsChipHosts).forEach(function (sessionId) {
        disposeSkillsChipHost(sessionId)
      })
    }

    /**
     * SkillChip — the summary in the session header, or the bridge to the tab
     * strip.
     *
     * The chip would rather live on its session's tab strip (see
     * hostSkillsChip): that bar exists for the conversation alone, while the
     * header row is re-laid out constantly by a title, a breadcrumb and an
     * action set that all change on their own schedule. A strip needs at least
     * two conversation views, so this header chip is the answer everywhere
     * else. Either way the component renders a hidden anchor, which is what
     * tells the host which strip belongs to which session.
     *
     * Session isolation is structural: the slot framework hands the component
     * the id of the session it is rendering for, and every read goes through
     * `getSkillsFor(thatId)`, which returns [] for anything but the tracked
     * session. When the id is absent we render nothing rather than guess — a
     * wrong guess would print the main view's skills inside a subagent's
     * header.
     */
    function SkillChip(props) {
      var sessionId = props.sessionId
      var _tick = useState(0)
      var setTick = _tick[1]
      var anchorRef = useRef(null)
      var _hosted = useState(false)
      var hosted = _hosted[0]
      var setHosted = _hosted[1]

      useEffect(function () {
        var tracker = _activeSkillTracker
        if (!tracker || typeof tracker.subscribe !== 'function') return undefined
        return tracker.subscribe(function () { setTick(function (v) { return v + 1 }) })
      }, [])

      // Bind the auto-continue runner and skill tracker to the session this
      // chip is rendering for. The host exposes no enumerable session list, so
      // the slot-injected `props.sessionId` is the authoritative "current
      // session". Only a session with skills shown here mounts — the runner
      // (and the quick switch's arm/disarm) then always targets an
      // actually-open session.
      //
      // The id is written to the module-scope injected register UNCONDITIONALLY
      // (not only when a live source exists): a chip can mount before the
      // provider has created the token/skill sources, and with deps `[sessionId]`
      // this effect never re-runs afterwards. The register is what lets a
      // later-starting source pick the id up instead of losing it forever.
      useEffect(function () {
        if (!sessionId) return
        _injectedSessionId = sessionId
        if (_activeTokenSource && typeof _activeTokenSource.setSessionId === 'function') {
          _activeTokenSource.setSessionId(sessionId)
        }
        if (_activeSkillTracker && typeof _activeSkillTracker.setSessionId === 'function') {
          _activeSkillTracker.setSessionId(sessionId)
        }
      }, [sessionId])

      // Layout effect: which bar this session's chip belongs on has to be
      // settled before the browser paints, so that a session with a tab strip
      // never flashes a pill in its header first.
      React.useLayoutEffect(function () {
        var anchor = anchorRef.current
        var strip = (anchor && sessionId) ? findSessionStrip(anchor) : null
        var ok
        if (strip) {
          ok = hostSkillsChip(sessionId, strip, anchor)
        } else {
          // No strip here. If this very anchor is the one that mounted the
          // chip, the strip went away (one view left) and the header takes it
          // back; otherwise another header owns it for this session.
          var record = sessionId ? _skillsChipHosts[sessionId] : null
          if (record && record.anchor === anchor) {
            disposeSkillsChipHost(sessionId)
            ok = false
          } else {
            ok = !!record
          }
        }
        setHosted(function (was) { return was === ok ? was : ok })
      })

      var tracker = _activeSkillTracker
      var skills = (tracker && sessionId) ? tracker.getSkillsFor(sessionId) : []
      if (!skills.length) return null

      var summary = skillChipSummary(skills)
      var hiddenAnchor = h('span', {
        key: 'skills-anchor',
        ref: anchorRef,
        'data-dsh-flash-ctx-mon-anchor': '',
        style: { display: 'none' },
      })

      if (hosted) return hiddenAnchor

      return h(React.Fragment, null,
        hiddenAnchor,
        h('button', {
          type: 'button',
          style: S.skillChip,
          title: summary.names.join('\n') + '\n' + t('ctxSkillsSection'),
          onClick: function () { openMonitorConfig('context') },
        },
          h('span', { style: S.skillChipIcon }, '🧩'),
          h('span', null, summary.label),
        ),
      )
    }

    /**
     * SendAutoRetryIndicator — the auto-continue ACTIVE state on the composer
     * send button. Rendered into the host's `conversation.input.right` slot,
     * which sits immediately before the submit action (right of the text entry,
     * in front of the send button) — the one place the resident flash-icon glow
     * cannot reach, because that icon lives inside the floating dock where the
     * composer route is clipped.
     *
     * Visibility is structural and session-safe:
     *   - the slot framework hands us the `sessionId` this composer belongs to;
     *   - we read the CURRENT view fresh on every render via
     *     `_activeTokenSource.getAutoRetryView()` (authoritative, never stale);
     *   - we render only when `view.sessionId === props.sessionId` AND the state
     *     is active (armed / scheduled / paused), so a stopped session shows
     *     nothing and one composer never shows another session's state.
     *
     * A module-local subscription (`_subscribeAutoRetryView`) drives re-render
     * on each publish — the same no-racing channel the overlay uses, exposed as
     * a plain pub/sub rather than options polling.
     */
    function SendAutoRetryIndicator(props) {
      var sessionId = props.sessionId
      var _tick = useState(0)
      var setTick = _tick[1]

      useEffect(function () {
        return _subscribeAutoRetryView(function () { setTick(function (v) { return v + 1 }) })
      }, [])

      var src = _activeTokenSource
      var view = null
      if (src && typeof src.getAutoRetryView === 'function') {
        try { view = src.getAutoRetryView() || null } catch (_) { view = null }
      }
      if (!view || !sessionId) return null
      if (view.sessionId !== sessionId) return null
      var state = view.state
      if (state !== 'armed' && state !== 'scheduled' && state !== 'paused') return null

      var idx = view.attemptIndex || 0
      var max = view.maxConsecutive || 0
      var counter = max > 0 ? (idx + '/' + max) : null

      var content = state === 'armed' ? t('autoRetrySendArmed')
        : state === 'scheduled' ? t('autoRetrySendScheduled')
        : t('autoRetrySendPaused')
      var color = state === 'armed' ? 'rgba(47,158,68,1)'
        : state === 'scheduled' ? 'rgba(232,89,12,1)'
        : 'rgba(224,49,49,1)'
      var isPaused = state === 'paused'

      var buttonProps = {
        type: 'button',
        'data-dsh-flash-ctx-mon-send-ind': '1',
        'data-state': state,
        title: isPaused ? t('autoRetryRearmHint') : t('autoRetryHint'),
        'aria-label': isPaused ? t('autoRetryRearmHint') : t('autoRetryHint'),
        style: isPaused ? Object.assign({}, S.sendAutoRetryInd, { cursor: 'pointer' }) : S.sendAutoRetryInd,
      }
      if (isPaused) {
        buttonProps.onClick = function (ev) {
          ev.preventDefault(); ev.stopPropagation()
          try { _armAutoRetry(true) } catch (_) {}
        }
      }

      return h('button', buttonProps,
        h('span', { style: Object.assign({}, S.sendAutoRetryDot, { background: color }) }),
        h('span', null, content),
        counter ? h('span', { style: { fontWeight: '700' } }, counter) : null,
      )
    }

    /**
     * SkillsTabChip — the chip rendered into a session tab strip by
     * hostSkillsChip.
     *
     * `host` is the strip-owned button this renders into. Visibility is driven
     * from here rather than from the return value alone, because the host
     * element itself has to disappear: a flex child that merely renders null
     * would still pay the strip's 36px gap.
     */
    function SkillsTabChip(props) {
      var sessionId = props.sessionId
      var host = props.host
      var _tick = useState(0)
      var setTick = _tick[1]

      useEffect(function () {
        var tracker = _activeSkillTracker
        if (!tracker || typeof tracker.subscribe !== 'function') return undefined
        return tracker.subscribe(function () { setTick(function (v) { return v + 1 }) })
      }, [])

      var tracker = _activeSkillTracker
      var skills = (tracker && sessionId) ? tracker.getSkillsFor(sessionId) : []
      var summary = skills.length ? skillChipSummary(skills) : null

      // Layout effect, not effect: an empty pill must be hidden before the
      // browser paints it, and the tooltip/label change with the same render.
      React.useLayoutEffect(function () {
        if (!host) return
        host.style.display = summary ? SKILLS_TAB_CHIP_STYLE.display : 'none'
        if (!summary) {
          host.removeAttribute('title')
          host.removeAttribute('aria-label')
          return
        }
        host.setAttribute('title', summary.names.join('\n') + '\n' + t('ctxSkillsSection'))
        host.setAttribute('aria-label', t('ctxSkillsSection') + ': ' + summary.names.join(', '))
      })

      if (!summary) return null

      return h(React.Fragment, null,
        h('span', { style: S.skillChipIcon }, '🧩'),
        h('span', null, summary.label),
      )
    }

    /**
     * SessionSkillsSection — the detail page for a session's skills.
     *
     * Everything the one-line alert/chip cannot carry: how each skill was
     * invoked, how often, when it was first and last loaded, plus the catalog
     * description and SKILL.md path (fetched lazily, per session, only while
     * this modal is open).
     *
     * It reads the tracker directly and subscribes, so a skill used while the
     * modal is open appears without reopening it.
     */
    function SessionSkillsSection(props) {
      // `lead` — rendered as the first section of the modal body: no top rule
      // (there is nothing above it to separate from) and an emphasized title,
      // because this is the section the panel is opened for.
      var lead = !!(props && props.lead)
      var _tick = useState(0)
      var setTick = _tick[1]

      useEffect(function () {
        var tracker = _activeSkillTracker
        if (!tracker || typeof tracker.subscribe !== 'function') return undefined
        return tracker.subscribe(function () { setTick(function (v) { return v + 1 }) })
      }, [])

      var tracker = _activeSkillTracker
      var sessionId = tracker ? tracker.getSessionId() : null
      var skills = tracker ? tracker.getSkills() : []

      var _cat = useState({ status: 'idle', byName: null, error: null })
      var cat = _cat[0], setCat = _cat[1]
      // Bumped by the retry button to re-run the fetch below.
      var _reload = useState(0)
      var reload = _reload[0], setReload = _reload[1]

      useEffect(function () {
        if (!sessionId || !skills.length) { setCat({ status: 'idle', byName: null, error: null }); return undefined }
        var alive = true
        setCat({ status: 'loading', byName: null, error: null })
        fetchSkillCatalog(_prefCtx, sessionId).then(function (outcome) {
          if (!alive) return
          var list = outcome && outcome.skills
          if (!list) {
            setCat({ status: 'failed', byName: null, error: (outcome && outcome.error) || 'unknown' })
            return
          }
          var byName = {}
          for (var i = 0; i < list.length; i++) {
            var sk = list[i]
            if (sk && typeof sk.name === 'string') byName[sk.name] = sk
          }
          setCat({ status: 'ready', byName: byName, error: null })
        })
        return function () { alive = false }
      }, [sessionId, skills.length, reload])

      function fmtTime(ms) {
        if (!ms) return '—'
        try { return new Date(ms).toLocaleString() } catch (_) { return '—' }
      }

      var rows = []
      for (var i = 0; i < skills.length; i++) {
        var sk = skills[i]
        var via = []
        if (sk.viaModel > 0) via.push(t('ctxSkillsViaModel') + (sk.viaModel > 1 ? ' ×' + sk.viaModel : ''))
        if (sk.viaUser > 0) via.push(t('ctxSkillsViaUser') + (sk.viaUser > 1 ? ' ×' + sk.viaUser : ''))

        var meta = h('div', { style: S.skillMeta },
          t('ctxSkillsCount') + ' ' + sk.count + ' · ' +
          t('ctxSkillsFirst') + ' ' + fmtTime(sk.firstTime) + ' · ' +
          t('ctxSkillsLast') + ' ' + fmtTime(sk.lastTime),
        )

        var catEntry = cat.status === 'ready' && cat.byName ? cat.byName[sk.name] : null
        var descEl = null
        if (cat.status === 'ready') {
          var desc = catEntry && typeof catEntry.description === 'string' ? catEntry.description.trim() : ''
          descEl = h('div', { style: S.skillDesc }, desc || t('ctxSkillsNoDesc'))
        } else if (cat.status === 'loading') {
          descEl = h('div', { style: S.skillDesc }, t('ctxSkillsLoading'))
        } else if (cat.status === 'failed') {
          // Name the actual reason: "no remote.skills", "session not retained",
          // "rpc gateway/internal: ..." all mean different things, and a single
          // blanket message is what made this failure unattributable.
          descEl = h('div', { style: S.skillDesc },
            t('ctxSkillsFailed') + (cat.error ? ' · ' + cat.error : ''),
            h('button', {
              type: 'button',
              style: Object.assign({}, S.skillOpenBtn, { marginLeft: '6px' }),
              onClick: function () { setReload(function (v) { return v + 1 }) },
            }, t('ctxSkillsRetry')),
          )
        }

        var pathEl = null
        var path = catEntry && typeof catEntry.path === 'string' ? catEntry.path : ''
        if (path) {
          pathEl = h('div', { style: S.skillPathRow },
            h('span', { style: S.skillPath, title: path }, path),
            h('button', {
              type: 'button',
              style: S.skillOpenBtn,
              // `path` is a function-scoped var shared by every iteration, so
              // the handler must capture its own copy.
              onClick: (function (ownPath) {
                return function () { openSkillFileInSidebar(_prefCtx, sessionId, ownPath) }
              })(path),
            }, t('ctxSkillsOpen')),
          )
        }

        rows.push(h('div', { key: sk.name, style: S.skillRow },
          h('div', { style: S.skillRowHead },
            h('span', { style: S.skillName }, sk.name),
            via.length ? h('span', { style: S.skillBadge }, via.join(' / ')) : null,
          ),
          meta,
          descEl,
          pathEl,
        ))
      }

      return h('div', { key: 'ctx-skills' },
        lead ? null : h('div', { style: S.monitorModalDivider }),
        h('span', { style: lead ? S.skillsSectionTitle : S.monitorModalSectionTitle }, t('ctxSkillsSection')),
        h('div', { style: lead ? S.skillsLeadCard : S.memColumnCard },
          skills.length
            ? h('div', null, rows)
            : h('div', { style: S.skillMeta }, t('ctxSkillsEmpty')),
          h('div', { style: Object.assign({}, S.skillMeta, { marginTop: '6px', opacity: 0.7 }) },
            t('ctxSkillsScope')),
        ),
      )
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region Monitor toggle helpers ──────────────────────────────────────────

    /** Check whether dsh-flash's system-alerts master toggle is ON. */
    function _getAlertsOn() {
      try { return localStorage.getItem('dsh-flash:system-alerts') !== '0' } catch (_) { return true }
    }

    var TOGGLE_KEY = 'dsh-flash-ctx-mon:monitor-context'
    var PROVIDER_ID = 'dsh-flash-ctx-mon:context-alert'

    var _MONITOR_TOGGLES = {
      context: {
        key: TOGGLE_KEY,
        providers: [PROVIDER_ID],
      },
    }
    var _MONITOR_DEFAULT = { context: true }

    function _getMonitorOn(monitor) {
      var def = _MONITOR_DEFAULT[monitor] !== false
      try { return localStorage.getItem(_MONITOR_TOGGLES[monitor].key) !== '0' } catch (_) { return def }
    }

    function _setMonitorOn(monitor, on, alertRegistry) {
      var providers = _MONITOR_TOGGLES[monitor].providers
      for (var i = 0; i < providers.length; i++) {
        try { alertRegistry.setProviderEnabled(providers[i], on) } catch (_) {}
      }
      try { localStorage.setItem(_MONITOR_TOGGLES[monitor].key, on ? '1' : '0') } catch (_) {}
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region Client factory ─────────────────────────────────────────────────

    var client = {
      inject: ['remote', 'remote.settings'],
      async apply(ctx) {
        // A throw anywhere inside the real apply used to REJECT this async
        // apply — and a failed apply FAILS the plugin's Cordis fiber, so the
        // plugin never activates and its switch silently never appears. That
        // is not hypothetical: a `settings.describe().then(...)` TypeError did
        // exactly this. Registration failures are REPORTED here, never fatal.
        try {
          await client._applyInner(ctx)
        } catch (err) {
          console.error('[dsh-flash-ctx-mon] apply failed (non-fatal):', err)
        }
      },

      async _applyInner(ctx) {
        _prefCtx = ctx

        // 0b. Wire the resident flash-icon indicator into the auto-retry view
        //     bridge. Every _publishAutoRetryView() → store.notify(view) mirrors
        //     the state onto the <html> root so the cross-plugin stylesheet can
        //     paint the glow; cleared on dispose. (Contract in §6: the overlay /
        //     UI layer owns DOM, the data layer only notifies this object.)
        _autoRetryStore = { notify: _syncAutoRetryDomIndicator }
        // Prime immediately: an already-armed session should light the icon
        // before the first fresh publish rolls in.
        if (_activeTokenSource && typeof _activeTokenSource.getAutoRetryView === 'function') {
          try { _syncAutoRetryDomIndicator(_activeTokenSource.getAutoRetryView()) } catch (_) {}
        }
        // Watch dsh-flash for trigger-button rebuilds (position switches
        // unmount + remount the button, dropping our stamped badge & chip);
        // re-paint with the latest view when that happens.
        _ensureTriggerRepaintObserver()

        // 0c. Wire the watchdog badge into the unsettled view bridge, same
        //     mechanism as 0b. Reminder-only: it paints a red count, never
        //     a continue. Cleared on dispose.
        _unsettledStore = { notify: _syncUnsettledDomIndicator }
        if (_activeTokenSource && typeof _activeTokenSource.getUnsettledTurns === 'function') {
          try { _syncUnsettledDomIndicator(_activeTokenSource.getUnsettledTurns()) } catch (_) {}
        }

        // 1. Load ctx-mon preferences from the 'dsh-flash-ctx-mon' settings namespace
        loadCtxPrefs(ctx).then(function (ok) {
          // Sync alert providers with the localStorage-backed state.
          var lsOn
          try { lsOn = localStorage.getItem(TOGGLE_KEY) !== '0' } catch (_) { lsOn = true }
          try {
            var reg = ctx.get && ctx.get('quickControl')
            if (reg && typeof reg.notifyChange === 'function') {
              reg.notifyChange(TOGGLE_KEY)
            }
          } catch (_) {}
          var alertReg = ctx.get && ctx.get('dshFlashAlerts')
          if (alertReg) {
            try { alertReg.setProviderEnabled(PROVIDER_ID, lsOn) } catch (_) {}
          }
        })

        // 2. Register with dock-flash's quickControl and dshFlashAlerts services.
        var _registered = false

        function _registerServices(registry, alertRegistry) {
          if (_registered) return
          if (!registry || !alertRegistry) {
            console.warn('[dsh-flash-ctx-mon] _registerServices: missing service — quickControl=' + !!registry + ', alerts=' + !!alertRegistry)
            return
          }
          _registered = true
          console.log('[dsh-flash-ctx-mon] registering provider and switch')

          // 3. Register context alert provider
          var ctxProvider = createSessionContextProvider()
          alertRegistry.registerProvider(ctxProvider)

          // 4. Register context monitor toggle switch
          ctx.effect(function () {
            var dispose = registry.registerSwitch({
              id: TOGGLE_KEY,
              label: L('alertCtxCluster'),
              icon: 'message',
              type: 'toggle',
              group: 'system',
              cluster: 'system-alerts',
              order: 59,
              visible: function () {
                return _getAlertsOn()
              },
              config: function () { openMonitorConfig('context') },
              getValue: function () { return _getMonitorOn('context') },
              setValue: function (v) {
                _setMonitorOn('context', v, alertRegistry)
                registry.notifyChange(TOGGLE_KEY)
                try { alertRegistry.notify() } catch (_) {}
              },
              // No `subtitle`: dock-flash renders it as a second line on the
              // switch row, and the live "model · 12%" readout it used to carry
              // is already in the panel this switch opens.
            })
            return dispose
          }, 'dsh-flash-ctx-mon: monitor-context switch')

          // 4b. Register the manual auto-continue quick switch. This is the
          //     one-click "turn off / re-arm auto-continue" entry the user asked
          //     for. It mirrors the monitor switch's registerSwitch contract.
          //     Semantics are a ONE-TIME disarm (no persistent off pref): the
          //     runner's disarmAutoRetry drops the session's armed record, and
          //     re-arming simply calls armAutoRetry again.
          ctx.effect(function () {
            // Let the token source nudge this switch when a session bind
            // (or un-bind) transition happens, so it appears/disappears the
            // moment binding settles instead of waiting on the next unrelated
            // panel action.
            _notifyAutoRetryQuick = function () {
              try { registry.notifyChange(RUNNER_QUICK_KEY) } catch (_) {}
              try { alertRegistry.notify() } catch (_) {}
            }
            var dispose = registry.registerSwitch({
              id: RUNNER_QUICK_KEY,
              label: L('autoRetryQuickLabel'),
              // 'scroll' is in dsh-flash's monochrome glyph set (_ICON_PATHS in
              // its client): it reads as "keep going / continue", matching
              // auto-continue, and is visually distinct from the context
              // monitor switch which uses 'message'. Do NOT use 'refresh' —
              // dsh-flash has no refresh glyph, so _switchIcon falls back to
              // rendering the literal text and the row shows "refresh".
              icon: 'scroll',
              type: 'toggle',
              group: 'system',
              cluster: 'system-alerts',
              // Placed directly BELOW the 弹窗通知 (Toast) switch in the
              // system-alerts cluster. Cluster rows sort by `order` ascending
              // (57 system-alerts, 59 monitor-context, 61 alert-toast, then
              // this), so 62 keeps auto-continue right under the Toast toggle
              // and above the host sliders (80/81, hidden in the compact strip).
              order: 62,
              // Visible whenever dsh-flash's 系统告警 master toggle is ON — the
              // panel re-evaluates every row's visible() on any notifyChange, so
              // this row stands down the moment 系统告警 is switched off, exactly
              // like the 上下文监控 switch. It is NOT gated on the runner's active
              // state: even while stopped the row stays visible (while master is
              // on) so the user always has a one-click re-arm entry — it reflects
              // the current session's auto-continue state via getValue instead.
              // No `config`: the ⚙ 配置 button belongs to the 上下文监控 switch
              // only — a bare one-shot auto-continue toggle has nothing to
              // configure.
              // 系统告警主开关 ON 且当前会话已成功绑定（有一个可作用的
              // eventSource）。绑定成功后 auto-continue 才能真正收/发 offer，
              // 所以在绑定完成前不显示这个开关，避免展示一个无可作用的 toggle
              //（当 sessions 服务尚未注册 / 没有打开会话时隐藏）。一旦绑定
              // 成功（或失败后恢复）panel 会重新评估 visible()。
              visible: function () {
                if (!_getAlertsOn()) return false
                var src = _activeTokenSource
                return !!(src && typeof src.isBound === 'function' && src.isBound())
              },
              getValue: function () { return _getRunnerActive() },
              setValue: function (v) {
                var src = _activeTokenSource
                if (!src) return
                try {
                  if (v) {
                    if (typeof src.armAutoRetry === 'function') src.armAutoRetry()
                  } else if (typeof src.disarmAutoRetry === 'function') {
                    // Manual off → disarmAutoRetry('manual'). It disarms the
                    // guard but does NOT toast: the stop was user-initiated, so
                    // no informational alert is needed (see AUTO_RETRY_EXIT_REASONS).
                    src.disarmAutoRetry()
                  }
                } catch (_) {}
                registry.notifyChange(RUNNER_QUICK_KEY)
                try { alertRegistry.notify() } catch (_) {}
              },
            })
            return function () {
              _notifyAutoRetryQuick = null
              try { dispose() } catch (_) {}
            }
          }, 'dsh-flash-ctx-mon: auto-continue quick switch')

          // 5. Apply persisted toggle gates — before the alert registry auto-starts
          Object.keys(_MONITOR_TOGGLES).forEach(function (m) {
            if (!_getMonitorOn(m)) _setMonitorOn(m, false, alertRegistry)
          })
        }

        // 6. Start the skill tracker. It is deliberately independent of the
        //    alert provider: the header chip must keep working even when the
        //    context monitor (and therefore the provider) is switched off.
        var skillTracker = createSessionSkillTracker()
        _activeSkillTracker = skillTracker
        ctx.effect(function () {
          skillTracker.start(ctx)
          return function () {
            skillTracker.stop()
            if (_activeSkillTracker === skillTracker) _activeSkillTracker = null
          }
        }, 'dsh-flash-ctx-mon: session skill tracker')

        // 6b. Keep the chip on the session tab strip, where a changing title
        //     cannot shove it around. Same independence as the tracker above.
        ctx.effect(function () {
          startSkillsChipObserver()
          return function () { stopSkillsChipObserver() }
        }, 'dsh-flash-ctx-mon: session skills chip host')

        // 7. Register the session-header skills chip as the fallback for
        //    sessions whose tab strip does not exist (a strip needs at least
        //    two conversation views) or has not mounted yet. The slot lives
        //    inside the conversation view, so the framework hands the component
        //    the id of the session it is rendering for — that id is what keeps
        //    the chip from ever showing the main view's skills in a subagent's
        //    header.
        ctx.inject(['slots'], function (slotsCtx) {
          slotsCtx.effect(function () {
            return slotsCtx.slots.inject('conversation.session.header.actions', function () {
              return slotsCtx.slots.register({
                name: 'conversation.session.header.actions',
                id: 'dsh-flash-ctx-mon-skills',
                order: 15,
              }, SkillChip)
            })
          }, 'dsh-flash-ctx-mon: session skills chip')
        })

        // 7b. Register the composer send-button auto-continue indicator into
        //     `conversation.input.right`, the host slot that sits immediately
        //     before the submit action. Same session-scoped contract as the
        //     header chip: the slot framework hands the component the id of the
        //     session the composer belongs to, and SendAutoRetryIndicator gates
        //     on `sessionId === view.sessionId`, so the main composer never
        //     shows a subagent's auto-continue state and vice versa. It appears
        //     only while auto-continue is active (armed / scheduled / paused).
        ctx.inject(['slots'], function (slotsCtx) {
          slotsCtx.effect(function () {
            return slotsCtx.slots.inject('conversation.input.right', function () {
              return slotsCtx.slots.register({
                name: 'conversation.input.right',
                id: 'dsh-flash-ctx-mon-send-ind',
                order: 20,
              }, SendAutoRetryIndicator)
            })
          }, 'dsh-flash-ctx-mon: composer send auto-continue indicator')
        })

        // Passive: listen for dsh-flash:ready event
        try {
          ctx.on('dsh-flash:ready', function (payload) {
            console.log('[dsh-flash-ctx-mon] dsh-flash:ready event received — quickControl=' + !!(payload && payload.quickControl) + ', alerts=' + !!(payload && payload.alerts))
            _registerServices(payload.quickControl, payload.alerts)
          })
        } catch (e) {
          console.warn('[dsh-flash-ctx-mon] ctx.on("dsh-flash:ready") failed:', e)
        }

        // Active: check if dock-flash already loaded
        var registry = ctx.get('quickControl')
        var alertRegistry = ctx.get('dshFlashAlerts')
        console.log('[dsh-flash-ctx-mon] active check — quickControl=' + !!registry + ', alerts=' + !!alertRegistry)
        if (registry && alertRegistry) _registerServices(registry, alertRegistry)

        // Fallback: poll briefly
        if (!_registered) {
          var _retryCount = 0
          function _retryGet() {
            if (_registered) return
            var r = ctx.get('quickControl')
            var a = ctx.get('dshFlashAlerts')
            if (r && a) { _registerServices(r, a); return }
            if (++_retryCount < 15) setTimeout(_retryGet, 200)
          }
          setTimeout(_retryGet, 0)
        }
      },

      dispose() {
        closeMonitorConfig()
        _clearAutoRetryDomIndicator()
        _autoRetryStore = null
        // Drop the composer send-indicator pub/sub so no mounted component
        // keeps a stale subscription and the channel stops growing.
        _autoRetryViewListeners.clear()
        _autoRetryViewLatest = null
        _clearUnsettledDomIndicator()
        _unsettledStore = null
        _stopTriggerRepaintObserver()
      },
    }
    return client
  },
})

