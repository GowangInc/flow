// REVISION: flow-v106-held
//
// A colony ship on the same dials as the fire: the level is its speed. A
// long ship like the Avalon holds steady (nose to the right in the band,
// nose up in a tall spine) while three layers of stars drift past behind
// it: an engine block at the stern, a bare truss spine, and three habitat
// blades twisted round that spine, turning (the helix slides along the ship
// and each blade brightens as it swings to face us, its windows showing,
// and darkens as it passes behind). Ahead of the bow a deflector shield
// arcs across the lane. Rocks drift in from ahead, strike the shield and
// burn up: an orange-white flash where they hit, embers sprayed off the
// shield that cool and fade, and a ripple of light running along it.
//
// At 1 the stars barely move, a slow rock comes by now and then and the
// shield is faint. As the level climbs the stars stretch into streaks and
// the rocks come thicker and faster; by 10 the stars blur past, the plume
// burns long and impacts keep the shield lit. Subagents light more of the
// habitat windows; smoke dims the engine to gray, coughs puffs out behind
// it, and leaves the shield flickering weakly; a nearly-full context turns
// the shield and the stars a deep, hard-glowing cyan.
//
// Everything is placed in a flight frame (a = along the direction of
// travel, c = across it, both in braille dots: square, two a cell across and
// four down) and mapped onto the screen only when drawn, so the band and the
// spine share every rule. The hull is a pixel layer folded into quadrant
// glyphs; the bare spine, the shield, rocks and embers are braille dots.

import { Cells, DEFAULT_COLOR, Rng, isTall } from './cells'
import type { Tint } from './styles'
import { BRAILLE, clamp, fitQuad, g, hash1 as hash, mix, NEAR, QUAD, type QuadFit } from './pixels'
import { defineScene } from './scene-def'
import { hear, leadFrames, type SoundEvent } from './sound'

/** Cells per frame the nearest stars travel at each level (0 = off). */
const SPEED = [0, 0.012, 0.03, 0.06, 0.11, 0.19, 0.32, 0.52, 0.85, 1.35, 2.1]
/** Depth layers: far stars drift slowest and dimmest. */
const LAYERS = [0.25, 0.55, 1] as const

const C = {
  engine: [0x4c535c, 0x6c7580, 0x8e98a3] as const,
  truss: 0x7c8590,
  spine: 0x666e78,
  hub: 0x7c8590,
  /** A blade by how squarely it faces us: edge-on to full face. */
  bladeFront: [0x7d8792, 0xa6b0bb, 0xd0d8e0] as const,
  bladeBack: [0x3b424b, 0x4d555f] as const,
  window: 0xf2d06b,
  windowDim: 0x8a7440,
  windowBack: 0x6e5c30,
  bow: [0x8e98a3, 0xc4ccd5] as const,
  emitter: 0xbfe8ff,
  plume: [0xe8f4ff, 0x9fd8ff, 0x4aa8f0, 0x2a6fc0] as const,
  plumeSmoke: [0x9a9a9a, 0x707074] as const,
  smoke: 0xb4b4b4,
  smokeThin: 0x606064,
  /** The shield's light, faint to blazing. */
  shield: [0x1a3a58, 0x245a86, 0x3480bc, 0x5aaee4, 0x9ad6f6, 0xe2f6ff] as const,
  shieldBlue: [0x06405a, 0x076a8c, 0x0a94b8, 0x12c0de, 0x5ae6f8, 0xc8fcff] as const,
  shieldSmoke: [0x34485c, 0x4c6278, 0x6a8296, 0x8aa2b4] as const,
  /** The glow behind a bright stretch of shield (cell backgrounds). */
  glow: [0x0c1a2a, 0x112840, 0x183a5c] as const,
  glowBlue: [0x04222e, 0x063546, 0x094a60] as const,
  flash: [0xfff8e8, 0xffd480, 0xff9a3a, 0x8a3812] as const,
  ember: [0xfff2c0, 0xffc04a, 0xff7a22, 0xc0401a, 0x6a2410] as const,
  rock: [0xa8a091, 0xc4baa9, 0xe0d7c6] as const, // small, medium, big
  hot: 0xff9a50,
  star: [0x6a7488, 0xa8b2c4, 0xeef2fa] as const,
  cyan: [0x2a7ea0, 0x40b8dc, 0xb0f0ff] as const,
}

/** Rock radii in dots, smallest first. */
const ROCK_R = [2.2, 3.8, 6.2] as const
/** Draw order when a braille cell holds two things: the higher wins its color. */
const P = { shield: 1, rock: 2, ember: 3 } as const
/** Pixel kinds in the hull layer. */
const K = { none: 0, spine: 1, hull: 2, window: 3 } as const
/** Frames a strike's flash and ripple last. */
const FLASH = 5
const RIPPLE = 26
const TAU = Math.PI * 2

type Star = { u: number; v: number; layer: number; tw: number }
/** A rock: `k` scales the level's drift speed. */
/** A rock; `heard` once its strike has been sent to be played (ahead of it, see leadFrames). */
type Rock = { a: number; c: number; dc: number; k: number; size: number; ang: number; spin: number; seed: number; heard?: boolean }
type Mote = { a: number; c: number; va: number; vc: number; life: number; max: number }
/** A strike on the shield: where, how long ago, and how big the rock was. */
type Hit = { a: number; c: number; age: number; size: number }

/** The ship and its shield, scaled from their original size. */
const SHIP_SCALE = 0.9

/** The ship's layout in the flight frame (dots), fixed per grid size. */
type Geo = {
  A: number // the frame's length along
  Cd: number // and across
  c0: number // the spine's centerline
  aS: number // the stern
  aN: number // the nose
  E: number // engine length
  h0: number // habitat start, from the stern
  h1: number // habitat end
  b0: number // bow start
  R: number // blade radius
  hw: number // engine half-width
  aV: number // the shield's vertex
  sw: number // the shield's half-width across, from the centerline
  Rc: number // the shield's curvature radius
}

export class Colony {
  strength = 8
  coverageBoost = 0
  sounds: SoundEvent[] = []
  tint: Tint = 'normal'
  private columns = 0
  private rows = 0
  private out = new Cells(0, 0)
  private stars: Star[] = []
  private t = 0
  private seedBase: number
  private rng: Rng
  /** The eased level: changes glide rather than jump. */
  private level = Number.NaN
  private geo!: Geo
  // Hull pixel layer, 2 × 2 a cell: color and kind.
  private pc = new Int32Array(0)
  private pk = new Uint8Array(0)
  // Braille layer: dot bits, color and the priority that set it, per cell.
  private bits = new Uint8Array(0)
  private dotColor = new Int32Array(0)
  private prio = new Uint8Array(0)
  /** The brightest shield light in each cell (0 = none). */
  private glow = new Float32Array(0)
  // Smoke layer: a puff glyph and color per cell (0 = none).
  private puff = new Int32Array(0)
  private puffColor = new Int32Array(0)
  /** Cells a rock covers: the stars behind are hidden. */
  private solid = new Uint8Array(0)
  private rocks: Rock[] = []
  private embers: Mote[] = []
  private smoke: Mote[] = []
  private hits: Hit[] = []
  /** The habitat's turn (radians). */
  private spin = 0
  private q = [0, 0, 0, 0]
  private fit: QuadFit = { mask: 0, fg: 0, bg: 0, spread: 0 }

  constructor(seed?: number) {
    this.rng = new Rng(seed)
    this.seedBase = (seed ?? this.rng.int()) % 100_000
  }

  /** Tall grids (the spine) fly nose-up with the stars streaming down. */
  private get isVertical(): boolean {
    return isTall(this.columns, this.rows)
  }

  ensure(columns: number, rows: number): void {
    if (columns === this.columns && rows === this.rows) return
    this.columns = columns
    this.rows = rows
    const n = columns * rows
    this.out = new Cells(columns, rows)
    this.pc = new Int32Array(n * 4)
    this.pk = new Uint8Array(n * 4)
    this.bits = new Uint8Array(n)
    this.dotColor = new Int32Array(n)
    this.prio = new Uint8Array(n)
    this.glow = new Float32Array(n)
    this.puff = new Int32Array(n)
    this.puffColor = new Int32Array(n)
    this.solid = new Uint8Array(n)
    this.rocks = []
    this.embers = []
    this.smoke = []
    this.hits = []
    this.geo = this.layout()
    // u runs along the direction of travel, v across it; both in cells.
    const along = this.isVertical ? rows : columns
    const across = this.isVertical ? columns : rows
    const count = Math.max(6, Math.round(n * 0.07))
    this.stars = Array.from({ length: count }, (_, i) => ({
      u: hash(this.seedBase + i * 3) * along,
      v: Math.floor(hash(this.seedBase + i * 3 + 1) * across),
      layer: Math.floor(hash(this.seedBase + i * 3 + 2) * LAYERS.length),
      tw: hash(this.seedBase + i * 7) * 6.283,
    }))
  }

  /** Where the ship and its shield sit: the band's ship a little left of center, the spine's in its lower half. */
  private layout(): Geo {
    const v = this.isVertical
    const A = v ? this.rows * 4 : this.columns * 2
    const Cd = v ? this.columns * 2 : this.rows * 4
    // The spine's 4 dots fill whole cells: an even centerline across a column pair (or the band's middle row).
    const c0 = v ? 2 * Math.floor(this.columns / 2) : 2 * Math.floor(this.rows) // band: rows*4/2
    // The shield holds its place; the ship stands well back from it, small
    // against it (the shield spans the whole frame across).
    const aV = Math.round(A * (v ? 0.52 : 0.45)) + (v ? 7 : 8)
    const aN = aV - Math.round((v ? 18 : 22) * SHIP_SCALE)
    const Ls = Math.round(SHIP_SCALE * (v ? A * 0.25 : clamp(A * 0.22, 22, 66)))
    const E = Math.round((v ? 5 : 4) * SHIP_SCALE)
    const h0 = E + Math.round(Ls * 0.1)
    const b0 = Ls - Math.max(6, Math.round(Ls * 0.11))
    const h1 = b0 - Math.max(4, Math.round(Ls * 0.07))
    const R = SHIP_SCALE * (v ? Math.min(Cd * 0.19, 8) : Cd * 0.22)
    // The shield spans a fixed width beside the ship, however wide the frame.
    const sw = Math.min(Cd / 2, R * 2.6)
    return {
      A,
      Cd,
      c0,
      aS: aN - Ls,
      aN,
      E,
      h0,
      h1,
      b0,
      R,
      hw: (v ? 2.5 : 2) * SHIP_SCALE,
      aV,
      sw,
      // How far the arc bends back at its ends: about 2 rows in the spine, 2-3 cells in the band.
      Rc: (sw * sw) / (2 * (v ? 9 : 6) * SHIP_SCALE),
    }
  }

  /** The stars' speed (cells per frame) at the eased level, between table steps. */
  private get speed(): number {
    const l = clamp(this.level, 0, 10)
    const i = Math.min(9, Math.floor(l))
    return SPEED[i]! + (SPEED[i + 1]! - SPEED[i]!) * (l - i)
  }

  /** How fast the rocks drift in (dots per frame): their own drift plus the ship's speed. */
  private get rockSpeed(): number {
    return 0.2 + this.speed * 2
  }

  /** The shield's surface at `c` across: an arc bending back round the bow. */
  private arcA(c: number): number {
    const d = c - this.geo.c0
    return this.geo.aV - (d * d) / (2 * this.geo.Rc)
  }

  step(): void {
    this.t++
    const want = clamp(this.strength, 0, 10)
    if (Number.isNaN(this.level)) this.level = want
    this.level += Math.abs(want - this.level) < 0.01 ? want - this.level : (want - this.level) * 0.05
    const speed = this.speed
    const along = this.isVertical ? this.rows : this.columns
    // Stars stream past the ship: leftward in the band (it flies right),
    // downward in the spine (it flies up).
    const dir = this.isVertical ? 1 : -1
    for (const s of this.stars) {
      s.u += dir * speed * LAYERS[s.layer]!
      if (s.u < 0) s.u += along
      if (s.u >= along) s.u -= along
    }
    if (this.columns === 0 || this.rows === 0) return
    // The habitat turns at its own steady pace, whatever the speed.
    this.spin = (this.spin + 0.022) % TAU
    for (const hit of this.hits) hit.age++
    this.hits = this.hits.filter(hit => hit.age < RIPPLE)
    this.stepRocks()
    this.stepMotes()
  }

  /** Rocks: spawn at the leading edge (rarely at 1, every second or so at 10), drift in, burn up on the shield. */
  private stepRocks(): void {
    const { A, Cd, c0, sw } = this.geo
    // Rocks come at the shield, whole, never clipped by an edge.
    const lo = Math.max(0, c0 - sw)
    const hi = Math.min(Cd, c0 + sw)
    const l = clamp(this.level, 0, 10)
    const rate = l < 0.5 ? 0 : 0.0022 * Math.pow(0.075 / 0.0022, (l - 1) / 9)
    if (this.rng.f() < rate) {
      const pick = this.rng.f()
      const size = pick < 0.4 ? 2 : pick < 0.75 ? 1 : 0
      const r = ROCK_R[size]!
      this.rocks.push({
        a: A + r + 1,
        c: hi - lo > r * 2.4 ? lo + r * 1.15 + this.rng.f() * (hi - lo - r * 2.3) : c0,
        dc: (this.rng.f() - 0.5) * 0.08,
        k: 0.7 + this.rng.f() * 0.6,
        size,
        ang: this.rng.f() * TAU,
        spin: (this.rng.f() - 0.5) * 0.09,
        seed: this.rng.int() % 10_000,
      })
    }
    const v = this.rockSpeed
    const lead = leadFrames(this.strength, this.tint)
    this.rocks = this.rocks.filter(rock => {
      rock.a -= v * rock.k
      rock.c = clamp(rock.c + rock.dc, lo, hi - 1)
      rock.ang += rock.spin * (1 + v * 0.3)
      const r = ROCK_R[rock.size]!
      const gap = rock.a - r * 0.75 - this.arcA(rock.c)
      // The strike's boom goes out as the rock comes within the player's start-up time of the shield, so it lands with the flash.
      if (!rock.heard && gap <= lead * v * rock.k) {
        rock.heard = true
        hear(this.sounds, { kind: 'hit', v: rock.size / 2 })
      }
      if (gap > 0) return true
      this.burn(rock)
      return false
    })
  }

  /** A rock meets the shield: a flash, a ripple along it, and embers sprayed back off it. */
  private burn(rock: Rock): void {
    const a = this.arcA(rock.c)
    this.hits.push({ a, c: rock.c, age: 0, size: rock.size })
    if (!rock.heard) hear(this.sounds, { kind: 'hit', v: rock.size / 2 })
    const n = 6 + rock.size * 5
    const slope = (rock.c - this.geo.c0) / this.geo.Rc // the shield's tilt here
    for (let i = 0; i < n; i++) {
      // Off the shield's face (outward, +a), fanned along it.
      const along = (this.rng.f() - 0.5) * (1.4 + rock.size * 0.5)
      const out = 0.25 + this.rng.f() * (0.7 + rock.size * 0.35)
      const life = 9 + Math.floor(this.rng.f() * (10 + rock.size * 6))
      this.embers.push({ a: a + 0.5, c: rock.c, va: out - along * slope * 0.5, vc: along + out * slope * 0.5, life, max: life })
    }
  }

  /** Embers cool and drift back onto the shield; (smoke tint) puffs coughed out of the engine. */
  private stepMotes(): void {
    const drift = 0.04 + this.rockSpeed * 0.04
    this.embers = this.embers.filter(m => {
      m.va = m.va * 0.86 - drift
      m.vc *= 0.88
      m.a += m.va
      m.c += m.vc
      const floor = this.arcA(m.c) + 0.3
      if (m.a < floor) {
        m.a = floor
        m.va = 0
      }
      return --m.life > 0
    })
    if (this.tint === 'smoke' && this.strength > 0 && this.t % 3 === 0) {
      const life = 20 + Math.floor(this.rng.f() * 16)
      this.smoke.push({
        a: this.geo.aS - 3,
        c: this.geo.c0 + (this.rng.f() - 0.5) * 3,
        va: -(0.35 + this.rockSpeed * 0.3),
        vc: (this.rng.f() - 0.5) * 0.3,
        life,
        max: life,
      })
    }
    this.smoke = this.smoke.filter(m => {
      m.a += m.va
      m.c += m.vc
      return --m.life > 0 && m.a > -4
    })
  }

  private starColor(layer: number, fade: number): number {
    const ramp = this.tint === 'blue' ? C.cyan : C.star
    const base = ramp[layer]!
    const k = Math.max(0.15, Math.min(1, fade))
    const ch = (sh: number) => Math.round(((base >> sh) & 255) * k)
    return (ch(16) << 16) | (ch(8) << 8) | ch(0)
  }

  grid(): Cells {
    const out = this.out
    const w = this.columns
    const h = this.rows
    for (let i = 0; i < w * h; i++) out.blank(i)
    if (this.strength <= 0 || w === 0 || h === 0) return out
    const level = clamp(this.level, 0, 10)
    const speed = this.speed
    const vertical = this.isVertical
    const along = vertical ? h : w
    const at = (u: number, v: number) => (vertical ? Math.floor(u) * w + v : v * w + Math.floor(u))
    const dir = vertical ? 1 : -1
    // The narrow spine gets shorter trails, or they fill the column.
    const maxTrail = along * (vertical ? 0.25 : 0.6)

    // Stars, far layers first; a fast star smears into a trail behind it.
    for (let layer = 0; layer < LAYERS.length; layer++) {
      for (const s of this.stars) {
        if (s.layer !== layer) continue
        const trail = Math.min(maxTrail, speed * LAYERS[layer]! * 9)
        const twinkle = level <= 2 ? 0.7 + 0.3 * Math.sin(this.t * 0.3 + s.tw) : 1
        const head = Math.floor(s.u)
        const glyph = trail < 0.6 ? (layer === 2 ? '*' : '·') : vertical ? '│' : '─'
        out.set(at(head, s.v), g(glyph), this.starColor(layer, twinkle))
        for (let k = 1; k <= Math.floor(trail); k++) {
          const u = (head - dir * k + along) % along // the trail lies behind the star's travel
          out.set(at(u, s.v), g(vertical ? '│' : '─'), this.starColor(layer, (1 - k / (trail + 1)) * 0.8))
        }
      }
    }

    // The braille layer: the shield, rocks and embers.
    this.bits.fill(0)
    this.prio.fill(0)
    this.glow.fill(0)
    this.puff.fill(0)
    this.solid.fill(0)
    this.drawShield(level)
    for (const rock of this.rocks) this.drawRock(rock)
    for (const m of this.embers) {
      const f = m.life / m.max
      this.plot(m.a, m.c, C.ember[Math.min(4, Math.floor((1 - f) * 5))]!, P.ember)
    }
    this.drawSmoke()

    const blue = this.tint === 'blue'
    const glowRamp = blue ? C.glowBlue : C.glow
    const lo = blue ? 0.2 : 0.3
    for (let i = 0; i < w * h; i++) {
      const gl = this.glow[i]!
      const bg = gl > lo ? glowRamp[Math.min(2, Math.floor((gl - lo) * 2.5))]! : DEFAULT_COLOR
      const b = this.bits[i]!
      if (this.puff[i]) out.set(i, this.puff[i]!, this.puffColor[i]!)
      else if (b) out.set(i, 0x2800 | b, this.dotColor[i]!, bg)
      else if (this.solid[i]) out.set(i, 0x20, DEFAULT_COLOR, bg)
      else if (bg !== DEFAULT_COLOR) out.set(i, out.codePoint(i), out.foreground(i), bg)
    }
    this.drawFlashes(out)
    this.drawShip(out, level)
    return out
  }

  /** Light one dot at a flight-frame position. */
  private plot(a: number, c: number, color: number, prio: number): void {
    const vertical = this.isVertical
    const x = Math.floor(vertical ? c : a)
    const y = Math.floor(vertical ? this.rows * 4 - a : c)
    if (x < 0 || y < 0 || x >= this.columns * 2 || y >= this.rows * 4) return
    const cell = (y >> 2) * this.columns + (x >> 1)
    this.bits[cell]! |= BRAILLE[x & 1]![y & 3]!
    if (prio >= this.prio[cell]!) {
      this.prio[cell] = prio
      this.dotColor[cell] = color
    }
  }

  /** The cell holding a flight-frame position, or -1 off the grid. */
  private cellAt(a: number, c: number): number {
    const vertical = this.isVertical
    const x = Math.floor(vertical ? c : a)
    const y = Math.floor(vertical ? this.rows * 4 - a : c)
    if (x < 0 || y < 0 || x >= this.columns * 2 || y >= this.rows * 4) return -1
    return (y >> 2) * this.columns + (x >> 1)
  }

  /** A stroke, sampled finely enough that it never skips a dot. */
  private line(a0: number, c0: number, a1: number, c1: number, color: number, prio: number): void {
    const n = Math.ceil(Math.max(Math.abs(a1 - a0), Math.abs(c1 - c0)) * 1.5) + 1
    for (let k = 0; k <= n; k++) this.plot(a0 + ((a1 - a0) * k) / n, c0 + ((c1 - c0) * k) / n, color, prio)
  }

  /**
   * The shield: an arc of light ahead of the bow, faint at 1 and brighter
   * and busier with the level, shimmering along its length, with each
   * strike's ripple running out from where it hit.
   */
  private drawShield(level: number): void {
    const { Cd, c0, sw } = this.geo
    const smoke = this.tint === 'smoke'
    const blue = this.tint === 'blue'
    const ramp = smoke ? C.shieldSmoke : blue ? C.shieldBlue : C.shield
    const base = smoke ? 0.55 + level * 0.03 : 0.16 + level * 0.045 + (blue ? 0.22 : 0)
    const busy = level / 10
    // Smoke: the shield stutters, whole stretches dropping out and the rest guttering.
    const gutter = smoke ? (hash(this.seedBase + (this.t >> 2) * 13) < 0.3 ? 0.35 : 0.75) : 1
    for (let c = Math.max(0, c0 - sw) + 0.25; c < Math.min(Cd, c0 + sw); c += 0.5) {
      if (smoke && hash(((c / 3) | 0) * 131 + (this.t >> 1) * 7 + this.seedBase) < 0.4) continue
      let I = base
      for (const hit of this.hits) {
        const d = Math.abs(c - hit.c)
        const front = hit.age * (0.9 + hit.size * 0.25)
        const fade = 1 - hit.age / RIPPLE
        const power = 0.5 + hit.size * 0.25
        I += Math.max(0, 1 - Math.abs(d - front) / 2.2) * fade * power // the ring running out
        if (d < front) I += 0.25 * fade * power // and the lit stretch behind it
        if (hit.age < FLASH && d < 3 + hit.size) I += 1
      }
      // The glow behind it follows the level and the strikes; the edge also shimmers, busier with the level.
      const lightI = I * gutter
      I = (I + busy * 0.22 * (0.5 + 0.5 * Math.sin(c * 0.45 - this.t * 0.31)) + busy * 0.12 * hash((c | 0) * 31 + this.t * 17)) * gutter
      // Its tips fade out rather than stop.
      const tip = Math.min(1, (sw - Math.abs(c - c0)) / 2.5)
      I *= tip
      if (I < 0.08) continue
      const a = this.arcA(c)
      const color = ramp[Math.min(ramp.length - 1, Math.floor(I * (ramp.length - 0.5)))]!
      this.plot(a, c, color, P.shield)
      this.plot(a + 1, c, color, P.shield)
      if (blue || I > 0.9) this.plot(a + 2, c, color, P.shield) // glowing hard: a thicker edge
      const cell = this.cellAt(a, c)
      if (cell >= 0 && !smoke && lightI * tip > this.glow[cell]!) this.glow[cell] = lightI * tip
    }
  }

  /** A strike's flash: an orange-white bloom on the shield, shrinking and cooling over a few frames. */
  private drawFlashes(out: Cells): void {
    const w = this.columns
    for (const hit of this.hits) {
      if (hit.age >= FLASH) continue
      const rf = (3 + hit.size * 1.6) * (1 - hit.age / (FLASH + 1))
      // Cell centers within rf dots of the strike (dots are square; a cell is 2 × 4).
      const vertical = this.isVertical
      const x = vertical ? hit.c : hit.a
      const y = vertical ? this.rows * 4 - hit.a : hit.c
      const c0 = Math.max(0, Math.floor((x - rf) / 2))
      const c1 = Math.min(w - 1, Math.floor((x + rf) / 2))
      const r0 = Math.max(0, Math.floor((y - rf) / 4))
      const r1 = Math.min(this.rows - 1, Math.floor((y + rf) / 4))
      for (let row = r0; row <= r1; row++)
        for (let col = c0; col <= c1; col++) {
          const d = Math.hypot(col * 2 + 1 - x, row * 4 + 2 - y) / rf
          if (d >= 1) continue
          const cell = row * w + col
          const bg = C.flash[Math.min(3, Math.floor(d * 2 + hit.age * 0.7))]!
          const cp = out.codePoint(cell)
          out.set(cell, cp, cp === 0x20 ? DEFAULT_COLOR : C.flash[0], bg)
        }
    }
  }

  /** Mark the cells within `rad` dots of (a, c) whose centers lie inside the rock. */
  private cover(a: number, c: number, rad: number): void {
    const vertical = this.isVertical
    const H = this.rows * 4
    const x = vertical ? c : a
    const y = vertical ? H - a : c
    const c0 = Math.max(0, Math.floor((x - rad) / 2))
    const c1 = Math.min(this.columns - 1, Math.floor((x + rad) / 2))
    const r0 = Math.max(0, Math.floor((y - rad) / 4))
    const r1 = Math.min(this.rows - 1, Math.floor((y + rad) / 4))
    for (let row = r0; row <= r1; row++)
      for (let col = c0; col <= c1; col++) {
        const dx = col * 2 + 1 - x
        const dy = row * 4 + 2 - y
        if (dx * dx + dy * dy < rad * rad * 0.7) this.solid[row * this.columns + col] = 1
      }
  }

  /** A lumpy rock: an outline of 6-10 corners at jittered radii, turning as it tumbles, glowing as it nears the shield. */
  private drawRock(rock: Rock): void {
    const r = ROCK_R[rock.size]!
    const n = 6 + rock.size * 2
    const gap = rock.a - r - this.arcA(rock.c)
    const heat = gap < 12 ? Math.ceil((1 - gap / 12) * 3) / 3 : 0
    const color = mix(C.rock[rock.size]!, C.hot, heat * 0.8)
    this.cover(rock.a, rock.c, r)
    let pa = 0
    let pc = 0
    for (let i = 0; i <= n; i++) {
      const j = i % n
      const ang = rock.ang + (j / n) * TAU
      const rr = r * (0.7 + 0.45 * hash(rock.seed * 16 + j))
      const a = rock.a + Math.cos(ang) * rr
      const c = rock.c + Math.sin(ang) * rr
      if (i > 0) this.line(pa, pc, a, c, color, P.rock)
      pa = a
      pc = c
    }
    if (rock.size === 2) {
      const ca = rock.ang + hash(rock.seed) * TAU
      this.plot(rock.a + Math.cos(ca) * r * 0.35, rock.c + Math.sin(ca) * r * 0.35, C.rock[1], P.rock)
    }
  }

  /** Smoke puffs as shade glyphs, dense near the engine, thinning as they drift off. */
  private drawSmoke(): void {
    for (const m of this.smoke) {
      const cell = this.cellAt(m.a, m.c)
      if (cell < 0) continue
      const young = m.life / m.max > 0.5
      if (this.puff[cell] === 0x2592) continue // a thicker puff already holds the cell
      this.puff[cell] = young ? 0x2592 : 0x2591 // ▒ ░
      this.puffColor[cell] = young ? C.smoke : C.smokeThin
    }
  }

  /**
   * The hull at a flight-frame point (s = dots from the stern, d = across
   * from the spine): writes its color and kind into `px`. The habitat's
   * three blades twist round the spine; each one's side-on height is its
   * radius × sin(angle), and cos(angle) says how squarely it faces us.
   */
  private hullAt(s: number, d: number, plume: number, lit: number, px: { color: number; kind: number }): void {
    const geo = this.geo
    px.kind = K.none
    px.color = 0
    const ad = Math.abs(d)
    if (s < 0) {
      // The ion plume, tapering out behind the engine.
      if (-s > plume) return
      const f = -s / plume
      if (ad > 2.6 * (1 - f) + 0.6) return
      const smoke = this.tint === 'smoke'
      const ramp = smoke ? C.plumeSmoke : C.plume
      px.kind = K.hull
      px.color = ramp[Math.min(ramp.length - 1, Math.floor(f * ramp.length + (ad > 1.2 ? 1 : 0)))]!
      return
    }
    const Ls = geo.aN - geo.aS
    if (s >= Ls) return
    if (s < geo.E) {
      // The engine block: a nozzle flaring at the very back.
      const hw = s < 2 ? geo.hw - 1 + s * 0.5 : geo.hw
      if (ad >= hw) return
      px.kind = K.hull
      px.color = C.engine[ad > hw - 1.2 ? 0 : s < 2 ? 1 : 2]!
      return
    }
    if (s >= geo.b0) {
      // The bow: a rounded nose, the shield's emitter at its tip.
      const f = (s - geo.b0) / (Ls - geo.b0)
      const hw = (0.9 + 2.4 * Math.sqrt(Math.max(0, 1 - f * f))) * SHIP_SCALE
      if (ad >= hw) return
      px.kind = K.hull
      px.color = f > 0.82 ? C.emitter : C.bow[ad < hw * 0.5 ? 1 : 0]!
      return
    }
    const inSpine = ad < 2
    if (s >= geo.h0 && s < geo.h1) {
      // Hubs at both ends of the habitat, where the blades meet the spine.
      if ((s < geo.h0 + 2 || s >= geo.h1 - 2) && ad < geo.R * 0.4) {
        px.kind = K.hull
        px.color = C.hub
        return
      }
      const twist = (TAU * 0.55) / (geo.h1 - geo.h0)
      let bestZ = -2
      let bestK = -1
      let bestY = 0
      for (let k = 0; k < 3; k++) {
        const phi = this.spin + (k * TAU) / 3 + twist * (s - geo.h0)
        const y = geo.R * Math.sin(phi)
        const z = Math.cos(phi)
        // A blade is a broad ribbon: wider seen face-on than edge-on.
        if (Math.abs(d - y) < 1.05 + 0.85 * Math.abs(z) && z > bestZ) {
          bestZ = z
          bestK = k
          bestY = y
        }
      }
      if (bestK >= 0 && (bestZ > 0 || !inSpine)) {
        px.kind = K.hull
        // A row of windows down the middle of each blade, every other step along it.
        const j = Math.floor((s - geo.h0) / 2)
        const pane = (j & 1) === 0 && Math.abs(d - bestY) < 1 && hash((bestK * 977 + j) * 31 + 7) < lit
        if (bestZ > 0) {
          px.color = C.bladeFront[Math.min(2, Math.floor(bestZ * 3))]!
          // Subagents switch more of them on; now and then one blinks off.
          if (pane && bestZ > 0.45 && (this.t >> 5) % 23 !== (bestK * 7 + j) % 23) {
            px.kind = K.window
            px.color = this.tint === 'smoke' ? C.windowDim : C.window
          }
        } else px.color = pane && bestZ < -0.6 ? C.windowBack : C.bladeBack[bestZ > -0.5 ? 1 : 0]!
        return
      }
    }
    if (inSpine) {
      px.kind = K.spine
      px.color = C.spine
    }
  }

  /**
   * The ship: its hull pixels folded into quadrant glyphs; cells holding only
   * bare spine are drawn as an open braille truss instead.
   */
  private drawShip(out: Cells, level: number): void {
    const geo = this.geo
    const vertical = this.isVertical
    const w = this.columns
    const h = this.rows
    const Hd = h * 4
    const smoke = this.tint === 'smoke'
    const flick = hash(this.seedBase + this.t * 5)
    let plume = (2 + level * 1.5) * (0.85 + flick * 0.3)
    if (smoke) plume = flick < 0.35 ? 0 : plume * 0.5 // a failed command: the engine misfires
    plume = Math.min(plume, geo.aS - 1)
    const lit = Math.min(1, 0.45 + this.coverageBoost / 100)
    // The ship's box, in cells.
    const a0 = geo.aS - plume - 1
    const a1 = geo.aN + 1
    const span = Math.max(geo.R + 2.5, geo.hw + 1)
    const cLo = geo.c0 - span
    const cHi = geo.c0 + span
    const x0 = Math.max(0, Math.floor((vertical ? cLo : a0) / 2))
    const x1 = Math.min(w - 1, Math.floor((vertical ? cHi : a1) / 2))
    const y0 = Math.max(0, Math.floor((vertical ? Hd - a1 : cLo) / 4))
    const y1 = Math.min(h - 1, Math.floor((vertical ? Hd - a0 : cHi) / 4))
    const px = { color: 0, kind: 0 }
    const q = this.q
    const f = this.fit
    for (let row = y0; row <= y1; row++)
      for (let col = x0; col <= x1; col++) {
        const cell = row * w + col
        let hull = false
        let spine = false
        let keep = -1
        for (let p = 0; p < 4; p++) {
          // The pixel's center in dots: half a cell across, two dots down.
          const X = col * 2 + (p & 1) + 0.5
          const Y = row * 4 + (p & 2 ? 2 : 0) + 1
          const a = vertical ? Hd - Y : X
          const c = vertical ? X : Y
          this.hullAt(a - geo.aS, c - geo.c0, plume, lit, px)
          const k = cell * 4 + p
          this.pk[k] = px.kind
          this.pc[k] = px.color
          if (px.kind >= K.hull) hull = true
          else if (px.kind === K.spine) spine = true
          if (px.kind === K.window && keep < 0) keep = p
        }
        if (!hull && !spine && this.inside(col, row)) {
          out.blank(cell) // the stars don't show through the ship
          continue
        }
        if (hull) {
          for (let p = 0; p < 4; p++) q[p] = this.pk[cell * 4 + p] ? this.pc[cell * 4 + p]! : 0
          fitQuad(q, f, NEAR, keep)
          if (f.spread === 0) {
            out.set(cell, 0x2588, q[0]!)
            continue
          }
          let mask = f.mask
          let fg = f.fg
          let bg = f.bg
          if (fg === 0) {
            // The empty pixels are the background: the hull is the glyph.
            mask ^= 15
            fg = bg
            bg = 0
          }
          out.set(cell, QUAD[mask]!, fg, bg === 0 ? DEFAULT_COLOR : bg)
        } else if (spine) {
          // An open truss: two rails and a zigzag between them.
          let bits = 0
          for (let dx = 0; dx < 2; dx++)
            for (let dy = 0; dy < 4; dy++) {
              const X = col * 2 + dx + 0.5
              const Y = row * 4 + dy + 0.5
              const a = vertical ? Hd - Y : X
              const c = vertical ? X : Y
              const j = Math.floor(c - geo.c0 + 2) // 0..3 across the spine
              if (j < 0 || j > 3) continue
              const i = ((Math.floor(a) % 6) + 6) % 6
              const rail = j === 0 || j === 3
              const brace = i === j + 1 || i === 6 - j - 1
              if (rail || brace) bits |= BRAILLE[dx]![dy]!
            }
          if (bits) out.set(cell, 0x2800 | bits, C.truss)
        }
      }
  }

  /** Whether a cell's center lies inside the ship's silhouette (the habitat as a solid drum). */
  private inside(col: number, row: number): boolean {
    const geo = this.geo
    const X = col * 2 + 1
    const Y = row * 4 + 2
    const s = (this.isVertical ? this.rows * 4 - Y : X) - geo.aS
    const d = Math.abs((this.isVertical ? X : Y) - geo.c0)
    if (s < 0 || s >= geo.aN - geo.aS) return false
    if (s >= geo.h0 && s < geo.h1) return d < geo.R + 1
    return d < (s < geo.E ? geo.hw : 2)
  }

  frame(): string {
    return this.grid().encode()
  }
}

export const avalonScene = defineScene({
  name: 'avalon',
  aliases: ['colony', 'interstellar'],
  blurb: 'a colony ship whose shield burns up the asteroids that hit it',
  make: seed => new Colony(seed),
})
