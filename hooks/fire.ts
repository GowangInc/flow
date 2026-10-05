// REVISION: flow-v61-names
//
// A tiny Doom-fire–style cellular-automata fire, by Rob Macrae.
//
// Heat is seeded along the bottom row (the flame base) by a row of burners
// that each live a random 1.5-8 s, then re-roll where they burn and how
// bright, fading in and out at their own pace, and propagates upward
// each `step()` with random cooling + sideways "wind" drift. Strength is a
// 0..=10 dial: 0 = off, 1 = blue pilot lights, 8 = the default look, 10 = an
// inferno. It only simulates: `cells` holds the heat, which the fire scene
// (Ember, styles.ts) draws with `glyphFor` and `colorFor`.
//
// Rows above the fourth are headroom: heat entering them cools much harder,
// so only the tallest tongues lick up and taper there instead of the fire
// being clipped flat at the band's top edge. A tall grid (the spine) keeps
// one headroom row and cools gentler, so the flames rise to fill it.

import { Rng } from './cells'
import type { Tint } from './styles'

const GLYPHS = [0x2591, 0x2592, 0x2593, 0x2588] // ░ ▒ ▓ █
/** Rows of body; any above are headroom. */
const BODY_ROWS = 4
/** Extra cooling for heat rising into a headroom row: 0..HEADROOM_COOL-1 more. */
const HEADROOM_COOL = 14
const HEADROOM_COOL_MIN = 4
/** Under smoke, only the cooler tips go gray; the core keeps its color. */
export const SMOKE_TIPS = 0.5

/** Map strength to (peak heat, base coverage %). */
export function params(strength: number): [peak: number, seedPct: number] {
  if (strength <= 0) return [0, 0]
  const s = Math.min(10, strength)
  const peaks = [0, 2, 4, 7, 11, 14, 17, 20, 24, 29, 35]
  const seeds = [0, 10, 24, 42, 60, 74, 86, 94, 100, 100, 100]
  return [peaks[s]!, seeds[s]!]
}

/** Burner lifetimes, in frames (70 ms): ~1.5 s to ~8 s before a re-roll. */
const LIFE_MIN = 20
const LIFE_SPAN = 95
/** Below this level a burner is out (its column seeds no heat). */
const LEVEL_OUT = 0.08

/** xterm 256-color index → 0xRRGGBB, so the palette matches a 256-color terminal's. */
function xterm(idx: number): number {
  if (idx >= 232) {
    const g = 8 + (idx - 232) * 10
    return (g << 16) | (g << 8) | g
  }
  if (idx >= 16) {
    const lv = [0, 95, 135, 175, 215, 255]
    const i = idx - 16
    return (lv[Math.floor(i / 36)]! << 16) | (lv[Math.floor(i / 6) % 6]! << 8) | lv[i % 6]!
  }
  return 0xffffff
}

const BLUE_PILOT = [19, 27, 33]
const ORANGE = [130, 166, 172, 208, 214, 220]
const MIX5 = [124, 160, 166, 208, 214, 220]
const RED67 = [88, 124, 160, 196, 202, 208]
const RED8 = [52, 88, 124, 160, 196, 202, 208, 214]
const RED9 = [88, 124, 160, 196, 202, 208, 214, 220]
const RED10 = [124, 160, 196, 202, 208, 214, 220, 226]
const SMOKE = [236, 238, 240, 242, 244, 246, 248, 250]
/** Context nearly full: the hottest core burns blue-white. */
const BLUE_CORE = [33, 39, 45, 51, 87, 159]

function pick(ramp: number[], r: number): number {
  const n = ramp.length
  return ramp[Math.min(n - 1, Math.floor(Math.min(1, Math.max(0, r)) * n))]!
}

/** Color by (strength, heat ratio): blue pilots → orange → red inferno. */
export function colorFor(strength: number, r: number, tint: Tint = 'normal'): number {
  let idx: number
  if (tint === 'smoke' && r < SMOKE_TIPS) idx = pick(SMOKE, r / SMOKE_TIPS)
  else if (tint === 'blue' && r >= 0.6) idx = pick(BLUE_CORE, (r - 0.6) / 0.4)
  else if (strength === 1) idx = pick(BLUE_PILOT, r)
  else if (strength <= 4) {
    const warmth = strength === 2 ? 0.75 : strength === 3 ? 0.92 : 1
    idx = r < warmth ? pick(ORANGE, r) : pick(BLUE_PILOT, r)
  } else if (strength === 5) idx = pick(MIX5, r)
  else if (strength <= 7) idx = pick(RED67, r)
  else if (strength === 8) idx = pick(RED8, r)
  else if (strength === 9) idx = pick(RED9, r)
  else idx = pick(RED10, r)
  return xterm(idx)
}

export function glyphFor(r: number): number {
  return r < 0.18 ? GLYPHS[0]! : r < 0.52 ? GLYPHS[1]! : r < 0.86 ? GLYPHS[2]! : GLYPHS[3]!
}

export class AsciiFire {
  w = 0
  h = 0
  cells = new Uint8Array(0)
  strength = 8
  /** Extra % of the base row lit (subagents widen the fire). */
  coverageBoost = 0
  peak = 1
  t = 0
  /**
   * One burner per column. `rank` (0..1) decides whether it burns: it does
   * while rank·100 < coverage, so density follows strength at once while the
   * lit columns wander as ranks re-roll. `level` eases toward `target` (its
   * brightness when lit) at `rate` per frame: the fade in and out.
   */
  rank = new Float32Array(0)
  target = new Float32Array(0)
  level = new Float32Array(0)
  rate = new Float32Array(0)
  life = new Uint16Array(0)
  /** xorshift32: only the flicker depends on it. */
  private rng: Rng

  constructor(seed?: number) {
    this.rng = new Rng(seed)
  }

  /** Give burner `x` a new life: where it ranks, how bright, how fast it fades. */
  private reroll(x: number): void {
    this.rank[x] = this.rng.f()
    this.target[x] = 0.6 + 0.4 * this.rng.f()
    this.rate[x] = 0.03 + 0.07 * this.rng.f()
    this.life[x] = LIFE_MIN + Math.floor(this.rng.f() * LIFE_SPAN)
  }

  /** Re-allocate (and reset) the grid when the render area changes size. */
  ensure(w: number, h: number): void {
    if (w !== this.w || h !== this.h) {
      this.w = w
      this.h = h
      this.cells = new Uint8Array(w * h)
      this.rank = new Float32Array(w)
      this.target = new Float32Array(w)
      this.level = new Float32Array(w)
      this.rate = new Float32Array(w)
      this.life = new Uint16Array(w)
      for (let x = 0; x < w; x++) {
        this.reroll(x)
        // Stagger first lives so the burners never re-roll in lockstep.
        this.life[x] = Math.floor(this.rng.f() * (LIFE_MIN + LIFE_SPAN))
      }
    }
  }

  /** Slowly-moving height profile so flames ripple horizontally over time. */
  private baseDip(x: number, span: number): number {
    const a = Math.sin(x * 0.3 + this.t * 0.22)
    const b = Math.sin(x * 0.11 - this.t * 0.15)
    return Math.floor((((a + b) * 0.5 + 1) * 0.5) * span)
  }

  step(): void {
    const { w, h } = this
    if (w === 0 || h < 2) return
    const [peak, baseSeed] = params(this.strength)
    const seedPct = peak === 0 ? 0 : Math.min(100, baseSeed + this.coverageBoost)
    this.peak = Math.max(1, peak)
    if (peak === 0) {
      this.cells.fill(0)
      return
    }
    // Seed the source (bottom) row from the burners: each fades toward its
    // target while it ranks under the coverage, toward 0 when it does not.
    const bottom = (h - 1) * w
    const span = peak * 0.18
    for (let x = 0; x < w; x++) {
      if (this.life[x]! === 0) this.reroll(x)
      else this.life[x]!--
      const isLit = this.rank[x]! * 100 < seedPct
      const goal = isLit ? this.target[x]! : 0
      const lv = this.level[x]!
      const step = this.rate[x]!
      this.level[x] = lv < goal ? Math.min(goal, lv + step) : Math.max(goal, lv - step)
      if (this.level[x]! < LEVEL_OUT) {
        this.cells[bottom + x] = 0
        continue
      }
      const v = Math.max(peak - this.baseDip(x, span) - (this.rng.int() % 3), Math.floor(peak / 2))
      this.cells[bottom + x] = Math.max(1, Math.round(v * this.level[x]!))
    }
    // Propagate upward with strong random cooling + wind drift (-1, 0, +1);
    // rising into a headroom row cools harder, so only the tallest get there.
    const isTall = h > BODY_ROWS + 1
    const headroom = isTall ? 1 : Math.max(0, h - BODY_ROWS)
    // Cooling per row scales with the body's height: a 30-row spine burns
    // about as tall, relatively, as the 4-row band.
    const stretch = isTall ? Math.min(1, (BODY_ROWS / (h - 1)) * 1.8) : 1
    for (let x = 0; x < w; x++) {
      for (let y = 1; y < h; y++) {
        const src = y * w + x
        const p = this.cells[src]!
        if (p === 0) {
          this.cells[src - w] = 0
        } else {
          const extra = y - 1 < headroom ? HEADROOM_COOL_MIN + (this.rng.int() % HEADROOM_COOL) : 0
          const roll = this.rng.int() % 11
          const cool = (isTall ? Math.round(roll * stretch) : roll) + extra
          const nx = x + (1 - (this.rng.int() % 3))
          if (nx >= 0 && nx < w) this.cells[(y - 1) * w + nx] = Math.max(0, p - cool)
        }
      }
    }
    this.t++
  }

}
