// REVISION: flow-v61-names
//
// Engine (the `engine` style): a Victorian steam engine room on the same dials
// as the fire; the level is how hard it is being driven. At 1 it stands cold,
// a dim glow in the firebox and the odd wisp from the safety valve. As the
// level climbs, everything turns together off one crank angle (its speed
// eases toward each level's target, so the room spins up and runs down
// smoothly): the flywheel, the piston in its cut-away cylinder, the
// connecting rod and valve gear, the governor's flying balls, a line shaft
// with its pulleys and leather belts, trains of meshing cogs (each turning at
// its gear ratio, neighbours in opposite directions), a cam-driven trip
// hammer, a rocking beam pump, a grindstone throwing sparks, gauges, brick
// smokestacks. By 10 spokes and teeth blur, belts race, steam pours and
// sparks fly.
//
// The band lays it out sideways: the mill engine on the left, then a line
// shaft along the top driving a run of machinery modules chosen to fill the
// width. A tall spine stacks a vertical engine (flywheel at the foot,
// cylinder, boiler, chimney) with belts running up both sides to a line shaft
// overhead, gear trains beside the crosshead, and steam room at the top.
//
// Drawing happens on two sub-cell canvases: solid parts on a quadrant grid
// (2×2 a cell, rendered as quadrant blocks with a fg and bg color) and the
// moving parts on a braille dot grid (2×4 a cell, the same x resolution).
// Steam is a density field at dot resolution, drawn as dithered braille.
// Subagents (the coverage boost) light lamps along the bed plate and thicken
// the steam; smoke makes the engine sputter, the chimney pour sooty black
// smoke (even cold) and the lamps burn low; a nearly-full context turns the
// firebox to a blue gas flame, the steam and gauges blue-white, and blinks a
// blue lamp on the boiler.

import { Cells, DEFAULT_COLOR, Rng } from './cells'
import type { Tint } from './styles'
import { BRAILLE, clamp01, dist, mix, QUAD } from './pixels'

/** Crank radians per frame at each level (0 = off, 1 = cold and still). */
const SPEED = [0, 0, 0.035, 0.07, 0.11, 0.15, 0.2, 0.26, 0.32, 0.39, 0.46]
const MAX_SPEED = SPEED[10]!
const SPOKES = 6
/** The line shaft turns this many times per crank turn. */
const SHAFT_RATIO = 1.6
/** Gear pitch radius per tooth, in dots (all gears share one tooth pitch, so they mesh). */
const PITCH = 0.36

const C = {
  brass: 0xc8a24a,
  brassHi: 0xe8c66a,
  brassDk: 0x8f7230,
  copper: 0xb8733a,
  copperDk: 0x8a5228,
  iron: 0x5a5f66,
  ironLt: 0x8a9199,
  ironDk: 0x3a3e44,
  steel: 0xc6ced6,
  cavity: 0x1d1f23,
  face: 0xe6dcc0,
  needle: 0x2b211a,
  needleHot: 0xc0301c,
  lampOn: 0xffb43a,
  lampLow: 0x6a4818,
  lampBlue: 0x8cc4ff,
  blue: 0x3c8cff,
  blueOff: 0x2a3440,
  spark: 0xffb040,
  leather: 0x9a6236,
  leatherHi: 0xc48a52,
  wood: 0x8c6236,
  brick: 0x8a3a28,
  brickDk: 0x6a2c20,
  stone: 0xa89878,
  stoneDk: 0x6e6450,
  wallBrick: 0x3c2520,
  wallMortar: 0x221714,
}

/** Firebox ramp, cold to roaring: deep red → orange → yellow-white. */
const FIRE = [0x2a0805, 0x4a0d08, 0x7a160c, 0xb02a12, 0xd8501a, 0xf08a24, 0xffc246, 0xffe9a8] as const
/** A nearly-full context: the firebox burns like a gas flame, deep blue → blue-white. */
const BLUE_FIRE = [0x0c1640, 0x13286a, 0x1c3c9a, 0x2a58c8, 0x3c7cf0, 0x6aa6ff, 0xa8d0ff, 0xeef6ff] as const

const BRAILLE_BASE = 0x2800
/** 4×4 ordered dither, 0..15. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const

const MAX_PUFFS = 200
const MAX_SPARKS = 64
const TAU = Math.PI * 2

/** Machinery modules along the band. */
const TRAIN = 0
const HAMMER = 1
const STACK = 2
const BEAM = 3
const PANEL = 4
const GRIND = 5
const PIPE = 6
/** Spine only: a cam lifting a striker against a bell. */
const BELL = 7
const WIDTH = [0, 34, 12, 44, 26, 28, 0, 0]

/** `rim`: only the teeth are drawn (a ring gear cut on the flywheel's rim). */
type Gear = { x: number; y: number; n: number; r: number; phase: number; s: number; color: number; rim?: boolean }
type Pulley = { x: number; y: number; r: number; phase: number; s: number; color: number; spokes: number }
type Belt = { x1: number; y1: number; r1: number; x2: number; y2: number; r2: number; v: number; crossed: boolean }
type Module = { kind: number; x: number; y: number; w: number; s: number; phase: number; prev: number }
type Shaft = { y: number; x0: number; x1: number; s: number }
type Gauge = { col: number; row: number; wc: number; bias: number }
type Emitter = { x: number; y: number; kind: number }

const frac = (n: number) => n - Math.floor(n)

function fireColor(h: number, ramp: readonly number[] = FIRE): number {
  const x = clamp01(h) * (ramp.length - 1)
  const i = Math.min(ramp.length - 2, Math.floor(x))
  return mix(ramp[i]!, ramp[i + 1]!, x - i)
}

/** Solid colors are stored +1 so 0 can mean "empty" (and pure black still works). */
const SOLID = 0x1000000

export class Engine {
  strength = 8
  coverageBoost = 0
  tint: Tint = 'normal'
  private columns = 0
  private rows = 0
  private out = new Cells(0, 0)
  private rng: Rng
  private seed: number
  private t = 0

  // Canvases: quadrant solids, braille linkage, steam density, sparks.
  private quad = new Uint32Array(0)
  private bits = new Uint8Array(0)
  private bcol = new Uint32Array(0)
  private bpri = new Uint8Array(0)
  private steam = new Float32Array(0)
  private spark = new Uint8Array(0)
  private qs = new Uint32Array(4)
  private qcols = new Uint32Array(4)
  private qcounts = new Uint8Array(4)

  // Motion state.
  private angle = 0
  private omega = 0
  private heat = 0.05
  private pressure = 0
  private lastHalf = 0
  private sputter = 0

  // Steam puffs and sparks, as parallel arrays (no per-frame allocation).
  private nPuffs = 0
  private px = new Float32Array(MAX_PUFFS)
  private py = new Float32Array(MAX_PUFFS)
  private pvx = new Float32Array(MAX_PUFFS)
  private pvy = new Float32Array(MAX_PUFFS)
  private pr = new Float32Array(MAX_PUFFS)
  private pgrow = new Float32Array(MAX_PUFFS)
  private pamp = new Float32Array(MAX_PUFFS)
  private page = new Float32Array(MAX_PUFFS)
  private plife = new Float32Array(MAX_PUFFS)
  private nSparks = 0
  private sx = new Float32Array(MAX_SPARKS)
  private sy = new Float32Array(MAX_SPARKS)
  private svx = new Float32Array(MAX_SPARKS)
  private svy = new Float32Array(MAX_SPARKS)
  private slife = new Float32Array(MAX_SPARKS)

  // The machinery, built by layout().
  private gears: Gear[] = []
  private pulleys: Pulley[] = []
  private belts: Belt[] = []
  private modules: Module[] = []
  private gauges: Gauge[] = []
  private emitters: Emitter[] = []
  private hangers: number[] = []
  private shafts: Shaft[] = []
  private shaftY = 0
  /** Spine: cells with the engine-house brick wall behind them. */
  private wall = new Uint8Array(0)
  /** Spine: the gauge riser pipe (x, top y, bottom y in dots), x < 0 = none. */
  private riserX = -1
  private riserY0 = 0
  private riserY1 = 0
  private shaft2Y = -1

  // The main engine's geometry (dots), recomputed by layout().
  private vertical = false
  private ey = 0
  private cx = 0
  private cy = 0
  private ux = 1
  private uy = 0
  private vx = 0
  private vy = -1
  private radius = 9.6
  private crank = 5.2
  private rodLen = 21
  private cyl0 = 0
  private cyl1 = 0
  private pistonOffset = 0
  private halfT = 4
  private chimX = 0
  private chimY = 0
  private valveX = 0
  private valveY = 0
  private govX = 0
  private govY = 0
  private govArm = 5.5
  private govBase = 0
  private boilerTop = 0
  private boilerBottom = 0

  constructor(seed?: number) {
    this.seed = (seed ?? Date.now()) >>> 0
    this.rng = new Rng(seed)
  }

  ensure(columns: number, rows: number): void {
    if (columns === this.columns && rows === this.rows) return
    this.columns = columns
    this.rows = rows
    this.out = new Cells(columns, rows)
    this.quad = new Uint32Array(columns * 2 * rows * 2)
    this.bits = new Uint8Array(columns * rows)
    this.bcol = new Uint32Array(columns * rows)
    this.bpri = new Uint8Array(columns * rows)
    this.spark = new Uint8Array(columns * rows)
    this.steam = new Float32Array(columns * 2 * rows * 4)
    this.nPuffs = 0
    this.nSparks = 0
    this.layout()
  }

  // ---- layout -------------------------------------------------------------

  private addPulley(x: number, y: number, r: number, s: number, color: number, spokes = 3): void {
    this.pulleys.push({ x, y, r, phase: 0, s, color, spokes })
  }

  /** A belt from pulley 1 to pulley 2; returns pulley 2's speed ratio. */
  private addBelt(x1: number, y1: number, r1: number, s1: number, x2: number, y2: number, r2: number, crossed = false): number {
    this.belts.push({ x1, y1, r1, x2, y2, r2, v: s1 * r1, crossed })
    return ((crossed ? -1 : 1) * s1 * r1) / r2
  }

  private addGear(x: number, y: number, n: number, s: number, phase: number, color: number): Gear {
    const g = { x, y, n, r: n * PITCH, phase, s, color }
    this.gears.push(g)
    return g
  }

  /** A gear meshing with `a`, centred at height y (dx from the pitch circles); turns the other way. */
  private meshGear(a: Gear, n: number, y: number, side: number, color: number): Gear {
    const r = n * PITCH
    const dist = a.r + r + 0.5
    const dy = Math.max(-dist * 0.85, Math.min(dist * 0.85, y - a.y))
    const dx = side * Math.sqrt(dist * dist - dy * dy)
    return this.meshAt(a, n, dx, dy, color)
  }

  /** A gear meshing with `a`, its centre offset (dx, dy) along the line of centres. */
  private meshAt(a: Gear, n: number, dx: number, dy: number, color: number): Gear {
    const beta = Math.atan2(dy, dx)
    // Keep a tooth of `a` meeting a gap of the new gear at the contact point.
    const phase = beta + Math.PI - (Math.PI - a.n * (beta - a.phase)) / n
    return this.addGear(a.x + dx, a.y + dy, n, (-a.s * a.n) / n, phase, color)
  }

  /** Where everything sits, in dots: the band runs sideways, the spine stands up. */
  private layout(): void {
    const wd = this.columns * 2
    const hd = this.rows * 4
    this.vertical = this.rows > this.columns
    this.gears = []
    this.pulleys = []
    this.belts = []
    this.modules = []
    this.gauges = []
    this.emitters = []
    this.hangers = []
    this.shafts = []
    this.wall = new Uint8Array(this.columns * this.rows)
    this.riserX = -1
    this.shaft2Y = -1
    if (!this.vertical) {
      const ex = wd >= 100 ? 2 : 0
      const ey = hd - 20
      this.ey = ey
      this.radius = 9.6
      this.cx = ex + 20
      this.cy = ey + 10
      this.ux = 1
      this.uy = 0
      this.vx = 0
      this.vy = -1
      this.crank = 5.2
      this.rodLen = 20.5
      this.halfT = 4
      this.chimX = ex + 80
      this.chimY = ey + 2
      this.valveX = ex + 73.5
      this.valveY = ey + 4
      this.govX = ex + 41
      this.govY = ey + 0.5
      this.govArm = 5.2
      this.govBase = this.cy - 2.5
    } else {
      const mid = Math.floor(wd / 2)
      this.ey = 0
      this.radius = Math.max(8, Math.min(12, mid - 4))
      this.cx = mid
      this.cy = hd - 3 - this.radius
      this.ux = 0
      this.uy = -1
      this.vx = 1
      this.vy = 0
      this.crank = this.radius * 0.52
      this.rodLen = this.crank * 2.9
      this.halfT = 4.5
    }
    // The cylinder sits past the crosshead's travel; the piston runs its length.
    const near = this.rodLen - this.crank
    this.cyl0 = this.rodLen + this.crank + (this.vertical ? 5 : 4.5)
    this.pistonOffset = this.cyl0 + 3 - near
    this.cyl1 = this.cyl0 + 3 + this.crank * 2 + 3
    this.emitters.push({ x: 0, y: 0, kind: 0 }) // the engine's own chimney (placed below)
    if (this.vertical) this.layoutSpine(wd)
    else this.layoutBand(wd)
    this.emitters[0]!.x = this.chimX
    this.emitters[0]!.y = this.chimY
  }

  private layoutSpine(wd: number): void {
    const hd = this.rows * 4
    const cylTop = this.cy - this.cyl1
    // Boiler above the cylinder with a second line shaft between them;
    // chimney on the boiler; steam room above that.
    this.boilerBottom = Math.floor((cylTop - 7) / 2)
    this.boilerTop = this.boilerBottom - 7
    this.chimX = this.cx + 3
    this.chimY = (this.boilerTop - 3) * 2
    this.valveX = this.cx - 5.5
    this.valveY = this.boilerTop * 2 - 1
    const avail = this.cx - this.halfT - 1.5
    this.govX = Math.max(2, avail / 2)
    this.govArm = Math.max(2.5, Math.min(5.2, avail / 2 - 0.3))
    this.govY = cylTop + 2.5
    this.govBase = this.govY + this.govArm + 2
    const wallRow = Math.max(0, Math.floor((this.boilerTop * 2) / 4))
    for (let i = wallRow * this.columns; i < this.wall.length; i++) this.wall[i] = 1

    // Overhead shaft; a belt at the right steps down to the second shaft.
    this.shaftY = 2
    this.shafts.push({ y: 2, x0: 0, x1: wd, s: SHAFT_RATIO })
    this.hangers.push(Math.floor(wd * 0.3), Math.floor(wd * 0.7))
    const s2y = this.boilerBottom * 2 + 3
    this.shaft2Y = s2y
    const rX = wd - 3.5
    this.addPulley(rX, 2.5, 2, SHAFT_RATIO, C.ironLt)
    const s2 = this.addBelt(rX, 2.5, 2, SHAFT_RATIO, rX, s2y + 0.5, 2.6)
    this.addPulley(rX, s2y + 0.5, 2.6, s2, C.brass)
    this.shafts.push({ y: s2y, x0: 0, x1: wd, s: s2 })

    // In the steam room: a cam lifting a striker against a bell (left), and a
    // gauge cluster on a riser from the boiler (right, clear of the plume).
    const camX = Math.max(3.5, Math.min(6, this.cx * 0.4))
    const camY = this.boilerTop * 2 - 6
    if (camY - 15 > 4) {
      this.addPulley(camX + 3.5, 2.5, 2, SHAFT_RATIO, C.ironLt)
      const sc = this.addBelt(camX + 3.5, 2.5, 2, SHAFT_RATIO, camX, camY, 1.1)
      this.modules.push({ kind: BELL, x: camX, y: camY, w: 0, s: sc, phase: 0, prev: 0 })
    }
    const gc = this.columns - 5
    const gr = Math.floor((this.boilerTop * 2) / 4) - 2
    if (gc * 2 >= this.chimX + 3 && gr >= 2) {
      const two = gr - 2 >= 1
      this.gaugeAt(gc, gr, 0.1)
      if (two) this.gaugeAt(gc, gr - 2, -0.15)
      this.riserX = gc * 2 + 1
      this.riserY0 = (two ? gr - 2 : gr) * 4 + 2
      this.riserY1 = this.boilerTop * 2
    }
    this.gaugeAt(Math.floor(this.cx / 2) - 2, Math.floor((this.boilerTop * 2 + 5) / 4), 0)

    // Gear trains packed down both sides to the floor: the left one off the
    // governor's spindle, the right one belted from the second shaft.
    const fits = (x: number, y: number, r: number, parent: Gear | undefined) => this.gearFits(x, y, r, parent, wd, hd)
    const left = this.startGear(this.govX, this.govBase, s2 * 1.25, 0.4, C.brass, fits, false)
    if (left) {
      this.govBase = left.y
      this.packChain(left, fits, 0)
    }
    const right = this.startGear(wd - 4, s2y + 5, 0, 1.3, C.copper, fits, true)
    if (right) {
      right.s = this.addBelt(rX, s2y + 0.5, 1.5, s2, right.x, right.y, 1.4)
      this.addPulley(rX, s2y + 0.5, 1.5, s2, C.brassHi, 0)
      this.addPulley(right.x, right.y, 1.4, right.s, C.brassHi, 0)
      this.packChain(right, fits, 1)
    }
    // Teeth cut on the flywheel's rim drive pinions tucked round it. In the
    // spine's frame (u up, v right) the wheel turns +1 on screen with the crank.
    const wn = Math.ceil((this.radius + 0.4) / PITCH)
    const wheel = this.addGear(this.cx, this.cy, wn, 1, Math.PI / 2, C.ironLt)
    wheel.rim = true
    const angles = [-0.6, -2.54, -0.25, -2.89, 0.15, -3.29, 0.5, -3.64]
    for (let k = 0; k < angles.length; k++) {
      for (let n = 10; n >= 6; n--) {
        const r = n * PITCH
        const dist = wheel.r + r + 0.5
        const dx = Math.cos(angles[k]!) * dist
        const dy = Math.sin(angles[k]!) * dist
        if (!this.gearFits(this.cx + dx, this.cy + dy, r, wheel, wd, hd, true)) continue
        const p = this.meshAt(wheel, n, dx, dy, k & 1 ? C.brass : C.copper)
        this.packChain(p, fits, 2 + k)
        break
      }
    }
    // Then pack idler gears into whatever room is left, each meshing with
    // exactly one gear already placed (and clear of all the others).
    const colors = [C.brass, C.copper, C.ironLt, C.brassHi]
    for (let pass = 0; pass < 4; pass++) {
      const count = this.gears.length
      let added = 0
      for (let i = 0; i < count; i++) {
        const o = this.gears[i]!
        for (let k = 0; k < 16; k++) {
          const ang = (k / 16) * TAU + pass * 0.2
          for (let n = 10; n >= 6; n--) {
            const r = n * PITCH
            const dist = o.r + r + 0.5
            const dx = Math.cos(ang) * dist
            const dy = Math.sin(ang) * dist
            if (!this.gearFits(o.x + dx, o.y + dy, r, o, wd, hd, o === wheel)) continue
            this.meshAt(o, n, dx, dy, colors[(i + k) & 3]!)
            added++
            break
          }
        }
      }
      if (!added) break
    }
  }

  /** Room for a gear (pitch radius r) at (x, y) in the spine, clear of the engine and other gears. */
  private gearFits(x: number, y: number, r: number, parent: Gear | undefined, wd: number, hd: number, onWheel = false): boolean {
    const tip = r + 1
    if (x - tip < 0 || x + tip > wd || y + tip > hd - 2.5) return false
    if (y - tip < this.shaft2Y + 2) return false
    const wx = x - this.cx
    const wy = y - this.cy
    if (!onWheel && Math.sqrt(wx * wx + wy * wy) < this.radius + tip + 2.2) return false
    const cylTop = this.cy - this.cyl1
    const cylBottom = this.cy - this.cyl0
    if (y + tip > cylTop - 1 && y - tip < this.cy - this.radius + 3) {
      const core = y - tip < cylBottom + 1 ? (x > this.cx ? this.halfT + 3.6 : this.halfT + 1.4) : 6.2
      if (Math.abs(wx) < core + tip) return false
    }
    if (x < this.cx && x - tip < this.govX + this.govArm + 1 && y - tip < this.govY + this.govArm + 1.5) return false
    for (let i = 0; i < this.gears.length; i++) {
      const o = this.gears[i]!
      if (o === parent) continue
      const dx = o.x - x
      const dy = o.y - y
      if (Math.sqrt(dx * dx + dy * dy) < o.r + r + 2.4) return false
    }
    return true
  }

  /** The biggest gear that fits near (x, y), searching down the side. */
  private startGear(
    x: number,
    y: number,
    s: number,
    phase: number,
    color: number,
    fits: (x: number, y: number, r: number, p: Gear | undefined) => boolean,
    hugRight: boolean,
  ): Gear | undefined {
    const wd = this.columns * 2
    for (let n = 12; n >= 6; n--) {
      const r = n * PITCH
      const gx = hugRight ? wd - r - 1.2 : Math.max(r + 1.1, x)
      for (let gy = y + r; gy < this.rows * 4; gy += 1) if (fits(gx, gy, r, undefined)) return this.addGear(gx, gy, n, s, phase, color)
    }
    return undefined
  }

  /** Mesh gear after gear downward from `g`, zigzagging, while they fit. */
  private packChain(g: Gear, fits: (x: number, y: number, r: number, p: Gear | undefined) => boolean, seed: number): void {
    const sizes = [9, 12, 7, 10, 6, 11, 8, 13]
    const steeps = [0.75, 0.95, 0.5, 0.3, 0.1, -0.2]
    const colors = [C.copper, C.brass, C.ironLt, C.brassHi]
    let side = seed ? -1 : 1
    for (let guard = 0; guard < 24; guard++) {
      let placed: Gear | undefined
      for (let k = 0; k < sizes.length && !placed; k++) {
        const n = sizes[(seed * 3 + guard + k) % sizes.length]!
        const r = n * PITCH
        const dist = g.r + r + 0.5
        for (let a = 0; a < steeps.length && !placed; a++) {
          for (let sd = 0; sd < 2 && !placed; sd++) {
            const sgn = sd === 0 ? side : -side
            const dy = steeps[a]! * dist
            const dx = sgn * Math.sqrt(dist * dist - dy * dy)
            if (fits(g.x + dx, g.y + dy, r, g)) {
              placed = this.meshAt(g, n, dx, dy, colors[(guard + seed) % colors.length]!)
              side = -sgn
            }
          }
        }
      }
      if (!placed) return
      g = placed
    }
  }

  private gaugeAt(col: number, row: number, bias: number): void {
    this.gauges.push({ col, row, wc: 2, bias })
  }

  private layoutBand(wd: number): void {
    const ey = this.ey
    const ex = this.cx - 20
    const lay = new Rng(this.seed ^ (this.columns * 7919))
    this.shaftY = ey + 2
    this.boilerTop = Math.floor(ey / 2) + 3
    this.gaugeAt(Math.floor(this.chimX / 2) - 4, Math.floor(ey / 4) + 2, 0)
    let x = ex + 88
    this.shafts.push({ y: this.shaftY, x0: x - 2, x1: wd, s: SHAFT_RATIO })
    // Fixed-width machines, shuffled, with gear trains between them.
    const pool = [HAMMER, STACK, BEAM, PANEL, GRIND]
    let pi = pool.length
    let i = 0
    while (x < wd) {
      const left = wd - x
      let kind: number
      if (i % 2 === 0) kind = TRAIN
      else {
        if (pi >= pool.length) {
          for (let k = pool.length - 1; k > 0; k--) {
            const j = Math.floor(lay.f() * (k + 1))
            const tmp = pool[k]!
            pool[k] = pool[j]!
            pool[j] = tmp
          }
          pi = 0
        }
        kind = pool[pi++]!
      }
      i++
      let w = kind === TRAIN ? Math.min(left, 26 + Math.floor(lay.f() * 30)) : WIDTH[kind]!
      if (w > left || left - w < 10) {
        // The last stretch: a gear train fills it, or a pipe run if it's narrow.
        kind = left >= 20 ? TRAIN : PIPE
        w = left
      }
      if (kind === TRAIN) w = this.layoutTrain(x, w, lay)
      else this.layoutModule(kind, x, w)
      this.hangers.push(Math.floor(x + 1))
      x += w
    }
  }

  /** A belt-driven gear train in [x, x+w); returns the width it took. */
  private layoutTrain(x: number, w: number, lay: Rng): number {
    const ey = this.ey
    const colors = [C.brass, C.copper, C.ironLt, C.brassHi]
    let ci = Math.floor(lay.f() * 4)
    const n0 = 12 + Math.floor(lay.f() * 4)
    const r0 = n0 * PITCH
    const gx = x + r0 + 1.6
    const gy = ey + 11.5
    this.addPulley(gx, this.shaftY + 0.5, 2, SHAFT_RATIO, C.ironLt)
    const s = this.addBelt(gx, this.shaftY + 0.5, 2, SHAFT_RATIO, gx, gy, 2.2, lay.f() < 0.3)
    let g = this.addGear(gx, gy, n0, s, lay.f() * TAU, colors[ci++ % 4]!)
    this.addPulley(gx, gy, 2.2, s, C.brassHi, 0)
    const sizes = [8, 17, 9, 13, 7, 15, 10, 11, 16, 8]
    let si = Math.floor(lay.f() * sizes.length)
    let right = gx + r0 + 1.2
    for (let guard = 0; guard < 20; guard++) {
      const n = sizes[si++ % sizes.length]!
      const r = n * PITCH
      // Keep the teeth inside the band (y 4.5..18.5 above the bed).
      const lo = ey + 4.6 + r + 1.1
      const hi = ey + 18.4 - r - 1.1
      const y = lo >= hi ? ey + 11.5 : lo + lay.f() * (hi - lo)
      const dist = g.r + r + 0.5
      const dy = Math.max(-dist * 0.85, Math.min(dist * 0.85, y - g.y))
      const nx = g.x + Math.sqrt(dist * dist - dy * dy)
      if (nx + r + 1.2 > x + w) break
      g = this.meshGear(g, n, y, 1, colors[ci++ % 4]!)
      right = g.x + g.r + 1.2
    }
    return Math.min(w, Math.max(14, Math.ceil(right - x + 2)))
  }

  private layoutModule(kind: number, x: number, w: number): void {
    const ey = this.ey
    const sy = this.shaftY + 0.5
    const m: Module = { kind, x, y: 0, w, s: 0, phase: 0, prev: 0 }
    if (kind === HAMMER) {
      this.addPulley(x + 16, sy, 2, SHAFT_RATIO, C.ironLt)
      m.s = this.addBelt(x + 16, sy, 2, SHAFT_RATIO, x + 16, ey + 13.1, 1.1)
    } else if (kind === BEAM) {
      this.addPulley(x + 6, sy, 2, SHAFT_RATIO, C.ironLt)
      m.s = this.addBelt(x + 6, sy, 2, SHAFT_RATIO, x + 6, ey + 13, 1.2)
      this.addPulley(x + 6, ey + 13, 3.6, m.s, C.ironLt, 4)
      this.addPulley(x + 6, ey + 13, 1.2, m.s, C.brass, 0)
    } else if (kind === GRIND) {
      this.addPulley(x + 4, sy, 2, SHAFT_RATIO, C.ironLt)
      m.s = this.addBelt(x + 4, sy, 2, SHAFT_RATIO, x + 13, ey + 11, 2, true)
    } else if (kind === STACK) {
      this.emitters.push({ x: x + 6, y: ey + 1.5, kind: 1 })
    } else if (kind === PANEL) {
      this.gaugeAt(Math.floor((x + 5) / 2), Math.floor(ey / 4) + 1, -0.12)
      if (w >= 20) this.gaugeAt(Math.floor((x + 15) / 2), Math.floor(ey / 4) + 2, 0.08)
      this.emitters.push({ x: x + 21, y: ey + 9, kind: 2 })
    }
    this.modules.push(m)
  }

  // ---- motion ---------------------------------------------------------------

  step(): void {
    this.t++
    const level = Math.max(0, Math.min(10, Math.round(this.strength)))
    const smoke = this.tint === 'smoke'
    // A failed command makes the engine sputter: its target speed stumbles.
    if (smoke && this.rng.f() < 0.04) this.sputter = 6 + this.rng.f() * 10
    if (this.sputter > 0) this.sputter--
    const target = SPEED[level]! * (this.sputter > 0 ? 0.45 : 1)
    this.omega += (target - this.omega) * 0.045
    if (Math.abs(target - this.omega) < 0.0005) this.omega = target
    this.angle += this.omega
    if (this.angle > TAU * 1000) {
      // Every ratio here times 1000 turns is a whole number of tooth/belt periods
      // only approximately, so re-base rarely: once every ~2000 turns.
      this.angle -= TAU * 1000
    }

    const heatTarget = level <= 0 ? 0 : 0.1 + (level - 1) * 0.1
    this.heat += (heatTarget * (smoke ? 0.75 : 1) - this.heat) * 0.03
    const pTarget = level <= 0 ? 0 : Math.min(0.97, 0.06 + (level - 1) * 0.1 + this.coverageBoost * 0.001)
    this.pressure += (pTarget - this.pressure) * 0.025

    // Chuffs: a double-acting cylinder exhausts at each dead centre.
    const half = Math.floor(this.angle / Math.PI)
    if (half !== this.lastHalf) {
      this.lastHalf = half
      if (this.omega > 0.012 && level > 0 && !(smoke && this.rng.f() < 0.35)) this.chuff(level)
    }
    const extra = Math.max(0, level - 5) * 0.12 + this.coverageBoost * 0.004
    if (level >= 2 && this.rng.f() < extra) this.puff(this.chimX, this.chimY, 0.35 + this.rng.f() * 0.25, 1.2, level)
    // A failed command: the fire smoulders and the chimney pours soot, even cold.
    if (smoke && level > 0 && this.rng.f() < 0.3) this.puff(this.chimX, this.chimY, 0.75 + this.rng.f() * 0.3, 1.5 + level * 0.08, Math.max(2, level))
    // Cold, the safety valve lets a faint wisp go now and then.
    if (level > 0 && level <= 3 && this.rng.f() < (level === 1 ? 0.06 : 0.03)) this.wisp(this.valveX, this.valveY)
    if (level >= 8 && this.rng.f() < (level - 7) * 0.12 && !smoke) this.chimneySpark(level)
    // Smokestacks and leaky valves.
    for (let i = 1; i < this.emitters.length; i++) {
      const e = this.emitters[i]!
      if (e.kind === 1 && level >= 2 && this.rng.f() < 0.05 + level * 0.035 + this.coverageBoost * 0.002)
        this.puff(e.x, e.y, 0.35 + level * 0.04, 1 + level * 0.1, level)
      else if (e.kind === 2 && level >= 6 && this.rng.f() < (level - 5) * 0.02) this.wisp(e.x, e.y)
    }
    this.machineEvents(level, smoke)
    this.movePuffs()
    this.moveSparks()
  }

  /** The trip hammer's blows and the grindstone's sparks. */
  private machineEvents(level: number, smoke: boolean): void {
    for (let i = 0; i < this.modules.length; i++) {
      const m = this.modules[i]!
      if (m.kind === HAMMER) {
        const lift = this.camLift(m)
        if (lift < m.prev - 0.9 && level >= 4) {
          const n = smoke ? 1 : 1 + Math.floor(level / 3)
          for (let k = 0; k < n; k++)
            this.emitSpark(m.x + 28, this.ey + 15.5, (this.rng.f() - 0.5) * 1.6, -(0.3 + this.rng.f() * 0.6), 4 + this.rng.f() * 5)
        }
        m.prev = lift
      } else if (m.kind === GRIND && level >= 4 && !smoke) {
        if (this.rng.f() < (level - 3) * 0.12)
          this.emitSpark(m.x + 18.5, this.ey + 10.5, 0.5 + this.rng.f() * 1.1, -0.2 + this.rng.f() * 0.6, 3 + this.rng.f() * 5)
      }
    }
  }

  private camLift(m: Module): number {
    const a = m.phase + m.s * this.angle
    return 1.8 * (1 - frac((2 * (-Math.PI / 2 - a)) / TAU))
  }

  private chuff(level: number): void {
    const amp = Math.min(1.25, 0.55 + level * 0.05 + this.coverageBoost * 0.004)
    this.puff(this.chimX, this.chimY, amp, 1.6 + level * 0.16, level)
  }

  private puff(x: number, y: number, amp: number, r: number, level: number): number {
    if (this.nPuffs >= MAX_PUFFS) return -1
    const i = this.nPuffs++
    const rng = this.rng
    this.px[i] = x + (rng.f() - 0.5)
    this.py[i] = y
    if (!this.vertical) {
      this.pvx[i] = 0.35 + level * 0.07 + rng.f() * 0.15
      this.pvy[i] = -0.05 - rng.f() * 0.08
    } else {
      this.pvx[i] = (rng.f() - 0.5) * 0.45
      this.pvy[i] = -(0.3 + level * 0.05 + rng.f() * 0.15)
    }
    this.pr[i] = r
    this.pgrow[i] = (0.06 + rng.f() * 0.05 + level * 0.01) * (this.vertical ? 1.4 : 1)
    this.pamp[i] = amp
    this.page[i] = 0
    this.plife[i] = (this.vertical ? 40 : 50) + rng.f() * 24
    return i
  }

  private wisp(x: number, y: number): void {
    const i = this.puff(x, y - 1, 0.45, 0.7, 1)
    if (i < 0) return
    this.pvx[i] = this.vertical ? (this.rng.f() - 0.5) * 0.2 : 0.12 + this.rng.f() * 0.1
    this.pvy[i] = -0.12 - this.rng.f() * 0.08
    this.pgrow[i] = 0.03
    this.plife[i] = 22 + this.rng.f() * 10
  }

  private movePuffs(): void {
    const wd = this.columns * 2
    const hd = this.rows * 4
    const sway = Math.sin(this.t * 0.045) * 0.1
    for (let i = 0; i < this.nPuffs; ) {
      this.page[i]! += 1
      this.px[i]! += this.pvx[i]! + (this.vertical ? sway : 0)
      this.py[i]! += this.pvy[i]!
      this.pr[i]! += this.pgrow[i]!
      if (this.vertical) this.pvy[i]! *= 0.985
      else {
        // In the band the steam has nowhere to rise: it rolls along the top
        // and slowly spreads down as it thins.
        this.pvy[i]! += 0.008
        if (this.pvy[i]! > 0.15) this.pvy[i] = 0.15
        if (this.py[i]! < this.ey + 1.5) this.py[i] = this.ey + 1.5
      }
      const r = this.pr[i]!
      const gone =
        this.page[i]! >= this.plife[i]! ||
        this.px[i]! - r > wd ||
        this.px[i]! + r < 0 ||
        this.py[i]! + r < 0 ||
        this.py[i]! - r > hd
      if (gone) {
        const j = --this.nPuffs
        this.px[i] = this.px[j]!
        this.py[i] = this.py[j]!
        this.pvx[i] = this.pvx[j]!
        this.pvy[i] = this.pvy[j]!
        this.pr[i] = this.pr[j]!
        this.pgrow[i] = this.pgrow[j]!
        this.pamp[i] = this.pamp[j]!
        this.page[i] = this.page[j]!
        this.plife[i] = this.plife[j]!
      } else i++
    }
  }

  private emitSpark(x: number, y: number, vx: number, vy: number, life: number): void {
    if (this.nSparks >= MAX_SPARKS) return
    const i = this.nSparks++
    this.sx[i] = x
    this.sy[i] = y
    this.svx[i] = vx
    this.svy[i] = vy
    this.slife[i] = life
  }

  private chimneySpark(level: number): void {
    const rng = this.rng
    if (this.vertical) this.emitSpark(this.chimX + (rng.f() - 0.5) * 2, this.chimY, (rng.f() - 0.5) * 0.9, -(0.9 + rng.f() * 0.8), 6 + rng.f() * 10)
    else this.emitSpark(this.chimX, this.chimY, 0.5 + rng.f() * 0.9 + level * 0.04, -(0.2 + rng.f() * 0.5), 6 + rng.f() * 10)
  }

  private moveSparks(): void {
    for (let i = 0; i < this.nSparks; ) {
      this.sx[i]! += this.svx[i]!
      this.sy[i]! += this.svy[i]!
      this.svy[i]! += this.vertical ? 0.04 : 0.06
      this.slife[i]! -= 1
      if (this.slife[i]! <= 0) {
        const j = --this.nSparks
        this.sx[i] = this.sx[j]!
        this.sy[i] = this.sy[j]!
        this.svx[i] = this.svx[j]!
        this.svy[i] = this.svy[j]!
        this.slife[i] = this.slife[j]!
      } else i++
    }
  }

  // ---- canvases ---------------------------------------------------------------

  /** A solid quadrant pixel (qx in dots, qy in half-rows). */
  private q(qx: number, qy: number, color: number): void {
    const x = Math.floor(qx)
    const y = Math.floor(qy)
    if (x < 0 || y < 0 || x >= this.columns * 2 || y >= this.rows * 2) return
    this.quad[y * this.columns * 2 + x] = (color & 0xffffff) + SOLID
  }

  private qrect(x0: number, y0: number, x1: number, y1: number, color: number): void {
    for (let y = Math.floor(y0); y <= y1; y++) for (let x = Math.floor(x0); x <= x1; x++) this.q(x, y, color)
  }

  /** A braille dot (x, y in dots); the cell takes the color of its highest-priority dot. */
  private dot(x: number, y: number, color: number, pri: number): void {
    const dx = Math.floor(x)
    const dy = Math.floor(y)
    if (dx < 0 || dy < 0 || dx >= this.columns * 2 || dy >= this.rows * 4) return
    const c = (dy >> 2) * this.columns + (dx >> 1)
    this.bits[c]! |= BRAILLE[dx & 1]![dy & 3]!
    if (pri >= this.bpri[c]!) {
      this.bpri[c] = pri
      this.bcol[c] = color
    }
  }

  private line(x0: number, y0: number, x1: number, y1: number, color: number, pri: number): void {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 1.5) + 1
    for (let k = 0; k <= n; k++) {
      const f = k / n
      this.dot(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, color, pri)
    }
  }

  private dither(x: number, y: number, p: number): boolean {
    return p > (BAYER[((y & 3) << 2) | (x & 3)]! + 0.5) / 16
  }

  /** Map a point in the engine's frame (s along the stroke, t across it) to dots. */
  private fx(s: number, t: number): number {
    return this.cx + s * this.ux + t * this.vx
  }

  private fy(s: number, t: number): number {
    return this.cy + s * this.uy + t * this.vy
  }

  // ---- drawing ------------------------------------------------------------------

  grid(): Cells {
    const out = this.out
    const n = this.columns * this.rows
    const level = Math.max(0, Math.min(10, Math.round(this.strength)))
    if (level <= 0 || n === 0) {
      for (let i = 0; i < n; i++) out.blank(i)
      return out
    }
    this.quad.fill(0)
    this.bits.fill(0)
    this.bpri.fill(0)
    this.spark.fill(0)
    this.steam.fill(0)

    this.drawSteam()
    this.drawShaft()
    for (let i = 0; i < this.gears.length; i++) this.drawGear(this.gears[i]!)
    for (let i = 0; i < this.pulleys.length; i++) this.drawPulley(this.pulleys[i]!)
    for (let i = 0; i < this.modules.length; i++) this.drawModule(this.modules[i]!)
    for (let i = 0; i < this.belts.length; i++) this.drawBelt(this.belts[i]!)
    this.drawWheel()
    this.drawLinkage()
    this.drawGovernor()
    if (this.vertical) this.drawBoilerSpine()
    else this.drawBoilerBand()
    this.drawBed()
    this.drawSparks()
    this.compose()
    for (let i = 0; i < this.gauges.length; i++) this.drawGauge(this.gauges[i]!)
    return out
  }

  /** The line shaft: a twisted stripe that races along it as it turns. */
  private drawShaft(): void {
    for (let i = 0; i < this.shafts.length; i++) {
      const sh = this.shafts[i]!
      const sy = Math.floor(sh.y)
      const v = Math.abs(sh.s * this.omega * 1.2)
      const off = Math.floor(sh.s * this.angle * 1.2)
      const blur = v > 1.3
      for (let x = Math.floor(sh.x0); x < sh.x1; x++) {
        if (blur) {
          this.dot(x, sy, C.steel, 1)
          this.dot(x, sy + 1, C.ironLt, 1)
        } else this.dot(x, ((x + off) & 3) < 2 ? sy : sy + 1, C.steel, 1)
      }
    }
    const y = Math.floor(this.shaftY)
    for (let i = 0; i < this.hangers.length; i++) {
      const hx = this.hangers[i]!
      this.line(hx, y - 2, hx, y - 0.5, C.iron, 1)
      this.dot(hx - 1, y - 2, C.iron, 1)
      this.dot(hx + 1, y - 2, C.iron, 1)
    }
  }

  private drawGear(g: Gear): void {
    const a = g.phase + g.s * this.angle
    const w = Math.abs(g.s * this.omega)
    const blurT = clamp01(((w * g.n) / TAU - 0.4) / 0.5)
    const blurS = clamp01((w - 0.3) / 0.4)
    const tip = g.r + 0.95
    const spokes = g.r >= 4 ? 3 : 0
    const spacing = TAU / Math.max(1, spokes)
    const dark = mix(g.color, 0x202020, 0.35)
    const x0 = Math.floor(g.x - tip)
    const x1 = Math.ceil(g.x + tip)
    const y0 = Math.floor(g.y - tip)
    const y1 = Math.ceil(g.y + tip)
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - g.y
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - g.x
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d > tip || (g.rim && d <= g.r)) continue
        if (d <= 0.9) {
          this.dot(x, y, C.brassHi, 3)
          continue
        }
        if (d > g.r) {
          // Teeth: narrow, so the gaps read and the neighbours' teeth slot in.
          const m = frac((g.n * (Math.atan2(dy, dx) - a)) / TAU + 0.2)
          const p = (m < 0.4 ? 1 : 0) * (1 - blurT) + 0.4 * blurT
          if (this.dither(x, y, p)) this.dot(x, y, g.color, 2)
          continue
        }
        if (d > g.r - 1) {
          this.dot(x, y, g.color, 2)
          continue
        }
        if (spokes === 0) continue
        let m = (Math.atan2(dy, dx) - a) % spacing
        if (m < 0) m += spacing
        const near = Math.min(m, spacing - m) * d
        const p = (near < 0.5 ? 1 : 0) * (1 - blurS) + 0.3 * blurS
        if (this.dither(x, y, p)) this.dot(x, y, dark, 1)
      }
    }
  }

  private drawPulley(p: Pulley): void {
    const a = p.phase + p.s * this.angle
    const w = Math.abs(p.s * this.omega)
    const blur = clamp01((w - 0.3) / 0.4)
    const spacing = TAU / Math.max(1, p.spokes)
    const x0 = Math.floor(p.x - p.r)
    const x1 = Math.ceil(p.x + p.r)
    const y0 = Math.floor(p.y - p.r)
    const y1 = Math.ceil(p.y + p.r)
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - p.y
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - p.x
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d > p.r) continue
        if (d > p.r - 0.95 || d <= 0.75) {
          this.dot(x, y, p.color, 3)
          continue
        }
        if (p.spokes === 0) continue
        let m = (Math.atan2(dy, dx) - a) % spacing
        if (m < 0) m += spacing
        const near = Math.min(m, spacing - m) * d
        const pr = (near < 0.6 ? 1 : 0) * (1 - blur) + 0.35 * blur
        if (this.dither(x, y, pr)) this.dot(x, y, C.iron, 2)
      }
    }
    // A single bright mark on small pulleys so they visibly turn.
    if (p.spokes === 0 && p.r >= 1.4 && w < 0.5)
      this.dot(p.x + Math.cos(a) * (p.r - 0.5), p.y + Math.sin(a) * (p.r - 0.5), C.steel, 4)
  }

  /** Two runs of leather with a stitch pattern travelling along them. */
  private drawBelt(b: Belt): void {
    const ddx = b.x2 - b.x1
    const ddy = b.y2 - b.y1
    const len = Math.sqrt(ddx * ddx + ddy * ddy)
    if (len < 1) return
    const dx = ddx / len
    const dy = ddy / len
    const nx = -dy
    const ny = dx
    const travel = b.v * this.angle
    const speed = Math.abs(b.v * this.omega)
    const blur = speed > 1.5
    for (let side = -1; side <= 1; side += 2) {
      const ax = b.x1 + nx * b.r1 * side
      const ay = b.y1 + ny * b.r1 * side
      const s2 = b.crossed ? -side : side
      const bx = b.x2 + nx * b.r2 * s2
      const by = b.y2 + ny * b.r2 * s2
      const lx = bx - ax
      const ly = by - ay
      const l = Math.sqrt(lx * lx + ly * ly)
      const steps = Math.ceil(l)
      // The +n run moves toward pulley 1, the −n run away from it.
      const off = side > 0 ? travel : -travel
      for (let k = 0; k <= steps; k++) {
        const f = k / Math.max(1, steps)
        const ph = (((k + off) % 5) + 5) % 5
        const x = ax + lx * f
        const y = ay + ly * f
        if (blur) this.dot(x, y, (k & 1) === 0 ? C.leatherHi : C.leather, 3)
        else if (ph < 3.4) this.dot(x, y, ph < 1 ? C.leatherHi : C.leather, 3)
      }
    }
  }

  private drawModule(m: Module): void {
    const x = m.x
    const ey = this.ey
    const qy0 = Math.floor(ey / 2)
    if (m.kind === BELL) {
      // A snail cam lifts a striker rod; at the top of each lift it rings the bell.
      const a = m.phase + m.s * this.angle
      for (let yy = Math.floor(m.y - 3); yy <= m.y + 3; yy++)
        for (let xx = Math.floor(m.x - 3); xx <= m.x + 3; xx++) {
          const dx = xx + 0.5 - m.x
          const dy = yy + 0.5 - m.y
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d > 2.9) continue
          const rr = 1.5 + 1.3 * (1 - frac((2 * (Math.atan2(dy, dx) - a)) / TAU))
          if (d <= rr) this.dot(xx, yy, d < 1 ? C.brassHi : C.iron, d < 1 ? 4 : 2)
        }
      const lift = this.camLift(m) * (1.3 / 1.8)
      const top = m.y - 1.5 - lift - 9
      this.line(m.x, m.y - 2 - lift, m.x, top, C.steel, 4)
      this.dot(m.x - 1, top, C.iron, 4)
      this.dot(m.x + 1, top, C.iron, 4)
      // Guide bracket from the pillar.
      this.line(1, m.y - 6, m.x - 1, m.y - 6, C.iron, 1)
      const ring = lift > 1.05 && this.omega > 0.02
      const bq = Math.floor((m.y - 1.5 - 1.3 - 9 - 3) / 2)
      const bx = Math.floor(m.x)
      this.qrect(bx - 1, bq - 1, bx, bq - 1, ring ? C.brassHi : C.brass)
      this.qrect(bx - 2, bq, bx + 1, bq, ring ? C.brassHi : C.brassDk)
      this.line(bx - 0.5, bq * 2 - 2, 1, bq * 2 - 5, C.iron, 1)
      if (ring) {
        this.dot(bx - 4, bq * 2 + 1, C.brassHi, 3)
        this.dot(bx + 3, bq * 2 + 1, C.brassHi, 3)
        this.dot(bx - 5, bq * 2, C.brassDk, 3)
        this.dot(bx + 4, bq * 2, C.brassDk, 3)
      }
    } else if (m.kind === HAMMER) {
      // A snail cam lifts the helve, then lets the hammer fall on the anvil.
      const a = m.phase + m.s * this.angle
      const ccx = x + 16
      const ccy = ey + 13.1
      for (let yy = Math.floor(ccy - 4); yy <= ccy + 4; yy++)
        for (let xx = Math.floor(ccx - 4); xx <= ccx + 4; xx++) {
          const dx = xx + 0.5 - ccx
          const dy = yy + 0.5 - ccy
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d > 3.9) continue
          const rr = 2 + 1.8 * (1 - frac((2 * (Math.atan2(dy, dx) - a)) / TAU))
          if (d <= rr) this.dot(xx, yy, d < 1.1 ? C.brassHi : C.iron, d < 1.1 ? 4 : 2)
        }
      const lift = this.camLift(m)
      const pxv = x + 6
      const pyv = ey + 9
      const contactY = ccy - 2 - lift - 0.5
      const k = (contactY - pyv) / 10
      const hx = x + 28
      const hy = pyv + k * 22
      this.line(pxv, pyv, hx, hy, C.wood, 3)
      this.line(pxv, pyv + 1, hx, hy + 1, C.wood, 3)
      // Post, hammer head, anvil.
      this.qrect(x + 5, qy0 + 5, x + 6, qy0 + 8, C.ironDk)
      this.q(x + 5, qy0 + 4, C.brass)
      const hq = Math.floor((hy + 1) / 2)
      this.qrect(hx - 2, hq, hx + 1, hq + 1, C.iron)
      this.qrect(x + 25, qy0 + 8, x + 31, qy0 + 8, C.ironDk)
    } else if (m.kind === STACK) {
      for (let qy = qy0 + 1; qy <= qy0 + 8; qy++)
        for (let qx = x + 3; qx <= x + 8; qx++) {
          const brick = ((qx + (qy & 1) * 2) & 3) === 0 ? C.brickDk : C.brick
          this.q(qx, qy, qy === qy0 + 1 ? C.brass : brick)
        }
      this.qrect(x + 5, qy0 + 7, x + 6, qy0 + 8, this.fireAt(x + 5, 7))
    } else if (m.kind === BEAM) {
      // Crank disc → rod → rocking beam on its column → pump rod.
      const a = m.phase + m.s * this.angle
      const pinX = x + 6 + Math.cos(a) * 2.4
      const pinY = ey + 13 + Math.sin(a) * 2.4
      const pivX = x + 22
      const pivY = ey + 5
      const h = 15
      const endX = pivX - h
      const rod = 7
      const ddx = pinX - endX
      const yL = pinY - Math.sqrt(Math.max(0, rod * rod - ddx * ddx))
      const sn = Math.max(-0.6, Math.min(0.6, (yL - pivY) / h))
      const cs = Math.sqrt(1 - sn * sn)
      const lx = pivX - h * cs
      const ly = pivY + h * sn
      const rx = pivX + h * cs
      const ry = pivY - h * sn
      this.line(lx, ly, rx, ry, C.iron, 3)
      this.line(lx, ly + 1, rx, ry + 1, C.ironLt, 3)
      this.line(pinX, pinY, lx, ly + 1, C.steel, 4)
      this.dot(pinX, pinY, C.brassHi, 5)
      this.line(rx, ry + 1, rx, ey + 12, C.steel, 4)
      this.qrect(x + 21, qy0 + 3, x + 22, qy0 + 8, C.iron)
      this.q(x + 21, qy0 + 2, C.brass)
      this.q(x + 22, qy0 + 2, C.brass)
      const pc = Math.floor(rx)
      this.qrect(pc - 2, qy0 + 6, pc + 2, qy0 + 8, C.copper)
      this.qrect(pc - 3, qy0 + 6, pc + 3, qy0 + 6, C.brassDk)
      this.qrect(pc + 3, qy0 + 7, x + m.w - 1, qy0 + 7, C.copperDk)
    } else if (m.kind === GRIND) {
      const a = m.phase + m.s * this.angle
      const gx = x + 13
      const gy = ey + 11
      const blur = clamp01((Math.abs(m.s * this.omega) - 0.25) / 0.4)
      for (let yy = Math.floor(gy - 6); yy <= gy + 6; yy++)
        for (let xx = Math.floor(gx - 6); xx <= gx + 6; xx++) {
          const dx = xx + 0.5 - gx
          const dy = yy + 0.5 - gy
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d > 5.8 || d < 2.4) continue
          const grain = ((Math.floor(d * 0.9) + Math.floor(((Math.atan2(dy, dx) - a) / TAU) * 14 + 14)) & 1) === 0
          const p = d > 5 ? 1 : (grain ? 0.9 : 0.15) * (1 - blur) + 0.5 * blur
          if (this.dither(xx, yy, p)) this.dot(xx, yy, d > 5 ? C.stone : C.stoneDk, 2)
        }
      this.drawPulleyAt(gx, gy, 2, m.s)
      this.qrect(x + 7, qy0 + 8, x + 19, qy0 + 8, C.wood)
      this.qrect(x + 19, qy0 + 5, x + 20, qy0 + 5, C.ironLt)
      this.qrect(x + 20, qy0 + 6, x + 20, qy0 + 8, C.ironDk)
    } else if (m.kind === PANEL || m.kind === PIPE) {
      // Pipework: a manifold with valves, handwheels and (on panels) gauges.
      const x1 = x + m.w - 1
      this.qrect(x, qy0 + 6, x1, qy0 + 6, C.copper)
      if (m.kind === PANEL) {
        this.qrect(x + 2, qy0 + 2, x + 3, qy0 + 5, C.copperDk)
        this.qrect(x + m.w - 5, qy0 + 3, x + m.w - 4, qy0 + 5, C.copperDk)
        this.qrect(x + 1, qy0 + 2, x + 4, qy0 + 2, C.brassDk)
        this.drawHandwheel(x + 11, ey + 9.5)
        this.qrect(x + 10, qy0 + 6, x + 12, qy0 + 6, C.brass)
      } else if (m.w >= 6) {
        this.drawHandwheel(x + Math.floor(m.w / 2), ey + 9.5)
        this.qrect(x + Math.floor(m.w / 2) - 1, qy0 + 6, x + Math.floor(m.w / 2) + 1, qy0 + 6, C.brass)
      }
    }
  }

  private drawPulleyAt(x: number, y: number, r: number, s: number): void {
    const a = s * this.angle
    for (let k = 0; k < 10; k++) {
      const t = (k / 10) * TAU
      this.dot(x + Math.cos(t) * (r - 0.4), y + Math.sin(t) * (r - 0.4), C.brass, 3)
    }
    this.dot(x, y, C.brassHi, 4)
    this.dot(x + Math.cos(a) * 1.2, y + Math.sin(a) * 1.2, C.steel, 4)
  }

  /** A valve handwheel: five spokes, nudged now and then by an invisible hand. */
  private drawHandwheel(x: number, y: number): void {
    const a = Math.sin(this.t * 0.01 + x) * 0.6
    for (let k = 0; k < 12; k++) {
      const t = (k / 12) * TAU
      this.dot(x + Math.cos(t) * 2.4, y + Math.sin(t) * 2.4, C.brass, 3)
    }
    for (let k = 0; k < 5; k++) {
      const t = a + (k / 5) * TAU
      this.line(x, y, x + Math.cos(t) * 1.8, y + Math.sin(t) * 1.8, C.brassDk, 2)
    }
    this.dot(x, y, C.brassHi, 4)
  }

  private drawWheel(): void {
    const R = this.radius
    const rim = R - 1.7
    const hub = 1.9
    const spacing = TAU / SPOKES
    const blur = clamp01((this.omega - 0.17) / 0.24)
    const smear = blur * spacing * 0.95
    const x0 = Math.floor(this.cx - R)
    const x1 = Math.ceil(this.cx + R)
    const y0 = Math.floor(this.cy - R)
    const y1 = Math.ceil(this.cy + R)
    const spinPhase = (this.t * 5) & 15
    const rimColor = mix(C.ironLt, C.brassDk, 0.15)
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const ddx = x + 0.5 - this.cx
        const ddy = y + 0.5 - this.cy
        const d = Math.sqrt(ddx * ddx + ddy * ddy)
        if (d > R) continue
        if (d >= rim) {
          this.dot(x, y, rimColor, 2)
          continue
        }
        if (d <= hub) {
          this.dot(x, y, C.brass, 4)
          continue
        }
        // Angle in the engine's frame, the same one the crank turns in.
        const s = ddx * this.ux + ddy * this.uy
        const t = ddx * this.vx + ddy * this.vy
        const a = Math.atan2(t, s)
        let m = (a - this.angle) % spacing
        if (m < 0) m += spacing
        const behind = spacing - m
        const near = Math.min(m, behind) * d
        if (near < 0.75) {
          this.dot(x, y, blur > 0.5 ? C.ironLt : C.iron, 1)
          continue
        }
        // Motion blur: a dithered smear trailing each spoke.
        if (smear > 0 && behind < smear) {
          const k = 1 - behind / smear
          if (this.dither(x + spinPhase, y, k * (0.35 + 0.5 * blur))) this.dot(x, y, C.ironDk, 0)
        }
      }
    }
  }

  private drawLinkage(): void {
    const th = this.angle
    const rc = this.crank
    const L = this.rodLen
    const sinT = Math.sin(th)
    const cosT = Math.cos(th)
    // Crank pin, and the crosshead the rod drags along the stroke.
    const pinS = rc * cosT
    const pinT = rc * sinT
    const sH = rc * cosT + Math.sqrt(L * L - rc * rc * sinT * sinT)
    const pinX = this.fx(pinS, pinT)
    const pinY = this.fy(pinS, pinT)
    const hx = this.fx(sH, 0)
    const hy = this.fy(sH, 0)
    const ht = this.halfT
    const near = L - rc

    // Slide bars either side of the crosshead's travel.
    const gt = this.vertical ? 3.5 : 2.5
    this.line(this.fx(near - 3, gt), this.fy(near - 3, gt), this.fx(this.cyl0, gt), this.fy(this.cyl0, gt), C.iron, 1)
    this.line(this.fx(near - 3, -gt), this.fy(near - 3, -gt), this.fx(this.cyl0, -gt), this.fy(this.cyl0, -gt), C.iron, 1)
    // Piston rod from crosshead into the cylinder.
    this.line(hx, hy, this.fx(this.cyl0 + 1, 0), this.fy(this.cyl0 + 1, 0), C.steel, 3)
    // Valve gear: an eccentric a quarter-turn ahead of the crank, its rod to the valve chest.
    const eS = 1.6 * Math.cos(th + Math.PI / 2)
    const eT = 1.6 * Math.sin(th + Math.PI / 2)
    const vS = this.cyl0 + 2 + eS * 0.6
    this.line(this.fx(eS, eT), this.fy(eS, eT), this.fx(vS, ht + 1.6), this.fy(vS, ht + 1.6), C.brassDk, 2)
    // The connecting rod, pin to crosshead, and the crank web from the hub.
    this.line(this.cx, this.cy, pinX, pinY, C.brassDk, 3)
    this.line(pinX, pinY, hx, hy, C.steel, 4)
    for (let oy = -1; oy <= 0; oy++) for (let ox = -1; ox <= 0; ox++) this.dot(pinX + ox + 0.5, pinY + oy + 0.5, C.brassHi, 5)

    // Solids in the engine frame: crosshead, cylinder (cut away), valve chest.
    const sP = sH + this.pistonOffset
    const s0 = Math.min(near - 4, this.cyl0)
    const s1 = this.cyl1 + 0.5
    const tMax = ht + 4
    const qw = this.columns * 2
    const qh = this.rows * 2
    // The frame is axis-aligned (u and v are unit axes), so two corners bound it.
    const xa = this.fx(s0, -tMax)
    const xb = this.fx(s1, tMax)
    const ya = this.fy(s0, -tMax)
    const yb = this.fy(s1, tMax)
    const qx0 = Math.max(0, Math.floor(Math.min(xa, xb)))
    const qx1 = Math.min(qw - 1, Math.ceil(Math.max(xa, xb)))
    const qy0 = Math.max(0, Math.floor(Math.min(ya, yb) / 2))
    const qy1 = Math.min(qh - 1, Math.ceil(Math.max(ya, yb) / 2))
    const chest0 = this.cyl0 + 3.5
    const chest1 = this.cyl1 - 3.5
    const steamInside = mix(C.cavity, 0x3a4048, clamp01(this.heat * 1.2))
    for (let qy = qy0; qy <= qy1; qy++) {
      for (let qx = qx0; qx <= qx1; qx++) {
        const px = qx + 0.5 - this.cx
        const py = qy * 2 + 1 - this.cy
        const s = px * this.ux + py * this.uy
        const t = px * this.vx + py * this.vy
        const at = Math.abs(t)
        if (Math.abs(s - sH) <= 1.5 && at <= 2) {
          this.q(qx, qy, C.brass)
          continue
        }
        if (s >= this.cyl0 && s <= this.cyl1) {
          const capped = s < this.cyl0 + 2 || s > this.cyl1 - 2
          if (capped && at <= ht + 1.2) {
            this.q(qx, qy, C.iron)
            continue
          }
          if (at <= ht - 1.4) {
            this.q(qx, qy, Math.abs(s - sP) <= 1.1 ? C.brassHi : s < sP ? C.cavity : steamInside)
            continue
          }
          if (at <= ht) {
            this.q(qx, qy, C.copper)
            continue
          }
          if (t > ht && t <= ht + 3 && s >= chest0 && s <= chest1) {
            this.q(qx, qy, t > ht + 1.5 && (s < chest0 + 1 || s > chest1 - 1) ? C.brassDk : C.ironLt)
            continue
          }
        }
      }
    }
  }

  private drawGovernor(): void {
    const spin = clamp01(this.omega / MAX_SPEED)
    const phi = 0.22 + 1.05 * Math.sqrt(spin)
    const L = this.govArm
    const x = this.govX
    const y = this.govY
    // In the spine the spindle is bevel-driven off the second shaft above.
    this.line(x, this.shaft2Y >= 0 ? this.shaft2Y + 1 : y - 0.5, x, this.govBase, C.iron, 1)
    // The balls swing round the spindle: show that as a slight in/out wobble.
    const wob = spin > 0.05 ? 0.12 * Math.sin(this.angle * 1.7) * spin : 0
    const sinP = Math.sin(phi) * (1 - Math.abs(wob))
    const cosP = Math.cos(phi)
    const sleeveY = y + L * cosP * 1.05
    for (let side = -1; side <= 1; side += 2) {
      const bx = x + side * L * sinP
      const by = y + L * cosP
      this.line(x, y, bx, by, C.brassDk, 2)
      this.line(x + side * L * sinP * 0.5, y + L * cosP * 0.5, x, sleeveY, C.brassDk, 2)
      for (let oy = -1; oy <= 0; oy++) for (let ox = -1; ox <= 0; ox++) this.dot(bx + ox + 0.5, by + oy + 0.5, C.brassHi, 5)
    }
    this.dot(x, sleeveY, C.brass, 3)
    this.dot(x, y - 1, C.brass, 3)
  }

  private fireAt(qx: number, qy: number): number {
    const flick = this.rng.f() * 0.18 - 0.06 + Math.sin(this.t * 0.7 + qx * 1.3) * 0.04
    const h = this.heat * (qy & 1 ? 1 : 0.88) + flick * (0.4 + this.heat)
    // Blue: a gas flame, never cold-dark, so it reads at every level.
    if (this.tint === 'blue') return fireColor(0.3 + h * 0.75, BLUE_FIRE)
    return fireColor(this.sputter > 0 ? h * 0.7 : h)
  }

  private warningLamp(qx: number, qy: number): void {
    const on = this.tint === 'blue' && (this.t >> 3) % 3 !== 0
    const color = on ? C.blue : this.tint === 'blue' ? 0x24508c : C.blueOff
    const x = Math.floor(qx) & ~1
    this.q(x, qy, color)
    this.q(x + 1, qy, color)
  }

  private drawBoilerBand(): void {
    const ex = this.cx - 20
    const qy0 = Math.floor((this.cy - 10) / 2)
    const Y = (k: number) => qy0 + k
    const b0 = ex + 70
    const b1 = ex + 83
    for (let k = 3; k <= 8; k++) {
      const inset = k === 3 ? 1 : 0
      this.qrect(b0 + inset, Y(k), b1 - inset, Y(k), k === 5 ? C.brass : k === 3 ? C.copperDk : C.copper)
    }
    for (let k = 7; k <= 8; k++) {
      for (let x = b0 + 2; x <= b1 - 4; x++) {
        const frame = x === b0 + 2 || x === b1 - 4
        this.q(x, Y(k), frame ? C.brassDk : this.fireAt(x, k))
      }
    }
    this.qrect(Math.floor(this.chimX) - 2, Y(1), Math.floor(this.chimX) + 1, Y(1), C.brass)
    this.qrect(Math.floor(this.chimX) - 1, Y(2), Math.floor(this.chimX), Y(2), C.ironDk)
    this.q(Math.floor(this.valveX), Y(2), C.brass)
    this.warningLamp(b0 + 6, Y(2))
    const chestEnd = Math.floor(this.fx(this.cyl1 - 4, 0))
    this.qrect(chestEnd, Y(1), b0 + 1, Y(1), C.copperDk)
    this.q(chestEnd, Y(2), C.copperDk)
    this.qrect(b0 + 1, Y(2), b0 + 2, Y(2), C.copperDk)
    this.qrect(Math.floor(this.fx(this.rodLen - this.crank - 2, 0)), Y(7), Math.floor(this.fx(this.rodLen - this.crank - 1, 0)), Y(8), C.ironDk)
    this.qrect(Math.floor(this.fx(this.cyl0, 0)), Y(7), Math.floor(this.fx(this.cyl0 + 1, 0)), Y(8), C.ironDk)
    this.qrect(Math.floor(this.fx(this.cyl1 - 1, 0)), Y(7), Math.floor(this.fx(this.cyl1, 0)), Y(8), C.ironDk)
  }

  private drawBoilerSpine(): void {
    const wd = this.columns * 2
    const mid = this.cx
    const half = Math.min(15, Math.floor(wd / 2) - 3)
    const bottom = this.boilerBottom
    const top = this.boilerTop
    const b0 = mid - half
    const b1 = mid + half - 1
    for (let k = top; k <= bottom; k++) {
      const inset = k === top ? 2 : k === top + 1 ? 1 : 0
      const color = k === top ? C.copperDk : k === top + 4 ? C.brass : C.copper
      this.qrect(b0 + inset, k, b1 - inset, k, color)
    }
    for (let k = bottom - 2; k <= bottom - 1; k++) {
      for (let x = b0 + 3; x <= b1 - 3; x++) {
        const frame = x === b0 + 3 || x === b1 - 3
        this.q(x, k, frame ? C.brassDk : this.fireAt(x, k))
      }
    }
    this.qrect(b0 - 1, bottom, b1 + 1, bottom, C.ironDk)
    const cx = Math.floor(this.chimX)
    const chimTop = Math.floor(this.chimY / 2)
    this.qrect(cx - 2, chimTop, cx + 1, chimTop, C.brass)
    this.qrect(cx - 1, chimTop + 1, cx, top - 1, C.ironDk)
    this.q(Math.floor(this.valveX), top - 1, C.brass)
    this.q(Math.floor(this.valveX), top, C.brass)
    this.warningLamp(b1 - 3, top + 1)
    // Steam pipe down the side to the valve chest.
    const px = Math.floor(this.fx(0, this.halfT + 2))
    const chestTop = Math.floor(this.fy(this.cyl1 - 4, 0) / 2)
    for (let k = bottom + 1; k <= chestTop; k++) this.q(px, k, C.copperDk)
    // Guide frame feet beside the crosshead.
    const g0 = Math.floor(this.fy(this.rodLen - this.crank - 3, 0) / 2)
    this.qrect(Math.floor(this.cx - 6), g0, Math.floor(this.cx - 5), g0, C.ironDk)
    this.qrect(Math.floor(this.cx + 4), g0, Math.floor(this.cx + 5), g0, C.ironDk)
    // Rivets along the boiler's brass band.
    for (let x = b0 + 1; x <= b1 - 1; x += 3) this.q(x, top + 4, C.brassHi)
    // Iron pillars holding up the overhead shaft, riveted, down to the boiler.
    for (let k = 2; k < top; k++) {
      const rivet = k % 4 === 0
      this.q(0, k, rivet ? C.brassDk : C.iron)
      this.q(wd - 1, k, rivet ? C.brassDk : C.iron)
    }
    // Gauge riser from the boiler crown, with a handwheel valve partway.
    if (this.riserX >= 0) {
      const rq0 = Math.floor(this.riserY0 / 2)
      const rq1 = Math.floor(this.riserY1 / 2)
      this.qrect(this.riserX, rq0, this.riserX + 1, rq1, C.copperDk)
      this.qrect(this.riserX - 1, rq1 - 1, this.riserX + 2, rq1 - 1, C.brass)
    }
  }

  /** The bed plate along the floor, with a lamp lit for each bit of subagent load. */
  private drawBed(): void {
    const wd = this.columns * 2
    const qy = this.rows * 2 - 1
    let x0 = 0
    let x1 = wd - 1
    if (!this.vertical) x0 = Math.ceil(this.cx + this.radius) + 1
    this.qrect(x0, qy, x1, qy, C.ironDk)
    const lit = Math.min(this.vertical ? 4 : 16, Math.round(this.coverageBoost / (this.vertical ? 12 : 4)))
    if (lit <= 0) return
    const step = Math.max(4, Math.floor((x1 - x0) / (lit + 1)) & ~1)
    for (let k = 0; k < lit; k++) {
      const x = ((x0 + step * (k + 1)) & ~1) - (this.vertical ? 0 : 0)
      if (x + 1 > x1) break
      const blink = ((this.t >> 3) + k * 5) % 13 === 0
      const on = this.tint === 'smoke' ? C.lampLow : this.tint === 'blue' ? C.lampBlue : C.lampOn
      this.q(x, qy, blink ? C.brassDk : on)
      this.q(x + 1, qy, blink ? C.brassDk : on)
    }
  }

  private drawSteam(): void {
    const wd = this.columns * 2
    const hd = this.rows * 4
    const st = this.steam
    for (let i = 0; i < this.nPuffs; i++) {
      const r = this.pr[i]!
      const life = this.page[i]! / this.plife[i]!
      const amp = this.pamp[i]! * (1 - life) * (1 - life * 0.3)
      const x = this.px[i]!
      const y = this.py[i]!
      const x0 = Math.max(0, Math.floor(x - r))
      const x1 = Math.min(wd - 1, Math.ceil(x + r))
      const y0 = Math.max(0, Math.floor(y - r))
      const y1 = Math.min(hd - 1, Math.ceil(y + r))
      const inv = 1 / (r * r)
      for (let yy = y0; yy <= y1; yy++) {
        const dy = yy + 0.5 - y
        for (let xx = x0; xx <= x1; xx++) {
          const dx = xx + 0.5 - x
          const f = 1 - (dx * dx + dy * dy) * inv
          if (f > 0) st[yy * wd + xx]! += amp * f
        }
      }
    }
  }

  private drawSparks(): void {
    for (let i = 0; i < this.nSparks; i++) {
      const x = Math.floor(this.sx[i]!)
      const y = Math.floor(this.sy[i]!)
      if (x < 0 || y < 0 || x >= this.columns * 2 || y >= this.rows * 4) continue
      const c = (y >> 2) * this.columns + (x >> 1)
      this.spark[c]! |= BRAILLE[x & 1]![y & 3]!
    }
  }

  private steamColor(d: number): number {
    // Smoke: sooty black-brown; blue: steam lit blue-white.
    if (this.tint === 'smoke') return mix(0x2a2826, 0x6e6a66, d)
    if (this.tint === 'blue') return mix(0x34507e, 0xa8ccff, d)
    return mix(0x5d666e, 0xe8ecef, d)
  }

  /** Turn the canvases into cells: solids, then sparks, then linkage, then steam. */
  private compose(): void {
    const out = this.out
    const w = this.columns
    const qw = w * 2
    const wd = w * 2
    const quad = this.quad
    const st = this.steam
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < w; col++) {
        const i = row * w + col
        const qa = row * 2 * qw + col * 2
        const q0 = quad[qa]!
        const q1 = quad[qa + 1]!
        const q2 = quad[qa + qw]!
        const q3 = quad[qa + qw + 1]!
        if (q0 | q1 | q2 | q3) {
          this.solidCell(i, q0, q1, q2, q3)
          continue
        }
        let sbits = 0
        let sum = 0
        const dx0 = col * 2
        const dy0 = row * 4
        for (let dy = 0; dy < 4; dy++) {
          const base = (dy0 + dy) * wd + dx0
          for (let dx = 0; dx < 2; dx++) {
            const v = st[base + dx]!
            sum += v > 1 ? 1 : v
            if (v > (BAYER[(((dy0 + dy) & 3) << 2) | ((dx0 + dx) & 3)]! + 0.5) / 16) sbits |= BRAILLE[dx]![dy]!
          }
        }
        const avg = sum / 8
        const b = this.bits[i]!
        const sp = this.spark[i]!
        // In the spine's engine house, a dim brick wall stands behind the machinery.
        const wall = this.wall[i] === 1
        const bg = wall ? C.wallMortar : DEFAULT_COLOR
        if (sp) out.set(i, BRAILLE_BASE | sp | b, C.spark, bg)
        else if (b) out.set(i, BRAILLE_BASE | b | (avg > 0.3 ? sbits : 0), this.bcol[i]!, bg)
        else if (sbits) out.set(i, BRAILLE_BASE | sbits, this.steamColor(avg * 1.4), bg)
        else if (wall) out.set(i, ((col + (row & 1) * 2) & 3) === 0 ? 0x2597 : 0x2584, C.wallBrick, C.wallMortar)
        else out.blank(i)
      }
    }
  }

  /** Up to four quadrant colors → one quadrant glyph with a fg and (maybe) a bg. */
  private solidCell(i: number, q0: number, q1: number, q2: number, q3: number): void {
    const cols = this.qcols
    const counts = this.qcounts
    const qs = this.qs
    qs[0] = q0
    qs[1] = q1
    qs[2] = q2
    qs[3] = q3
    let n = 0
    let empty = false
    for (let k = 0; k < 4; k++) {
      const q = qs[k]!
      if (q === 0) {
        empty = true
        continue
      }
      let j = 0
      while (j < n && cols[j] !== q) j++
      if (j === n) {
        cols[n] = q
        counts[n] = 0
        n++
      }
      counts[j]!++
    }
    let a = 0
    for (let j = 1; j < n; j++) if (counts[j]! > counts[a]!) a = j
    let b = -1
    if (!empty) for (let j = 0; j < n; j++) if (j !== a && (b < 0 || counts[j]! > counts[b]!)) b = j
    const fg = cols[a]! - SOLID
    const bg = b >= 0 ? cols[b]! - SOLID : -1
    let mask = 0
    for (let k = 0; k < 4; k++) {
      const q = qs[k]!
      if (q === 0) continue
      const c = q - SOLID
      if (bg < 0 || c === fg || (c !== bg && dist(c, fg) <= dist(c, bg))) mask |= 1 << k
    }
    if (bg >= 0 && mask === 15) this.out.set(i, 0x2588, fg)
    else this.out.set(i, QUAD[mask]!, fg, bg >= 0 ? bg : this.wall[i] === 1 ? C.wallMortar : DEFAULT_COLOR)
  }

  /** A pressure gauge: a cream face (a deliberate background) and a needle that climbs. */
  private drawGauge(g: Gauge): void {
    const { col, row, wc } = g
    const hc = 1
    if (col < 0 || row < 0 || col + wc > this.columns || row + hc > this.rows) return
    const gw = wc * 2
    const gh = hc * 4
    const base = clamp01(this.pressure + g.bias * this.pressure)
    const p = clamp01(base + (base > 0.7 ? Math.sin(this.t * 1.9 + g.col) * 0.025 : 0))
    const a = (-0.75 + 1.5 * p) * Math.PI
    const ox = gw / 2
    const oy = gh * 0.7
    const len = Math.min(gw / 2, oy) + 0.2
    const dx = Math.sin(a)
    const dy = -Math.cos(a)
    let b0 = 0
    let b1 = 0
    for (let k = 0; k <= 8; k++) {
      const f = (k / 8) * len
      const x = Math.floor(ox + dx * f)
      const y = Math.floor(oy - 0.5 + dy * f + 0.5)
      if (x < 0 || y < 0 || x >= gw || y >= gh) continue
      const bit = BRAILLE[x & 1]![y & 3]!
      if (x >> 1 === 0) b0 |= bit
      else b1 |= bit
    }
    const color = p > 0.85 ? C.needleHot : C.needle
    const face = this.tint === 'blue' ? mix(C.face, 0x8cbcff, 0.6) : this.tint === 'smoke' ? mix(C.face, 0x5a5650, 0.45) : C.face
    this.out.set(row * this.columns + col, BRAILLE_BASE | b0, color, face)
    this.out.set(row * this.columns + col + 1, BRAILLE_BASE | b1, color, face)
  }

  frame(): string {
    return this.grid().encode()
  }
}
