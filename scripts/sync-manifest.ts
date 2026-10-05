// REVISION: flow-v81-scene-defs
//
// Writes the scene list into .claude-plugin/plugin.json from SCENES
// (hooks/styles.ts): the `style` options and description, and the `time`
// description's night scenes. plugin.json has to be literal JSON, so this
// copies; a test fails when the two drift. Not part of the mod (Node).
//
//   npm run sync

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { STYLES, styleDescription, timeDescription } from '../hooks/styles'

export const MANIFEST = join(import.meta.dirname, '..', '.claude-plugin', 'plugin.json')

/** Brings plugin.json in step with SCENES; returns whether it had drifted. `write: false` only checks. */
export function syncManifest(write = true): boolean {
  const before = readFileSync(MANIFEST, 'utf8')
  const m = JSON.parse(before)
  const rows = m.userConfig
  rows.style.options = [...STYLES]
  rows.style.description = styleDescription()
  if (!STYLES.includes(rows.style.default)) rows.style.default = STYLES[0]
  rows.time.description = timeDescription()
  const after = `${JSON.stringify(m, null, 2)}\n`
  if (write && after !== before) writeFileSync(MANIFEST, after)
  return after !== before
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(syncManifest() ? 'plugin.json: scene list updated' : 'plugin.json: already up to date')
}
