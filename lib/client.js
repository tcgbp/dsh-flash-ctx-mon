"use strict";
(() => {
  // src-client/tokens.js
  function formatTokenK(v) {
    if (v == null || !isFinite(v)) return "" + v;
    if (v < 1024) return "" + v;
    return Math.round(v / 1024) + "K";
  }
  function formatTokenK1(v) {
    if (v == null || !isFinite(v)) return "" + v;
    if (v < 1024) return "" + v;
    return (v / 1024).toFixed(1) + "K";
  }
  var CWS_REQUEST_CONTEXT = "request-context";
  var CWS_CATALOG_AUTO = "catalog-auto";
  var CWS_ERROR_EXTRACTED = "error-extracted";
  var CWS_USER_MAPPING = "user-mapping";
  var CWS_BUILTIN_TABLE = "builtin-table";
  var CWS_FUZZY_MATCH = "fuzzy-match";
  var CWS_CATALOG_UNKNOWN = "catalog-unknown";
  var CWS_APPROX_DEFAULT = "approximate-default";

  // src-client/skill-detect.js
  var SKILL_CONTENT_PREFIX = '<skill_content name="';
  function parseSkillBlock(text) {
    if (typeof text !== "string") return null;
    const s = text.replace(/^\s+/, "");
    if (s.indexOf(SKILL_CONTENT_PREFIX) !== 0) return null;
    const rest = s.slice(SKILL_CONTENT_PREFIX.length);
    const end = rest.indexOf('"');
    if (end <= 0) return null;
    const name = rest.slice(0, end);
    if (!name || name.length > 200) return null;
    return name;
  }
  function findSkillBlock(value, depth) {
    if (value == null || depth > 4) return null;
    if (typeof value === "string") return parseSkillBlock(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const hit = findSkillBlock(value[i], depth + 1);
        if (hit) return hit;
      }
      return null;
    }
    if (typeof value === "object") {
      if (typeof value.text === "string") {
        const direct = parseSkillBlock(value.text);
        if (direct) return direct;
      }
      const keys = Object.keys(value);
      for (let k = 0; k < keys.length; k++) {
        const child = value[keys[k]];
        if (child && typeof child === "object") {
          const nested = findSkillBlock(child, depth + 1);
          if (nested) return nested;
        }
      }
    }
    return null;
  }

  // src-client/ctx-window.js
  function extractWindowFromError(msg) {
    if (typeof msg !== "string") return null;
    const m = msg.match(/(?:maximum|max(?:imum)?\s+)?context\s+(?:length|window)(?:\s+is)?\s+(\d[\d,]*)/i) || msg.match(/(\d[\d,]*)\s+tokens?(?:\s+context)?/i);
    if (!m) return null;
    const num = parseInt(m[1].replace(/,/g, ""), 10);
    return Number.isFinite(num) && num > 0 ? num : null;
  }
  function isContextLimitError(code, message) {
    if (code === "CONTEXT_WINDOW_EXCEEDED") return true;
    if (typeof message !== "string") return false;
    if (/\b(?:context\s+(?:length|window)|maximum\s+context|exceeds?\s+(?:the\s+)?(?:model'?s?\s+)?(?:maximum\s+)?context)\b/i.test(message)) return true;
    if (/\b(?:input|prompt|request)\s+(?:is\s+)?too\s+(?:long|large)\s+for\b/i.test(message)) return true;
    if (/上下文.*(?:超限|超出|溢出|超过)|exceed.*context|context.*exceed/i.test(message)) return true;
    return false;
  }
  function resolveWindowFromMaps(modelName, userMap, userSources) {
    if (!modelName) return { window: null, source: CWS_APPROX_DEFAULT };
    if (userMap && typeof userMap === "object" && userMap[modelName]) {
      const src = userSources && typeof userSources === "object" && userSources[modelName] ? userSources[modelName] : CWS_USER_MAPPING;
      return { window: userMap[modelName], source: src };
    }
    return { window: null, source: CWS_APPROX_DEFAULT };
  }

  // src-client/factory-body.js
  window.__ModuleLoader__.load({
    id: "dsh-flash-ctx-mon",
    factory: (require2) => {
      var React = require2("react");
      var h = React.createElement;
      var useState = React.useState;
      var useEffect = React.useEffect;
      var useRef = React.useRef;
      var Component = React.Component;
      var ReactDOMClient = null;
      try {
        ReactDOMClient = require2("react-dom/client");
      } catch (_) {
      }
      var zh = {
        alertContextInfo: "\u4F1A\u8BDD\u4E0A\u4E0B\u6587\u8F83\u957F",
        alertContextWarning: "\u4F1A\u8BDD\u4E0A\u4E0B\u6587\u5373\u5C06\u7528\u5C3D",
        alertContextError: "\u4F1A\u8BDD\u4E0A\u4E0B\u6587\u51E0\u4E4E\u7528\u5C3D",
        alertCtxCluster: "\u4E0A\u4E0B\u6587\u76D1\u63A7",
        // Skills used in this session
        alertSkillUsed: "\u4F7F\u7528\u4E86\u6280\u80FD",
        ctxSkillsSection: "\u672C\u4F1A\u8BDD\u4F7F\u7528\u7684\u6280\u80FD",
        ctxSkillsEmpty: "\u672C\u4F1A\u8BDD\u5C1A\u672A\u4F7F\u7528\u6280\u80FD",
        ctxSkillsScope: "\u4EC5\u7EDF\u8BA1\u5F53\u524D\u4F1A\u8BDD\uFF0C\u4E0D\u542B\u5B50\u4EE3\u7406\u4E0E\u5176\u4ED6\u4F1A\u8BDD",
        ctxSkillsViaModel: "\u6A21\u578B\u8C03\u7528",
        ctxSkillsViaUser: "\u7528\u6237\u8C03\u7528",
        ctxSkillsCount: "\u6B21\u6570",
        ctxSkillsFirst: "\u9996\u6B21",
        ctxSkillsLast: "\u6700\u8FD1",
        ctxSkillsOpen: "\u5728\u4FA7\u680F\u6253\u5F00",
        ctxSkillsLoading: "\u6B63\u5728\u8BFB\u53D6\u6280\u80FD\u76EE\u5F55\u2026",
        ctxSkillsFailed: "\u6280\u80FD\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25",
        ctxSkillsRetry: "\u91CD\u8BD5",
        ctxSkillsNoDesc: "\uFF08\u76EE\u5F55\u4E2D\u6CA1\u6709\u63CF\u8FF0\uFF09",
        monitorConfig: "\u914D\u7F6E",
        // Context thresholds
        ctxApproxWindow: "\u4E0A\u4E0B\u6587\u7A97\u53E3\u5927\u5C0F",
        ctxThresholdInfo: "\u4FE1\u606F\u9608\u503C",
        ctxThresholdInfoTip: "\u4E0A\u4E0B\u6587\u4F7F\u7528\u91CF\u5360\u7A97\u53E3\u6BD4\u4F8B\u8D85\u8FC7\u6B64\u503C\u65F6\u89E6\u53D1\u4FE1\u606F\u7EA7\u544A\u8B66\u3002\u4F8B\u5982\u8BBE\u4E3A 70%\uFF0C\u5219\u4F7F\u7528 70% \u7A97\u53E3\u65F6\u63D0\u793A\u3002\u5EFA\u8BAE 60\u201375%\u3002",
        ctxThresholdWarning: "\u8B66\u544A\u9608\u503C",
        ctxThresholdWarningTip: "\u4E0A\u4E0B\u6587\u5360\u6BD4\u8D85\u8FC7\u6B64\u503C\u65F6\u89E6\u53D1\u8B66\u544A\u7EA7\u544A\u8B66\u3002\u5BF9\u8BDD\u5373\u5C06\u63A5\u8FD1\u7A97\u53E3\u4E0A\u9650\uFF0C\u65B0\u6D88\u606F\u53EF\u80FD\u88AB\u622A\u65AD\u3002\u5EFA\u8BAE 80\u201388%\u3002",
        ctxThresholdError: "\u9519\u8BEF\u9608\u503C",
        ctxThresholdErrorTip: "\u4E0A\u4E0B\u6587\u5360\u6BD4\u8D85\u8FC7\u6B64\u503C\u65F6\u89E6\u53D1\u9519\u8BEF\u7EA7\u544A\u8B66\u3002\u5BF9\u8BDD\u51E0\u4E4E\u7528\u5C3D\u7A97\u53E3\uFF0C\u6A21\u578B\u5DF2\u65E0\u6CD5\u83B7\u5F97\u5B8C\u6574\u4E0A\u4E0B\u6587\u3002\u5EFA\u8BAE 90\u201395%\u3002\u5FC5\u987B\u5927\u4E8E\u8B66\u544A\u9608\u503C\u3002",
        ctxPollBase: "\u4E0A\u4E0B\u6587\u8F6E\u8BE2\u57FA\u7840\u95F4\u9694",
        ctxPollBaseTip: "\u4E0A\u4E0B\u6587\u5360\u6BD4\u4F4E\u65F6\u7684\u91C7\u6837\u95F4\u9694\uFF08\u5929\u82B1\u677F\uFF09\u3002\u5360\u6BD4\u8D8A\u9AD8\u91C7\u6837\u8D8A\u5BC6\u3002\u7CBE\u786E\u6A21\u5F0F\u4E0B\u4F1A\u81EA\u52A8\u52A0\u500D\u95F4\u9694\uFF0C\u56E0\u4E3A\u4E8B\u4EF6\u6E90\u4F1A\u4E3B\u52A8\u63A8\u9001\u3002",
        ctxPollMin: "\u4E0A\u4E0B\u6587\u8F6E\u8BE2\u6700\u5C0F\u95F4\u9694",
        ctxPollMinTip: "\u4E0A\u4E0B\u6587\u5360\u6BD4\u5F88\u9AD8\u65F6\u7684\u91C7\u6837\u95F4\u9694\uFF08\u5730\u677F\uFF09\u3002\u9632\u6B62\u91C7\u6837\u8FC7\u4E8E\u9891\u7E41\u3002\u9ED8\u8BA4 2 \u79D2\u3002",
        // Context data source quality
        ctxSourcePrecise: "\u7CBE\u786E",
        ctxSourceUnavailable: "\u7B49\u5F85\u6570\u636E",
        ctxModelWindowMap: "\u6A21\u578B\u7A97\u53E3\u6620\u5C04",
        ctxCurrentModel: "\u5F53\u524D\u6A21\u578B",
        ctxWindowTokens: "\u7A97\u53E3\u5927\u5C0F",
        ctxWindowSource: "\u7A97\u53E3\u6765\u6E90",
        ctxDataSource: "\u6570\u636E\u6765\u6E90",
        ctxParamsSection: "\u914D\u7F6E\u53C2\u6570",
        ctxInputTokens: "\u8F93\u5165Token",
        ctxPressureTokens: "\u4E0A\u4E0B\u6587\u538B\u529B",
        ctxApproxWindowHint: "\u672A\u77E5\u6A21\u578B\u7684\u9ED8\u8BA4\u7A97\u53E3",
        ctxSrcRequestContext: "\u4F1A\u8BDD\u4E8B\u4EF6",
        ctxSrcCatalogAuto: "\u6A21\u578B\u76EE\u5F55",
        ctxSrcCatalogUnknown: "\u76EE\u5F55\u672A\u77E5",
        ctxSrcErrorExtracted: "\u9519\u8BEF\u89E3\u6790",
        ctxSrcUserMapping: "\u624B\u52A8\u914D\u7F6E",
        ctxSrcBuiltinTable: "\u5185\u7F6E\u8868",
        ctxSrcFuzzyMatch: "\u6A21\u7CCA\u5339\u914D",
        ctxSrcApproxDefault: "\u4F30\u7B97\u9ED8\u8BA4",
        ctxSrcUnknown: "\u672A\u77E5",
        ctxCatalogLoading: "\u52A0\u8F7D\u4E2D\u2026",
        ctxCatalogError: "\u76EE\u5F55\u52A0\u8F7D\u5931\u8D25",
        ctxCatalogRefresh: "\u5237\u65B0\u76EE\u5F55",
        ctxNoWindow: "\u2014",
        // Alert preview
        alertPreviewToggle: "\u67E5\u770B\u544A\u8B66\u6D88\u606F\u6837\u4F8B"
      };
      var en = {
        alertContextInfo: "Session context getting long",
        alertContextWarning: "Session context nearly exhausted",
        alertContextError: "Session context almost exhausted",
        alertCtxCluster: "Context Monitor",
        // Skills used in this session
        alertSkillUsed: "Skill used",
        ctxSkillsSection: "Skills used in this session",
        ctxSkillsEmpty: "No skills used in this session yet",
        ctxSkillsScope: "Current session only \u2014 subagents and other sessions are excluded",
        ctxSkillsViaModel: "Model",
        ctxSkillsViaUser: "User",
        ctxSkillsCount: "Uses",
        ctxSkillsFirst: "First",
        ctxSkillsLast: "Last",
        ctxSkillsOpen: "Open in sidebar",
        ctxSkillsLoading: "Reading the skill catalog\u2026",
        ctxSkillsFailed: "Skill catalog unavailable",
        ctxSkillsRetry: "Retry",
        ctxSkillsNoDesc: "(no description in catalog)",
        monitorConfig: "Configure",
        // Context thresholds
        ctxApproxWindow: "Context Window Size",
        ctxThresholdInfo: "Info Threshold",
        ctxThresholdInfoTip: "Triggers an info alert when context usage exceeds this percentage of the window. E.g. 70% means alerting when 70% of the window is consumed. Recommended: 60\u201375%.",
        ctxThresholdWarning: "Warning Threshold",
        ctxThresholdWarningTip: "Triggers a warning when context usage exceeds this percentage. The conversation is nearing the window limit \u2014 new messages may be truncated. Recommended: 80\u201388%.",
        ctxThresholdError: "Error Threshold",
        ctxThresholdErrorTip: "Triggers an error when context usage exceeds this percentage. The window is almost exhausted and the model cannot see the full context. Recommended: 90\u201395%. Must be greater than the Warning threshold.",
        ctxPollBase: "Context Poll Base Interval",
        ctxPollBaseTip: "Sampling interval when context usage is low (the ceiling). The higher the usage, the denser the sampling. In precise mode the interval is doubled automatically since the event source pushes updates.",
        ctxPollMin: "Context Poll Min Interval",
        ctxPollMinTip: "Minimum sampling interval even when context usage is high (the floor). Prevents excessive polling. Default 2s.",
        // Context data source quality
        ctxSourcePrecise: "Precise",
        ctxSourceUnavailable: "Awaiting data",
        ctxModelWindowMap: "Model Window Map",
        ctxCurrentModel: "Current Model",
        ctxWindowTokens: "Window Size",
        ctxWindowSource: "Window Source",
        ctxDataSource: "Data Source",
        ctxParamsSection: "Configuration",
        ctxInputTokens: "Input Tokens",
        ctxPressureTokens: "Context Pressure",
        ctxApproxWindowHint: "Default for unknown models",
        ctxSrcRequestContext: "Session Event",
        ctxSrcCatalogAuto: "Model Catalog",
        ctxSrcCatalogUnknown: "Catalog (unknown)",
        ctxSrcErrorExtracted: "Error Parsed",
        ctxSrcUserMapping: "Manual",
        ctxSrcBuiltinTable: "Built-in",
        ctxSrcFuzzyMatch: "Fuzzy Match",
        ctxSrcApproxDefault: "Fallback",
        ctxSrcUnknown: "Unknown",
        ctxCatalogLoading: "Loading\u2026",
        ctxCatalogError: "Catalog failed",
        ctxCatalogRefresh: "Refresh Catalog",
        ctxNoWindow: "\u2014",
        // Alert preview
        alertPreviewToggle: "View alert message samples"
      };
      var LOCALES = { zh, en };
      function detectLocaleTag() {
        try {
          var tag = document.documentElement.lang;
          if (tag) return tag;
        } catch (_) {
        }
        try {
          return navigator.language || "en";
        } catch (_) {
          return "en";
        }
      }
      function resolveLocaleKey(tag) {
        var lower = (tag || "").toLowerCase();
        if (lower.startsWith("zh")) return "zh";
        return "en";
      }
      var _currentLocaleKey = resolveLocaleKey(detectLocaleTag());
      if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
        try {
          var _langObserver = new MutationObserver(function() {
            var next = resolveLocaleKey(detectLocaleTag());
            if (next !== _currentLocaleKey) _currentLocaleKey = next;
          });
          _langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
        } catch (_) {
        }
      }
      function t(key) {
        var locale = LOCALES[_currentLocaleKey] || LOCALES.en;
        return locale[key] !== void 0 ? locale[key] : LOCALES.en[key] !== void 0 ? LOCALES.en[key] : key;
      }
      function L(key) {
        return function() {
          return t(key);
        };
      }
      var _CTX_ALERT_DEFAULTS = {
        ctxApproxWindow: 128e3,
        ctxThresholdInfo: 70,
        ctxThresholdWarning: 85,
        ctxThresholdError: 95,
        ctxPollBase: 2e4,
        ctxPollMin: 2e3,
        modelContextWindows: {},
        modelContextWindowSources: {}
      };
      var _ctxPrefs = Object.assign({}, _CTX_ALERT_DEFAULTS);
      var _prefCtx = null;
      var CTX_MON_NS = "dsh-flash-ctx-mon";
      var _hostRevision = null;
      var _prefWriteTail = Promise.resolve();
      var _pendingRevision = null;
      function _fenceRevision() {
        if (_pendingRevision !== null) return _pendingRevision;
        return _hostRevision === null ? void 0 : _hostRevision;
      }
      function _remoteSettings(ctx) {
        try {
          if (ctx && ctx.remote && ctx.remote.settings) return ctx.remote.settings;
        } catch (e) {
          console.warn("[dsh-flash-ctx-mon] ctx.remote.settings threw:", e && e.message);
        }
        try {
          var remote = ctx && ctx.get ? ctx.get("remote") : void 0;
          if (remote && remote.settings) return remote.settings;
        } catch (e) {
          console.warn('[dsh-flash-ctx-mon] ctx.get("remote") threw:', e && e.message);
        }
        return void 0;
      }
      function _describeAsync(settings) {
        try {
          return Promise.resolve(settings.describe());
        } catch (err) {
          return Promise.reject(err);
        }
      }
      var _PREFS_MAX_RETRIES = 8;
      var _PREFS_RETRY_DELAY_MS = 750;
      function loadCtxPrefs(ctx, _retryCount) {
        if (typeof _retryCount !== "number") _retryCount = 0;
        var settings = _remoteSettings(ctx);
        if (!settings) return Promise.resolve(false);
        if (typeof settings.describe !== "function") return Promise.resolve(false);
        return _describeAsync(settings).then(function(desc) {
          if (!desc) return false;
          var view = desc.value || desc;
          var list = view && Array.isArray(view.namespaces) ? view.namespaces : Array.isArray(view) ? view : null;
          if (!list) return false;
          var ns = list.find(function(n) {
            return (n && (n.ns || n.namespace)) === CTX_MON_NS;
          });
          if (!ns) {
            if (_retryCount < _PREFS_MAX_RETRIES) {
              return new Promise(function(resolve) {
                setTimeout(function() {
                  resolve(loadCtxPrefs(ctx, _retryCount + 1));
                }, _PREFS_RETRY_DELAY_MS);
              });
            }
            return false;
          }
          var resolved = ns.value || ns.resolved;
          if (!resolved) return false;
          _ctxPrefs = {
            ctxApproxWindow: resolved.ctxApproxWindow,
            ctxThresholdInfo: resolved.ctxThresholdInfo,
            ctxThresholdWarning: resolved.ctxThresholdWarning,
            ctxThresholdError: resolved.ctxThresholdError,
            ctxPollBase: resolved.ctxPollBase,
            ctxPollMin: resolved.ctxPollMin,
            modelContextWindows: resolved.modelContextWindows,
            modelContextWindowSources: resolved.modelContextWindowSources
          };
          if (typeof ns.revision === "number") _hostRevision = ns.revision;
          console.log("[dsh-flash-ctx-mon] preferences loaded from " + CTX_MON_NS + " namespace");
          return true;
        }).catch(function() {
          return false;
        });
      }
      function _alertPref(key) {
        var v = _ctxPrefs && _ctxPrefs[key];
        if (typeof v === "number" && isFinite(v)) return v;
        if (v != null && typeof v === "object") return v;
        return _CTX_ALERT_DEFAULTS[key];
      }
      function _writeAlertPref(ctx, key, value, onError) {
        savePrefs(ctx, Object.fromEntries([[key, value]]), null, onError);
      }
      function savePrefs(ctx, patch, localWrites, onError) {
        var saved = {};
        for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) saved[k] = _ctxPrefs && _ctxPrefs[k];
        if (_ctxPrefs) {
          for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) _ctxPrefs[k] = patch[k];
        }
        try {
          if (localWrites) localWrites();
        } catch (_) {
        }
        return _queuePrefWrite(ctx, patch, onError, saved);
      }
      function _revertPrefs(patch, saved, reason) {
        try {
          console.warn("[dsh-flash-ctx-mon] preference write rejected: " + reason + " \u2014 reverted [" + Object.keys(patch || {}).join(", ") + "]");
        } catch (_) {
        }
        for (var k in saved) {
          if (Object.prototype.hasOwnProperty.call(saved, k)) _ctxPrefs[k] = saved[k];
        }
      }
      function _queuePrefWrite(ctx, patch, onError, saved) {
        var task = _prefWriteTail.then(function() {
          var settings = _remoteSettings(ctx || _prefCtx);
          if (!settings || typeof settings.update !== "function") {
            if (onError) onError(patch, function() {
              _revertPrefs(patch, saved, "settings service unavailable");
            });
            return false;
          }
          return settings.update(CTX_MON_NS, patch, _fenceRevision()).then(function(res) {
            try {
              if (res && res.ok === false) {
                _pendingRevision = null;
                var err = res.error || {};
                if (onError) onError(patch, function() {
                  _revertPrefs(patch, saved, (err.code || "rejected") + (err.message ? ": " + err.message : ""));
                });
                try {
                  _describeAsync(settings).then(function(desc) {
                    if (desc && desc.ok !== false) {
                      var view2 = desc.value || desc;
                      var list2 = view2 && Array.isArray(view2.namespaces) ? view2.namespaces : Array.isArray(view2) ? view2 : null;
                      var ns2 = list2 && list2.find(function(n) {
                        return (n && (n.ns || n.namespace)) === CTX_MON_NS;
                      });
                      if (ns2 && typeof ns2.revision === "number") _hostRevision = ns2.revision;
                    }
                  }).catch(function() {
                  });
                } catch (_) {
                }
                return false;
              }
              var v = res && res.value;
              if (v && typeof v.revision === "number") {
                _pendingRevision = v.revision;
                _hostRevision = v.revision;
              }
            } catch (_) {
            }
            return true;
          }).catch(function(err) {
            _pendingRevision = null;
            if (onError) onError(patch, function() {
              _revertPrefs(patch, saved, "threw: " + (err && err.message || err));
            });
            return false;
          });
        });
        _prefWriteTail = task.then(function() {
        }, function() {
        });
        return task;
      }
      var _KNOWN_WINDOWS = {};
      var _modelCatalog = null;
      var _modelCatalogPromise = null;
      var _modelCatalogError = null;
      function _setModelCatalogError(reason) {
        _modelCatalogError = reason;
        try {
          console.warn("[dsh-flash-ctx-mon] model catalog unavailable: " + reason);
        } catch (_) {
        }
      }
      function resolveRemoteNamespace(ctx, name) {
        if (!ctx || typeof ctx.get !== "function") return null;
        try {
          var direct = ctx.get("remote." + name);
          if (direct) return direct;
        } catch (_) {
        }
        try {
          var root = ctx.get("remote");
          if (root && root[name]) return root[name];
        } catch (_) {
        }
        try {
          if (ctx.remote && ctx.remote[name]) return ctx.remote[name];
        } catch (_) {
        }
        return null;
      }
      function _fetchModelCatalog(ctx) {
        if (_modelCatalog) return Promise.resolve(_modelCatalog);
        if (_modelCatalogPromise) return _modelCatalogPromise;
        try {
          var session = resolveRemoteNamespace(ctx, "session");
          if (!session || typeof session.modelCatalog !== "function") {
            _setModelCatalogError("no remote.session namespace (resolved " + String(session) + ")");
            return Promise.resolve(null);
          }
          _modelCatalogPromise = session.modelCatalog().then(function(result) {
            _modelCatalogPromise = null;
            if (result && result.ok && result.value) {
              _modelCatalog = result.value;
              _modelCatalogError = null;
              _autoFillCatalogWindows(ctx);
              return _modelCatalog;
            }
            var err = result && result.error || null;
            _setModelCatalogError("rpc " + (err ? (err.code || "failed") + (err.message ? ": " + err.message : "") : "no result (ok=" + (result && result.ok) + ")"));
            return null;
          }).catch(function(e) {
            _modelCatalogPromise = null;
            _setModelCatalogError("threw: " + (e && e.message || e));
            return null;
          });
          return _modelCatalogPromise;
        } catch (e) {
          _setModelCatalogError("remote.session access threw: " + (e && e.message || e));
          return Promise.resolve(null);
        }
      }
      function _autoFillCatalogWindows(ctx) {
      }
      function _allKnownModels() {
        var seen = {};
        var entries = [];
        function addEntry(id, name, window2, source, provider) {
          if (!id) return;
          if (seen[id]) return;
          seen[id] = true;
          entries.push({
            id,
            name: name || null,
            window: window2,
            source,
            provider: provider || null
          });
        }
        var userMap = _alertPref("modelContextWindows");
        var userSources = _alertPref("modelContextWindowSources");
        if (userMap && typeof userMap === "object") {
          var userKeys = Object.keys(userMap);
          for (var i = 0; i < userKeys.length; i++) {
            var k = userKeys[i];
            var src = userSources && userSources[k] || CWS_USER_MAPPING;
            addEntry(k, null, userMap[k], src, null);
          }
        }
        if (_modelCatalog && _modelCatalog.groups) {
          for (var gi = 0; gi < _modelCatalog.groups.length; gi++) {
            var group = _modelCatalog.groups[gi];
            if (!group || !group.models) continue;
            for (var mi = 0; mi < group.models.length; mi++) {
              var model = group.models[mi];
              if (!model || !model.id) continue;
              if (seen[model.id]) continue;
              var resolved = _resolveWindow(model.id);
              var entrySource = resolved.window ? CWS_CATALOG_AUTO : CWS_CATALOG_UNKNOWN;
              addEntry(model.id, model.name, resolved.window, entrySource, group.id);
            }
          }
        }
        entries.sort(function(a, b) {
          if (a.window != null && b.window == null) return -1;
          if (a.window == null && b.window != null) return 1;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        return entries;
      }
      function _resolveWindow(modelName) {
        return resolveWindowFromMaps(
          modelName,
          _alertPref("modelContextWindows"),
          _alertPref("modelContextWindowSources")
        );
      }
      function _effectiveSource(sourceTag) {
        if (!sourceTag || sourceTag.indexOf(":") < 0) return sourceTag;
        var outer = sourceTag.slice(0, sourceTag.indexOf(":"));
        var inner = sourceTag.slice(sourceTag.indexOf(":") + 1);
        if (outer === CWS_CATALOG_AUTO) return inner;
        return outer;
      }
      function _sourceLabelKey(sourceTag) {
        if (!sourceTag) return "ctxSrcUnknown";
        switch (_effectiveSource(sourceTag)) {
          case CWS_REQUEST_CONTEXT:
            return "ctxSrcRequestContext";
          case CWS_CATALOG_AUTO:
            return "ctxSrcCatalogAuto";
          case CWS_CATALOG_UNKNOWN:
            return "ctxSrcCatalogUnknown";
          case CWS_ERROR_EXTRACTED:
            return "ctxSrcErrorExtracted";
          case CWS_USER_MAPPING:
            return "ctxSrcUserMapping";
          case CWS_BUILTIN_TABLE:
            return "ctxSrcBuiltinTable";
          case CWS_FUZZY_MATCH:
            return "ctxSrcFuzzyMatch";
          case CWS_APPROX_DEFAULT:
            return "ctxSrcApproxDefault";
          default:
            return "ctxSrcUnknown";
        }
      }
      function _sourceIcon(sourceTag) {
        if (!sourceTag) return "?";
        switch (_effectiveSource(sourceTag)) {
          case CWS_REQUEST_CONTEXT:
            return "\u{1F4E1}";
          case CWS_CATALOG_AUTO:
            return "\u{1F4CB}";
          case CWS_CATALOG_UNKNOWN:
            return "\u{1F4CB}";
          case CWS_ERROR_EXTRACTED:
            return "\u26A0\uFE0F";
          case CWS_USER_MAPPING:
            return "\u{1F464}";
          case CWS_BUILTIN_TABLE:
            return "\u{1F4D6}";
          case CWS_FUZZY_MATCH:
            return "\u{1F50D}";
          case CWS_APPROX_DEFAULT:
            return "\u{1F4D0}";
          default:
            return "?";
        }
      }
      var _activeTokenSource = null;
      function createSessionEventTokenSource() {
        var _unsubscribe = null;
        var _listUnsubscribe = null;
        var _lastUsage = null;
        var _lastProcessedSeq = -1;
        var _model = null;
        var _contextWindow = null;
        var _contextWindowModel = null;
        var _sessions = null;
        var _sessionId = null;
        var _ctx = null;
        var _bindRetryTimer = null;
        var _bindRetryCount = 0;
        function _persistExtractedWindow(windowValue, model, errorCode) {
          if (!windowValue || !model || !_ctx) return;
          var currentMap = _alertPref("modelContextWindows");
          if (!currentMap || typeof currentMap !== "object") currentMap = {};
          if (currentMap[model] === windowValue) return;
          var currentSources = _alertPref("modelContextWindowSources");
          if (!currentSources || typeof currentSources !== "object") currentSources = {};
          var existingSrc = currentSources[model];
          if (existingSrc === CWS_USER_MAPPING) return;
          var updated = Object.assign({}, currentMap);
          updated[model] = windowValue;
          var srcLabel = CWS_ERROR_EXTRACTED + (errorCode ? ":" + errorCode : "");
          var updatedSources = Object.assign({}, currentSources);
          updatedSources[model] = srcLabel;
          savePrefs(_ctx, {
            modelContextWindows: updated,
            modelContextWindowSources: updatedSources
          }, null, function(patch, rollback) {
            console.warn("[dsh-flash-ctx-mon] failed to persist error-extracted window:", patch);
            if (rollback) rollback();
          });
          _contextWindow = windowValue;
          console.log("[dsh-flash-ctx-mon] extracted context window from error: model=" + model + " window=" + windowValue + " source=" + srcLabel);
        }
        function _persistRequestContextWindow(windowValue, model) {
          if (!windowValue || !model || !_ctx) return;
          var currentMap = _alertPref("modelContextWindows");
          if (!currentMap || typeof currentMap !== "object") currentMap = {};
          if (currentMap[model] === windowValue) return;
          var currentSources = _alertPref("modelContextWindowSources");
          if (!currentSources || typeof currentSources !== "object") currentSources = {};
          var existingSrc = currentSources[model];
          if (existingSrc === CWS_USER_MAPPING) return;
          if (currentMap[model] != null && existingSrc && existingSrc !== CWS_REQUEST_CONTEXT) return;
          var updated = Object.assign({}, currentMap);
          updated[model] = windowValue;
          var updatedSources = Object.assign({}, currentSources);
          updatedSources[model] = CWS_REQUEST_CONTEXT;
          savePrefs(_ctx, {
            modelContextWindows: updated,
            modelContextWindowSources: updatedSources
          }, null, function() {
          });
          console.log("[dsh-flash-ctx-mon] context window from request/context: model=" + model + " window=" + windowValue + " source=" + CWS_REQUEST_CONTEXT);
        }
        function _usageOf(ev) {
          var data = ev.data;
          if (!data) return null;
          if (data.usage !== void 0 && typeof data.usage === "object") return data.usage;
          var stream = data.stream;
          if (Array.isArray(stream)) {
            for (var i = stream.length - 1; i >= 0; i--) {
              var record = stream[i];
              if (record && record.type === "chunk" && record.chunk && record.chunk.type === "usage") {
                return record.chunk.usage || null;
              }
            }
          }
          return null;
        }
        function _processEntries(entries) {
          var foundUsageInBatch = false;
          for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (entry.type !== "event") continue;
            var ev = entry.event;
            if (!ev) continue;
            var seq = ev.seq != null && typeof ev.seq === "number" ? ev.seq : -1;
            if (seq >= 0 && seq <= _lastProcessedSeq) continue;
            if (ev.type === "assistant/message" || ev.type === "assistant/attempt") {
              var usage = _usageOf(ev);
              if (usage && typeof usage === "object") {
                _lastUsage = {
                  inputTokens: typeof usage.inputTokens === "number" ? usage.inputTokens : 0,
                  outputTokens: typeof usage.outputTokens === "number" ? usage.outputTokens : 0,
                  cacheReadTokens: typeof usage.cacheReadTokens === "number" ? usage.cacheReadTokens : 0,
                  cacheWriteTokens: typeof usage.cacheWriteTokens === "number" ? usage.cacheWriteTokens : 0,
                  reasoningTokens: typeof usage.reasoningTokens === "number" ? usage.reasoningTokens : 0
                };
                foundUsageInBatch = true;
              } else {
                var dataKeys = ev.data ? Object.keys(ev.data).join(",") : "(no data)";
                console.warn("[dsh-flash-ctx-mon] assistant event without usage: type=" + ev.type + " seq=" + seq + " dataKeys=[" + dataKeys + "] hasUsage=" + !!(ev.data && ev.data.usage) + " hasStream=" + !!(ev.data && Array.isArray(ev.data.stream)) + (ev.data && Array.isArray(ev.data.stream) ? " streamLen=" + ev.data.stream.length : ""));
              }
              if (seq >= 0 && seq > _lastProcessedSeq) _lastProcessedSeq = seq;
            }
            if (ev.type === "request/header") {
              var data = ev.data;
              if (data && data.header && data.header.config && data.header.config.model) {
                var headerModel = data.header.config.model;
                if (headerModel !== _model) {
                  _model = headerModel;
                  _contextWindow = null;
                  _contextWindowModel = null;
                }
                if (_contextWindow == null) {
                  var resolved = _resolveWindow(_model);
                  _contextWindow = resolved.window;
                  _contextWindowModel = resolved.window != null ? _model : null;
                }
              }
              if (seq >= 0 && seq > _lastProcessedSeq) _lastProcessedSeq = seq;
            }
            if (ev.type === "request/context") {
              var rctx = ev.data;
              if (rctx && typeof rctx.model === "string" && rctx.model !== _model) {
                _model = rctx.model;
                _contextWindow = null;
                _contextWindowModel = null;
              }
              if (rctx && typeof rctx.contextWindow === "number" && rctx.contextWindow > 0) {
                _persistRequestContextWindow(rctx.contextWindow, _model);
                var resolvedCtx = _resolveWindow(_model);
                _contextWindow = resolvedCtx.window != null ? resolvedCtx.window : rctx.contextWindow;
                _contextWindowModel = _model;
              }
              if (seq >= 0 && seq > _lastProcessedSeq) _lastProcessedSeq = seq;
            }
            if (ev.type === "turn/end") {
              var endData = ev.data;
              if (endData && endData.reason && endData.reason.kind === "error") {
                var failure = endData.reason.error;
                if (failure && isContextLimitError(failure.code, failure.message)) {
                  var extractedWindow = extractWindowFromError(failure.message);
                  if (extractedWindow && _model) {
                    _persistExtractedWindow(extractedWindow, _model, failure.code || "");
                  }
                }
              }
              if (seq >= 0 && seq > _lastProcessedSeq) _lastProcessedSeq = seq;
            }
          }
          if (foundUsageInBatch) {
            var p = _lastUsage ? _lastUsage.inputTokens + (_lastUsage.cacheReadTokens || 0) + (_lastUsage.cacheWriteTokens || 0) : 0;
            console.log("[dsh-flash-ctx-mon] usage from events: pressure=" + p + " input=" + (_lastUsage ? _lastUsage.inputTokens : "?") + " cacheR=" + (_lastUsage ? _lastUsage.cacheReadTokens : "?") + " cacheW=" + (_lastUsage ? _lastUsage.cacheWriteTokens : "?") + " model=" + (_model || "?") + " window=" + (_contextWindow || "?"));
          }
        }
        function _onEventWindowChange() {
          if (!_sessions || !_sessionId) return;
          try {
            var binding = _sessions.binding(_sessionId);
            if (!binding) return;
            var win = binding.eventSource.getSnapshot();
            if (!win || !win.entries) return;
            if (win.change && win.change.kind === "replace") {
              _lastUsage = null;
              _lastProcessedSeq = -1;
              _model = null;
              _contextWindow = null;
              _contextWindowModel = null;
            }
            _processEntries(win.entries);
          } catch (e) {
          }
        }
        function _reset() {
          if (_unsubscribe) {
            try {
              _unsubscribe();
            } catch (_) {
            }
          }
          _unsubscribe = null;
          if (_bindRetryTimer) {
            clearTimeout(_bindRetryTimer);
            _bindRetryTimer = null;
          }
          _lastUsage = null;
          _lastProcessedSeq = -1;
          _model = null;
          _contextWindow = null;
          _contextWindowModel = null;
        }
        function _bindToSession() {
          if (!_sessions || !_sessionId) return;
          try {
            var binding = _sessions.binding(_sessionId);
            if (binding && binding.eventSource) {
              var win = binding.eventSource.getSnapshot();
              var entryCount = win && win.entries ? win.entries.length : 0;
              console.log("[dsh-flash-ctx-mon] SessionEventTokenSource: binding to session " + _sessionId + ", " + entryCount + " entries in snapshot");
              if (win && win.entries) _processEntries(win.entries);
              _unsubscribe = binding.eventSource.subscribe(_onEventWindowChange);
            } else {
              var snapN = 0;
              try {
                var _s = _sessions && _sessions.list && _sessions.list.getSnapshot ? _sessions.list.getSnapshot() : null;
                snapN = _s ? _s.ids ? _s.ids.length : 0 : 0;
              } catch (_) {
              }
              console.warn("[dsh-flash-ctx-mon] SessionEventTokenSource: no binding/eventSource for session " + _sessionId + " (" + snapN + " session(s) in list \u2014 binding only exists for an OPEN session)");
            }
          } catch (e) {
            console.warn("[dsh-flash-ctx-mon] SessionEventTokenSource: bindToSession error: " + (e.message || e));
          }
        }
        function _findMaterializedSession() {
          if (!_sessions) return null;
          try {
            var snap = _sessions.list && _sessions.list.getSnapshot ? _sessions.list.getSnapshot() : null;
            var ids = snap && snap.ids;
            if (!ids || !ids.length) return null;
            for (var i = 0; i < ids.length; i++) {
              var b = _sessions.binding(ids[i]);
              if (b && b.eventSource) return ids[i];
            }
          } catch (_) {
          }
          return null;
        }
        function _scheduleBindRetry(ctx) {
          if (_bindRetryTimer) return;
          _bindRetryTimer = setTimeout(function() {
            _bindRetryTimer = null;
            if (_sessionId && _unsubscribe) return;
            var id = _findMaterializedSession();
            if (id) {
              console.log("[dsh-flash-ctx-mon] SessionEventTokenSource: materialized session found on retry: " + id);
              _reset();
              _sessionId = id;
              _bindToSession();
            } else if (_sessions) {
              _bindRetryCount = (typeof _bindRetryCount === "number" ? _bindRetryCount : 0) + 1;
              if (_bindRetryCount < 30) {
                _scheduleBindRetry(ctx);
              } else {
                console.warn("[dsh-flash-ctx-mon] SessionEventTokenSource: gave up waiting for materialized session after 30 retries");
              }
            }
          }, 1e3);
        }
        function _tryBindSession(ctx) {
          try {
            _sessionId = _sessions.scopeOf(ctx);
          } catch (_) {
          }
          if (!_sessionId) {
            _sessionId = _findMaterializedSession();
          }
          console.log("[dsh-flash-ctx-mon] SessionEventTokenSource: sessions service found, sessionId=" + (_sessionId || "(none)") + (_sessionId ? " (materialized)" : " \u2014 no session open in UI"));
          try {
            var listStore = _sessions.list;
            if (listStore && listStore.subscribe) {
              _listUnsubscribe = listStore.subscribe(function() {
                var newId = null;
                try {
                  newId = _sessions.scopeOf(ctx);
                } catch (_) {
                }
                if (!newId) {
                  newId = _findMaterializedSession();
                }
                if (newId && newId !== _sessionId) {
                  _reset();
                  _sessionId = newId;
                  _bindToSession();
                } else if (!newId && _sessionId) {
                  console.log("[dsh-flash-ctx-mon] SessionEventTokenSource: bound session no longer materialized, resetting");
                  _reset();
                  _sessionId = null;
                  _scheduleBindRetry(ctx);
                }
              });
            }
          } catch (_) {
          }
          if (_sessionId) {
            _bindToSession();
          } else {
            _bindRetryCount = 0;
            _scheduleBindRetry(ctx);
          }
        }
        return {
          start: function(ctx) {
            _ctx = ctx;
            try {
              _sessions = ctx && ctx.get ? ctx.get("sessions") : void 0;
            } catch (_) {
            }
            if (!_sessions) {
              console.warn("[dsh-flash-ctx-mon] SessionEventTokenSource: sessions service not available (will retry)");
              var retryCtx = ctx;
              setTimeout(function() {
                if (_sessions) return;
                try {
                  _sessions = retryCtx && retryCtx.get ? retryCtx.get("sessions") : void 0;
                } catch (_) {
                }
                if (_sessions) {
                  console.log("[dsh-flash-ctx-mon] SessionEventTokenSource: sessions service available on retry");
                  _tryBindSession(retryCtx);
                } else {
                  console.warn("[dsh-flash-ctx-mon] SessionEventTokenSource: sessions service still not available after retry");
                }
              }, 3e3);
              return;
            }
            _tryBindSession(ctx);
          },
          stop: function() {
            _reset();
            if (_listUnsubscribe) {
              try {
                _listUnsubscribe();
              } catch (_) {
              }
            }
            _listUnsubscribe = null;
            _sessions = null;
            _sessionId = null;
            _ctx = null;
          },
          /** Returns the current token estimate.
           *  source: 'precise' when session events with usage are available,
           *  'unavailable' when no data has been received yet.
           *  windowConfirmed: whether `contextWindow` is a real limit for THIS
           *  model — a user mapping or the window DSH's adapter resolved. False
           *  means it is the ctxApproxWindow guess, which must never be used to
           *  judge pressure (see the provider).
           */
          getTokenEstimate: function() {
            if (_lastUsage) {
              var pressureTokens = _lastUsage.inputTokens + (_lastUsage.cacheReadTokens || 0) + (_lastUsage.cacheWriteTokens || 0);
              var resolved = _resolveWindow(_model);
              var windowValue, windowSource, windowConfirmed;
              if (resolved.window != null) {
                windowValue = resolved.window;
                windowSource = resolved.source;
                windowConfirmed = true;
              } else if (_contextWindow != null && _contextWindowModel === _model) {
                windowValue = _contextWindow;
                windowSource = CWS_REQUEST_CONTEXT;
                windowConfirmed = true;
              } else {
                windowValue = _alertPref("ctxApproxWindow");
                windowSource = CWS_APPROX_DEFAULT;
                windowConfirmed = false;
              }
              return {
                pressureTokens,
                inputTokens: _lastUsage.inputTokens,
                outputTokens: _lastUsage.outputTokens,
                cacheReadTokens: _lastUsage.cacheReadTokens || 0,
                cacheWriteTokens: _lastUsage.cacheWriteTokens || 0,
                reasoningTokens: _lastUsage.reasoningTokens || 0,
                contextWindow: windowValue,
                windowSource,
                windowConfirmed,
                model: _model,
                source: "precise"
              };
            }
            return { source: "unavailable" };
          }
        };
      }
      var SKILL_CONTENT_PREFIX2 = '<skill_content name="';
      var SKILL_NOTICE_FRESH_MS = 15e3;
      var SKILL_TRACK_LIMIT = 200;
      function findMainViewSessionId(sessions) {
        if (!sessions || !sessions.list || typeof sessions.list.getSnapshot !== "function") return null;
        var snap;
        try {
          snap = sessions.list.getSnapshot();
        } catch (_) {
          return null;
        }
        var byId = snap && snap.byId;
        if (!byId) return null;
        var ids = Object.keys(byId);
        for (var i = 0; i < ids.length; i++) {
          var row = byId[ids[i]];
          if (row && row.retainedBy && (row.retainedBy.mainView || 0) > 0) return ids[i];
        }
        return null;
      }
      var _activeSkillTracker = null;
      function createSessionSkillTracker() {
        var _ctx = null;
        var _sessions = null;
        var _sessionId = null;
        var _bindingUnsub = null;
        var _listUnsub = null;
        var _retryTimer = null;
        var _retryCount = 0;
        var _bindRetryTimer = null;
        var _bindRetryCount = 0;
        var _skills = {};
        var _order = [];
        var _skillCalls = {};
        var _lastSeq = -1;
        var _listeners = [];
        var _notified = {};
        function _notify() {
          var ls = _listeners.slice();
          for (var i = 0; i < ls.length; i++) {
            try {
              ls[i]();
            } catch (_) {
            }
          }
        }
        function _clearSkills() {
          _skills = {};
          _order = [];
          _skillCalls = {};
          _lastSeq = -1;
          _notify();
        }
        function _record(name, via, ev) {
          if (_order.length >= SKILL_TRACK_LIMIT && !_skills[name]) return;
          var time = ev && typeof ev.time === "number" ? ev.time : Date.now();
          var seq = ev && typeof ev.seq === "number" ? ev.seq : -1;
          var rec = _skills[name];
          if (!rec) {
            rec = _skills[name] = {
              name,
              count: 0,
              viaModel: 0,
              viaUser: 0,
              firstTime: time,
              lastTime: time,
              firstSeq: seq,
              lastSeq: seq
            };
            _order.push(name);
          }
          rec.count++;
          if (via === "user") rec.viaUser++;
          else rec.viaModel++;
          if (time < rec.firstTime) rec.firstTime = time;
          if (time > rec.lastTime) rec.lastTime = time;
          if (seq >= 0) {
            if (rec.firstSeq < 0 || seq < rec.firstSeq) rec.firstSeq = seq;
            if (seq > rec.lastSeq) rec.lastSeq = seq;
          }
        }
        function _processEntries(entries) {
          if (!entries || !entries.length) return;
          var changed = false;
          for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (!entry || entry.type !== "event") continue;
            var ev = entry.event;
            if (!ev) continue;
            var seq = typeof ev.seq === "number" ? ev.seq : -1;
            if (seq >= 0 && seq <= _lastSeq) continue;
            if (seq > _lastSeq) _lastSeq = seq;
            var data = ev.data || {};
            if (ev.type === "user/message") {
              var injected = findSkillBlock(data.content, 0);
              if (injected) {
                _record(injected, "user", ev);
                changed = true;
              }
            } else if (ev.type === "tool/call") {
              if (data.name === "skill" && typeof data.callId === "string") {
                _skillCalls[data.callId] = true;
              }
            } else if (ev.type === "tool/result") {
              var msg = data.message || {};
              var callId = msg.source && msg.source.callId || msg.toolCallId || data.callId;
              if (callId && _skillCalls[callId]) {
                delete _skillCalls[callId];
                var loaded = findSkillBlock(msg.content, 0);
                if (loaded) {
                  _record(loaded, "model", ev);
                  changed = true;
                }
              }
            }
          }
          if (changed) _notify();
        }
        function _onWindowChange() {
          if (!_sessions || !_sessionId) return;
          try {
            var binding = _sessions.binding(_sessionId);
            if (!binding || !binding.eventSource) return;
            var win = binding.eventSource.getSnapshot();
            if (!win || !win.entries) return;
            if (win.change && win.change.kind === "replace") {
              _clearSkills();
            }
            _processEntries(win.entries);
          } catch (_) {
          }
        }
        function _unbind() {
          if (_bindingUnsub) {
            try {
              _bindingUnsub();
            } catch (_) {
            }
          }
          _bindingUnsub = null;
          if (_bindRetryTimer) {
            clearTimeout(_bindRetryTimer);
            _bindRetryTimer = null;
          }
        }
        function _bind(id) {
          try {
            var binding = _sessions.binding(id);
            if (!binding || !binding.eventSource) return false;
            var win = binding.eventSource.getSnapshot();
            if (win && win.entries) _processEntries(win.entries);
            _bindingUnsub = binding.eventSource.subscribe(_onWindowChange);
            return true;
          } catch (_) {
            return false;
          }
        }
        function _syncSession() {
          if (!_sessions) return;
          var id = findMainViewSessionId(_sessions);
          if (id === _sessionId) return;
          _unbind();
          _bindRetryCount = 0;
          _sessionId = id;
          _notified = {};
          _clearSkills();
          if (id && !_bind(id)) _scheduleBindRetry(id);
        }
        function _scheduleBindRetry(id) {
          if (_bindRetryTimer) return;
          _bindRetryTimer = setTimeout(function() {
            _bindRetryTimer = null;
            if (_sessionId !== id) return;
            if (_bind(id)) return;
            if (++_bindRetryCount < 15) _scheduleBindRetry(id);
          }, 800);
        }
        function _scheduleServiceRetry() {
          if (_retryTimer) return;
          _retryTimer = setTimeout(function() {
            _retryTimer = null;
            if (_sessions && _listUnsub) return;
            try {
              _sessions = _ctx && _ctx.get ? _ctx.get("sessions") : void 0;
            } catch (_) {
            }
            if (!_sessions) {
              if (++_retryCount < 30) _scheduleServiceRetry();
              return;
            }
            _attachList();
            _syncSession();
          }, 1e3);
        }
        function _attachList() {
          if (_listUnsub || !_sessions) return;
          try {
            if (_sessions.list && typeof _sessions.list.subscribe === "function") {
              _listUnsub = _sessions.list.subscribe(_syncSession);
            }
          } catch (_) {
          }
        }
        return {
          start: function(ctx) {
            _ctx = ctx;
            try {
              _sessions = ctx && ctx.get ? ctx.get("sessions") : void 0;
            } catch (_) {
            }
            if (!_sessions) {
              _scheduleServiceRetry();
              return;
            }
            _attachList();
            _syncSession();
          },
          stop: function() {
            _unbind();
            if (_listUnsub) {
              try {
                _listUnsub();
              } catch (_) {
              }
            }
            _listUnsub = null;
            if (_retryTimer) {
              clearTimeout(_retryTimer);
              _retryTimer = null;
            }
            _sessions = null;
            _sessionId = null;
            _ctx = null;
            _clearSkills();
            _listeners = [];
          },
          subscribe: function(fn) {
            if (typeof fn !== "function") return function() {
            };
            _listeners.push(fn);
            var alive = true;
            return function() {
              if (!alive) return;
              alive = false;
              var i = _listeners.indexOf(fn);
              if (i >= 0) _listeners.splice(i, 1);
            };
          },
          getSessionId: function() {
            return _sessionId;
          },
          getSkills: function() {
            var out = [];
            for (var i = 0; i < _order.length; i++) out.push(_skills[_order[i]]);
            return out;
          },
          /** Skills for `sessionId`. Anything that is not the tracked session
           *  gets an empty list — this is the isolation boundary. */
          getSkillsFor: function(sessionId) {
            if (!sessionId || sessionId !== _sessionId) return [];
            var out = [];
            for (var i = 0; i < _order.length; i++) out.push(_skills[_order[i]]);
            return out;
          },
          /** Names whose first-use notice has not been handed out yet, and whose
           *  first use is recent enough to be a live event rather than replayed
           *  history. Claiming is one-way: each name is returned at most once per
           *  tracked session, so the caller can report it to the alert registry
           *  without ever having to withdraw and re-raise it.
           *  @param nowMs - current wall clock, injectable for tests
           *  @returns skill names to announce, in first-use order */
          claimNewSkills: function(nowMs) {
            var now = typeof nowMs === "number" ? nowMs : Date.now();
            var claimed = [];
            for (var i = 0; i < _order.length; i++) {
              var name = _order[i];
              if (_notified[name]) continue;
              var rec = _skills[name];
              if (!rec) continue;
              if (now - rec.firstTime > SKILL_NOTICE_FRESH_MS) {
                _notified[name] = true;
                continue;
              }
              _notified[name] = true;
              claimed.push(name);
            }
            return claimed;
          }
        };
      }
      function createSessionContextProvider() {
        var timer = null;
        var callback = null;
        var tokenSource = null;
        var skillUnsub = null;
        function estimateContextRatio(tokenEstimate) {
          if (tokenEstimate && tokenEstimate.source === "precise") {
            var window2 = tokenEstimate.contextWindow;
            if (!(window2 > 0)) return null;
            var pressure = tokenEstimate.pressureTokens || 0;
            return {
              ratio: pressure / window2,
              msgCount: -1,
              // not meaningful for precise mode
              estTokens: pressure,
              source: "precise",
              model: tokenEstimate.model || null,
              contextWindow: window2,
              // Breakdown for detailed display
              inputTokens: tokenEstimate.inputTokens,
              outputTokens: tokenEstimate.outputTokens,
              cacheReadTokens: tokenEstimate.cacheReadTokens,
              cacheWriteTokens: tokenEstimate.cacheWriteTokens,
              reasoningTokens: tokenEstimate.reasoningTokens
            };
          }
          return null;
        }
        function poll() {
          if (!callback) return;
          var alerts = [];
          var tokenEstimate = tokenSource ? tokenSource.getTokenEstimate() : { source: "unavailable" };
          var windowConfirmed = !!(tokenEstimate && tokenEstimate.windowConfirmed);
          var est = windowConfirmed ? estimateContextRatio(tokenEstimate) : null;
          if (est) {
            var ratio = est.ratio;
            var tInfo = _alertPref("ctxThresholdInfo") / 100;
            var tWarn = _alertPref("ctxThresholdWarning") / 100;
            var tErr = _alertPref("ctxThresholdError") / 100;
            if (!(tInfo < tWarn && tWarn < tErr)) {
              tInfo = 0.7;
              tWarn = 0.85;
              tErr = 0.95;
            }
            var sourceLabel = est.source === "precise" ? (est.model || "?") + " \xB7 " + formatTokenK(est.estTokens) + "/" + formatTokenK(est.contextWindow) : "~" + formatTokenK(est.estTokens) + "/" + formatTokenK(est.contextWindow) + " (estimated)";
            if (ratio >= tErr) {
              alerts.push({
                id: "ctx-error",
                severity: "error",
                title: function() {
                  return t("alertContextError");
                },
                message: function() {
                  return t("alertContextError") + " (" + Math.round(ratio * 100) + "% \xB7 " + sourceLabel + ")";
                },
                icon: "\u{1F534}",
                timestamp: Date.now(),
                dismissible: true
              });
            } else if (ratio >= tWarn) {
              alerts.push({
                id: "ctx-warning",
                severity: "warning",
                title: function() {
                  return t("alertContextWarning");
                },
                message: function() {
                  return t("alertContextWarning") + " (" + Math.round(ratio * 100) + "% \xB7 " + sourceLabel + ")";
                },
                icon: "\u{1F7E1}",
                timestamp: Date.now(),
                dismissible: true
              });
            } else if (ratio >= tInfo) {
              alerts.push({
                id: "ctx-info",
                severity: "info",
                title: function() {
                  return t("alertContextInfo");
                },
                message: function() {
                  return t("alertContextInfo") + " (" + Math.round(ratio * 100) + "% \xB7 " + sourceLabel + ")";
                },
                icon: "\u{1F535}",
                timestamp: Date.now(),
                dismissible: true
              });
            }
          }
          var skillTracker = _activeSkillTracker;
          if (skillTracker) {
            var freshSkills = skillTracker.claimNewSkills(Date.now());
            for (var sj = 0; sj < freshSkills.length; sj++) {
              alerts.push((function(name) {
                return {
                  id: "ctx-skill-used-" + name,
                  severity: "info",
                  title: function() {
                    return t("alertSkillUsed");
                  },
                  message: function() {
                    return name;
                  },
                  icon: "\u{1F9E9}",
                  timestamp: Date.now(),
                  dismissible: true
                };
              })(freshSkills[sj]));
            }
          }
          try {
            callback(alerts);
          } catch (_) {
          }
          var pollBase = _alertPref("ctxPollBase");
          var pollMin = _alertPref("ctxPollMin");
          var nextInterval;
          if (est) {
            var r = Math.min(est.ratio, 1);
            nextInterval = Math.max(pollMin, Math.round(pollBase * Math.pow(1 - r, 2) + pollMin));
            if (tokenEstimate && tokenEstimate.source === "precise") {
              nextInterval = Math.max(pollMin, nextInterval * 2);
            }
          } else if (tokenEstimate && tokenEstimate.source === "precise") {
            nextInterval = pollMin;
          } else {
            nextInterval = pollBase;
          }
          timer = setTimeout(poll, nextInterval);
        }
        return {
          id: "dsh-flash-ctx-mon:context-alert",
          start: function(cb, ctx) {
            callback = cb;
            tokenSource = createSessionEventTokenSource();
            tokenSource.start(ctx);
            _activeTokenSource = tokenSource;
            if (_activeSkillTracker && typeof _activeSkillTracker.subscribe === "function") {
              skillUnsub = _activeSkillTracker.subscribe(function() {
                if (!callback) return;
                if (timer) {
                  clearTimeout(timer);
                  timer = null;
                }
                poll();
              });
            }
            poll();
          },
          stop: function() {
            callback = null;
            if (timer) {
              clearTimeout(timer);
              timer = null;
            }
            if (skillUnsub) {
              try {
                skillUnsub();
              } catch (_) {
              }
              skillUnsub = null;
            }
            if (tokenSource) {
              tokenSource.stop();
              tokenSource = null;
            }
            _activeTokenSource = null;
          }
        };
      }
      class PanelErrorBoundary extends Component {
        constructor(props) {
          super(props);
          this.state = { hasError: false, error: null };
        }
        static getDerivedStateFromError(error) {
          return { hasError: true, error };
        }
        componentDidCatch(error, info) {
          console.error("[dsh-flash-ctx-mon] Panel render error (caught by boundary):", error, info);
        }
        render() {
          if (this.state.hasError) {
            return h(
              "div",
              {
                style: {
                  padding: "12px 16px",
                  color: "var(--dsw-alias-label-secondary, #8b949e)",
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                  fontSize: "12px"
                }
              },
              h(
                "div",
                { style: { marginBottom: "6px", color: "var(--dsw-alias-label-warning, #d29922)" } },
                "\u26A0 ctx-mon render error"
              ),
              h("div", null, String(this.state.error && this.state.error.message || this.state.error || "Unknown error")),
              h("button", {
                style: {
                  marginTop: "8px",
                  padding: "2px 10px",
                  fontSize: "11px",
                  cursor: "pointer",
                  borderRadius: "4px",
                  border: "1px solid var(--dsw-alias-border-l2, #21262d)",
                  background: "var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.85))",
                  color: "var(--dsw-alias-label-primary, #c9d1d9)"
                },
                onClick: function() {
                  this.setState({ hasError: false, error: null });
                }.bind(this)
              }, "Retry")
            );
          }
          return this.props.children;
        }
      }
      var R = {
        xs: "var(--dsw-radius-xs, 4px)",
        sm: "var(--dsw-radius-sm, 8px)",
        md: "var(--dsw-radius-md, 12px)",
        lg: "var(--dsw-radius-lg, 16px)",
        xl: "var(--dsw-radius-xl, 20px)",
        panel: "var(--dsw-radius-panel, 28px)"
      };
      var E = {
        prominent: "var(--dsw-elevation-prominent, 0 0 0 0.5px var(--dsw-alias-border-l4, #0003), 0 3px 8px 0 rgba(0,0,0,.04), 0 0 20px 0 rgba(0,0,0,.05))"
      };
      var S = {
        // Parameter grid (used by MonitorConfigModal): two columns of
        // label-above-slider cells.
        paramGrid: {
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          columnGap: "16px",
          rowGap: "6px",
          alignItems: "start"
        },
        paramCell: {
          minWidth: 0,
          marginBottom: "6px"
        },
        paramLabel: {
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "12px",
          lineHeight: "18px",
          color: "var(--dsw-alias-label-primary, #c9d1d9)"
        },
        paramHint: {
          fontSize: "11px",
          lineHeight: "15px",
          opacity: 0.4,
          marginBottom: "2px"
        },
        switchIcon: {
          display: "inline-flex",
          verticalAlign: "-2px",
          marginRight: "2px"
        },
        sliderRow: {
          display: "flex",
          alignItems: "center",
          gap: "8px",
          minWidth: 0,
          marginTop: "2px"
        },
        slider: {
          flex: 1,
          minWidth: 0
        },
        value: {
          fontSize: "11px",
          color: "var(--dsw-alias-label-secondary, #8b949e)",
          minWidth: "42px",
          textAlign: "right"
        },
        // Monitor config modal
        monitorModalMask: {
          position: "fixed",
          inset: 0,
          zIndex: 2200,
          background: "var(--dsw-alias-bg-mask-1, #0000003d)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        },
        monitorModal: {
          background: "var(--dsw-alias-bg-layer-2, #fff)",
          border: 0,
          borderRadius: R.panel,
          width: "90vw",
          maxWidth: "680px",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: E.prominent
        },
        monitorModalHead: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "0.5px solid var(--dsw-alias-border-l2, #0003)"
        },
        monitorModalTitle: {
          fontWeight: 500,
          fontSize: "16px",
          lineHeight: "24px",
          color: "var(--dsw-alias-label-primary, #000)"
        },
        monitorModalClose: {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "28px",
          height: "28px",
          border: 0,
          borderRadius: R.sm,
          background: "transparent",
          color: "var(--dsw-alias-label-secondary, #61666b)",
          cursor: "pointer",
          fontSize: "14px",
          padding: 0
        },
        monitorModalBody: {
          flex: 1,
          overflowY: "auto",
          padding: "10px 14px",
          scrollbarWidth: "thin",
          scrollbarColor: "var(--dsw-alias-scrollbar-bg-l1, #ccc) var(--dsw-alias-bg-layer-2, transparent)"
        },
        monitorModalDivider: {
          marginTop: "12px",
          paddingTop: "10px",
          borderTop: "0.5px solid var(--dsw-alias-border-l2, #0003)"
        },
        monitorModalSectionTitle: {
          display: "block",
          fontWeight: 500,
          fontSize: "14px",
          lineHeight: "22px",
          marginBottom: "8px",
          color: "var(--dsw-alias-label-secondary, #61666b)"
        },
        // Alert preview
        alertPreviewToggle: {
          background: "none",
          border: 0,
          padding: 0,
          cursor: "pointer",
          color: "var(--dsw-alias-label-secondary, #8b949e)",
          fontSize: "12px"
        },
        // Fold toggles for the config-params and data-source sections — same
        // style as the alert-preview toggle, one pattern for every collapsible
        // section in the panel. Each sits directly under its own divider, so it
        // deliberately carries no extra top margin.
        sectionFoldToggle: {
          background: "none",
          border: 0,
          padding: 0,
          cursor: "pointer",
          color: "var(--dsw-alias-label-secondary, #8b949e)",
          fontSize: "12px"
        },
        // The leading skills title, emphasized with the primary label color.
        skillsSectionTitle: {
          display: "block",
          fontWeight: 500,
          fontSize: "14px",
          lineHeight: "22px",
          marginBottom: "8px",
          color: "var(--dsw-alias-label-primary, #c9d1d9)"
        },
        // Card behind the skills table when the section leads the panel: the
        // standard card plus a brand-colored rail, so the reason the panel was
        // opened is unmistakable at a glance.
        skillsLeadCard: {
          padding: "8px 12px",
          background: "var(--dsw-alias-bg-layer-1, #f5f5f5)",
          borderRadius: R.md,
          borderLeft: "2px solid var(--dsw-alias-brand-primary, #58a6ff)"
        },
        alertPreviewCard: {
          padding: "8px 12px",
          background: "var(--dsw-alias-bg-layer-1, #f5f5f5)",
          borderRadius: R.md,
          fontSize: "12px",
          lineHeight: "1.5"
        },
        alertPreviewGroup: {
          marginBottom: "8px"
        },
        alertPreviewRow: {
          display: "flex",
          alignItems: "center",
          gap: "6px",
          marginBottom: "2px"
        },
        alertPreviewIcon: {
          flex: "none",
          fontSize: "11px"
        },
        alertPreviewMsg: {
          flex: 1,
          color: "var(--dsw-alias-label-secondary, #8b949e)"
        },
        alertPreviewCond: {
          color: "var(--dsw-alias-label-secondary, #8b949e)",
          fontSize: "11px",
          opacity: 0.6
        },
        // Context live data
        memColumnCard: {
          padding: "8px 12px",
          background: "var(--dsw-alias-bg-layer-1, #f5f5f5)",
          borderRadius: R.md
        },
        memSubSectionLabel: {
          display: "block",
          fontWeight: 600,
          fontSize: "11px",
          marginBottom: "6px",
          color: "var(--dsw-alias-label-secondary, #8b949e)"
        },
        memLiveDataGrid: {
          display: "grid",
          gridTemplateColumns: "auto auto",
          columnGap: "10px",
          rowGap: "4px",
          fontSize: "12px"
        },
        memLiveDataLabel: {
          color: "var(--dsw-alias-label-secondary, #8b949e)"
        },
        memLiveDataValue: {
          color: "var(--dsw-alias-label-primary, #c9d1d9)",
          fontWeight: 500
        },
        memUsageBarTrack: {
          height: "4px",
          borderRadius: "2px",
          background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
          marginTop: "2px"
        },
        memUsageBarFill: {
          height: "100%",
          borderRadius: "2px",
          transition: "width 0.3s ease, background 0.3s ease"
        },
        tabPageChevron: {
          display: "inline-block",
          fontSize: "8px",
          transition: "transform 0.15s ease",
          transform: "rotate(0deg)"
        },
        tabPageChevronOpen: {
          display: "inline-block",
          fontSize: "8px",
          transition: "transform 0.15s ease",
          transform: "rotate(90deg)"
        },
        // Skills used in this session — header chip (session-scoped slot)
        skillChip: {
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          maxWidth: "240px",
          height: "24px",
          padding: "0 8px",
          border: "0.5px solid var(--dsw-alias-border-l2, #0003)",
          borderRadius: "999px",
          background: "transparent",
          color: "var(--dsw-alias-label-secondary, #61666b)",
          fontSize: "12px",
          lineHeight: "22px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          cursor: "pointer"
        },
        skillChipIcon: {
          flex: "none",
          fontSize: "11px"
        },
        // Skills used in this session — detail rows in the config modal
        skillRow: {
          display: "flex",
          flexDirection: "column",
          gap: "2px",
          padding: "6px 0",
          borderTop: "0.5px solid var(--dsw-alias-border-l1, #0002)"
        },
        skillRowHead: {
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "12px"
        },
        skillName: {
          fontFamily: "var(--dsw-font-markdown-code-block-small, ui-monospace, monospace)",
          color: "var(--dsw-alias-label-primary, #c9d1d9)",
          fontWeight: 500
        },
        skillBadge: {
          flex: "none",
          padding: "0 6px",
          borderRadius: "999px",
          background: "var(--dsw-alias-bg-layer-2, #00000010)",
          color: "var(--dsw-alias-label-secondary, #8b949e)",
          fontSize: "10px",
          lineHeight: "16px"
        },
        skillMeta: {
          color: "var(--dsw-alias-label-secondary, #8b949e)",
          fontSize: "11px"
        },
        skillDesc: {
          color: "var(--dsw-alias-label-secondary, #8b949e)",
          fontSize: "11px",
          lineHeight: "1.5"
        },
        skillPathRow: {
          display: "flex",
          alignItems: "center",
          gap: "6px",
          minWidth: 0
        },
        skillPath: {
          flex: 1,
          minWidth: 0,
          fontFamily: "var(--dsw-font-markdown-code-block-small, ui-monospace, monospace)",
          fontSize: "10px",
          color: "var(--dsw-alias-label-secondary, #8b949e)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          direction: "rtl",
          textAlign: "left"
        },
        skillOpenBtn: {
          flex: "none",
          padding: "1px 8px",
          border: "0.5px solid var(--dsw-alias-border-l2, #0003)",
          borderRadius: R.xs,
          background: "transparent",
          color: "var(--dsw-alias-label-secondary, #8b949e)",
          fontSize: "10px",
          cursor: "pointer"
        }
      };
      function ModelWindowMapEditor(props) {
        var tick = props.tick;
        var setTick = props.setTick;
        var ctx = props.ctx || _prefCtx;
        var _catState = useState(_modelCatalog ? "loaded" : "idle");
        var catState = _catState[0], setCatState = _catState[1];
        useEffect(function() {
          if (_modelCatalog) {
            setCatState("loaded");
            return;
          }
          setCatState("loading");
          _fetchModelCatalog(ctx).then(function() {
            setCatState(_modelCatalog ? "loaded" : "error");
            setTick(function(v) {
              return v + 1;
            });
          });
        }, []);
        var models = _allKnownModels();
        var badgeStyle = {
          display: "inline-flex",
          alignItems: "center",
          gap: "3px",
          fontSize: "10px",
          padding: "1px 5px",
          borderRadius: "8px",
          whiteSpace: "nowrap",
          lineHeight: "14px"
        };
        var srcBadgeColors = {};
        srcBadgeColors[CWS_REQUEST_CONTEXT] = { bg: "rgba(88,166,255,0.15)", color: "#58a6ff" };
        srcBadgeColors[CWS_CATALOG_AUTO] = { bg: "rgba(63,185,80,0.15)", color: "#3fb950" };
        srcBadgeColors[CWS_CATALOG_UNKNOWN] = { bg: "rgba(63,185,80,0.1)", color: "#3fb950" };
        srcBadgeColors[CWS_ERROR_EXTRACTED] = { bg: "rgba(248,81,73,0.15)", color: "#f85149" };
        srcBadgeColors[CWS_USER_MAPPING] = { bg: "rgba(210,153,34,0.15)", color: "#d29922" };
        srcBadgeColors[CWS_BUILTIN_TABLE] = { bg: "rgba(139,148,158,0.15)", color: "#8b949e" };
        srcBadgeColors[CWS_FUZZY_MATCH] = { bg: "rgba(139,148,158,0.15)", color: "#8b949e" };
        srcBadgeColors[CWS_APPROX_DEFAULT] = { bg: "rgba(139,148,158,0.1)", color: "#484f58" };
        function renderSourceBadge(sourceTag) {
          var effective = _effectiveSource(sourceTag);
          var icon = _sourceIcon(sourceTag);
          var label = t(_sourceLabelKey(sourceTag));
          var colors = srcBadgeColors[effective] || srcBadgeColors[CWS_APPROX_DEFAULT];
          return h("span", {
            style: Object.assign({}, badgeStyle, {
              background: colors.bg,
              color: colors.color
            }),
            title: sourceTag
          }, icon, label);
        }
        function formatWindow(w) {
          if (w == null) return t("ctxNoWindow");
          return formatTokenK(w);
        }
        var rows = models.map(function(entry) {
          var id = entry.id;
          var name = entry.name;
          var window2 = entry.window;
          var source = entry.source;
          var provider = entry.provider;
          var displayName = name || id;
          var idHint = name && name !== id ? id : null;
          var userMap = _alertPref("modelContextWindows");
          var isInUserMap = userMap && userMap[id] != null;
          var sources = _alertPref("modelContextWindowSources");
          var storedSource = sources && sources[id] || null;
          var effectiveSource = storedSource || source || CWS_APPROX_DEFAULT;
          return h(
            "div",
            {
              key: id,
              style: {
                display: "flex",
                alignItems: "center",
                gap: "6px",
                marginBottom: "3px",
                padding: "2px 0"
              }
            },
            // Source badge
            renderSourceBadge(effectiveSource),
            // Model name
            h(
              "span",
              {
                style: {
                  flex: "1",
                  fontSize: "12px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  opacity: window2 != null ? 1 : 0.5
                },
                title: id + (provider ? " (" + provider + ")" : "")
              },
              displayName,
              idHint ? h("span", { style: { fontSize: "10px", opacity: 0.5, marginLeft: "4px" } }, idHint) : null
            ),
            // Window value (editable)
            h("input", {
              type: "number",
              value: window2 != null ? window2 : "",
              placeholder: "tokens",
              style: {
                width: "72px",
                fontSize: "12px",
                padding: "2px 4px",
                borderRadius: "4px",
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.05)",
                color: "inherit",
                opacity: window2 != null ? 1 : 0.5
              },
              onChange: function(e) {
                var raw = e.target.value;
                if (raw === "") {
                  if (isInUserMap) {
                    var updated = Object.assign({}, userMap);
                    delete updated[id];
                    var updatedSources = Object.assign({}, sources || {});
                    delete updatedSources[id];
                    _writeAlertPref(ctx, "modelContextWindows", updated, function(patch, rollback) {
                      rollback();
                    });
                    setTick(function(v) {
                      return v + 1;
                    });
                  }
                  return;
                }
                var val = Number(raw);
                if (!isFinite(val) || val <= 0) return;
                var updated = Object.assign({}, userMap || {});
                updated[id] = val;
                var updatedSources = Object.assign({}, sources || {});
                updatedSources[id] = CWS_USER_MAPPING;
                savePrefs(ctx, {
                  modelContextWindows: updated,
                  modelContextWindowSources: updatedSources
                }, null, function() {
                });
                setTick(function(v) {
                  return v + 1;
                });
              }
            }),
            // Delete button (only for user-configured entries)
            isInUserMap ? h("button", {
              type: "button",
              style: { background: "none", border: "none", color: "#f85149", cursor: "pointer", fontSize: "14px", padding: "0 2px" },
              onClick: function() {
                var updated = Object.assign({}, userMap || {});
                delete updated[id];
                var updatedSources = Object.assign({}, sources || {});
                delete updatedSources[id];
                savePrefs(ctx, {
                  modelContextWindows: updated,
                  modelContextWindowSources: updatedSources
                }, null, function() {
                });
                setTick(function(v) {
                  return v + 1;
                });
              }
            }, "\u2715") : h("span", { style: { width: "14px" } })
          );
        });
        var _newModel = useState("");
        var newModel = _newModel[0], setNewModel = _newModel[1];
        var _newWindow = useState("");
        var newWindow = _newWindow[0], setNewWindow = _newWindow[1];
        rows.push(h(
          "div",
          { key: "_add", style: { display: "flex", alignItems: "center", gap: "6px", marginTop: "6px", paddingTop: "4px", borderTop: "1px solid rgba(255,255,255,0.08)" } },
          h("span", { style: badgeStyle, title: CWS_USER_MAPPING }, _sourceIcon(CWS_USER_MAPPING), t("ctxSrcUserMapping")),
          h("input", {
            type: "text",
            placeholder: "model-name",
            value: newModel,
            style: { flex: "1", fontSize: "12px", padding: "2px 4px", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)", color: "inherit" },
            onChange: function(e) {
              setNewModel(e.target.value);
            }
          }),
          h("input", {
            type: "number",
            placeholder: "tokens",
            value: newWindow,
            style: { width: "72px", fontSize: "12px", padding: "2px 4px", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)", color: "inherit" },
            onChange: function(e) {
              setNewWindow(e.target.value);
            }
          }),
          h("button", {
            type: "button",
            style: { background: "none", border: "none", color: "var(--dsw-alias-brand-primary, #58a6ff)", cursor: "pointer", fontSize: "14px", padding: "0 4px" },
            onClick: function() {
              var model = (newModel || "").trim();
              var window2 = Number(newWindow);
              if (!model || !isFinite(window2) || window2 <= 0) return;
              var updated = Object.assign({}, _alertPref("modelContextWindows") || {});
              updated[model] = window2;
              var updatedSources = Object.assign({}, _alertPref("modelContextWindowSources") || {});
              updatedSources[model] = CWS_USER_MAPPING;
              savePrefs(ctx, {
                modelContextWindows: updated,
                modelContextWindowSources: updatedSources
              }, null, function() {
              });
              setNewModel("");
              setNewWindow("");
              setTick(function(v) {
                return v + 1;
              });
            }
          }, "+")
        ));
        var catStatusEl = null;
        if (catState === "loading") {
          catStatusEl = h("div", { style: { fontSize: "10px", opacity: 0.4, marginTop: "4px" } }, "\u{1F4CB} " + t("ctxCatalogLoading"));
        } else if (catState === "error" || _modelCatalogError) {
          catStatusEl = h(
            "div",
            { style: { fontSize: "10px", color: "#f85149", marginTop: "4px", display: "flex", alignItems: "center", gap: "6px" } },
            "\u26A0\uFE0F " + t("ctxCatalogError") + (_modelCatalogError ? " \xB7 " + _modelCatalogError : ""),
            h("button", {
              type: "button",
              style: { background: "none", border: "1px solid rgba(248,81,73,0.3)", color: "#f85149", cursor: "pointer", fontSize: "10px", padding: "0 4px", borderRadius: "3px" },
              onClick: function() {
                _modelCatalog = null;
                _modelCatalogPromise = null;
                _modelCatalogError = null;
                setCatState("loading");
                _fetchModelCatalog(ctx).then(function() {
                  setCatState(_modelCatalog ? "loaded" : "error");
                  setTick(function(v) {
                    return v + 1;
                  });
                });
              }
            }, t("ctxCatalogRefresh"))
          );
        }
        if (models.length === 0) {
          rows.unshift(h("div", { key: "_empty", style: { fontSize: "11px", opacity: 0.4, marginBottom: "4px" } }, "(" + t("ctxModelWindowMap") + ": \u2014)"));
        }
        return h("div", null, rows, catStatusEl);
      }
      var MONITOR_SLIDER_FIELDS = {
        context: [
          { key: "ctxApproxWindow", labelKey: "ctxApproxWindow", hintKey: "ctxApproxWindowHint", min: 32768, max: 1048576, step: 32768, format: function(v) {
            return formatTokenK(v);
          } },
          { key: "ctxThresholdInfo", labelKey: "ctxThresholdInfo", tooltipKey: "ctxThresholdInfoTip", min: 30, max: 80, step: 1, format: function(v) {
            return v + "%";
          } },
          { key: "ctxThresholdWarning", labelKey: "ctxThresholdWarning", tooltipKey: "ctxThresholdWarningTip", min: 50, max: 92, step: 1, format: function(v) {
            return v + "%";
          } },
          { key: "ctxThresholdError", labelKey: "ctxThresholdError", tooltipKey: "ctxThresholdErrorTip", min: 70, max: 98, step: 1, format: function(v) {
            return v + "%";
          } },
          { key: "ctxPollBase", labelKey: "ctxPollBase", tooltipKey: "ctxPollBaseTip", min: 5e3, max: 6e4, step: 1e3, format: function(v) {
            return v + "ms";
          } },
          { key: "ctxPollMin", labelKey: "ctxPollMin", tooltipKey: "ctxPollMinTip", min: 1e3, max: 1e4, step: 500, format: function(v) {
            return v + "ms";
          } }
        ]
      };
      var MONITOR_TITLE_KEY = {
        context: "alertCtxCluster"
      };
      var _monitorConfigRoot = null;
      var _monitorConfigHost = null;
      function closeMonitorConfig() {
        if (_monitorConfigRoot) {
          try {
            _monitorConfigRoot.unmount();
          } catch (_) {
          }
          _monitorConfigRoot = null;
        }
        if (_monitorConfigHost) {
          try {
            _monitorConfigHost.remove();
          } catch (_) {
          }
          _monitorConfigHost = null;
        }
      }
      function openMonitorConfig(monitor) {
        if (!ReactDOMClient || !ReactDOMClient.createRoot) return;
        closeMonitorConfig();
        var host = document.createElement("div");
        host.style.cssText = "position:fixed;inset:0;z-index:2200;";
        document.body.appendChild(host);
        _monitorConfigHost = host;
        try {
          _monitorConfigRoot = ReactDOMClient.createRoot(host);
          _monitorConfigRoot.render(h(MonitorConfigModal, {
            monitor,
            onClose: closeMonitorConfig
          }));
        } catch (e) {
          console.error("[dsh-flash-ctx-mon] failed to open monitor config:", e);
          closeMonitorConfig();
        }
      }
      function MonitorConfigModal(props) {
        var monitor = props.monitor;
        var onClose = props.onClose;
        var fields = MONITOR_SLIDER_FIELDS[monitor] || [];
        var _tick = useState(0);
        var tick = _tick[0], setTick = _tick[1];
        var _mapFolded = useState(true);
        var mapFolded = _mapFolded[0], setMapFolded = _mapFolded[1];
        var _paramsFolded = useState(true);
        var paramsFolded = _paramsFolded[0], setParamsFolded = _paramsFolded[1];
        var _dataFolded = useState(true);
        var dataFolded = _dataFolded[0], setDataFolded = _dataFolded[1];
        useEffect(function() {
          function onKey(e) {
            if (e.key === "Escape") onClose();
          }
          document.addEventListener("keydown", onKey);
          return function() {
            document.removeEventListener("keydown", onKey);
          };
        }, [onClose]);
        function renderSliderField(f) {
          var val = Number(_alertPref(f.key)) || 0;
          var hintEl = f.hintKey ? h("div", { style: S.paramHint }, t(f.hintKey)) : null;
          return h(
            "div",
            { key: f.key, style: S.paramCell },
            h(
              "div",
              { style: S.paramLabel },
              h("span", { style: S.switchIcon }, "\u2699"),
              h("span", null, t(f.labelKey))
            ),
            hintEl,
            h(
              "div",
              { style: S.sliderRow },
              h("input", {
                type: "range",
                min: f.min,
                max: f.max,
                step: f.step,
                value: val,
                style: S.slider,
                onChange: function(e) {
                  var next = Number(e.target.value);
                  _writeAlertPref(_prefCtx, f.key, next, function(patch, rollback) {
                    rollback();
                  });
                  setTick(function(v) {
                    return v + 1;
                  });
                }
              }),
              h("span", { style: S.value }, f.format(val))
            )
          );
        }
        var fieldEls = h(
          "div",
          { key: "ctx-params-section" },
          // The skills section leads the body for the context monitor, so the
          // rule belongs on top of this section; without it this is the first
          // child and the rule would double the header border.
          monitor === "context" ? h("div", { style: S.monitorModalDivider }) : null,
          h(
            "button",
            {
              type: "button",
              style: S.sectionFoldToggle,
              onClick: function() {
                setParamsFolded(function(v) {
                  return !v;
                });
              }
            },
            (paramsFolded ? "\u25B8 " : "\u25BE ") + t("ctxParamsSection")
          ),
          !paramsFolded ? h("div", { style: Object.assign({}, S.paramGrid, { marginTop: "10px" }) }, fields.map(renderSliderField)) : null
        );
        var _showPreview = useState(false);
        var showPreview = _showPreview[0], setShowPreview = _showPreview[1];
        var alertPreviewEl = null;
        if (monitor === "context") {
          var alertRows = [];
          var _cI = _alertPref("ctxThresholdInfo");
          var _cW = _alertPref("ctxThresholdWarning");
          var _cE = _alertPref("ctxThresholdError");
          if (!(_cI < _cW && _cW < _cE)) {
            _cI = 70;
            _cW = 85;
            _cE = 95;
          }
          alertRows.push(
            h(
              "div",
              { key: "ctx", style: S.alertPreviewGroup },
              h(
                "div",
                { style: S.alertPreviewRow },
                h("span", { style: S.alertPreviewIcon }, "\u{1F535}"),
                h("span", { style: S.alertPreviewMsg }, t("alertContextInfo")),
                h("span", { style: S.alertPreviewCond }, "\u2265 " + _cI + "%")
              ),
              h(
                "div",
                { style: S.alertPreviewRow },
                h("span", { style: S.alertPreviewIcon }, "\u{1F7E1}"),
                h("span", { style: S.alertPreviewMsg }, t("alertContextWarning")),
                h("span", { style: S.alertPreviewCond }, "\u2265 " + _cW + "%")
              ),
              h(
                "div",
                { style: S.alertPreviewRow },
                h("span", { style: S.alertPreviewIcon }, "\u{1F534}"),
                h("span", { style: S.alertPreviewMsg }, t("alertContextError")),
                h("span", { style: S.alertPreviewCond }, "\u2265 " + _cE + "%")
              )
            )
          );
          alertPreviewEl = h(
            "div",
            { key: "alert-preview" },
            h("div", { style: S.monitorModalDivider }),
            h(
              "button",
              {
                type: "button",
                style: S.alertPreviewToggle,
                onClick: function() {
                  setShowPreview(function(v) {
                    return !v;
                  });
                }
              },
              (showPreview ? "\u25BE " : "\u25B8 ") + t("alertPreviewToggle")
            ),
            showPreview ? h(
              "div",
              { style: Object.assign({}, S.alertPreviewCard, { marginTop: "6px" }) },
              alertRows
            ) : null
          );
        }
        var ctxLiveDataEl = null;
        if (monitor === "context") {
          var tokenEstimate = null;
          try {
            if (_activeTokenSource) {
              tokenEstimate = _activeTokenSource.getTokenEstimate();
            }
          } catch (_) {
          }
          var ctxInfoRows = [];
          var isPrecise = tokenEstimate && tokenEstimate.source === "precise";
          var sourceStr = isPrecise ? t("ctxSourcePrecise") : t("ctxSourceUnavailable");
          var sourceColor = isPrecise ? "var(--dsw-alias-brand-primary, #58a6ff)" : "#8b949e";
          ctxInfoRows.push(
            h("span", { style: S.memLiveDataLabel }, t("ctxDataSource")),
            h("span", { style: Object.assign({}, S.memLiveDataValue, { color: sourceColor }) }, sourceStr)
          );
          if (isPrecise && tokenEstimate.model) {
            ctxInfoRows.push(
              h("span", { style: S.memLiveDataLabel }, t("ctxCurrentModel")),
              h("span", { style: S.memLiveDataValue }, tokenEstimate.model)
            );
          }
          var windowSize = tokenEstimate && tokenEstimate.contextWindow ? tokenEstimate.contextWindow : _alertPref("ctxApproxWindow");
          ctxInfoRows.push(
            h("span", { style: S.memLiveDataLabel }, t("ctxWindowTokens")),
            h("span", { style: S.memLiveDataValue }, formatTokenK(windowSize) + " tokens")
          );
          ctxInfoRows.push(
            h("span", { style: S.memLiveDataLabel }, t("ctxWindowSource")),
            h("span", { style: S.memLiveDataValue }, t(_sourceLabelKey(tokenEstimate && tokenEstimate.windowSource)))
          );
          if (isPrecise) {
            var pressure = tokenEstimate.pressureTokens || 0;
            ctxInfoRows.push(
              h("span", { style: S.memLiveDataLabel }, t("ctxPressureTokens")),
              h("span", { style: S.memLiveDataValue }, formatTokenK1(pressure))
            );
            ctxInfoRows.push(
              h("span", { style: S.memLiveDataLabel }, t("ctxInputTokens")),
              h("span", { style: S.memLiveDataValue }, formatTokenK1(tokenEstimate.inputTokens) + " / cache " + formatTokenK1(tokenEstimate.cacheReadTokens || 0) + "+" + formatTokenK1(tokenEstimate.cacheWriteTokens || 0))
            );
          }
          var barEl = null;
          if (isPrecise) {
            var barPct = windowSize > 0 ? Math.min(Math.round((tokenEstimate.pressureTokens || 0) / windowSize * 100), 100) : 0;
            var barColor = "var(--dsw-alias-brand-primary, #58a6ff)";
            var tInfo = _alertPref("ctxThresholdInfo");
            var tWarn = _alertPref("ctxThresholdWarning");
            var tErr = _alertPref("ctxThresholdError");
            if (barPct >= tErr) barColor = "#f85149";
            else if (barPct >= tWarn) barColor = "#f0883e";
            else if (barPct >= tInfo) barColor = "#d29922";
            barEl = h(
              "div",
              { style: S.memUsageBarTrack },
              h("div", {
                style: Object.assign({}, S.memUsageBarFill, {
                  width: barPct + "%",
                  background: barColor
                })
              })
            );
          } else {
            barEl = h(
              "div",
              { style: S.memUsageBarTrack },
              h("div", {
                style: Object.assign({}, S.memUsageBarFill, {
                  width: "0%",
                  background: "#8b949e"
                })
              })
            );
          }
          ctxLiveDataEl = h(
            "div",
            { key: "ctx-live-data" },
            h("div", { style: S.monitorModalDivider }),
            h(
              "button",
              {
                type: "button",
                style: S.sectionFoldToggle,
                onClick: function() {
                  setDataFolded(function(v) {
                    return !v;
                  });
                }
              },
              (dataFolded ? "\u25B8 " : "\u25BE ") + t("ctxDataSource")
            ),
            !dataFolded ? h(
              "div",
              { style: { marginTop: "10px" } },
              h(
                "div",
                { style: S.memColumnCard },
                h("div", { style: S.memLiveDataGrid }, ctxInfoRows),
                barEl
              ),
              // Model window map editor (collapsible, collapsed by default)
              h(
                "div",
                { style: Object.assign({}, S.memColumnCard, { marginTop: "8px" }) },
                h(
                  "span",
                  {
                    style: Object.assign({}, S.memSubSectionLabel, { cursor: "pointer", userSelect: "none" }),
                    onClick: function() {
                      setMapFolded(!mapFolded);
                    }
                  },
                  h("span", { style: mapFolded ? S.tabPageChevron : S.tabPageChevronOpen }, "\u25B6"),
                  " " + t("ctxModelWindowMap")
                ),
                !mapFolded ? h(ModelWindowMapEditor, { tick, setTick, ctx: _prefCtx }) : null
              )
            ) : null
          );
        }
        var skillSectionEl = null;
        if (monitor === "context") {
          skillSectionEl = h(SessionSkillsSection, { key: "ctx-skills-section", lead: true });
        }
        return h(
          "div",
          {
            style: S.monitorModalMask,
            onMouseDown: function(e) {
              if (e.target === e.currentTarget) onClose();
            }
          },
          h(
            "div",
            { style: S.monitorModal },
            // Header
            h(
              "div",
              { style: S.monitorModalHead },
              h(
                "span",
                { style: S.monitorModalTitle },
                t(MONITOR_TITLE_KEY[monitor] || "alertCtxCluster") + " \u2014 " + t("monitorConfig")
              ),
              h("button", {
                type: "button",
                "data-dock-flash-focus": "",
                style: S.monitorModalClose,
                onClick: onClose
              }, "\u2715")
            ),
            // Body: session skills first (the reason this panel is usually
            // opened), then the folded reference sections below it.
            h(
              "div",
              { style: S.monitorModalBody },
              skillSectionEl,
              fieldEls,
              alertPreviewEl,
              ctxLiveDataEl
            )
          )
        );
      }
      var _skillCatalogCache = {};
      function encodeSkillPathSegment(segment) {
        return encodeURIComponent(segment).replace(/%3A/gi, ":");
      }
      function fileAddressForSession(sessionId, cwd, path) {
        var normalized = String(path).replace(/\\/g, "/");
        var root = typeof cwd === "string" && cwd ? cwd.replace(/\\/g, "/").replace(/\/+$/, "") : "";
        var relative = normalized;
        if (root && normalized.indexOf(root + "/") === 0) relative = normalized.slice(root.length + 1);
        var encoded = relative.split("/").map(encodeSkillPathSegment).join("/");
        return "dsh-resource://file/session/" + encodeSkillPathSegment(sessionId) + "/" + encoded;
      }
      function fetchSkillCatalog(ctx, sessionId) {
        if (!ctx || !sessionId) return Promise.resolve({ error: "no-session" });
        var cached = _skillCatalogCache[sessionId];
        if (cached) return cached.promise;
        var cachedIds = Object.keys(_skillCatalogCache);
        if (cachedIds.length >= 8) delete _skillCatalogCache[cachedIds[0]];
        var entry = { skills: null, error: null };
        _skillCatalogCache[sessionId] = entry;
        function fail(reason) {
          delete _skillCatalogCache[sessionId];
          entry.error = reason;
          try {
            console.warn("[dsh-flash-ctx-mon] skill catalog unavailable: " + reason);
          } catch (_) {
          }
          return { error: reason };
        }
        entry.promise = (function() {
          var remote = resolveRemoteNamespace(ctx, "skills");
          if (!remote || typeof remote.list !== "function") return Promise.resolve(fail("no remote.skills namespace"));
          var sessions = null;
          try {
            sessions = ctx.get("sessions");
          } catch (_) {
          }
          if (!sessions || typeof sessions.using !== "function" || typeof sessions.binding !== "function") {
            return Promise.resolve(fail("no sessions service"));
          }
          try {
            if (sessions.binding(sessionId) === void 0) return Promise.resolve(fail("session not retained"));
          } catch (_) {
            return Promise.resolve(fail("session lookup threw"));
          }
          var signal;
          try {
            signal = new AbortController().signal;
          } catch (_) {
            signal = void 0;
          }
          return Promise.resolve().then(function() {
            return sessions.using(sessionId, { source: "skillCatalog", signal }, function(reference) {
              var state = reference.binding.session.getSnapshot();
              if (state.openState !== "open") {
                return { error: "session " + state.openState + (state.openError ? ": " + state.openError : "") };
              }
              return Promise.resolve(remote.list({ sessionId }, signal)).then(function(result) {
                if (result && result.ok && result.value && Array.isArray(result.value.skills)) {
                  return { skills: result.value.skills };
                }
                var err = result && result.error || {};
                return { error: "rpc " + (err.code || "failed") + (err.message ? ": " + err.message : "") };
              });
            });
          }).then(function(outcome) {
            if (!outcome || outcome.error) return fail(outcome && outcome.error || "unknown");
            entry.skills = outcome.skills;
            return outcome;
          }, function(e) {
            return fail("threw: " + (e && e.message || String(e)));
          });
        })();
        return entry.promise;
      }
      function openSkillFileInSidebar(ctx, sessionId, path) {
        if (!ctx || !sessionId || !path) return false;
        var sidebar = null;
        try {
          sidebar = ctx.get("sidebarRight");
        } catch (_) {
        }
        if (!sidebar || typeof sidebar.openResource !== "function") return false;
        var cwd = "";
        try {
          var sessions = ctx.get("sessions");
          var row = sessions.list.getSnapshot().byId[sessionId];
          if (row && typeof row.cwd === "string") cwd = row.cwd;
        } catch (_) {
        }
        try {
          sidebar.openResource(fileAddressForSession(sessionId, cwd, path));
          return true;
        } catch (e) {
          console.warn("[dsh-flash-ctx-mon] failed to open skill file in sidebar:", e);
          return false;
        }
      }
      function skillChipSummary(skills) {
        var names = [];
        for (var i = 0; i < skills.length; i++) names.push(skills[i].name);
        return {
          names,
          label: skills.length === 1 ? names[0] : names[0] + " +" + (skills.length - 1)
        };
      }
      var TABS_STRIP_SELECTOR = "[data-conversation-tabs]";
      var CHIP_HOST_ATTR = "data-dsh-flash-ctx-mon-chip";
      var SKILLS_TAB_CHIP_STYLE = Object.assign({}, S.skillChip, {
        // Directly after the last view tab, inside the strip's own 36px gap plus a
        // little more: enough distance to read as a status pill rather than one
        // more tab, and it stays next to the tabs instead of drifting to the far
        // right edge where it goes unnoticed.
        alignSelf: "center",
        maxWidth: "208px",
        flex: "none",
        marginLeft: "12px"
      });
      function findSessionStrip(anchor) {
        var node = anchor.parentElement;
        while (node && node !== document.body) {
          var strips = node.querySelectorAll(TABS_STRIP_SELECTOR);
          if (strips.length === 1) return strips[0];
          if (strips.length > 1) return null;
          node = node.parentElement;
        }
        return null;
      }
      var _skillsChipHosts = {};
      function disposeSkillsChipHost(sessionId) {
        var record = _skillsChipHosts[sessionId];
        if (!record) return;
        delete _skillsChipHosts[sessionId];
        if (record.root) {
          try {
            record.root.unmount();
          } catch (_) {
          }
        }
        if (record.host && record.host.parentNode) record.host.parentNode.removeChild(record.host);
      }
      function placeSkillsChipAfterTabs(strip, host) {
        if (strip.lastChild === host) return;
        strip.appendChild(host);
      }
      function hostSkillsChip(sessionId, strip, anchor) {
        var record = _skillsChipHosts[sessionId];
        if (record && record.strip === strip && record.host && record.host.parentNode === strip) {
          placeSkillsChipAfterTabs(strip, record.host);
          record.anchor = anchor;
          return true;
        }
        if (!ReactDOMClient || !ReactDOMClient.createRoot) return false;
        if (record) disposeSkillsChipHost(sessionId);
        var host = document.createElement("button");
        host.type = "button";
        host.setAttribute(CHIP_HOST_ATTR, "");
        for (var key in SKILLS_TAB_CHIP_STYLE) {
          if (Object.prototype.hasOwnProperty.call(SKILLS_TAB_CHIP_STYLE, key)) {
            host.style[key] = SKILLS_TAB_CHIP_STYLE[key];
          }
        }
        host.style.display = "none";
        host.onclick = function() {
          openMonitorConfig("context");
        };
        var root = ReactDOMClient.createRoot(host);
        root.render(h(SkillsTabChip, { sessionId, host }));
        placeSkillsChipAfterTabs(strip, host);
        _skillsChipHosts[sessionId] = {
          sessionId,
          strip,
          host,
          root,
          anchor
        };
        return true;
      }
      function syncSkillsChipHosts() {
        Object.keys(_skillsChipHosts).forEach(function(sessionId) {
          var record = _skillsChipHosts[sessionId];
          if (!record.anchor || !record.anchor.isConnected) {
            disposeSkillsChipHost(sessionId);
            return;
          }
          if (record.host && record.strip && record.strip.isConnected && record.host.parentNode === record.strip && record.strip.lastChild === record.host) {
            return;
          }
          var strip = findSessionStrip(record.anchor);
          if (strip) hostSkillsChip(sessionId, strip, record.anchor);
          else disposeSkillsChipHost(sessionId);
        });
      }
      function subtreeHasStrip(node) {
        if (!node || node.nodeType !== 1) return false;
        if (node.matches && node.matches(TABS_STRIP_SELECTOR)) return true;
        return !!(node.querySelector && node.querySelector(TABS_STRIP_SELECTOR));
      }
      function skillsChipMutationMatters(records) {
        for (var i = 0; i < records.length; i++) {
          var target = records[i].target;
          if (target && target.nodeType === 1 && target.matches && target.matches(TABS_STRIP_SELECTOR)) return true;
          var nodes = records[i].addedNodes;
          for (var a = 0; a < nodes.length; a++) if (subtreeHasStrip(nodes[a])) return true;
          nodes = records[i].removedNodes;
          for (var r = 0; r < nodes.length; r++) if (subtreeHasStrip(nodes[r])) return true;
        }
        return false;
      }
      var _skillsChipObserver = null;
      var _skillsChipSweepPending = false;
      function startSkillsChipObserver() {
        if (_skillsChipObserver || typeof MutationObserver !== "function" || !document.body) return;
        _skillsChipObserver = new MutationObserver(function(records) {
          if (_skillsChipSweepPending || !skillsChipMutationMatters(records)) return;
          _skillsChipSweepPending = true;
          var run = function() {
            _skillsChipSweepPending = false;
            syncSkillsChipHosts();
          };
          if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
          else setTimeout(run, 16);
        });
        _skillsChipObserver.observe(document.body, { childList: true, subtree: true });
      }
      function stopSkillsChipObserver() {
        if (_skillsChipObserver) {
          try {
            _skillsChipObserver.disconnect();
          } catch (_) {
          }
          _skillsChipObserver = null;
        }
        Object.keys(_skillsChipHosts).forEach(function(sessionId) {
          disposeSkillsChipHost(sessionId);
        });
      }
      function SkillChip(props) {
        var sessionId = props.sessionId;
        var _tick = useState(0);
        var setTick = _tick[1];
        var anchorRef = useRef(null);
        var _hosted = useState(false);
        var hosted = _hosted[0];
        var setHosted = _hosted[1];
        useEffect(function() {
          var tracker2 = _activeSkillTracker;
          if (!tracker2 || typeof tracker2.subscribe !== "function") return void 0;
          return tracker2.subscribe(function() {
            setTick(function(v) {
              return v + 1;
            });
          });
        }, []);
        React.useLayoutEffect(function() {
          var anchor = anchorRef.current;
          var strip = anchor && sessionId ? findSessionStrip(anchor) : null;
          var ok;
          if (strip) {
            ok = hostSkillsChip(sessionId, strip, anchor);
          } else {
            var record = sessionId ? _skillsChipHosts[sessionId] : null;
            if (record && record.anchor === anchor) {
              disposeSkillsChipHost(sessionId);
              ok = false;
            } else {
              ok = !!record;
            }
          }
          setHosted(function(was) {
            return was === ok ? was : ok;
          });
        });
        var tracker = _activeSkillTracker;
        var skills = tracker && sessionId ? tracker.getSkillsFor(sessionId) : [];
        if (!skills.length) return null;
        var summary = skillChipSummary(skills);
        var hiddenAnchor = h("span", {
          key: "skills-anchor",
          ref: anchorRef,
          "data-dsh-flash-ctx-mon-anchor": "",
          style: { display: "none" }
        });
        if (hosted) return hiddenAnchor;
        return h(
          React.Fragment,
          null,
          hiddenAnchor,
          h(
            "button",
            {
              type: "button",
              style: S.skillChip,
              title: summary.names.join("\n") + "\n" + t("ctxSkillsSection"),
              onClick: function() {
                openMonitorConfig("context");
              }
            },
            h("span", { style: S.skillChipIcon }, "\u{1F9E9}"),
            h("span", null, summary.label)
          )
        );
      }
      function SkillsTabChip(props) {
        var sessionId = props.sessionId;
        var host = props.host;
        var _tick = useState(0);
        var setTick = _tick[1];
        useEffect(function() {
          var tracker2 = _activeSkillTracker;
          if (!tracker2 || typeof tracker2.subscribe !== "function") return void 0;
          return tracker2.subscribe(function() {
            setTick(function(v) {
              return v + 1;
            });
          });
        }, []);
        var tracker = _activeSkillTracker;
        var skills = tracker && sessionId ? tracker.getSkillsFor(sessionId) : [];
        var summary = skills.length ? skillChipSummary(skills) : null;
        React.useLayoutEffect(function() {
          if (!host) return;
          host.style.display = summary ? SKILLS_TAB_CHIP_STYLE.display : "none";
          if (!summary) {
            host.removeAttribute("title");
            host.removeAttribute("aria-label");
            return;
          }
          host.setAttribute("title", summary.names.join("\n") + "\n" + t("ctxSkillsSection"));
          host.setAttribute("aria-label", t("ctxSkillsSection") + ": " + summary.names.join(", "));
        });
        if (!summary) return null;
        return h(
          React.Fragment,
          null,
          h("span", { style: S.skillChipIcon }, "\u{1F9E9}"),
          h("span", null, summary.label)
        );
      }
      function SessionSkillsSection(props) {
        var lead = !!(props && props.lead);
        var _tick = useState(0);
        var setTick = _tick[1];
        useEffect(function() {
          var tracker2 = _activeSkillTracker;
          if (!tracker2 || typeof tracker2.subscribe !== "function") return void 0;
          return tracker2.subscribe(function() {
            setTick(function(v) {
              return v + 1;
            });
          });
        }, []);
        var tracker = _activeSkillTracker;
        var sessionId = tracker ? tracker.getSessionId() : null;
        var skills = tracker ? tracker.getSkills() : [];
        var _cat = useState({ status: "idle", byName: null, error: null });
        var cat = _cat[0], setCat = _cat[1];
        var _reload = useState(0);
        var reload = _reload[0], setReload = _reload[1];
        useEffect(function() {
          if (!sessionId || !skills.length) {
            setCat({ status: "idle", byName: null, error: null });
            return void 0;
          }
          var alive = true;
          setCat({ status: "loading", byName: null, error: null });
          fetchSkillCatalog(_prefCtx, sessionId).then(function(outcome) {
            if (!alive) return;
            var list = outcome && outcome.skills;
            if (!list) {
              setCat({ status: "failed", byName: null, error: outcome && outcome.error || "unknown" });
              return;
            }
            var byName = {};
            for (var i2 = 0; i2 < list.length; i2++) {
              var sk2 = list[i2];
              if (sk2 && typeof sk2.name === "string") byName[sk2.name] = sk2;
            }
            setCat({ status: "ready", byName, error: null });
          });
          return function() {
            alive = false;
          };
        }, [sessionId, skills.length, reload]);
        function fmtTime(ms) {
          if (!ms) return "\u2014";
          try {
            return new Date(ms).toLocaleString();
          } catch (_) {
            return "\u2014";
          }
        }
        var rows = [];
        for (var i = 0; i < skills.length; i++) {
          var sk = skills[i];
          var via = [];
          if (sk.viaModel > 0) via.push(t("ctxSkillsViaModel") + (sk.viaModel > 1 ? " \xD7" + sk.viaModel : ""));
          if (sk.viaUser > 0) via.push(t("ctxSkillsViaUser") + (sk.viaUser > 1 ? " \xD7" + sk.viaUser : ""));
          var meta = h(
            "div",
            { style: S.skillMeta },
            t("ctxSkillsCount") + " " + sk.count + " \xB7 " + t("ctxSkillsFirst") + " " + fmtTime(sk.firstTime) + " \xB7 " + t("ctxSkillsLast") + " " + fmtTime(sk.lastTime)
          );
          var catEntry = cat.status === "ready" && cat.byName ? cat.byName[sk.name] : null;
          var descEl = null;
          if (cat.status === "ready") {
            var desc = catEntry && typeof catEntry.description === "string" ? catEntry.description.trim() : "";
            descEl = h("div", { style: S.skillDesc }, desc || t("ctxSkillsNoDesc"));
          } else if (cat.status === "loading") {
            descEl = h("div", { style: S.skillDesc }, t("ctxSkillsLoading"));
          } else if (cat.status === "failed") {
            descEl = h(
              "div",
              { style: S.skillDesc },
              t("ctxSkillsFailed") + (cat.error ? " \xB7 " + cat.error : ""),
              h("button", {
                type: "button",
                style: Object.assign({}, S.skillOpenBtn, { marginLeft: "6px" }),
                onClick: function() {
                  setReload(function(v) {
                    return v + 1;
                  });
                }
              }, t("ctxSkillsRetry"))
            );
          }
          var pathEl = null;
          var path = catEntry && typeof catEntry.path === "string" ? catEntry.path : "";
          if (path) {
            pathEl = h(
              "div",
              { style: S.skillPathRow },
              h("span", { style: S.skillPath, title: path }, path),
              h("button", {
                type: "button",
                style: S.skillOpenBtn,
                // `path` is a function-scoped var shared by every iteration, so
                // the handler must capture its own copy.
                onClick: /* @__PURE__ */ (function(ownPath) {
                  return function() {
                    openSkillFileInSidebar(_prefCtx, sessionId, ownPath);
                  };
                })(path)
              }, t("ctxSkillsOpen"))
            );
          }
          rows.push(h(
            "div",
            { key: sk.name, style: S.skillRow },
            h(
              "div",
              { style: S.skillRowHead },
              h("span", { style: S.skillName }, sk.name),
              via.length ? h("span", { style: S.skillBadge }, via.join(" / ")) : null
            ),
            meta,
            descEl,
            pathEl
          ));
        }
        return h(
          "div",
          { key: "ctx-skills" },
          lead ? null : h("div", { style: S.monitorModalDivider }),
          h("span", { style: lead ? S.skillsSectionTitle : S.monitorModalSectionTitle }, t("ctxSkillsSection")),
          h(
            "div",
            { style: lead ? S.skillsLeadCard : S.memColumnCard },
            skills.length ? h("div", null, rows) : h("div", { style: S.skillMeta }, t("ctxSkillsEmpty")),
            h(
              "div",
              { style: Object.assign({}, S.skillMeta, { marginTop: "6px", opacity: 0.7 }) },
              t("ctxSkillsScope")
            )
          )
        );
      }
      function _getAlertsOn() {
        try {
          return localStorage.getItem("dock-flash:system-alerts") !== "0";
        } catch (_) {
          return true;
        }
      }
      var TOGGLE_KEY = "dsh-flash-ctx-mon:monitor-context";
      var PROVIDER_ID = "dsh-flash-ctx-mon:context-alert";
      var _MONITOR_TOGGLES = {
        context: {
          key: TOGGLE_KEY,
          providers: [PROVIDER_ID]
        }
      };
      var _MONITOR_DEFAULT = { context: true };
      function _getMonitorOn(monitor) {
        var def = _MONITOR_DEFAULT[monitor] !== false;
        try {
          return localStorage.getItem(_MONITOR_TOGGLES[monitor].key) !== "0";
        } catch (_) {
          return def;
        }
      }
      function _setMonitorOn(monitor, on, alertRegistry) {
        var providers = _MONITOR_TOGGLES[monitor].providers;
        for (var i = 0; i < providers.length; i++) {
          try {
            alertRegistry.setProviderEnabled(providers[i], on);
          } catch (_) {
          }
        }
        try {
          localStorage.setItem(_MONITOR_TOGGLES[monitor].key, on ? "1" : "0");
        } catch (_) {
        }
      }
      var client = {
        inject: ["remote", "remote.settings"],
        async apply(ctx) {
          try {
            await client._applyInner(ctx);
          } catch (err) {
            console.error("[dsh-flash-ctx-mon] apply failed (non-fatal):", err);
          }
        },
        async _applyInner(ctx) {
          _prefCtx = ctx;
          loadCtxPrefs(ctx).then(function(ok) {
            var lsOn;
            try {
              lsOn = localStorage.getItem(TOGGLE_KEY) !== "0";
            } catch (_) {
              lsOn = true;
            }
            try {
              var reg = ctx.get && ctx.get("quickControl");
              if (reg && typeof reg.notifyChange === "function") {
                reg.notifyChange(TOGGLE_KEY);
              }
            } catch (_) {
            }
            var alertReg = ctx.get && ctx.get("dockFlashAlerts");
            if (alertReg) {
              try {
                alertReg.setProviderEnabled(PROVIDER_ID, lsOn);
              } catch (_) {
              }
            }
          });
          var _registered = false;
          function _registerServices(registry2, alertRegistry2) {
            if (_registered) return;
            if (!registry2 || !alertRegistry2) {
              console.warn("[dsh-flash-ctx-mon] _registerServices: missing service \u2014 quickControl=" + !!registry2 + ", alerts=" + !!alertRegistry2);
              return;
            }
            _registered = true;
            console.log("[dsh-flash-ctx-mon] registering provider and switch");
            var ctxProvider = createSessionContextProvider();
            alertRegistry2.registerProvider(ctxProvider);
            ctx.effect(function() {
              var dispose = registry2.registerSwitch({
                id: TOGGLE_KEY,
                label: L("alertCtxCluster"),
                icon: "message",
                type: "toggle",
                group: "system",
                cluster: "system-alerts",
                order: 59,
                visible: function() {
                  return _getAlertsOn();
                },
                config: function() {
                  openMonitorConfig("context");
                },
                getValue: function() {
                  return _getMonitorOn("context");
                },
                setValue: function(v) {
                  _setMonitorOn("context", v, alertRegistry2);
                  registry2.notifyChange(TOGGLE_KEY);
                  try {
                    alertRegistry2.notify();
                  } catch (_) {
                  }
                }
                // No `subtitle`: dock-flash renders it as a second line on the
                // switch row, and the live "model · 12%" readout it used to carry
                // is already in the panel this switch opens.
              });
              return dispose;
            }, "dsh-flash-ctx-mon: monitor-context switch");
            Object.keys(_MONITOR_TOGGLES).forEach(function(m) {
              if (!_getMonitorOn(m)) _setMonitorOn(m, false, alertRegistry2);
            });
          }
          var skillTracker = createSessionSkillTracker();
          _activeSkillTracker = skillTracker;
          ctx.effect(function() {
            skillTracker.start(ctx);
            return function() {
              skillTracker.stop();
              if (_activeSkillTracker === skillTracker) _activeSkillTracker = null;
            };
          }, "dsh-flash-ctx-mon: session skill tracker");
          ctx.effect(function() {
            startSkillsChipObserver();
            return function() {
              stopSkillsChipObserver();
            };
          }, "dsh-flash-ctx-mon: session skills chip host");
          ctx.inject(["slots"], function(slotsCtx) {
            slotsCtx.effect(function() {
              return slotsCtx.slots.inject("conversation.session.header.actions", function() {
                return slotsCtx.slots.register({
                  name: "conversation.session.header.actions",
                  id: "dsh-flash-ctx-mon-skills",
                  order: 15
                }, SkillChip);
              });
            }, "dsh-flash-ctx-mon: session skills chip");
          });
          try {
            ctx.on("dock-flash:ready", function(payload) {
              console.log("[dsh-flash-ctx-mon] dock-flash:ready event received \u2014 quickControl=" + !!(payload && payload.quickControl) + ", alerts=" + !!(payload && payload.alerts));
              _registerServices(payload.quickControl, payload.alerts);
            });
          } catch (e) {
            console.warn('[dsh-flash-ctx-mon] ctx.on("dock-flash:ready") failed:', e);
          }
          var registry = ctx.get("quickControl");
          var alertRegistry = ctx.get("dockFlashAlerts");
          console.log("[dsh-flash-ctx-mon] active check \u2014 quickControl=" + !!registry + ", alerts=" + !!alertRegistry);
          if (registry && alertRegistry) _registerServices(registry, alertRegistry);
          if (!_registered) {
            let _retryGet2 = function() {
              if (_registered) return;
              var r = ctx.get("quickControl");
              var a = ctx.get("dockFlashAlerts");
              if (r && a) {
                _registerServices(r, a);
                return;
              }
              if (++_retryCount < 15) setTimeout(_retryGet2, 200);
            };
            var _retryGet = _retryGet2;
            var _retryCount = 0;
            setTimeout(_retryGet2, 0);
          }
        },
        dispose() {
          closeMonitorConfig();
        }
      };
      return client;
    }
  });
})();
