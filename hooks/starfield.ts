// REVISION: flow-v61-names
//
// Warp (the `warp` style): a starfield on the same dials as the fire, the
// level is the ship's speed.
// Stars sit in 3D (x, y in -1..1, depth z in 0..1) and fly toward the
// viewer; each frame they're projected through the band's center onto a
// braille sub-pixel grid (2×4 dots a cell). At rest the field drifts and
// twinkles; from level 6 every star draws a streak back along its path, so
// by 10 the band is hyperspace. Subagents (the coverage boost) add stars;
// smoke dims the field to gray, a nearly-full context tints it cyan.

import { Cells, Rng } from './cells'
import { BRAILLE } from './pixels'
import { params } from './fire'
import type { Tint } from './styles'

/** Depth travelled per frame at each level (0 = stopped). */
const SPEED = [0, 0.0025, 0.004, 0.006, 0.009, 0.013, 0.018, 0.025, 0.034, 0.046, 0.062]
/** From this level stars draw streaks: trail length in frames of travel. */
const STREAK_FROM = 6
const NEAR = 0.04

type Star = { x: number; y: number; z: number; tw: number }

/** Brightness 0..1 as a star color: dim blue-gray far, white near. */
function starColor(b: number, tint: Tint, warp: number): number {
  const v = Math.max(0, Math.min(1, b))
  if (tint === 'smoke') {
    const g = Math.round(60 + v * 110)
    return (g << 16) | (g << 8) | g
  }
  // Far stars sit blue-gray; near ones bleach to white. Warp adds blue.
  let r = 70 + v * 185
  let g = 80 + v * 175
  let bl = 120 + v * 135
  if (tint === 'blue') {
    r *= 0.55
    g = Math.min(255, g * 1.05)
  }
  r -= warp * 40 * (1 - v)
  g -= warp * 15 * (1 - v)
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return (c(r) << 16) | (c(g) << 8) | c(bl)
}

export class Starfield {
  strength = 8
  coverageBoost = 0
  tint: Tint = 'normal'
  private columns = 0
  private rows = 0
  private stars: Star[] = []
  private out = new Cells(0, 0)
  private bits = new Uint8Array(0)
  private bright = new Float32Array(0)
  private rng: Rng
  private t = 0

  constructor(seed?: number) {
    this.rng = new Rng(seed)
  }

  ensure(columns: number, rows: number): void {
    if (columns === this.columns && rows === this.rows) return
    this.columns = columns
    this.rows = rows
    this.out = new Cells(columns, rows)
    this.bits = new Uint8Array(columns * rows)
    this.bright = new Float32Array(columns * rows)
    this.stars = []
  }

  /** Stars live in a volume shaped like the grid: flat for the band, tall for the spine. */
  private get aspectX(): number {
    return Math.max(1, (this.columns * 2) / Math.max(1, this.rows * 4))
  }

  private get aspectY(): number {
    return Math.max(1, (this.rows * 4) / Math.max(1, this.columns * 2))
  }

  private spawn(anyDepth: boolean): Star {
    return {
      x: (this.rng.f() * 2 - 1) * this.aspectX,
      y: (this.rng.f() * 2 - 1) * this.aspectY,
      z: anyDepth ? NEAR + this.rng.f() * (1 - NEAR) : 1,
      tw: this.rng.f() * 6.283,
    }
  }

  /** How many stars the band holds at this level: denser as it climbs. */
  private wanted(): number {
    if (this.strength <= 0) return 0
    const area = this.columns * this.rows
    const [, seed] = params(this.strength)
    const coverage = Math.min(160, seed + this.coverageBoost) / 100
    return Math.round(area * (0.035 + 0.035 * coverage) * (0.7 + this.strength * 0.05))
  }

  /** A star's position in braille dots, or undefined off the band. */
  private project(s: Star, z: number): [number, number] | undefined {
    const pw = this.columns * 2
    const ph = this.rows * 4
    // One scale for both axes (x already spans the band's aspect), so stars
    // stream out radially instead of squashing into a bow-tie.
    const scale = (Math.min(pw, ph) / 2) * 0.9
    const px = pw / 2 + (s.x / z) * scale
    const py = ph / 2 + (s.y / z) * scale
    if (px < 0 || px >= pw || py < 0 || py >= ph) return undefined
    return [px, py]
  }

  step(): void {
    this.t++
    const want = this.wanted()
    while (this.stars.length < want) this.stars.push(this.spawn(true))
    if (this.stars.length > want) this.stars.length = want
    const speed = SPEED[Math.max(0, Math.min(10, this.strength))]!
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i]!
      s.z -= speed
      if (s.z <= NEAR || !this.project(s, s.z)) this.stars[i] = this.spawn(false)
    }
  }

  private plot(px: number, py: number, b: number): void {
    const x = Math.floor(px)
    const y = Math.floor(py)
    const c = (y >> 2) * this.columns + (x >> 1)
    if (c < 0 || c >= this.bits.length) return
    this.bits[c]! |= BRAILLE[x & 1]![y & 3]!
    if (b > this.bright[c]!) this.bright[c] = b
  }

  grid(): Cells {
    const out = this.out
    const { bits, bright } = this
    bits.fill(0)
    bright.fill(0)
    const level = Math.max(0, Math.min(10, this.strength))
    const speed = SPEED[level]!
    const trail = level >= STREAK_FROM ? (level - STREAK_FROM + 1) * 1.4 : 0
    for (const s of this.stars) {
      const head = this.project(s, s.z)
      if (!head) continue
      // Nearer is brighter; at rest the field twinkles.
      const twinkle = level <= 2 ? 0.75 + 0.25 * Math.sin(this.t * 0.35 + s.tw) : 1
      const b = (1 - s.z) * twinkle
      this.plot(head[0], head[1], b)
      if (trail > 0) {
        // A streak back along the star's path, fading toward its tail.
        const tail = this.project(s, Math.min(1, s.z + speed * trail))
        if (tail) {
          const steps = Math.ceil(Math.max(Math.abs(head[0] - tail[0]), Math.abs(head[1] - tail[1])))
          for (let k = 1; k <= steps; k++) {
            const f = k / (steps + 1)
            this.plot(head[0] + (tail[0] - head[0]) * f, head[1] + (tail[1] - head[1]) * f, b * (1 - f) * 0.55)
          }
        }
      }
    }
    const warp = Math.max(0, (level - 7) / 3)
    for (let i = 0; i < this.columns * this.rows; i++) {
      if (bits[i] === 0) out.blank(i)
      else out.set(i, 0x2800 | bits[i]!, starColor(bright[i]!, this.tint, warp))
    }
    return out
  }

  frame(): string {
    return this.grid().encode()
  }
}
