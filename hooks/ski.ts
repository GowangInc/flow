// REVISION: flow-v61-names
//
// A skier on a mountain, on the fire's dials: the level is the speed and the
// steepness. At 1 the skier stands at the top of the run, poles planted,
// snow drifting down (beside the lift hut in the band; at the summit under
// the peaks in the spine). As the level rises they push off and carve linked
// S-turns, faster and faster, leaving tracks in the snow and throwing spray
// off every turn while the pines, slalom gates, moguls, rocks and far peaks
// stream past. From 8 they tuck into a steep powder run, a cloud of powder
// boiling up behind; at 10 they're flat out and catching air off kickers,
// a little shadow on the snow below.
//
// Two layouts. The band (wide, a few rows) is a side view: the slope runs
// across the band under a winter-blue sky, the skier's carves read as a
// weave toward and away from you, tracks trailing across the slope's face.
// The spine (tall, narrow) is a three-quarter view down the fall line: the
// skier carves S-turns down the column, the slope scrolling up past them,
// forest along both edges and the tracks winding away behind.
//
// Everything is painted into a pixel layer at quadrant resolution (2×2 per
// cell; each cell keeps the two colors that best fit its four pixels), with
// a braille layer on top (2×4 per cell) for the fine things: snowflakes,
// spray specks and ski tracks, wherever the cell under them is plain.
//
// Dials: running subagents put more skiers on the slope (each in their own
// jacket); a failed command makes the skier wipe out in a puff of snow (a
// yard sale: skis crossed, one stuck upright) under a flurry until things
// are fixed; a nearly-full context turns the light to dusk.

import { Cells, DEFAULT_COLOR, Rng } from './cells'
import type { Tint } from './styles'
import { MOON, moonCover, moonPixel, moonRadius, NIGHT_HORIZON, NIGHT_ZENITH, STAR } from './night'
import { BRAILLE, clamp, fitQuad, hashMurmur as hash, mix, QUAD, type QuadFit } from './pixels'

// ---------------------------------------------------------------- tables

/** Speed per level: band pixels (along the slope) per frame. */
const SPEED = [0, 0, 0.45, 0.8, 1.2, 1.7, 2.2, 2.8, 3.5, 4.3, 5.2]
/** How wide the carves are (fraction of the room to swing in). */
const AMP = [0, 0, 0.45, 0.65, 0.85, 0.95, 0.95, 0.85, 0.7, 0.55, 0.4]
/** Frames per full S (left turn + right turn). */
const PERIOD = [60, 60, 64, 56, 48, 42, 38, 34, 30, 28, 26]
/** Spray particles per frame at a turn's edge change. */
const SPRAY = [0, 0, 0.3, 0.6, 1, 1.5, 2.1, 2.8, 3.8, 4.8, 6]
/** Moguls by level: a bumpy mid-mountain run. */
const MOGULS = [0, 0, 0, 0.4, 0.8, 1, 0.9, 0.6, 0.2, 0, 0]
/** Slalom gates by level. */
const GATES = [0, 0, 0.15, 0.35, 0.45, 0.45, 0.35, 0.25, 0.1, 0, 0]
/** The spine scrolls in rows: a row is twice as tall as a pixel column is wide. */
const SPINE = 0.42
/** Frames to get up again after a fall. */
const GET_UP = 18

// ---------------------------------------------------------------- helpers

/** Smooth 1-D value noise in [0, 1). */
function noise(x: number, s: number): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return hash(i, 0, s) * (1 - u) + hash(i + 1, 0, s) * u
}

/** Smooth 2-D value noise in [0, 1). */
function noise2(x: number, y: number, s: number): number {
  const i = Math.floor(x)
  const j = Math.floor(y)
  const fx = x - i
  const fy = y - j
  const u = fx * fx * (3 - 2 * fx)
  const v = fy * fy * (3 - 2 * fy)
  const a = hash(i, j, s) * (1 - u) + hash(i + 1, j, s) * u
  const b = hash(i, j + 1, s) * (1 - u) + hash(i + 1, j + 1, s) * u
  return a * (1 - v) + b * v
}

// ---------------------------------------------------------------- palettes

interface Pal {
  skyTop: number
  skyLow: number
  peak: number
  peakShade: number
  cap: number
  capShade: number
  hill: number
  hillPine: number
  snow: number
  snowShade: number
  snowDeep: number
  track: number
  pine: number
  pineLit: number
  pineSnow: number
  trunk: number
  rock: number
  spray: number
  sprayShade: number
  shadow: number
  flake: number
  hut: number
  roof: number
  window: number
}

const DAY: Pal = {
  skyTop: 0x2f74cf,
  skyLow: 0xa6d2f4,
  peak: 0x8aa0bf,
  peakShade: 0x657c9e,
  cap: 0xf5f9fd,
  capShade: 0xc3d3ea,
  hill: 0xd5e3f2,
  hillPine: 0x4f7d74,
  snow: 0xeef4fb,
  snowShade: 0xc2d3e9,
  snowDeep: 0xa9bfdc,
  track: 0x93abcd,
  pine: 0x17482d,
  pineLit: 0x2e7448,
  pineSnow: 0xe4edf6,
  trunk: 0x5b3a22,
  rock: 0x5f646e,
  spray: 0xffffff,
  sprayShade: 0xc9d8ec,
  shadow: 0x8098be,
  flake: 0xffffff,
  hut: 0x7a4a2a,
  roof: 0xf2f6fb,
  window: 0xffd36b,
}

/** A nearly-full context: dusk, alpenglow on the peaks, the snow gone lavender-blue. */
const DUSK: Pal = {
  skyTop: 0x1b2150,
  skyLow: 0xe08f74,
  peak: 0xb98aa0,
  peakShade: 0x5a5480,
  cap: 0xffc9b5,
  capShade: 0x9a8ab6,
  hill: 0x9fa6cf,
  hillPine: 0x2a3550,
  snow: 0xb9c2e4,
  snowShade: 0x8f9acb,
  snowDeep: 0x7a85bb,
  track: 0x5f6aa3,
  pine: 0x10283a,
  pineLit: 0x1d4050,
  pineSnow: 0xa9b3da,
  trunk: 0x3a2a2a,
  rock: 0x4a4a62,
  spray: 0xe2e6fa,
  sprayShade: 0xa3acd8,
  shadow: 0x5d679f,
  flake: 0xdfe4ff,
  hut: 0x4e3328,
  roof: 0xc4cbec,
  window: 0xffb347,
}

/** A failed command: an overcast whiteout sky. */
const GREY: Pal = {
  ...DAY,
  skyTop: 0x7d8796,
  skyLow: 0xc9cfd8,
  peak: 0xa3abb8,
  peakShade: 0x8a93a2,
  cap: 0xe6e9ee,
  capShade: 0xc6ccd5,
  hill: 0xd7dce3,
}

/** Night: moonlit snow under the near-black night sky (night.ts), the hut window glowing. */
const NIGHT: Pal = {
  skyTop: NIGHT_ZENITH,
  skyLow: NIGHT_HORIZON,
  peak: 0x34405e,
  peakShade: 0x222b45,
  cap: 0xb4c2dc,
  capShade: 0x6e7c9c,
  hill: 0x4a5878,
  hillPine: 0x0e1c26,
  snow: 0x8394b6,
  snowShade: 0x5f6f90,
  snowDeep: 0x4c5a7a,
  track: 0x3e4b6a,
  pine: 0x081a14,
  pineLit: 0x12301f,
  pineSnow: 0x8e9ec0,
  trunk: 0x2a1c14,
  rock: 0x30343e,
  spray: 0xd4e0f4,
  sprayShade: 0x8c9cbc,
  shadow: 0x46557a,
  flake: 0xdce6f8,
  hut: 0x3a2618,
  roof: 0x9aaac8,
  window: 0xffc35a,
}

/** A failed command by night: cloud over the moon, the stars gone. */
const NIGHT_GREY: Pal = {
  ...NIGHT,
  skyTop: 0x1c2230,
  skyLow: 0x3a4252,
  peak: 0x4a5262,
  peakShade: 0x3a4252,
  cap: 0x8a92a2,
  capShade: 0x6a7282,
}

const PAL_KEYS = Object.keys(DAY) as (keyof Pal)[]

/** `v` eased a fraction `k` of the way to `goal`, landing on it once close. */
function approach(v: number, goal: number, k: number): number {
  const n = v + (goal - v) * k
  return Math.abs(goal - n) < 0.01 ? goal : n
}

/** What the skiers' kit leans toward by night. */
const NIGHT_SHADE = 0x0a1428

/** Each skier's kit: hat, jacket, pants, skis. The first is the hero. */
const KITS = [
  { hat: 0xffd23f, jacket: 0xe8302c, pants: 0x1f2a50, skis: 0xff9b1c },
  { hat: 0xffffff, jacket: 0x1e86e8, pants: 0x2b2b31, skis: 0xd9dde4 },
  { hat: 0xff5a8a, jacket: 0x22b06a, pants: 0x2d2440, skis: 0x30343c },
  { hat: 0x2e2e36, jacket: 0xf4c20d, pants: 0x2a3a5a, skis: 0x8a1f1f },
  { hat: 0x5cd0ff, jacket: 0x9b55d6, pants: 0x232a3a, skis: 0x30343c },
] as const
const SKIN = 0xf1c39b
const POLE = 0x4c5058

// ---------------------------------------------------------------- sprites

/** A small sprite, top row first; `ax` is the feet's column, the bottom row the feet's row. */
interface Sprite {
  w: number
  h: number
  ax: number
  rows: readonly string[]
}

const sp = (ax: number, rows: string[]): Sprite => ({ w: rows[0]!.length, h: rows.length, ax, rows })

// Side view (the band), facing downhill to the right.
// The body is two pixels wide at columns 2-3, drawn on an even pixel so it fills one cell column.
const B_STAND = sp(2, ['..HH...', '..RRR..', '.pRR.p.', '.pPP.p.', 'SSSSSSS'])
const B_SKI = sp(2, ['..HH...', '..RRR..', '.pRR...', 'p.PP...', 'SSSSSSS'])
const B_CARVE = sp(2, ['..HH...', '..RRRp.', '..RR.p.', '.pPP...', 'SSSSSSS'])
const B_TUCK = sp(2, ['..HH...', '.RRRRR.', 'ppPP...', 'SSSSSSS'])
const B_DOWN = sp(4, ['S.......', 'S.......', 'S..HRRPP', 'S.p.SSSS'])

// Three-quarter view (the spine), facing down the hill; skis and poles are drawn apart.
const S_BODY = sp(1, ['.H.', '.F.', 'RRR', 'rRr', '.P.'])
const S_TUCK = sp(1, ['.H.', 'RFR', 'rPr'])
const S_DOWN = sp(3, ['.RR....', 'HRRRPP.'])

// ---------------------------------------------------------------- the scene

const PMAX = 520
const TRK = 400
const FLAKES = 220

interface Skier {
  kit: (typeof KITS)[number]
  /** Phase offset of their turns. */
  off: number
  /** Band: their place across the band (fraction); spine: down the column (fraction). */
  anchor: number
  track: Float32Array
  head: number
  len: number
  lastD: number
  /** This frame's feet, in the layout's world coords. */
  fx: number
  fy: number
  lat: number
}

export class Ski {
  strength = 8
  coverageBoost = 0
  tint: Tint = 'normal'
  /** Night: moonlit snow, stars and a moon; the hut's window lit. */
  night = false
  // The light, eased toward the dials (-1 until the first frame): night, overcast, dusk.
  private kNight = -1
  private kGrey = 0
  private kDusk = 0
  private palette: Pal = { ...DAY }

  private out = new Cells(0, 0)
  private columns = 0
  private rows = 0
  private tall = false
  private rng: Rng
  private seed: number

  // Motion.
  private t = 0
  private d = 0
  private v = 0
  private steep = 0
  private amp = 0
  private rate = (2 * Math.PI) / 60
  private phi = 0
  private moguls = 0
  private gates = 0
  // Air: height (pixels) and climb, and the kickers (distances where their lips are).
  private air = 0
  private vAir = 0
  private jumpAt = -1
  private lastKick = -1e9
  private kickX = 0
  private landed = 999
  // A wipe-out: 0 skiing, 1 down, 2 getting up.
  private fall = 0
  private fallT = 0

  // Layers.
  private pw = 0
  private ph = 0
  private pix = new Uint32Array(0)
  private bits = new Uint8Array(0)
  private dcol = new Uint32Array(0)
  /** Pixels the skiers drew this frame: their colors win in the cells they share. */
  private kit = new Uint8Array(0)
  private ground = new Float32Array(0)
  private q = new Int32Array(4)
  private fit: QuadFit = { mask: 0, fg: 0, bg: 0, spread: 0 }

  // Particles.
  private px = new Float32Array(PMAX)
  private py = new Float32Array(PMAX)
  private vx = new Float32Array(PMAX)
  private vy = new Float32Array(PMAX)
  private life = new Float32Array(PMAX)
  private maxLife = new Float32Array(PMAX)
  private r1 = new Float32Array(PMAX)
  private a0 = new Float32Array(PMAX)
  private kind = new Uint8Array(PMAX)
  private nextP = 0

  // Snowflakes, in dot coordinates.
  private fx = new Float32Array(FLAKES)
  private fy = new Float32Array(FLAKES)
  private fv = new Float32Array(FLAKES)
  private fp = new Float32Array(FLAKES)

  private skiers: Skier[] = []

  constructor(seed?: number) {
    this.seed = (seed ?? Date.now()) % 100_000
    this.rng = new Rng(this.seed * 2654435761 + 7)
    const offs = [0, 2.2, 4.1, 1.1, 3.3]
    const anchors = [0.28, 0.52, 0.12, 0.7, 0.86]
    const spineAnchors = [0.3, 0.62, 0.14, 0.82, 0.47]
    for (let i = 0; i < KITS.length; i++)
      this.skiers.push({
        kit: KITS[i]!,
        off: offs[i]!,
        anchor: anchors[i]!,
        track: new Float32Array(TRK * 2),
        head: 0,
        len: 0,
        lastD: -1e9,
        fx: 0,
        fy: 0,
        lat: 0,
      })
    this.spineAnchors = spineAnchors
  }

  private spineAnchors: number[]

  ensure(columns: number, rows: number): void {
    if (columns === this.columns && rows === this.rows) return
    this.columns = columns
    this.rows = rows
    this.out = new Cells(columns, rows)
    this.tall = rows > columns
    this.pw = columns * 2
    this.ph = rows * 2
    this.pix = new Uint32Array(this.pw * this.ph)
    this.bits = new Uint8Array(columns * rows)
    this.dcol = new Uint32Array(columns * rows)
    this.ground = new Float32Array(this.pw)
    for (const s of this.skiers) {
      s.len = 0
      s.lastD = -1e9
    }
    this.life.fill(0)
    for (let i = 0; i < FLAKES; i++) {
      this.fx[i] = this.rng.f() * this.pw
      this.fy[i] = this.rng.f() * this.ph * 2
      this.fv[i] = 0.12 + this.rng.f() * 0.25
      this.fp[i] = this.rng.f() * 6.283
    }
  }

  private get level(): number {
    return clamp(Math.round(this.strength), 0, 10)
  }

  /** This frame's palette: day, night, overcast and dusk blended by the eased weights. */
  private get pal(): Pal {
    if (this.kNight < 0) this.ease()
    return this.palette
  }

  /**
   * Ease night, the overcast (a failed command) and dusk (a nearly-full
   * context) toward the dials a little each frame, so the light changes
   * over a second or two instead of cutting; a fresh start begins as asked.
   */
  private ease(): void {
    const n = this.night ? 1 : 0
    const g = this.tint === 'smoke' ? 1 : 0
    const b = this.tint === 'blue' ? 1 : 0
    if (this.kNight < 0) {
      this.kNight = n
      this.kGrey = g
      this.kDusk = b
    }
    this.kNight = approach(this.kNight, n, 0.04)
    this.kGrey = approach(this.kGrey, g, 0.05)
    this.kDusk = approach(this.kDusk, b, 0.05)
    const p = this.palette
    for (const key of PAL_KEYS) {
      const clear = mix(DAY[key], NIGHT[key], this.kNight)
      const grey = mix(GREY[key], NIGHT_GREY[key], this.kNight)
      p[key] = mix(mix(clear, grey, this.kGrey), DUSK[key], this.kDusk)
    }
  }

  private extras(): number {
    return this.coverageBoost <= 0 ? 0 : Math.min(KITS.length - 1, Math.ceil(this.coverageBoost / 15))
  }

  // ------------------------------------------------------------ motion

  step(): void {
    if (this.columns === 0) return
    this.ease()
    this.t++
    const L = this.level
    if (L === 0) return
    // A failed command: down in a puff of snow until it's fixed, then up again.
    if (this.tint === 'smoke' && this.fall !== 1) {
      this.fall = 1
      this.fallT = 0
      this.wipeout()
    } else if (this.tint !== 'smoke' && this.fall === 1) {
      this.fall = 2
      this.fallT = 0
    }
    this.fallT++
    if (this.fall === 2 && this.fallT > GET_UP) this.fall = 0

    const vT = this.fall ? 0 : SPEED[L]!
    if (this.fall === 1) this.v *= 0.86
    else this.v += (vT - this.v) * (vT > this.v ? 0.022 : 0.04)
    if (this.v < 0.004) this.v = vT > 0 ? this.v : 0
    this.steep += (L / 10 - this.steep) * 0.03
    const moving = Math.min(1, this.v / 0.35)
    this.amp += (AMP[L]! * moving - this.amp) * 0.03
    this.rate += ((2 * Math.PI) / PERIOD[L]! - this.rate) * 0.05
    this.moguls += (MOGULS[L]! - this.moguls) * 0.02
    this.gates += (GATES[L]! - this.gates) * 0.02
    this.d += this.v
    if (!this.fall && this.air <= 0) this.phi += this.rate * moving

    // Air time off the kickers at full speed.
    this.landed++
    if (this.air > 0 || this.vAir > 0) {
      this.air += this.vAir
      this.vAir -= this.tall ? 0.045 : 0.05
      if (this.air <= 0) {
        this.air = 0
        this.vAir = 0
        this.landed = 0
        this.puff(14, 1)
      }
    } else if (this.jumpAt >= 0 && this.d >= this.jumpAt) {
      this.vAir = this.tall ? 0.62 : 0.5
      this.air = 0.01
      this.lastKick = this.jumpAt
      this.jumpAt = -1
      for (const s of this.skiers) this.breakTrack(s)
    } else if (L === 10 && !this.fall && this.jumpAt < 0 && this.landed > 75 && this.v > SPEED[9]!) {
      // A kicker far enough ahead to come into view.
      const ahead = this.tall ? (this.ph * 0.7 + 8) / SPINE : this.pw * 0.75 + 8
      this.jumpAt = this.d + ahead
      // Where the skier will be when they reach it.
      const frames = ahead / this.v
      this.kickX = this.amp * Math.sin(this.phi + this.rate * frames)
    }

    this.place()
    this.stepParticles()
    this.stepFlakes()
  }

  /** Each skier's feet this frame (layout coords), their tracks, and their spray. */
  private place(): void {
    const n = this.extras()
    const tall = this.tall
    for (let i = 0; i <= n; i++) {
      const s = this.skiers[i]!
      const lat = i === 0 && this.fall ? s.lat : this.amp * Math.sin(this.phi + s.off)
      s.lat = lat
      if (tall) {
        const half = this.room()
        s.fx = this.pw / 2 + lat * half
        s.fy = this.d * SPINE + Math.round(this.ph * (this.spineAnchors[i]! - this.spineAnchors[0]!))
      } else {
        const sx = this.anchorX(i)
        s.fx = this.d + sx
        s.fy = 0 // resolved against the ground at draw time
      }
      // Tracks: a point per half pixel travelled.
      const onGround = i !== 0 || (this.air <= 0 && !this.fall)
      if (onGround && this.v > 0.02 && this.d - s.lastD >= 0.5) {
        s.lastD = this.d
        let a: number
        let b: number
        if (tall) {
          a = s.fx
          b = s.fy
        } else {
          a = s.fx
          b = lat
        }
        s.track[s.head * 2] = a
        s.track[s.head * 2 + 1] = b
        s.head = (s.head + 1) % TRK
        s.len = Math.min(TRK, s.len + 1)
      }
      if (onGround) this.spray(s, i === 0 ? 1 : 0.55)
    }
  }

  private breakTrack(s: Skier): void {
    s.track[s.head * 2] = Number.NaN
    s.track[s.head * 2 + 1] = Number.NaN
    s.head = (s.head + 1) % TRK
    s.len = Math.min(TRK, s.len + 1)
  }

  /** The spine's half-width the skiers swing across, inside the forest. */
  private room(): number {
    return Math.max(2, this.pw / 2 - this.edgeW() - 3)
  }

  private edgeW(): number {
    return Math.max(3, Math.round(this.pw * 0.14))
  }

  private anchorX(i: number): number {
    const s = this.skiers[i]!
    const drift = i === 0 ? 0 : Math.sin(this.t * 0.007 * (1 + i * 0.3) + i) * this.pw * 0.03
    return Math.round(this.pw * s.anchor + drift)
  }

  private spawn(x: number, y: number, vx: number, vy: number, life: number, r1: number, a0: number, kind: number): void {
    const i = this.nextP
    this.nextP = (i + 1) % PMAX
    this.px[i] = x
    this.py[i] = y
    this.vx[i] = vx
    this.vy[i] = vy
    this.life[i] = life
    this.maxLife[i] = life
    this.r1[i] = r1
    this.a0[i] = a0
    this.kind[i] = kind
  }

  /** Spray off the edges: most at each turn's edge change, a powder cloud when it's deep. */
  private spray(s: Skier, k: number): void {
    const L = this.level
    if (this.v < 0.15) return
    const r = this.rng
    const edge = Math.pow(Math.abs(Math.sin(this.phi + s.off)), 6)
    const sp = this.v / SPEED[10]!
    const rate = SPRAY[L]! * (0.2 + 0.8 * edge) * k * Math.min(1, this.v / Math.max(0.3, SPEED[L]!))
    let n = Math.floor(rate)
    if (r.f() < rate - n) n++
    const deep = clamp((this.steep - 0.6) / 0.4, 0, 1)
    const out = Math.sign(s.lat) || 1
    for (let j = 0; j < n; j++) {
      const billow = r.f() < 0.12 + deep * 0.45
      if (this.tall) {
        const vS = this.v * SPINE
        if (billow)
          this.spawn(s.fx + (r.f() - 0.5) * 2, s.fy - 0.5, out * (0.15 + r.f() * 0.35), vS * (0.62 + r.f() * 0.25), 16 + r.f() * 22 * (0.5 + deep), 1.4 + deep * 2.6 + r.f(), 0.8, 1)
        else
          this.spawn(s.fx + out * 1.5, s.fy, out * (0.25 + r.f() * 0.9) + (r.f() - 0.5) * 0.3, vS * (0.15 + r.f() * 0.55), 8 + r.f() * 14, 0, 1, 0)
      } else {
        if (billow)
          this.spawn(s.fx - 1.5 - r.f() * 2, -1.5 - r.f(), this.v * (0.55 + r.f() * 0.25), -(0.08 + r.f() * 0.2) * (0.5 + deep), 18 + r.f() * 26 * (0.5 + deep), 1.5 + deep * 3.5 + sp + r.f(), 0.85, 1)
        else
          this.spawn(s.fx - 1 - r.f() * 2, -1, this.v * (0.3 + r.f() * 0.45), -(0.45 + r.f() * 0.7) * (0.6 + sp), 10 + r.f() * 14, 0, 1, 0)
      }
    }
  }

  /** A burst of snow at the hero's feet: a fall or a landing. */
  private puff(n: number, size: number): void {
    const r = this.rng
    const s = this.skiers[0]!
    for (let j = 0; j < n; j++) {
      const a = r.f() * Math.PI * 2
      const sp = 0.2 + r.f() * 0.6
      if (this.tall)
        this.spawn(s.fx + Math.cos(a) * 1.5, s.fy - 1, Math.cos(a) * sp, Math.sin(a) * sp * 0.4 + this.v * SPINE * 0.6, 20 + r.f() * 25, (1.5 + r.f() * 2.5) * size, 0.85, j % 3 === 0 ? 0 : 1)
      else
        this.spawn(s.fx + Math.cos(a) * 2, -1.5, Math.cos(a) * sp + this.v * 0.6, -Math.abs(Math.sin(a)) * sp * 0.4, 20 + r.f() * 25, (1.5 + r.f() * 2.2) * size, 0.85, j % 3 === 0 ? 0 : 1)
    }
  }

  private wipeout(): void {
    this.air = 0
    this.vAir = 0
    this.jumpAt = -1
    this.breakTrack(this.skiers[0]!)
    this.puff(30, 1.3)
  }

  private stepParticles(): void {
    const tall = this.tall
    for (let i = 0; i < PMAX; i++) {
      if (this.life[i]! <= 0) continue
      this.life[i]! -= 1
      this.px[i]! += this.vx[i]!
      this.py[i]! += this.vy[i]!
      if (this.kind[i] === 0) {
        if (tall) {
          this.vx[i]! *= 0.9
          this.vy[i]! *= 0.96
        } else {
          this.vy[i]! += 0.07
          this.vx[i]! *= 0.95
          if (this.py[i]! > 1.5) this.life[i] = 0
        }
      } else {
        // A billow of powder hangs in the air, slowly losing the skier's speed.
        this.vx[i]! *= tall ? 0.95 : 0.985
        this.vy[i]! *= tall ? 0.985 : 0.9
        if (!tall) this.vy[i]! += 0.004
      }
    }
  }

  private stepFlakes(): void {
    const W = this.pw
    const D = this.ph * 2
    const flurry = this.tint === 'smoke'
    // The flakes stream back past the skier: left in the band, up the spine.
    const drift = this.tall ? 0 : -this.v * 0.45
    const climb = this.tall ? -this.v * SPINE * 2 * 0.45 : 0
    for (let i = 0; i < FLAKES; i++) {
      const fall = this.fv[i]! * (flurry ? 2.2 : 1)
      this.fy[i]! += fall + climb
      this.fx[i]! += drift + Math.sin(this.t * 0.06 + this.fp[i]!) * 0.08 + (flurry ? 0.35 : 0)
      if (this.fy[i]! >= D) this.fy[i]! -= D
      if (this.fy[i]! < 0) this.fy[i]! += D
      if (this.fx[i]! >= W) this.fx[i]! -= W
      if (this.fx[i]! < 0) this.fx[i]! += W
    }
  }

  // ------------------------------------------------------------ drawing

  grid(): Cells {
    const out = this.out
    const n = this.columns * this.rows
    if (this.level <= 0 || n === 0) {
      for (let i = 0; i < n; i++) out.blank(i)
      return out
    }
    this.bits.fill(0)
    if (this.kit.length !== this.pw * this.ph) this.kit = new Uint8Array(this.pw * this.ph)
    else this.kit.fill(0)
    if (this.tall) this.drawSpine()
    else this.drawBand()
    this.drawFlakes()
    this.composite()
    return out
  }

  frame(): string {
    return this.grid().encode()
  }

  private put(x: number, y: number, c: number): void {
    x = Math.floor(x)
    y = Math.floor(y)
    if (x < 0 || y < 0 || x >= this.pw || y >= this.ph) return
    this.pix[y * this.pw + x] = c
  }

  private blend(x: number, y: number, c: number, a: number): void {
    x = Math.floor(x)
    y = Math.floor(y)
    if (x < 0 || y < 0 || x >= this.pw || y >= this.ph || a <= 0.02) return
    const k = y * this.pw + x
    this.pix[k] = mix(this.pix[k]!, c, a)
  }

  /** A braille dot at dot coords (one per pixel across, two per pixel down). */
  private dot(x: number, y: number, c: number): void {
    x = Math.floor(x)
    y = Math.floor(y)
    if (x < 0 || y < 0 || x >= this.pw || y >= this.ph * 2) return
    const cell = (y >> 2) * this.columns + (x >> 1)
    this.bits[cell]! |= BRAILLE[x & 1]![y & 3]!
    this.dcol[cell] = c
  }

  private dotLine(x0: number, y0: number, x1: number, y1: number, c: number): void {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)))
    if (n > 60) return
    for (let k = 0; k <= n; k++) {
      const f = n === 0 ? 0 : k / n
      this.dot(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, c)
    }
  }

  private sprite(s: Sprite, fx: number, fy: number, kit: (typeof KITS)[number], lean = 0, flip = false): void {
    const x0 = Math.round(fx) - (flip ? s.w - 1 - s.ax : s.ax)
    const y0 = Math.round(fy) - (s.h - 1)
    const shade = mix(kit.jacket, 0, 0.32)
    for (let r = 0; r < s.h; r++) {
      const row = s.rows[r]!
      const sh = r < 2 ? lean : 0
      for (let c = 0; c < s.w; c++) {
        const ch = row[flip ? s.w - 1 - c : c]!
        let col: number
        switch (ch) {
          case 'H':
            col = kit.hat
            break
          case 'F':
            col = SKIN
            break
          case 'R':
            col = kit.jacket
            break
          case 'r':
            col = shade
            break
          case 'P':
            col = kit.pants
            break
          case 'S':
            col = kit.skis
            break
          case 'p':
            col = POLE
            break
          default:
            continue
        }
        // In the band the skier is a few pixels tall: kept bright by night (a
        // shaded kit sinks into the dark snow); the spine has room to shade it.
        const px = x0 + c + sh
        const py = y0 + r
        this.put(px, py, this.tall ? mix(col, NIGHT_SHADE, 0.3 * this.kNight) : col)
        if (px >= 0 && py >= 0 && px < this.pw && py < this.ph) this.kit[py * this.pw + px] = 1
      }
    }
  }

  /** Billows (soft, shaded underneath) and specks (braille) of snow. */
  private drawParticles(toScreenX: (x: number) => number, toScreenY: (y: number, x: number) => number): void {
    const P = this.pal
    for (let i = 0; i < PMAX; i++) {
      const life = this.life[i]!
      if (life <= 0) continue
      const f = 1 - life / this.maxLife[i]!
      const x = toScreenX(this.px[i]!)
      const y = toScreenY(this.py[i]!, this.px[i]!)
      if (this.kind[i] === 0) {
        // Specks: white against the sky, blue-grey against the snow seen from above.
        if (f < 0.85) this.dot(x, y * 2, this.tall ? mix(P.track, P.spray, 0.25) : P.spray)
        continue
      }
      const rad = 0.6 + (this.r1[i]! - 0.6) * Math.sqrt(f)
      const a = this.a0[i]! * (1 - f * f)
      const rx = Math.ceil(rad)
      const ry = Math.ceil(rad / 2)
      const inv = 1 / (rad * rad)
      const cx = Math.round(x)
      const cy = Math.round(y)
      // Seen from above, a billow casts a soft shadow down-right on the snow.
      if (this.tall)
        for (let dy = -ry; dy <= ry; dy++)
          for (let dx = -rx; dx <= rx; dx++) {
            const d2 = (dx * dx + 4 * dy * dy) * inv
            if (d2 <= 1) this.blend(cx + dx + 1, cy + dy + 1, P.shadow, a * 0.3 * (1 - d2))
          }
      for (let dy = -ry; dy <= ry; dy++)
        for (let dx = -rx; dx <= rx; dx++) {
          const d2 = (dx * dx + 4 * dy * dy) * inv
          if (d2 > 1) continue
          this.blend(cx + dx, cy + dy, dy > 0 || dx > rx / 2 ? P.sprayShade : P.spray, a * (1 - 0.55 * d2))
        }
    }
  }

  private drawFlakes(): void {
    const L = this.level
    const flurry = this.tint === 'smoke'
    const want = flurry ? FLAKES : Math.round(Math.min(FLAKES, this.columns * this.rows * (L <= 1 ? 0.035 : 0.02)))
    const c = this.tall ? mix(this.pal.track, this.pal.flake, 0.4) : this.pal.flake
    for (let i = 0; i < want; i++) this.dot(this.fx[i]!, this.fy[i]!, c)
  }

  // ------------------------------------------------------------ the band (side view)

  private drawBand(): void {
    const P = this.pal
    const W = this.pw
    const H = this.ph
    const pix = this.pix
    const faceH = Math.max(2, Math.round(H * 0.3))
    const g0 = H - faceH
    const cam = this.d
    const sx0 = this.anchorX(0)
    const tilt = this.steep * Math.min(5, H * 0.45)
    const gr = this.ground
    const kick = this.jumpAt >= 0 ? this.jumpAt + sx0 : -1e9
    const kick2 = this.lastKick + sx0
    // Night: how dark, how much of the sky goes black (dusk keeps its glow), the moon.
    const night = this.kNight
    const bandBlack = 1 - this.kDusk
    const [mx, my] = moonPixel(this.columns, this.rows)

    // The slope's surface per column: tilted with the steepness, moguls, kickers.
    for (let x = 0; x < W; x++) {
      const wx = cam + x
      let s = g0 + (tilt * (x - sx0)) / W
      if (this.moguls > 0.01) {
        const m = Math.sin(wx * 0.42 + 3 * noise(wx * 0.03, 11))
        s -= this.moguls * 1.1 * m * m
      }
      for (const k of [kick, kick2]) {
        const u = k - wx
        if (u >= 0 && u < 12) s -= (2.4 * (12 - u)) / 12
      }
      gr[x] = s
    }

    // Sky, far peaks, the near hills and their pines, then the slope.
    const farX = cam * 0.06
    const hillX = cam * 0.3
    for (let x = 0; x < W; x++) {
      const fx = farX + x
      const ridge = noise(fx / 26, 1) * 0.62 + noise(fx / 9, 2) * 0.38
      const peak = H * 0.06 + H * 0.62 * (1 - ridge)
      const ridgeR = noise((fx + 1) / 26, 1) * 0.62 + noise((fx + 1) / 9, 2) * 0.38
      const lit = ridgeR <= ridge
      const cap = H * (0.1 + 0.12 * noise(fx / 7, 3))
      const hx = hillX + x
      const hill = g0 - 0.5 - H * 0.22 * noise(hx / 33, 4)
      // A pine on the near hills every few pixels.
      const slot = Math.floor(hx / 4)
      const pc = slot * 4 + 2
      const hasPine = hash(slot, 0, 5) < 0.4
      const ph = 1.5 + hash(slot, 1, 5) * 1.8
      const pineBase = g0 - 0.5 - H * 0.22 * noise(pc / 33, 4)
      const surf = gr[x]!
      for (let y = 0; y < H; y++) {
        const k = y * W + x
        if (y >= surf) {
          // The slope's face: lit at the lip, bluer below, mogul shadows on the far sides.
          const depth = (y - surf) / faceH
          let c = mix(P.snow, P.snowShade, clamp(depth * 0.6, 0, 1))
          if (this.moguls > 0.01) {
            const wx = cam + x
            const m = Math.cos(wx * 0.42 + 3 * noise(wx * 0.03, 11))
            if (m > 0.4 && y - surf < 1.5) c = mix(c, P.snowDeep, this.moguls * 0.5)
          }
          if (y - surf < 1 && y + 1 > surf) c = mix(P.snow, c, 0.5)
          pix[k] = c
          continue
        }
        let c = mix(P.skyTop, P.skyLow, y / Math.max(1, g0))
        // By night the band's sky is plain black but for the moon and the stars
        // (as surf's): in so few rows a glow reads as stripes.
        if (night > 0 && y < peak) c = mix(c, this.nightSky(mix(c, 0, bandBlack), x, y, Math.floor(fx), mx, my), night)
        if (y >= peak) {
          const inCap = y < peak + cap
          c = inCap ? (lit ? P.cap : P.capShade) : lit ? P.peak : P.peakShade
        }
        if (y >= hill) c = mix(P.hill, P.snowShade, clamp((y - hill) / 4, 0, 0.5))
        if (hasPine && y < pineBase + 0.5 && y >= pineBase - ph) {
          const tw = ((y - (pineBase - ph)) / ph) * 1.3 + 0.2
          if (Math.abs(hx - pc) <= tw) c = P.hillPine
        }
        // The surface's own row: a soft lip.
        if (y + 1 > surf) c = mix(c, P.snow, y + 1 - surf)
        pix[k] = c
      }
    }

    // The lift hut at the top of the run (where the skier starts).
    this.drawHut(sx0 - 16 - cam, gr)

    // Back row: pines along the slope's lip, gates, rocks.
    this.drawBandScenery(gr, false)
    this.drawKicker(kick - cam, gr)
    this.drawKicker(kick2 - cam, gr)

    // Tracks across the face, then the skiers (back to front by depth), then the snow they throw.
    const n = this.extras()
    for (let i = 0; i <= n; i++) this.bandTrack(this.skiers[i]!, gr, faceH)
    this.drawParticles(
      x => x - cam,
      (y, x) => {
        const sxp = clamp(Math.round(x - cam), 0, W - 1)
        return gr[sxp]! + 1 + y
      },
    )
    const order = [0, 1, 2, 3, 4].slice(0, n + 1).sort((a, b) => this.skiers[a]!.lat - this.skiers[b]!.lat)
    // Front row: a few big pines whipping past at speed. Drawn before the
    // skiers, so they pass behind them: crossing in front, a near-black pine
    // at night blinks the skier out and back again and again.
    this.drawBandScenery(gr, true)
    for (const i of order) this.bandSkier(i, gr, faceH)
  }

  private feetY(gr: Float32Array, x: number, lat: number, faceH: number): number {
    const sxp = clamp(Math.round(x), 0, this.pw - 1)
    return gr[sxp]! + 0.3 + ((lat + 1) / 2) * Math.max(0.5, faceH - 1.4)
  }

  private bandTrack(s: Skier, gr: Float32Array, faceH: number): void {
    const cam = this.d
    const c = this.pal.track
    let px = Number.NaN
    let py = Number.NaN
    for (let k = 1; k <= s.len; k++) {
      const j = (s.head - k + TRK) % TRK
      const wx = s.track[j * 2]!
      const lat = s.track[j * 2 + 1]!
      if (Number.isNaN(wx)) {
        px = Number.NaN
        continue
      }
      const x = wx - cam - 1
      if (x < -2) break
      if (x >= this.pw) continue
      const y = this.feetY(gr, x, lat, faceH) * 2 + 1
      if (!Number.isNaN(px)) this.dotLine(px, py, x, y, c)
      px = x
      py = y
    }
  }

  private bandSkier(i: number, gr: Float32Array, faceH: number): void {
    const s = this.skiers[i]!
    const x = 2 * Math.round((s.fx - this.d) / 2)
    const hero = i === 0
    const y = this.feetY(gr, x, s.lat, faceH)
    const air = hero ? this.air : 0
    if (air > 0.3) {
      // A little shadow on the snow below.
      for (let k = -2; k <= 3; k++) this.blend(x + k, y, this.pal.shadow, 0.55 - Math.abs(k - 0.5) * 0.08)
    }
    // Whole cells (two pixels) both ways, like x: a sprite straddling a cell
    // boundary gets its colors re-paired in every two-color cell each time it
    // bobs a pixel, and the kit seems to swap places (worst on the dark night snow).
    const fy = 2 * Math.round((y - air) / 2)
    if (hero && this.fall === 1 && this.fallT > 2) {
      this.sprite(B_DOWN, x, fy, s.kit)
      return
    }
    const fast = this.v > SPEED[8]! * 0.92
    const standing = this.v < 0.12 || (hero && this.fall === 2)
    let spr = standing ? B_STAND : fast ? B_TUCK : B_SKI
    // Leaning on the edge mid-turn.
    if (!standing && !fast && Math.abs(Math.cos(this.phi + s.off)) > 0.8) spr = B_CARVE
    this.sprite(spr, x, fy, s.kit)
    // Deep powder buries the skis.
    if (this.steep > 0.75 && air <= 0.3)
      for (let k = -2; k <= 4; k++) this.blend(x + k, fy, this.pal.spray, clamp((this.steep - 0.75) * 3, 0, 0.75))
  }

  private drawBandScenery(gr: Float32Array, front: boolean): void {
    const P = this.pal
    const W = this.pw
    const H = this.ph
    const L = this.level
    if (front) {
      if (L < 8) return
      // Big near pines (closer, so faster) at the highest levels.
      const par = 1.5
      const cam = this.d * par
      const span = 70
      for (let slot = Math.floor(cam / span) - 1; slot <= Math.floor((cam + W) / span) + 1; slot++) {
        if (hash(slot, 9, 21) > 0.12 * (L - 7)) continue
        const x = slot * span + hash(slot, 3, 21) * span - cam
        this.pine(x, H + 1, H * 0.85, true)
      }
      return
    }
    const cam = this.d
    const span = 13
    const dens = 0.22 + this.steep * 0.4
    for (let slot = Math.floor(cam / span) - 1; slot <= Math.floor((cam + W) / span) + 1; slot++) {
      const h1 = hash(slot, 0, 31)
      const x = slot * span + Math.floor(hash(slot, 1, 31) * (span - 4)) - cam
      const xi = Math.round(x)
      if (xi < -8 || xi > W + 8) continue
      const base = gr[clamp(xi, 0, W - 1)]!
      // Near the hut at the start the run is kept clear.
      if (slot * span < this.anchorX(0) + 4 && slot * span > this.anchorX(0) - 30) continue
      if (h1 < dens) {
        const ht = Math.min(H * 0.75, 3.5 + hash(slot, 2, 31) * (H * 0.45))
        this.pine(x, base + 0.6, ht, false)
      } else if (h1 < dens + this.gates * 0.5) {
        // A slalom gate: a pole and its flag, standing in the face.
        const red = slot & 1
        const y = Math.round(base + 1 + hash(slot, 4, 31))
        for (let k = 0; k < 3; k++) this.put(xi, y - k, red ? 0xe23b3b : 0x2f6fe0)
        this.put(xi + 1, y - 2, red ? 0xff4d4d : 0x3d82ff)
        this.put(xi + 1, y - 1, red ? 0xff4d4d : 0x3d82ff)
      } else if (h1 > 0.93) {
        // A rock poking out of the snow.
        const y = Math.round(base + 1 + hash(slot, 4, 31))
        this.put(xi, y, P.rock)
        this.put(xi + 1, y, P.rock)
        this.put(xi + 2, y, mix(P.rock, P.snowShade, 0.4))
        this.put(xi + 1, y - 1, P.snow)
      }
    }
  }

  /** A side-view pine: tiers of boughs, a lit left edge, snow on the tips, a trunk. */
  private pine(cx: number, base: number, ht: number, dark: boolean): void {
    const P = this.pal
    const top = base - ht
    const yb = Math.floor(base)
    const pine = dark ? mix(P.pine, 0x000000, 0.3) : P.pine
    for (let y = Math.floor(top); y < yb; y++) {
      const r = (y - top) / ht
      const tier = ((y - top) % 2.5) / 2.5
      const hw = r * ht * 0.42 + tier * 0.7
      const xa = Math.round(cx - hw)
      const xb = Math.round(cx + hw)
      for (let x = xa; x <= xb; x++) {
        let c = pine
        if (x === xa) c = tier > 0.5 ? P.pineSnow : P.pineLit
        else if (x - xa === 1 && !dark) c = P.pineLit
        this.put(x, y, c)
      }
    }
    this.put(Math.round(cx), yb, P.trunk)
  }

  private drawHut(x: number, gr: Float32Array): void {
    if (x < -10 || x > this.pw) return
    const P = this.pal
    const xi = Math.round(x)
    const base = Math.floor(gr[clamp(xi + 3, 0, this.pw - 1)]!)
    // Walls with a lit window, a snowy roof, a flag.
    for (let k = 0; k < 7; k++) {
      this.put(xi + k, base, P.hut)
      this.put(xi + k, base - 1, k === 2 || k === 4 ? P.window : P.hut)
    }
    for (let k = -1; k < 8; k++) this.put(xi + k, base - 2, P.roof)
    for (let k = 1; k < 6; k++) this.put(xi + k, base - 3, P.roof)
    for (let k = 3; k < 6; k++) this.put(xi + 8, base - k, POLE)
    this.put(xi + 9, base - 5, (this.t >> 2) & 1 ? 0xe8302c : 0xff5a3c)
  }

  /** A snow kicker: a ramp up to its lip, shadowed on the drop side. */
  private drawKicker(x: number, gr: Float32Array): void {
    if (x < -14 || x > this.pw + 2) return
    const P = this.pal
    const xi = Math.round(x)
    const W = this.pw
    // The ramp's lit face up to the lip, then the drop in shadow behind it.
    for (let u = 0; u < 12; u++) {
      const cx = xi - u
      if (cx < 0 || cx >= W) continue
      const top = gr[cx]!
      this.blend(cx, Math.floor(top), 0xffffff, 0.9)
      this.blend(cx, Math.floor(top) + 1, P.snowShade, 0.35)
    }
    const lipTop = gr[clamp(xi, 0, W - 1)]!
    const below = gr[clamp(xi + 3, 0, W - 1)]!
    for (let y = Math.floor(lipTop) + 1; y <= Math.ceil(below) + 1; y++) {
      this.blend(xi + 1, y, P.snowDeep, 0.8)
      this.blend(xi + 2, y, P.snowShade, 0.5)
    }
  }


  // ------------------------------------------------------------ the spine (three-quarter view)

  private drawSpine(): void {
    const P = this.pal
    const W = this.pw
    const H = this.ph
    const pix = this.pix
    const feet0 = Math.round(H * this.spineAnchors[0]!)
    const top = this.d * SPINE - feet0 // the world row at the grid's top
    const ew = this.edgeW()
    const deep = clamp((this.steep - 0.6) / 0.4, 0, 1)
    const mg = this.moguls

    // Sky above the summit, snow below, shaded by moguls and the lie of the land.
    for (let y = 0; y < H; y++) {
      const wy = top + y
      if (wy < -1) {
        this.summitRow(y, wy)
        continue
      }
      const el = ew + 2.2 * noise(wy / 17, 41) - 1
      const er = W - ew - 2.2 * noise(wy / 19, 42) + 1
      for (let x = 0; x < W; x++) {
        let c = mix(P.snow, P.snowShade, 0.15)
        // The snow's lie, drawn out down the fall line as the speed blurs it.
        const n = noise2(x / 7, wy / (10 + this.v * 9), 43)
        c = mix(c, P.snowShade, n * (0.35 + deep * 0.25))
        if (x < el || x >= er) c = mix(c, P.snowShade, 0.35)
        if (mg > 0.01) {
          // Moguls on a staggered grid: lit on the uphill-left, shadowed downhill-right.
          const row = Math.floor(wy / 6)
          const mx = ((x + (row & 1) * 3.5) % 7) - 3.5
          const my = (wy % 6) - 3
          const jit = hash(Math.floor((x + (row & 1) * 3.5) / 7), row, 44)
          if (jit < 0.75) {
            const r2 = (mx * mx) / 9 + (my * my) / 6
            if (r2 < 1) {
              const s = clamp((mx * 0.35 + my * 0.55) * (1 - r2) * 1.4, -1, 1)
              c = s > 0 ? mix(c, P.snowShade, mg * s * 0.9) : mix(c, 0xffffff, -s * mg * 0.7)
            }
          }
        }
        if (wy < 0.5) c = mix(c, P.snowShade, 0.35)
        pix[y * W + x] = c
      }
    }

    // Tracks, the scenery lying flat (gates, kickers), shadows; then upright things in depth order.
    const n = this.extras()
    for (let i = 0; i <= n; i++) this.spineTrack(this.skiers[i]!, top)
    this.spineFlat(top, ew)
    this.spineKicker(top)
    this.drawParticles(
      x => x,
      y => y - top,
    )

    // Trees and skiers drawn top to bottom, so lower ones stand in front.
    const toY = (wy: number) => wy - top
    const span = 4
    const s0 = Math.floor((top - 4) / span)
    const s1 = Math.floor((top + H + 12) / span)
    const order = [0, 1, 2, 3, 4].slice(0, n + 1).sort((a, b) => this.skiers[a]!.fy - this.skiers[b]!.fy)
    let next = 0
    for (let slot = s0; slot <= s1; slot++) {
      const wyBase = slot * span
      while (next < order.length && this.skiers[order[next]!]!.fy < wyBase) this.spineSkier(order[next++]!, top)
      if (wyBase < 1) continue
      for (let side = 0; side < 2; side++) {
        const h0 = hash(slot, side, 51)
        // The forest thickens toward the run at speed: trees whipping by.
        const inward = side === 0 ? 1 : -1
        const reach = ew + 1 + this.steep * 2
        const bx = side === 0 ? hash(slot, side + 4, 51) * reach - 1 : W - hash(slot, side + 4, 51) * reach + 1
        if (h0 < 0.85) this.spinePine(bx, toY(wyBase + hash(slot, side + 2, 51) * span), 5 + hash(slot, side + 6, 51) * 5, inward)
        // A lone pine further out on the run now and then.
        if (h0 > 0.97) this.spinePine(side === 0 ? ew + 3 : W - ew - 3, toY(wyBase), 6, inward)
      }
    }
    while (next < order.length) this.spineSkier(order[next++]!, top)

  }

  /** The view above the summit: sky and the far peaks. */
  private summitRow(y: number, wy: number): void {
    const P = this.pal
    const W = this.pw
    const sky = mix(P.skyTop, P.skyLow, clamp((wy + 18) / 17, 0, 1))
    const night = this.kNight
    const mx = moonPixel(this.columns, this.rows)[0]
    for (let x = 0; x < W; x++) {
      const ridge = noise(x / 11, 61) * 0.6 + noise(x / 4, 62) * 0.4
      const peak = -2 - 11 * ridge
      const ridgeR = noise((x + 1) / 11, 61) * 0.6 + noise((x + 1) / 4, 62) * 0.4
      let c = sky
      if (night > 0 && wy < peak) c = mix(c, this.nightSky(c, x, y, x, mx, y - wy - 14), night)
      if (wy >= peak) {
        const capped = wy < peak + 2.5 + 2 * noise(x / 5, 63)
        const lit = ridgeR <= ridge
        c = capped ? (lit ? P.cap : P.capShade) : lit ? P.peak : P.peakShade
      }
      this.pix[y * W + x] = c
    }
  }

  /**
   * A sky pixel by night: a star now and then (`sx` is its column on the
   * slowly scrolling sky; hidden by the overcast) and the moon, a small disc
   * at (mx, my), with a faint halo in the spine.
   */
  private nightSky(c: number, x: number, y: number, sx: number, mx: number, my: number): number {
    const r = moonRadius(this.tall)
    const moon = moonCover(x + 0.5, y + 0.5, mx, my, r)
    if (moon >= 1) return MOON
    if (this.tall) {
      const d = Math.hypot(x + 0.5 - mx, (y + 0.5 - my) * 2)
      if (d < r * 3) c = mix(c, MOON, 0.18 * (1 - d / (r * 3)))
    }
    if (hash(sx, y, 77) > 0.972) {
      const twinkle = 0.5 + 0.5 * hash(sx, y + (this.t >> 3), 78)
      c = mix(c, STAR, twinkle * (1 - this.kGrey))
    }
    return mix(c, MOON, moon)
  }

  private spineTrack(s: Skier, top: number): void {
    const c = this.pal.track
    let ax = Number.NaN
    let ay = Number.NaN
    for (let k = 1; k <= s.len; k++) {
      const j = (s.head - k + TRK) % TRK
      const x = s.track[j * 2]!
      const wy = s.track[j * 2 + 1]!
      if (Number.isNaN(x)) {
        ax = Number.NaN
        continue
      }
      const y = (wy - top) * 2
      if (y < -4) break
      if (!Number.isNaN(ax)) {
        this.dotLine(ax - 1, ay, x - 1, y, c)
        this.dotLine(ax + 1, ay, x + 1, y, c)
      }
      ax = x
      ay = y
    }
  }

  /** Slalom gates and piste markers. */
  private spineFlat(top: number, ew: number): void {
    const W = this.pw
    const H = this.ph
    const span = 16
    for (let slot = Math.floor(top / span) - 1; slot <= Math.floor((top + H) / span) + 1; slot++) {
      if (slot < 1) continue
      const y = Math.round(slot * span - top)
      // Orange piste markers down both edges.
      if (slot % 2 === 0) {
        for (const x of [ew + 1, W - ew - 2]) {
          this.put(x, y, 0xff8a1c)
          this.put(x, y - 1, 0xff8a1c)
        }
      }
      if (hash(slot, 0, 71) < this.gates * 1.6) {
        // A gate: two poles and a flag between, red or blue.
        const red = slot & 1
        const cx = Math.round(W / 2 + (hash(slot, 1, 71) - 0.5) * this.room() * 1.2)
        const col = red ? 0xe23b3b : 0x2f6fe0
        const lite = red ? 0xff6a5a : 0x5a9bff
        for (const x of [cx - 2, cx + 2]) {
          this.put(x, y, col)
          this.put(x, y - 1, col)
          this.put(x, y - 2, col)
        }
        for (let x = cx - 1; x <= cx + 1; x++) this.put(x, y - 2, lite)
        this.blend(cx + 3, y + 1, this.pal.shadow, 0.4)
      }
    }
  }

  private spineKicker(top: number): void {
    const P = this.pal
    for (const k of [this.jumpAt, this.lastKick]) {
      if (k < 0) continue
      const lip = k * SPINE - top
      if (lip < -2 || lip > this.ph + 8) continue
      const cx = this.pw / 2 + (k === this.jumpAt ? this.kickX : this.kickX) * this.room()
      // The ramp: lit and rising toward the lip, its drop in shadow below.
      for (let r = 0; r < 6; r++) {
        const y = Math.round(lip) - r
        const hw = 3 - r * 0.15
        for (let x = Math.round(cx - hw); x <= Math.round(cx + hw); x++)
          this.put(x, y, r === 0 ? 0xffffff : mix(P.snow, 0xffffff, 0.3 + (5 - r) * 0.1))
      }
      for (let x = Math.round(cx - 3); x <= Math.round(cx + 3); x++) {
        this.blend(x, Math.round(lip) + 1, P.shadow, 0.7)
        this.blend(x + 1, Math.round(lip) + 2, P.shadow, 0.35)
      }
    }
  }

  /** A pine seen from up the slope: a triangle of tiers with snow on it, a shadow downhill. */
  private spinePine(cx: number, base: number, ht: number, _inward: number): void {
    const P = this.pal
    if (base < -1 || base - ht > this.ph) return
    const yb = Math.round(base)
    // Shadow down and to the right.
    for (let k = 0; k < 4; k++) this.blend(cx + 1 + k, yb + 1, P.shadow, 0.45 - k * 0.08)
    const top = base - ht
    for (let y = Math.floor(top); y < yb; y++) {
      const r = (y - top) / ht
      const tier = ((y - top) % 3) / 3
      const hw = r * ht * 0.3 + tier * 0.8
      const xa = Math.round(cx - hw)
      const xb = Math.round(cx + hw)
      for (let x = xa; x <= xb; x++) {
        let c = P.pine
        if (x === xa) c = tier < 0.34 ? P.pineSnow : P.pineLit
        else if (x === xb) c = mix(P.pine, 0, 0.25)
        else if (tier < 0.34 && hash(x, y, 81) < 0.35) c = P.pineSnow
        this.put(x, y, c)
      }
    }
    this.put(Math.round(cx), yb, P.trunk)
  }

  private spineSkier(i: number, top: number): void {
    const s = this.skiers[i]!
    const P = this.pal
    const hero = i === 0
    const x = s.fx
    const yg = s.fy - top // feet on the snow
    const air = hero ? this.air : 0
    const y = yg - air
    if (y < -8 || y > this.ph + 6) return
    // Nobody stands in the sky above the summit.
    if (!hero && s.fy < 3) return
    if (air > 0.3) {
      for (let k = -2; k <= 2; k++) this.blend(x + k + Math.round(air * 0.4), yg, P.shadow, 0.6 - Math.abs(k) * 0.12)
    }
    if (hero && this.fall === 1 && this.fallT > 2) {
      // A yard sale: lying in the snow, skis crossed, a pole flung aside.
      this.sprite(S_DOWN, x, y, s.kit)
      this.skiLine(x - 1, y + 1, 0.9, s.kit.skis, 5)
      this.skiLine(x + 1, y + 1, -0.9, s.kit.skis, 5)
      for (let k = 0; k < 3; k++) this.put(x + 4 + k, y - 2 + (k >> 1), POLE)
      return
    }
    const standing = this.v < 0.12 || (hero && this.fall === 2)
    const fast = this.v > SPEED[8]! * 0.92
    // Heading: across the hill when stopped, else down the fall line swinging with the turns.
    const ph = this.phi + s.off
    const latV = this.amp * Math.cos(ph) * this.rate * this.room()
    const downV = Math.max(0.01, this.v * SPINE * 2)
    const head = standing ? Math.PI / 2 : Math.atan2(latV, downV)
    const dxs = Math.sin(head)
    const dys = Math.cos(head)
    const buried = this.steep > 0.75 && air <= 0.3
    // Skis: two parallel lines through the feet along the heading (half buried in powder).
    for (const side of [-1, 1]) {
      const gap = standing ? 0.5 : 1.1
      const ox = dys * side * gap
      const oy = -dxs * side * gap
      for (let t = standing ? -2.5 : -1.5; t <= (standing ? 2.5 : 2.5); t += 0.5) {
        const u = x + ox + dxs * t
        const v = (y + 0.5) * 2 + oy + dys * t
        if (buried && t > -1) continue
        this.put(u, v / 2, s.kit.skis)
      }
    }
    // Poles: planted beside them when stopped, trailing behind when skiing.
    if (standing) {
      for (let k = 1; k < 4; k++) {
        this.put(x - 2, y - k, POLE)
        this.put(x + 2, y - k, POLE)
      }
    } else if (!fast) {
      for (const side of [-1, 1]) {
        for (let t = 0; t < 3.5; t += 0.5) this.put(x + side * 2 - dxs * t * 0.6 + side * t * 0.2, y - 2 - (dys * t) / 2, POLE)
      }
    }
    const lean = standing ? 0 : Math.round(-s.lat * 1.2)
    this.sprite(fast ? S_TUCK : S_BODY, x, y - 1, s.kit, clamp(lean, -1, 1))
  }

  private skiLine(x: number, y: number, slope: number, c: number, len: number): void {
    for (let t = -len / 2; t <= len / 2; t += 0.5) this.put(x + t, y + t * slope * 0.5, c)
  }

  // ------------------------------------------------------------ compositing

  /** Each cell: plain (with braille on it if any) or the two colors that best fit its pixels. */
  private composite(): void {
    const out = this.out
    const w = this.columns
    const pw = this.pw
    const q = this.q
    const pix = this.pix
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < w; c++) {
        const cell = r * w + c
        const k0 = 2 * r * pw + 2 * c
        q[0] = pix[k0]!
        q[1] = pix[k0 + 1]!
        q[2] = pix[k0 + pw]!
        q[3] = pix[k0 + pw + 1]!
        const f = this.fit
        const kit = this.kit
        const keep = kit[k0] ? 0 : kit[k0 + 1] ? 1 : kit[k0 + pw] ? 2 : kit[k0 + pw + 1] ? 3 : -1
        fitQuad(q, f, undefined, keep)
        const b = this.bits[cell]!
        if (f.spread <= 150 || (b && f.spread <= 2600)) {
          const avg = mix(mix(q[0]!, q[1]!, 0.5), mix(q[2]!, q[3]!, 0.5), 0.5)
          if (b) out.set(cell, 0x2800 + b, this.dcol[cell]!, avg)
          else out.set(cell, 0x20, DEFAULT_COLOR, avg)
          continue
        }
        out.set(cell, QUAD[f.mask]!, f.fg, f.bg)
      }
  }
}
