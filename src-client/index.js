// src-client/index.js — MODULE LOADER ENTRY for the browser half.
//
// This is the single file esbuild bundles and emits as `lib/client.js`, the
// artifact the runtime serves at /plugins/dsh-flash-ctx-mon/client.js. It keeps
// the loader's contract intact: the bundle's top level calls
// window.__ModuleLoader__.load({ id, factory }).
//
// Capability logic (tokens / skill-detect / token-source / skill-tracker /
// context-alert / model-catalog / prefs / i18n) lives in sibling modules and is
// unit-tested under test/. factory-body.js wires the loader + presentational UI
// (the React components and service registration), importing those modules so
// there is a single source of truth for the algorithms.

import './factory-body.js'
