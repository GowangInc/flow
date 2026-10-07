// REVISION: flow-v122-ci
//
// What every scene must hold to (AGENTS.md), measured: plugin.json lists
// the scenes in SCENES, hooks/sound-files.ts lists the clips in sounds/,
// level 0 draws nothing, a frame has at most 1024 colour pairs, and
// step() + grid() takes under ~2 ms at the band's and the spine's sizes.
// Exits 1 on any failure. Not part of the mod (Node).
//
//   npm run check                every scene
//   npm run check -- surf ski    just these
//   FLOW_MAX_MS=6 npm run check  a looser time budget, as CI runs it

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { SOUND_FILES } from '../hooks/sound-files'
import { syncManifest } from './sync-manifest'
import { build, nightsOf, pairs, scenesFrom, TINTS } from './scene-lab'

const MAX_PAIRS = 1024
// CI's shared runners are slower and noisier than a laptop, so CI loosens the
// budget (FLOW_MAX_MS) to catch only a scene that's several times over it.
const MAX_MS = Number(process.env.FLOW_MAX_MS) || 2
const SIZES = [
  [250, 5],
  [80, 5],
  [13, 30],
  [22, 60],
] as const
const TIMED = [
  [250, 5],
  [22, 60],
] as const

let failed = 0
const bad = (why: string) => {
  failed++
  console.log(`  \x1b[31m✗\x1b[0m ${why}`)
}

if (syncManifest(false)) bad('plugin.json is out of step with SCENES: run `npm run sync`')

// The clips on disk and the ones the manifest names, as scripts/make-sounds.ts lists them.
const SOUNDS = join(import.meta.dirname, '..', 'sounds')
const clips = readdirSync(SOUNDS, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .flatMap(d => readdirSync(join(SOUNDS, d.name)).filter(f => !f.startsWith('.')).map(f => `sounds/${d.name}/${f}`))
const named = new Set(SOUND_FILES)
const unnamed = clips.filter(f => !named.has(f))
const gone = SOUND_FILES.filter(f => !clips.includes(f))
if (unnamed.length) bad(`hooks/sound-files.ts doesn't name ${unnamed.join(', ')}: run \`npm run sounds\``)
if (gone.length) bad(`hooks/sound-files.ts names clips that aren't in sounds/: ${gone.join(', ')}: run \`npm run sounds\``)

if (process.env.FLOW_MAX_MS) console.log(`time budget ${MAX_MS} ms a frame (FLOW_MAX_MS)\n`)
console.log('scene      most pairs   ms at 250×5   ms at 22×60')
for (const scene of scenesFrom(process.argv.slice(2))) {
  let most = 0
  let where = ''
  for (const [columns, rows] of SIZES) {
    for (const level of [1, 5, 10]) {
      for (const night of nightsOf(scene)) {
        for (const tint of TINTS) {
          const f = build(scene, columns, rows, { level, night, tint }, 60)
          for (let i = 0; i < 20; i++) {
            f.step()
            const n = pairs(f.grid())
            if (n > most) {
              most = n
              where = `${columns}×${rows} level ${level}${night ? ' night' : ''} ${tint}`
            }
          }
        }
      }
    }
    // Level 0 is off: every cell blank.
    const off = build(scene, columns, rows, { level: 0, night: false, tint: 'normal' }, 40)
    const w = off.grid().words
    for (let i = 0; i < w.length; i += 3) {
      if (w[i] !== 0x20) {
        bad(`${scene}: level 0 still draws at ${columns}×${rows}`)
        break
      }
    }
  }
  const ms = TIMED.map(([columns, rows]) => {
    const f = build(scene, columns, rows, { level: 10, night: false, tint: 'normal' }, 60)
    const n = 200
    const t0 = performance.now()
    for (let i = 0; i < n; i++) {
      f.step()
      f.grid()
    }
    return (performance.now() - t0) / n
  })
  console.log(`${scene.padEnd(10)} ${String(most).padStart(10)}   ${ms.map(m => m.toFixed(2).padStart(11)).join('   ')}`)
  if (most > MAX_PAIRS) bad(`${scene}: ${most} colour pairs (at ${where}); Raster paints ${MAX_PAIRS}, quantize the gradients`)
  ms.forEach((m, i) => {
    if (m > MAX_MS) bad(`${scene}: ${m.toFixed(2)} ms a frame at ${TIMED[i]!.join('×')} (budget ${MAX_MS} ms)`)
  })
}
console.log(failed ? `\n${failed} problem${failed > 1 ? 's' : ''}` : '\nall good')
process.exit(failed ? 1 : 0)
