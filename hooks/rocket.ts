// REVISION: flow-v102-review-fixes
//
// Two launch sites in the sky world (sky.ts): a Falcon 9 and a Starship, each
// beside a lattice launch tower (Starship's with two catch arms). The level is the
// rocket's target altitude. At 1 it stands on the pad, fuelled, venting
// white vapour. When the level rises it ignites, holds a beat while steam
// billows off the pad, then lifts off: slowly, then faster, the plume
// (white-hot core, orange, fading red) trailing a contrail that falls away
// below as the clouds go by, until at 10 it hangs among the stars over
// Earth's rim. High in the climb (about level 7) the stack separates: the
// spent booster falls away and the upper stage flies on, on one narrower
// engine. Only the booster comes home: when the level falls back the upper
// stage goes on to orbit and the booster comes down, grid fins out,
// coasting, then lights a landing burn. Once the falling booster has left
// the frame the screen splits (side by side in the band, top and bottom in
// a tall pane): the booster's side follows it back down through the sky a
// layer a second, then slides away; the other stays with the upper stage,
// whatever the level. Falcon's booster puts its legs out only for its
// landing burn, on a landing zone out of sight of the pad.
// Falcon carries Dragon: in orbit it parts from the second stage (which
// drifts off, to burn up). Brought home, Dragon drops its trunk, comes in
// glowing, opens two drogues then four striped mains and splashes down at
// sea; a moment later the camera slides back along the coast to the pad,
// reset for the next flight. Starship's booster is caught by the tower's
// arms in mid-air and lowered onto the mount. Brought home, the Ship comes
// in belly-first, tiles glowing, flips upright for its landing burn and
// splashes down, is carried in by barge and transporter to beside the
// waiting booster, and the arms reach over, lift it, swing it across and
// lower it on. Then the stack goes back to venting. A mission only climbs:
// a dip in the work holds the level, and only back at 1 does it come home,
// a level a second, all the way.
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
import { defineScene } from './scene-def'

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

/** The first row holding `ch`: where a sprite's booster starts. */
function firstRow(rows: readonly string[], ch: string): number {
  return rows.findIndex(r => r.includes(ch))
}

const FALCON_PAL = {
  W: 0xf4f5f7, // white body, lit side
  w: 0xc3c8d0, // its shaded side
  K: 0x1d2025, // black interstage, octaweb, stowed legs
  G: 0x3a3e46, // grid fins
  L: 0x2c2f35, // deployed legs
  E: 0x70757d, // Merlin bells
  H: 0x2a2c31, // Dragon's heat shield
  P: 0x23315a, // the trunk's solar cells
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

// Falcon 9 in the spine: Dragon (its nose cap, the capsule, the dark heat
// shield, the trunk with its solar cells), the second stage, the black
// interstage, grid fins, the long first stage, stowed legs and the octaweb
// with its Merlins.
const FALCON_TALL_TOP = [
  '....Ww....',
  '...WWWw...',
  '...WWWw...',
  '...HHHH...',
  '...WPPw...',
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
const FALCON_TALL_FINS = [
  ...FALCON_TALL_TOP,
  '.GGWWWwGG.',
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
  /** The booster coming home: grid fins deployed, legs still stowed. */
  fins: Sprite
  /** Its look landing and landed: legs out too. */
  land: Sprite
  /** The first sprite row of the booster (the first stage): the rows above are the upper stage. */
  stage: number
  /** Falcon's Dragon at the top of the upper stage: its rows (capsule and trunk), and the capsule's alone. */
  dragon?: number
  capsule?: number
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
    fins: sprite(FALCON_BAND, FALCON_PAL),
    land: sprite(FALCON_BAND_LAND, FALCON_PAL),
    stage: firstRow(FALCON_BAND, 'K'),
    dragon: 1,
    capsule: 1,
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
    fins: sprite(FALCON_TALL_FINS, FALCON_PAL),
    land: sprite(FALCON_TALL_LAND, FALCON_PAL),
    stage: firstRow(FALCON_TALL, 'K'),
    dragon: firstRow(FALCON_TALL, 'P') + 1,
    capsule: firstRow(FALCON_TALL, 'P'),
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
    fins: sprite(STARSHIP_BAND, STARSHIP_PAL),
    land: sprite(STARSHIP_BAND, STARSHIP_PAL),
    stage: firstRow(STARSHIP_BAND, 'G'),
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
    fins: sprite(STARSHIP_TALL, STARSHIP_PAL),
    land: sprite(STARSHIP_TALL, STARSHIP_PAL),
    stage: firstRow(STARSHIP_TALL, 'D'),
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
  /** The tower's arms catch it coming home; without them it lands on its legs on the pad. */
  catches: boolean
}

const PAD: SceneryCell = { glyph: g('▀'), fg: 0x9a9da3, bg: 0x6b6e74 }
const TRENCH: SceneryCell = { glyph: g('▀'), fg: 0x4a4c50, bg: 0x6b6e74 }
const SEA: SceneryCell = { glyph: g('▀'), fg: 0x3a7cc0, bg: 0x1d4e8e }

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

type State = 'rest' | 'ignite' | 'fly' | 'catch' | 'lower' | 'release' | 'landed' | 'carry' | 'stack' | 'pan'

/** What flies as the rocket: the whole stack, the upper stage after separation, or the booster coming home. */
type Part = 'full' | 'upper' | 'booster' | 'dragon' | 'capsule' | 'stage2' | 'trunk'

/** A stage that has parted from the rocket: drawn sliding away along its axis (`d` sprite rows), fading out. */
type Ghost = { part: Part; d: number; v: number; acc: number; life: number; max: number }

/** The layer (world rows) where the climbing stack separates: about level 7. */
const SEP_LAYER = 80
/** Frames a landed Falcon stands at the landing zone before it's moved back to the pad. */
const LANDED_FRAMES = 42


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
  /** Another site like this one, for the split screen. */
  protected abstract twin(): LaunchSite

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
      this.descending = false
    } else if (this.sinceStage >= STAGE_FRAMES) {
      // A mission only climbs: a dip in the work holds it where it is. Asked
      // all the way back to 1 it comes home, a level a second, all the way,
      // whatever's asked meanwhile.
      if (this.descending || (asked <= 1 && this.staged > 1)) {
        this.staged--
        this.sinceStage = 0
        this.descending = this.staged > 1
      } else if (asked > this.staged) {
        this.staged++
        this.sinceStage = 0
      }
    }
    this.strength = this.staged
    super.step()
  }

  /** Coming home: the acted-out level walking down to 1. */
  private descending = false

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
  /** What flies now, and a stage parted from it, still drawn while it falls or flies away. */
  private part: Part = 'full'
  private ghost: Ghost | null = null
  /** How faded in the booster is after the cut to it coming home (0..1). */
  private fadeIn = 1
  /** The rocket's place along the ground from the launch mount (pixels): out at the landing zone, back after. */
  private pos = 0
  /** The camera's place along the ground (pixels): it follows the booster out to the landing zone and back. */
  private view = 0
  /** The landing zone, off along the ground from the mount (pixels, left, out of sight of the pad), or 0 for none. */
  private lz = 0
  /** Restacking Starship: the Ship's place along the ground, its height above its stacked place (pixels), and the step. */
  private shipX = 0
  private stackOff = 0
  private phase = 0
  /** How far the arms reach out past the rocket's axis (pixels, left): over to the Ship on its transporter. */
  private armX = 0
  /** Coming home (and then being stacked again): it can't relaunch until it's back together on the pad. */
  private returning = false
  /**
   * Starship's split screen: a second site on the left, following the booster
   * back into the arms while this one stays with the Ship; its width (cells,
   * easing in and out) and the width it's drawn at.
   */
  private twinSite: LaunchSite | null = null
  private splitW = 0
  private twinW = 0
  /** The twin's frames since its booster came to rest on the mount (then the panel slides away). */
  private twinDone = 0
  /** Starship has separated: the split screen opens once the falling booster has left the frame. */
  private twinDue = false
  /** This site only brings a booster home (the split screen's left side): no Ship to stack after. */
  private boosterOnly = false
  /** Starship's booster is back on the mount, waiting for the Ship. */
  private boosterHome = false
  /** Splash: frames since the Ship came down in the sea (spray). */
  private splash = 0
  /** The recovery vessel's place along the ground (pixels): a barge on the sea, a transporter on land; NaN when there's none. */
  private carrierX = Number.NaN
  /** Dragon coming home: frames since it began (0 = not). */
  private burn = 0
  /** The Ship coming in belly-first: 0 upright .. 1 flat (nose toward the sea), eased. */
  private flop = 0
  /** Dragon's capsule leaning into its lifting entry (radians), eased. */
  private lean = 0
  /** The Ship's end at sea: frames of fireball since it tipped over. */
  private boom = 0
  /** Dragon's parachutes: 0 none, 1 drogues, 2 mains; how far open (0..1). */
  private chute = 0
  private chuteOpen = 0
  /** The split screen runs top and bottom in a tall pane (the booster's view rising from the bottom). */
  private splitTall = false
  private twinH = 0
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
    // A new size (another layout, a resized pane) mid-split: the panel was
    // laid out for the old one, so it closes; the booster is simply home.
    if (this.twinSite || this.twinDue) {
      this.twinSite = null
      this.twinDue = false
      this.splitW = 0
      this.boosterHome = true
    }
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
    // Falcon's booster lands on its legs on a landing zone off to the left,
    // and Starship's Ship splashes down in the sea there: far enough that the
    // pad is out of sight.
    this.lz = this.boosterOnly && this.look.catches ? 0 : -2 * Math.ceil((pw - this.ox + 4) / 2)
    if (this.state === 'rest') this.alt = s.mount / 2
  }

  /** The camera's place along the ground in whole cells' worth of pixels, so the pixels and the cells move together. */
  private viewX(): number {
    // With the split screen open, this side's view sits centered in the right-hand part.
    return 2 * Math.round((this.view - (this.splitTall ? 0 : this.splitW)) / 2)
  }

  /** Where the Ship or Dragon comes down in the sea, along the ground from the mount (pixels): past Falcon's landing zone. */
  private seaX(): number {
    return this.look.catches ? this.lz : 2 * this.lz
  }

  /** The sea: everything left of this column (cells), halfway out from the land (the pad, or Falcon's landing zone) to where it comes down. */
  private shore(): number {
    if (!this.lz || this.boosterOnly) return -1e9
    return Math.floor((this.ox + (this.seaX() + (this.look.catches ? 0 : this.lz)) / 2) / 2)
  }

  /** The landing zone's first column (cells). */
  private lzL(): number {
    return Math.floor((this.ox + this.lz) / 2)
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
    return (this.apx() + this.topRow() + 2 + this.chuteRoom() + Math.round(this.camP) - 2 * this.rows) / 2
  }

  /** The height above the rocket's bottom (pixels) of the top of what's flying: the camera frames that, not the whole stack. */
  private topRow(): number {
    return this.spec.fly.h - this.partRows(this.part)[0]
  }

  /** Room kept above the nose for Dragon's parachutes, eased in as they open (pixels). */
  private chuteRoom(): number {
    return Math.round(this.room)
  }

  private room = 0

  protected override groundFeature(x: number): SceneryCell | undefined {
    this.geo()
    // Clear ground around the launch site (and its landing zone): no trees or houses near the pad.
    if (x >= Math.min(this.padL, this.lzL()) - 3 && x <= this.padR + 3) return undefined
    // Nothing stands on the sea.
    if (x < this.shore()) return undefined
    return super.groundFeature(x)
  }

  protected override scenery(x: number, y: number, sky: number): SceneryCell | undefined {
    if (y === -1) {
      this.geo()
      if (x >= this.padL && x <= this.padR && !this.siteHidden) {
        // Concrete, with the flame trench under the engines.
        const mid = (this.bodyPx + this.spec.bodyW / 2) >> 1
        return x === mid || (this.spec.bodyW > 2 && x === mid - 1) ? TRENCH : PAD
      }
      if (x < this.shore()) return { glyph: SEA.glyph, fg: mix(SEA.fg, 0x10243c, this.dark), bg: mix(SEA.bg!, 0x0a1628, this.dark) }
      if (!this.look.catches && this.lz && x >= this.lzL() && x <= this.lzL() + Math.ceil(this.spec.land.w / 2)) return PAD
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
    const exact = Math.max(0, (this.alt * 2 + this.topRow() + 2 + this.chuteRoom() + Math.round(this.camP) - 2 * h) / 2)
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
    // The camera's place along the ground, in cells: the ground, clouds and stars slide past with it.
    const panC = this.viewX() / 2
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
          const s = this.scenery(x + panC, y, bg)
          if (s) out.set(i, s.glyph, s.fg, s.bg ?? bg)
          else out.set(i, 0x20, DEFAULT_COLOR, bg)
          continue
        }
        // Climbing into orbit the clouds fade into the darkening sky with it;
        // then every cloud color is snapped to a few steps off the sky (see snap).
        if (o < 0.98 && this.foldedCloud(x + drift + panC, yf, a, bg)) {
          const fg = snap(o > 0 ? mix(this.cFg, bg, o) : this.cFg, bg)
          const cb = snap(o > 0 ? mix(this.cBg, bg, o) : this.cBg, bg)
          if (fg !== bg || cb !== bg) {
            out.set(i, GLYPH.top, fg, cb)
            continue
          }
        }
        if (stars > 0) {
          const hs = hash(x + sx + panC, r - sy, 7)
          if (hs < stars) {
            const bright = hash(x + sx + panC, r - sy, 8) < 0.5 ? STAR : STAR_DIM
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
    this.drawSplit(out)
    return out
  }

  /**
   * The split screen: the twin's view in the left-hand part sliding in from
   * the left edge (a tall pane: the bottom part, rising from the bottom
   * edge), and a divider.
   */
  private drawSplit(out: Cells): void {
    const t = this.twinSite
    const n = Math.round(this.splitW)
    if (!t || n <= 0) return
    const src = t.grid()
    const W = this.columns
    const H = this.rows
    // The part of the twin's view shown is centred on its booster, so it's in
    // sight from the panel's first sliver, the view widening round it.
    const [fc, fr] = t.focus()
    if (this.splitTall) {
      const from = Math.max(0, Math.min(this.twinH - n, Math.round(fr - n / 2)))
      for (let r = 0; r < n && r < H; r++)
        for (let x = 0; x < W; x++) {
          const j = (from + r) * this.twinW + x
          out.set((H - n + r) * W + x, src.codePoint(j), src.foreground(j), src.background(j))
        }
      if (n < H) for (let x = 0; x < W; x++) out.set((H - n - 1) * W + x, GLYPH.horiz, 0x8a9099, 0x14161a)
      return
    }
    const from = Math.max(0, Math.min(this.twinW - n, Math.round(fc - n / 2)))
    for (let r = 0; r < H; r++) {
      for (let x = 0; x < n && x < W; x++) {
        const j = r * this.twinW + from + x
        out.set(r * W + x, src.codePoint(j), src.foreground(j), src.background(j))
      }
      if (n < W) out.set(r * W + n, GLYPH.vert, 0x8a9099, 0x14161a)
    }
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
    // Falcon: only the booster comes home, onto its legs. Starship: the
    // booster into the arms (on the split screen's left), the Ship into the sea.
    const catches = this.look.catches
    const shipHome = catches && !this.boosterOnly
    // (The Ship's own bottom at sea level: its sprite's frame sits the booster's height below.)
    const sea = -(s.fly.h - s.stage) / 2
    // (Dragon's capsule, the same: its bottom at sea level.)
    const capSea = -(s.fly.h - (s.capsule ?? 0)) / 2
    const goal = shipHome ? sea : catches ? catchAlt : rest
    // Once it's coming home it lands and is stacked again before it can relaunch.
    const homeward = home || this.returning
    this.stepTwin()
    // Asked to launch meanwhile, the ground crew hurry.
    const hurry = home ? 1 : 3
    const restArm = s.mount + s.grip
    let thrGoal = 0
    let armGoal = restArm
    this.timer++
    this.braking = false
    if (this.fadeIn < 1) this.fadeIn = Math.min(1, this.fadeIn + 0.06)
    // From the trunk's jettison on (high and falling fast), so nothing moves when they open.
    const roomGoal = this.chute || (this.part === 'capsule' && this.state === 'fly') ? (this.tall ? 14 : 4) : 0
    this.room += Math.max(-0.5, Math.min(0.5, roomGoal - this.room))

    switch (this.state) {
      case 'rest':
        this.alt = rest
        this.v = 0
        if (this.part === 'full') this.returning = false
        // An empty transporter drives back off.
        if (Number.isFinite(this.carrierX)) {
          this.carrierX += 2
          if (this.ox + this.carrierX - this.viewX() > this.pw + 4) this.carrierX = Number.NaN
        }
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
        // The service arm swings away for flight.
        this.service = Math.max(0, this.service - 0.1)
        if (this.boosterOnly && !home) {
          // The split screen's booster falls back through the sky, a layer a
          // second (the level walking down): the world unfolds above it as it drops.
          this.v = Math.max(this.v - 0.02, -1)
          this.alt += this.v
          this.layer += Math.max(-0.6, Math.min(0.6, want - this.layer))
          this.unfold()
          // Super Heavy's boostback, seconds after staging, turns it for the
          // tower; Falcon's entry burn, high up, takes the edge off the heating.
          if (catches ? this.flyTime < 136 : this.staged === 4 && this.sinceStage < 14) thrGoal = 0.5
          break
        }
        if (!homeward) {
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
          // High enough, the stack separates: the spent booster falls away,
          // the engines cut a moment, and the upper stage lights.
          if (this.part === 'full' && this.layer >= SEP_LAYER) this.separate()
          // In orbit Dragon parts from the second stage, which drifts away (to burn up later).
          if (s.dragon && this.part === 'upper' && this.orbit > 0.95) {
            this.part = 'dragon'
            this.ghost = { part: 'stage2', d: 0, v: -0.02, acc: -0.008, life: 70, max: 70 }
          }
          break
        }
        this.returning = true
        if (shipHome && this.part === 'upper' && this.burn < 100) {
          // The Ship comes in: belly-first, tiles down, glowing, falling back
          // down through the sky (it flips upright only for the landing burn,
          // below). The camera follows it out over the sea.
          this.burn++
          // About 60 degrees (nose high) through the glowing part; flat for the belly-flop below it.
          const flat = this.burn < 85 ? 0.67 : 1
          this.flop += Math.max(-0.04, Math.min(0.04, flat - this.flop))
          thrGoal = 0
          this.v = Math.max(this.v - 0.03, -1.2)
          this.alt += this.v
          this.layer += Math.max(-1.5, Math.min(1.5, (this.burn < 80 ? LAYER[4]! : LAYER[2]!) - this.layer))
          this.unfold()
          const step = Math.max(0.4, Math.abs(this.lz - this.pos) / 80)
          this.pos += Math.max(-step, Math.min(step, this.lz - this.pos))
          this.view = this.pos
          break
        }
        // Brought home before it staged: it stages now (the booster on the split screen).
        if (this.part === 'full' && !this.boosterOnly) this.separate()
        if (s.dragon && (this.part === 'upper' || this.part === 'dragon' || this.part === 'capsule')) {
          // Dragon comes home: it parts from the second stage (which goes on to
          // burn up), drops its trunk, comes in heat shield first glowing, opens
          // its drogues then its four mains, and comes down in the sea. Its next
          // ride waits at the pad on the tower's arm.
          this.burn++
          thrGoal = 0
          if (this.part === 'upper') {
            this.part = 'dragon'
            this.ghost = { part: 'stage2', d: 0, v: -0.03, acc: -0.012, life: 60, max: 60 }
          }
          if (this.part === 'dragon' && this.burn > 20) {
            this.part = 'capsule'
            this.ghost = { part: 'trunk', d: 0, v: -0.03, acc: -0.015, life: 40, max: 40 }
          }
          // Out over the sea, the camera with it.
          const step = Math.max(0.4, Math.abs(this.seaX() - this.pos) / 60)
          this.pos += Math.max(-step, Math.min(step, this.seaX() - this.pos))
          this.view = this.pos
          // Its offset centre of mass trims it at an angle, heat shield forward, while it's hot.
          this.lean += Math.max(-0.02, Math.min(0.02, (this.burn > 20 && this.burn < 95 ? -0.3 : 0) - this.lean))
          if (this.burn < 95) {
            // Re-entry: falling through the high sky.
            this.v = Math.max(this.v - 0.03, -1.2)
            this.alt += this.v
            this.layer += Math.max(-0.6, Math.min(0.6, LAYER[5]! - this.layer))
            this.unfold()
            break
          }
          const want = this.burn < 115 ? 1 : 2
          if (want !== this.chute) {
            this.chute = want
            this.chuteOpen = 0
          }
          this.chuteOpen = Math.min(1, this.chuteOpen + 0.06)
          this.v += Math.max(-0.05, Math.min(0.05, (this.chute === 1 ? -0.9 : -0.6) - this.v))
          this.alt += this.v
          if (this.layer > LAYER[2]! + 1) {
            this.layer += Math.max(-1.2, Math.min(1.2, LAYER[2]! - this.layer))
            this.unfold()
          } else if (this.alt <= capSea) {
            this.alt = capSea
            this.v = 0
            this.pos = this.view = this.seaX()
            this.splash = 1
            this.go('landed')
          }
          break
        }
        // Falcon's booster flies back across to its landing zone on the way down
        // (Starship's Ship out over the sea), the camera with it: it stays in
        // view and the world slides past.
        if (this.lz) {
          const framesLeft = Math.max(10, (this.alt - goal) / 0.8)
          const step = Math.max(0.4, Math.abs(this.lz - this.pos) / framesLeft)
          this.pos += Math.max(-step, Math.min(step, this.lz - this.pos))
          this.view = this.pos
        }
        const d = goal - this.alt
        const brakeV = Math.sqrt(2 * DEC * Math.abs(d))
        // The Ship, still belly-first, flips upright into its landing burn.
        if (this.flop > 0 && (this.braking || this.v <= -brakeV * 0.9)) this.flop = Math.max(0, this.flop - 0.05)
        if (d > 0) {
          // Below its goal: climb gently back up to it.
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
          this.pos = this.view = this.lz
          this.go(shipHome ? 'landed' : catches ? 'catch' : 'landed')
          if (shipHome) this.splash = 1
        } else this.alt += this.v
        if (catches && !shipHome) armGoal = s.armCatch
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
        break
      case 'lower': {
        armGoal = -1
        const span = Math.max(0.5, catchAlt - rest)
        const frac = (this.alt - rest) / span
        this.alt -= Math.max(0.012, span * (0.004 + 0.022 * Math.sin(Math.PI * Math.min(1, frac)))) * (this.boosterOnly ? 2 : 1)
        if (this.alt <= rest) {
          this.alt = rest
          this.go('release')
        }
        break
      }
      case 'release':
        armGoal = -1
        this.reach = Math.max(0, this.reach - 1 / CLOSE)
        // The split screen's booster just stays on the mount.
        if (this.reach <= 0) this.go('rest')
        break
      case 'landed': {
        // Down on its legs at the landing zone (the split screen's Falcon
        // booster: it stays there), or in the sea.
        this.v = 0
        if (!shipHome && this.part !== 'capsule') {
          this.alt = rest
          break
        }
        // In the sea, its parachutes (Dragon's) settling on the water.
        if (this.chuteOpen > 0) this.chuteOpen = Math.max(0, this.chuteOpen - 0.05)
        else this.chute = 0
        if (this.part === 'capsule') {
          // Dragon: a moment in the spray, then the camera slides back along
          // the coast to the pad, reset for the next flight.
          this.alt = capSea
          if (this.timer * hurry >= 24) {
            this.service = 1
            this.go('pan')
          }
          break
        }
        // The Ship: it tips over onto the water (and goes up in a fireball, as
        // they do), then a recovery barge comes out from the shore, slides in
        // under it and lifts it, righted, onto its deck.
        // (Lying flat, its middle sits this much lower: half its width, not half its length.)
        const lie = (s.stage / 2 - s.bodyW / 4) / 2
        if (this.timer * hurry < 30) {
          this.flop = Math.min(1, this.flop + 0.05 * hurry)
          this.alt = sea - this.flop * lie
          if (this.timer === 16 && hurry === 1) this.boom = 1
          break
        }
        if (!Number.isFinite(this.carrierX)) this.carrierX = this.pos + this.pw / 2 + 2 * s.fly.w
        if (this.carrierX > this.pos) {
          this.alt = sea - this.flop * lie
          const speed = Math.min(2 * hurry, Math.max(0.3, (this.carrierX - this.pos) * 0.05 * hurry))
          this.carrierX = Math.max(this.pos, this.carrierX - speed)
        } else {
          this.flop = Math.max(0, this.flop - 0.04 * hurry)
          this.alt = sea + (1 - this.flop) - this.flop * lie
          if (this.flop <= 0) this.go('carry')
        }
        break
      }
      case 'pan': {
        // Sliding back from the capsule bobbing in the sea to the pad.
        this.alt = capSea
        const speed = Math.min(4 * hurry, Math.max(0.6, Math.abs(this.view) * 0.05 * hurry))
        this.view += Math.max(-speed, Math.min(speed, -this.view))
        if (Math.abs(this.view) < 0.5) this.resetToPad()
        break
      }
      case 'carry': {
        // The Ship carried back to the pad, the camera with it, on a barge then
        // a transporter, to beside the booster waiting on the mount.
        const to = s.bodyL - 3 - s.fly.w
        this.alt = sea + 1
        const speed = Math.min(2.5 * hurry, Math.max(0.3, Math.abs(to - this.pos) * 0.04 * hurry))
        this.pos += Math.max(-speed, Math.min(speed, to - this.pos))
        this.view = this.pos
        this.carrierX = this.pos
        if (Math.abs(to - this.pos) < 0.01) {
          // The arms take it from here: the booster on the mount is what stands now.
          this.shipX = to
          this.pos = 0
          this.alt = rest
          this.part = 'booster'
          this.stackOff = 2 - (this.apx() + (s.fly.h - s.stage))
          this.go('stack')
          this.phase = 1
        }
        break
      }
      case 'stack': {
        // Starship: the Ship rolls in on its transporter; the arms reach over,
        // grip it, lift it, swing it across onto the booster and let go.
        this.alt = rest
        // The camera eases back from where the transporter stopped.
        this.view += Math.max(-0.5, Math.min(0.5, -this.view))
        const park = s.bodyL - 3 - s.fly.w
        const grip = Math.round(s.stage * 0.6)
        const bottom = this.apx() + (s.fly.h - s.stage)
        armGoal = bottom + Math.round(this.stackOff) + grip
        const there = Math.abs(this.armY - armGoal) < 1
        // Once the arms have it, the transporter drives back off the way it came... left.
        if (this.phase >= 2 && Number.isFinite(this.carrierX)) {
          this.carrierX -= 1.5 * hurry
          if (this.ox + this.carrierX + s.fly.w < this.viewX()) this.carrierX = Number.NaN
        }
        switch (this.phase) {
          case 0:
            this.shipX += Math.min(1.5 * hurry, park - this.shipX)
            if (this.shipX >= park) this.phase = 1
            break
          case 1:
            this.armX = this.shipX
            if (there) this.reach = Math.min(1, this.reach + hurry / CLOSE)
            if (this.reach >= 1) this.phase = 2
            break
          case 2:
            this.stackOff = Math.min(3, this.stackOff + 0.25 * hurry)
            if (this.stackOff >= 3 && there) this.phase = 3
            break
          case 3:
            this.shipX += Math.min(0.4 * hurry, -this.shipX)
            this.armX = this.shipX
            if (this.shipX >= 0) this.phase = 4
            break
          case 4:
            this.stackOff = Math.max(0, this.stackOff - 0.2 * hurry)
            if (this.stackOff <= 0) {
              this.part = 'full'
              this.phase = 5
            }
            break
          default:
            this.reach = Math.max(0, this.reach - hurry / CLOSE)
            if (this.reach <= 0) {
              this.armX = 0
              this.returning = false
              this.boosterHome = false
              this.burn = 0
              this.flop = 0
              this.go('rest')
            }
        }
        break
      }
    }

    // The carriage rides with the rocket while it grips; otherwise it eases to its goal.
    if (armGoal < 0) this.armY = this.apx() + s.grip
    else if (this.armY < 0) this.armY = armGoal
    else this.armY += Math.max(-0.6, Math.min(0.6, armGoal - this.armY))

    this.thr += (thrGoal - this.thr) * 0.35
    if (this.thr < 0.02 && thrGoal === 0) this.thr = 0

    const flying = this.state === 'fly'
    // Into orbit from 8, high enough; out of it as soon as it's asked down.
    const orbitGoal = flying && !homeward && lv >= 8 && this.layer > LAYER[8]! - 30 ? 1 : 0
    this.orbit += Math.max(-0.03, Math.min(0.025, orbitGoal - this.orbit))
    if (this.orbit < 0.001) this.orbit = 0
    // The tilt and speed ease toward the level's: 8 tilted, 9 nearly flat, 10 flat out.
    const oi = Math.max(0, Math.min(2, lv - 8))
    const tiltGoal = orbitGoal ? (this.tall ? TILT_TALL : TILT_BAND)[oi]! : 0
    this.tilt += Math.max(-0.055, Math.min(0.025, tiltGoal - this.tilt))
    this.orbitSpeed += ((orbitGoal ? ORBIT_SPEED[oi]! : 0) - this.orbitSpeed) * 0.04
    // A tall pane keeps the rocket mid-screen in flight (the ground back in view for the catch).
    const visible = this.rows - (this.splitTall ? this.splitW : 0)
    // Headroom above the nose, but never so much the rest of it drops out of the bottom.
    const headroom = Math.min(Math.round(HEADROOM * visible * 2), Math.max(0, 2 * visible - (s.fly.h - this.partRows(this.part)[0]) - 6))
    const camGoal = this.tall && flying && (!homeward || this.alt - goal > 25) ? headroom : 0
    this.camP += Math.max(-0.6, Math.min(0.6, camGoal - this.camP))
    // Fold away a tile once the real world below the layer is off the grid.
    if (flying && !homeward) {
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

    // A parted stage slides away along the axis and fades out.
    const g = this.ghost
    if (g) {
      g.v += g.acc
      g.d += g.v
      if (--g.life <= 0) this.ghost = null
    }

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
    this.part = layer >= SEP_LAYER ? 'upper' : 'full'
    this.ghost = null
    this.pos = this.view = 0
    if (lv >= 8) {
      const oi = Math.min(2, lv - 8)
      this.orbit = 1
      this.tilt = (this.tall ? TILT_TALL : TILT_BAND)[oi]!
      this.orbitSpeed = ORBIT_SPEED[oi]!
    }
    if (this.tall) this.camP = Math.round(HEADROOM * this.rows * 2)
  }

  /**
   * The stack separates: the upper stage flies on. Falcon's spent booster
   * falls away; Starship's turns back for the tower, followed on a split
   * screen (when the grid is wide enough for one; else it's simply home).
   */
  private separate(): void {
    this.part = 'upper'
    this.thr = 0
    this.ghost = { part: 'booster', d: 0, v: -0.05, acc: -0.025, life: 48, max: 48 }
    // The booster turns back: once it's fallen out of frame, a split screen
    // follows it down (side by side in the band, top and bottom in a tall
    // pane), when there's room for one; else it's simply home in time.
    const room = this.tall ? Math.floor(this.rows / 2) >= 12 : Math.floor(this.columns / 2) >= 9
    if (room) this.twinDue = true
    else this.boosterHome = true
  }

  /** Dragon's home: everything back on the pad as it was. */
  private resetToPad(): void {
    this.part = 'full'
    this.pos = this.view = 0
    this.alt = this.spec.mount / 2
    this.v = 0
    this.returning = false
    this.boosterHome = false
    this.burn = 0
    this.chute = 0
    this.chuteOpen = 0
    this.room = 0
    this.lean = 0
    this.ghost = null
    this.service = 1
    this.go('rest')
  }

  /** Falling through the folded sky: unfold a tile whenever the real world below would come into view. */
  private unfold(): void {
    const a = this.layer - TILE / 2
    while (this.scroll - 1 - a < TILE + 1) {
      this.alt += TILE
      for (let i = 0; i < PMAX; i++) this.py[i]! += 2 * TILE
    }
  }

  /** Where what's flying is in this site's own grid: the cell at its middle (column, row). */
  private focus(): [col: number, row: number] {
    this.geo()
    const s = this.spec
    const [r0, r1] = this.partRows(this.part)
    const col = (this.bodyPx + this.pos + s.bodyW / 2 - this.viewX()) / 2
    const base = 2 * (this.scroll + this.rows - 2) + 1
    const row = (base - this.apx() - (s.fly.h - (r0 + r1) / 2)) / 2
    return [col, row]
  }

  /** Open the split screen on the booster falling back, high in the sky. */
  private openTwin(): void {
    this.splitTall = this.tall
    const w = this.splitTall ? this.columns : Math.floor(this.columns / 2)
    const h = this.splitTall ? Math.floor(this.rows / 2) : this.rows
    const t = this.twin()
    t.boosterOnly = true
    t.night = this.night
    t.tint = this.tint
    t.strength = 1
    t.ensure(w, h)
    t.geo()
    t.fresh = false
    t.part = 'booster'
    t.returning = true
    t.state = 'fly'
    t.flyTime = 120
    // It falls back down through the sky a layer a second, from where it separated.
    t.staged = 7
    t.sinceStage = 0
    t.layer = LAYER[7]!
    t.alt = t.layer + TILE
    t.v = -0.6
    t.service = 0
    this.twinSite = t
    this.twinW = w
    this.twinH = h
    this.twinDone = 0
  }

  /** Step the split screen's booster, and open or close the panel around it. */
  private stepTwin(): void {
    if (this.twinDue && !this.ghost) {
      this.twinDue = false
      this.openTwin()
    }
    const t = this.twinSite
    if (!t) return
    t.night = this.night
    t.tint = this.tint
    t.strength = 1
    t.step()
    // Down: on the mount in the arms, or on its legs at the landing zone.
    if (t.state === 'rest' || t.state === 'landed') this.twinDone++
    // In over a second; once the booster's been down a moment, out again.
    const open = this.twinDone < 20
    const full = this.splitTall ? this.twinH : this.twinW
    this.splitW += Math.max(-0.6, Math.min(0.6, (open ? full : 0) - this.splitW))
    if (!open && this.splitW <= 0) {
      this.splitW = 0
      this.twinSite = null
      this.boosterHome = true
    }
  }

  private go(state: State): void {
    this.state = state
    this.timer = 0
  }

  /** The booster's look: grid fins out coming home, legs out only for the landing burn and after. */
  private boosterSprite(): Sprite {
    const s = this.spec
    const st = this.state
    if (this.braking || st === 'landed' || st === 'catch' || st === 'lower' || st === 'release') return s.land
    return s.fins
  }

  private get ramp(): Ramp {
    if (this.tint === 'smoke') return RAMPS.smoke
    if (this.tint === 'blue') return RAMPS.blue
    return this.look.ramp
  }

  /**
   * Where the plume leaves what's flying: its bottom (world half-rows), its
   * center (pixels), and how wide it burns (the upper stage's one engine is narrower).
   */
  private nozzle(): [a: number, cx: number, width: number] {
    const s = this.spec
    const bottom = this.partRows(this.part)[1]
    return [this.apx() + (bottom ? s.fly.h - bottom : 0), this.bodyPx + this.pos + s.bodyW / 2 - 0.5, this.part === 'upper' ? 0.6 : 1]
  }

  /** The plume's length this frame, flickering (and sputtering on a failed command). */
  private plumeLen(): number {
    const p = this.part
    // (No plume from the Ship while it's still turning upright.)
    if (this.thr <= 0 || p === 'dragon' || p === 'capsule' || this.flop > 0.3) return 0
    let len = this.spec.plume * this.thr * (0.85 + 0.3 * this.rng.f()) * (this.part === 'upper' ? 0.7 : 1)
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
    const [A, cx] = this.nozzle()
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
    const venting =
      this.state === 'rest' ||
      this.state === 'ignite' ||
      (this.state === 'landed' && this.timer > 30) ||
      (this.state === 'release' && this.alt <= s.mount / 2)
    if (venting) {
      const p = (0.16 + Math.min(60, this.coverageBoost) * 0.01 + (smoky ? 0.25 : 0)) * (this.tall ? 1 : 0.6)
      const sp = s.fly
      // A stage on its own vents only from its own tanks.
      const [from, to] = this.partRows(this.part)
      for (const [col, row, dir] of s.vents) {
        if (row < from || row >= to || r.f() >= p) continue
        this.spawn(
          this.ox + this.pos + col + dir * 0.5,
          this.apx() + (sp.h - 1 - row),
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
    // The Ship's end at sea: a fireball rolling up off the water.
    if (this.boom > 0) {
      if (this.boom < 5)
        for (let k = 0; k < (this.tall ? 10 : 4); k++) {
          const hot = r.f()
          this.spawn(cx + (r.f() - 0.5) * s.stage, 1 + r.f() * 2, (r.f() - 0.5) * 1.2 * scale, 0.2 + r.f() * 0.8, 14 + r.f() * 16, s.puff[0], s.puff[1] * 1.4, hot < 0.3 ? 0xfff2c0 : hot < 0.7 ? 0xff9a2a : 0xd8402a, 1)
        }
      this.boom = this.boom > 30 ? 0 : this.boom + 1
    }
    // The Ship coming in: plasma streaming up off its belly as it falls.
    if (this.look.catches && this.part === 'upper' && this.burn > 6 && this.burn < 84 && this.flop > 0.5) {
      const len = s.stage
      const mid = this.apx() + (s.fly.h - s.stage) + s.stage / 2
      for (let k = 0; k < (this.tall ? 4 : 2); k++) {
        const hot = r.f()
        this.spawn(cx + (r.f() - 0.5) * len * 2, mid - s.bodyW / 2 - 1 - r.f(), (r.f() - 0.5) * 0.4, 0.5 + r.f() * 1.1, 6 + r.f() * 8, 0.5, 1.2, hot < 0.4 ? 0xff5aa0 : hot < 0.75 ? 0xff7a2a : 0xffc46a, 0.85)
      }
    }
    // Dragon coming in: plasma and sparks streaming back off its heat shield.
    if (this.part === 'capsule' && this.burn > 28 && this.burn < 88) {
      const n = this.burn > 40 && this.burn < 75 ? 4 : 2
      for (let k = 0; k < n; k++) {
        const hot = r.f()
        this.spawn(cx + (r.f() - 0.5) * s.bodyW * 1.5, A + r.f() * 3, (r.f() - 0.5) * 0.6, 0.6 + r.f() * 1.2, 8 + r.f() * 10, 0.5, 1.2, hot < 0.35 ? 0xff5aa0 : hot < 0.7 ? 0xff7a2a : 0xffc46a, 0.9)
      }
    }
    // The Ship coming down in the sea: a burst of spray, then a little wash.
    if (this.splash > 0) {
      const n = this.splash < 3 ? (this.tall ? 18 : 8) : this.splash < 40 && r.f() < 0.3 ? 1 : 0
      for (let k = 0; k < n; k++) {
        const side = r.f() < 0.5 ? -1 : 1
        this.spawn(cx + side * (s.bodyW / 2 + r.f() * 2), 0, side * (0.2 + r.f() * 0.6) * scale, 0.3 + r.f() * (this.tall ? 0.9 : 0.4), 10 + r.f() * 14, 0.6, s.puff[1] * 0.6, 0xeef6ff, 0.9)
      }
      this.splash = this.state === 'landed' ? this.splash + 1 : 0
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
    // World pixels (whole ones: a fraction would index nothing), seen from where the camera is along the ground.
    x = Math.floor(x) - this.viewX()
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

  /** Falcon's booster on the split screen is off at its landing zone: no launch site to see. */
  private get siteHidden(): boolean {
    return this.boosterOnly && !this.look.catches
  }

  protected drawVehicle(out: Cells, _top: number): void {
    this.geo()
    this.base = 2 * (this.scroll + this.rows - 2) + 1
    if (!this.siteHidden) {
      this.drawTower()
      this.drawMount()
    }
    this.drawEarth(out)
    this.drawParticles()
    if (this.orbit > 0.02) this.drawTiltedPlume()
    else this.drawPlume()
    this.drawRocket()
    if (this.look.catches) this.drawArms()
    if (!this.siteHidden) this.drawLights()
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
    const [A, cx, wk] = this.nozzle()
    // Thin air lets the plume balloon out.
    const spread = 0.08 + Math.min(0.45, this.alt / 180)
    const t = this.t
    for (let d = 0; d < len; d++) {
      const y = A - 1 - d
      const half = (s.bodyW / 2) * wk + d * spread
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
  private pose(sp: Sprite, posX = this.pos, turned = true): [cx: number, cy: number, tilt: number, scale: number] {
    const o = this.orbit
    const cx = this.ox + posX + sp.w / 2
    const cy = this.base - this.apx() - sp.h + 1 + sp.h / 2
    if (o <= 0 && turned && (this.flop > 0 || this.lean !== 0)) {
      // Belly-first, tiles down, nose toward the sea (or Dragon leaning into
      // its entry): turned about the middle of what's flying.
      const th = -(Math.PI / 2) * this.flop + this.lean
      const [r0, r1] = this.partRows(this.part)
      const off = sp.h / 2 - (r0 + r1) / 2
      const sn = Math.sin(th)
      const cs = Math.cos(th)
      return [cx - 2 * off * sn, cy - off + off * cs, th, 1]
    }
    if (o <= 0) return [cx, cy, 0, 1]
    const k = o * o * (3 - 2 * o)
    // In orbit it sits mid-grid, tilted toward its travel; in the spine the
    // camera pulls back so the whole tilted stack fits the narrow pane.
    const ocx = this.pw / 2 + (this.tall ? 0 : -2)
    const ocy = (this.ph - (this.splitTall ? 2 * this.splitW : 0)) * (this.tall ? 0.42 : 0.36)
    // Shrunk just enough for the tilted stack to fit the pane's width (its right-hand part, split).
    const room = this.pw - (this.splitTall ? 0 : 2 * this.splitW)
    const sc = this.tall ? 1 - k * (1 - Math.min(0.85, (room - 7) / (2 * sp.h * Math.max(0.3, Math.sin(this.tilt))))) : 1
    // Centered on what's flying (after separation, the upper stage), not on the whole stack:
    // the stage's middle is `off` sprite rows from the sprite's, along its axis.
    const [r0, r1] = this.partRows(this.part)
    const off = sp.h / 2 - (r0 + r1) / 2
    const sn = Math.sin(this.tilt)
    const cs = Math.cos(this.tilt)
    return [
      cx + (ocx - 2 * off * sn * sc - cx) * k,
      cy + (ocy + off * cs * sc - cy) * k,
      this.tilt,
      sc,
    ]
  }

  /** The sprite rows a part covers: the upper stage above `stage`, the booster from it down. */
  private partRows(part: Part): [number, number] {
    const s = this.spec
    const dr = s.dragon ?? 0
    const cap = s.capsule ?? 0
    switch (part) {
      case 'upper':
        return [0, s.stage]
      case 'booster':
        return [s.stage, s.fly.h]
      case 'dragon':
        return [0, dr]
      case 'capsule':
        return [0, cap]
      case 'trunk':
        return [cap, dr]
      case 'stage2':
        return [dr, s.stage]
      default:
        return [0, s.fly.h]
    }
  }

  /** The rocket as it flies now, a stage parting from it, and an upper stage being stacked back on. */
  private drawRocket(): void {
    const s = this.spec
    const sp = this.part === 'booster' ? this.boosterSprite() : s.fly
    this.drawBody(sp, this.part, 0, this.part === 'booster' ? this.fadeIn : 1)
    const g = this.ghost
    if (g) this.drawBody(s.fly, g.part, g.d, g.life / g.max)
    const catches = this.look.catches
    if (this.state === 'pan') {
      // The next stack, already standing on the pad as the camera slides back to it.
      this.drawBody(s.fly, 'full', s.mount - this.apx(), 1, 0, true)
    } else if (catches && this.part === 'upper' && this.boosterHome && this.orbit < 0.01) {
      // Starship's booster, back on the mount, waiting for the Ship.
      this.drawBody(s.fly, 'booster', s.mount - this.apx(), 1, 0, true)
    } else if (catches && this.part === 'booster' && this.state === 'stack') {
      // The Ship, on its transporter and then in the arms.
      this.drawBody(s.fly, 'upper', this.stackOff, 1, this.shipX, true)
    }
    this.drawCarrier()
    this.drawChutes()
  }

  /**
   * Dragon's parachutes over the capsule, on risers from its nose: two small
   * drogues, then four striped mains, opening out (and collapsing on the water).
   */
  private drawChutes(): void {
    if (!this.chute || this.chuteOpen <= 0) return
    const s = this.spec
    const k = this.chuteOpen
    const top = this.apx() + s.fly.h - 1
    const cx = this.ox + this.pos + s.bodyL + s.bodyW / 2 - 0.5
    const mains = this.chute === 2
    const tall = this.tall
    const rise = Math.round((mains ? (tall ? 9 : 3) : tall ? 5 : 2) * (0.5 + 0.5 * k))
    const spread = mains ? (tall ? [-6, -2, 2, 6] : [-1.5, 1.5]) : tall ? [-2, 2] : [0]
    const half = Math.max(1, Math.round((mains ? (tall ? 2 : 1.5) : 1) * k))
    const riser = 0xc2c7cf
    for (const off of spread) {
      const x = Math.round(cx + off * k)
      const y = top + rise
      // The risers, from the nose up to the canopy's edge.
      if (tall)
        for (let i = 1; i < rise; i++) {
          const f = i / rise
          this.paint(Math.round(cx + (x - cx) * f), top + i, riser, 0.7)
        }
      // The canopy: a dome, its gores in white and orange.
      for (let dx = -half; dx <= half; dx++) {
        const c = mains && (x + dx) % 2 ? 0xe8642a : 0xf2f3f5
        this.paint(x + dx, y, c, 1)
        if (Math.abs(dx) < half || half === 1) this.paint(x + dx, y + 1, c, 1)
      }
    }
  }

  /**
   * The Ship's ride home, two pixels tall under it: on the sea a barge (dark
   * hull, deck, a wheelhouse at its stern), on land a transporter (a flatbed
   * on wheels).
   */
  private drawCarrier(): void {
    const cx = this.carrierX
    if (!Number.isFinite(cx)) return
    const s = this.spec
    const x0 = Math.round(this.ox + cx + s.bodyL - 3)
    const x1 = x0 + s.bodyW + 5
    const sea = Math.floor((x0 + x1) / 4) < this.shore()
    for (let x = x0; x <= x1; x++) {
      this.paint(x, 1, sea ? 0x6a6f78 : 0x7a7f88, 1)
      if (sea) this.paint(x, 0, 0x2c3036, 1)
      else if (((x - x0) & 1) === 0) this.paint(x, 0, 0x1a1c20, 1)
    }
    if (sea) {
      this.paint(x1, 2, 0x8a9099, 1)
      this.paint(x1, 3, 0x8a9099, 1)
      this.paint(x1 - 1, 2, 0x8a9099, 1)
    }
  }

  /** One part of the stack, posed with the rocket, `d` sprite rows further along its axis, faded to `alpha`. */
  /** `upright`: something standing still on the ground (not turned with what's flying). */
  private drawBody(sp: Sprite, part: Part, d: number, alpha: number, posX = this.pos, upright = false): void {
    if (alpha <= 0.03) return
    const s = this.spec
    const [r0, r1] = this.partRows(part)
    const frost = this.look.mechazilla && (this.state === 'rest' || this.state === 'ignite')
    const [cx0, cy0, th, sc] = this.pose(sp, posX, !upright)
    const cs = Math.cos(th)
    const sn = Math.sin(th)
    const cx = cx0 + 2 * d * sn * sc
    const cy = cy0 - d * cs * sc
    // Every grid pixel the rotated sprite might cover, sampled back into the
    // sprite (a pixel is twice as tall as it is wide).
    const rx = Math.ceil((Math.abs(cs) * sp.w / 2 + Math.abs(sn) * sp.h) * sc) + 1
    const ry = Math.ceil((Math.abs(sn) * sp.w / 4 + Math.abs(cs) * sp.h / 2) * sc) + 1
    const inv = 1 / sc
    // The engines glow while they burn, at the bottom of whatever is flying.
    const burning = d === 0 && part === this.part && this.thr > 0
    // Dragon's capsule coming in: its heat shield glowing, then cooling under the parachutes.
    const heat = (part === 'capsule' || part === 'dragon') && this.burn > 20 && this.burn < 95 ? Math.sin((Math.PI * (this.burn - 20)) / 75) : 0
    // Falcon's booster just before its entry burn: the engine end warming.
    const baseHeat = part === 'booster' && this.boosterOnly && !this.look.catches && this.state === 'fly' && this.staged === 5 ? 0.5 : 0
    // The Ship coming in belly-first: its tiles glowing, the steel above them less.
    const shipHeat = part === 'upper' && this.look.catches && this.burn > 0 && this.burn < 90 ? Math.sin((Math.PI * this.burn) / 90) : 0
    const tilesTo = s.bodyL + Math.floor(s.bodyW / 2)
    for (let py = Math.floor(cy - ry); py <= Math.ceil(cy + ry); py++) {
      if (py < 0 || py >= this.ph) continue
      const uy = (py + 0.5 - cy) * 2
      for (let px = Math.floor(cx - rx); px <= Math.ceil(cx + rx); px++) {
        const ux = px + 0.5 - cx
        const col = Math.floor((ux * cs + uy * sn) * inv + sp.w / 2)
        const row = Math.floor(((-ux * sn + uy * cs) * inv) / 2 + sp.h / 2)
        if (col < 0 || col >= sp.w || row < r0 || row >= r1) continue
        let c = sp.c[row * sp.w + col]!
        if (c < 0) continue
        // Burning up coming down: glowing hotter from the bottom, its leading end.
        if (heat > 0) c = mix(c, 0xff7a2a, Math.min(0.9, heat * (0.4 + (0.6 * (row - r0)) / Math.max(1, r1 - r0))))
        if (shipHeat > 0) c = mix(c, col < tilesTo ? 0xff6a2a : 0xffb070, shipHeat * (col < tilesTo ? 0.85 : 0.35))
        if (baseHeat > 0 && row >= r1 - 3) c = mix(c, 0xd8402a, baseHeat * (1 - (r1 - 1 - row) / 3))
        // Blue-white near a full context.
        if (burning && row === r1 - 1 && col >= s.bodyL && col < s.bodyL + s.bodyW)
          c = mix(c, this.tint === 'blue' ? 0x8cc0ff : 0xffc46a, Math.min(0.95, this.thr * 1.4))
        // Super Heavy frosts over where the cold propellant sits.
        if (frost && row > sp.h * 0.6 && row < sp.h - 2 && hash(col, row, 61) < 0.55) c = mix(c, 0xf4f8fc, 0.6)
        this.paintP(px, py, c, alpha)
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
    // The tail (the bottom of what's flying), in units (a pixel is 1 wide, 2 tall), and the axis pointing aft.
    const aft = 2 * this.partRows(this.part)[1] - sp.h
    const tx = cx - aft * sn * sc
    const ty = cy * 2 + aft * cs * sc
    const L = len * 2 * sc
    const wk = this.nozzle()[2]
    for (let d = 0.5; d < L; d += 1) {
      const k = d / L
      const half = (s.bodyW / 2) * wk * sc + d * 0.12
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
    const tip = this.bodyPx + this.armX - 1 - (this.look.mechazilla && this.tall ? 2 : 0)
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
    catches: false,
  }

  protected twin(): LaunchSite {
    return new Falcon(this.t)
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
    catches: true,
  }

  protected twin(): LaunchSite {
    return new Starship(this.t + 1)
  }
}

export const falconScene = defineScene({
  name: 'falcon',
  aliases: ['rocket'],
  blurb: 'a Falcon 9 carrying Dragon: its booster lands on its legs, Dragon comes home under parachutes to a splashdown',
  night: true,
  make: seed => new Falcon(seed),
})

export const starshipScene = defineScene({
  name: 'starship',
  aliases: ['spaceship'],
  blurb: "a bigger rocket that hot-stages: its booster is caught by the tower's arms, the Ship splashes down",
  night: true,
  make: seed => new Starship(seed),
})
