// REVISION: flow-v61-names
//
// Bubbles (the `bubbles` style): a glass of fizz on the same dials as the
// fire; the level is the fizz. At 1 a couple of airstones let lazy bubbles
// drift up through still water. As the level climbs more streams open, the
// bubbles come faster and bigger, wobbling side to side, swelling as they
// rise and catching a white glint up-left, and each one pops at the surface
// with a ripple and a little splash of droplets. By 10 the whole width is a
// rolling, fizzing boil.
//
// Everything is braille dots (2x4 a cell, so the dots sit square and a
// bubble reads round): a bubble is a ring once it's big enough, a dot or a
// speck before. White bubbles in blue water: the water fills the band,
// lighter up by the surface and deeper toward the bottom, with slow swells
// along it, and a head of foam fizzing along the top (thicker as it gets
// busier), heaving where bubbles burst. Subagents (the coverage boost) open more streams; smoke
// stirs a cloud of sediment up off the bottom and turns the water murky; a
// nearly-full context runs the water cold, a deep indigo welling up from below.
// By night it's a stout: near-black liquid with pale tan bubbles rising, and a
// creamy line of head at the top.

import { Cells, Rng } from './cells'
import type { Tint } from './styles'
import { BRAILLE, clamp, hash1, mix } from './pixels'

/** The surface's rest height, in dots from the top: room above for the splash. */
const SURFACE = 2
/** Bubbles in flight, droplets and sediment at most: a boil in a 250-wide band. */
const MAX_BUBBLES = 700
const MAX_DROPS = 400
const MAX_SILT = 900

/** Rise, in dots a frame, at each level (a tall spine scales it up). */
const RISE = [0, 0.16, 0.24, 0.32, 0.42, 0.52, 0.62, 0.72, 0.82, 0.92, 1.02]
/** Streams per 100 dots of width at each level. */
const STREAMS = [0, 0.8, 1.4, 2.2, 3, 3.8, 4.7, 5.8, 7.2, 9.5, 12.5]
/** Bubbles a stream lets go per frame at each level. */
const RATE = [0, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15]

/** A bubble's color by brightness, deep (0) to the glint (1): pale blue-white to white. */
const WATER = [0x7fb4e4, 0xa8cff0, 0xcfe4f8, 0xeef6fe, 0xffffff]
const MURK = [0x6a7068, 0x868b80, 0xa3a69a, 0xc2c3b8, 0xdedfd6]
const COLD = [0x6f86d8, 0x95a8e6, 0xbac8f2, 0xdde5fa, 0xf6f8ff]
const SILT = [0x4a3f30, 0x6b5c45, 0x8c7a5c]
/** The water: up by the surface, and down at the bottom. */
const WATER_TOP = 0x2f86d0
const WATER_BOTTOM = 0x14468e
/** By night: a stout, near-black with a hint of brown, its bubbles pale tan up to cream. */
const STOUT_TOP = 0x1c140d
const STOUT_BOTTOM = 0x070504
const TAN = [0x5e4630, 0x84694c, 0xab9070, 0xd2bc98, 0xf2e6cc]
/** The water by smoke (murky) and by a nearly-full context (cold), at the same two depths. */
const MURK_TOP = 0x4c6670
const MURK_BOTTOM = 0x2c3c3e
const COLD_TOP = 0x26357e
const COLD_BOTTOM = 0x0c1238
/** Brightness steps, so the frame holds few distinct colors. */
const STEPS = 12

type Bubble = { x: number; y: number; bx: number; r: number; r0: number; vy: number; ph: number; fq: number }
type Stream = { x: number; life: number; rate: number; wait: number }
type Drop = { x: number; y: number; vx: number; vy: number }
type Silt = { x: number; y: number; vy: number; ph: number; life: number }
type Ripple = { x: number; age: number; amp: number }

/** A ramp's color at brightness `b` (0..1), quantized to STEPS. */
function ramp(stops: readonly number[], b: number): number {
  const v = (Math.round(clamp(b) * STEPS) / STEPS) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(v))
  return mix(stops[i]!, stops[i + 1]!, v - i)
}

export class Bubbles {
  strength = 8
  coverageBoost = 0
  tint: Tint = 'normal'
  /** Night: a stout instead of water. */
  night = false
  private columns = 0
  private rows = 0
  private out = new Cells(0, 0)
  private rng: Rng
  /** Where the foam's fizz pattern starts (the seed as an integer). */
  private seedN: number
  private t = 0
  /** A fresh glass (new, or resized) starts full of bubbles, not empty. */
  private fresh = true

  // Eased dials.
  private s = 0
  private kMurk = 0
  private kCold = 0
  /** Night, eased; -1 until the first step, which starts it as asked. */
  private kNight = -1

  private bubbles: Bubble[] = []
  private streams: Stream[] = []
  private drops: Drop[] = []
  private silt: Silt[] = []
  private ripples: Ripple[] = []

  // Per-frame buffers, reused: braille bits and each cell's brightest dot.
  private bits = new Uint8Array(0)
  private lum = new Float32Array(0)
  /** What lit each cell's brightest dot: 0 bubble, 1 surface, 2 silt. */
  private kind = new Uint8Array(0)

  constructor(seed?: number) {
    this.rng = new Rng(seed)
    this.seedN = (seed ?? 0) | 0
  }

  ensure(columns: number, rows: number): void {
    if (columns === this.columns && rows === this.rows) return
    this.columns = columns
    this.rows = rows
    this.out = new Cells(columns, rows)
    this.bits = new Uint8Array(columns * rows)
    this.lum = new Float32Array(columns * rows)
    this.kind = new Uint8Array(columns * rows)
    this.bubbles = []
    this.streams = []
    this.drops = []
    this.silt = []
    this.ripples = []
    this.fresh = true
  }

  /** Width and height in dots. */
  private get W(): number {
    return this.columns * 2
  }

  private get H(): number {
    return this.rows * 4
  }

  /** Rise speed now: a tall spine's column is deeper, so bubbles cross it a bit quicker. */
  private rise(): number {
    return this.at(RISE) * Math.pow(Math.max(1, this.H / 20), 0.35)
  }

  /** The level's table value, read between whole levels. */
  private at(table: readonly number[]): number {
    const lo = Math.floor(this.s)
    return table[lo]! + (table[Math.min(10, lo + 1)]! - table[lo]!) * (this.s - lo)
  }

  /** An airstone somewhere along the bottom, clear of the others where there's room. */
  private newStream(): Stream {
    let x = 0
    for (let tries = 0; tries < 6; tries++) {
      x = 2 + this.rng.f() * (this.W - 4)
      if (this.streams.every((o) => Math.abs(o.x - x) > 5)) break
    }
    // Airstones live ~3-12 s, then bubble up somewhere else.
    return { x, life: 40 + this.rng.f() * 130, rate: 0.6 + this.rng.f() * 0.8, wait: 0 }
  }

  /** A bubble let go at dot x, height y (just under the bottom); fizz is a fast speck. */
  private emit(x: number, y: number, fizz: boolean): Bubble | undefined {
    if (this.bubbles.length >= MAX_BUBBLES) return undefined
    const s = this.s
    // Bigger at higher levels: specks at 1, fat bubbles in a boil.
    const big = fizz ? 0 : this.rng.f() * this.rng.f()
    const r0 = fizz ? 0.3 : 0.55 + big * (0.3 + s * 0.12) + s * 0.03
    const b: Bubble = {
      x,
      y,
      bx: x,
      r: r0,
      r0,
      vy: (fizz ? 1.3 : 0.75 + 0.3 * this.rng.f()) * this.rise() * (1 + r0 * 0.15),
      ph: this.rng.f() * 6.283,
      fq: 0.12 + this.rng.f() * 0.14,
    }
    this.bubbles.push(b)
    return b
  }

  step(): void {
    const W = this.W
    const H = this.H
    if (W === 0 || H === 0) return
    const target = clamp(this.strength, 0, 10)
    if (target <= 0) {
      // Off is off: the glass empties at once. Back on, it fizzes up from
      // the bottom as the level eases in.
      this.s = 0
      this.bubbles.length = this.drops.length = this.silt.length = this.ripples.length = 0
      this.streams.length = 0
      return
    }
    if (this.fresh) this.s = target
    // Ease the level, the murk and the cold: a change takes a second or two.
    this.s += clamp(target - this.s, -0.06, 0.06)
    this.kMurk += clamp((this.tint === 'smoke' ? 1 : 0) - this.kMurk, -0.05, 0.05)
    this.kCold += clamp((this.tint === 'blue' ? 1 : 0) - this.kCold, -0.04, 0.04)
    if (this.kNight < 0) this.kNight = this.night ? 1 : 0
    this.kNight += clamp((this.night ? 1 : 0) - this.kNight, -0.04, 0.04)
    if (this.fresh) {
      // Begin mid-fizz, not with an empty glass: run the column full once.
      this.fresh = false
      const n = Math.min(600, Math.ceil(H / Math.max(0.1, this.rise())))
      for (let i = 0; i < n; i++) this.advance()
      return
    }
    this.advance()
  }

  /** One frame of the simulation. */
  private advance(): void {
    const W = this.W
    const H = this.H
    const s = this.s
    const rise = this.rise()
    this.t++

    // Streams: as many as the level and the subagents ask for, opened and
    // closed one at a time so a change of level fades in.
    const tall = H > W ? 1.8 : 1
    const want = Math.max(s < 1.5 ? 2 : 3, Math.round((W / 100) * tall * this.at(STREAMS) * (1 + this.coverageBoost / 30)))
    if (this.streams.length < want && (this.t & 3) === 0) this.streams.push(this.newStream())
    if (this.streams.length > want && (this.t & 3) === 0) this.streams.pop()
    const rate = this.at(RATE)
    for (let i = 0; i < this.streams.length; i++) {
      const st = this.streams[i]!
      if (--st.life <= 0) this.streams[i] = this.newStream()
      else if (--st.wait <= 0 && this.rng.f() < rate * st.rate) {
        // The next one waits until this one's clear (at the size it will
        // swell to), so a stream is a string of bubbles, not a solid column.
        const b = this.emit(st.x + (this.rng.f() - 0.5) * 1.2, H + 1, false)
        if (b) st.wait = (b.r0 * (1.6 + s * 0.06) * 2 + 1.5) / b.vy
      }
    }
    // From 5 up, fizz rises from everywhere along the bottom; in a boil, fat
    // bubbles too.
    const fizz = (W / 100) * Math.max(0, s - 4.5) * 0.35
    for (let n = fizz; n > 0; n--) if (this.rng.f() < n) this.emit(this.rng.f() * W, H + 1, true)
    if (s > 8) for (let n = (W / 100) * (s - 8) * 0.6; n > 0; n--) if (this.rng.f() < n) this.emit(this.rng.f() * W, H + 2, false)

    // Rise, swell, wobble; pop at the surface.
    const surf = SURFACE
    let live = 0
    for (const b of this.bubbles) {
      b.y -= b.vy
      b.vy = Math.min(rise * 1.5, b.vy * 1.003)
      // Swell as the pressure drops: the farther up, the bigger, to a cap.
      const up = clamp((H - b.y) / Math.max(20, H))
      b.r = Math.min(1.2 + s * 0.2, b.r0 * (1 + up * (0.6 + s * 0.06)))
      // A boil rolls: base positions drift; every bubble wobbles, more as it grows.
      if (s > 6) b.bx += Math.sin(b.y * 0.07 + this.t * 0.03 + b.ph) * (s - 6) * 0.03
      b.x = b.bx + Math.sin(b.ph + this.t * b.fq) * (0.15 + b.r * 0.35)
      if (b.y - b.r > surf) {
        this.bubbles[live++] = b
        continue
      }
      this.pop(b)
    }
    this.bubbles.length = live

    // Droplets fly up and fall back into the surface.
    live = 0
    for (const d of this.drops) {
      d.x += d.vx
      d.y += d.vy
      d.vy += 0.09
      if (d.y < surf + 0.5 && d.x >= 0 && d.x < W) this.drops[live++] = d
    }
    this.drops.length = live

    // Ripples spread and fade.
    live = 0
    for (const rp of this.ripples) {
      rp.age++
      rp.amp *= 0.93
      if (rp.amp > 0.08) this.ripples[live++] = rp
    }
    this.ripples.length = live

    // Smoke: sediment billows up off the bottom in a few puffs (each moving
    // on every ~6 s) and hangs low, swirling, settling.
    if (this.kMurk > 0.05) {
      const puffs = Math.max(1, Math.round(W / 70))
      const n = (W / 100) * 1.6 * this.kMurk
      for (let k = n; k > 0; k--) {
        if (this.rng.f() >= k || this.silt.length >= MAX_SILT) continue
        const j = (this.rng.f() * puffs) | 0
        const cx = W * hash1(j * 31 + Math.floor((this.t + j * 37) / 90))
        this.silt.push({
          x: cx + (this.rng.f() + this.rng.f() - 1) * 8,
          y: H - this.rng.f() * 2,
          vy: (0.15 + 0.85 * this.rng.f() * this.rng.f()) * H * 0.0075,
          ph: this.rng.f() * 6.283,
          life: 1,
        })
      }
    }
    live = 0
    for (const p of this.silt) {
      p.y -= p.vy
      p.vy *= 0.985
      p.x += Math.sin(p.y * 0.3 + this.t * 0.05 + p.ph) * 0.25
      p.life -= 0.007 + (1 - this.kMurk) * 0.03
      if (p.life > 0 && p.y > surf + 1) this.silt[live++] = p
    }
    this.silt.length = live
  }

  /** A bubble bursts at the surface: a ripple, and a splash for the bigger ones. */
  private pop(b: Bubble): void {
    const amp = 0.35 + b.r * 0.35
    if (this.ripples.length < 120) this.ripples.push({ x: b.x, age: 0, amp })
    const n = b.r < 0.7 ? (this.rng.f() < 0.3 ? 1 : 0) : Math.round(1 + b.r * 1.2 + this.rng.f() * 2)
    for (let i = 0; i < n && this.drops.length < MAX_DROPS; i++) {
      const a = (this.rng.f() - 0.5) * 2.2
      const v = 0.45 + this.rng.f() * 0.45 + b.r * 0.12
      this.drops.push({ x: b.x, y: SURFACE, vx: Math.sin(a) * v * 0.9, vy: -Math.cos(a) * v })
    }
  }

  /** The surface's height at dot x: a slow swell plus every ripple's ring. */
  private surfaceAt(x: number): number {
    let y = SURFACE + Math.sin(x * 0.11 + this.t * 0.07) * Math.sin(x * 0.037 - this.t * 0.03) * this.s * 0.06
    for (const rp of this.ripples) {
      const d = Math.abs(x - rp.x)
      const front = rp.age * 0.7
      if (d > front + 2) continue
      y += Math.cos((d - front) * 0.9) * rp.amp * Math.exp(-d * 0.08)
    }
    return y
  }

  /** Light one dot at (x, y), brightness v (0..1), lit by `kind`. */
  private dot(x: number, y: number, v: number, kind: number): void {
    const px = Math.floor(x)
    const py = Math.floor(y)
    if (px < 0 || py < 0 || px >= this.W || py >= this.H) return
    const c = (py >> 2) * this.columns + (px >> 1)
    this.bits[c]! |= BRAILLE[px & 1]![py & 3]!
    if (v > this.lum[c]!) {
      this.lum[c] = v
      this.kind[c] = kind
    }
  }

  frame(): string {
    return this.grid().encode()
  }

  grid(): Cells {
    const out = this.out
    const n = this.columns * this.rows
    const { bits, lum, kind } = this
    bits.fill(0)
    lum.fill(0)
    if (this.s <= 0 || this.strength <= 0) {
      for (let i = 0; i < n; i++) out.blank(i)
      return out
    }
    const W = this.W
    const H = this.H

    // The surface: a faint dotted line, brighter where it's been disturbed.
    for (let x = 0; x < W; x++) {
      const y = this.surfaceAt(x + 0.5)
      const lift = Math.abs(y - SURFACE)
      // Two dots in three when still (the gaps creep along), solid where it heaves.
      if (lift < 0.35 && (x + (this.t >> 3)) % 3 === 0) continue
      this.dot(x, y + 0.5, 0.12 + Math.min(0.45, lift * 0.4), 1)
    }
    // The head: foam fizzing along the surface, densest at the top and
    // thinning out below, a few dots frothing above; thicker as it gets busier.
    const head = 1.5 + this.s * 0.35
    const fizz = this.t >> 2
    for (let x = 0; x < W; x++) {
      const y0 = this.surfaceAt(x + 0.5)
      if (hash1(x * 7919 + fizz * 104729 + this.seedN) < 0.3) this.dot(x, y0 - 0.5, 0.6, 1)
      for (let d = 0; d < head; d++) {
        const p = 0.85 * Math.pow(1 - d / head, 1.3) + 0.08
        if (hash1(x * 7919 + (d + 1) * 15485863 + fizz * 104729 + this.seedN) < p) this.dot(x, y0 + 0.5 + d, 0.82 - (d / head) * 0.3, 1)
      }
    }
    for (const d of this.drops) this.dot(d.x, d.y, 0.85, 0)
    for (const p of this.silt) this.dot(p.x, p.y, 0.3 + p.life * 0.7, 2)

    // Bubbles: a ring with a glint up-left once big enough, a dot before.
    for (const b of this.bubbles) {
      // Deeper bubbles sit dimmer; they brighten toward the surface.
      const depth = clamp((b.y - SURFACE) / Math.max(1, H - SURFACE))
      const base = 0.16 + (1 - depth) * 0.22 + Math.min(0.1, b.r * 0.04)
      if (b.r < 0.8) {
        this.dot(b.x, b.y, base, 0)
        continue
      }
      if (b.r < 1.3) {
        // A small bubble: a diamond of four dots round an empty middle, lit
        // from the top and the left.
        this.dot(b.x, b.y - 1, base + 0.3, 0)
        this.dot(b.x - 1, b.y, base + 0.2, 0)
        this.dot(b.x + 1, b.y, base - 0.05, 0)
        this.dot(b.x, b.y + 1, base - 0.1, 0)
        continue
      }
      const reach = Math.ceil(b.r + 1)
      const cx = Math.floor(b.x)
      const cy = Math.floor(b.y)
      for (let dy = -reach; dy <= reach; dy++)
        for (let dx = -reach; dx <= reach; dx++) {
          const ox = cx + dx + 0.5 - b.x
          const oy = cy + dy + 0.5 - b.y
          const d = Math.sqrt(ox * ox + oy * oy)
          if (Math.abs(d - b.r) > 0.5) continue
          // Light from up-left: that side of the rim shines, the far side dims.
          const facing = d > 0 ? -(ox + oy) / (d * 1.414) : 0
          this.dot(cx + dx, cy + dy, base + facing * 0.2 + (facing > 0.8 ? 0.35 : 0), 0)
        }
      // The glint: a dot inside, up-left of center, on the bigger ones.
      if (b.r >= 2.2) this.dot(b.x - b.r * 0.42, b.y - b.r * 0.45, 1, 0)
    }

    // Colors: the water behind every cell, deeper by row with slow swells
    // along it (stepped, so the frame holds few colors); the cell's
    // brightest dot picks from its bubble ramp. Murk and cold blend both.
    const km = Math.round(this.kMurk * 4) / 4
    const kc = Math.round(this.kCold * 4) / 4
    const kn = Math.round(Math.max(0, this.kNight) * 8) / 8
    const top = mix(mix(mix(WATER_TOP, STOUT_TOP, kn), MURK_TOP, km), COLD_TOP, kc)
    const bottom = mix(mix(mix(WATER_BOTTOM, STOUT_BOTTOM, kn), MURK_BOTTOM, km), COLD_BOTTOM, kc)
    for (let i = 0; i < n; i++) {
      const row = (i / this.columns) | 0
      const col = i - row * this.columns
      const swell = Math.sin(col * 0.11 + this.t * 0.03) * Math.sin(col * 0.047 - this.t * 0.019)
      const depth = clamp(row / Math.max(1, this.rows - 1) + swell * 0.08)
      const bg = mix(top, bottom, Math.round(depth * 12) / 12)
      if (!bits[i]) {
        out.set(i, 0x20, bg, bg)
        continue
      }
      const v = lum[i]!
      let fg: number
      if (kind[i] === 2) fg = ramp(SILT, v)
      else {
        fg = ramp(WATER, v)
        if (kn > 0) fg = mix(fg, ramp(TAN, v), kn)
        if (km > 0) fg = mix(fg, ramp(MURK, v * 0.85), km)
        if (kc > 0) fg = mix(fg, ramp(COLD, v), kc)
      }
      out.set(i, 0x2800 | bits[i]!, fg, bg)
    }
    return out
  }
}
