// REVISION: flow-v61-names
//
// The world the balloon and the rockets fly through, on the fire's dials: the
// level is a target altitude, eased toward, and the world scrolls past the
// vehicle as it climbs. Behind everything, a sky painted per row by that
// row's altitude: soil under the grass, a pale horizon, day blue, navy,
// near-black, then the painted black of space (the terminal's own background
// is rarely black and would look lighter than the atmosphere below it). On
// the ground, trees and houses (a subclass can put a launch site there);
// above it birds, the layered clouds, then stars and Earth's blue rim.
//
// Every scenery cell is a pure function of its world position, so the world
// is stable as it scrolls. In a tall column (the spine) the vehicle really
// rises up the screen from the ground, and the world only scrolls once it
// nears the top. A subclass draws the vehicle (and anything around it).
//
// At night (`night`, set by `/flow night` or the clock) the sky is near-black all the way
// to the ground, stars show at every height, clouds are moonlit, the grass
// and trees are dark, the houses' windows are lit, and a moon hangs high
// (the same night as every scene's: night.ts). Night falls and lifts over a
// couple of seconds rather than in one frame.

import { Cells, DEFAULT_COLOR } from './cells'
import { layered, snap } from './clouds/layered'
import type { Tint } from './styles'
import { MOON, MOON_ACROSS, MOON_ROW, NIGHT_HORIZON, NIGHT_ZENITH, STAR, STAR_DIM } from './night'
import { g, hash, lowerBlock, mix } from './pixels'

/**
 * How much taller the atmosphere is than the cloud painter's own scale:
 * the sky is stretched this much, and the clouds drawn this much bigger so
 * their shapes keep their proportions.
 */
const SCALE = 2
/** Target altitude (world rows) for each level; 0 is off. */
const ALTITUDE = [0, 0, 3, 7, 12, 18, 25, 33, 42, 52, 64].map(a => a * SCALE)
/** World rows at which the scenery bands begin (the painter's 6..44, scaled). */
const CLOUDS_FROM = 6 * SCALE
const CLOUDS_TO = 44 * SCALE
const STARS_FROM = 40 * SCALE
const EARTH_FROM = 56 * SCALE
/** How fast altitude eases toward its target, per frame. */
const CLIMB = 0.03
/** Columns per frame the whole cloud band drifts: one speed, so tall clouds stay upright. */
const CLOUD_DRIFT = 0.1

/** The sky by world row: day at the horizon, night by the edge of space. */
const SKY: [y: number, rgb: number][] = (
  [
    [0, 0x9fd3f2],
    [12, 0x6db8ec],
    [28, 0x3f86d4],
    [42, 0x24508f],
    [52, 0x121f45],
    [57, 0x070b1c],
    [61, 0x000000],
  ] as [number, number][]
).map(([y, c]) => [y * SCALE, c])
/** Space: black, the darkest thing in the sky. */
const SPACE = 0x000000
const SOIL = 0x5a3d24

/** The night sky by world row: near-black at the horizon, black by space. */
const NIGHT_SKY: [y: number, rgb: number][] = (
  [
    [0, NIGHT_HORIZON],
    [30, NIGHT_ZENITH],
    [61, 0x000000],
  ] as [number, number][]
).map(([y, c]) => [y * SCALE, c])
const NIGHT_SOIL = 0x22170e
/** Moonlight: what clouds and lit things lean toward at night. */
const MOONLIGHT = 0x9fb4d6

function ramp(stops: [number, number][], y: number): number {
  for (let i = 1; i < stops.length; i++) {
    const [y1, c1] = stops[i]!
    if (y <= y1) {
      const [y0, c0] = stops[i - 1]!
      return mix(c0, c1, (y - y0) / (y1 - y0))
    }
  }
  return SPACE
}

/** The background for a world row by day. */
export function skyColor(y: number): number {
  return y < 0 ? SOIL : ramp(SKY, y)
}

/** The background for a world row at night. */
function nightSkyColor(y: number): number {
  return y < 0 ? NIGHT_SOIL : ramp(NIGHT_SKY, y)
}

/** A cloud color by moonlight: dimmed toward the night sky behind it, cooled toward the moon. */
function moonlit(c: number, sky: number): number {
  return mix(mix(c, sky, 0.55), MOONLIGHT, 0.12)
}

const C = {
  grass: 0x4f9a3d,
  grassNight: 0x1d3a1a,
  tree: 0x2f6b2a,
  treeNight: 0x15291a,
  house: 0xc9a46a,
  window: 0xffd27a,
  bird: 0x5a5a62,
  earth: 0x4a90d9,
}

export type SceneryCell = { glyph: number; fg: number; bg?: number }

export abstract class SkyWorld {
  strength = 8
  coverageBoost = 0
  tint: Tint = 'normal'
  /** Night: a near-black sky to the ground, stars everywhere, moonlit clouds. */
  night = false
  /** How far night has fallen, 0..1: eased toward `night` a little each frame. */
  protected kNight = -1
  protected columns = 0
  protected rows = 0
  protected out = new Cells(0, 0)
  /** This frame's background per grid row. */
  protected rowBg: number[] = []
  protected alt = 0
  protected t = 0

  constructor(seed?: number) {
    this.t = (seed ?? Date.now()) % 10_000
  }

  /** The vehicle's height in rows on this grid (it may differ by layout). */
  protected abstract vehicleHeight(): number
  /** Draw the vehicle (and anything around it) over the world, its top at `top`. */
  protected abstract drawVehicle(out: Cells, top: number): void

  ensure(columns: number, rows: number): void {
    if (columns === this.columns && rows === this.rows) return
    this.columns = columns
    this.rows = rows
    this.out = new Cells(columns, rows)
  }

  /** The current altitude, in world rows (for tests and status). */
  get altitude(): number {
    return this.alt
  }

  /** Resume at an altitude (a reload rebuilds the vehicle; it shouldn't land). */
  seed(altitude: number): void {
    if (Number.isFinite(altitude) && altitude >= 0) this.alt = altitude
  }

  /** The altitude this level aims for. */
  protected get target(): number {
    return ALTITUDE[Math.max(0, Math.min(10, this.strength))]!
  }

  step(): void {
    this.t++
    // Night falls (and lifts) over a couple of seconds; a fresh start begins as asked.
    const k = this.night ? 1 : 0
    if (this.kNight < 0) this.kNight = k
    this.kNight += (k - this.kNight) * 0.05
    if (Math.abs(k - this.kNight) < 0.01) this.kNight = k
    this.advance()
  }

  /** How dark it is this frame, 0 day .. 1 night (as asked, before the first step). */
  protected get dark(): number {
    return this.kNight < 0 ? (this.night ? 1 : 0) : this.kNight
  }

  /** Move the altitude one frame toward its target; a subclass may fly differently. */
  protected advance(): void {
    this.alt += (this.target - this.alt) * CLIMB
    if (Math.abs(this.target - this.alt) < 0.01) this.alt = this.target
  }

  /** The row the vehicle's top sits on at rest: one row is left under it for the ground. */
  private restTop(): number {
    return Math.max(0, this.rows - this.vehicleHeight() - 1)
  }

  /**
   * How far the world has scrolled down: the altitude the on-screen climb
   * can't show. The vehicle rises up the grid until a quarter from the top
   * (in the band it can't rise at all), then the world scrolls instead.
   */
  protected get scroll(): number {
    const rest = this.restTop()
    const ceiling = Math.min(rest, Math.max(1, Math.floor(this.rows * 0.25)))
    return Math.max(0, Math.round(this.alt) - (rest - ceiling))
  }

  /** The row the vehicle's top is drawn on. */
  protected get vehicleTop(): number {
    return this.restTop() - (Math.round(this.alt) - this.scroll)
  }

  /** The grid row showing world row y (may be off the grid). */
  protected rowOf(y: number): number {
    return this.rows - 1 - (y - this.scroll + 1)
  }

  /** Wind for single-cell things (birds, stars): higher air moves faster. 0 on the ground. */
  protected wind(y: number): number {
    return y <= 0 ? 0 : Math.floor((this.t * (0.04 + y * 0.002)) % 100_000)
  }

  /** The background for a world row, by day, by night, or as night falls. */
  protected skyAt(y: number): number {
    const k = this.dark
    if (k <= 0) return skyColor(y)
    if (k >= 1) return nightSkyColor(y)
    return mix(skyColor(y), nightSkyColor(y), k)
  }

  /** A cloud color as lit this frame: moonlit by night, part way as night falls. */
  protected cloudLight(c: number, sky: number): number {
    const k = this.dark
    if (k <= 0) return c
    const m = moonlit(c, sky)
    return k >= 1 ? m : mix(c, m, k)
  }

  /** What stands on the ground row at world column x: trees and houses by default (lit at night). */
  protected groundFeature(x: number): SceneryCell | undefined {
    const h = hash(x, 0, 1)
    if (h < 0.06) return { glyph: g('♣'), fg: mix(C.tree, C.treeNight, this.dark) }
    if (h < 0.08) return { glyph: g('⌂'), fg: mix(C.house, C.window, this.dark) }
    return undefined
  }

  /** The moon, high in the night sky (far away: it doesn't scroll), where the sky is open. */
  protected drawMoon(out: Cells): void {
    const k = this.dark
    if (k <= 0.02 || this.rows < 3) return
    const x = Math.floor(this.columns * MOON_ACROSS)
    const r = Math.min(MOON_ROW, this.rows - 3)
    const i = r * this.columns + x
    if (x < this.columns && out.codePoint(i) === 0x20) {
      const bg = out.background(i)
      out.set(i, g('●'), k >= 1 ? MOON : mix(bg, MOON, k), bg)
    }
  }

  /** The scenery at world (x, y), or undefined for open sky. */
  protected scenery(x: number, y: number, sky: number): SceneryCell | undefined {
    if (y === -1) return { glyph: g('▀'), fg: mix(C.grass, C.grassNight, this.dark) }
    if (y === 0) return this.groundFeature(x)
    if (y < -1) return undefined
    // Clouds drift together at one speed, drawn at the sky's scale; birds and
    // stars ride the wind of their own row, which can't shear a single cell.
    const drift = Math.floor((this.t * CLOUD_DRIFT) % 100_000)
    let cloud = y >= CLOUDS_FROM && y <= CLOUDS_TO
      ? layered.cell({ x: (x + drift) / SCALE, y: y / SCALE, sky, t: this.t })
      : undefined
    if (cloud) {
      // Lit for the hour, then snapped to a few steps off the sky (see snap).
      const fg = snap(this.cloudLight(cloud.fg, sky), sky)
      const bg = snap(this.cloudLight(cloud.bg ?? sky, sky), sky)
      cloud = fg === sky && bg === sky ? undefined : { glyph: cloud.glyph, fg, bg }
    }
    x += this.wind(y)
    if (y >= 2 && y <= 14 * SCALE && hash(x, y, 2) < 0.005) {
      // A bird in front of a cloud takes the cloud behind it, not a box of sky.
      return { glyph: g((this.t >> 3) % 2 ? 'v' : '~'), fg: C.bird, bg: cloud ? (cloud.bg ?? cloud.fg) : undefined }
    }
    if (cloud) return cloud
    if (y >= STARS_FROM || (this.dark > 0 && y >= 2)) {
      // By night the stars are out at every height, thicker the higher up
      // (coming out one by one as night falls).
      const p = Math.max(0.02 * this.dark, Math.min(0.1, (y - STARS_FROM) * (0.004 / SCALE)))
      const h = hash(x, y, 7)
      if (h < p) {
        const twinkle = hash(x, y + (this.t >> 2), 8) < 0.15
        return { glyph: g(h < p * 0.2 ? '*' : '·'), fg: twinkle ? STAR_DIM : STAR }
      }
    }
    return undefined
  }

  grid(): Cells {
    const out = this.out
    const w = this.columns
    const h = this.rows
    if (this.strength <= 0) {
      for (let i = 0; i < w * h; i++) out.blank(i)
      return out
    }
    const scroll = this.scroll
    this.rowBg = []
    for (let r = 0; r < h; r++) {
      // Row r shows world row y: the bottom row is the grass (y = -1) until
      // the world scrolls, and the vehicle's lowest row is its altitude.
      const y = scroll - 1 + (h - 1 - r)
      const bg = this.skyAt(y)
      this.rowBg.push(bg)
      for (let x = 0; x < w; x++) {
        const i = r * w + x
        const s = this.scenery(x, y, bg)
        if (s) out.set(i, s.glyph, s.fg, s.bg ?? bg)
        else out.set(i, 0x20, DEFAULT_COLOR, bg)
      }
    }
    // Earth's blue rim along the bottom once high enough.
    if (this.alt >= EARTH_FROM) {
      for (let x = 0; x < w; x++) {
        const edge = (x + 0.5 - w / 2) / (w / 2)
        // Seen from above, the planet bulges up in the middle: four eighths of
        // the row there down to one at the edges, dithered a little per column
        // so the curve reads smoothly rather than as flat steps.
        const eighths = Math.floor(1 + 3 * (1 - edge * edge) + hash(x, 0, 74))
        out.set((h - 1) * w + x, lowerBlock(Math.max(1, Math.min(4, eighths))), C.earth, this.rowBg[h - 1])
      }
    }
    this.drawMoon(out)
    this.drawVehicle(out, this.vehicleTop)
    return out
  }

  frame(): string {
    return this.grid().encode()
  }
}
