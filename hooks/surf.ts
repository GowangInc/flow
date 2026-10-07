// REVISION: flow-v120-shared-noise
//
// Surf (the `surf` style): a surfer and the ocean on the same dials as the
// fire; the level is the swell. At 1 the sea is glassy under a dawn sky and
// the surfer sits on their board, bobbing on the ripples, waiting. As the
// level climbs the swell builds: the surfer paddles, pops up and rides; the
// waves grow taller, steeper and faster, crests spill white, spray blows off
// the lip, foam trails off the back, and the world (foam, clouds, the
// headland, gulls) streams past. By 8 it is big clean faces with the surfer
// carving top to bottom, snapping off the lip; at 10 the lip throws all the
// way over and the surfer crouches inside the barrel.
//
// The band is a side-on cross-section (the wave travels right, the camera
// rides with it; the set's following swells come in behind). A tall spine
// is the same wave seen up close: a towering concave face with sky above.
//
// Everything solid is painted into a 2x2-a-cell pixel layer and folded into
// quadrant glyphs with the two colors that best fit each cell; spray, foam
// fizz and sun glints are a braille dot layer on top. Subagents (the
// coverage boost) put more surfers in the line-up; smoke is a wipeout under
// a grey overcast sky; a nearly-full context turns the sea storm-blue and
// raises a red warning flag.

import { Cells, Rng, isTall } from './cells'
import type { Tint } from './styles'
import { MOON, moonPixel, moonRadius, NIGHT_HORIZON, NIGHT_ZENITH, STAR } from './night'
import { BRAILLE, clamp, fitQuad, g, grey, hash1 as hash, mix, noise1 as vnoise, QUAD, type QuadFit } from './pixels'
import { defineScene } from './scene-def'
import { hear, type Ambience, type SoundEvent } from './sound'

/** Pixels of water texture that stream past per frame at each level. */
const SPEED = [0, 0.05, 0.12, 0.22, 0.34, 0.48, 0.64, 0.82, 1.02, 1.26, 1.55]

const GULL_UP = g('v')
const GULL_DOWN = g('^')

type Palette = {
  skyTop: number
  skyHz: number
  sun: number
  sunGlow: number
  cloud: number
  cloudShade: number
  head: number
  seaTop: number
  seaDeep: number
  faceDeep: number
  faceLip: number
  back: number
  tube: number
  foam: number
  foamShade: number
  spray: number
}

const DAY: Palette = {
  skyTop: 0x2f7fd0,
  skyHz: 0xa9daf4,
  sun: 0xfff6d0,
  sunGlow: 0xffe39a,
  cloud: 0xf7fbff,
  cloudShade: 0xdbe8f3,
  head: 0x2f5a5a,
  seaTop: 0x1f8ab8,
  seaDeep: 0x0a2f5a,
  faceDeep: 0x0b4670,
  faceLip: 0x66d2ec,
  back: 0x2c96c4,
  tube: 0x123f66,
  foam: 0xf4fbff,
  foamShade: 0xbfe0ec,
  spray: 0xeaf7ff,
}
const DAWN = { skyTop: 0x5a86c8, skyHz: 0xf8c79c, sun: 0xfff0c8, sunGlow: 0xffb070, head: 0x6f7486 }
const OVERCAST = { skyTop: 0x6e7680, skyHz: 0xadb2b8, sun: 0xc8c8c4, sunGlow: 0xa8acb0, cloud: 0xc4c8cc, cloudShade: 0x8e949a, head: 0x5d6466 }
const STORM: Palette = {
  skyTop: 0x1b2540,
  skyHz: 0x4f6284,
  sun: 0x9fb0c8,
  sunGlow: 0x5a6c8a,
  cloud: 0x8090a8,
  cloudShade: 0x55627a,
  head: 0x2c3a4e,
  seaTop: 0x23517c,
  seaDeep: 0x07142c,
  faceDeep: 0x0b2346,
  faceLip: 0x6ea2b8,
  back: 0x2e5c86,
  tube: 0x10283c,
  foam: 0xdfe8f0,
  foamShade: 0x9fb2c4,
  spray: 0xd0dcea,
}

/**
 * By night: a moonlit sea under the near-black night sky every scene shares
 * (night.ts; the sun's disc is the moon, high up). The sea is a dark teal
 * and a moonlit rim runs along the water's surface, so the two never merge.
 */
const NIGHT: Palette = {
  skyTop: NIGHT_ZENITH,
  skyHz: NIGHT_HORIZON,
  sun: MOON,
  sunGlow: 0x2e3e60,
  cloud: 0x3a4660,
  cloudShade: 0x232c42,
  head: 0x080c18,
  seaTop: 0x0a2c3c,
  seaDeep: 0x010610,
  faceDeep: 0x041a28,
  faceLip: 0x2f7c8e,
  back: 0x0f3e52,
  tube: 0x03121c,
  foam: 0xc8d8e8,
  foamShade: 0x6c84a0,
  spray: 0xb8cce0,
}
/** What the surfers and their kit lean toward by night. */
const NIGHT_SHADE = 0x0a1428
/** Moonlight caught along the top of the water by night: the line between sea and sky. */
const MOON_RIM = 0x4a7c94
/** The band's sea by night: one even teal under the black sky (darkening a little with depth). */
const BAND_SEA = 0x0c3448

const SKIN = 0xe9b48a
const SUIT = 0x16181e
const BOARD = 0xf5c842
const STRIPE = 0xe2513a
const EXTRA_SUITS = [0x8a2424, 0x203f86, 0x2f6a35, 0x6a4320, 0x5a2a72]
const EXTRA_BOARDS = [0xf3f3ee, 0x4fc3f7, 0xff8a65, 0xa5d6a7, 0xf48fb1]
const FLAG = 0xe5302a
const POLE = 0xdedede

/**
 * The surfer, facing right: rows above the board, top first. h = head,
 * w = wetsuit; anything else lets the scene through. Each pose has a small
 * cut (the band) and a large one (the spine).
 */
const SPRITES = {
  sit: [
    ['  hh  ', '  ww  ', '  ww  '],
    ['  hh  ', '  hh  ', ' wwww ', ' wwww ', '  ww  '],
  ],
  paddle: [['wwwwhh'], ['    hh', 'wwwwhh']],
  ride: [
    ['  hh  ', ' wwww ', '  ww  '],
    ['  hh  ', '  hh  ', ' wwwww', 'w ww  ', '  ww  ', ' w  w ', 'w    w'],
  ],
  crouch: [
    ['    hh', '  www ', '  ww  '],
    ['    hh', '  wwhh', ' wwww ', 'ww  w ', 'w   w '],
  ],
} as const
type Pose = keyof typeof SPRITES

const PMAX = 480
/** Set pixels in each quadrant mask. */
const BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4]

export class Surf {
  strength = 8
  coverageBoost = 0
  sounds: SoundEvent[] = []
  /** The frame the next wave's sound comes in on. */
  private nextWave = 0
  tint: Tint = 'normal'
  /** Night: the moon instead of the sun, stars, and moonlight on the water. */
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
  private scroll = 0
  private kGrey = 0
  private kStorm = 0
  private kNight = 0
  private pal: Palette = { ...DAY }

  // Pixel layer (2x2 a cell) and per-cell overlays.
  private pw = 0
  private ph = 0
  private pc = new Int32Array(0)
  private water = new Uint8Array(0)
  private surf = new Float32Array(0)
  private dots = new Uint8Array(0)
  private dotColor = new Int32Array(0)
  private solid = new Uint8Array(0)
  private dominant = new Int32Array(0)
  private quad = new Int32Array(4)
  private fit: QuadFit = { mask: 0, fg: 0, bg: 0, spread: 0 }

  // Wave geometry (pixels), refreshed by layout().
  private vertical = false
  private seaY = 0
  private cx = 0
  private H = 0
  private Wf = 1
  private Wb = 1
  private pow = 1
  private steep = 0
  private curl = 0
  private crestY = 0
  private ex = 0
  private ey = 0
  private rx = 1
  private ry = 1
  private phiEnd = 0
  private fx = new Float32Array(2)
  private fH = new Float32Array(2)
  private fW = new Float32Array(2)
  private nF = 0

  // The surfer.
  private phase = 0
  private u = 0.5
  private du = 0
  private wipe = 0
  private recover = 0
  private lastTint: Tint = 'normal'
  private boardX = 0
  private boardY = 0
  private boardVX = 0
  private boardVY = 0
  private boardSpin = 0

  // Particles (spray, splash, glints), in pixels.
  private px = new Float32Array(PMAX)
  private py = new Float32Array(PMAX)
  private vx = new Float32Array(PMAX)
  private vy = new Float32Array(PMAX)
  private life = new Float32Array(PMAX)
  private kind = new Uint8Array(PMAX)
  private nextP = 0

  // Scenery in world pixels.
  private gulls: { x: number; y: number; ph: number; v: number }[] = []
  private clouds: { x: number; y: number; w: number; h: number }[] = []

  constructor(seed?: number) {
    this.seed = (seed ?? Date.now()) % 100_000
    this.rng = new Rng(this.seed + 17)
  }

  ensure(columns: number, rows: number): void {
    if (columns === this.columns && rows === this.rows) return
    this.columns = columns
    this.rows = rows
    this.out = new Cells(columns, rows)
    this.vertical = isTall(columns, rows)
    this.pw = columns * 2
    this.ph = rows * 2
    const n = this.pw * this.ph
    this.pc = new Int32Array(n)
    this.water = new Uint8Array(n)
    this.surf = new Float32Array(this.pw)
    this.dots = new Uint8Array(columns * rows)
    this.dotColor = new Int32Array(columns * rows)
    this.solid = new Uint8Array(columns * rows)
    this.dominant = new Int32Array(columns * rows)
    this.life.fill(0)
    const ng = this.vertical ? 3 : Math.max(2, Math.round(columns / 45))
    this.gulls = Array.from({ length: ng }, (_, i) => ({
      x: hash(this.seed + i * 13) * this.pw,
      y: hash(this.seed + i * 13 + 1),
      ph: hash(this.seed + i * 13 + 2) * 6.28,
      v: 0.04 + hash(this.seed + i * 13 + 3) * 0.08,
    }))
    const nc = this.vertical ? 3 : Math.max(2, Math.round(columns / 40))
    this.clouds = Array.from({ length: nc }, (_, i) => ({
      x: hash(this.seed + i * 29 + 5) * (this.pw + 40),
      y: hash(this.seed + i * 29 + 6),
      w: this.vertical ? 5 + hash(this.seed + i * 29 + 7) * 6 : 6 + hash(this.seed + i * 29 + 7) * 14,
      h: this.vertical ? 1.6 + hash(this.seed + i * 29 + 8) * 1.6 : 0.6 + hash(this.seed + i * 29 + 8) * 0.4,
    }))
  }

  private get level(): number {
    return Math.max(0, Math.min(10, this.strength))
  }

  /** The wave's shape for the current (eased) swell. */
  private layout(): void {
    const s = this.s
    const pw = this.pw
    const ph = this.ph
    const e = Math.pow(clamp((s - 1.2) / 8.8), 1.1)
    this.steep = clamp((s - 2.5) / 6)
    this.pow = 1.3 + 0.12 * s
    this.curl = clamp((s - 9) / 0.9)
    if (this.vertical) {
      this.seaY = ph * (0.56 + 0.036 * s)
      this.H = Math.max(0.3, (this.seaY - ph * 0.2) * e)
      this.cx = pw * 0.3
      this.Wf = Math.min(pw - this.cx + 3, this.H * (2.4 - 0.12 * s) + 4)
      this.Wb = this.H * 3 + 8
      this.nF = 0
    } else {
      this.seaY = ph * (0.52 + 0.033 * s)
      this.H = Math.max(0.3, (this.seaY - 0.7) * e)
      this.cx = pw * (pw > 200 ? 0.6 : 0.55)
      this.Wf = this.H * 3.2 + 2
      this.Wb = this.H * 7 + 8
      const span = Math.max(pw * 0.3, this.Wb + this.Wf + 30)
      this.nF = 0
      for (let i = 0; i < 2; i++) {
        const x = this.cx - span * (i + 1) * (1 - i * 0.12)
        const h = this.H * (i === 0 ? 0.6 : 0.4)
        const w = h * 6 + 8
        if (x - w * 0.5 < 0) break
        this.fx[i] = x
        this.fH[i] = h
        this.fW[i] = w
        this.nF++
      }
    }
    this.crestY = this.seaY - this.H
    const c = this.curl
    this.ry = Math.max(1, this.H * (0.22 + 0.22 * c))
    this.rx = Math.max(1, this.vertical ? this.Wf * (0.3 + 0.2 * c) : Math.max(this.Wf * 0.4, this.ry * 2.6))
    this.ex = this.cx + this.rx * 0.95
    this.ey = this.crestY + this.ry
    this.phiEnd = -90 + c * 135
  }

  /** The main wave's height above sea level at pixel column x (center), and which side. */
  private mainHump(x: number): number {
    const d = x - this.cx
    const H = this.H
    if (d < 0) {
      const u = -d / this.Wb
      return u < 1 ? H * (0.5 + 0.5 * Math.cos(Math.PI * u)) : 0
    }
    const u = d / this.Wf
    if (u < 1) {
      const hc = H * (0.5 + 0.5 * Math.cos(Math.PI * u))
      const hp = H * Math.pow(1 - u, this.pow)
      return hc + (hp - hc) * this.steep
    }
    if (u < 1.5) return -H * 0.1 * this.steep * Math.sin((Math.PI * (u - 1)) / 0.5)
    return 0
  }

  private ripple(x: number): number {
    const wx = x + this.scroll
    const t = this.t
    const a = this.vertical ? 0.5 + 0.06 * this.s : 0.3 + 0.04 * this.s
    return a * (0.6 * Math.sin(wx * 0.23 + t * 0.09) + 0.4 * Math.sin(wx * 0.083 - t * 0.05))
  }

  /** Water surface (pixel row) at column center x, the hood over a barrel ignored. */
  private surfaceAt(x: number): number {
    let h = this.mainHump(x)
    for (let i = 0; i < this.nF; i++) {
      const d = x - this.fx[i]!
      const w = d < 0 ? this.fW[i]! : this.fW[i]! * 0.7
      if (Math.abs(d) < w) h = Math.max(h, this.fH[i]! * (0.5 + 0.5 * Math.cos((Math.PI * d) / w)))
    }
    return this.seaY - h + this.ripple(x) * (1 - clamp(Math.abs(h) / 2))
  }

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

  ambience(): Ambience {
    return { swell: this.s / 10, curl: this.curl }
  }

  step(): void {
    if (this.columns === 0) return
    const level = this.level
    // A wave coming in: about every 12 s on a calm sea, every 5.5 s on a big one (as measured at real
    // beaches), never on a beat: each one sets the next at random around that.
    if (this.s >= 1 && this.t >= this.nextWave) {
      if (this.nextWave > 0) hear(this.sounds, { kind: this.s < 4 ? 'lap' : 'crash', v: this.s / 10 })
      this.nextWave = this.t + Math.round((12.6 - 0.7 * this.s) * 14 * (0.6 + 0.8 * this.rng.f()))
    }
    if (!this.started) {
      this.s = level
      this.speed = SPEED[level]!
      this.kGrey = this.tint === 'smoke' ? 1 : 0
      this.kStorm = this.tint === 'blue' ? 1 : 0
      this.kNight = this.night ? 1 : 0
      this.started = true
    }
    this.t++
    this.s += (level - this.s) * 0.035
    const lo = Math.floor(this.s)
    const sp = SPEED[lo]! + ((SPEED[Math.min(10, lo + 1)] ?? 0) - SPEED[lo]!) * (this.s - lo)
    this.speed += (sp - this.speed) * 0.1
    this.scroll += this.speed * (this.vertical ? 1.4 : 1)
    this.kGrey += ((this.tint === 'smoke' ? 1 : 0) - this.kGrey) * 0.05
    this.kStorm += ((this.tint === 'blue' ? 1 : 0) - this.kStorm) * 0.05
    this.kNight += ((this.night ? 1 : 0) - this.kNight) * 0.04
    if (level <= 0) return
    this.layout()

    // Wipeout when a command fails.
    if (this.tint === 'smoke' && this.lastTint !== 'smoke' && this.wipe === 0) this.startWipeout()
    this.lastTint = this.tint
    if (this.wipe > 0 && ++this.wipe > 46) {
      this.wipe = 0
      this.recover = 34
    } else if (this.recover > 0) this.recover--

    // The surfer's line on the face.
    const s = this.s
    const omega = 0.035 + 0.011 * s
    this.phase += omega
    const inTube = this.curl > 0.55
    const amp = inTube ? 0.05 : clamp(0.08 + 0.04 * (s - 3), 0.06, 0.36)
    const mid = inTube ? 0.4 : 0.52
    const nu = mid - amp * Math.cos(this.phase)
    const ndu = nu - this.u
    // Snapping off the top: a fan of spray from the tail.
    const k = this.vertical ? 1.6 : 1
    if (this.du < 0 && ndu >= 0 && s >= 5 && !inTube && this.wipe === 0) {
      const x = this.cx + this.u * this.Wf
      const y = this.surfaceAt(x)
      const n = Math.round((s - 3) * 2.5 * k)
      for (let i = 0; i < n; i++)
        this.emit(x, y - 1, (-0.2 - this.rng.f() * 0.9) * k, (-0.25 - this.rng.f() * 0.5) * k, 8 + this.rng.f() * 10, 0)
    }
    this.u = nu
    this.du = ndu

    // Spray blown back off the lip.
    if (s >= 5.5) {
      const n = (s - 5) * 0.7 * k
      const whole = Math.floor(n) + (this.rng.f() < n - Math.floor(n) ? 1 : 0)
      for (let i = 0; i < whole; i++) {
        const x = (this.curl > 0 ? this.ex : this.cx) + (this.rng.f() - 0.6) * 2 * k
        const y = this.crestY + this.rng.f() * 0.6
        this.emit(x, y, (-0.3 - this.rng.f() * (0.4 + s * 0.09)) * k, (-0.08 - this.rng.f() * 0.3) * k, 8 + this.rng.f() * 14, 0)
      }
    }
    // The pitching lip: falling curtain at its tip and an explosion where it lands.
    if (this.curl > 0.3) {
      const a = (this.phiEnd * Math.PI) / 180
      const tx = this.ex + this.rx * Math.cos(a)
      const ty = this.ey + this.ry * Math.sin(a)
      for (let i = 0; i < 2 * k; i++) this.emit(tx + (this.rng.f() - 0.5), ty, (this.rng.f() - 0.3) * 0.4, 0.15 + this.rng.f() * 0.3, 6 + this.rng.f() * 6, 0)
      const bx = this.ex + this.rx * (0.9 + this.rng.f() * 0.6)
      for (let i = 0; i < 3 * k * this.curl; i++)
        this.emit(bx + this.rng.f() * 3 * k, this.seaY - 0.5, (0.1 + this.rng.f() * 0.8) * k, (-0.3 - this.rng.f() * 0.8) * k, 6 + this.rng.f() * 10, 0)
    }
    // White water churning at the foot of a breaking face.
    if (s >= 6.5) {
      const n = (s - 6) * 0.6 * k
      for (let i = 0; i < n; i++) {
        const x = this.cx + this.Wf * (0.75 + this.rng.f() * 0.5)
        this.emit(x, this.seaY - this.rng.f(), (this.rng.f() - 0.3) * 0.5, -0.1 - this.rng.f() * 0.4 * k, 4 + this.rng.f() * 8, 1)
      }
    }
    // Paddling: little splashes off the hands.
    const pose = this.pose()
    if (pose === 'paddle' && this.t % 5 === 0) {
      const sx = this.surferX()
      this.emit(sx + (this.vertical ? 4 : 1.5) + this.rng.f(), this.surfaceAt(sx) - 0.3, 0.1, -0.25, 5, 1)
    }
    // Sun glints on calm water.
    if (s < 4.5) {
      const n = (4.5 - s) * 0.5 * (this.vertical ? 1 : this.pw / 120)
      for (let i = 0; i < n; i++) {
        const x = this.sunX() + (this.rng.f() - 0.5) * (this.vertical ? 14 : 30)
        const y = this.surfaceAt(x) + 0.3 + this.rng.f() * (this.vertical ? 4 : 1.6)
        this.emit(x, y, 0, 0, 2 + this.rng.f() * 3, 2)
      }
    }
    // Move particles.
    for (let i = 0; i < PMAX; i++) {
      if (this.life[i]! <= 0) continue
      this.life[i]! -= 1
      if (this.kind[i] === 2) continue
      this.px[i]! += this.vx[i]!
      this.py[i]! += this.vy[i]!
      this.vy[i]! += 0.04
      this.vx[i]! *= 0.97
    }
    // The tumbling board.
    if (this.wipe > 0) {
      this.boardX += this.boardVX
      this.boardY += this.boardVY
      this.boardVY += 0.07 * k
      this.boardSpin += 0.45
      const floor = this.surfaceAt(this.boardX) - 0.5
      if (this.boardY > floor) {
        this.boardY = floor
        this.boardVY = -this.boardVY * 0.3
        this.boardVX *= 0.6
        this.boardSpin *= 0.5
      }
    }
  }

  private startWipeout(): void {
    this.wipe = 1
    const k = this.vertical ? 1.6 : 1
    const x = this.surferX()
    const y = this.surfaceAt(x)
    this.boardX = x
    this.boardY = y - 1
    this.boardVX = -0.35 * k
    this.boardVY = -0.9 * k
    this.boardSpin = 0
    for (let i = 0; i < 40 * k; i++) {
      const a = Math.PI * (1 + this.rng.f())
      const v = (0.3 + this.rng.f() * 0.9) * k
      this.emit(x, y - 0.5, Math.cos(a) * v, Math.sin(a) * v * 1.2, 10 + this.rng.f() * 16, 0)
    }
  }

  private pose(): Pose {
    if (this.recover > 0) return 'paddle'
    if (this.s < 1.7) return 'sit'
    if (this.s < 2.7) return 'paddle'
    return this.curl > 0.55 ? 'crouch' : 'ride'
  }

  private surferX(): number {
    const pose = this.pose()
    if (pose === 'sit') return this.cx
    if (pose === 'paddle') return this.cx + this.Wf * 0.45
    return this.cx + this.u * this.Wf
  }

  /** The sun's column by day, easing over to the moon's (night.ts) by night. */
  private sunX(): number {
    const day = this.vertical ? this.pw * 0.74 : this.pw * 0.85
    return day + (moonPixel(this.columns, this.rows)[0] - day) * this.kNight
  }

  private updatePalette(): void {
    const p = this.pal
    const dawn = clamp((4 - this.s) / 3)
    const keys = Object.keys(DAY) as (keyof Palette)[]
    for (const key of keys) {
      let c = DAY[key]
      const d = (DAWN as Partial<Palette>)[key]
      if (d !== undefined) c = mix(c, d, dawn)
      c = mix(c, STORM[key], this.kStorm)
      c = mix(c, NIGHT[key], this.kNight)
      const o = (OVERCAST as Partial<Palette>)[key]
      if (o !== undefined) c = mix(c, o, this.kGrey)
      else c = grey(c, this.kGrey * 0.55)
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
    this.layout()
    this.updatePalette()
    this.paintScene()
    this.paintFlag()
    this.paintExtras()
    this.paintSurfer()
    this.composite()
    this.overlayDots()
    this.overlayGulls()
    return out
  }

  /** Sky, sun, clouds, headland, sea and the waves into the pixel layer. */
  private paintScene(): void {
    this.paintWorld()
    // The pitching lip pours down as a curtain from its tip to the water.
    if (this.curl > 0.5) {
      const a = (this.phiEnd * Math.PI) / 180
      const tx = this.ex + this.rx * Math.cos(a)
      const ty = this.ey + this.ry * Math.sin(a)
      const bottom = this.seaY
      for (let y = Math.floor(ty); y < bottom; y++) {
        const f = (y - ty) / Math.max(1, bottom - ty)
        const x = tx + f * this.rx * 0.25
        const xi = Math.floor(x)
        if (xi < 0 || xi >= this.pw || y < 0 || y >= this.ph) continue
        const k = y * this.pw + xi
        this.pc[k] = mix(this.pal.faceLip, this.pal.foam, 0.3 + 0.5 * f)
        if (this.vertical && xi + 1 < this.pw) this.pc[k + 1] = mix(this.pc[k + 1]!, this.pal.foamShade, 0.6)
      }
    }
  }

  private paintWorld(): void {
    const pw = this.pw
    const ph = this.ph
    const P = this.pal
    const s = this.s
    const vertical = this.vertical
    const seaY = this.seaY
    const t = this.t
    // Sun.
    // By night the moon hangs high where every scene's moon does, about a cell across.
    const kNight = this.kNight
    const sunX = this.sunX()
    const daySunY = vertical ? ph * (0.36 - 0.022 * s) : Math.max(1.2, seaY - 1.6 - (s - 1) * 0.5)
    const sunY = daySunY + (moonPixel(this.columns, this.rows)[1] - daySunY) * kNight
    const sunR = (vertical ? 2.6 : 1.3) + (moonRadius(vertical) / 2 - (vertical ? 2.6 : 1.3)) * kNight
    const glowR = 9 - 4 * kNight
    const bandNight = vertical ? 0 : kNight
    // Headland: one hazy ridge far off, drifting slowly.
    const headScroll = this.scroll * 0.06 + this.seed
    const headMax = vertical ? 5 : Math.max(1.2, ph * 0.24)
    const foamAmt = clamp((s - 3.5) / 4)
    const spill = clamp((s - 4.2) / 3) * (1 - this.curl) * 0.4
    const curl = this.curl
    const cx = this.cx
    for (let x = 0; x < pw; x++) {
      const xc = x + 0.5
      const surf = this.surfaceAt(xc)
      this.surf[x] = surf
      // Which wave owns this column, for shading.
      const mh = this.mainHump(xc)
      let waveH = this.H
      let hump = mh
      let face = xc > cx
      for (let i = 0; i < this.nF; i++) {
        const d = xc - this.fx[i]!
        const fw = d < 0 ? this.fW[i]! : this.fW[i]! * 0.7
        if (Math.abs(d) < fw) {
          const fh = this.fH[i]! * (0.5 + 0.5 * Math.cos((Math.PI * d) / fw))
          if (fh > hump) {
            hump = fh
            waveH = this.fH[i]!
            face = d > 0
          }
        }
      }
      const isMain = waveH === this.H
      const hood = curl > 0 && xc >= cx && xc <= this.ex ? this.crestY : 1e9
      const headH = this.headland(x + headScroll, headMax)
      const wx = x + this.scroll
      for (let y = 0; y < ph; y++) {
        const k = y * pw + x
        const yc = y + 0.5
        // Sky.
        let c = mix(P.skyTop, P.skyHz, clamp(y / Math.max(1, seaY)))
        const sd = Math.hypot(xc - sunX, (yc - sunY) * 2)
        if (sd < glowR) c = mix(c, P.sunGlow, (1 - sd / glowR) * (1 - sd / glowR) * 0.55 * (1 - this.kGrey * 0.6))
        let star = 0
        if (sd < sunR * 2) c = mix(c, P.sun, clamp(sunR * 2 - sd) * (1 - this.kGrey * 0.75))
        else if (kNight > 0.05 && yc < seaY - 1) {
          // Stars, drifting slowly with the swell, fading toward the horizon.
          const sx = Math.floor(x + this.scroll * 0.02)
          if (hash(sx * 7919 + y * 104729 + this.seed) > 0.985) {
            const twinkle = 0.55 + 0.45 * hash(sx * 31 + y * 17 + (t >> 3))
            star = twinkle * (1 - clamp(yc / seaY) * 0.7) * (1 - this.kGrey)
            c = mix(c, STAR, kNight * star)
          }
        }
        for (let i = 0; i < this.clouds.length; i++) {
          const cl = this.clouds[i]!
          const span = pw + 40
          const cxp = (((cl.x - this.scroll * 0.15 - t * 0.01) % span) + span) % span - 20
          const cy = vertical ? 2 + cl.y * ph * 0.22 : 0.7 + cl.y * Math.max(0.3, seaY * 0.35)
          const dx = (xc - cxp) / cl.w
          const dy = (yc - cy) / cl.h
          const r = dx * dx + dy * dy
          if (r < 1) c = mix(c, yc > cy ? P.cloudShade : P.cloud, clamp((1 - r) * 2.5) * (1 - this.kStorm * 0.3))
        }
        if (yc < seaY && yc > seaY - headH) c = mix(P.head, c, yc < seaY - headH + 1 ? 0.45 : 0.25)
        // In the band by night the sky is plain black but for the moon and the
        // stars: in so few rows its glow, clouds and headland read as stripes.
        if (bandNight > 0.01) {
          let k = 0x000000
          if (sd < sunR * 2) k = mix(k, P.sun, clamp(sunR * 2 - sd))
          else if (star > 0) k = mix(k, STAR, star)
          c = mix(c, k, bandNight)
        }
        // Water.
        let wet = clamp(y + 1 - surf)
        let inTube = false
        let lip = 0
        if (curl > 0 && isMain && Math.abs(xc - this.ex) < this.rx + 1 && yc < seaY + 1) {
          const dx = (xc - this.ex) / this.rx
          const dy = (yc - this.ey) / this.ry
          const r = Math.sqrt(dx * dx + dy * dy)
          const phi = (Math.atan2(dy, dx) * 180) / Math.PI
          if (r < 1.02) {
            const prog = clamp((phi + 180) / (this.phiEnd + 180))
            const ca = Math.cos((phi * Math.PI) / 180)
            const sa = Math.sin((phi * Math.PI) / 180)
            const R = Math.hypot(this.rx * ca, 2 * this.ry * sa)
            const th = ((vertical ? 5 : 2.6) * (1 - 0.45 * prog) * (0.6 + 0.4 * curl)) / R
            if (phi <= this.phiEnd && r > 1 - th && r < 1 && (yc < surf || phi > -140)) lip = 1
            else if (yc < surf && r < 1) inTube = true
          } else if (yc >= hood) wet = 1
        } else if (yc >= hood && yc < surf) wet = clamp(y + 1 - hood)
        if (lip) {
          // The lip: lit through, pale green-blue; frothing at the tip.
          const dyc = (yc - this.ey) / this.ry
          c = mix(P.faceLip, P.foam, clamp(0.25 + dyc * 0.5) * 0.7)
          if (bandNight > 0.01) c = mix(c, mix(BAND_SEA, MOON_RIM, 0.45), 0.7 * bandNight)
          this.water[k] = 1
        } else if (inTube) {
          const dx = (xc - this.ex) / this.rx
          const dy = (yc - this.ey) / this.ry
          // Light comes in through the open end: shadowed at the back of
          // the curl, close to the face's own color toward the mouth.
          const lit = clamp((dx + dy) * 0.4 + 0.55)
          c = mix(mix(P.tube, P.seaTop, 0.4), mix(P.seaTop, P.faceLip, 0.5), lit * 0.8)
          if (bandNight > 0.01) c = mix(c, mix(BAND_SEA, P.seaDeep, 0.3), 0.7 * bandNight)
          this.water[k] = 0
        } else if (wet > 0) {
          const hf = (seaY - yc) / Math.max(0.5, waveH)
          let wc: number
          if (hump > 0.4 && hf > 0) {
            if (!isMain) wc = mix(P.seaTop, face ? P.faceLip : P.back, clamp(hf) * (face ? 0.45 : 0.8))
            else {
              // Ease from the back into the face over a few pixels past the
              // crest, so the face never starts as a hard-edged dark block.
              const backC = mix(P.seaTop, P.back, clamp(hf))
              const faceC = mix(mix(P.faceDeep, P.seaTop, 0.45), P.faceLip, Math.pow(clamp(hf), 1.25))
              const fk = clamp((xc - cx) / (vertical ? Math.max(4, this.Wf * 0.45) : 5) + 0.35)
              wc = mix(backC, faceC, fk)
              // The barrel's shadow fades out ahead of it rather than stopping on a line.
              if (curl > 0) {
                const ahead = clamp((this.ex + this.rx - xc) / Math.max(2, this.rx * 0.8))
                wc = mix(wc, P.tube, 0.28 * curl * ahead * fk)
              }
            }
          } else {
            wc = mix(P.seaTop, P.seaDeep, clamp(((yc - seaY) / Math.max(2, ph - seaY)) * 1.1))
          }
          if (bandNight > 0.01) {
            const even = mix(BAND_SEA, P.seaDeep, clamp((yc - surf) / Math.max(2, ph - surf)) * 0.35)
            wc = mix(wc, even, 0.85 * bandNight)
          }
          const depth = yc - surf
          if (depth < 1) wc = mix(wc, P.foamShade, hump > 0.4 && hf > 0.5 ? 0.18 + 0.4 * clamp(hf - 0.5) : 0.18 * (1 - kNight))
          // Moonlight along the crests, strongest on the tallest faces; on a calm
          // sea only a faint line, or the swell reads as dark blocks on a bright stripe.
          if (depth < 1 && kNight > 0.05) wc = mix(wc, MOON_RIM, kNight * (0.1 + 0.4 * clamp(hf * 1.6 - 0.2)))
          // Streaky texture that travels with the water.
          const tn = hash(Math.floor((wx + y * 3) * (vertical ? 0.5 : 0.34)) * 131 + y)
          // (Faded by night, when it reads as blocks on the dark water.)
          if (tn > 0.86) wc = mix(wc, P.foamShade, 0.12 * (1 - 0.8 * kNight))
          else if (tn < 0.1) wc = mix(wc, P.seaDeep, 0.12 * (1 - 0.8 * kNight))
          // Foam: trailing off the back, spilling down the crest.
          if (depth < 1.6 && depth > -1) {
            if (isMain && face === false && hump < 0.35 * this.H + 1 && foamAmt > 0) {
              const dd = (cx - xc) / (this.Wb * 1.4 + 10)
              const fn = vnoise(wx * (vertical ? 0.4 : 0.22), 99) * 0.7 + vnoise(wx * 0.9 + t * 0.05, 7) * 0.3
              if (dd < 1 && fn < foamAmt * (1 - dd) * 0.75) wc = mix(wc, depth < 0.8 ? P.foam : P.foamShade, 0.9)
            } else if (!isMain && hump > 0.4 && foamAmt > 0.5 && hf > 0.8) {
              wc = mix(wc, P.foamShade, 0.5)
            }
          }
          if (isMain && face && spill > 0 && hf > 1 - spill && depth < 2.2) {
            const fl = vnoise(wx * 0.5 + y * 1.7 - t * 0.12, 31)
            if (fl < 0.6) wc = mix(wc, fl < 0.4 ? P.foam : P.foamShade, 0.9)
          }
          // White water boiling at the foot of a big face.
          if (isMain && s > 6.5 && xc > cx + this.Wf * 0.7 && xc < cx + this.Wf * (1.15 + 0.15 * curl)) {
            const top = seaY - (s - 6.2) * (vertical ? 1.4 : 0.35) * (1 + curl)
            if (yc > top && yc < seaY + (vertical ? 3 : 1)) {
              const fl = vnoise(x * 0.45 + t * 0.21, 53 + y) * 0.75 + hash(x * 17 + y * 113 + t * 31) * 0.25
              if (fl < 0.62) wc = mix(wc, fl < 0.4 ? P.foam : P.foamShade, 0.9)
            }
          }
          // A path of moonlight across the water under the moon.
          if (kNight > 0.05 && yc > seaY) {
            const gd = Math.abs(xc - sunX) / (1.5 + (yc - seaY) * (vertical ? 0.5 : 1.6))
            if (gd < 1 && hash(Math.floor(wx * 0.8) * 31 + y * 977 + (t >> 2)) > 0.45 + gd * 0.45)
              wc = mix(wc, P.sun, 0.6 * kNight * (1 - gd))
          }
          c = mix(c, wc, wet)
          this.water[k] = wet > 0.5 ? 1 : 0
        } else {
          this.water[k] = 0
        }
        this.pc[k] = c
      }
    }
  }

  /** Distant headlands and islands: a few humps strung out along the horizon. */
  private headland(wx: number, max: number): number {
    const sp = this.vertical ? 70 : 150
    const seg = Math.floor(wx / sp)
    let best = 0
    for (let k = seg - 1; k <= seg + 1; k++) {
      if (hash(k * 41 + this.seed) < 0.45) continue
      const w = sp * (0.1 + 0.2 * hash(k * 43 + this.seed))
      const c = k * sp + sp * 0.5 + (hash(k * 47 + this.seed) - 0.5) * sp * 0.4
      const d = (wx - c) / w
      if (d <= -1 || d >= 1) continue
      // A cliff on one side, a long slope down the other.
      const shape = d < 0 ? Math.sqrt(1 - d * d) : 1 - d * d
      best = Math.max(best, max * (0.55 + 0.45 * hash(k * 53 + this.seed)) * shape)
    }
    return best
  }

  private put(x: number, y: number, c: number): void {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    if (xi < 0 || yi < 0 || xi >= this.pw || yi >= this.ph) return
    this.pc[yi * this.pw + xi] = this.kNight > 0.01 ? mix(c, NIGHT_SHADE, 0.4 * this.kNight) : c
    this.solid[(yi >> 1) * this.columns + (xi >> 1)] = 1
  }

  /** A board: a line centered at (x, y) along the slope, nose (facing) highlighted. */
  private board(x: number, y: number, slope: number, half: number, facing: number, color: number): void {
    // Work in screen units where a pixel is 1 wide and 2 tall.
    const sx = 1
    const sy = slope * 2
    const n = Math.hypot(sx, sy)
    const c = sx / n
    const sn = sy / n
    const steps = Math.ceil(half * 4)
    for (let i = -steps; i <= steps; i++) {
      const k = (i / steps) * half
      const nose = k * facing > half * 0.55
      this.put(x + k * c, y + (k * sn) / 2, nose ? STRIPE : color)
    }
  }

  private sprite(pose: Pose, large: boolean, x: number, y: number, facing: number, suit: number): void {
    const rows = SPRITES[pose][large ? 1 : 0]
    const width = Math.max(...rows.map(r => r.length))
    // Snapped so the head fills whole cells: three colors never share one.
    const x0 = 2 * Math.round((x - width / 2) / 2)
    const yb = Math.floor(y)
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!
      const py = yb - (rows.length - r)
      for (let c = 0; c < row.length; c++) {
        const ch = row[c]
        if (ch !== 'h' && ch !== 'w') continue
        const pxl = facing > 0 ? x0 + c : x0 + width - 1 - c
        this.put(pxl, py, ch === 'h' ? SKIN : suit)
      }
    }
  }

  private paintSurfer(): void {
    const large = this.vertical && this.ph >= 32
    const half = large ? 5 : 2.6
    if (this.wipe > 0) {
      this.board(this.boardX, this.boardY, Math.tan(this.boardSpin), half, 1, BOARD)
      return
    }
    const pose = this.pose()
    const x = this.surferX()
    const surf = this.surfaceAt(x)
    const lim = this.vertical ? 0.7 : 0.12
    const slope = clamp((this.surfaceAt(x + 1) - this.surfaceAt(x - 1)) / 2, -lim, lim)
    const bob = pose === 'sit' ? Math.sin(this.t * 0.12) * 0.35 : 0
    const by = (Math.floor(surf - 0.6 + bob) | 1) + 0.5
    const flat = pose === 'sit' || pose === 'paddle'
    const facing = flat || this.du >= 0 || this.s < 5 ? 1 : -1
    this.board(x, by, flat ? slope * 0.5 : slope, half, facing, BOARD)
    const lean = !flat && large ? -slope * 0.8 : 0
    this.sprite(pose, large, x + lean, by, facing, SUIT)
  }

  /** Subagents: more surfers in the line-up. */
  private paintExtras(): void {
    const n = Math.min(5, Math.round(this.coverageBoost / 12))
    if (n === 0) return
    let slot = 0
    for (let i = 0; i < n; i++) {
      let x: number
      let pose: Pose = 'sit'
      if (!this.vertical && i < this.nF && this.s >= 3) {
        const u = 0.35 + 0.2 * Math.sin(this.phase * 0.8 + i * 2.1)
        x = this.fx[i]! + u * this.fW[i]! * 0.7
        pose = 'ride'
      } else if (this.vertical) {
        x = 3 + slot * 6
        slot++
        if (x > this.cx - 6) break
      } else {
        x = this.cx + this.Wf * 1.6 + 10 + slot * 14 + hash(slot * 3 + 1) * 10
        if (x > this.pw - 4) x = this.cx - this.Wb - 6 - (x - this.pw) * 1.0
        slot++
        if (x < 3) break
        pose = this.s >= 2 ? 'paddle' : 'sit'
      }
      const surf = this.surfaceAt(x)
      const slope = (this.surfaceAt(x + 1) - this.surfaceAt(x - 1)) / 2
      const by = (Math.floor(surf - 0.6 + (pose === 'sit' ? Math.sin(this.t * 0.11 + i * 1.7) * 0.3 : 0)) | 1) + 0.5
      this.board(x, by, pose === 'ride' ? slope : slope * 0.5, 2.4, 1, EXTRA_BOARDS[i]!)
      this.sprite(pose, false, x, by, 1, EXTRA_SUITS[i]!)
    }
  }

  /** A nearly-full context: a red warning flag on a buoy. */
  private paintFlag(): void {
    if (this.kStorm < 0.35) return
    const x = Math.floor(this.vertical ? this.pw * 0.1 : this.pw * 0.94)
    const surf = this.surfaceAt(x + 0.5)
    const base = Math.floor(surf)
    const tall = this.vertical ? 7 : Math.max(3, Math.min(5, Math.round(this.seaY * 0.6)))
    this.put(x, base, 0xf07a1a)
    this.put(x + 1, base, 0xf07a1a)
    for (let k = 1; k <= tall; k++) this.put(x, base - k, POLE)
    const wave = (this.t >> 2) & 1
    const fw = this.vertical ? 4 : 3
    const fh = this.vertical ? 3 : 2
    for (let r = 0; r < fh; r++)
      for (let c = 1; c <= fw - (r === fh - 1 && wave ? 1 : 0); c++) this.put(x + c, base - tall + r + (c > 2 && wave ? 1 : 0), FLAG)
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
      fitQuad(q, f)
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

  /** Spray, fizz and glints as braille dots over the cells they fall in. */
  private overlayDots(): void {
    const w = this.columns
    const h = this.rows
    this.dots.fill(0)
    for (let i = 0; i < PMAX; i++) {
      if (this.life[i]! <= 0) continue
      const x = this.px[i]!
      const y = this.py[i]!
      if (x < 0 || y < 0 || x >= this.pw || y >= this.ph) continue
      const col = (x / 2) | 0
      const row = (y / 2) | 0
      const cell = row * w + col
      if (this.solid[cell]) continue
      const dc = Math.floor(x) - col * 2
      const dr = Math.min(3, Math.floor((y - row * 2) * 2))
      if (this.dots[cell] === 0) {
        const kd = this.kind[i]!
        this.dotColor[cell] = kd === 2 ? mix(this.pal.sun, 0xffffff, 0.4) : kd === 1 ? this.pal.foam : this.pal.spray
      }
      this.dots[cell]! |= BRAILLE[dc]![dr]!
    }
    for (let cell = 0; cell < w * h; cell++) {
      if (this.dots[cell]) this.out.set(cell, 0x2800 + this.dots[cell]!, this.dotColor[cell]!, this.dominant[cell]!)
      this.solid[cell] = 0
    }
  }

  private overlayGulls(): void {
    const pw = this.pw
    const span = pw + 20
    const top = this.vertical ? this.ph * 0.05 : 0
    const bottom = Math.max(top + 1, (this.vertical ? Math.min(this.crestY, this.seaY) - 3 : this.seaY - 1.5))
    for (const gl of this.gulls) {
      const x = ((((gl.x - this.scroll * 0.35 - this.t * gl.v) % span) + span) % span) - 10
      const y = top + gl.y * (bottom - top) + Math.sin(this.t * 0.05 + gl.ph) * 0.6
      if (x < 0 || x >= pw || y < 0 || y >= this.ph) continue
      const k = Math.floor(y) * pw + Math.floor(x)
      if (this.water[k]) continue
      const cell = (Math.floor(y) >> 1) * this.columns + (Math.floor(x) >> 1)
      if (this.dots[cell]) continue
      const up = Math.sin(this.t * 0.35 + gl.ph) > 0
      const col = this.kStorm > 0.5 ? 0xd8dde6 : 0x2a3340
      this.out.set(cell, up ? GULL_UP : GULL_DOWN, col, this.dominant[cell]!)
    }
  }

  frame(): string {
    return this.grid().encode()
  }
}

export const surfScene = defineScene({
  name: 'surf',
  aliases: ['ocean', 'sea'],
  blurb: 'a surfer and the swell',
  night: true,
  make: seed => new Surf(seed),
})
