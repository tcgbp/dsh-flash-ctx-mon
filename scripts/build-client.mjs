// dsh-flash-ctx-mon — build the browser half.
//
// The runtime loads the client through DSH's own window.__ModuleLoader__ and
// serves it at /plugins/dsh-flash-ctx-mon/client.js. To keep that single-file,
// no-fixture loading contract while letting the source live as readable ESM
// modules, we bundle the src-client entry into lib/client.js with esbuild.
//
// The bundle is an IIFE whose top level calls window.__ModuleLoader__.load(...).
// react / react-dom are intentionally NOT bundled: they are resolved at runtime
// by the loader's `require` inside the factory, exactly as before.

import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const entry = resolve(root, 'src-client/index.js')
const outfile = resolve(root, 'lib/client.js')

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  // react and react-dom resolve lazily inside the loader's factory require.
  external: ['react', 'react-dom/client'],
  sourcemap: false,
  minify: false,
  logLevel: 'info',
})

console.log(`[dsh-flash-ctx-mon] bundled ${entry} -> ${outfile}`)
