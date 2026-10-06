// REVISION: flow-v104-sound-stream
//
// The scenes, all driven by the same dials (strength 0..10, coverage boost,
// tint, night): SCENES, the one list of them (each scene file exports its
// SceneDef; add yours there), and the fire itself (`Ember`, the `fire` scene): the ░▒▓█
// Doom-style automaton of fire.ts for its shape, glyphs and crisp flicker,
// colored half its 256-color ramp, half a smooth truecolor black-body eased
// over time, with sparks breaking off the tips and cooling into smoke.
// Everything off the flames is transparent: no backgrounds.

import { AsciiFire, colorFor, glyphFor } from './fire'
import { Cells, Rng } from './cells'
export type { Cells }
import { heatColor, smokeColor } from './fire-palette'
import { BRAILLE, mix } from './pixels'
import { defineScene, type SceneDef } from './scene-def'
import type { Ambience, SoundEvent } from './sound'
import { balloonScene } from './balloon'
import { avalonScene } from './colony'
import { engineScene } from './engine'
import { skiScene } from './ski'
import { surfScene } from './surf'
import { falconScene, starshipScene } from './rocket'
import { warpScene } from './starfield'
import { bubblesScene } from './bubbles'


/** What shows over a scene: smoke after a failure or a compaction, blue when the context is nearly full. */
export type Tint = 'normal' | 'smoke' | 'blue'

/** What the frame timer drives, whatever the look. */
export interface Scene {
  strength: number
  coverageBoost: number
  tint: Tint
  /** Night, for the scenes that have one (the rest have no such field and ignore it). */
  night?: boolean
  ensure(columns: number, rows: number): void
  step(): void
  /** The current frame's cells: what every harness draws from. */
  grid(): Cells
  /** `grid()` encoded as Raster cells, for Claude Code's terminal. */
  frame(): string
  /** What just happened on screen, to be heard: the adapter takes them (and empties it). */
  sounds?: SoundEvent[]
  /** What it's doing now, for its soundscape's background. */
  ambience?(): Ambience
}

function defOf(style: SceneName): SceneDef {
  return SCENES.find(d => d.name === style)!
}

export function makeScene(style: SceneName, seed?: number): Scene {
  return defOf(style).make(seed)
}

/** Whether a scene has a night as well as a day. */
export function hasNight(style: SceneName): boolean {
  return defOf(style).night === true
}

export function nextStyle(style: SceneName): SceneName {
  return STYLES[(STYLES.indexOf(style) + 1) % STYLES.length]!
}

/** A style by name, old names included (`starfield` is now `warp`). Day or night is never part of the name. */
export function styleNamed(s: string): SceneName | undefined {
  return SCENES.find(d => d.name === s || d.aliases?.includes(s))?.name
}

/** plugin.json's `style` description: every scene and its blurb (a test keeps the manifest in step). */
export function styleDescription(): string {
  return SCENES.map(d => `${d.name}: ${d.blurb}`).join('; ')
}

/** plugin.json's `time` description: which scenes have a night. */
export function timeDescription(): string {
  const night = SCENES.filter(d => d.night).map(d => d.name)
  const list = night.length > 1 ? `${night.slice(0, -1).join(', ')} and ${night.at(-1)}` : night.join('')
  return `For ${list}: clock follows your local time (night from 19:00 to 7:00); day or night pins it`
}

type Spark = { x: number; y: number; vy: number; heat: number; cool: number; phase: number }

/** Below this heat a spark has cooled into smoke: gray, slower, wider sway. */
const SMOKE_AT = 0.38
/** Ember drops cells fainter than this: on a dark terminal they read as black. */
const FAINTEST = 0.1

/**
 * Half classic, half smooth. Classic's automaton at full height draws the
 * glyphs (░▒▓█ from the live heat, so the flicker stays crisp), each colored
 * half classic's 256-color ramp and half a truecolor black-body. The
 * black-body half reads a softened heat (blurred sideways, eased over a few
 * frames), which carries the smoothness into the colors instead of a
 * background. Sparks break off the tips and cool into smoke, in cells the
 * flames leave empty. Every cell keeps the terminal's own background.
 */
class Ember implements Scene {
  coverageBoost = 0
  sounds: SoundEvent[] = []
  tint: Tint = 'normal'
  private core: AsciiFire
  private rng: Rng
  /** The heat softened: blurred over five columns, eased across frames. */
  private soft = new Float32Array(0)
  private sparks: Spark[] = []
  // Per-frame buffers, reused.
  private out = new Cells(0, 0)
  private bits = new Uint8Array(0)
  private spark = new Float32Array(0)
  private smoke = new Float32Array(0)
  private columns = 0
  private rows = 0
  private t = 0

  constructor(seed?: number) {
    this.core = new AsciiFire(seed)
    this.rng = new Rng((seed ?? Date.now()) ^ 0x27d4eb2f)
  }

  get strength(): number {
    return this.core.strength
  }

  set strength(s: number) {
    this.core.strength = s
  }

  ensure(columns: number, rows: number): void {
    this.core.ensure(columns, rows)
    if (columns === this.columns && rows === this.rows) return
    this.columns = columns
    this.rows = rows
    this.soft = new Float32Array(columns * rows)
    this.out = new Cells(columns, rows)
    this.bits = new Uint8Array(columns * rows)
    this.spark = new Float32Array(columns * rows)
    this.smoke = new Float32Array(columns * rows)
    this.sparks = []
  }

  step(): void {
    const w = this.columns
    const h = this.rows
    if (w === 0 || h === 0) return
    this.core.coverageBoost = this.coverageBoost
    this.core.step()
    this.t++
    const cells = this.core.cells
    const peak = Math.max(1, this.core.peak)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0
        let wt = 0
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const k = dx === 0 ? 3 : Math.abs(dx) === 1 ? 2 : 1
          sum += Math.min(1, cells[y * w + nx]! / peak) * k
          wt += k
        }
        const i = y * w + x
        this.soft[i] = this.soft[i]! * 0.45 + (sum / wt) * 0.55
      }
    }

    // Sparks off the tips: the topmost cell of each column hot enough.
    // Off is off: no sparks drift on once the fire is out.
    const s = this.strength
    if (s === 0) this.sparks.length = 0
    if (s > 0) {
      const chance = s === 1 ? 0.0008 : 0.0022 * s
      for (let x = 0; x < w; x++) {
        let tip = -1
        for (let y = 0; y < h; y++) {
          if (cells[y * w + x]! / peak > 0.3) {
            tip = y
            break
          }
        }
        if (tip < 0 || this.rng.f() >= chance) continue
        // A pilot only lets off the odd wisp of smoke, never a spark.
        const heat = s === 1 ? SMOKE_AT : 0.72 + 0.25 * this.rng.f()
        if (heat > SMOKE_AT && this.sounds.length < 16) this.sounds.push({ kind: 'crack', v: heat })
        this.sparks.push({
          x: x * 2 + this.rng.f() * 2,
          y: tip * 4,
          vy: 0.2 + 0.18 * this.rng.f(),
          heat,
          cool: 0.016 + 0.012 * this.rng.f(),
          phase: this.rng.f() * 6.283,
        })
      }
    }
    // Move, cool, and compact the live sparks in place.
    let live = 0
    for (const p of this.sparks) {
      const isSmoke = p.heat < SMOKE_AT
      if (isSmoke) p.vy = Math.max(0.05, p.vy * 0.985)
      p.y -= p.vy
      p.x += Math.sin(p.y * 0.5 + this.t * 0.15 + p.phase) * (isSmoke ? 0.3 : 0.14)
      p.heat -= isSmoke ? p.cool * 0.6 : p.cool
      if (p.heat > 0.04 && p.y >= 0 && p.x >= 0 && p.x < w * 2) this.sparks[live++] = p
    }
    this.sparks.length = live
  }

  frame(): string {
    return this.grid().encode()
  }

  grid(): Cells {
    const w = this.columns
    const h = this.rows
    const out = this.out
    const cells = this.core.cells
    const peak = Math.max(1, this.core.peak)
    const s = this.strength
    // Braille dots for the sparks and smoke, per cell.
    const { bits, spark, smoke } = this
    bits.fill(0)
    spark.fill(0)
    smoke.fill(0)
    for (const p of this.sparks) {
      const px = Math.floor(p.x)
      const py = Math.floor(p.y)
      const c = (py >> 2) * w + (px >> 1)
      if (c < 0 || c >= bits.length) continue
      bits[c]! |= BRAILLE[px & 1]![py & 3]!
      if (p.heat >= SMOKE_AT) spark[c] = Math.max(spark[c]!, p.heat)
      else smoke[c] = Math.max(smoke[c]!, p.heat / SMOKE_AT)
    }
    for (let i = 0; i < w * h; i++) {
      const r = cells[i]! / peak
      if (r >= FAINTEST) {
        const smooth = Math.min(1, (r + this.soft[i]!) * 0.55)
        const fg = mix(colorFor(s, r, this.tint), heatColor(s, smooth, this.tint), 0.5)
        out.set(i, glyphFor(r), fg)
      } else if (bits[i]) {
        const fg =
          spark[i]! > 0
            ? this.tint === 'smoke'
              ? smokeColor(1)
              : heatColor(s, spark[i]!, this.tint)
            : smokeColor(smoke[i]!)
        out.set(i, 0x2800 | bits[i]!, fg)
      } else {
        out.blank(i)
      }
    }
    return out
  }
}

const fireScene = defineScene({
  name: 'fire',
  blurb: 'a ░▒▓█ fire with sparks and smoke',
  // The fire had two looks once; the softer one, `ember`, is now the fire.
  aliases: ['classic', 'ember', 'inferno', 'flame'],
  make: seed => new Ember(seed),
})

/**
 * Every scene, in `/flow next` order. To add one: export a SceneDef from its
 * file (`npm run new-scene <name>` writes one) and list it here.
 */
export const SCENES = [
  fireScene,
  warpScene,
  avalonScene,
  balloonScene,
  engineScene,
  falconScene,
  starshipScene,
  surfScene,
  skiScene,
  bubblesScene,
] as const
export type SceneName = (typeof SCENES)[number]['name']
export const STYLES: readonly SceneName[] = SCENES.map(d => d.name)
