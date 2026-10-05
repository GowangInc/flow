// REVISION: flow-v61-names
//
// River (the `river` style): a kayaker running a river on the same dials as
// the fire; the level is the current. At 1 the water is glassy, the far
// bank's trees mirrored in it, and the kayaker drifts with the paddle across
// the deck. As the level climbs the current picks up: the kayaker paddles,
// the banks, reeds and rocks slide past faster, ripples streak the water and
// the rocks start to throw up white pillows. From 8 it is white-water
// rapids: standing waves, boiling foam, spray off every rock and the bow,
// and the kayaker bouncing through it all.
//
// The band is a side view from the near bank: sky, the far bank's treeline,
// the river, and reeds and boulders in the foreground, each sliding past at
// its own pace. The spine looks down the river from above: it winds away
// toward the hills on the horizon between grassy, wooded banks, rocks and
// white water coming down the pane at the kayaker steering through them.
//
// Everything solid is painted into a 2x2-a-cell pixel layer and folded into
// quadrant glyphs with the two colors that best fit each cell; spray, wake,
// rain, glints and fireflies are a braille dot layer on top. Subagents (the
// coverage boost) bring more boats down the river; smoke is a capsize (the
// kayak rolls over and back up) on murky water under a drifting mist; a
// nearly-full context brings a storm: slate sky, dark water, driving rain.

import { Cells, Rng } from './cells'
import type { Tint } from './styles'
import { MOON, moonCover, moonPixel, moonRadius, NIGHT_HORIZON, NIGHT_ZENITH, STAR } from './night'
import { BRAILLE, clamp, fitQuad, hash, hash1, mix, QUAD, type QuadFit } from './pixels'

/** World pixels the river carries the kayak per frame at each level. */
const SPEED = [0, 0.07, 0.16, 0.27, 0.4, 0.55, 0.72, 0.92, 1.15, 1.4, 1.7]
/** How fast the banks slide past in the band, relative to the water (nearer is faster). */
const SKY_PX = 0.04
const FAR_PX = 0.45
const WATER_PX = 0.8
const NEAR_PX = 1.3
/** The spine's perspective: how much the river narrows toward the horizon (smaller is stronger). */
const PERSP = 0.55

type Palette = {
  skyTop: number
  skyHz: number
  cloud: number
  hill: number
  tree: number
  treeDark: number
  treeLit: number
  bank: number
  grass: number
  grassDark: number
  reed: number
  water: number
  waterDeep: number
  waterLit: number
  shallow: number
  reflect: number
  foam: number
  foamShade: number
  rock: number
  rockLit: number
  spray: number
}

const DAY: Palette = {
  skyTop: 0x3a8ad8,
  skyHz: 0xa8d8f2,
  cloud: 0xf6faff,
  hill: 0x7aa4b0,
  tree: 0x2c6e2e,
  treeDark: 0x1a4a22,
  treeLit: 0x4c963a,
  bank: 0xc4b07a,
  grass: 0x84b64c,
  grassDark: 0x6c9e40,
  reed: 0x86ac3c,
  water: 0x2a80b8,
  waterDeep: 0x175888,
  waterLit: 0x9ad8f2,
  shallow: 0x3f9aaa,
  reflect: 0x1f5450,
  foam: 0xf4fbff,
  foamShade: 0xbcdcea,
  rock: 0x6c6a64,
  rockLit: 0xaaa69a,
  spray: 0xeaf6ff,
}
/** A failed command: overcast, the water churned murky (mist drifts over it, see MIST). */
const MURK = {
  skyTop: 0x737a84,
  skyHz: 0xb0b4b8,
  cloud: 0xc8ccd0,
  hill: 0x8c9294,
  water: 0x6c6a52,
  waterDeep: 0x4a4836,
  waterLit: 0x9c987e,
  shallow: 0x7a7256,
  reflect: 0x4c4e44,
  foam: 0xd8d6c8,
  foamShade: 0xa8a492,
  spray: 0xd0cec0,
}
/** A nearly-full context: a storm. */
const STORM: Palette = {
  skyTop: 0x1a2440,
  skyHz: 0x4c5e80,
  cloud: 0x6a7890,
  hill: 0x34425a,
  tree: 0x1c3a30,
  treeDark: 0x10261e,
  treeLit: 0x355a48,
  bank: 0x6a6650,
  grass: 0x2c4a32,
  grassDark: 0x1e3626,
  reed: 0x46623a,
  water: 0x23486c,
  waterDeep: 0x0e2240,
  waterLit: 0x7894b0,
  shallow: 0x2a5260,
  reflect: 0x132a30,
  foam: 0xdfe8f0,
  foamShade: 0x9fb2c4,
  rock: 0x3c4048,
  rockLit: 0x6a7280,
  spray: 0xd0dcea,
}
/**
 * By night: the near-black sky every scene shares (night.ts), the trees a
 * dark silhouette with a moonlit rim against it, the river an even dark
 * teal with a path of moonlight across it.
 */
const NIGHT: Palette = {
  skyTop: NIGHT_ZENITH,
  skyHz: NIGHT_HORIZON,
  cloud: 0x2a3348,
  hill: 0x0e1622,
  tree: 0x0f2119,
  treeDark: 0x08140f,
  treeLit: 0x2c5048,
  bank: 0x3a4a46,
  grass: 0x10221a,
  grassDark: 0x0a1710,
  reed: 0x1e3c28,
  water: 0x0c3448,
  waterDeep: 0x051a2a,
  waterLit: 0x4a809c,
  shallow: 0x123e48,
  reflect: 0x061418,
  foam: 0xa8bccc,
  foamShade: 0x56708a,
  rock: 0x2a2f36,
  rockLit: 0x56606e,
  spray: 0xb8cce0,
}
/** What the boats lean toward by night. */
const NIGHT_SHADE = 0x0a1428
const MIST = 0xc8ccd0
const FIREFLY = 0xd8f070
const LANTERN = 0xffd27a
const RAIN = 0xa4b8d4

const SKIN = 0xe9b48a
const JACKET = 0xd8302a
const HELMET = 0xff8a1c
const HULL = 0xf6c42c
const KEEL = 0xc07a14
const SHAFT = 0x30343c
const BLADE = 0xf0f0ea
/** Company: (hull, jacket) for each extra boat. */
const EXTRA_HULLS = [0x4fc3f7, 0xff7a4a, 0xa6e05a, 0xf48fb1, 0xf3f3ee]
const EXTRA_JACKETS = [0x203f86, 0x2f6a35, 0x6a2a8a, 0x1e5a5a, 0x8a5a20]

/**
 * The kayak in the band, facing right, bottom row on the waterline: h =
 * head, j = jacket, k = deck, d = keel. Each has a large cut for a deeper band.
 */
const SIDE = [
  ['      hh    ', '      jj    ', 'kkkkkkkkkkkk'],
  ['      hh      ', '      hh      ', '     jjjj     ', '      jj      ', 'kkkkkkkkkkkkkk', ' dddddddddddd '],
]
/** The kayak from above and behind, bow up the pane (the spine). */
const TOP = [
  [' kk ', ' kk ', 'kkkk', 'khhk', 'kjjk', 'kjjk', 'kkkk', ' kk ', ' kd '],
  ['  kk  ', '  kk  ', ' kkkk ', ' kkkk ', 'kkhhkk', 'kjhhjk', 'kjjjjk', 'kkjjkk', ' kkkk ', ' kkkk ', '  kk  ', '  dd  '],
]

const PMAX = 520
/** Set pixels in each quadrant mask. */
const BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4]

function grey(c: number, k: number): number {
  const l = (((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11) | 0
  return mix(c, (l << 16) | (l << 8) | l, k)
}

/** `v` (0..1) snapped to `n` even steps: shading in a few flat tones keeps the color pairs down. */
function steps(v: number, n: number): number {
  return Math.round(v * n) / n
}

/** Smooth 1-D value noise in [0, 1). */
function vnoise(x: number, seed: number): number {
  const i = Math.floor(x)
  const f = x - i
  const a = hash1(i * 7919 + seed)
  const b = hash1((i + 1) * 7919 + seed)
  return a + (b - a) * f * f * (3 - 2 * f)
}

/** Smooth 2-D value noise in [0, 1). */
function noise2(x: number, y: number, seed: number): number {
  const i = Math.floor(x)
  const j = Math.floor(y)
  const fx = x - i
  const fy = y - j
  const u = fx * fx * (3 - 2 * fx)
  const v = fy * fy * (3 - 2 * fy)
  const a = hash(i, j, seed)
  const b = hash(i + 1, j, seed)
  const c = hash(i, j + 1, seed)
  const d = hash(i + 1, j + 1, seed)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

export class River {
  strength = 8
  coverageBoost = 0
  tint: Tint = 'normal'
  /** Night: the moon and stars, moonlight on the water, fireflies on the banks. */
  night = false
  private columns = 0
  private rows = 0
  private out = new Cells(0, 0)
  private rng: Rng
  private seed: number
  private t = 0
  private started = false

  // Eased dials.
  private s = 0
  private speed = 0
  private travel = 0
  private kGrey = 0
  private kStorm = 0
  private kNight = 0
  private pal: Palette = { ...DAY }

  // Pixel layer (2x2 a cell) and per-cell overlays.
  private pw = 0
  private ph = 0
  private pc = new Int32Array(0)
  private wet = new Uint8Array(0)
  private dots = new Uint8Array(0)
  private dotColor = new Int32Array(0)
  private solid = new Uint8Array(0)
  private keep = new Int8Array(0)
  private dominant = new Int32Array(0)
  private quad = new Int32Array(4)
  private fit: QuadFit = { mask: 0, fg: 0, bg: 0, spread: 0 }

  // Band geometry (pixel rows): the far bank's edge, the near bank's top, the waterline.
  private vertical = false
  private bankY = 0
  private nearY = 0
  private wl = 0

  // Spine geometry: the horizon row, and per pixel row below it the world
  // distance ahead, the scale, the river's center and half-width there.
  private hz = 0
  private rowD = new Float32Array(0)
  private rowSc = new Float32Array(0)
  private rowC = new Float32Array(0)
  private rowW = new Float32Array(0)
  private camX = 0
  private boatY = 0

  // The kayaker.
  private stroke = 0
  private flip = 0
  private lastTint: Tint = 'normal'

  // Particles (spray, wake, glints, fireflies, rain), in pixels.
  private px = new Float32Array(PMAX)
  private py = new Float32Array(PMAX)
  private vx = new Float32Array(PMAX)
  private vy = new Float32Array(PMAX)
  private life = new Float32Array(PMAX)
  private kind = new Uint8Array(PMAX)
  private nextP = 0

  constructor(seed?: number) {
    this.seed = (seed ?? Math.floor(Math.random() * 100_000)) % 100_000
    this.rng = new Rng(this.seed + 23)
  }

  ensure(columns: number, rows: number): void {
    if (columns === this.columns && rows === this.rows) return
    this.columns = columns
    this.rows = rows
    this.out = new Cells(columns, rows)
    this.vertical = rows > columns
    this.pw = columns * 2
    this.ph = rows * 2
    const n = this.pw * this.ph
    this.pc = new Int32Array(n)
    this.wet = new Uint8Array(n)
    this.dots = new Uint8Array(columns * rows)
    this.dotColor = new Int32Array(columns * rows)
    this.solid = new Uint8Array(columns * rows)
    this.keep = new Int8Array(columns * rows).fill(-1)
    this.dominant = new Int32Array(columns * rows)
    this.rowD = new Float32Array(this.ph)
    this.rowSc = new Float32Array(this.ph)
    this.rowC = new Float32Array(this.ph)
    this.rowW = new Float32Array(this.ph)
    this.life.fill(0)
    const ph = this.ph
    // The far trees stand right at the water (no sandbank), and the river runs
    // to the bottom of the band: the near bank shows only as reeds in front.
    this.bankY = Math.max(1, Math.floor(ph * 0.35))
    this.nearY = ph
    this.wl = this.bankY + Math.max(2, Math.round((this.nearY - this.bankY) * 0.4))
    this.hz = Math.max(5, Math.round(ph * 0.16))
    this.boatY = Math.round(this.hz + (ph - this.hz) * 0.68)
    this.camX = this.centerAt(this.travel + this.depth(this.boatY))
  }

  private get level(): number {
    return Math.max(0, Math.min(10, this.strength))
  }

  /** White water, 0..1: from about 7 up. */
  private get rapids(): number {
    return clamp((this.s - 6.6) / 2.9)
  }

  // ------------------------------------------------------------ the spine's river

  /** World distance ahead of the bottom of the pane at pixel row y (below the horizon). */
  private depth(y: number): number {
    const g = this.ph - this.hz
    const v = clamp((y + 0.5 - this.hz) / g, 0.001, 1)
    const e = PERSP
    return g * ((1 + e) * (1 + e) / (v + e) - (1 + e))
  }

  /** The river's center (world x) at world distance wy along it. */
  private centerAt(wy: number): number {
    const a = this.pw * 0.5
    const p = this.seed * 0.37
    return a * (0.62 * Math.sin(wy * 0.026 + p) + 0.38 * Math.sin(wy * 0.061 + p * 1.7))
  }

  /** The river's half-width (world pixels) at wy: narrower through the rapids. */
  private halfAt(wy: number): number {
    return this.pw * (0.27 + 0.05 * Math.sin(wy * 0.013 + this.seed)) * (1 - 0.16 * this.rapids)
  }

  private layoutSpine(): void {
    const g = this.ph - this.hz
    const e = PERSP
    for (let y = this.hz; y < this.ph; y++) {
      const v = clamp((y + 0.5 - this.hz) / g, 0.001, 1)
      const d = this.depth(y)
      this.rowD[y] = d
      this.rowSc[y] = (v + e) / (1 + e)
      this.rowC[y] = this.centerAt(this.travel + d)
      this.rowW[y] = this.halfAt(this.travel + d)
    }
  }

  /** Screen x (pixels) of world x at pixel row y of the spine. */
  private screenX(wx: number, y: number): number {
    return this.pw / 2 + (wx - this.camX) * this.rowSc[y]!
  }

  // ------------------------------------------------------------ motion

  private emit(x: number, y: number, vx: number, vy: number, life: number, kind: number): void {
    const i = this.nextP
    this.nextP = (i + 1) % PMAX
    this.px[i] = x
    this.py[i] = y
    this.vx[i] = vx
    this.vy[i] = vy
    this.life[i] = life
    this.kind[i] = kind
  }

  step(): void {
    if (this.columns === 0) return
    const level = this.level
    if (!this.started) {
      this.s = level
      this.speed = SPEED[level]!
      this.kGrey = this.tint === 'smoke' ? 1 : 0
      this.kStorm = this.tint === 'blue' ? 1 : 0
      this.kNight = this.night ? 1 : 0
      this.lastTint = this.tint
      this.started = true
    }
    this.t++
    this.s += (level - this.s) * 0.035
    const lo = Math.floor(this.s)
    const sp = SPEED[lo]! + ((SPEED[Math.min(10, lo + 1)] ?? 0) - SPEED[lo]!) * (this.s - lo)
    this.speed += (sp - this.speed) * 0.1
    this.travel += this.speed * (this.vertical ? 1.3 : 1)
    this.kGrey += ((this.tint === 'smoke' ? 1 : 0) - this.kGrey) * 0.05
    this.kStorm += ((this.tint === 'blue' ? 1 : 0) - this.kStorm) * 0.05
    this.kNight += ((this.night ? 1 : 0) - this.kNight) * 0.04
    if (level <= 0) return

    // A capsize when a command fails: over, a few seconds under, and rolled back up.
    if (this.tint === 'smoke' && this.lastTint !== 'smoke' && this.flip === 0) this.flip = 1
    this.lastTint = this.tint
    if (this.flip > 0 && ++this.flip > 52) this.flip = 0
    if (this.flip === 2) {
      const [x, y] = this.heroAt()
      for (let i = 0; i < 26; i++) {
        const a = Math.PI * (1 + this.rng.f())
        const v = 0.3 + this.rng.f() * 0.8
        this.emit(x + (this.rng.f() - 0.5) * 4, y - 1, Math.cos(a) * v, Math.sin(a) * v, 8 + this.rng.f() * 12, 0)
      }
    }

    const s = this.s
    // Paddling: a stroke a side, quicker as the current picks up.
    if (s > 1.6) this.stroke += 0.1 + 0.028 * s
    else this.stroke += (Math.round(this.stroke / Math.PI) * Math.PI - this.stroke) * 0.1

    if (this.vertical) {
      this.layoutSpine()
      const target = this.centerAt(this.travel + this.depth(this.boatY) * 0.7)
      this.camX += (target - this.camX) * 0.06
    }
    this.spawn()
    this.move()
  }

  /** New particles: wake, spray, glints, fireflies, rain. */
  private spawn(): void {
    const s = this.s
    const k = this.rapids
    const r = this.rng
    const pw = this.pw
    const ph = this.ph
    const [hx, hy] = this.heroAt()
    const up = this.flip === 0
    // The wake: a fan of ripples off the stern (and off the bow, in the spine).
    if (s > 1.8 && up && this.t % Math.max(1, Math.round(5 - s * 0.35)) === 0) {
      if (this.vertical) {
        const half = this.boatHalf()
        for (const side of [-1, 1]) this.emit(hx + side * (half + 0.5), hy + 1, side * (0.12 + 0.02 * s), 0.1, 10 + s, 1)
      } else this.emit(hx - 5 - r.f() * 2, hy + 0.2, -0.05, 0, 8 + s * 1.5, 1)
    }
    // Spray: off the bow and the rocks in the rapids.
    if (k > 0 && up) {
      const n = k * 1.6
      for (let i = 0; i < n; i++) {
        if (r.f() > n - i) break
        if (this.vertical) this.emit(hx + (r.f() - 0.5) * 6, hy - this.boatLen() * 0.45, (r.f() - 0.5) * 0.9, -0.1 - r.f() * 0.5, 5 + r.f() * 7, 0)
        else this.emit(hx + 4 + r.f() * 2, hy - 0.5, 0.1 + r.f() * 0.5, -0.4 - r.f() * 0.6, 5 + r.f() * 8, 0)
      }
      // Spray thrown up off the white water ahead.
      const m = k * k * (this.vertical ? 1.2 : pw / 70)
      for (let i = 0; i < m; i++) {
        if (r.f() > m - i) break
        if (this.vertical) {
          const y = this.hz + 4 + r.f() * (ph - this.hz - 4)
          const yi = Math.floor(y)
          const x = this.screenX(this.rowC[yi]! + (r.f() - 0.5) * this.rowW[yi]! * 1.6, yi)
          this.emit(x, y, (r.f() - 0.5) * 0.6, -0.2 - r.f() * 0.4, 4 + r.f() * 6, 0)
        } else this.emit(r.f() * pw, this.bankY + 1 + r.f() * (this.nearY - this.bankY - 1), (r.f() - 0.3) * 0.6, -0.3 - r.f() * 0.5, 4 + r.f() * 7, 0)
      }
    }
    // Glints of sun (or moon) on calm water.
    if (s < 5 && this.kStorm < 0.5) {
      const n = (5 - s) * 0.25 * (this.vertical ? 1 : pw / 100)
      for (let i = 0; i < n; i++) {
        if (r.f() > n - i) break
        if (this.vertical) {
          const y = this.hz + 2 + Math.floor(r.f() * (ph - this.hz - 2))
          this.emit(this.screenX(this.rowC[y]! + (r.f() - 0.5) * this.rowW[y]! * 1.6, y), y + 0.5, 0, 0, 2 + r.f() * 3, 2)
        } else this.emit(r.f() * pw, this.bankY + 1.5 + r.f() * (this.nearY - this.bankY - 1.5), 0, 0, 2 + r.f() * 3, 2)
      }
    }
    // Fireflies over the banks on a quiet night.
    const ff = this.kNight * clamp((5 - s) / 3) * (1 - this.kStorm)
    if (ff > 0.2 && r.f() < ff * (this.vertical ? 0.25 : pw / 300)) {
      if (this.vertical) {
        const y = this.hz + 3 + Math.floor(r.f() * (ph - this.hz - 3))
        const side = r.f() < 0.5 ? -1 : 1
        const x = this.screenX(this.rowC[y]! + side * (this.rowW[y]! + 3 + r.f() * 10), y)
        this.emit(x, y, (r.f() - 0.5) * 0.1, (r.f() - 0.5) * 0.08, 20 + r.f() * 30, 3)
      } else {
        const y = r.f() < 0.5 ? this.bankY - r.f() * 2 : this.nearY - r.f() * 1.5
        this.emit(r.f() * pw, y, (r.f() - 0.5) * 0.1, (r.f() - 0.5) * 0.05, 20 + r.f() * 30, 3)
      }
    }
    // Rain in a storm.
    if (this.kStorm > 0.3) {
      const n = this.kStorm * (this.vertical ? 2.5 : pw / 16)
      for (let i = 0; i < n; i++) {
        if (r.f() > n - i) break
        this.emit(r.f() * (pw + 10), -1, -0.45, 1.3 + r.f() * 0.5, ph, 4)
      }
    }
  }

  private move(): void {
    const v = this.vertical
    const drift = v ? 0 : this.speed * WATER_PX
    for (let i = 0; i < PMAX; i++) {
      if (this.life[i]! <= 0) continue
      this.life[i]! -= 1
      const kd = this.kind[i]!
      if (kd === 2) continue
      if (v && kd !== 4) {
        // The world comes down the pane, faster nearer the bottom.
        const yi = clamp(Math.floor(this.py[i]!), this.hz, this.ph - 1)
        const sc = this.rowSc[yi]!
        this.py[i]! += this.speed * 1.3 * sc * sc
      }
      this.px[i]! += this.vx[i]! - (kd === 3 ? drift * (FAR_PX / WATER_PX) : kd === 4 ? 0 : drift)
      this.py[i]! += this.vy[i]!
      if (kd === 0) {
        this.vy[i]! += 0.05
        this.vx[i]! *= 0.96
      } else if (kd === 3) {
        // Fireflies wander.
        this.vx[i]! += (this.rng.f() - 0.5) * 0.03
        this.vy[i]! += (this.rng.f() - 0.5) * 0.02
      } else if (kd === 4 && this.py[i]! > this.ph) this.life[i] = 0
    }
  }

  /** The hero's waterline position, in pixels. */
  private heroAt(): [number, number] {
    if (this.vertical) {
      const y = this.boatY
      const d = this.rowD[y] ?? 0
      const c = this.centerAt(this.travel + d)
      const w = this.halfAt(this.travel + d)
      const weave = Math.sin(this.t * 0.031) * 0.25 + Math.sin(this.t * 0.07) * 0.12 * this.rapids
      return [this.pw / 2 + (c + w * weave - this.camX) * (this.rowSc[y] || 1), y]
    }
    const x = Math.round(this.pw * (this.pw > 300 ? 0.3 : 0.36))
    return [x, this.wl]
  }

  private boatHalf(): number {
    return this.big() ? 3 : 2
  }

  private boatLen(): number {
    return TOP[this.big() ? 1 : 0]!.length
  }

  private big(): boolean {
    return this.vertical ? this.pw >= 40 && this.ph >= 80 : this.ph >= 14
  }

  // ------------------------------------------------------------ drawing

  private updatePalette(): void {
    const p = this.pal
    const keys = Object.keys(DAY) as (keyof Palette)[]
    for (const key of keys) {
      let c = DAY[key]
      c = mix(c, STORM[key], this.kStorm)
      c = mix(c, NIGHT[key], this.kNight)
      const o = (MURK as Partial<Palette>)[key]
      if (o !== undefined) c = mix(c, mix(o, NIGHT[key], this.kNight * 0.75), this.kGrey)
      else c = grey(c, this.kGrey * 0.4)
      p[key] = c
    }
  }

  grid(): Cells {
    const out = this.out
    const w = this.columns
    const h = this.rows
    if (this.level <= 0 || w === 0 || h === 0) {
      for (let i = 0; i < w * h; i++) out.blank(i)
      return out
    }
    if (!this.started) this.step()
    this.updatePalette()
    if (this.vertical) {
      this.layoutSpine()
      this.paintSpine()
    } else this.paintBand()
    this.paintBoats()
    this.composite()
    this.overlayDots()
    return out
  }

  /** The band: sky, far bank, river and near bank, side on. */
  private paintBand(): void {
    const pw = this.pw
    const ph = this.ph
    const P = this.pal
    const s = this.s
    const t = this.t
    const k = this.rapids
    const kN = this.kNight
    const bankY = this.bankY
    const nearY = this.nearY
    const tr = this.travel
    const [mx, my] = moonPixel(this.columns, this.rows)
    const mr = moonRadius(false)
    const hx = this.heroAt()[0]
    const treeMax = bankY - 0.3
    // Calm water mirrors the far bank; choppy water breaks the reflection up.
    const glass = clamp((5.5 - s) / 4.5)
    const ripAmp = 0.15 + 0.3 * Math.max(0, s - 1)
    const mist = this.kGrey * (1 - 0.4 * kN)
    for (let x = 0; x < pw; x++) {
      const xc = x + 0.5
      const fx = xc + tr * FAR_PX
      const wx = xc + tr * WATER_PX
      const nx = xc + tr * NEAR_PX
      // By night the trees keep low under the moon, so it always shows.
      const clearing = kN > 0 ? 1 - kN * clamp(1 - (Math.abs(xc - mx) - 2.5) / 6) : 1
      const tree = this.treeAt(fx, treeMax * clearing)
      const treeTop = bankY - tree.h
      // Standing waves heave the far edge of the water up over the bank.
      const heave = k > 0 ? k * (0.5 + 0.9 * k) * Math.max(0, Math.sin(wx * 0.31 + t * 0.21) * 0.7 + (noise2(wx * 0.12, t * 0.05, 3) - 0.5)) : 0
      const top = bankY - heave
      // Reeds stay below the hero's cells, or a reed and the hull would share one.
      let reed = this.reedAt(nx, k)
      if (Math.abs(xc - hx) < 8) reed = Math.min(reed, nearY - (this.wl | 1) - 1)
      const rock = this.rockAt(wx, s)
      for (let y = 0; y < ph; y++) {
        const k0 = y * pw + x
        const yc = y + 0.5
        let c: number
        let wet = 0
        if (yc < top) {
          // Sky.
          c = mix(P.skyTop, P.skyHz, clamp(y / Math.max(1, bankY)))
          if (kN < 0.95) c = this.bandCloud(c, xc + tr * SKY_PX + t * 0.01, yc)
          if (kN > 0.02) {
            let nc = mix(P.skyTop, 0x000000, 0.5)
            const moon = moonCover(xc, yc, mx, my, mr)
            if (moon > 0) nc = mix(nc, MOON, moon * (1 - this.kGrey * 0.7))
            else if (hash(Math.floor(xc + tr * SKY_PX), y, this.seed) > 0.965) {
              const tw = 0.55 + 0.45 * hash(x, y + (t >> 3), 7)
              nc = mix(nc, STAR, tw * (1 - clamp(y / bankY) * 0.5) * (1 - this.kGrey))
            }
            c = mix(c, nc, kN)
          }
          // The far bank's trees: pines dark, the broadleaves lit on their sunward side.
          if (yc > treeTop) {
            if (tree.pine) c = P.treeDark
            else c = tree.shade ? P.tree : yc < treeTop + 1.2 ? P.treeLit : mix(P.tree, P.treeLit, 0.35)
          }
          if (mist > 0.01) c = mix(c, MIST, mist * (0.35 + 0.4 * steps(noise2(fx * 0.05 - t * 0.02, y * 0.4, 11), 3)))
        } else {
          // The river.
          wet = 1
          const depth = (yc - top) / Math.max(1, nearY - top)
          c = mix(P.water, P.waterDeep, clamp(depth * 0.45))
          // The far bank mirrored in the water: shorter, and broken by ripples.
          const jit = (noise2(wx * 0.4, y * 0.9 + t * 0.08, 5) - 0.5) * ripAmp * 2
          const mirror = this.treeAt(fx + jit, treeMax * clearing).h
          if (glass > 0 && yc - top < mirror * 0.5) c = mix(c, P.reflect, (0.15 + 0.2 * glass) * (1 - k))
          // Ripples: short pale streaks traveling with the water; longer and rarer when calm.
          const busy = clamp((s - 1) / 7)
          const len = 7 - 4 * busy
          const tn = hash(Math.floor((wx - t * 0.04 * s) / len), y, 13)
          if (tn > 0.985 - 0.17 * busy) c = mix(c, P.waterLit, 0.3 + 0.25 * busy)
          else if (tn < 0.1 * busy) c = mix(c, P.waterDeep, 0.35)
          // A path of moonlight under the moon.
          if (kN > 0.05) {
            const gd = Math.abs(xc - mx) / (1.2 + (yc - top) * 1.8)
            if (gd < 1 && hash(Math.floor(wx * 0.7), y, (t >> 2) + 19) > 0.5 + gd * 0.4) c = mix(c, MOON, 0.45 * kN * (1 - gd * 0.6) * (1 - this.kGrey))
          }
          // White water: standing waves' crests and foam boiling downstream.
          if (k > 0) {
            // Low, lumpy noise so the foam comes in drifts rather than static.
            const fl = noise2(wx * 0.16 - t * 0.12, y * 0.6 + t * 0.03, 17)
            if (yc < top + 1 && heave > 0.6) c = mix(c, P.foam, 0.85)
            else if (fl < k * 0.3) c = mix(c, fl < k * 0.18 ? P.foam : P.foamShade, 0.85)
          }
          // A rock in the stream, and the water piling white against it.
          if (rock.w > 0) {
            const d = Math.abs(wx - rock.x)
            if (d < rock.w && y >= rock.y - rock.h + 1 && y <= rock.y) {
              c = y === rock.y - rock.h + 1 ? P.rockLit : P.rock
              wet = 0
            } else if (rock.foam > 0 && y >= rock.y - rock.h && y <= rock.y + 1) {
              const side = wx - rock.x
              const reach = rock.w + 0.8 + rock.foam * (side < 0 ? 2.2 : 4)
              if (d < reach && hash(Math.floor(wx), y, t >> 1) < rock.foam * 1.1 * (1 - d / reach) + 0.25) c = mix(c, P.foam, 0.8)
            }
          }
          if (mist > 0.01) c = mix(c, MIST, mist * 0.25 * steps(noise2(wx * 0.05 - t * 0.02, y * 0.4, 12), 2))
        }
        // Reeds and the odd cattail along the near bank, in front of the water.
        if (reed > 0 && y >= nearY - reed && y < nearY) {
          c = y === nearY - reed && reed >= 2 && hash(Math.floor(nx), 9, 43) > 0.75 ? 0x6b4423 : P.reed
          if (kN > 0.01) c = mix(c, P.grassDark, kN * 0.4)
          wet = 0
        }
        this.pc[k0] = c
        this.wet[k0] = wet
      }
    }
  }

  /** The far bank's treeline at world x: height above the bank (pixels), and kind. */
  private treeHit = { h: 0, pine: false, shade: false }
  private treeAt(wx: number, max: number): { h: number; pine: boolean; shade: boolean } {
    const sp = 5
    const j = Math.floor(wx / sp)
    const out = this.treeHit
    out.h = 0
    out.pine = false
    out.shade = false
    // Clearings now and then: a long low stretch of meadow.
    const clear = vnoise(wx * 0.022, this.seed)
    const scale = clear < 0.3 ? clamp((clear - 0.12) / 0.18) : 1
    if (scale <= 0) return out
    for (let i = j - 1; i <= j + 1; i++) {
      const h0 = hash1(i * 73 + this.seed)
      if (h0 < 0.18) continue
      const cx = i * sp + sp * 0.5 + (hash1(i * 79 + this.seed) - 0.5) * sp * 0.7
      const pine = h0 > 0.66
      const ht = max * scale * (pine ? 0.7 + 0.3 * hash1(i * 83 + this.seed) : 0.45 + 0.4 * hash1(i * 83 + this.seed))
      const w = pine ? 1.9 : 2.6 + 1.4 * hash1(i * 89 + this.seed)
      const d = Math.abs(wx - cx) / w
      if (d >= 1) continue
      const v = pine ? ht * (1 - d * 0.85) : ht * Math.sqrt(1 - d * d)
      if (v > out.h) {
        out.h = v
        out.pine = pine
        out.shade = wx > cx
      }
    }
    return out
  }


  private bandCloud(c: number, x: number, y: number): number {
    const sp = 70
    const j = Math.floor(x / sp)
    if (hash1(j * 97 + this.seed) < 0.4) return c
    const cx = j * sp + sp * (0.3 + 0.4 * hash1(j * 101 + this.seed))
    const w = 8 + 10 * hash1(j * 103 + this.seed)
    const cy = 0.6 + 0.8 * hash1(j * 107 + this.seed)
    const dx = (x - cx) / w
    const dy = (y - cy) / 0.9
    const r = dx * dx + dy * dy
    return r < 1 ? mix(c, this.pal.cloud, clamp((1 - r) * 2.5) * (1 - this.kStorm * 0.4)) : c
  }

  /** Reed height (pixels) along the near bank at world x: thinning out in the rapids. */
  private reedAt(nx: number, k: number): number {
    const i = Math.floor(nx / 1)
    const h = hash1(i * 37 + this.seed)
    const clump = vnoise(nx * 0.08, this.seed + 3)
    if (clump < 0.5 + 0.4 * k || h < 0.45) return 0
    const max = Math.max(1, Math.min(3, this.nearY - this.wl - 1))
    return 1 + Math.floor(h * h * max * 1.1)
  }

  /** The rock in the stream at world x: center, half-width, bottom row, height, and its white water. */
  private rockHit = { x: 0, w: 0, y: 0, h: 0, foam: 0 }
  private rockAt(wx: number, s: number): { x: number; w: number; y: number; h: number; foam: number } {
    const sp = 26
    const j = Math.floor(wx / sp)
    const out = this.rockHit
    out.w = 0
    const dens = 0.18 + 0.5 * clamp((s - 3) / 6)
    for (let i = j - 1; i <= j + 1; i++) {
      if (hash1(i * 131 + this.seed) > dens) continue
      const cx = i * sp + sp * 0.5 + (hash1(i * 137 + this.seed) - 0.5) * sp * 0.5
      const w = 1.2 + 1.6 * hash1(i * 139 + this.seed)
      if (Math.abs(wx - cx) > w + 7) continue
      out.x = cx
      out.w = w
      const lo = this.bankY + 2
      out.y = Math.min(this.nearY - 1, lo + Math.floor(hash1(i * 149 + this.seed) * (this.nearY - lo)))
      out.h = w > 2 ? 2 : 1
      out.foam = clamp((s - 3) / 5)
      return out
    }
    return out
  }

  /** The spine: sky and hills, then the river winding away between its banks. */
  private paintSpine(): void {
    const pw = this.pw
    const ph = this.ph
    const P = this.pal
    const t = this.t
    const k = this.rapids
    const kN = this.kNight
    const hz = this.hz
    const tr = this.travel
    const [mx, my] = moonPixel(this.columns, this.rows)
    const mr = moonRadius(true)
    const mist = this.kGrey * (1 - 0.4 * kN)
    // Sky, the moon and stars, and the hills along the horizon.
    for (let y = 0; y < hz; y++) {
      for (let x = 0; x < pw; x++) {
        const xc = x + 0.5
        const yc = y + 0.5
        let c = mix(P.skyTop, P.skyHz, clamp(y / hz))
        if (kN < 0.95) c = this.spineCloud(c, xc + t * 0.02, yc)
        if (kN > 0.02) {
          let nc = mix(P.skyTop, 0x000000, 0.4)
          const d = Math.hypot(xc - mx, (yc - my) * 2)
          if (d < mr * 3) nc = mix(nc, MOON, 0.16 * (1 - d / (mr * 3)))
          const moon = moonCover(xc, yc, mx, my, mr)
          if (moon > 0) nc = mix(nc, MOON, moon * (1 - this.kGrey * 0.7))
          else if (hash(x, y, this.seed) > 0.965) nc = mix(nc, STAR, (0.5 + 0.5 * hash(x, y + (t >> 3), 7)) * (1 - this.kGrey))
          c = mix(c, nc, kN)
        }
        const hill = 1 + 3.2 * vnoise(x * 0.16 + this.seed, 1) + 1.2 * vnoise(x * 0.45, 2)
        if (yc > hz - hill) c = yc > hz - hill + 1 ? mix(P.hill, P.treeDark, 0.3) : P.hill
        if (mist > 0.01) c = mix(c, MIST, mist * 0.5)
        this.pc[y * pw + x] = c
        this.wet[y * pw + x] = 0
      }
    }
    // The river and its banks, receding to the horizon.
    for (let y = hz; y < ph; y++) {
      const sc = this.rowSc[y]!
      const wy = tr + this.rowD[y]!
      const cR = this.rowC[y]!
      const hw = this.rowW[y]!
      const v = (y + 0.5 - hz) / (ph - hz)
      const haze = steps(Math.pow(1 - v, 3), 5) * 0.7
      for (let x = 0; x < pw; x++) {
        const wx = this.camX + (x + 0.5 - pw / 2) / sc
        const dx = wx - cR
        const ad = Math.abs(dx)
        let c: number
        let wet = 0
        if (ad < hw) {
          wet = 1
          const edge = (hw - ad) / hw
          c = mix(P.shallow, P.water, steps(clamp(edge * 3), 3))
          c = mix(c, P.waterDeep, steps(clamp(edge * 2 - 1), 2) * 0.35)
          // Streaks drawn out along the flow.
          const tn = hash(Math.floor(wx * 0.7), Math.floor((wy - t * 0.05 * this.s) * 0.18), 13)
          if (tn > 0.9 - 0.15 * clamp(this.s / 8)) c = mix(c, P.waterLit, (0.25 + 0.25 * clamp(this.s / 8)) * steps(v, 3) * (1 - 0.5 * kN))
          // A column of moonlight on the water under the moon.
          if (kN > 0.05) {
            const gd = Math.abs(x + 0.5 - mx) / (1.5 + v * pw * 0.14)
            if (gd < 1 && hash(Math.floor(wx), Math.floor(wy * 0.5), (t >> 2) + 19) > 0.55 + gd * 0.35) c = mix(c, MOON, 0.45 * kN * (1 - gd * 0.5) * (1 - this.kGrey))
          }
          // White water through the rapids, churning downstream.
          if (k > 0) {
            const fl = noise2(wx * 0.3, wy * 0.22 - t * 0.12, 17) * 0.75 + hash(x, y, t) * 0.25
            if (fl < k * 0.5) c = mix(c, fl < k * 0.3 ? P.foam : P.foamShade, 0.88)
            else if (edge < 0.12) c = mix(c, P.foamShade, 0.5 * k)
          }
          // Rocks, with a white pillow on their upstream side and a wake behind.
          const r = this.spineRock(wx, wy)
          if (r < 0) {
            c = r < -0.5 ? P.rockLit : P.rock
            wet = 0
          } else if (r > 0) c = mix(c, P.foam, r)
          if (mist > 0.01) c = mix(c, MIST, mist * 0.3 * steps(noise2(wx * 0.08, wy * 0.05 - t * 0.02, 12), 2))
        } else {
          // The bank: a strip of mud and stones at the water, grass, and trees.
          const out = ad - hw
          if (out < 1.6) c = hash(Math.floor(wx), Math.floor(wy), 3) > 0.8 ? P.rockLit : P.bank
          else c = noise2(wx * 0.15, wy * 0.12, 31) > 0.62 ? mix(P.grass, P.grassDark, 0.5) : P.grass
          const tree = this.spineTree(wx, wy)
          if (tree === -1) c = mix(c, P.treeDark, 0.45)
          else if (tree !== 0) c = tree
          if (mist > 0.01) c = mix(c, MIST, mist * 0.3)
        }
        if (haze > 0.01) c = mix(c, mix(P.hill, P.skyHz, 0.4), haze)
        this.pc[y * pw + x] = c
        this.wet[y * pw + x] = wet
      }
    }
  }

  private spineCloud(c: number, x: number, y: number): number {
    const sp = 40
    const j = Math.floor(x / sp)
    if (hash1(j * 97 + this.seed) < 0.35) return c
    const cx = j * sp + sp * (0.3 + 0.4 * hash1(j * 101 + this.seed))
    const w = 5 + 6 * hash1(j * 103 + this.seed)
    const cy = 1.5 + (this.hz - 5) * 0.5 * hash1(j * 107 + this.seed)
    const dx = (x - cx) / w
    const dy = (y - cy) / 1.4
    const r = dx * dx + dy * dy
    return r < 1 ? mix(c, this.pal.cloud, clamp((1 - r) * 2.5) * (1 - this.kStorm * 0.4)) : c
  }

  /**
   * A tree on the bank seen from above: its color, or 0. One tree a grid
   * cell, kept inside its cell, never in the water.
   */
  private spineTree(wx: number, wy: number): number {
    const TW = 10
    const TH = 12
    const i = Math.floor(wx / TW)
    const j = Math.floor(wy / TH)
    const h = hash(i, j, 61)
    if (h < 0.25) return 0
    const r = 3 + 1.8 * hash(i, j, 62)
    const tx = i * TW + TW / 2 + (hash(i, j, 63) - 0.5) * (TW - 2 * r)
    const ty = j * TH + TH / 2 + (hash(i, j, 64) - 0.5) * (TH - 2 * r)
    const dx = wx - tx
    const dy = (wy - ty) * 0.75
    const d2 = dx * dx + dy * dy
    // Its shadow falls on the grass to the lower right.
    const sx = dx - 1.2
    const sy = dy + 1
    const shadow = sx * sx + sy * sy < r * r
    if (d2 > r * r && !shadow) return 0
    if (Math.abs(tx - this.centerAt(ty)) < this.halfAt(ty) + r * 0.6 + 1.5) return 0
    const P = this.pal
    if (d2 > r * r) return -1
    const lit = (-dx - dy * 1.3) / r
    const base = h > 0.7 ? P.treeDark : P.tree
    return lit > 0.35 ? mix(base, P.treeLit, (h > 0.7 ? 0.5 : 0.9) * (1 - 0.6 * this.kNight)) : lit < -0.45 ? mix(base, P.treeDark, 0.7) : base
  }

  /**
   * A rock in the stream at (wx, wy): -1 its lit top, -0.3 its body, a
   * positive amount of foam around it, or 0. One rock a grid cell.
   */
  private spineRock(wx: number, wy: number): number {
    const RW = 8
    const RH = 13
    const i = Math.floor(wx / RW)
    const j = Math.floor(wy / RH)
    const dens = 0.12 + 0.4 * clamp((this.s - 3) / 6)
    if (hash(i, j, 71) > dens) return 0
    const r = 0.9 + 1.2 * hash(i, j, 72)
    const tx = i * RW + RW / 2 + (hash(i, j, 73) - 0.5) * (RW - 2 * r - 2)
    const ty = j * RH + RH / 2 + (hash(i, j, 74) - 0.5) * (RH - 2 * r - 6)
    const dx = wx - tx
    const dy = (wy - ty) * 0.7
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d < r) return dx + dy < -r * 0.3 ? -1 : -0.3
    const foam = clamp((this.s - 3) / 5)
    if (foam <= 0) return 0
    // Upstream (nearer the viewer) a pillow; downstream a V of wake.
    if (dy < 0 && d < r + 0.8 + foam * 1.6) return 0.75 * foam
    if (dy > 0 && dy < 3 + foam * 6 && Math.abs(Math.abs(dx) - dy * 0.35 - r * 0.7) < 0.7) return 0.6 * foam
    return 0
  }

  /** A solid pixel of a boat; `glow` (a lantern) stays bright by night. */
  private put(x: number, y: number, c: number, keepIt = false, glow = false): void {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    if (xi < 0 || yi < 0 || xi >= this.pw || yi >= this.ph) return
    this.pc[yi * this.pw + xi] = this.kNight > 0.01 && !glow ? mix(c, NIGHT_SHADE, 0.3 * this.kNight) : c
    this.wet[yi * this.pw + xi] = 0
    const cell = (yi >> 1) * this.columns + (xi >> 1)
    this.solid[cell] = 1
    if (keepIt) this.keep[cell] = ((yi & 1) << 1) | (xi & 1)
  }

  /** The hero and, with subagents, more boats down the river. */
  private paintBoats(): void {
    const n = Math.min(this.vertical ? 3 : 5, Math.round(this.coverageBoost / 12))
    const [hx, hy] = this.heroAt()
    if (this.vertical) {
      for (let i = n; i >= 1; i--) {
        // Further down the river, ahead of the hero (up the pane).
        const y = Math.round(this.boatY - i * (this.big() ? 16 : 11))
        if (y < this.hz + 4) continue
        const c = this.centerAt(this.travel + this.rowD[y]!)
        const w = this.halfAt(this.travel + this.rowD[y]!)
        const x = this.screenX(c + w * 0.35 * Math.sin(this.t * 0.027 + i * 2.3), y)
        this.topBoat(x, y, EXTRA_HULLS[i - 1]!, EXTRA_JACKETS[i - 1]!, this.stroke + i * 1.3, false)
      }
      this.topBoat(hx, hy, HULL, JACKET, this.stroke, true)
      return
    }
    for (let i = 1; i <= n; i++) {
      // Strung out ahead and behind, bobbing to their own rhythm.
      const off = (i % 2 ? 1 : -1) * (24 + Math.floor((i - 1) / 2) * 24) + (hash1(i * 7 + this.seed) - 0.5) * 6
      const x = hx + off + Math.sin(this.t * 0.02 + i) * 3
      if (x < 6 || x > this.pw - 6) continue
      this.sideBoat(x, this.wl, EXTRA_HULLS[i - 1]!, EXTRA_JACKETS[i - 1]!, this.stroke + i * 1.7, i * 1.3, false)
    }
    this.sideBoat(hx, hy, HULL, JACKET, this.stroke, 0, true)
  }

  /** A kayak side on, facing right, hull on row `wl`. */
  private sideBoat(x: number, wl: number, hull: number, jacket: number, stroke: number, ph: number, hero: boolean): void {
    const k = this.rapids
    const big = this.big()
    const rows = SIDE[big ? 1 : 0]!
    const n = rows.length
    const width = rows[n - 1]!.length
    // Bouncing through the rapids, the bow riding up and slapping down.
    const bob = k * (Math.sin(this.t * 0.42 + ph) * 0.7 + (noise2(this.t * 0.15 + ph, 0, 9) - 0.5) * 1.2)
    const by = Math.round(wl + bob)
    const x0 = 2 * Math.round((x - width / 2) / 2)
    const flipped = hero && this.flip > 0 && this.flip < 46
    for (let r = 0; r < n; r++) {
      const row = rows[r]!
      // Over: only the hull shows, keel up, nobody aboard.
      if (flipped && r < n - (big ? 2 : 1)) continue
      for (let c = 0; c < row.length; c++) {
        const ch = row[c]!
        if (ch === ' ') continue
        let col = ch === 'h' ? (k > 0.3 && r === 0 ? HELMET : SKIN) : ch === 'j' ? jacket : ch === 'k' ? hull : mix(hull, KEEL, 0.6)
        if (flipped) col = r === n - 1 ? mix(hull, KEEL, 0.6) : hull
        const yy = flipped ? by - (big ? n - 1 - r : 0) : by - (n - 1 - r)
        this.put(x0 + c, yy, col, hero && ch === 'h')
      }
    }
    if (flipped) return
    // By night a lantern glows on the stern deck.
    if (this.kNight > 0.3) this.put(x0 + 1, by - 1, mix(HULL, LANTERN, this.kNight), true, true)
    // The paddle: a double blade see-sawing through the hands, dipping one side then the other.
    // Resting, it lies across the lap, only its blades showing past the paddler.
    const resting = this.s <= 1.6
    const hands = by - (big ? 3 : 1) + 0.5
    const cx = x0 + 7
    const a = resting ? 0 : 0.75 * Math.sin(stroke)
    const L = big ? 7.5 : 5.5
    for (let l = -L; l <= L; l += 0.5) {
      if (Math.abs(l) < 1.1) continue
      const blade = Math.abs(l) > L - 1.4
      if (resting && !blade) continue
      this.put(cx + l * Math.cos(a), hands + (l * Math.sin(a)) / 2, blade ? BLADE : SHAFT)
    }
  }

  /** A kayak from above and behind, bow up the pane, waterline row `y` at its middle. */
  private topBoat(x: number, y: number, hull: number, jacket: number, stroke: number, hero: boolean): void {
    const big = this.big()
    const rows = TOP[big ? 1 : 0]!
    const width = rows[0]!.length
    const flipped = hero && this.flip > 0 && this.flip < 46
    // Leaning into the river's bends.
    const d = this.rowD[Math.round(y)] ?? 0
    const lean = clamp((this.centerAt(this.travel + d + 6) - this.centerAt(this.travel + d - 6)) / 12, -0.5, 0.5) * 1.6
    const x0 = 2 * Math.round((x - width / 2) / 2)
    const y0 = Math.round(y - rows.length / 2)
    const mid = rows.length / 2
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!
      const shift = Math.round(lean * (mid - r) * 0.5)
      for (let c = 0; c < row.length; c++) {
        let ch = row[c]!
        if (ch === ' ') continue
        if (flipped && (ch === 'h' || ch === 'j')) ch = 'd'
        const col = ch === 'h' ? (this.rapids > 0.3 ? HELMET : 0x4a3020) : ch === 'j' ? jacket : ch === 'k' ? hull : mix(hull, KEEL, 0.6)
        this.put(x0 + c + shift, y0 + r, col, hero && ch === 'h')
      }
    }
    if (flipped) return
    if (this.kNight > 0.3) this.put(x0 + width / 2, y0 + rows.length - 2, mix(hull, LANTERN, this.kNight), true, true)
    // The paddle across the boat, one blade then the other sweeping back through the water.
    const pr = rows.findIndex(r => r.includes('j')) + 0.5
    const cx = x0 + width / 2
    const cy = y0 + pr
    const L = big ? 7 : 5
    const sw = Math.sin(stroke) * (this.s > 1.6 ? (big ? 2.2 : 1.6) : 0)
    for (let l = -L; l <= L; l += 0.5) {
      if (Math.abs(l) < width / 2) continue
      const py = cy + (sw * l) / L
      this.put(cx + l, py, Math.abs(l) > L - 1.3 ? BLADE : SHAFT)
    }
  }

  /** Fold each cell's four pixels into the two colors that best fit them. */
  private composite(): void {
    const out = this.out
    const w = this.columns
    const h = this.rows
    const pw = this.pw
    const q = this.quad
    for (let cell = 0; cell < w * h; cell++) {
      const r = (cell / w) | 0
      const c = cell - r * w
      const k0 = 2 * r * pw + 2 * c
      q[0] = this.pc[k0]!
      q[1] = this.pc[k0 + 1]!
      q[2] = this.pc[k0 + pw]!
      q[3] = this.pc[k0 + pw + 1]!
      const f = this.fit
      fitQuad(q, f, undefined, this.keep[cell]!)
      this.keep[cell] = -1
      if (f.spread === 0) {
        out.set(cell, 0x20, q[0]!, q[0]!)
        this.dominant[cell] = q[0]!
        continue
      }
      out.set(cell, QUAD[f.mask]!, f.fg, f.bg)
      // The color covering most of the cell: what overlays put behind themselves.
      this.dominant[cell] = BITS[f.mask]! > 2 ? f.fg : f.bg
    }
  }

  /** Spray, wake, glints, fireflies and rain as braille dots over the cells they fall in. */
  private overlayDots(): void {
    const w = this.columns
    const h = this.rows
    const pw = this.pw
    this.dots.fill(0)
    for (let i = 0; i < PMAX; i++) {
      if (this.life[i]! <= 0) continue
      const x = this.px[i]!
      const y = this.py[i]!
      if (x < 0 || y < 0 || x >= pw || y >= this.ph) continue
      const kd = this.kind[i]!
      // Wake and glints only show on open water; fireflies blink.
      if ((kd === 1 || kd === 2) && !this.wet[Math.floor(y) * pw + Math.floor(x)]) continue
      if (kd === 3 && Math.sin(this.life[i]! * 0.5 + i) < -0.2) continue
      const col = (x / 2) | 0
      const row = (y / 2) | 0
      const cell = row * w + col
      if (this.solid[cell]) continue
      const dc = Math.floor(x) - col * 2
      const dr = Math.min(3, Math.floor((y - row * 2) * 2))
      if (this.dots[cell] === 0) {
        const P = this.pal
        this.dotColor[cell] =
          kd === 0 ? P.spray : kd === 1 ? mix(P.waterLit, P.foam, 0.3) : kd === 2 ? mix(this.kNight > 0.5 ? MOON : 0xfffbe8, 0xffffff, 0.3) : kd === 3 ? FIREFLY : RAIN
      }
      this.dots[cell]! |= BRAILLE[dc]![dr]!
      // Rain falls in short streaks.
      if (kd === 4 && dr > 0) this.dots[cell]! |= BRAILLE[dc]![dr - 1]!
    }
    for (let cell = 0; cell < w * h; cell++) {
      if (this.dots[cell]) this.out.set(cell, 0x2800 + this.dots[cell]!, this.dotColor[cell]!, this.dominant[cell]!)
      this.solid[cell] = 0
    }
  }

  frame(): string {
    return this.grid().encode()
  }
}
