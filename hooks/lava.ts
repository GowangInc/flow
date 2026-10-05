// REVISION: flow-v61-names
//
// Lava (the `lava` style): a liquid lamp of water on the same dials as the
// fire; the level is the heat. Soft blobs of luminous aqua, teal and blue
// liquid lift off a pool at the bottom, rise through a darker liquid, cool,
// sink and fall back in, merging and splitting wherever they meet. At 1 a
// few drift slowly; as the level climbs there are more of them and they
// move faster, wobbling as they go; from 8 the whole lamp thrashes: blobs
// stretch with their speed, the liquid sloshes side to side, the pool's
// surface tilts and waves roll across the panel.
//
// The band is the lamp on its side as much as upright: only ~10 pixels
// tall, so blobs travel sideways in both directions (wrapping around) while
// bobbing up and down. A tall spine is the classic lamp: a narrow column
// with the pool at its foot.
//
// The blobs are metaballs (a sum of compact falloffs) on a 2x2-a-cell pixel
// layer, thresholded with an anti-aliased edge, a faint glow outside it, a
// bright rim, and a highlight where the surface faces the light; every
// shade is quantized so a frame keeps few color pairs. Cells are the
// quadrant glyphs that best fit their four pixels. Subagents (the coverage
// boost) add blobs; smoke clouds the liquid over grey; a nearly-full
// context turns it deep blue and violet.

import { Cells, Rng } from './cells'
import type { Tint } from './styles'
import { clamp, fitQuad, hash1, mix, QUAD, type QuadFit } from './pixels'

/** A blob's field at its visible edge: (1 - d²)² of its support radius. */
const T = 0.4
/** Visible radius over support radius at the threshold: sqrt(1 - sqrt(T)). */
const EDGE = Math.sqrt(1 - Math.sqrt(T))
/** Most blobs at once, boost included. */
const MAX_BLOBS = 40

type Palette = {
  bgTop: number
  bgBot: number
  glow: number
  rim: number
  hl: number
  /** Body colors by hue (aqua, teal, blue), lit and deep. */
  body: [number, number, number]
  deep: [number, number, number]
}

const WATER: Palette = {
  bgTop: 0x05121e,
  bgBot: 0x0a2838,
  glow: 0x0f4658,
  rim: 0x8af2f0,
  hl: 0xe2ffff,
  body: [0x2cc4d0, 0x1fae96, 0x3482e0],
  deep: [0x0f6c88, 0x0d6460, 0x1a3e94],
}
/** Smoke: the liquid clouds over, murky grey. */
const MURK: Palette = {
  bgTop: 0x0c0d0e,
  bgBot: 0x1e2122,
  glow: 0x2a2e30,
  rim: 0xb4babc,
  hl: 0xd8dcdc,
  body: [0x7c8486, 0x747c7a, 0x6e7680],
  deep: [0x40464a, 0x3c4442, 0x3a404a],
}
/** Context nearly full: deep blue and violet. */
const DEEP: Palette = {
  bgTop: 0x05041a,
  bgBot: 0x120c3a,
  glow: 0x261c66,
  rim: 0xb0a0ff,
  hl: 0xeee6ff,
  body: [0x6a4ae0, 0x8a3cd0, 0x3a50e0],
  deep: [0x2c1e86, 0x3e1a74, 0x1a2480],
}

type Blob = {
  x: number
  y: number
  vx: number
  vy: number
  /** Visible radius (pixel-height units) at full size. */
  r: number
  /** Buoyancy 0..1: heated by the pool, cooled at the top. */
  temp: number
  /** Swims this way through the band (signed). */
  drift: number
  phase: number
  hue: number
  /** Size eased in (born from the pool) and out (sinking back into it). */
  grow: number
  dying: boolean
}

function mixPal(a: Palette, b: Palette, k: number): Palette {
  if (k <= 0.001) return a
  return {
    bgTop: mix(a.bgTop, b.bgTop, k),
    bgBot: mix(a.bgBot, b.bgBot, k),
    glow: mix(a.glow, b.glow, k),
    rim: mix(a.rim, b.rim, k),
    hl: mix(a.hl, b.hl, k),
    body: [mix(a.body[0], b.body[0], k), mix(a.body[1], b.body[1], k), mix(a.body[2], b.body[2], k)],
    deep: [mix(a.deep[0], b.deep[0], k), mix(a.deep[1], b.deep[1], k), mix(a.deep[2], b.deep[2], k)],
  }
}

/** Quantization steps: background rows, glow, edge, depth, light, hue. */
const BG_STEPS = 8
const GLOW_STEPS = 3
const DEPTH_STEPS = 4
const HUE_STEPS = 4

export class Lava {
  strength = 8
  coverageBoost = 0
  tint: Tint = 'normal'
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
  private kGrey = 0
  private kBlue = 0
  private slosh = 0
  private sloshV = 0
  private clock = 0

  // Pixel layer (2x2 a cell): the field, its hue, and the colors.
  private pw = 0
  private ph = 0
  private field = new Float32Array(0)
  private hue = new Float32Array(0)
  private pc = new Int32Array(0)
  /** Per-row sideways and per-column vertical displacement: the waves. */
  private wx = new Float32Array(0)
  private wy = new Float32Array(0)
  private quad = new Int32Array(4)
  private fit: QuadFit = { mask: 0, fg: 0, bg: 0, spread: 0 }

  // The lamp in pixel-height units: W wide, H tall.
  private vertical = false
  private W = 0
  private H = 0
  private blobs: Blob[] = []
  private nextId = 0

  constructor(seed?: number) {
    this.seed = (seed ?? 4242) % 100_000
    this.rng = new Rng(this.seed + 31)
  }

  ensure(columns: number, rows: number): void {
    if (columns === this.columns && rows === this.rows) return
    this.columns = columns
    this.rows = rows
    this.out = new Cells(columns, rows)
    this.vertical = rows > columns
    this.pw = columns * 2
    this.ph = rows * 2
    // A pixel is half a cell each way and a cell is about twice as tall as
    // wide, so a pixel row is one unit and a pixel column half of one.
    this.W = columns
    this.H = rows * 2
    const n = this.pw * this.ph
    this.field = new Float32Array(n)
    this.hue = new Float32Array(n)
    this.pc = new Int32Array(n)
    this.wx = new Float32Array(this.ph)
    this.wy = new Float32Array(this.pw)
    this.blobs = []
    this.started = false
  }

  private get level(): number {
    return Math.max(0, Math.min(10, this.strength))
  }

  /** How many blobs the lamp holds at the current (eased) heat. */
  private target(): number {
    const s = this.s
    const boost = Math.round(this.coverageBoost / 12)
    if (this.vertical) {
      const base = Math.round(2 + s * 0.45 + (this.H > 90 ? 1 : 0))
      return Math.min(MAX_BLOBS, base + Math.min(4, boost))
    }
    const per = 34 - s * 2
    return Math.min(MAX_BLOBS, Math.max(2, Math.round(this.W / per)) + Math.min(6, boost * 2))
  }

  /** The pool's depth (units) at the foot of the lamp. */
  private poolDepth(): number {
    // The band is too shallow for a floor at rest: the pool only rises
    // into it as the heat climbs, waves and all.
    return this.vertical ? Math.max(3, this.H * 0.07) : clamp((this.s - 5.5) / 4.5) * 2.4
  }

  private spawn(fromPool: boolean): Blob {
    const id = this.nextId++
    const h = (k: number) => hash1(this.seed * 977 + id * 131 + k)
    const W = this.W
    const H = this.H
    const r = this.vertical ? Math.min(W * 0.3, 2.6 + h(1) * 3.2 + (H > 90 ? 1 : 0)) : 2.2 + h(1) * 2.4
    const y = fromPool ? H - this.poolDepth() : r + h(2) * Math.max(0, H - 2 * r)
    return {
      x: this.vertical ? r * 0.7 + h(3) * Math.max(0, W - 1.4 * r) : h(3) * W,
      y,
      vx: 0,
      vy: 0,
      r,
      temp: fromPool ? 0.7 : h(4),
      drift: (h(5) < 0.5 ? -1 : 1) * (0.5 + h(6)),
      phase: h(7) * 6.283,
      hue: h(8) * 2,
      grow: fromPool ? 0 : 1,
      dying: false,
    }
  }

  step(): void {
    if (this.columns === 0) return
    const level = this.level
    if (!this.started) {
      this.s = level
      this.kGrey = this.tint === 'smoke' ? 1 : 0
      this.kBlue = this.tint === 'blue' ? 1 : 0
      this.started = true
      const n = this.target()
      for (let i = 0; i < n; i++) this.blobs.push(this.spawn(false))
    }
    this.t++
    this.s += (level - this.s) * 0.035
    this.kGrey += ((this.tint === 'smoke' ? 1 : 0) - this.kGrey) * 0.05
    this.kBlue += ((this.tint === 'blue' ? 1 : 0) - this.kBlue) * 0.05
    if (level <= 0) return
    const s = this.s
    const W = this.W
    const H = this.H
    const vertical = this.vertical
    // Time runs faster with the heat: everything that sways reads this clock.
    const pace = 0.35 + 0.14 * s
    this.clock += pace

    // The slosh: a spring the thrash keeps kicking, tilting the pool and
    // pushing every blob sideways together.
    const thrash = clamp((s - 6.5) / 3.5)
    const kick = thrash * Math.sin(this.clock * 0.09) * 0.012 + thrash * (this.rng.f() - 0.5) * 0.01
    this.sloshV += kick - this.slosh * 0.02
    this.sloshV *= 0.97
    this.slosh += this.sloshV

    // Blobs born from the pool and sinking back into it as the count changes.
    const want = this.target()
    let live = 0
    for (const b of this.blobs) if (!b.dying) live++
    if (live < want && this.t % 6 === 0) this.blobs.push(this.spawn(true))
    else if (live > want && this.t % 6 === 0) {
      for (const b of this.blobs)
        if (!b.dying) {
          b.dying = true
          break
        }
    }

    const pool = H - this.poolDepth()
    const heat = 0.004 + 0.0016 * s
    const lift = vertical ? 0.006 + 0.0022 * s : 0.004 + 0.0012 * s
    const swim = vertical ? 0.02 + 0.02 * s : 0.03 + 0.045 * s
    const shove = thrash * (vertical ? 0.05 : 0.09)
    for (let i = this.blobs.length - 1; i >= 0; i--) {
      const b = this.blobs[i]!
      if (b.dying) {
        b.grow -= 0.02
        if (b.grow <= 0) {
          this.blobs.splice(i, 1)
          continue
        }
      } else if (b.grow < 1) b.grow = Math.min(1, b.grow + 0.025)
      const r = b.r * b.grow
      if (vertical) {
        // Heated in the pool, cooled at the top, losing a little on the way.
        if (b.y + r * 0.5 > pool) b.temp += heat * 2
        else if (b.y - r < 2.5) b.temp -= heat * 2.5
        else b.temp -= heat * 0.04
        b.temp = clamp(b.temp)
        b.vy += -(b.temp - 0.5) * lift
      } else {
        // The band is too shallow for heat to read: each blob swims a
        // swell of its own, rising and dipping as it travels, sometimes
        // leaving the band and coming back (the panel's edges clip it).
        const lane = H * 0.5 + (H * 0.5 + r * 0.3 - r * 0.5) * Math.sin(b.x * 0.09 + b.phase * 0.7 + b.hue)
        b.vy += (lane - b.y) * lift * 0.6
      }
      // Sideways: a meandering current, each blob's own swim in the band.
      const cur = Math.sin(b.y * 0.21 + this.clock * 0.05 + b.phase) * (vertical ? 0.006 : 0.004)
      const swimTo = vertical ? Math.sin(this.clock * 0.02 + b.phase) * swim * 0.5 : b.drift * swim
      b.vx += (swimTo - b.vx) * 0.03 + cur + this.sloshV * shove * 6
      if (thrash > 0) {
        b.vx += (this.rng.f() - 0.5) * thrash * 0.06
        b.vy += (this.rng.f() - 0.5) * thrash * 0.05
      }
      b.vx *= 0.985
      b.vy *= 0.96
      b.x += b.vx
      b.y += b.vy
      b.phase += 0.02 + 0.012 * s
      // The walls of the lamp: the spine's sides bounce; the band wraps.
      if (vertical) {
        const m = r * 0.55
        if (b.x < m) (b.x = m), (b.vx = Math.abs(b.vx) * 0.5)
        if (b.x > W - m) (b.x = W - m), (b.vx = -Math.abs(b.vx) * 0.5)
      } else b.x = ((b.x % W) + W) % W
      const top = r * (vertical ? 0.8 : 0.35)
      if (b.y < top) (b.y = top), (b.vy = Math.abs(b.vy) * 0.3), (b.temp = Math.min(b.temp, 0.45))
      const bottom = H - r * 0.3
      if (b.y > bottom) (b.y = bottom), (b.vy = -Math.abs(b.vy) * 0.3)
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
    this.paintField()
    this.paintColors()
    this.composite()
    return out
  }

  /** The waves, the pool and every blob summed into the field. */
  private paintField(): void {
    const pw = this.pw
    const ph = this.ph
    const W = this.W
    const H = this.H
    const s = this.s
    const c = this.clock
    const vertical = this.vertical
    const F = this.field
    const Hu = this.hue
    F.fill(0)
    Hu.fill(0)
    // Waves: rows shift sideways, columns bob. Wavenumbers fit the band's
    // width a whole number of times so its wrap has no seam.
    const amp = 0.15 + 0.06 * s + clamp((s - 7) / 3) * 0.8
    const kx = (2 * Math.PI * Math.max(1, Math.round(W / (vertical ? 14 : 24)))) / W
    for (let j = 0; j < ph; j++) this.wx[j] = amp * (vertical ? 0.6 : 0.7) * Math.sin(j * 0.33 + c * 0.07)
    for (let i = 0; i < pw; i++) this.wy[i] = amp * (vertical ? 0.9 : 0.55) * Math.sin(i * 0.5 * kx - c * 0.06)
    const wmax = amp * 1.6 + 0.5

    for (const b of this.blobs) {
      if (b.grow <= 0) continue
      // Squash and stretch: a wobble, and a pull along the way it moves.
      const wob = (0.06 + 0.02 * s) * Math.sin(b.phase)
      const sp = Math.min(0.9, Math.hypot(b.vx, b.vy) * (vertical ? 1.2 : 0.8))
      const ax = Math.abs(b.vx) / (Math.hypot(b.vx, b.vy) + 1e-6)
      const r = b.r * b.grow
      const rx = (r * (1 + wob) * (1 + sp * ax)) / (1 + sp * (1 - ax) * 0.4) / EDGE
      const ry = (r * (1 - wob) * (1 + sp * (1 - ax))) / (1 + sp * ax * 0.4) / EDGE
      const x0 = Math.floor((b.x - rx - wmax) * 2)
      const x1 = Math.ceil((b.x + rx + wmax) * 2)
      const y0 = Math.max(0, Math.floor(b.y - ry - wmax))
      const y1 = Math.min(ph - 1, Math.ceil(b.y + ry + wmax))
      const irx = 1 / rx
      const iry = 1 / ry
      for (let j = y0; j <= y1; j++) {
        const row = j * pw
        const wxj = this.wx[j]!
        for (let i = x0; i <= x1; i++) {
          let ii = i
          if (ii < 0 || ii >= pw) {
            if (vertical) continue
            ii = ((ii % pw) + pw) % pw
          }
          const dx = ((i + 0.5) * 0.5 + wxj - b.x) * irx
          const dy = (j + 0.5 + this.wy[ii]! - b.y) * iry
          const d2 = dx * dx + dy * dy
          if (d2 >= 1) continue
          const f = (1 - d2) * (1 - d2)
          F[row + ii]! += f
          Hu[row + ii]! += f * b.hue
        }
      }
    }

    // The pool: a liquid floor at threshold along its wavy, sloshing surface.
    const depth = this.poolDepth()
    if (depth <= 0.05) return
    const tilt = clamp(this.slosh * 6, -1, 1) * (vertical ? H * 0.08 : 1.6)
    const wave = (vertical ? 0.5 : 0.35) + 0.05 * s + clamp((s - 6) / 4) * (vertical ? 1.6 : 0.9)
    for (let i = 0; i < pw; i++) {
      const x = (i + 0.5) * 0.5
      const surf =
        H -
        depth +
        tilt * (x / W - 0.5) * 2 +
        wave * (0.6 * Math.sin(x * kx * 1.0 + c * 0.08) + 0.4 * Math.sin(x * kx * 2.0 - c * 0.11 + 1.3))
      for (let j = Math.max(0, Math.floor(surf - 3)); j < ph; j++) {
        const p = T * clamp(1 + (j + 0.5 - surf) / 1.6, 0, 2.5)
        if (p <= 0) continue
        F[j * pw + i]! += p
        Hu[j * pw + i]! += p * 1.0
      }
    }
  }

  /** Field to color: background, glow, anti-aliased edge, rim, body and highlight. */
  private paintColors(): void {
    const pw = this.pw
    const ph = this.ph
    let P = WATER
    if (this.kBlue > 0.001) P = mixPal(P, DEEP, this.kBlue)
    if (this.kGrey > 0.001) P = mixPal(P, MURK, this.kGrey)
    const F = this.field
    const Hu = this.hue
    const glowLo = T * 0.45
    const edgeLo = T * 0.86
    const edgeHi = T * 1.08
    for (let j = 0; j < ph; j++) {
      // The liquid darkens toward the top, lit from the lamp's foot.
      const bgK = Math.round(Math.pow(j / Math.max(1, ph - 1), 1.4) * (BG_STEPS - 1)) / (BG_STEPS - 1)
      const bg = mix(P.bgTop, P.bgBot, bgK)
      for (let i = 0; i < pw; i++) {
        const k = j * pw + i
        const v = F[k]!
        if (v < glowLo) {
          this.pc[k] = bg
          continue
        }
        if (v < edgeLo) {
          const gk = Math.ceil(((v - glowLo) / (edgeLo - glowLo)) * GLOW_STEPS) / GLOW_STEPS
          this.pc[k] = mix(bg, P.glow, gk * 0.75)
          continue
        }
        const hq = Math.round(clamp((Hu[k]! / v) * 0.5) * (HUE_STEPS - 1)) / (HUE_STEPS - 1)
        const hh = hq * 2
        const hi = Math.min(1, Math.floor(hh))
        const hf = hh - hi
        const body = mix(P.body[hi]!, P.body[hi + 1]!, hf)
        if (v < edgeHi) {
          // The anti-aliased edge: half way from the glow to the rim.
          this.pc[k] = mix(mix(bg, P.glow, 0.75), body, 0.55)
          continue
        }
        // Inside: the rim just past the edge, lit or shaded by which way the
        // surface faces (up and to the left is toward the light), deeper
        // and darker toward the middle.
        const deep = mix(P.deep[hi]!, P.deep[hi + 1]!, hf)
        const depth = Math.round(clamp((v - edgeHi) / (T * 2.2)) * (DEPTH_STEPS - 1)) / (DEPTH_STEPS - 1)
        const gx = ((i + 1 < pw ? F[k + 1]! : v) - (i > 0 ? F[k - 1]! : v)) * 2
        const gy = (j + 1 < ph ? F[k + pw]! : v) - (j > 0 ? F[k - pw]! : v)
        const gl = Math.hypot(gx, gy) + 1e-6
        // Outward normal is down the gradient; the light comes from up-left.
        const lam = (gx * 0.45 + gy * 0.89) / gl
        let c = mix(body, deep, depth * 0.6)
        if (depth === 0) c = mix(c, P.rim, lam > 0 ? 0.4 : 0.15)
        if (lam > 0.55 && depth <= 1 / (DEPTH_STEPS - 1)) c = mix(c, P.hl, depth === 0 ? 0.7 : 0.45)
        else if (lam < -0.5 && depth > 0) c = mix(c, P.deep[0], 0.35)
        this.pc[k] = c
      }
    }
  }

  private composite(): void {
    const out = this.out
    const w = this.columns
    const h = this.rows
    const pw = this.pw
    const q = this.quad
    const f = this.fit
    for (let cell = 0; cell < w * h; cell++) {
      const r = (cell / w) | 0
      const c = cell - r * w
      const k0 = 2 * r * pw + 2 * c
      q[0] = this.pc[k0]!
      q[1] = this.pc[k0 + 1]!
      q[2] = this.pc[k0 + pw]!
      q[3] = this.pc[k0 + pw + 1]!
      // Exact palette colors only (near 0): blending would mint new pairs.
      fitQuad(q, f, 0)
      // A flat cell is a full block of its color: the liquid fills the
      // panel, so no cell reads as empty.
      if (f.spread === 0) out.set(cell, 0x2588, q[0]!, q[0]!)
      else out.set(cell, QUAD[f.mask]!, f.fg, f.bg)
    }
  }

  frame(): string {
    return this.grid().encode()
  }
}
