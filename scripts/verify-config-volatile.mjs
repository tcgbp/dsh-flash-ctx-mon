// Verify the host schema against the settings service's real rule.
//
// The host rejects any patched path that is not under a volatile node:
//   settings.write(): if (!isVolatilePath(schema, path)) throw ...
// This loads the BUILT host half and re-runs that exact test on it, using the
// same volatileForm/isVolatilePath logic dsh-settings ships.
import { pathToFileURL } from 'node:url'

const dist = pathToFileURL(process.argv[2]).href
const mod = await import(dist)
const Config = mod.Config
if (!Config) throw new Error('dist does not export Config')

// The live schemastery schema exposes .type / .meta / .dict, which is exactly
// what dsh-settings walks. Fall back to the serialized ref table if a future
// schemastery drops those.
let schema = Config
if (schema.dict === undefined) {
  const json = Config.toJSON()
  const deref = (node) => (typeof node === 'number' ? json.refs[node] : node)
  const rebuild = (node) => {
    node = deref(node)
    const out = { type: node.type, meta: node.meta || {} }
    if (node.dict) {
      out.dict = {}
      for (const [k, v] of Object.entries(node.dict)) out.dict[k] = rebuild(v)
    }
    return out
  }
  schema = rebuild(json)
}

// ── copied verbatim from @deepseek-ai/dsh-settings/lib/types/schema.js ──
function volatileForm(node) {
  if (node.meta.volatile) return node
  if (node.type === 'object') {
    const dict = Object.fromEntries(Object.entries(node.dict ?? {}).flatMap(([key, child]) => {
      const field = volatileForm(child)
      return field === undefined ? [] : [[key, field]]
    }))
    return Object.keys(dict).length === 0 ? undefined : { type: 'object', dict }
  }
  return undefined
}
function isVolatilePath(node, path) {
  if (node.meta.volatile) return true
  const [key, ...rest] = path
  const child = key === undefined ? undefined : node.dict?.[key]
  return child !== undefined && isVolatilePath(child, rest)
}

let pass = 0, fail = 0
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`))
  ok ? pass++ : fail++
}

const fields = schema.dict || {}
console.log('  schema type:', schema.type)
console.log('  fields:', Object.keys(fields).join(', '))

// THE FIX: both durable mapping fields must be writable through settings.update
for (const key of ['modelContextWindows', 'modelContextWindowSources']) {
  check(`${key} is declared`, !!fields[key], true)
  check(`${key} carries meta.volatile`, !!(fields[key] && fields[key].meta && fields[key].meta.volatile), true)
  check(`${key} is accepted by settings.write()`, isVolatilePath(schema, [key]), true)
}
// the scalars keep working
for (const key of ['ctxApproxWindow', 'ctxThresholdInfo', 'ctxPollBase', 'ctxPollMin']) {
  check(`${key} is still accepted`, isVolatilePath(schema, [key]), true)
}
// write() throws "has no volatile fields" when the form is empty
const form = volatileForm(schema)
check('the namespace still exposes a volatile form', !!(form && form.dict && Object.keys(form.dict).length > 0), true)
// the volatile form must actually include the mapping fields, or write() drops them
check('the volatile form includes both mapping fields',
  ['modelContextWindows', 'modelContextWindowSources'].map((k) => !!(form.dict && form.dict[k])), [true, true])

// Regression guard: the old schema marked these non-volatile, and that is
// precisely why every mapping write was rejected and rolled back.
check('the mapping fields are no longer ordinary config',
  ['modelContextWindows', 'modelContextWindowSources'].map((k) => !!(fields[k] && fields[k].meta && fields[k].meta.volatile)),
  [true, true])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
