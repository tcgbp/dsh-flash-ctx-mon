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
// - ModelWindowMapEditor component
// - _ctxPrefs preference system
//
// No HTTP routes — entirely client-side. Reads token usage from DSH session
// events via ctx.get('sessions') and model catalog from remote.session.modelCatalog().
//
// Provider id: dsh-flash-ctx-mon:context-alert
// Toggle key: dsh-flash-ctx-mon:monitor-context
// Settings namespace: dsh-flash-ctx-mon

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
      alertContextUnavailable: '无法检测会话上下文长度',
      alertCtxCluster: '上下文监控',
      monitorOn: '已开启',
      monitorOff: '已关闭',
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
      ctxSourcePrecise: '精确',
      ctxSourceUnavailable: '等待数据',
      ctxModelWindowMap: '模型窗口映射',
      ctxCurrentModel: '当前模型',
      ctxWindowTokens: '窗口大小',
      ctxDataSource: '数据来源',
      ctxInputTokens: '输入Token',
      ctxPressureTokens: '上下文压力',
      ctxApproxWindowHint: '未知模型的默认窗口',
      ctxSrcRequestContext: '会话事件',
      ctxSrcCatalogAuto: '模型目录',
      ctxSrcCatalogUnknown: '目录未知',
      ctxSrcErrorExtracted: '错误解析',
      ctxSrcUserMapping: '手动配置',
      ctxSrcBuiltinTable: '内置表',
      ctxSrcFuzzyMatch: '模糊匹配',
      ctxSrcApproxDefault: '估算默认',
      ctxSrcUnknown: '未知',
      ctxCatalogLoading: '加载中…',
      ctxCatalogError: '目录加载失败',
      ctxCatalogRefresh: '刷新目录',
      ctxNoWindow: '—',
      // Alert preview
      alertPreviewToggle: '查看告警消息样例',
    }

    var en = {
      alertContextInfo: 'Session context getting long',
      alertContextWarning: 'Session context nearly exhausted',
      alertContextError: 'Session context almost exhausted',
      alertContextUnavailable: 'Cannot detect session context length',
      alertCtxCluster: 'Context Monitor',
      monitorOn: 'Enabled',
      monitorOff: 'Disabled',
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
      ctxSourcePrecise: 'Precise',
      ctxSourceUnavailable: 'Awaiting data',
      ctxModelWindowMap: 'Model Window Map',
      ctxCurrentModel: 'Current Model',
      ctxWindowTokens: 'Window Size',
      ctxDataSource: 'Data Source',
      ctxInputTokens: 'Input Tokens',
      ctxPressureTokens: 'Context Pressure',
      ctxApproxWindowHint: 'Default for unknown models',
      ctxSrcRequestContext: 'Session Event',
      ctxSrcCatalogAuto: 'Model Catalog',
      ctxSrcCatalogUnknown: 'Catalog (unknown)',
      ctxSrcErrorExtracted: 'Error Parsed',
      ctxSrcUserMapping: 'Manual',
      ctxSrcBuiltinTable: 'Built-in',
      ctxSrcFuzzyMatch: 'Fuzzy Match',
      ctxSrcApproxDefault: 'Fallback',
      ctxSrcUnknown: 'Unknown',
      ctxCatalogLoading: 'Loading…',
      ctxCatalogError: 'Catalog failed',
      ctxCatalogRefresh: 'Refresh Catalog',
      ctxNoWindow: '—',
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
      modelContextWindows: {},
      modelContextWindowSources: {},
    }

    var _ctxPrefs = Object.assign({}, _CTX_ALERT_DEFAULTS)
    var _prefCtx = null
    var CTX_MON_NS = 'dsh-flash-ctx-mon'
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

    var _PREFS_MAX_RETRIES = 8
    var _PREFS_RETRY_DELAY_MS = 750

    function loadCtxPrefs(ctx, _retryCount) {
      if (typeof _retryCount !== 'number') _retryCount = 0
      var settings = _remoteSettings(ctx)
      if (!settings) return Promise.resolve(false)
      if (typeof settings.describe !== 'function') return Promise.resolve(false)
      return settings.describe().then(function (desc) {
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
          modelContextWindows: resolved.modelContextWindows,
          modelContextWindowSources: resolved.modelContextWindowSources,
        }
        if (typeof ns.revision === 'number') _hostRevision = ns.revision
        console.log('[dsh-flash-ctx-mon] preferences loaded from ' + CTX_MON_NS + ' namespace')
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

    function _queuePrefWrite(ctx, patch, onError, saved) {
      var task = _prefWriteTail.then(function () {
        var settings = _remoteSettings(ctx || _prefCtx)
        if (!settings || typeof settings.update !== 'function') {
          if (onError) onError(patch, function () {
            for (var k in saved) if (Object.prototype.hasOwnProperty.call(saved, k)) _ctxPrefs[k] = saved[k]
          })
          return false
        }
        return settings.update(CTX_MON_NS, patch, _fenceRevision())
          .then(function (res) {
            try {
              if (res && res.ok === false) {
                _pendingRevision = null
                if (onError) onError(patch, function () {
                  for (var k in saved) if (Object.prototype.hasOwnProperty.call(saved, k)) _ctxPrefs[k] = saved[k]
                })
                try {
                  settings.describe().then(function (desc) {
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
              for (var k in saved) if (Object.prototype.hasOwnProperty.call(saved, k)) _ctxPrefs[k] = saved[k]
            })
            return false
          })
      })
      _prefWriteTail = task.then(function () {}, function () {})
      return task
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region Token formatting helpers ────────────────────────────────────────

    /** Format a token count as a human-readable "K" string.
     *  LLM context windows are typically powers of two (131072 = 128K,
     *  65536 = 64K, 32768 = 32K) where the conventional "K" means ÷1024.
     *  Some models use round thousands (e.g. DeepSeek 128K = 128000) where
     *  ÷1000 is more natural.  This function detects 2^n-aligned values and
     *  uses ÷1024; everything else falls back to ÷1000. */
    function formatTokenK(v) {
      if (v == null || !isFinite(v)) return '' + v
      if (v < 1000) return '' + v
      // If the value is an exact multiple of 1024 and >= 1024, it is
      // almost certainly a power-of-two context window — use binary K.
      if (v >= 1024 && (v & (v - 1)) === 0) return Math.round(v / 1024) + 'K'
      // Otherwise (e.g. 128000, 200000) use decimal K for consistency
      // with how the provider named the model ("128K" = 128000 tokens).
      return Math.round(v / 1000) + 'K'
    }

    /** Format a token count with one decimal place (e.g. "12.3K").
     *  Used for live pressure/breakdown values that aren't exact 2^n. */
    function formatTokenK1(v) {
      if (v == null || !isFinite(v)) return '' + v
      if (v < 1000) return '' + v
      return (v / 1000).toFixed(1) + 'K'
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region Context window source constants & helpers ──────────────────────

    /** Model name → context window size (tokens).  Retired — the table
     *  contained outdated models and is no longer consulted.  Kept as an
     *  empty object so that stored modelContextWindowSources entries with
     *  'builtin-table' / 'fuzzy-match' provenance still render correctly
     *  in the editor (they were written from this table in earlier versions). */
    var _KNOWN_WINDOWS = {}

    /** Source labels for context window values — exposed via getTokenEstimate()
     *  so the UI can annotate where each value came from. */
    var CWS_REQUEST_CONTEXT = 'request-context'   // DSH request/context event (adapter-resolved)
    var CWS_CATALOG_AUTO    = 'catalog-auto'      // Auto-filled from DSH model catalog + _resolveWindow
    var CWS_ERROR_EXTRACTED = 'error-extracted'   // Parsed from CONTEXT_WINDOW_EXCEEDED error
    var CWS_USER_MAPPING    = 'user-mapping'      // User modelContextWindows override
    var CWS_BUILTIN_TABLE   = 'builtin-table'     // Built-in _KNOWN_WINDOWS
    var CWS_FUZZY_MATCH     = 'fuzzy-match'       // Fuzzy-matched into _KNOWN_WINDOWS
    var CWS_CATALOG_UNKNOWN = 'catalog-unknown'   // Catalog model with no resolved window
    var CWS_APPROX_DEFAULT  = 'approximate-default' // ctxApproxWindow fallback

    /** Cached model catalog from remote.session.modelCatalog().
     *  Structure: { groups: [{id, name, models: [{id, name}]}], ... }
     *  Refreshed on demand by _fetchModelCatalog(). */
    var _modelCatalog = null
    var _modelCatalogPromise = null
    var _modelCatalogError = null

    /** Fetch the DSH model catalog from remote.session.modelCatalog().
     *  Returns the catalog (cached after first successful fetch).
     *  Auto-fills modelContextWindows for catalog models whose window
     *  size is known from _resolveWindow() but not yet stored. */
    function _fetchModelCatalog(ctx) {
      if (_modelCatalog) return Promise.resolve(_modelCatalog)
      if (_modelCatalogPromise) return _modelCatalogPromise
      try {
        var remote = ctx && ctx.get ? ctx.get('remote') : undefined
        var session = remote && remote.session
        if (!session || typeof session.modelCatalog !== 'function') {
          _modelCatalogError = 'remote.session not available'
          return Promise.resolve(null)
        }
        _modelCatalogPromise = session.modelCatalog().then(function (result) {
          _modelCatalogPromise = null
          if (result && result.ok && result.value) {
            _modelCatalog = result.value
            _modelCatalogError = null
            // Auto-fill context windows for catalog models not yet stored
            _autoFillCatalogWindows(ctx)
            return _modelCatalog
          }
          _modelCatalogError = 'catalog returned non-ok: ' + (result && result.error || '?')
          return null
        }).catch(function (e) {
          _modelCatalogPromise = null
          _modelCatalogError = 'catalog fetch failed: ' + (e && e.message || e)
          return null
        })
        return _modelCatalogPromise
      } catch (e) {
        _modelCatalogError = 'remote.session access failed: ' + (e && e.message || e)
        return Promise.resolve(null)
      }
    }

    /** Auto-fill modelContextWindows for models in the catalog.
     *  Since the builtin table was retired, _resolveWindow() only reads from
     *  modelContextWindows — the same map we'd be writing into — so this
     *  function is now a no-op.  Kept as a stub in case a future source
     *  (e.g. an API-provided window list) is added. */
    function _autoFillCatalogWindows(ctx) {
      // No-op: without the builtin table, _resolveWindow() can only return
      // values already in modelContextWindows, which this function would
      // skip anyway (the "already stored" guard).
    }

    /** Build a unified list of all known models for the editor.
     *  Merges: user config (includes error-extracted) → catalog models.
     *  Each entry: { id, name?, window, source, provider?, sourceLabel }
     *  where sourceLabel is a short human-readable label for the source. */
    function _allKnownModels() {
      var seen = {}   // id → entry (first write wins per priority)
      var entries = []

      function addEntry(id, name, window, source, provider) {
        if (!id) return
        if (seen[id]) return   // first write wins
        seen[id] = true
        entries.push({
          id: id,
          name: name || null,
          window: window,
          source: source,
          provider: provider || null,
        })
      }

      // 1. User-configured overrides (highest priority — already stored)
      var userMap = _alertPref('modelContextWindows')
      var userSources = _alertPref('modelContextWindowSources')
      if (userMap && typeof userMap === 'object') {
        var userKeys = Object.keys(userMap)
        for (var i = 0; i < userKeys.length; i++) {
          var k = userKeys[i]
          var src = (userSources && userSources[k]) || CWS_USER_MAPPING
          addEntry(k, null, userMap[k], src, null)
        }
      }

      // 2. Catalog models (from DSH model catalog)
      if (_modelCatalog && _modelCatalog.groups) {
        for (var gi = 0; gi < _modelCatalog.groups.length; gi++) {
          var group = _modelCatalog.groups[gi]
          if (!group || !group.models) continue
          for (var mi = 0; mi < group.models.length; mi++) {
            var model = group.models[mi]
            if (!model || !model.id) continue
            // If already in user config, skip (first-write-wins)
            if (seen[model.id]) continue
            // Try to get window from resolve chain
            var resolved = _resolveWindow(model.id)
            // Source: catalog-auto if we have a window, else catalog (just known from catalog, window TBD)
            var entrySource = resolved.window
              ? CWS_CATALOG_AUTO
              : CWS_CATALOG_UNKNOWN
            addEntry(model.id, model.name, resolved.window, entrySource, group.id)
          }
        }
      }

      // Sort: models with window values first, then alphabetically by id
      entries.sort(function (a, b) {
        if (a.window != null && b.window == null) return -1
        if (a.window == null && b.window != null) return 1
        return (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      })
      return entries
    }

    function _resolveWindow(modelName) {
      if (!modelName) return { window: null, source: CWS_APPROX_DEFAULT }
      // 1. User-configured mapping (host pref) — includes error-extracted &
      //    catalog-auto values that were persisted into modelContextWindows.
      var custom = _alertPref('modelContextWindows')
      if (custom && typeof custom === 'object' && custom[modelName]) {
        // Check provenance — if this entry came from error extraction or catalog, label it
        var sources = _alertPref('modelContextWindowSources')
        var src = (sources && typeof sources === 'object' && sources[modelName])
          ? sources[modelName]
          : CWS_USER_MAPPING
        return { window: custom[modelName], source: src }
      }
      // 2. Unknown model — return null (caller uses ctxApproxWindow as default)
      return { window: null, source: CWS_APPROX_DEFAULT }
    }

    /** Extract the meaningful source tag from a (possibly compound) source.
     *  Compound format: 'catalog-auto:builtin-table' — the inner part is
     *  a valid source tag (the original source the auto-fill derived from).
     *  Other compounds like 'error-extracted:CONTEXT_WINDOW_EXCEEDED' carry
     *  metadata after the colon (an error code), NOT a source tag — the
     *  outer part is the real source. */
    function _effectiveSource(sourceTag) {
      if (!sourceTag || sourceTag.indexOf(':') < 0) return sourceTag
      var outer = sourceTag.slice(0, sourceTag.indexOf(':'))
      var inner = sourceTag.slice(sourceTag.indexOf(':') + 1)
      // Only catalog-auto uses the inner part as a valid source tag
      if (outer === CWS_CATALOG_AUTO) return inner
      return outer
    }

    /** Map a context-window source tag to a human-readable i18n key. */
    function _sourceLabelKey(sourceTag) {
      if (!sourceTag) return 'ctxSrcUnknown'
      switch (_effectiveSource(sourceTag)) {
        case CWS_REQUEST_CONTEXT: return 'ctxSrcRequestContext'
        case CWS_CATALOG_AUTO: return 'ctxSrcCatalogAuto'
        case CWS_CATALOG_UNKNOWN: return 'ctxSrcCatalogUnknown'
        case CWS_ERROR_EXTRACTED: return 'ctxSrcErrorExtracted'
        case CWS_USER_MAPPING: return 'ctxSrcUserMapping'
        case CWS_BUILTIN_TABLE: return 'ctxSrcBuiltinTable'
        case CWS_FUZZY_MATCH: return 'ctxSrcFuzzyMatch'
        case CWS_APPROX_DEFAULT: return 'ctxSrcApproxDefault'
        default: return 'ctxSrcUnknown'
      }
    }

    /** Short source icon for the badge in the editor. */
    function _sourceIcon(sourceTag) {
      if (!sourceTag) return '?'
      switch (_effectiveSource(sourceTag)) {
        case CWS_REQUEST_CONTEXT: return '📡'
        case CWS_CATALOG_AUTO: return '📋'
        case CWS_CATALOG_UNKNOWN: return '📋'
        case CWS_ERROR_EXTRACTED: return '⚠️'
        case CWS_USER_MAPPING: return '👤'
        case CWS_BUILTIN_TABLE: return '📖'
        case CWS_FUZZY_MATCH: return '🔍'
        case CWS_APPROX_DEFAULT: return '📐'
        default: return '?'
      }
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
      var _lastProcessedSeq = -1
      var _model = null
      var _contextWindow = null
      var _sessions = null
      var _sessionId = null
      var _ctx = null       // Cordis context for preference writes (set in start)
      var _bindRetryTimer = null
      var _bindRetryCount = 0

      /** Try to extract a token count from a context-window-exceeded error message.
       *  Providers typically include phrasing like "maximum context length is 131072 tokens"
       *  or "context window of 128000". Returns the number or null. */
      function _extractWindowFromError(msg) {
        if (typeof msg !== 'string') return null
        // Pattern: "maximum context length is NNN" / "context length of NNN" / "context window of NNN"
        var m = msg.match(/(?:maximum|max(?:imum)?\s+)?context\s+(?:length|window)(?:\s+is)?\s+(\d[\d,]*)/i)
          || msg.match(/(\d[\d,]*)\s+tokens?(?:\s+context)?/i)   // "131072 tokens context"
        if (!m) return null
        var num = parseInt(m[1].replace(/,/g, ''), 10)
        return (Number.isFinite(num) && num > 0) ? num : null
      }

      /** Detect whether an error is a context-window-exceeded type.
       *  Matches the CONTEXT_WINDOW_EXCEEDED code or common message patterns
       *  used by providers (including Chinese "上下文超限"). */
      function _isContextLimitError(code, message) {
        if (code === 'CONTEXT_WINDOW_EXCEEDED') return true
        if (typeof message !== 'string') return false
        // Match English context-limit phrases
        if (/\b(?:context\s+(?:length|window)|maximum\s+context|exceeds?\s+(?:the\s+)?(?:model'?s?\s+)?(?:maximum\s+)?context)\b/i.test(message)) return true
        if (/\b(?:input|prompt|request)\s+(?:is\s+)?too\s+(?:long|large)\s+for\b/i.test(message)) return true
        // Match Chinese "上下文超限" (context limit exceeded)
        if (/上下文.*(?:超限|超出|溢出|超过)|exceed.*context|context.*exceed/i.test(message)) return true
        return false
      }

      /** Persist an error-extracted context window for the current model.
       *  Merges into modelContextWindows and sets modelContextWindowSources
       *  to record the provenance. Only writes when the extracted value
       *  differs from what is already stored.
       *  Does NOT overwrite a user-mapping source (user intent > auto-detected).
       *  Overwrites any other source (catalog-auto,
       *  request-context, etc.) because the error-extracted value comes
       *  directly from the provider's own rejection response and is the
       *  most authoritative source for the model's true context window. */
      function _persistExtractedWindow(windowValue, model, errorCode) {
        if (!windowValue || !model || !_ctx) return
        var currentMap = _alertPref('modelContextWindows')
        if (!currentMap || typeof currentMap !== 'object') currentMap = {}
        // Skip if already stored with the same value
        if (currentMap[model] === windowValue) return
        // Check current source — do not overwrite user-mapping
        var currentSources = _alertPref('modelContextWindowSources')
        if (!currentSources || typeof currentSources !== 'object') currentSources = {}
        var existingSrc = currentSources[model]
        if (existingSrc === CWS_USER_MAPPING) return   // user intent wins

        var updated = Object.assign({}, currentMap)
        updated[model] = windowValue
        var srcLabel = CWS_ERROR_EXTRACTED + (errorCode ? ':' + errorCode : '')
        var updatedSources = Object.assign({}, currentSources)
        updatedSources[model] = srcLabel
        // Write both atomically in one patch
        savePrefs(_ctx, {
          modelContextWindows: updated,
          modelContextWindowSources: updatedSources,
        }, null, function (patch, rollback) {
          console.warn('[dsh-flash-ctx-mon] failed to persist error-extracted window:', patch)
          if (rollback) rollback()
        })
        // Also update _contextWindow immediately so the next poll uses it
        _contextWindow = windowValue
        console.log('[dsh-flash-ctx-mon] extracted context window from error: model=' + model + ' window=' + windowValue + ' source=' + srcLabel)
      }

      /** Persist a request/context-derived context window for the current model.
       *  The adapter's prepareCall() resolves the window DSH uses internally.
       *  Only writes when the value differs from what is already stored.
       *  Does NOT overwrite a user-mapping source (user intent > auto-detected).
       *  Does NOT overwrite an error-extracted source — that value came from
       *  the provider's own rejection and is more authoritative than the
       *  adapter's potentially-stale fallback (e.g. DEFAULT_CONTEXT_WINDOW).
       *  Also does not overwrite other deliberate overrides (user edit, catalog-auto). */
      function _persistRequestContextWindow(windowValue, model) {
        if (!windowValue || !model || !_ctx) return
        var currentMap = _alertPref('modelContextWindows')
        if (!currentMap || typeof currentMap !== 'object') currentMap = {}
        // Skip if already stored with the same value
        if (currentMap[model] === windowValue) return
        // Check current source — do not overwrite user-mapping
        var currentSources = _alertPref('modelContextWindowSources')
        if (!currentSources || typeof currentSources !== 'object') currentSources = {}
        var existingSrc = currentSources[model]
        if (existingSrc === CWS_USER_MAPPING) return   // user intent wins
        // If a value is already stored from a non-request-context source (e.g.
        // user edit, error extraction, catalog-auto) and it disagrees with the
        // adapter, the stored value is a deliberate override — do not clobber it.
        // Only a previous request-context value may be updated in place.
        if (currentMap[model] != null && existingSrc && existingSrc !== CWS_REQUEST_CONTEXT) return
        var updated = Object.assign({}, currentMap)
        updated[model] = windowValue
        var updatedSources = Object.assign({}, currentSources)
        updatedSources[model] = CWS_REQUEST_CONTEXT
        savePrefs(_ctx, {
          modelContextWindows: updated,
          modelContextWindowSources: updatedSources,
        }, null, function () {})
        console.log('[dsh-flash-ctx-mon] context window from request/context: model=' + model + ' window=' + windowValue + ' source=' + CWS_REQUEST_CONTEXT)
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

      function _processEntries(entries) {
        var foundUsageInBatch = false
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i]
          if (entry.type !== 'event') continue
          var ev = entry.event
          if (!ev) continue
          // Skip already-processed events (by sequence number)
          var seq = (ev.seq != null && typeof ev.seq === 'number') ? ev.seq : -1
          if (seq >= 0 && seq <= _lastProcessedSeq) continue

          if (ev.type === 'assistant/message' || ev.type === 'assistant/attempt') {
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
              _model = data.header.config.model
              // Only fill in a *local estimate* when no authoritative window has
              // arrived yet. A `request/context` set later must win (it carries
              // the window DSH's adapter actually resolved for this model).
              if (_contextWindow == null) {
                var resolved = _resolveWindow(_model)
                _contextWindow = resolved.window
              }
            }
            if (seq >= 0 && seq > _lastProcessedSeq) _lastProcessedSeq = seq
          }

          if (ev.type === 'request/context') {
            var rctx = ev.data
            if (rctx && typeof rctx.model === 'string') _model = rctx.model
            if (rctx && typeof rctx.contextWindow === 'number' && rctx.contextWindow > 0) {
              // Persist the adapter-resolved window with source provenance
              _persistRequestContextWindow(rctx.contextWindow, _model)
              // For the in-memory value, prefer the user's override when one exists
              var resolved = _resolveWindow(_model)
              _contextWindow = resolved.window != null ? resolved.window : rctx.contextWindow
            }
            if (seq >= 0 && seq > _lastProcessedSeq) _lastProcessedSeq = seq
          }

          // Detect turn/end errors (e.g. "上下文超限" / CONTEXT_WINDOW_EXCEEDED)
          // and extract the real context window from the error message.
          if (ev.type === 'turn/end') {
            var endData = ev.data
            if (endData && endData.reason && endData.reason.kind === 'error') {
              var failure = endData.reason.error
              if (failure && _isContextLimitError(failure.code, failure.message)) {
                var extractedWindow = _extractWindowFromError(failure.message)
                if (extractedWindow && _model) {
                  _persistExtractedWindow(extractedWindow, _model, failure.code || '')
                }
              }
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
          // On replace (history reload), reset last-usage and re-scan
          if (win.change && win.change.kind === 'replace') {
            _lastUsage = null
            _lastProcessedSeq = -1
            _model = null
            _contextWindow = null
          }
          _processEntries(win.entries)
        } catch (e) {
          // Non-fatal: event source may be mid-transition
        }
      }

      function _reset() {
        if (_unsubscribe) { try { _unsubscribe() } catch (_) {} }
        _unsubscribe = null
        if (_bindRetryTimer) { clearTimeout(_bindRetryTimer); _bindRetryTimer = null }
        _lastUsage = null
        _lastProcessedSeq = -1
        _model = null
        _contextWindow = null
      }

      function _bindToSession() {
        if (!_sessions || !_sessionId) return
        try {
          var binding = _sessions.binding(_sessionId)
          if (binding && binding.eventSource) {
            var win = binding.eventSource.getSnapshot()
            var entryCount = win && win.entries ? win.entries.length : 0
            console.log('[dsh-flash-ctx-mon] SessionEventTokenSource: binding to session ' + _sessionId + ', ' + entryCount + ' entries in snapshot')
            if (win && win.entries) _processEntries(win.entries)
            _unsubscribe = binding.eventSource.subscribe(_onEventWindowChange)
          } else {
            var snapN = 0
            try { var _s = _sessions && _sessions.list && _sessions.list.getSnapshot ? _sessions.list.getSnapshot() : null; snapN = _s ? (_s.ids ? _s.ids.length : 0) : 0 } catch (_) {}
            console.warn('[dsh-flash-ctx-mon] SessionEventTokenSource: no binding/eventSource for session ' + _sessionId
              + ' (' + snapN + ' session(s) in list — binding only exists for an OPEN session)')
          }
        } catch (e) {
          console.warn('[dsh-flash-ctx-mon] SessionEventTokenSource: bindToSession error: ' + (e.message || e))
        }
      }

      /** Find a session id that has a live materialized binding. */
      function _findMaterializedSession() {
        if (!_sessions) return null
        try {
          var snap = _sessions.list && _sessions.list.getSnapshot ? _sessions.list.getSnapshot() : null
          var ids = snap && snap.ids
          if (!ids || !ids.length) return null
          for (var i = 0; i < ids.length; i++) {
            var b = _sessions.binding(ids[i])
            if (b && b.eventSource) return ids[i]
          }
        } catch (_) {}
        return null
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

      /** Common bind-and-subscribe logic used by start() and its retry. */
      function _tryBindSession(ctx) {
        // Resolve current session id
        try {
          _sessionId = _sessions.scopeOf(ctx)
        } catch (_) {}
        if (!_sessionId) {
          _sessionId = _findMaterializedSession()
        }
        console.log('[dsh-flash-ctx-mon] SessionEventTokenSource: sessions service found, sessionId=' + (_sessionId || '(none)')
          + (_sessionId ? ' (materialized)' : ' — no session open in UI'))

        // Always subscribe to the session list store to detect both:
        //  1) a session appearing when none existed, and
        //  2) the user switching to a different session
        //  (Critical Rule 12: subscribe unconditionally)
        try {
          var listStore = _sessions.list
          if (listStore && listStore.subscribe) {
            _listUnsubscribe = listStore.subscribe(function () {
              var newId = null
              try { newId = _sessions.scopeOf(ctx) } catch (_) {}
              if (!newId) {
                newId = _findMaterializedSession()
              }
              if (newId && newId !== _sessionId) {
                _reset()
                _sessionId = newId
                _bindToSession()
              } else if (!newId && _sessionId) {
                console.log('[dsh-flash-ctx-mon] SessionEventTokenSource: bound session no longer materialized, resetting')
                _reset()
                _sessionId = null
                _scheduleBindRetry(ctx)
              }
            })
          }
        } catch (_) {}

        // If we already have a session, bind immediately
        if (_sessionId) {
          _bindToSession()
        } else {
          _bindRetryCount = 0
          _scheduleBindRetry(ctx)
        }
      }

      return {
        start: function (ctx) {
          _ctx = ctx     // stored for preference writes from _persistExtractedWindow
          try {
            _sessions = ctx && ctx.get ? ctx.get('sessions') : undefined
          } catch (_) {}
          if (!_sessions) {
            console.warn('[dsh-flash-ctx-mon] SessionEventTokenSource: sessions service not available (will retry)')
            var retryCtx = ctx
            setTimeout(function () {
              if (_sessions) return  // already resolved
              try {
                _sessions = retryCtx && retryCtx.get ? retryCtx.get('sessions') : undefined
              } catch (_) {}
              if (_sessions) {
                console.log('[dsh-flash-ctx-mon] SessionEventTokenSource: sessions service available on retry')
                _tryBindSession(retryCtx)
              } else {
                console.warn('[dsh-flash-ctx-mon] SessionEventTokenSource: sessions service still not available after retry')
              }
            }, 3000)
            return
          }

          _tryBindSession(ctx)
        },

        stop: function () {
          _reset()
          if (_listUnsubscribe) { try { _listUnsubscribe() } catch (_) {} }
          _listUnsubscribe = null
          _sessions = null
          _sessionId = null
          _ctx = null
        },

        /** Returns the current token estimate.
         *  source: 'precise' when session events with usage are available,
         *  'unavailable' when no data has been received yet.
         */
        getTokenEstimate: function () {
          if (_lastUsage) {
            var pressureTokens = _lastUsage.inputTokens
              + (_lastUsage.cacheReadTokens || 0)
              + (_lastUsage.cacheWriteTokens || 0)
            return {
              pressureTokens: pressureTokens,
              inputTokens: _lastUsage.inputTokens,
              outputTokens: _lastUsage.outputTokens,
              cacheReadTokens: _lastUsage.cacheReadTokens || 0,
              cacheWriteTokens: _lastUsage.cacheWriteTokens || 0,
              reasoningTokens: _lastUsage.reasoningTokens || 0,
              contextWindow: _contextWindow || _alertPref('ctxApproxWindow'),
              model: _model,
              source: 'precise',
            }
          }
          return { source: 'unavailable' }
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

      function estimateContextRatio(tokenEstimate) {
        // Only precise path: reads token usage from DSH session events.
        // pressureTokens = inputTokens + cacheReadTokens + cacheWriteTokens
        if (tokenEstimate && tokenEstimate.source === 'precise') {
          var window = tokenEstimate.contextWindow || _alertPref('ctxApproxWindow')
          if (window <= 0) return null
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
        var est = estimateContextRatio(tokenEstimate)
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
        } else if (tokenEstimate && tokenEstimate.source === 'unavailable') {
          alerts.push({
            id: 'ctx-unavailable',
            severity: 'info',
            title: function () { return t('alertContextUnavailable') },
            message: function () { return t('alertContextUnavailable') },
            icon: '⚪',
            timestamp: Date.now(),
            dismissible: true,
          })
        }
        try { callback(alerts) } catch (_) {}

        // Adaptive interval
        var pollBase = _alertPref('ctxPollBase')
        var pollMin  = _alertPref('ctxPollMin')
        var nextInterval = pollBase
        if (est) {
          var r = Math.min(est.ratio, 1)
          nextInterval = Math.max(pollMin, Math.round(pollBase * Math.pow(1 - r, 2) + pollMin))
        }
        // Precise mode: since event source pushes updates, we can poll less aggressively.
        if (tokenEstimate && tokenEstimate.source === 'precise') {
          nextInterval = Math.max(pollMin, nextInterval * 2)
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
          poll()
        },
        stop: function () {
          callback = null
          if (timer) { clearTimeout(timer); timer = null }
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
      // Switch row / slider (used by MonitorConfigModal)
      switchRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '8px',
      },
      switchLabel: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        minWidth: '120px',
        fontSize: '12px',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
      },
      switchIcon: {
        display: 'inline-flex',
        verticalAlign: '-2px',
        marginRight: '2px',
      },
      sliderRow: {
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minWidth: 0,
        marginBottom: '8px',
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
      memLiveDataGrid: {
        display: 'grid',
        gridTemplateColumns: 'auto auto',
        columnGap: '10px',
        rowGap: '4px',
        fontSize: '12px',
      },
      memLiveDataLabel: {
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
      },
      memLiveDataValue: {
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        fontWeight: 500,
      },
      memUsageBarTrack: {
        height: '4px',
        borderRadius: '2px',
        background: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
        marginTop: '2px',
      },
      memUsageBarFill: {
        height: '100%',
        borderRadius: '2px',
        transition: 'width 0.3s ease, background 0.3s ease',
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
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region ModelWindowMapEditor ────────────────────────────────────────────

    function ModelWindowMapEditor(props) {
      var tick = props.tick
      var setTick = props.setTick
      var ctx = props.ctx || _prefCtx

      // Catalog fetch state
      var _catState = useState(_modelCatalog ? 'loaded' : 'idle')
      var catState = _catState[0], setCatState = _catState[1]

      // Fetch catalog on first mount
      useEffect(function () {
        if (_modelCatalog) { setCatState('loaded'); return }
        setCatState('loading')
        _fetchModelCatalog(ctx).then(function () {
          setCatState(_modelCatalog ? 'loaded' : 'error')
          setTick(function (v) { return v + 1 })
        })
      }, [])

      // Build unified model list
      var models = _allKnownModels()

      // Style constants
      var badgeStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        fontSize: '10px',
        padding: '1px 5px',
        borderRadius: '8px',
        whiteSpace: 'nowrap',
        lineHeight: '14px',
      }
      var srcBadgeColors = {}
      srcBadgeColors[CWS_REQUEST_CONTEXT] = { bg: 'rgba(88,166,255,0.15)', color: '#58a6ff' }
      srcBadgeColors[CWS_CATALOG_AUTO]    = { bg: 'rgba(63,185,80,0.15)',  color: '#3fb950' }
      srcBadgeColors[CWS_CATALOG_UNKNOWN]  = { bg: 'rgba(63,185,80,0.1)',   color: '#3fb950' }
      srcBadgeColors[CWS_ERROR_EXTRACTED] = { bg: 'rgba(248,81,73,0.15)',  color: '#f85149' }
      srcBadgeColors[CWS_USER_MAPPING]    = { bg: 'rgba(210,153,34,0.15)', color: '#d29922' }
      srcBadgeColors[CWS_BUILTIN_TABLE]   = { bg: 'rgba(139,148,158,0.15)',color: '#8b949e' }
      srcBadgeColors[CWS_FUZZY_MATCH]     = { bg: 'rgba(139,148,158,0.15)',color: '#8b949e' }
      srcBadgeColors[CWS_APPROX_DEFAULT]  = { bg: 'rgba(139,148,158,0.1)', color: '#484f58' }

      function renderSourceBadge(sourceTag) {
        var effective = _effectiveSource(sourceTag)
        var icon = _sourceIcon(sourceTag)
        var label = t(_sourceLabelKey(sourceTag))
        var colors = srcBadgeColors[effective] || srcBadgeColors[CWS_APPROX_DEFAULT]
        return h('span', {
          style: Object.assign({}, badgeStyle, {
            background: colors.bg,
            color: colors.color,
          }),
          title: sourceTag,
        }, icon, label)
      }

      function formatWindow(w) {
        if (w == null) return t('ctxNoWindow')
        return formatTokenK(w)
      }

      var rows = models.map(function (entry) {
        var id = entry.id
        var name = entry.name
        var window = entry.window
        var source = entry.source
        var provider = entry.provider

        var displayName = name || id
        var idHint = (name && name !== id) ? id : null

        var userMap = _alertPref('modelContextWindows')
        var isInUserMap = userMap && userMap[id] != null
        var sources = _alertPref('modelContextWindowSources')
        var storedSource = (sources && sources[id]) || null

        var effectiveSource = storedSource || source || CWS_APPROX_DEFAULT

        return h('div', {
          key: id,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginBottom: '3px',
            padding: '2px 0',
          },
        },
          // Source badge
          renderSourceBadge(effectiveSource),
          // Model name
          h('span', {
            style: {
              flex: '1',
              fontSize: '12px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              opacity: window != null ? 1 : 0.5,
            },
            title: id + (provider ? ' (' + provider + ')' : ''),
          },
            displayName,
            idHint
              ? h('span', { style: { fontSize: '10px', opacity: 0.5, marginLeft: '4px' } }, idHint)
              : null,
          ),
          // Window value (editable)
          h('input', {
            type: 'number',
            value: window != null ? window : '',
            placeholder: 'tokens',
            style: {
              width: '72px',
              fontSize: '12px',
              padding: '2px 4px',
              borderRadius: '4px',
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.05)',
              color: 'inherit',
              opacity: window != null ? 1 : 0.5,
            },
            onChange: function (e) {
              var raw = e.target.value
              if (raw === '') {
                if (isInUserMap) {
                  var updated = Object.assign({}, userMap)
                  delete updated[id]
                  var updatedSources = Object.assign({}, sources || {})
                  delete updatedSources[id]
                  _writeAlertPref(ctx, 'modelContextWindows', updated, function (patch, rollback) { rollback() })
                  setTick(function (v) { return v + 1 })
                }
                return
              }
              var val = Number(raw)
              if (!isFinite(val) || val <= 0) return
              var updated = Object.assign({}, userMap || {})
              updated[id] = val
              var updatedSources = Object.assign({}, sources || {})
              updatedSources[id] = CWS_USER_MAPPING
              savePrefs(ctx, {
                modelContextWindows: updated,
                modelContextWindowSources: updatedSources,
              }, null, function () {})
              setTick(function (v) { return v + 1 })
            },
          }),
          // Delete button (only for user-configured entries)
          isInUserMap
            ? h('button', {
                type: 'button',
                style: { background: 'none', border: 'none', color: '#f85149', cursor: 'pointer', fontSize: '14px', padding: '0 2px' },
                onClick: function () {
                  var updated = Object.assign({}, userMap || {})
                  delete updated[id]
                  var updatedSources = Object.assign({}, sources || {})
                  delete updatedSources[id]
                  savePrefs(ctx, {
                    modelContextWindows: updated,
                    modelContextWindowSources: updatedSources,
                  }, null, function () {})
                  setTick(function (v) { return v + 1 })
                },
              }, '✕')
            : h('span', { style: { width: '14px' } }),
        )
      })

      // "Add new" row
      var _newModel = useState('')
      var newModel = _newModel[0], setNewModel = _newModel[1]
      var _newWindow = useState('')
      var newWindow = _newWindow[0], setNewWindow = _newWindow[1]
      rows.push(h('div', { key: '_add', style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', paddingTop: '4px', borderTop: '1px solid rgba(255,255,255,0.08)' } },
        h('span', { style: badgeStyle, title: CWS_USER_MAPPING }, _sourceIcon(CWS_USER_MAPPING), t('ctxSrcUserMapping')),
        h('input', {
          type: 'text',
          placeholder: 'model-name',
          value: newModel,
          style: { flex: '1', fontSize: '12px', padding: '2px 4px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: 'inherit' },
          onChange: function (e) { setNewModel(e.target.value) },
        }),
        h('input', {
          type: 'number',
          placeholder: 'tokens',
          value: newWindow,
          style: { width: '72px', fontSize: '12px', padding: '2px 4px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: 'inherit' },
          onChange: function (e) { setNewWindow(e.target.value) },
        }),
        h('button', {
          type: 'button',
          style: { background: 'none', border: 'none', color: 'var(--dsw-alias-brand-primary, #58a6ff)', cursor: 'pointer', fontSize: '14px', padding: '0 4px' },
          onClick: function () {
            var model = (newModel || '').trim()
            var window = Number(newWindow)
            if (!model || !isFinite(window) || window <= 0) return
            var updated = Object.assign({}, _alertPref('modelContextWindows') || {})
            updated[model] = window
            var updatedSources = Object.assign({}, _alertPref('modelContextWindowSources') || {})
            updatedSources[model] = CWS_USER_MAPPING
            savePrefs(ctx, {
              modelContextWindows: updated,
              modelContextWindowSources: updatedSources,
            }, null, function () {})
            setNewModel('')
            setNewWindow('')
            setTick(function (v) { return v + 1 })
          },
        }, '+'),
      ))

      // Catalog status footer
      var catStatusEl = null
      if (catState === 'loading') {
        catStatusEl = h('div', { style: { fontSize: '10px', opacity: 0.4, marginTop: '4px' } }, '📋 ' + t('ctxCatalogLoading'))
      } else if (catState === 'error' || _modelCatalogError) {
        catStatusEl = h('div', { style: { fontSize: '10px', color: '#f85149', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' } },
          '⚠️ ' + t('ctxCatalogError'),
          h('button', {
            type: 'button',
            style: { background: 'none', border: '1px solid rgba(248,81,73,0.3)', color: '#f85149', cursor: 'pointer', fontSize: '10px', padding: '0 4px', borderRadius: '3px' },
            onClick: function () {
              _modelCatalog = null
              _modelCatalogPromise = null
              _modelCatalogError = null
              setCatState('loading')
              _fetchModelCatalog(ctx).then(function () {
                setCatState(_modelCatalog ? 'loaded' : 'error')
                setTick(function (v) { return v + 1 })
              })
            },
          }, t('ctxCatalogRefresh')),
        )
      }

      if (models.length === 0) {
        rows.unshift(h('div', { key: '_empty', style: { fontSize: '11px', opacity: 0.4, marginBottom: '4px' } }, '(' + t('ctxModelWindowMap') + ': —)'))
      }

      return h('div', null, rows, catStatusEl)
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region MonitorConfigModal (context only) ──────────────────────────────

    var MONITOR_SLIDER_FIELDS = {
      context: [
        { key: 'ctxApproxWindow',     labelKey: 'ctxApproxWindow',     hintKey: 'ctxApproxWindowHint', min: 64000, max: 512000, step: 8000, format: function (v) { return formatTokenK(v) } },
        { key: 'ctxThresholdInfo',    labelKey: 'ctxThresholdInfo',    tooltipKey: 'ctxThresholdInfoTip',    min: 30,    max: 80,     step: 1,    format: function (v) { return v + '%' } },
        { key: 'ctxThresholdWarning', labelKey: 'ctxThresholdWarning', tooltipKey: 'ctxThresholdWarningTip', min: 50,    max: 92,     step: 1,    format: function (v) { return v + '%' } },
        { key: 'ctxThresholdError',   labelKey: 'ctxThresholdError',   tooltipKey: 'ctxThresholdErrorTip',   min: 70,    max: 98,     step: 1,    format: function (v) { return v + '%' } },
        { key: 'ctxPollBase',         labelKey: 'ctxPollBase',         tooltipKey: 'ctxPollBaseTip',         min: 5000,  max: 60000,  step: 1000, format: function (v) { return v + 'ms' } },
        { key: 'ctxPollMin',          labelKey: 'ctxPollMin',          tooltipKey: 'ctxPollMinTip',          min: 1000,  max: 10000,  step: 500,  format: function (v) { return v + 'ms' } },
      ],
    }

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

      // Model window map fold state (collapsed by default — data-heavy section)
      var _mapFolded = useState(true)
      var mapFolded = _mapFolded[0], setMapFolded = _mapFolded[1]

      // Close on Escape.
      useEffect(function () {
        function onKey(e) { if (e.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        return function () { document.removeEventListener('keydown', onKey) }
      }, [onClose])

      // Render a single slider field row.
      function renderSliderField(f) {
        var val = Number(_alertPref(f.key)) || 0
        var hintEl = f.hintKey
          ? h('div', { style: { fontSize: '11px', opacity: 0.4, marginTop: '-2px' } }, t(f.hintKey))
          : null
        return h('div', { key: f.key, style: S.switchRow },
          h('span', { style: S.switchLabel },
            h('span', { style: S.switchIcon }, '⚙'),
            h('span', null, t(f.labelKey)),
            hintEl,
          ),
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

      // Single-column layout for context config.
      var fieldEls = fields.map(renderSliderField)

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

      // ── Context monitor live data section ─────────────────────────────
      var ctxLiveDataEl = null
      if (monitor === 'context') {
        // Read token estimate from the active token source
        var tokenEstimate = null
        try {
          if (_activeTokenSource) {
            tokenEstimate = _activeTokenSource.getTokenEstimate()
          }
        } catch (_) {}

        var ctxInfoRows = []
        // Data source quality
        var isPrecise = tokenEstimate && tokenEstimate.source === 'precise'
        var sourceStr = isPrecise
          ? t('ctxSourcePrecise')
          : t('ctxSourceUnavailable')
        var sourceColor = isPrecise
          ? 'var(--dsw-alias-brand-primary, #58a6ff)'
          : '#8b949e'
        ctxInfoRows.push(
          h('span', { style: S.memLiveDataLabel }, t('ctxDataSource')),
          h('span', { style: Object.assign({}, S.memLiveDataValue, { color: sourceColor }) }, sourceStr),
        )

        // Current model (precise mode only)
        if (isPrecise && tokenEstimate.model) {
          ctxInfoRows.push(
            h('span', { style: S.memLiveDataLabel }, t('ctxCurrentModel')),
            h('span', { style: S.memLiveDataValue }, tokenEstimate.model),
          )
        }

        // Context window size
        var windowSize = tokenEstimate && tokenEstimate.contextWindow
          ? tokenEstimate.contextWindow
          : _alertPref('ctxApproxWindow')
        ctxInfoRows.push(
          h('span', { style: S.memLiveDataLabel }, t('ctxWindowTokens')),
          h('span', { style: S.memLiveDataValue }, formatTokenK(windowSize) + ' tokens'),
        )

        // Context pressure (precise mode only)
        if (isPrecise) {
          var pressure = tokenEstimate.pressureTokens || 0
          ctxInfoRows.push(
            h('span', { style: S.memLiveDataLabel }, t('ctxPressureTokens')),
            h('span', { style: S.memLiveDataValue }, formatTokenK1(pressure)),
          )
          // Also show the breakdown: input / cacheRead / cacheWrite
          ctxInfoRows.push(
            h('span', { style: S.memLiveDataLabel }, t('ctxInputTokens')),
            h('span', { style: S.memLiveDataValue }, formatTokenK1(tokenEstimate.inputTokens) + ' / cache ' + formatTokenK1(tokenEstimate.cacheReadTokens || 0) + '+' + formatTokenK1(tokenEstimate.cacheWriteTokens || 0)),
          )
        }

        // Context usage bar — only when precise data is available
        var barEl = null
        if (isPrecise) {
          var barPct = windowSize > 0 ? Math.min(Math.round((tokenEstimate.pressureTokens || 0) / windowSize * 100), 100) : 0
          var barColor = 'var(--dsw-alias-brand-primary, #58a6ff)'
          var tInfo = _alertPref('ctxThresholdInfo')
          var tWarn = _alertPref('ctxThresholdWarning')
          var tErr = _alertPref('ctxThresholdError')
          if (barPct >= tErr) barColor = '#f85149'
          else if (barPct >= tWarn) barColor = '#f0883e'
          else if (barPct >= tInfo) barColor = '#d29922'
          barEl = h('div', { style: S.memUsageBarTrack },
            h('div', {
              style: Object.assign({}, S.memUsageBarFill, {
                width: barPct + '%',
                background: barColor,
              }),
            })
          )
        } else {
          barEl = h('div', { style: S.memUsageBarTrack },
            h('div', {
              style: Object.assign({}, S.memUsageBarFill, {
                width: '0%',
                background: '#8b949e',
              }),
            })
          )
        }

        ctxLiveDataEl = h('div', { key: 'ctx-live-data' },
          h('div', { style: S.monitorModalDivider }),
          h('span', { style: S.monitorModalSectionTitle }, t('ctxDataSource')),
          h('div', { style: S.memColumnCard },
            h('div', { style: S.memLiveDataGrid }, ctxInfoRows),
            barEl,
          ),
          // Model window map editor (collapsible, collapsed by default)
          h('div', { style: Object.assign({}, S.memColumnCard, { marginTop: '8px' }) },
            h('span', {
              style: Object.assign({}, S.memSubSectionLabel, { cursor: 'pointer', userSelect: 'none' }),
              onClick: function () { setMapFolded(!mapFolded) },
            },
              h('span', { style: mapFolded ? S.tabPageChevron : S.tabPageChevronOpen }, '▶'),
              ' ' + t('ctxModelWindowMap'),
            ),
            !mapFolded
              ? h(ModelWindowMapEditor, { tick: tick, setTick: setTick, ctx: _prefCtx })
              : null,
          ),
        )
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
          // Body: sliders + alert preview + live data
          h('div', { style: S.monitorModalBody },
            fieldEls,
            alertPreviewEl,
            ctxLiveDataEl,
          ),
        ),
      )
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region Monitor toggle helpers ──────────────────────────────────────────

    /** Check whether dock-flash's system-alerts master toggle is ON. */
    function _getAlertsOn() {
      try { return localStorage.getItem('dock-flash:system-alerts') !== '0' } catch (_) { return true }
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

    function _monitorSubtitle(m) {
      return function () {
        if (!_getMonitorOn(m)) return t('monitorOff')
        if (m === 'context') {
          var te = _activeTokenSource ? _activeTokenSource.getTokenEstimate() : null
          if (te && te.source === 'precise') {
            var win = te.contextWindow || _alertPref('ctxApproxWindow')
            var pressure = te.pressureTokens || 0
            var pct = win > 0 ? Math.round(pressure / win * 100) : 0
            return t('ctxSourcePrecise') + ' · ' + (te.model || '?') + ' · ' + pct + '%'
          }
          return t('ctxSourceUnavailable')
        }
        return _getMonitorOn(m) ? t('monitorOn') : t('monitorOff')
      }
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region Client factory ─────────────────────────────────────────────────

    var client = {
      inject: ['remote', 'remote.settings'],
      async apply(ctx) {
        _prefCtx = ctx

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
          var alertReg = ctx.get && ctx.get('dockFlashAlerts')
          if (alertReg) {
            try { alertReg.setProviderEnabled(PROVIDER_ID, lsOn) } catch (_) {}
          }
        })

        // 2. Register with dock-flash's quickControl and dockFlashAlerts services.
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
              subtitle: _monitorSubtitle('context'),
            })
            return dispose
          }, 'dsh-flash-ctx-mon: monitor-context switch')

          // 5. Apply persisted toggle gates — before the alert registry auto-starts
          Object.keys(_MONITOR_TOGGLES).forEach(function (m) {
            if (!_getMonitorOn(m)) _setMonitorOn(m, false, alertRegistry)
          })
        }

        // Passive: listen for dock-flash:ready event
        try {
          ctx.on('dock-flash:ready', function (payload) {
            console.log('[dsh-flash-ctx-mon] dock-flash:ready event received — quickControl=' + !!(payload && payload.quickControl) + ', alerts=' + !!(payload && payload.alerts))
            _registerServices(payload.quickControl, payload.alerts)
          })
        } catch (e) {
          console.warn('[dsh-flash-ctx-mon] ctx.on("dock-flash:ready") failed:', e)
        }

        // Active: check if dock-flash already loaded
        var registry = ctx.get('quickControl')
        var alertRegistry = ctx.get('dockFlashAlerts')
        console.log('[dsh-flash-ctx-mon] active check — quickControl=' + !!registry + ', alerts=' + !!alertRegistry)
        if (registry && alertRegistry) _registerServices(registry, alertRegistry)

        // Fallback: poll briefly
        if (!_registered) {
          var _retryCount = 0
          function _retryGet() {
            if (_registered) return
            var r = ctx.get('quickControl')
            var a = ctx.get('dockFlashAlerts')
            if (r && a) { _registerServices(r, a); return }
            if (++_retryCount < 15) setTimeout(_retryGet, 200)
          }
          setTimeout(_retryGet, 0)
        }
      },

      dispose() {
        closeMonitorConfig()
      },
    }
    return client
  },
})
