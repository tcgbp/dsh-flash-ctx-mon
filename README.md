# dsh-flash-ctx-mon

> The **context monitor** companion plugin for
> [dock-flash](https://gitee.com/lenin.guo/dock-flash) — it registers its own alert
> provider and its own panel switch instead of living inside dock-flash's `apply()`.

Apache-2.0

**[中文](./README.zh-CN.md)**

## What it does

Two capabilities, one in each half of the plugin:

1. **Context monitor** — reads the **precise** token usage DSH already reports on its
   session event stream and turns pressure on the model's context window into
   dock-flash alerts, at three rising thresholds.
2. **Session skills chip** — a chip in the conversation header listing the skills the
   current session has actually loaded, resolved against the skill catalog.

The monitor is **on by default** — only an explicit "off" turns it off — and it is
**entirely client-side**.

## What it registers

### Host half — `src/index.ts` → `dist/index.js`

A Cordis plugin named `dsh-flash-ctx-mon`.

| Thing | Detail |
| --- | --- |
| Settings namespace | `dsh-flash-ctx-mon` |
| Fields | `ctxApproxWindow`, `ctxThresholdInfo`, `ctxThresholdWarning`, `ctxThresholdError`, `ctxPollBase`, `ctxPollMin`, `modelContextWindows`, `modelContextWindowSources` |
| Routes | **none** |
| Host-side services | **none** (`inject: []`) |

**The host half exists only to hold the settings namespace and its schema.** There is no
collector and no route, because there is nothing to collect on the host: token usage
arrives through DSH session events (`ctx.get('sessions')`), the model catalog through
`remote.session.modelCatalog()`, and the skill catalog through `remote.skills.list()` —
all of it in the browser.

### Browser half — `lib/client.js` (no build step)

| Registration | Through |
| --- | --- |
| Alert provider `dsh-flash-ctx-mon:context-alert` | `ctx.get('dockFlashAlerts').registerProvider()` |
| Panel switch `dsh-flash-ctx-mon:monitor-context` | `ctx.get('quickControl').registerSwitch()` |
| Session header chip `dsh-flash-ctx-mon-skills` | `ctx.inject(['slots'])` → `conversation.session.header.actions` |

Switch properties: `type: 'toggle'`, `group: 'system'`, `cluster: 'system-alerts'`,
`order: 59`, `icon: 'message'`, plus a **Configure** button. Its visibility follows
dock-flash's `dock-flash:system-alerts` master toggle — with the alert registry switched
off there is nothing for this switch to drive. It deliberately carries **no `subtitle`**:
the live "model · 12%" readout it used to print on the row is already the first thing in
the panel the Configure button opens.

> **Dual discovery, plus a fallback poll.** `ctx.get('quickControl')` /
> `ctx.get('dockFlashAlerts')` resolve asynchronously, so registration has three routes:
> the `dock-flash:ready` event (dock-flash loaded after us), a synchronous `ctx.get()`
> check (it loaded before us), and a fallback poll of up to 15 attempts 200 ms apart.
> The first to succeed sets `_registered`, so nothing registers twice.

## The switch

In dock-flash's quick panel, under **⚙️ System → System Alerts**, find **Context
Monitor**:

- turning it **off** writes `'0'` to `localStorage['dsh-flash-ctx-mon:monitor-context']`
  and calls `setProviderEnabled(…, false)` on the alert registry, so the provider stops
  producing alerts;
- turning it **on** restores both.

**Who wins.** The browser key is the authority, and **absence means on**
(`getItem(key) !== '0'`). The host's own fields are all `volatile()`, so DSH resets them
to their defaults on every restart — the browser is what remembers your choice.

## The config modal

**Configure** beside the switch opens the context monitor panel:

| Control | Range | Step | Default |
| --- | --- | --- | --- |
| Context Window Size `ctxApproxWindow` | 64000–512000 tokens | 8000 | 128000 |
| Info Threshold `ctxThresholdInfo` | 30–80 % | 1 | 70 |
| Warning Threshold `ctxThresholdWarning` | 50–92 % | 1 | 85 |
| Error Threshold `ctxThresholdError` | 70–98 % | 1 | 95 |
| Context Poll Base Interval `ctxPollBase` | 5000–60000 ms | 1000 | 20000 |
| Context Poll Min Interval `ctxPollMin` | 1000–10000 ms | 500 | 2000 |

Below the sliders the panel reports the live state — **Current Model**, **Window Size**,
**Window Source** (Session Event / Model Catalog / Error Parsed / Manual / Built-in /
Fuzzy Match / Fallback), **Data Source** (Precise / Awaiting data), **Input Tokens** and
**Context Pressure** — and carries the **Model Window Map** editor, a **Refresh
Catalog** action, and a preview of what the alert messages look like.

## Alerts

Emitted only when the token source is `precise`; with no session-event usage data the
monitor reports "Awaiting data" and **emits nothing** — it does not guess from message
counts.

| Level | At | Title |
| --- | --- | --- |
| ℹ️ info | ≥ `ctxThresholdInfo` (70 %) | Session context getting long |
| 🟡 warning | ≥ `ctxThresholdWarning` (85 %) | Session context nearly exhausted |
| 🔴 error | ≥ `ctxThresholdError` (95 %) | Session context almost exhausted |

Each message carries the percentage and the reading it came from — `model ·
12.4K/128K` in precise mode. Alerts are `dismissible` and flow through dock-flash's
registry, so they appear in the panel's alert list and as toasts like any other.

## How a model's window is resolved

`_resolveWindow(model)` reads `modelContextWindows` — the **user-mapped** table in the
settings namespace — and labels each answer with its provenance from
`modelContextWindowSources`. A model that is not in the map resolves to `null`, and the
caller falls back to `ctxApproxWindow` (the "Fallback" source).

**The built-in window table has been retired.** `_KNOWN_WINDOWS` is empty and the
catalog auto-fill is a documented no-op, so today the map is the only source of a real
window size — which is why the panel's Model Window Map editor is how you teach it about
a model it gets wrong.

> Both map fields are `volatile()`, and that is **not** a statement that they are
> transient. The settings service rejects any patched path that is not under a volatile
> node (`Config field "…" is not volatile`), so a non-volatile `modelContextWindows`
> meant every mapping the panel wrote was rejected, rolled back and lost — a mapped
> model kept falling back to `ctxApproxWindow`. Volatile is what makes the write legal;
> the value still lands in the profile patch and survives a restart.

## Polling

The monitor samples on an adaptive interval: `ctxPollBase` is the **ceiling** used while
usage is low, and the interval tightens as usage rises, never below `ctxPollMin`. In
precise mode the base interval is doubled automatically, because the event source pushes
updates rather than being polled. A skill being used forces an immediate poll, so its
notice is claimed while the use is still fresh.

## The skills chip

A chip in the conversation header, registered into `conversation.session.header.actions`
as `dsh-flash-ctx-mon-skills` (order 15). It lists the skills **the current session** has
loaded — subagents and other sessions are excluded, because the slot hands the component
the id of the session it renders for.

Detection uses DSH's own marker: the `<skill_content name="X">` block emitted when a
skill body is loaded. It arrives on two paths — the model calling the `skill` tool, and a
user typing `/name` in the composer (which produces **no** tool call of its own) — and a
failed call carries no block, so failures are not counted. Names are resolved against the
skill catalog (`remote.skills.list()`), and the popup shows uses, first/last use and the
catalog description, with **Open in sidebar**.

The tracker is deliberately **independent of the monitor switch**: the chip keeps working
with the context monitor switched off.

## Settings

| Field | Default | Notes |
| --- | --- | --- |
| `ctxApproxWindow` | 128000 | Fallback window for a model the map does not know |
| `ctxThresholdInfo` | 70 | % of the window |
| `ctxThresholdWarning` | 85 | % — must exceed the info threshold |
| `ctxThresholdError` | 95 | % — must exceed the warning threshold |
| `ctxPollBase` | 20000 | ms, the low-usage ceiling |
| `ctxPollMin` | 2000 | ms, the floor |
| `modelContextWindows` | `{}` | model id → window size |
| `modelContextWindowSources` | `{}` | model id → provenance tag |

## Dependencies

| Package | Type | Purpose |
| --- | --- | --- |
| `@deepseek-ai/cordis` | peer | the plugin framework |
| `dock-flash` `>=1.5.0-0 <2.0.0-0 \|\| >=2.0.0-0 <3.0.0-0` | peer | supplies the `quickControl` and `dockFlashAlerts` services and the `dock-flash:ready` event |
| `dock-base` `>=0.1.2-0 <1.0.0-0 \|\| >=0.2.0-0 <1.0.0-0` | peer, optional | workbench mode only |
| `@deepseek-ai/schemastery` | dependency | the settings schema (`volatile()`) |

There is **no hard dependency** on dock-flash: every service is resolved through
`ctx.get(...)`, and compatibility is declared by the **peer range** — the same shape
dock-flash itself uses towards dock-base. The range carries one branch per tuple whose
prereleases must resolve, so both the 1.x and 2.x lines are accepted, prereleases
included.

## Install

```sh
dsh plugin --profile <profile> add <path-to-this-checkout>
```

`cordis.patch.yml` inserts the host row. Its `name` is a **package name**, resolved
through the profile's `node_modules` — **never a relative path**.

The browser half needs no row: the module loader discovers it from `package.json`'s
`exports["./client"]` plus `dsh.client` and serves it at
`/plugins/dsh-flash-ctx-mon/client.js`.

## Build

```sh
pnpm install
pnpm run build       # tsc → dist/index.js   (host half only)
pnpm run typecheck
node scripts/verify-config-volatile.mjs ./dist/index.js
```

`dist/index.js` is **tracked on purpose**, for the same reason dock-flash tracks its own:
a git install fetches sources and runs no build script, so a repository without `dist/`
would arrive missing the host entry point that `main` and `exports["."]` point at.
`lib/client.js` is a single file edited directly; it has no build step and takes effect
on page refresh.

`scripts/verify-config-volatile.mjs` loads the built host half and re-runs the settings
service's own volatile-path test against it — the invariant the two map fields must
satisfy, or every write to them is rejected.

## Layout

```
src/index.ts      HOST half      → tsc → dist/index.js
lib/client.js     BROWSER half   → no build, edited directly
dist/index.js     compiled host half — tracked on purpose
cordis.patch.yml  bundle layer: inserts the host row into the profile
scripts/          verify-config-volatile.mjs — the volatile-schema check
.github/workflows/sync-from-gitee.yml — the Gitee → GitHub mirror
```

Gitee is the authoritative repository; GitHub (`github.com/tcgbp/dsh-flash-ctx-mon`) is a
mirror of it and the host of the release tarball.

## Privacy and limits (deliberate)

- **Nothing leaves the machine.** The monitor reads DSH's own session events and two
  client remotes; it has no host route, no collector and no outbound request.
- **Precise or nothing.** With no session-event usage data the monitor shows "Awaiting
  data" and raises no alert, rather than estimating from message counts.
- **Per-session skills only.** The chip counts the current session; subagent sessions and
  other conversations are excluded. A session that is no longer retained reports "Skill
  catalog unavailable" with a Retry.
- **Bounded tracking.** Tracked skills are capped at 200 per session (defensive), and a
  skill notice is only announced for a use within the last 15 seconds, so replaying a
  session's history does not fire a burst of notices.
- **UI language**: the panel and the alert text carry both Chinese and English, and
  follow DSH's language setting.
