# Changelog — dsh-flash-ctx-mon

Release-by-release history: what changed and, where it matters, why.
`git log` remains the authoritative record of individual commits — the entries
below summarise releases.

The **context monitor** companion for the core `dsh-flash` package: it reads the
precise token usage DSH already reports on its session event stream, turns
pressure on the model's context window into `dsh-flash` alerts at three rising
thresholds, and offers a **session skills chip** that lists the skills the current
session has actually loaded. It is client-side only; the host half exists just to
hold the settings namespace and schema.

## 0.2.0

**The browser half gains a build step, and context windows are sized in binary K.**
The half was one 3600-line editable `lib/client.js`; its source now lives in
`src-client/` and is split into stateless, unit-tested modules (`tokens`,
`skill-detect`, `ctx-window`) bundled with esbuild into the tracked
`lib/client.js`. Stateful logic (prefs, token source, skill tracker, provider,
i18n) intentionally stays inline in `factory-body.js`, coupled to the
session-event closure. Bundling is the first behavior-visible change a version
bump — from 0.1 to 0.2 — signals, because the built artifact is now a checked-in
build product and every subsequent change to the source must regenerate it.

Token/window formatting is now uniformly **1024-based**: `formatTokenK` /
`formatTokenK1` always divide by 1024, so 131072 = 128K, 200000 = 195K — no more
mixed binary/decimal K. The window-size slider's `min`/`max`/`step` were wrong
(64,000 was 62.5×1024, step 8000 was 7.8125×1024) and are realigned to 1024
multiples: range 32768..1M, step 32K, so an exact 128K (131072) is reachable.

Pure window/error logic (`extractWindowFromError`, `isContextLimitError`,
`resolveWindowFromMaps`) moved out of the closure into `src-client/ctx-window.js`
with unit tests; `_resolveWindow` is now a thin wrapper. A 35-case Vitest suite
covers the pure modules.

## 0.1.8

**The session skills chip moves onto the tab strip.** The chip that listed a
session's loaded skills was folded into the panel; now it sits beside the
conversation tabs, so it stays visible without opening the panel.

## 0.1.7

**Follows the panel core to `dsh-flash`.** First release after the core/adapter
split: the `dsh-flash` peer range is the one the combined package now demands
(`>=1.0.0-0 <2.0.0-0`), pairing with the standalone core like the other
companions. Behavior unchanged.

## 0.1.6

**Panel presentation pass.** The config and data-source sections fold, and the
panel leads with the session skills — the context figure and the model window
stay reachable but no longer monopolize the first screen.

## 0.1.5

**Market + repository identity.** A `dsh-market` entry, the `repository` field,
and a real install command, so the market resolves this plugin's npm name and
the card can be installed from the storefront.

## 0.1.4

**Peer range fixed.** Accept the `dock-flash` 2.x line that the combined package
published at the time, so installs against the single-package era resolve.

## 0.1.3

**Hardening pass.** A failed `apply()` is non-fatal instead of a vanished plugin;
the preference read no longer assumes `settings.describe()` returns a promise
(see Critical Rule 13 in the core's AGENTS.md); and the Gitee→GitHub mirror runs
from a workflow.

## 0.1.2

**Alert hygiene.** A threshold alert is never raised against a **guessed** model
window — the estimate is only trusted when a real window is known; and a loaded
skill is announced once instead of on every poll.

## 0.1.1

**First tagged release.** The extracted companion's initial capability set: the
context window pressure monitor with rising thresholds, and the session skills
chip. Carries the model-window correctness fixes that made it trustworthy — read
the model catalog through the remote namespace service key, make the model-window
map writable so mappings take effect immediately (not on the next turn), and wait
for the session to open before reading the skill catalog.