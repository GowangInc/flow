// REVISION: flow-v81-scene-tools
//
// Shared by preview and check: build a scene at a size and a setting, warm it
// up, and count what Claude Code's Raster cares about. Not part of the mod.

import { hasNight, makeScene, SCENES, STYLES, type SceneName, type Tint } from '../hooks/styles'
import type { Cells } from '../hooks/cells'

export const TINTS: Tint[] = ['normal', 'smoke', 'blue']
export const BAND = { name: 'band', columns: 120, rows: 5 }
export const SPINE = { name: 'spine', columns: 22, rows: 40 }

export type Setting = { level: number; night: boolean; tint: Tint }

/** The scenes named on the command line (all of them when none are), or exit with the names it knows. */
export function scenesFrom(argv: string[]): SceneName[] {
  const names = argv.filter(a => !a.startsWith('--'))
  for (const n of names) {
    if (!(STYLES as readonly string[]).includes(n)) {
      console.error(`no scene called "${n}"; there are: ${STYLES.join(', ')}`)
      process.exit(1)
    }
  }
  return names.length ? (names as SceneName[]) : [...STYLES]
}

export function nightsOf(scene: SceneName): boolean[] {
  return hasNight(scene) ? [false, true] : [false]
}

/** A scene at a size and setting, stepped `warm` frames so it has settled. */
export function build(scene: SceneName, columns: number, rows: number, s: Setting, warm = 90) {
  const f = makeScene(scene, 7)
  f.strength = s.level
  f.tint = s.tint
  f.night = s.night
  f.ensure(columns, rows)
  for (let i = 0; i < warm; i++) f.step()
  return f
}

/** Distinct (fg, bg) pairs in a frame: Raster paints 1024 and nearest-maps the rest. */
export function pairs(grid: Cells): number {
  const w = grid.words
  const set = new Set<number>()
  for (let i = 0; i < w.length; i += 3) set.add(w[i + 1]! * 0x2000000 + w[i + 2]!)
  return set.size
}

export const blurbOf = (scene: SceneName) => SCENES.find(d => d.name === scene)!.blurb
