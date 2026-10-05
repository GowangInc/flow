// REVISION: flow-v44-rocket-resume
//
// Two launch sites in the sky world (sky.ts): a Falcon 9 and a Starship, each
// beside a lattice launch tower with two catch arms. The level is the
// rocket's target altitude. At 1 it stands on the pad, fuelled, venting
// white vapour. When the level rises it ignites, holds a beat while steam
// billows off the pad, then lifts off: slowly, then faster, the plume
// (white-hot core, orange, fading red) trailing a contrail that falls away
// below as the clouds go by, until at 10 it hangs among the stars over
// Earth's rim. When the level falls back it comes down nose up, coasting,
// then lights a landing burn; the tower's arms ride up to meet it and swing
// shut around it in mid-air, lower it onto the pad, open again, and it goes
// back to venting.
//
// Everything is drawn into a pixel layer at quadrant resolution (two pixels
// per cell across, two down) and composited over the sky: each cell keeps
// the two colors that best fit its four pixels, so the rocket, the tower's
// lattice and the plume are twice as fine as the grid, and soft things
// (vapour, steam, the plume's tail) blend into whatever sky is behind them.
//
// Dials: running subagents add vapour and more tower lights; a failed
// command makes the engines sputter a grey, smoky plume (on the pad the
// vents fume grey and the tower lights burn low; in orbit it coughs smoke
// back along its track); a nearly-full context burns a blue methane-ish
// plume, turns the tower's lights blue all the way up, and in orbit fires
// blue-white thruster puffs off the nose. Either tint keeps a thin burn
// going in orbit, where the engines would otherwise coast dark.

import { type Cells, DEFAULT_COLOR, Rng } from './cells'
import { layered, snap } from './clouds/layered'
import { STAR, STAR_DIM } from './night'
import { fitQuad, g, hash, lowerBlock, mix, QUAD, type QuadFit } from './pixels'
import { type SceneryCell, SkyWorld } from './sky'

const ceilEven = (n: number) => n + (n & 1)

// ---------------------------------------------------------------- sprites

/** A pixel sprite, top row first; -1 lets the sky through. */
type Sprite = { w: number; h: number; c: Int32Array }

function sprite(rows: readonly string[], pal: Record<string, number>): Sprite {
  const h = rows.length
  const w = rows[0]!.length
  const c = new Int32Array(w * h).fill(-1)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = pal[rows[y]![x]!]
      if (p !== undefined) c[y * w + x] = p
    }
  return { w, h, c }
}

const FALCON_PAL = {
  W: 0xf4f5f7, // white body, lit side
  w: 0xc3c8d0, // its shaded side
  K: 0x1d2025, // black interstage, octaweb, stowed legs
  G: 0x3a3e46, // grid fins
  L: 0x2c2f35, // deployed legs
  E: 0x70757d, // Merlin bells
}

const STARSHIP_PAL = {
  k: 0x3c3f46, // the ship's black heat-shield side
  S: 0xd9dde2, // stainless, lit
  s: 0xa3a9b1, // stainless, shaded
  F: 0x23262b, // flaps
  D: 0x3f434a, // hot-staging ring
  d: 0x8d939b, // its vents
  B: 0xc7ccd2, // Super Heavy, lit
  b: 0x989fa8, // Super Heavy, shaded
  G: 0x34383f, // grid fins
  E: 0x4f535a, // engine bay
}

// Falcon 9 in the band: one column of body, fins and legs half a column out.
const FALCON_BAND = ['..Ww..', '..Ww..', '..KK..', '.GWwG.', '..Ww..', '..Ww..', '..KK..']
const FALCON_BAND_LAND = ['..Ww..', '..Ww..', '..KK..', '.GWwG.', '..Ww..', '..Ww..', 'L.KK.L']

// Falcon 9 in the spine: fairing, second stage, black interstage, grid fins,
// the long first stage, stowed legs and the octaweb with its Merlins.
const FALCON_TALL_TOP = [
  '....Ww....',
  '...WWWw...',
  '...WWWw...',
  '...WWWw...',
  '...WWWw...',
  '...WWWw...',
  '...WWWw...',
  '...WWWw...',
  '...KKKK...',
  '...KKKK...',
]
const FALCON_TALL_MID = Array<string>(12).fill('...WWWw...')
const FALCON_TALL = [
  ...FALCON_TALL_TOP,
  '..GWWWwG..',
  ...FALCON_TALL_MID,
  '...KWwK...',
  '...KWwK...',
  '...KWwK...',
  '...KWwK...',
  '...KKKK...',
  '....EE....',
]
const FALCON_TALL_LAND = [
  ...FALCON_TALL_TOP,
  '.GGWWWwGG.',
  ...FALCON_TALL_MID,
  '..LWWWwL..',
  '..LWWWwL..',
  '.L.WWWw.L.',
  '.L.WWWw.L.',
  'L..KKKK..L',
  'L...EE...L',
]

// Starship in the band: the ship (black tiles on one side, steel on the
// other, flaps fore and aft), the dark hot-staging ring, Super Heavy.
const STARSHIP_BAND = ['..kS..', 'FkSSsF', '.kSSs.', 'FkSSsF', 'GBBBbG', '.BBBb.', '.bbbb.']

const STARSHIP_TALL = [
  '....kS....',
  '...kkSS...',
  '..kkkSSs..',
  '.FkkkSSsF.',
  '.FkkkSSsF.',
  ...Array<string>(7).fill('..kkkSSs..'),
  '.FkkkSSsF.',
  'FFkkkSSsFF',
  'FFkkkSSsFF',
  '..kkkSSs..',
  '..DDDDDD..',
  '..DdDdDd..',
  'GGBBBBBbGG',
  ...Array<string>(17).fill('..BBBBBb..'),
  '..bbbbbb..',
  '..EEEEEE..',
]

/** One rocket in one layout. All in pixels; rows of a sprite count from its top. */
interface Spec {
  fly: Sprite
  /** Its look coming in to land: legs out, grid fins deployed. */
  land: Sprite
  /** The sprite column the body starts at, and its width. */
  bodyL: number
  bodyW: number
  /** Where the arms grip it: pixels above its bottom. */
  grip: number
  /** The launch mount it stands on: its height, so the rocket's resting altitude. */
  mount: number
  towerW: number
  towerH: number
  /** The arms' height when they catch it. */
  armCatch: number
  armThick: number
  /** The open arms' stub, foreshortened as they swing out toward the viewer. */
  armStub: number
  /** The full plume's length. */
  plume: number
  /** Where vapour vents at rest: sprite column, row, and which way it blows. */
  vents: readonly (readonly [col: number, row: number, dir: number])[]
  /** The row a service arm reaches across to at rest (the tall layout only). */
  service?: number
  /** Smoke puff size, as radii at birth and at death. */
  puff: readonly [number, number]
}

const FALCON_SPECS: [band: Spec, tall: Spec] = [
  {
    fly: sprite(FALCON_BAND, FALCON_PAL),
    land: sprite(FALCON_BAND_LAND, FALCON_PAL),
    bodyL: 2,
    bodyW: 2,
    grip: 1,
    mount: 0,
    towerW: 4,
    towerH: 8,
    armCatch: 6,
    armThick: 1,
    armStub: 1,
    plume: 7,
    vents: [
      [1, 1, -1],
      [4, 1, 1],
      [4, 5, 1],
    ],
    puff: [0.6, 2.2],
  },
  {
    fly: sprite(FALCON_TALL, FALCON_PAL),
    land: sprite(FALCON_TALL_LAND, FALCON_PAL),
    bodyL: 3,
    bodyW: 4,
    grip: 16,
    mount: 0,
    towerW: 4,
    towerH: 38,
    armCatch: 33,
    armThick: 1,
    armStub: 2,
    plume: 22,
    vents: [
      [2, 6, -1],
      [7, 5, 1],
      [2, 25, -1],
      [7, 26, 1],
    ],
    service: 3,
    puff: [1.2, 4],
  },
]

const STARSHIP_SPECS: [band: Spec, tall: Spec] = [
  {
    fly: sprite(STARSHIP_BAND, STARSHIP_PAL),
    land: sprite(STARSHIP_BAND, STARSHIP_PAL),
    bodyL: 1,
    bodyW: 4,
    grip: 1,
    mount: 0,
    towerW: 4,
    towerH: 8,
    armCatch: 6,
    armThick: 1,
    armStub: 1,
    plume: 7,
    vents: [
      [0, 2, -1],
      [5, 2, 1],
      [5, 5, 1],
    ],
    puff: [0.7, 2.4],
  },
  {
    fly: sprite(STARSHIP_TALL, STARSHIP_PAL),
    land: sprite(STARSHIP_TALL, STARSHIP_PAL),
    bodyL: 2,
    bodyW: 6,
    grip: 18,
    mount: 4,
    towerW: 6,
    towerH: 50,
    armCatch: 40,
    armThick: 2,
    armStub: 3,
    plume: 26,
    vents: [
      [1, 9, -1],
      [8, 7, 1],
      [1, 31, -1],
      [8, 33, 1],
    ],
    service: 8,
    puff: [1.4, 4.5],
  },
]

/** A plume's colors from cold (0) to white-hot (1). */
type Ramp = readonly [number, number, number, number, number]
const RAMPS = {
  merlin: [0x5a1e10, 0xd2461a, 0xff8f1f, 0xffd257, 0xfffbe8] as Ramp,
  raptor: [0x4a1a2e, 0xd8482a, 0xff9a3a, 0xffdc8f, 0xf2f4ff] as Ramp,
  blue: [0x1a1650, 0x4b3ad6, 0x3f7dff, 0x9cc8ff, 0xf2f8ff] as Ramp,
  smoke: [0x2e2e2e, 0x595959, 0x7e7c78, 0xa89c88, 0xd8c8a8] as Ramp,
}

function rampColor(r: Ramp, heat: number): number {
  const h = heat <= 0 ? 0 : heat >= 1 ? 4 : heat * 4
  const i = Math.min(3, h | 0)
  return mix(r[i]!, r[i + 1]!, h - i)
}

/** A rocket's site colors. */
interface Look {
  tower: number
  arm: number
  carriage: number
  ramp: Ramp
  /** Mechazilla: X-braced, a lightning rod, a carriage the arms ride on. */
  mechazilla: boolean
}

const PAD: SceneryCell = { glyph: g('▀'), fg: 0x9a9da3, bg: 0x6b6e74 }
const TRENCH: SceneryCell = { glyph: g('▀'), fg: 0x4a4c50, bg: 0x6b6e74 }

const LIGHT = { red: 0xff3b30, amber: 0xffb020, green: 0x5cff7a, blue: 0x4aa8ff }

/** Frames from ignition to liftoff: the hold-down while the engines spool up. */
const IGNITE = 20
/** Frames for the arms to swing shut (or open). */
const CLOSE = 12
/**
 * Frames (~1 s at 14 fps) the rocket holds each level on its way to a new
 * one, so a jump from 1 to 10 (or back) plays every stage: each cloud
 * layer, the dark sky, insertion, the turn to horizontal, full orbit.
 */
const STAGE_FRAMES = 14
/** Rows per frame per frame of braking, and the top speeds up and down. */
const DEC = 0.03
const VMAX = 2.2
const VMAX_DOWN = 1.6
const ACC_DOWN = 0.025

type State = 'rest' | 'ignite' | 'fly' | 'catch' | 'lower' | 'release'

// Flight. Aloft, the level picks a layer of the atmosphere (world rows, the
// sky's scale: 2 per cloud-painter row) and a climb speed; the rocket never
// stops climbing, and the world above the layer is folded into a stack of
// tiles of that layer, each offset sideways and crossfaded at its seams, so
// the layer's clouds keep streaming past for as long as it stays there.
/** The layer each level flies in: 2 low cumulus ... 9 the edge of space, 10 orbit. */
const LAYER = [0, 0, 22, 32, 44, 56, 70, 86, 140, 140, 140]
/** Climb speed per level, world rows per frame. */
const SPEED = [0, 0, 0.3, 0.42, 0.55, 0.7, 0.85, 1.0, 1.0, 1.0, 1.0]
/** A tile of folded sky, its seam crossfade, and the sideways offset between tiles. */
const TILE = 14
const FADE = 3
const TILE_X = 397
/** The layered painter's scale, and the world rows its clouds span. */
const PAINT = 2
const CLOUD_LO = 11
const CLOUD_HI = 90
/** Orbit: the tilt (radians from upright, nose toward travel) and how fast the stars stream. */
/** Per level from 8: insertion (tilted), nearly horizontal, full-speed horizontal orbit. */
const TILT_BAND = [0.9, 1.27, Math.PI / 2]
const TILT_TALL = [0.52, 1.27, Math.PI / 2]
const ORBIT_SPEED = [1.6, 2.6, 3.8]
/** The engines in orbit: a thin burn at insertion, less, then coasting. */
const ORBIT_BURN = [0.3, 0.2, 0]
/** In orbit under a tint the engines never coast dark: at least this much burn shows it. */
const TINT_BURN = 0.6
/** In a tall pane, the camera keeps this fraction of it above the nose while flying. */
const HEADROOM = 0.28
const GLYPH = { dot: g('·'), star: g('*'), vert: g('│'), horiz: g('─'), diag: g('╱'), top: g('▀') }

const PMAX = 384
/** Earth's limb seen from orbit: the bright blue edge of the atmosphere. */
const LIMB = 0x6cb4f2
const OCEAN = 0x1d4e8e

abstract class LaunchSite extends SkyWorld {
  protected abstract readonly specs: [band: Spec, tall: Spec]
  protected abstract readonly look: Look

  /** The level being acted out: it walks toward the asked-for level a stage at a time. */
  private staged = -1
  private sinceStage = STAGE_FRAMES

  /** Step the acted-out level toward the asked one (`strength`), then fly it. */
  override step(): void {
    const asked = Math.max(0, Math.min(10, Math.round(this.strength)))
    this.sinceStage++
    if (asked === 0 || this.staged < 0) {
      // Off is instant; a fresh start (a reload, the first frame) resumes as asked.
      this.staged = asked
    } else if (asked !== this.staged && this.sinceStage >= STAGE_FRAMES) {
      this.staged += Math.sign(asked - this.staged)
      this.sinceStage = 0
    }
    this.strength = this.staged
    super.step()
  }

  /** Drawn at the acted-out level too, even on a frame drawn without a step. */
  override grid(): Cells {
    if (this.staged >= 0 && this.strength > 0) this.strength = this.staged
    return this.drawFrame()
  }

  private state: State = 'rest'
  private timer = 0
  private flyTime = 0
  private v = 0
  /** Engine throttle 0..1, eased. */
  private thr = 0
  /** The arms' height (pixels) and how far they've swung shut (0 open .. 1 gripping). */
  private armY = -1
  private reach = 0
  /** The service arm: 1 across to the rocket, 0 swung away. */
  private service = 1
  private braking = false
  private rng: Rng
  /** The layer it's flying in (world rows), eased; -1 until the first frame. */
  private layer = -1
  /** Tiles folded away so far: offsets each tile's clouds sideways. */
  private wraps = 0
  /** 0 climbing upright .. 1 in orbit: tilted, stars streaking, Earth below. */
  private orbit = 0
  /** The star field's offset (columns, rows) and velocity this frame. */
  private starX = 0
  private starY = 0
  private starVX = 0
  private starVY = 0
  private earthX = 0
  /** The tilt from upright (radians) and the orbital speed, both eased. */
  private tilt = 0
  private orbitSpeed = 0
  /** Pixel rows the camera keeps above the nose (eased): centers the rocket in a tall pane. */
  private camP = 0
  /** Not yet stepped: the first frame starts in the level's own stage, not on the pad. */
  private fresh = true
  // The last cloud sample (no allocation per cell).
  private cFg = 0
  private cBg = 0

  // The pixel layer: color and coverage per pixel, and the cells touched this frame.
  private pw = 0
  private ph = 0
  private pc = new Uint32Array(0)
  private pa = new Float32Array(0)
  private touched = new Uint8Array(0)
  private list = new Int32Array(0)
  private nTouched = 0
  /** Pixel row of world half-row 0 this frame: a world half-row y is pixel row base - y. */
  private base = 0
  private quad = new Int32Array(4)
  private fit: QuadFit = { mask: 0, fg: 0, bg: 0, spread: 0 }

  // Particles (vapour, steam, smoke, contrail), in world pixels.
  private px = new Float32Array(PMAX)
  private py = new Float32Array(PMAX)
  private vx = new Float32Array(PMAX)
  private vy = new Float32Array(PMAX)
  private life = new Float32Array(PMAX)
  private maxLife = new Float32Array(PMAX)
  private r0 = new Float32Array(PMAX)
  private r1 = new Float32Array(PMAX)
  private a0 = new Float32Array(PMAX)
  private pcol = new Uint32Array(PMAX)
  private nextP = 0

  // The site's layout for this grid.
  private geoKey = -1
  private tall = false
  private spec!: Spec
  private ox = 0
  private bodyPx = 0
  private tx = 0
  private padL = 0
  private padR = 0

  constructor(seed?: number) {
    super(seed)
    this.rng = new Rng((seed ?? Date.now()) * 2654435761)
  }

  override ensure(columns: number, rows: number): void {
    super.ensure(columns, rows)
    if (this.pw === columns * 2 && this.ph === rows * 2) return
    this.pw = columns * 2
    this.ph = rows * 2
    this.pc = new Uint32Array(this.pw * this.ph)
    this.pa = new Float32Array(this.pw * this.ph)
    this.touched = new Uint8Array(columns * rows)
    this.list = new Int32Array(columns * rows)
    this.nTouched = 0
  }

  override seed(altitude: number): void {
    super.seed(altitude)
    if (this.alt > 3) {
      this.state = 'fly'
      this.v = 0.2
      this.thr = 0.6
      this.reach = 0
    }
  }

  /** Lay the site out on this grid: the rocket, the tower to its right, the pad under both. */
  private geo(): void {
    const key = this.columns * 65536 + this.rows
    if (key === this.geoKey) return
    this.geoKey = key
    this.tall = this.rows >= 16
    const s = (this.spec = this.specs[this.tall ? 1 : 0])
    const ox0 = -s.bodyL
    const tx0 = ceilEven(ox0 + s.fly.w)
    const pw = this.columns * 2
    let body: number
    if (this.tall) body = 2 * Math.round((pw / 2 - (ox0 + tx0 + s.towerW) / 2) / 2)
    else body = 2 * Math.floor(this.columns * 0.42)
    body = Math.max(-ox0 + 2, Math.min(body, pw - tx0 - s.towerW - 2))
    this.bodyPx = ceilEven(body)
    this.ox = this.bodyPx + ox0
    this.tx = this.bodyPx + tx0
    this.padL = Math.floor((this.ox - 2) / 2)
    this.padR = Math.floor((this.tx + s.towerW + 1) / 2)
    if (this.state === 'rest') this.alt = s.mount / 2
  }

  protected vehicleHeight(): number {
    this.geo()
    return Math.ceil(this.spec.fly.h / 2)
  }

  /** The rocket's bottom, in world half-rows. */
  private apx(): number {
    return Math.round(this.alt * 2)
  }

  /** The world scrolls just enough to keep the rocket's nose on the grid. */
  protected override get scroll(): number {
    this.geo()
    return Math.max(0, Math.ceil(this.scrollExact()))
  }

  /** The scroll that would put the nose exactly camP pixels below the top. */
  private scrollExact(): number {
    return (this.apx() + this.spec.fly.h + 2 + Math.round(this.camP) - 2 * this.rows) / 2
  }

  protected override groundFeature(x: number): SceneryCell | undefined {
    this.geo()
    // Clear ground around the launch site: no trees or houses near the pad.
    if (x >= this.padL - 3 && x <= this.padR + 3) return undefined
    return super.groundFeature(x)
  }

  protected override scenery(x: number, y: number, sky: number): SceneryCell | undefined {
    if (y === -1) {
      this.geo()
      if (x >= this.padL && x <= this.padR) {
        // Concrete, with the flame trench under the engines.
        const mid = (this.bodyPx + this.spec.bodyW / 2) >> 1
        return x === mid || (this.spec.bodyW > 2 && x === mid - 1) ? TRENCH : PAD
      }
    }
    return super.scenery(x, y, sky)
  }

  /**
   * The sky world, folded: below the layer it's the real world (the pad, the
   * low sky); above, a stack of tiles of the layer, each its clouds offset
   * sideways and crossfaded at the seams, which the climbing rocket streams
   * through forever. The sky's color follows the layer, not the climb; the
   * clouds glide by sub-row steps; stars stream (and streak in orbit).
   */
  private drawFrame(): Cells {
    const out = this.out
    const w = this.columns
    const h = this.rows
    if (this.strength <= 0) {
      for (let i = 0; i < w * h; i++) out.blank(i)
      return out
    }
    this.geo()
    const scroll = this.scroll
    const exact = Math.max(0, (this.alt * 2 + this.spec.fly.h + 2 + Math.round(this.camP) - 2 * h) / 2)
    const phi = exact - scroll
    const layer = Math.max(0, this.layer)
    const skyShift = Math.max(0, this.alt - layer)
    const a = layer - TILE / 2
    const o = this.orbit
    const drift = Math.floor((this.t * 0.1) % 100_000)
    // The stars' glyph, by how fast and which way they stream.
    const svx = Math.abs(this.starVX)
    const svy = Math.abs(this.starVY) * 2
    const starGlyph =
      svx + svy < 0.7 ? 0 : svx < svy * 0.5 ? GLYPH.vert : svy < svx * 0.4 ? GLYPH.horiz : GLYPH.diag
    const sx = Math.floor(this.starX)
    const sy = Math.floor(this.starY)
    const rb = this.rowBg
    rb.length = h
    for (let r = 0; r < h; r++) {
      const y = scroll - 1 + (h - 1 - r)
      const yf = y + phi
      const real = yf - a < TILE
      let skyY = yf - skyShift
      if (skyY < 0 && y >= 0) skyY = 0
      else if (skyShift > 0 && skyY < 0 && !(real && y < 0)) skyY = 0
      let bg = real && y < 0 ? this.skyAt(y) : this.skyAt(skyY)
      if (o > 0) bg = mix(bg, 0, o)
      rb[r] = bg
      // By night the stars are out at every height.
      const stars = Math.max(o * 1.3, Math.min(1, (skyY - 70) / 40), !(real && y <= 0) ? 0.5 * this.dark : 0) * 0.04
      for (let x = 0; x < w; x++) {
        const i = r * w + x
        // The ground (only ever in the real world below the layer).
        if (real && y <= 0) {
          const s = this.scenery(x, y, bg)
          if (s) out.set(i, s.glyph, s.fg, s.bg ?? bg)
          else out.set(i, 0x20, DEFAULT_COLOR, bg)
          continue
        }
        // Climbing into orbit the clouds fade into the darkening sky with it;
        // then every cloud color is snapped to a few steps off the sky (see snap).
        if (o < 0.98 && this.foldedCloud(x + drift, yf, a, bg)) {
          const fg = snap(o > 0 ? mix(this.cFg, bg, o) : this.cFg, bg)
          const cb = snap(o > 0 ? mix(this.cBg, bg, o) : this.cBg, bg)
          if (fg !== bg || cb !== bg) {
            out.set(i, GLYPH.top, fg, cb)
            continue
          }
        }
        if (stars > 0) {
          const hs = hash(x + sx, r - sy, 7)
          if (hs < stars) {
            const bright = hash(x + sx, r - sy, 8) < 0.5 ? STAR : STAR_DIM
            const glyph = starGlyph || (hs < stars * 0.2 ? GLYPH.star : GLYPH.dot)
            out.set(i, glyph, bright, bg)
            continue
          }
        }
        out.set(i, 0x20, DEFAULT_COLOR, bg)
      }
    }
    this.drawMoon(out)
    this.drawVehicle(out, 0)
    return out
  }

  /** The clouds at column x, world row yf, folded into the layer's tiles above anchor a. */
  private foldedCloud(x: number, yf: number, a: number, sky: number): boolean {
    const u = yf - a
    const k = u < 0 ? -1 : Math.floor(u / TILE)
    const kk = Math.max(0, k)
    const cy = yf - kk * TILE
    const xs = (kk + this.wraps) * TILE_X
    let has = this.cloud(x + xs, cy, sky)
    if (k < 0) return has
    // Near a seam, crossfade with the neighbouring tile so no edge shows.
    const f = u - k * TILE
    let cy2: number
    let xs2: number
    let wgt: number
    if (k >= 1 && f < FADE) {
      cy2 = cy + TILE
      xs2 = xs - TILE_X
      wgt = 0.5 + (0.5 * f) / FADE
    } else if (f > TILE - FADE) {
      cy2 = cy - TILE
      xs2 = xs + TILE_X
      wgt = 0.5 + (0.5 * (TILE - f)) / FADE
    } else return has
    const fg1 = has ? this.cFg : sky
    const bg1 = has ? this.cBg : sky
    const has2 = this.cloud(x + xs2, cy2, sky)
    if (!has && !has2) return false
    const fg2 = has2 ? this.cFg : sky
    const bg2 = has2 ? this.cBg : sky
    this.cFg = mix(fg2, fg1, wgt)
    this.cBg = mix(bg2, bg1, wgt)
    return true
  }

  /** A cloud sample from the layered painter into cFg / cBg (top and bottom half). */
  private cloud(x: number, y: number, sky: number): boolean {
    if (y < CLOUD_LO || y > CLOUD_HI) return false
    const c = layered.cell({ x: x / PAINT, y: y / PAINT, sky, t: this.t })
    if (!c) return false
    this.cFg = this.cloudLight(c.fg, sky)
    this.cBg = this.cloudLight(c.bg ?? sky, sky)

    return true
  }

  // ------------------------------------------------------------ flight

  protected override advance(): void {
    this.geo()
    const s = this.spec
    const rest = s.mount / 2
    const catchAlt = (s.armCatch - s.grip) / 2
    const home = this.target <= 0
    const lv = Math.max(0, Math.min(10, Math.round(this.strength)))
    const want = LAYER[lv]!
    if (this.fresh) {
      this.fresh = false
      // Picked while the level is already flying (a switch from the other
      // rocket, a reload): appear mid-stage rather than launching and racing
      // up through every stage to it.
      if (!home && lv >= 2) this.settle(lv, want, catchAlt)
    }
    if (this.layer < 0) this.layer = home ? LAYER[2]! : want
    // Coming home it lands in the arms.
    const goal = catchAlt
    const restArm = s.mount + s.grip
    let thrGoal = 0
    let armGoal = restArm
    this.timer++
    this.braking = false

    switch (this.state) {
      case 'rest':
        this.alt = rest
        this.v = 0
        this.reach = Math.max(0, this.reach - 1 / CLOSE)
        this.service = Math.min(1, this.service + 0.05)
        if (!home) this.go('ignite')
        break
      case 'ignite':
        this.alt = rest
        // On the pad nothing above the tower shows yet: the layer can be set outright.
        this.layer = want
        this.service = Math.max(0, this.service - 0.1)
        thrGoal = this.timer < 4 ? 0.15 : Math.min(1, this.timer / IGNITE)
        if (home) this.go('rest')
        else if (this.timer >= IGNITE) {
          this.go('fly')
          this.flyTime = 0
        }
        break
      case 'fly': {
        this.flyTime++
        this.service = Math.max(0, this.service - 0.1)
        if (!home) {
          // Always climbing: a launch's slow start, then the level's speed, and
          // faster still while it's working up into a higher layer.
          const vGoal = SPEED[lv]! * (1 - 0.8 * this.orbit) + Math.max(0, want - this.layer) * 0.012
          if (this.v < vGoal) this.v = Math.min(vGoal, this.v + 0.006 + Math.min(this.flyTime, 120) * 0.0004)
          else this.v = Math.max(vGoal, this.v - 0.02)
          this.alt += this.v
          const rate = Math.max(0.05, 0.6 * Math.max(0, this.v))
          this.layer += Math.max(-rate, Math.min(rate, want - this.layer))
          thrGoal = 1 - this.orbit * (1 - ORBIT_BURN[Math.max(0, lv - 8)]!)
          if (this.tint !== 'normal') thrGoal = Math.max(thrGoal, TINT_BURN)
          break
        }
        const d = goal - this.alt
        const brakeV = Math.sqrt(2 * DEC * Math.abs(d))
        if (d > 0) {
          // A launch: the first second barely moving, then faster and faster.
          this.v += 0.006 + Math.min(this.flyTime, 120) * 0.0004
          this.v = Math.min(this.v, VMAX, brakeV)
          thrGoal = this.v >= brakeV - 0.01 && d < 4 ? 0.65 : 1
        } else if (d < 0) {
          this.v = Math.max(this.v - ACC_DOWN, -VMAX_DOWN)
          if (this.v <= -brakeV) {
            this.v = -brakeV
            this.braking = true
          }
          // Coasting down with the engines off, then the landing burn.
          thrGoal = this.braking ? 0.6 : 0
        } else thrGoal = 0.6
        if (Math.abs(d) <= Math.abs(this.v) + 0.02 && Math.abs(this.v) < 0.25) {
          this.alt = goal
          this.v = 0
          this.go('catch')
        } else this.alt += this.v
        armGoal = s.armCatch
        break
      }
      case 'catch':
        this.alt = catchAlt
        armGoal = s.armCatch
        // Hover on the engines until the arms are up, then swing them shut.
        if (Math.abs(this.armY - s.armCatch) > 0.5) this.timer = 0
        this.reach = Math.min(1, this.timer / CLOSE)
        thrGoal = this.reach < 1 ? 0.45 : 0
        if (this.timer >= CLOSE + 8) this.go('lower')
        if (!home) this.go('release')
        break
      case 'lower': {
        armGoal = -1
        if (!home) {
          this.go('release')
          break
        }
        const span = Math.max(0.5, catchAlt - rest)
        const frac = (this.alt - rest) / span
        this.alt -= Math.max(0.012, span * (0.004 + 0.022 * Math.sin(Math.PI * Math.min(1, frac))))
        if (this.alt <= rest) {
          this.alt = rest
          this.go('release')
        }
        break
      }
      case 'release':
        armGoal = -1
        this.reach = Math.max(0, this.reach - 1 / CLOSE)
        thrGoal = this.alt > rest + 0.25 && !home ? 0.8 : 0
        if (this.reach <= 0) {
          if (this.alt > rest + 0.25) {
            this.go('fly')
            this.flyTime = 60
          } else this.go('rest')
        }
        break
    }

    // The carriage rides with the rocket while it grips; otherwise it eases to its goal.
    if (armGoal < 0) this.armY = this.apx() + s.grip
    else if (this.armY < 0) this.armY = armGoal
    else this.armY += Math.max(-0.6, Math.min(0.6, armGoal - this.armY))

    this.thr += (thrGoal - this.thr) * 0.35
    if (this.thr < 0.02 && thrGoal === 0) this.thr = 0

    const flying = this.state === 'fly'
    // Into orbit from 8, high enough; out of it as soon as it's asked down.
    const orbitGoal = flying && !home && lv >= 8 && this.layer > LAYER[8]! - 30 ? 1 : 0
    this.orbit += Math.max(-0.03, Math.min(0.025, orbitGoal - this.orbit))
    if (this.orbit < 0.001) this.orbit = 0
    // The tilt and speed ease toward the level's: 8 tilted, 9 nearly flat, 10 flat out.
    const oi = Math.max(0, Math.min(2, lv - 8))
    const tiltGoal = orbitGoal ? (this.tall ? TILT_TALL : TILT_BAND)[oi]! : 0
    this.tilt += Math.max(-0.055, Math.min(0.025, tiltGoal - this.tilt))
    this.orbitSpeed += ((orbitGoal ? ORBIT_SPEED[oi]! : 0) - this.orbitSpeed) * 0.04
    // A tall pane keeps the rocket mid-screen in flight (the ground back in view for the catch).
    const camGoal =
      this.tall && flying && (!home || this.alt - catchAlt > 25) ? Math.round(HEADROOM * this.rows * 2) : 0
    this.camP += Math.max(-0.6, Math.min(0.6, camGoal - this.camP))
    // Fold away a tile once the real world below the layer is off the grid.
    if (flying && !home) {
      const a = this.layer - TILE / 2
      while (this.scroll - 1 - a >= 2 * TILE + 1) {
        this.alt -= TILE
        this.wraps++
        for (let i = 0; i < PMAX; i++) this.py[i]! -= 2 * TILE
      }
    }
    // The stars stream past: down as it climbs, and down-and-back along its tilt in orbit.
    const tilt = this.tilt
    const os = this.orbit * this.orbitSpeed
    this.starVX = Math.sin(tilt) * os
    this.starVY = (flying ? this.v * (1 - this.orbit) : 0) + Math.cos(tilt) * os * 0.5
    this.starX += this.starVX
    this.starY += this.starVY
    this.earthX += this.orbit * this.orbitSpeed * 0.45

    this.stepParticles()
  }

  /** Start already in a level's steady flight: in its layer, at its speed, in orbit from 8. */
  private settle(lv: number, layer: number, catchAlt: number): void {
    this.state = 'fly'
    this.flyTime = 120
    this.alt = catchAlt + 200
    this.v = SPEED[lv]!
    this.thr = 1
    this.layer = layer
    this.service = 0
    this.reach = 0
    if (lv >= 8) {
      const oi = Math.min(2, lv - 8)
      this.orbit = 1
      this.tilt = (this.tall ? TILT_TALL : TILT_BAND)[oi]!
      this.orbitSpeed = ORBIT_SPEED[oi]!
    }
    if (this.tall) this.camP = Math.round(HEADROOM * this.rows * 2)
  }

  private go(state: State): void {
    this.state = state
    this.timer = 0
  }

  /** Coming in: legs out, grid fins deployed. */
  private landing(): boolean {
    return this.state === 'catch' || this.state === 'lower' || (this.state === 'fly' && this.v < -0.05)
  }

  private get ramp(): Ramp {
    if (this.tint === 'smoke') return RAMPS.smoke
    if (this.tint === 'blue') return RAMPS.blue
    return this.look.ramp
  }

  /** The plume's length this frame, flickering (and sputtering on a failed command). */
  private plumeLen(): number {
    if (this.thr <= 0) return 0
    let len = this.spec.plume * this.thr * (0.85 + 0.3 * this.rng.f())
    if (this.tint === 'smoke' && hash(this.t >> 1, 3, 43) < 0.35) len *= 0.25
    return len
  }

  // ------------------------------------------------------------ particles

  private spawn(x: number, y: number, vx: number, vy: number, life: number, r0: number, r1: number, color: number, a0: number): void {
    const i = this.nextP
    this.nextP = (i + 1) % PMAX
    this.px[i] = x
    this.py[i] = y
    this.vx[i] = vx
    this.vy[i] = vy
    this.life[i] = life
    this.maxLife[i] = life
    this.r0[i] = r0
    this.r1[i] = r1
    this.pcol[i] = color
    this.a0[i] = a0
  }

  private stepParticles(): void {
    for (let i = 0; i < PMAX; i++) {
      if (this.life[i]! <= 0) continue
      this.life[i]! -= 1
      this.px[i]! += this.vx[i]!
      this.py[i]! += this.vy[i]!
      this.vx[i]! *= 0.96
    }
    const s = this.spec
    const r = this.rng
    const A = this.apx()
    const cx = this.bodyPx + s.bodyW / 2 - 0.5
    const scale = this.tall ? 1 : 0.6
    const smoky = this.tint === 'smoke'
    const len = this.thr > 0 ? s.plume * this.thr : 0

    // Steam and smoke billowing off the pad while the plume reaches it.
    if (len > 0 && A - len < 2) {
      const n = (this.tall ? 6 : 2) + (this.state === 'ignite' ? 2 : 0)
      for (let k = 0; k < n; k++) {
        const side = r.f() < 0.5 ? -1 : 1
        const out = s.bodyW / 2 + r.f() * (len - A + 2) * 1.2
        const shade = smoky ? mix(0x9a9a9a, 0x4a4a4a, r.f()) : mix(0xffffff, 0xb4bac2, r.f() * 0.7)
        this.spawn(
          cx + side * out,
          r.f() * 2 - 0.5,
          side * (0.35 + r.f() * 1.3) * scale,
          0.03 + r.f() * 0.12,
          40 + r.f() * 50,
          s.puff[0],
          s.puff[1] * (0.7 + r.f() * 0.5),
          shade,
          0.85,
        )
      }
    }
    // A contrail left hanging in the air: it falls away below as the rocket climbs.
    if (this.state === 'fly' && len > 0 && A - len > 1 && this.orbit < 0.3 && this.layer < 80) {
      const thick = this.layer < 40 ? 1 : 0.6
      this.spawn(
        cx + (r.f() - 0.5) * s.bodyW,
        A - len - 1,
        (r.f() - 0.5) * 0.1,
        0,
        30 + r.f() * 30,
        s.puff[0],
        s.puff[1] * 0.6 * thick,
        smoky ? 0x5a5a5a : 0xd9dee5,
        smoky ? 0.6 : 0.55 * thick,
      )
    }
    // Fuelled and waiting: cold vapour venting, sinking as it drifts. More with subagents.
    const venting = this.state === 'rest' || this.state === 'ignite' || (this.state === 'release' && this.alt <= s.mount / 2)
    if (venting) {
      const p = (0.16 + Math.min(60, this.coverageBoost) * 0.01 + (smoky ? 0.25 : 0)) * (this.tall ? 1 : 0.6)
      const sp = s.fly
      for (const [col, row, dir] of s.vents) {
        if (r.f() >= p) continue
        this.spawn(
          this.ox + col + dir * 0.5,
          A + (sp.h - 1 - row),
          dir * (0.12 + r.f() * 0.3) * (this.tall ? 1 : 0.7),
          -(0.02 + r.f() * 0.05),
          22 + r.f() * 26,
          0.5,
          (this.tall ? 2.2 : 1.1) * (0.7 + r.f() * 0.6),
          smoky ? 0x8a8a8e : this.tint === 'blue' ? 0xbcd8ff : 0xf2f6fb,
          0.7,
        )
      }
    }
    // A failed command: the climbing rocket coughs dark smoke.
    if (smoky && this.state === 'fly' && this.orbit <= 0.3 && r.f() < 0.4) {
      this.spawn(cx, A - 1, (r.f() - 0.5) * 0.4, -0.1, 25 + r.f() * 20, s.puff[0], s.puff[1], 0x55555a, 0.75)
    }
    // A tint aloft: puffs off the rocket as drawn (posed, in orbit), riding
    // along with its climb a while before falling behind. Smoke trails off
    // the tail; a near-full context fires blue-white thruster puffs off the nose.
    if (this.state === 'fly' && this.target > 0 && this.tint !== 'normal') {
      this.base = 2 * (this.scroll + this.rows - 2) + 1
      const [px, py, th, sc] = this.pose(s.fly)
      const sn = Math.sin(th)
      const cs = Math.cos(th)
      const reach = s.fly.h * sc
      // Climbing, puffs keep pace (the world scrolls 2 pixels a row) and drift off sideways.
      const ride = Math.max(0, this.v) * 2
      if (smoky && r.f() < 0.7) {
        const yh = this.base - (py + (reach * cs) / 2)
        const drift = (r.f() < 0.5 ? -1 : 1) * cs * (0.2 + r.f() * 0.5)
        this.spawn(px - reach * sn + (r.f() - 0.5) * 2, yh, drift - sn * (0.3 + r.f() * 0.5), ride - cs * 0.05, 18 + r.f() * 14, s.puff[0], s.puff[1] * 1.3, 0x5c5c62, 0.85)
      } else if (!smoky && r.f() < 0.6) {
        const side = r.f() < 0.5 ? -1 : 1
        const at = 0.55 + r.f() * 0.35
        const yh = this.base - (py - (reach * at * cs) / 2)
        this.spawn(px + reach * at * sn + side * cs * 1.5, yh, side * cs * (0.5 + r.f() * 0.4), ride - side * sn * 0.3, 9 + r.f() * 6, 0.8, s.puff[1], 0xe4f0ff, 1)
      }
    }
  }

  // ------------------------------------------------------------ drawing

  private paint(x: number, yh: number, color: number, a: number): void {
    this.paintP(x, this.base - yh, color, a)
  }

  /** Paint a pixel by its grid-pixel position (row py from the top). */
  private paintP(x: number, py: number, color: number, a: number): void {
    if (x < 0 || x >= this.pw || py < 0 || py >= this.ph || a <= 0.03) return
    const k = py * this.pw + x
    const old = this.pa[k]!
    if (a >= 1) {
      this.pc[k] = color
      this.pa[k] = 1
    } else if (old === 0) {
      this.pc[k] = color
      this.pa[k] = a
    } else {
      this.pc[k] = mix(this.pc[k]!, color, a)
      this.pa[k] = old + a * (1 - old)
    }
    const cell = (py >> 1) * this.columns + (x >> 1)
    if (!this.touched[cell]) {
      this.touched[cell] = 1
      this.list[this.nTouched++] = cell
    }
  }

  protected drawVehicle(out: Cells, _top: number): void {
    this.geo()
    this.base = 2 * (this.scroll + this.rows - 2) + 1
    this.drawTower()
    this.drawMount()
    this.drawEarth(out)
    this.drawParticles()
    if (this.orbit > 0.02) this.drawTiltedPlume()
    else this.drawPlume()
    this.drawRocket()
    this.drawArms()
    this.drawLights()
    this.composite(out)
  }

  private drawTower(): void {
    const s = this.spec
    const tw = s.towerW
    const col = this.look.tower
    const mz = this.look.mechazilla
    const top = Math.min(s.towerH - 1, this.base)
    for (let y = Math.max(0, this.base - this.ph + 1); y <= top; y++) {
      const x0 = this.tx
      this.paint(x0, y, col, 1)
      this.paint(x0 + tw - 1, y, col, 1)
      if (mz && tw >= 6) {
        // X-bracing.
        const t = y % (tw - 2)
        this.paint(x0 + 1 + t, y, col, 1)
        this.paint(x0 + tw - 2 - t, y, col, 1)
      } else if (!mz && y % 4 === 0) {
        for (let x = 1; x < tw - 1; x++) this.paint(x0 + x, y, col, 1)
      } else this.paint(x0 + 1 + (y % (tw - 2)), y, col, 0.85)
    }
    if (this.tall) {
      // A lightning rod on top.
      const rx = this.tx + (mz ? tw >> 1 : tw - 1)
      for (let y = s.towerH; y < s.towerH + (mz ? 4 : 2); y++) this.paint(rx, y, 0x8a9099, 1)
      // The carriage the arms ride on.
      if (mz) {
        const ay = Math.round(this.armY)
        for (let y = ay - 1; y <= ay + s.armThick; y++)
          for (let x = 0; x < tw; x++) this.paint(this.tx + x, y, this.look.carriage, 1)
      }
      // The service arm (crew access / ship quick-disconnect), swung away for flight.
      if (s.service !== undefined) {
        const y = s.mount + (s.fly.h - 1 - s.service)
        const full = this.tx - (this.bodyPx + s.bodyW)
        const len = Math.max(1, Math.round(full * this.service))
        for (let x = 1; x <= len; x++) this.paint(this.tx - x, y, this.look.tower, 1)
        this.paint(this.tx - 1, y - 1, this.look.tower, 0.8)
      }
    }
  }

  /** Starship stands on the orbital launch mount: a table on legs. */
  private drawMount(): void {
    const m = this.spec.mount
    if (m <= 0) return
    const l = this.bodyPx - 2
    const r = this.bodyPx + this.spec.bodyW + 1
    const col = 0x80868f
    for (let x = l; x <= r; x++) this.paint(x, m - 1, col, 1)
    for (let y = 0; y < m - 1; y++) {
      this.paint(l, y, col, 1)
      this.paint(r, y, col, 1)
    }
  }

  private drawParticles(): void {
    for (let i = 0; i < PMAX; i++) {
      const life = this.life[i]!
      if (life <= 0) continue
      const f = 1 - life / this.maxLife[i]!
      const rad = this.r0[i]! + (this.r1[i]! - this.r0[i]!) * Math.sqrt(f)
      const a = this.a0[i]! * (1 - f)
      const cx = Math.round(this.px[i]!)
      const cy = Math.round(this.py[i]!)
      const color = this.pcol[i]!
      if (rad < 0.8) {
        this.paint(cx, cy, color, a)
        continue
      }
      const rx = Math.floor(rad)
      const ry = Math.floor(rad / 2)
      const inv = 1 / (rad * rad)
      // Lit from above: the underside of a billow a little darker.
      const under = mix(color, 0x8e959e, 0.3)
      for (let dy = -ry; dy <= ry; dy++)
        for (let dx = -rx; dx <= rx; dx++) {
          const d2 = (dx * dx + 4 * dy * dy) * inv
          if (d2 > 1) continue
          this.paint(cx + dx, cy + dy, dy < 0 ? under : color, a * (1 - 0.6 * d2))
        }
    }
  }

  private drawPlume(): void {
    const len = this.plumeLen()
    if (len < 0.5) return
    const s = this.spec
    const ramp = this.ramp
    const A = this.apx()
    const cx = this.bodyPx + s.bodyW / 2 - 0.5
    // Thin air lets the plume balloon out.
    const spread = 0.08 + Math.min(0.45, this.alt / 180)
    const t = this.t
    for (let d = 0; d < len; d++) {
      const y = A - 1 - d
      const half = s.bodyW / 2 + d * spread
      if (y < 0) {
        this.deflect(cx, half, len - d, ramp)
        break
      }
      const k = d / len
      // Shock diamonds in the core.
      const diamond = this.tall && d % 5 === 2 && k < 0.6 ? 0.15 : 0
      const xa = Math.ceil(cx - half)
      const xb = Math.floor(cx + half)
      for (let x = xa; x <= xb; x++) {
        const edge = Math.abs(x - cx) / (half + 0.5)
        const n = hash(x, d + t * 7, 47) - 0.5
        const heat = 1 - 0.85 * k - 0.45 * edge * edge + diamond + n * 0.15
        const a = Math.min(1, (1 - k) * 2.4 - edge * 0.35 + n * 0.4)
        this.paint(x, y, rampColor(ramp, heat), a)
      }
    }
  }

  /** The plume hitting the pad, splashing sideways in fire and steam. */
  private deflect(cx: number, half: number, rest: number, ramp: Ramp): void {
    const reach = rest * 1.4 + 2
    const t = this.t
    for (let side = -1; side <= 1; side += 2)
      for (let s = 0; s <= reach; s++) {
        const x = Math.round(cx + side * (half + s))
        const k = s / reach
        const n = hash(x, t, 53) - 0.5
        const heat = 0.85 - 0.75 * k + n * 0.2
        const a = 1 - k * 0.85 + n * 0.3
        this.paint(x, 0, rampColor(ramp, heat), a)
        if (k > 0.3) this.paint(x, 1, rampColor(ramp, heat - 0.25), a * 0.6)
      }
  }

  /** Where the rocket is drawn: its center (grid pixels), tilt and scale, eased into orbit. */
  private pose(sp: Sprite): [cx: number, cy: number, tilt: number, scale: number] {
    const o = this.orbit
    const cx = this.ox + sp.w / 2
    const cy = this.base - this.apx() - sp.h + 1 + sp.h / 2
    if (o <= 0) return [cx, cy, 0, 1]
    const k = o * o * (3 - 2 * o)
    // In orbit it sits mid-grid, tilted toward its travel; in the spine the
    // camera pulls back so the whole tilted stack fits the narrow pane.
    const ocx = this.pw / 2 + (this.tall ? 0 : -2)
    const ocy = this.ph * (this.tall ? 0.42 : 0.36)
    return [
      cx + (ocx - cx) * k,
      cy + (ocy - cy) * k,
      this.tilt,
      // Shrunk just enough for the tilted stack to fit the pane's width.
      this.tall ? 1 - k * (1 - Math.min(0.85, (this.pw - 7) / (2 * sp.h * Math.max(0.3, Math.sin(this.tilt))))) : 1,
    ]
  }

  private drawRocket(): void {
    const s = this.spec
    const sp = this.landing() ? s.land : s.fly
    const frost = this.look.mechazilla && (this.state === 'rest' || this.state === 'ignite')
    const [cx, cy, th, sc] = this.pose(sp)
    const cs = Math.cos(th)
    const sn = Math.sin(th)
    // Every grid pixel the rotated sprite might cover, sampled back into the
    // sprite (a pixel is twice as tall as it is wide).
    const rx = Math.ceil((Math.abs(cs) * sp.w / 2 + Math.abs(sn) * sp.h) * sc) + 1
    const ry = Math.ceil((Math.abs(sn) * sp.w / 4 + Math.abs(cs) * sp.h / 2) * sc) + 1
    const inv = 1 / sc
    for (let py = Math.floor(cy - ry); py <= Math.ceil(cy + ry); py++) {
      if (py < 0 || py >= this.ph) continue
      const uy = (py + 0.5 - cy) * 2
      for (let px = Math.floor(cx - rx); px <= Math.ceil(cx + rx); px++) {
        const ux = px + 0.5 - cx
        const col = Math.floor((ux * cs + uy * sn) * inv + sp.w / 2)
        const row = Math.floor(((-ux * sn + uy * cs) * inv) / 2 + sp.h / 2)
        if (col < 0 || col >= sp.w || row < 0 || row >= sp.h) continue
        let c = sp.c[row * sp.w + col]!
        if (c < 0) continue
        // The engines glow while they burn (blue-white near a full context).
        if (row === sp.h - 1 && this.thr > 0 && col >= s.bodyL && col < s.bodyL + s.bodyW)
          c = mix(c, this.tint === 'blue' ? 0x8cc0ff : 0xffc46a, Math.min(0.95, this.thr * 1.4))
        // Super Heavy frosts over where the cold propellant sits.
        if (frost && row > sp.h * 0.6 && row < sp.h - 2 && hash(col, row, 61) < 0.55) c = mix(c, 0xf4f8fc, 0.6)
        this.paintP(px, py, c, 1)
      }
    }
  }

  /** The plume in orbit: a thin burn trailing back along the tilted axis. */
  private drawTiltedPlume(): void {
    const len = this.plumeLen()
    if (len < 0.5) return
    const s = this.spec
    const sp = s.fly
    const [cx, cy, th, sc] = this.pose(sp)
    const cs = Math.cos(th)
    const sn = Math.sin(th)
    const ramp = this.ramp
    // The tail, in units (a pixel is 1 wide, 2 tall), and the axis pointing aft.
    const tx = cx - sp.h * sn * sc
    const ty = cy * 2 + sp.h * cs * sc
    const L = len * 2 * sc
    for (let d = 0.5; d < L; d += 1) {
      const k = d / L
      const half = (s.bodyW / 2) * sc + d * 0.12
      for (let e = -half; e <= half; e += 0.75) {
        const x = Math.floor(tx - sn * d + cs * e)
        const y = Math.floor((ty + cs * d + sn * e) / 2)
        const edge = Math.abs(e) / (half + 0.5)
        const n = hash(x, y + this.t * 7, 47) - 0.5
        const heat = 1 - 0.85 * k - 0.45 * edge * edge + n * 0.15
        this.paintP(x, y, rampColor(ramp, heat), Math.min(1, (1 - k) * 1.6 - edge * 0.4 + n * 0.3) * (this.tint === 'normal' ? 0.55 : 0.85))
      }
    }
  }

  /**
   * Earth below the orbit: a curved limb of ocean and cloud sliding back.
   * The limb's own cell in each column is drawn straight into the cells as a
   * lower-block glyph filled to the curve's height (to an eighth of a cell,
   * dithered a little per column), so the curve reads smoothly instead of in
   * pixel-high steps; the ocean below it goes through the pixel layer.
   */
  private drawEarth(out: Cells): void {
    const o = this.orbit
    if (o <= 0.01) return
    const w = this.columns
    const h = this.rows
    const ph = this.ph
    const h0 = this.tall ? 6 : 2
    const h1 = this.tall ? 2.5 : 0.4
    const ex = Math.floor(this.earthX)
    for (let c = 0; c < w; c++) {
      // The limb's top in cells, at this column's center.
      const rel = (c + 0.5 - w / 2) / (w / 2)
      const top = (ph - (h0 - (h0 - h1) * rel * rel)) / 2
      const rc = Math.min(h - 1, Math.floor(top))
      const eighths = Math.max(0, Math.min(8, Math.floor((rc + 1 - top) * 8 + hash(c, 0, 73))))
      const i = rc * w + c
      const behind = out.background(i)
      // A sliver is all bright limb; a fuller cell mostly the ocean under it.
      const limb = mix(LIMB, OCEAN, Math.max(0, (eighths - 2) / 6) * 0.65)
      out.set(i, lowerBlock(eighths), mix(behind, limb, o), behind)
      // The ocean (with cloud and land sliding by) in the whole cells below.
      for (let y = 2 * (rc + 1); y < ph; y++)
        for (let x = 2 * c; x < 2 * c + 2; x++) {
          const n = hash((x + ex) >> 1, y, 71)
          const m = hash((x + ex + 1) >> 2, y >> 1, 72)
          this.paintP(x, y, n < 0.16 || m < 0.12 ? 0xdde6f0 : m > 0.86 ? 0x4c7b45 : OCEAN, o)
        }
    }
  }

  /** The catch arms: foreshortened stubs when swung open, across the rocket when shut. */
  private drawArms(): void {
    const s = this.spec
    const ay = Math.round(this.armY)
    const start = this.tx - 1
    // Mechazilla's chopsticks reach well past the booster.
    const tip = this.bodyPx - 1 - (this.look.mechazilla && this.tall ? 2 : 0)
    const full = start - tip + 1
    const len = s.armStub + Math.round(this.reach * (full - s.armStub))
    const col = this.look.arm
    for (let t = 0; t < s.armThick; t++) for (let x = 0; x < len; x++) this.paint(start - x, ay + t, col, 1)
    if (this.reach >= 1 && this.tall) {
      // The pincers' tips closing round the far side.
      this.paint(tip, ay - 1, col, 1)
      this.paint(tip, ay + s.armThick, col, 1)
    }
  }

  private drawLights(): void {
    const s = this.spec
    const blue = this.tint === 'blue'
    const top = this.tall ? s.towerH + (this.look.mechazilla ? 4 : 2) : s.towerH - 1
    const tx = this.tall ? this.tx + (this.look.mechazilla ? s.towerW >> 1 : s.towerW - 1) : this.tx + s.towerW - 1
    const t = this.t
    // A failed command: the lights burn low. Blue: blue lights all the way up the tower.
    const dim = this.tint === 'smoke' ? 0.45 : 1
    if (t % 24 < 6) this.paint(tx, top, blue ? LIGHT.blue : LIGHT.red, dim)
    if (blue)
      for (let y = 2, k = 0; y < top - 1; y += this.tall ? 6 : 3, k++)
        if ((t + k * 5) % 24 < 14) this.paint(this.tx + (k & 1 ? 0 : s.towerW - 1), y, LIGHT.blue, 1)
    // A light per few subagents, blinking out of step.
    const extra = this.coverageBoost <= 0 ? 0 : this.coverageBoost < 30 ? 1 : 2
    for (let k = 1; k <= extra; k++) {
      if ((t + k * 8) % 24 >= 6) continue
      const y = Math.round((s.towerH * (3 - k)) / 4)
      this.paint(this.tx + (k & 1 ? 0 : s.towerW - 1), y, blue ? LIGHT.blue : k === 1 ? LIGHT.amber : LIGHT.green, dim)
    }
  }

  /** Fold each touched cell's four pixels into the two colors that best fit them. */
  private composite(out: Cells): void {
    const w = this.columns
    const pw = this.pw
    const q = this.quad
    for (let n = 0; n < this.nTouched; n++) {
      const cell = this.list[n]!
      this.touched[cell] = 0
      const r = (cell / w) | 0
      const c = cell - r * w
      const behind = out.behind(cell)
      const k0 = 2 * r * pw + 2 * c
      for (let p = 0; p < 4; p++) {
        const k = k0 + (p & 2 ? pw : 0) + (p & 1)
        const a = this.pa[k]!
        q[p] = a === 0 ? behind : a >= 1 ? this.pc[k]! : mix(behind, this.pc[k]!, a)
        this.pa[k] = 0
      }
      // The two colors that best fit them, each the plain average of its pixels.
      const f = this.fit
      fitQuad(q, f, Infinity)
      if (f.spread === 0) out.set(cell, 0x20, DEFAULT_COLOR, q[0]!)
      else out.set(cell, QUAD[f.mask]!, f.fg, f.bg)
    }
    this.nTouched = 0
  }
}

export class Falcon extends LaunchSite {
  protected readonly specs = FALCON_SPECS
  protected readonly look: Look = {
    tower: 0x5a6069,
    arm: 0x2a2e34,
    carriage: 0x7d848e,
    ramp: RAMPS.merlin,
    mechazilla: false,
  }
}

export class Starship extends LaunchSite {
  protected readonly specs = STARSHIP_SPECS
  protected readonly look: Look = {
    tower: 0x4e545d,
    arm: 0x24272c,
    carriage: 0x8a9099,
    ramp: RAMPS.raptor,
    mechazilla: true,
  }
}
