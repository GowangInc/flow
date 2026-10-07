// REVISION: flow-v1-train
//
// Train (the `train` scene): a passenger train through the countryside on
// the same dials as the fire; the level is its speed. At 1 it waits at a red
// signal (or alongside a station's platform), its diesel idling. When the
// work starts the signal clears, the horn sounds and it pulls away, and the
// harder the work the faster it runs: fields, villages, woods, rivers and
// stations stream past at their depths' paces, the telegraph poles flick by,
// and the wheels' clickety-clack over the rail joints quickens. When the work
// winds down it slows, and pulls up at the next red signal or platform.
//
// Subagents run alongside on the next track, a short train each, drawing up
// from behind and falling back when they're done. A failed command (or a
// compaction) sends black smoke pouring from the diesel's exhaust under a
// grey sky; a nearly-full context brings a storm, rain driving past, the
// lights on. By night the carriages' windows glow, the headlight lights the
// line ahead, and the villages, stations and level crossings are lit.
//
// The band is the train side-on from beside the line, the camera keeping
// pace with it: everything else slides past at its depth's pace (hills
// barely, the poles in front fastest). The tall spine looks straight down on
// it: the track up the pane, the countryside streaming down past it.
// Painted as pixels (2 × 2 a cell) by PixelScene, which eases the level and
// the night, folds the pixels into glyphs and blanks it all at level 0.

import { PixelScene, type Dials, type Painter } from './pixel-scene'
import { defineScene } from './scene-def'
import { clamp, grey, hash, hash1, mix, noise1 } from './pixels'
import { MOON, moonCover, moonPixel, moonRadius, NIGHT_HORIZON, NIGHT_ZENITH, STAR, STAR_DIM } from './night'
import { hear, leadFrames, PLAYER_LEAD_MS, type Ambience, type SoundEvent } from './sound'

// ── Motion ───────────────────────────────────────────────────────────────

/**
 * Speed at each level, in band pixels per 70 ms frame. A band pixel is about
 * 0.77 m (a carriage is 30 of them), so 4.9 is about 190 km/h.
 */
const SPEED = [0, 0.3, 0.55, 0.85, 1.2, 1.6, 2.05, 2.6, 3.25, 4, 4.9]
/** At or below this level it's idle: it pulls up at the next signal or platform and waits there. */
const IDLE = 1.25
/** Speeding up, slowing down, and the braking curve into a stop (pixels a frame, a frame). */
const ACC = 0.022
const DEC = 0.035
const BRAKE = 0.015
/** Rolling up to a stop, it holds between these speeds until it brakes. */
const APPROACH_MIN = 0.6
const APPROACH_MAX = 1.5
/** Frames from the signal clearing to pulling away (the horn sounds then). */
const DEPART = 9

// ── The train, side-on (band pixels) and from above (rows) ─────────────────

/** The locomotive, each carriage, and the gap between them (all even, so windows sit on whole cells). */
const LOCO = 34
const CAR = 30
const GAP = 2
const CARS = 5
const TRAIN = LOCO + CARS * (GAP + CAR)
/** A companion: a driving car and a trailer. */
const UNIT = CAR + GAP + CAR
/** From above, in rows: the loco, a carriage, the gap. */
const A_LOCO = 12
const A_CAR = 10
const A_GAP = 1
const A_UNIT = A_CAR * 2 + A_GAP
/** The soundscape listens from the end of this carriage: each rail joint under it clacks (the bogies either side). */
const LISTEN = 2

// ── The line ─────────────────────────────────────────────────────────────

/** Rail joints (18 m rails): each bogie clacks over them. */
const JOINT = 24
/** The countryside comes in stretches this long, each fields, a village, woods, a river or a station. */
const ZONE = 900
const FIELDS = 0
const VILLAGE = 1
const WOODS = 2
const RIVER = 3
const STATION = 4
/** Where things sit within a stretch: a level crossing's road, a station's platform and canopy, a river and its bridge. */
const CROSS = 450
const ROAD = 5
const PLAT0 = 250
const PLAT1 = 650
const CANOPY0 = 360
const CANOPY1 = 540
const BRIDGE0 = 410
const BRIDGE1 = 520
const WATER0 = 430
const WATER1 = 500
/** Block signals, every so far along the line. */
const SIGNAL = 450
const SIGNAL0 = 210
/** The horn sounds this far before a level crossing. */
const HORN_AHEAD = 150

/** Depth, as how fast a layer slides past (the track 1). */
const F_CLOUD = 0.03
const F_HILLFAR = 0.05
const F_HILL = 0.1
const F_MID = 0.4
const F_FIELD = 0.7
const F_STATION = 0.6
const F_FARPLAT = 0.86
const F_FAR = 0.92
const F_TRUSS = 1.05
const F_POLE = 1.3
/** Telegraph poles, every so far in their layer. */
const POLE = 70

function rawZone(z: number): number {
  const h = hash1(z * 7919 + 1301)
  return h < 0.4 ? FIELDS : h < 0.58 ? VILLAGE : h < 0.76 ? WOODS : h < 0.88 ? RIVER : STATION
}

/** What a stretch of the line is (a river or a station never follows another). */
function zoneOf(z: number): number {
  const k = rawZone(z)
  if (k !== RIVER && k !== STATION) return k
  const before = rawZone(z - 1)
  return before === RIVER || before === STATION ? FIELDS : k
}

/** Whether a stretch has a level crossing. */
const crosses = (zone: number) => zone === FIELDS || zone === VILLAGE

/** The level's speed, read between whole levels. */
function speedFor(level: number): number {
  const l = clamp(level, 0, 10)
  const i = Math.min(9, Math.floor(l))
  return SPEED[i]! + (SPEED[i + 1]! - SPEED[i]!) * (l - i)
}

/** The level whose speed this is (0 standing). */
function levelFor(v: number): number {
  if (v <= 0) return 0
  for (let i = 0; i < 10; i++) if (v < SPEED[i + 1]!) return i + (v - SPEED[i]!) / (SPEED[i + 1]! - SPEED[i]!)
  return 10
}

// ── Colours ──────────────────────────────────────────────────────────────

type Pal = {
  skyTop: number
  skyHz: number
  cloud: number
  cloudShade: number
  hillFar: number
  hill: number
  grass: number
  grass2: number
  wheat: number
  wheat2: number
  plough: number
  plough2: number
  rape: number
  sheep: number
  hedge: number
  tree: number
  treeLit: number
  treeShade: number
  floor: number
  wall: number
  roof: number
  roofDark: number
  slate: number
  houseWin: number
  water: number
  waterHi: number
  reed: number
  ballast: number
  ballast2: number
  ballastFar: number
  verge: number
  sleeper: number
  rail: number
  railFar: number
  shadow: number
  road: number
  platform: number
  platformFace: number
  platformEdge: number
  canopy: number
  valance: number
  brick: number
  steel: number
  pole: number
  post: number
  cream: number
  crimson: number
  loco: number
  locoVent: number
  yellow: number
  carRoof: number
  vent: number
  grille: number
  glass: number
  sideGlass: number
  bogie: number
  lamp: number
  beam: number
  spill: number
  soot: number
  haze: number
  bird: number
  rain: number
}

const DAY: Pal = {
  skyTop: 0x3f88d6,
  skyHz: 0xb6dff5,
  cloud: 0xf6f9fc,
  cloudShade: 0xd0dfec,
  hillFar: 0x93b8c8,
  hill: 0x6f9f94,
  grass: 0x6fae4c,
  grass2: 0x86bd58,
  wheat: 0xd8be5e,
  wheat2: 0xc4a84c,
  plough: 0x8c6a4a,
  plough2: 0x76583c,
  rape: 0xdcc94e,
  sheep: 0xf2f0e6,
  hedge: 0x3b7432,
  tree: 0x2f6e36,
  treeLit: 0x4b8d42,
  treeShade: 0x1f4a26,
  floor: 0x2a4a26,
  wall: 0xe4d8c2,
  roof: 0xb04e3c,
  roofDark: 0x7e3428,
  slate: 0x5d636c,
  houseWin: 0x3a4552,
  water: 0x4f93c8,
  waterHi: 0xa6d6f0,
  reed: 0x6a7a3a,
  ballast: 0x8b8073,
  ballast2: 0x9a8f80,
  ballastFar: 0x9b9184,
  verge: 0x79a052,
  sleeper: 0x5c4838,
  rail: 0xc6cad0,
  railFar: 0xb0b4ba,
  shadow: 0x2e2a26,
  road: 0x606368,
  platform: 0xbcb7ad,
  platformFace: 0x8c877e,
  platformEdge: 0xe8c640,
  canopy: 0x4e535a,
  valance: 0xd9d2c2,
  brick: 0x9c5638,
  steel: 0x434a54,
  pole: 0x5a4636,
  post: 0x34363c,
  cream: 0xebdfba,
  crimson: 0xa8322d,
  loco: 0x1f4f8f,
  locoVent: 0x163a6a,
  yellow: 0xf2c230,
  carRoof: 0x8e9399,
  vent: 0x6e737a,
  grille: 0x3c3c40,
  glass: 0x29323c,
  sideGlass: 0xb9ae90,
  bogie: 0x1e1f22,
  lamp: 0xfff4d0,
  beam: 0xfff0b8,
  spill: 0xffd27a,
  soot: 0x1b1b1d,
  haze: 0x9aa0a8,
  bird: 0x2c3440,
  rain: 0xc4d4ea,
}

/**
 * By night (the sky and the moon are night.ts's, shared by every scene): the
 * land nearly black under it, windows lit, lamps glowing. The rails catch
 * the moonlight, so the line still reads.
 */
const NIGHT: Pal = {
  skyTop: NIGHT_ZENITH,
  skyHz: NIGHT_HORIZON,
  cloud: 0x2a3348,
  cloudShade: 0x1a2132,
  hillFar: 0x131c2e,
  hill: 0x0d1522,
  grass: 0x0f1a13,
  grass2: 0x121e15,
  wheat: 0x1d1c13,
  wheat2: 0x181710,
  plough: 0x15110d,
  plough2: 0x110e0b,
  rape: 0x1f1e11,
  sheep: 0x3a3a36,
  hedge: 0x070d09,
  tree: 0x08100b,
  treeLit: 0x0e1912,
  treeShade: 0x030604,
  floor: 0x060b07,
  wall: 0x24252b,
  roof: 0x241517,
  roofDark: 0x180e10,
  slate: 0x15171d,
  houseWin: 0xffc35a,
  water: 0x0b1828,
  waterHi: 0x4a6a8e,
  reed: 0x0d130a,
  ballast: 0x1c1b1a,
  ballast2: 0x222120,
  ballastFar: 0x191817,
  verge: 0x0e170f,
  sleeper: 0x0f0c0a,
  rail: 0x68717e,
  railFar: 0x4c535e,
  shadow: 0x070707,
  road: 0x18191c,
  platform: 0x3a3934,
  platformFace: 0x22211e,
  platformEdge: 0x7a6a2a,
  canopy: 0x121418,
  valance: 0x4a4740,
  brick: 0x28160e,
  steel: 0x171a1f,
  pole: 0x110e0b,
  post: 0x131417,
  cream: 0x4a4536,
  crimson: 0x3c1512,
  loco: 0x0c1a2e,
  locoVent: 0x08121f,
  yellow: 0x6a5620,
  carRoof: 0x2a2d33,
  vent: 0x1e2025,
  grille: 0x111214,
  glass: 0xffd47e,
  sideGlass: 0xffd47e,
  bogie: 0x09090a,
  lamp: 0xffffff,
  beam: 0xfff0c0,
  spill: 0xffc860,
  soot: 0x5c5d63,
  haze: 0x30333a,
  bird: 0x10141c,
  rain: 0x6a7c9c,
}

/** A smoky sky (a failed command, a compaction): overcast by day, a murky glow by night (top, horizon, cloud, its shade). */
const OVERCAST = { day: [0x6e7680, 0xadb2b8, 0xc4c8cc, 0x8e949a], night: [0x1c1d21, 0x34363b, 0x3a3c42, 0x26282c] } as const
/** A storm (the context nearly full): a bruised blue sky, the land washed cold. */
const STORM = { day: [0x1b2540, 0x4f6284, 0x6a7a96, 0x4a5874], night: [0x05080f, 0x141c30, 0x1e2840, 0x121a2c] } as const
const STORM_CAST = { day: 0x23345a, night: 0x0a1226 }

/** Each companion's livery (the sides, and the ends from above). */
const LIVERY = [0x2a6fd6, 0x2f9a4a, 0xe0781e, 0x8a4bc2] as const
/** What the liveries lean toward by night. */
const NIGHT_SHADE = 0x0a1428
/** Signal and crossing lights. */
const RED = 0xff2a1a
const GREEN = 0x2aff6a
const RED_OFF = 0x3a1010

/** The countryside's colours (a storm or smoke washes them); the train's own wash less. */
const LAND: (keyof Pal)[] = [
  'hillFar', 'hill', 'grass', 'grass2', 'wheat', 'wheat2', 'plough', 'plough2', 'rape', 'sheep', 'hedge', 'tree', 'treeLit',
  'treeShade', 'floor', 'wall', 'roof', 'roofDark', 'slate', 'water', 'waterHi', 'reed', 'ballast', 'ballast2', 'ballastFar', 'verge',
  'sleeper', 'rail', 'railFar', 'shadow', 'road', 'platform', 'platformFace', 'platformEdge', 'canopy', 'valance', 'brick',
  'steel', 'pole', 'post',
]
const BODY: (keyof Pal)[] = ['cream', 'crimson', 'loco', 'locoVent', 'yellow', 'carRoof', 'vent', 'grille', 'bogie']

/** `k` held to steps of 1/n, so a frame holds few distinct colours (Raster paints 1024 pairs). */
const q = (k: number, n: number) => Math.round(clamp(k) * n) / n

type Comp = { off: number; livery: number; leaving: boolean; ph: number }
/** A puff of exhaust: black smoke (a failure), or the faint haze of the diesel idling (`wisp`). */
type Puff = { s: number; up: number; side: number; r: number; life: number; vu: number; vs: number; wisp: boolean }
/** Birds crossing the sky (by day, in the band): a few, flapping out of step. */
type Flock = { x: number; y: number; vx: number; n: number; ph: number }
type Motor = { x: number; dir: number; v: number; color: number }

/** Cars on the roads (from above). */
const CAR_COLORS = [0xd8433a, 0x2f6fd0, 0xf0f0ea, 0x3a3d44, 0xe0b030, 0x4a9a5a]

export class Train extends PixelScene {
  sounds: SoundEvent[] = []
  /** The nose's distance along the line, in band pixels. */
  private pos = 0
  /** Speed, band pixels a frame (per 70 ms: scaled by the frame's real length). */
  private v = 0
  private started = false
  /** Where the nose stops (idle), and the signal it waits at there (none at a platform). */
  private stopAt: number | undefined
  private held: number | undefined
  /** Signals put up to stop at, between the regular ones. */
  private extras: number[] = []
  /** The signal it last stood at (none at a platform): where it waits again if the work stops before it's away. */
  private stoodAt: number | undefined
  /** Frames since the signal cleared, standing. */
  private depart = DEPART
  /** The last stretch whose crossing it sounded the horn for. */
  private horned = -1
  private kSmoke = 0
  private kStorm = 0
  private comps: Comp[] = []
  private nextLivery = 0
  private puffs: Puff[] = []
  private flock: Flock | undefined
  private nextFlock = 200
  private roads = new Map<number, Motor[]>()
  private rng: number

  // Layout, from the grid.
  private W = 0
  private H = 0
  private tall = false
  /** Band: the column just ahead of the nose (even). Spine: the track's column and the nose's row. */
  private noseX = 0
  private tx = 0
  private noseY = 0
  /** Per-frame buffers: trees from above, each row's place on the line, and the pixels a train covers. */
  private canopy = new Uint8Array(0)
  private rowV = new Int32Array(0)
  private solid = new Uint8Array(0)

  constructor(seed = 1) {
    super(seed)
    this.rng = Math.imul(seed, 2654435761) >>> 0 || 1
  }

  /** The train's speed now (band pixels a frame). */
  get speed(): number {
    return this.v
  }

  /** Whether it's standing at a signal or platform. */
  get standing(): boolean {
    return this.v === 0
  }

  /** How many companions (subagents' trains) are in view, any part of them. */
  get company(): number {
    return this.comps.filter(c => {
      if (this.tall) {
        const top = this.noseY - Math.round(c.off / 3)
        return top < this.H && top + A_UNIT > 0
      }
      const front = this.noseX - 1 + Math.round(c.off)
      return front >= 0 && front - UNIT < this.W
    }).length
  }

  ambience(): Ambience {
    // Its speed, as the level that runs at it: the wheels' roar and the wind (0 standing, the engine idling).
    return { wind: levelFor(this.v) / 10 }
  }

  private rand(): number {
    let x = this.rng
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.rng = x >>> 0
    return this.rng / 4294967296
  }

  private layout(d: Dials): void {
    this.W = d.columns * 2
    this.H = d.rows * 2
    this.tall = d.tall
    // The nose sits most of the way across the band, with enough line ahead to see a signal coming.
    this.noseX = Math.max(2, this.W - Math.max(26, Math.round(this.W * 0.17))) & ~1
    this.tx = clamp(Math.round(this.W * 0.36), 7, Math.max(7, this.W - 14))
    this.noseY = Math.max(4, Math.round(this.H * 0.22))
  }

  protected resize(d: Dials): void {
    this.layout(d)
    this.canopy = new Uint8Array(this.W * this.H)
    this.solid = new Uint8Array(this.W * this.H)
    this.rowV = new Int32Array(this.H)
    this.roads.clear()
  }

  /** How much line is in view ahead of the nose, in band pixels. */
  private ahead(): number {
    return this.tall ? this.noseY * 3 : this.W - this.noseX
  }

  /** How far behind the nose a companion must be to be out of sight. */
  private farBehind(): number {
    return -(this.tall ? (this.H - this.noseY) * 3 + 6 : this.noseX + 6)
  }

  /**
   * Where to pull up: alongside a platform close ahead, else at the next
   * signal, else at a signal put up just out of sight. Never with the train
   * standing on a level crossing or a bridge, nor part way along a platform.
   */
  private chooseStop(): void {
    const dmin = (this.v * this.v) / (2 * BRAKE) + 4
    const reach = Math.max(dmin, this.ahead() + 12)
    const platform = this.platformEnd(this.pos + dmin, this.pos + reach + 260)
    if (platform !== undefined) {
      this.stopAt = platform
      this.held = undefined
      return
    }
    const k = Math.ceil((this.pos + dmin + 3 - SIGNAL0) / SIGNAL)
    const sg = k * SIGNAL + SIGNAL0
    if (sg - 3 - this.pos <= reach + 120 && this.clear(sg - 3) === sg - 3) {
      this.stopAt = sg - 3
      this.held = sg
      return
    }
    const at = this.clear(Math.round(this.pos + reach)) + 3
    const inStation = this.platformEnd(at - 3, at - 3 + PLAT1 - PLAT0)
    if (inStation !== undefined && inStation - (at - 3) < PLAT1 - PLAT0 && this.inPlatform(at - 3)) {
      this.stopAt = inStation
      this.held = undefined
      return
    }
    this.extras.push(at)
    this.stopAt = at - 3
    this.held = at
  }

  /** The stopping place at the far end of a station's platform between a and b, if there is one. */
  private platformEnd(a: number, b: number): number | undefined {
    for (let z = Math.floor(a / ZONE); z <= Math.floor(b / ZONE) + 1; z++) {
      if (zoneOf(z) !== STATION) continue
      const at = z * ZONE + PLAT1 - 24
      if (at >= a && at <= b) return at
    }
    return undefined
  }

  /** Whether the nose at s is alongside a platform. */
  private inPlatform(s: number): boolean {
    const z = Math.floor(s / ZONE)
    const local = s - z * ZONE
    return zoneOf(z) === STATION && local > PLAT0 && local < PLAT1
  }

  /** The first place at or past s where the whole train can stand clear of level crossings and bridges. */
  private clear(s: number): number {
    for (let n = 0; n < 6; n++) {
      let moved = false
      for (let z = Math.floor((s - TRAIN - 40) / ZONE); z <= Math.floor((s + 40) / ZONE); z++) {
        const zone = zoneOf(z)
        const base = z * ZONE
        const [a, b] = crosses(zone) ? [base + CROSS - ROAD - 12, base + CROSS + ROAD + 12] : zone === RIVER ? [base + BRIDGE0 - 12, base + BRIDGE1 + 12] : [0, -1]
        if (b < a) continue
        // Standing nose at s, tail at s - TRAIN: move on past it.
        if (s - TRAIN < b && s > a) {
          s = b + TRAIN
          moved = true
        }
      }
      if (!moved) break
    }
    return s
  }

  protected update(d: Dials): void {
    this.layout(d)
    if (this.W === 0 || this.H === 0) return
    const want = clamp(this.strength, 0, 10)
    // Speeds are per 70 ms: a calm frame is longer, so the train keeps its real pace.
    const dt = PLAYER_LEAD_MS / leadFrames(this.strength, this.tint) / 70
    const idle = want <= IDLE
    if (!this.started) {
      this.started = true
      if (idle) {
        // Starting idle: already waiting at a signal (somewhere clear to stand).
        this.pos = this.clear(this.pos)
        this.extras.push(this.pos + 3)
        this.stopAt = this.pos
        this.held = this.pos + 3
      } else this.v = speedFor(want)
    }
    const was = this.pos
    let vT: number
    if (!idle) {
      if (this.stopAt !== undefined && this.v === 0) this.stoodAt = this.held
      this.stopAt = undefined
      this.held = undefined
      if (this.v === 0 && this.depart < DEPART) {
        // Standing: the signal has cleared; a moment, the horn, and away.
        this.depart += dt
        if (this.depart >= DEPART) hear(this.sounds, { kind: 'horn', v: 0.5 })
        vT = 0
      } else vT = speedFor(want)
    } else {
      if (this.stopAt === undefined && this.v === 0) {
        // Still standing (the work stopped before it got away): it waits here, its signal back at red.
        this.stopAt = this.pos
        this.held = this.stoodAt
      } else if (this.stopAt === undefined) this.chooseStop()
      const left = Math.max(0, this.stopAt! - this.pos)
      vT = this.v === 0 ? 0 : Math.min(clamp(this.v, APPROACH_MIN, APPROACH_MAX), Math.sqrt(2 * BRAKE * left))
    }
    const dv = vT - this.v
    this.v += dv > 0 ? Math.min(dv, ACC * dt) : Math.max(dv, -DEC * dt)
    this.pos += this.v * dt
    if (idle && this.stopAt !== undefined && (this.pos >= this.stopAt - 0.05 || (this.v < 0.02 && this.stopAt - this.pos < 0.6))) {
      this.pos = this.stopAt
      this.v = 0
    }
    if (this.v === 0 && idle) this.depart = 0
    this.extras = this.extras.filter(s => s > this.pos - TRAIN - 1200)

    this.listen(was)
    // Tints ease: smoke pours out at once and clears over a few seconds; a storm gathers.
    this.kSmoke = clamp(this.kSmoke + (this.tint === 'smoke' ? 0.2 : -0.035) * dt)
    this.kStorm = clamp(this.kStorm + (this.tint === 'blue' ? 0.05 : -0.04) * dt)
    this.moveCompanions(d, dt)
    this.moveSmoke(was, dt)
    if (this.tall) this.moveTraffic(dt)
    else this.moveBirds(d, dt)
  }

  /** Now and then by day a few birds cross the band's sky, drifting back as the train runs on. */
  private moveBirds(d: Dials, dt: number): void {
    const f = this.flock
    if (!f) {
      this.nextFlock -= dt
      if (this.nextFlock > 0 || d.night > 0.5 || this.kStorm > 0.3) return
      const dir = this.rand() < 0.5 ? 1 : -1
      const yHz = this.H - 6
      this.flock = {
        x: dir > 0 ? -8 : this.W + 8,
        y: 1 + this.rand() * Math.max(1, yHz * 2 - 4),
        vx: dir * (0.22 + this.rand() * 0.18),
        n: 2 + Math.floor(this.rand() * 4),
        ph: this.rand() * 8,
      }
      return
    }
    f.x += (f.vx - this.v * F_MID) * dt
    if (f.x < -24 || f.x > this.W + 24) {
      this.flock = undefined
      this.nextFlock = 250 + this.rand() * 700
    }
  }

  /** The wheels over each rail joint (heard at the listening carriage's end), and the horn before each level crossing. */
  private listen(was: number): void {
    const now = this.pos
    if (now <= was) return
    const end = LOCO + GAP + LISTEN * (CAR + GAP) - GAP / 2
    if (Math.floor((was - end) / JOINT) < Math.floor((now - end) / JOINT)) hear(this.sounds, { kind: 'clack', v: clamp(this.v / SPEED[10]!) })
    const z = Math.floor((now + HORN_AHEAD - CROSS) / ZONE)
    const c = z * ZONE + CROSS
    if (z !== this.horned && crosses(zoneOf(z)) && was < c - HORN_AHEAD && now >= c - HORN_AHEAD && this.v > 0.3) {
      this.horned = z
      hear(this.sounds, { kind: 'horn', v: 1 })
    }
  }

  private moveCompanions(d: Dials, dt: number): void {
    const want = Math.min(LIVERY.length, Math.round(d.boost / 15))
    let active = this.comps.filter(c => !c.leaving).length
    const far = this.farBehind()
    while (active < want) {
      const used = new Set(this.comps.map(c => c.livery))
      let livery = this.nextLivery++ % LIVERY.length
      for (let k = 0; k < LIVERY.length && used.has(livery); k++) livery = (livery + 1) % LIVERY.length
      this.comps.push({ off: far - UNIT, livery, leaving: false, ph: this.rand() * 6.283 })
      active++
    }
    for (let i = this.comps.length - 1; i >= 0 && active > want; i--) {
      if (this.comps[i]!.leaving) continue
      this.comps[i]!.leaving = true
      active--
    }
    let k = 0
    for (const c of this.comps) {
      // Each keeps its place alongside, gaining and losing a little; one that's done falls back out of sight.
      const target = c.leaving
        ? far - UNIT - 40
        : -6 - k * (UNIT + 14) + Math.sin(d.t * 0.0037 + c.ph) * 7 + Math.sin(d.t * 0.0011 + c.ph * 2.3) * 5
      if (!c.leaving) k++
      c.off += clamp((target - c.off) * 0.03, -1.4 * dt, 0.9 * dt)
    }
    this.comps = this.comps.filter(c => !(c.leaving && c.off < far - UNIT - 20))
  }

  private moveSmoke(was: number, dt: number): void {
    if (this.kSmoke > 0.3 && this.tint === 'smoke') {
      // Black smoke from the exhaust on the loco's roof, thick at first: puffs all along this frame's run (a
      // plume, not a string of beads), kept low by the rush of air at speed.
      const run = this.pos - was
      const n = Math.ceil((3 + run * 0.8) * dt)
      for (let i = 0; i < n && this.puffs.length < 260; i++)
        this.puffs.push({
          s: was + run * this.rand() - 14.5 + this.rand() * 1.5,
          up: 0,
          side: (this.rand() - 0.5) * 0.6,
          r: 0.9 + this.rand() * 0.5,
          life: 1,
          vu: (0.06 + this.rand() * 0.08) / (1 + this.v * 0.5),
          vs: 0.03 + this.rand() * 0.06,
          wisp: false,
        })
    } else if (this.v < 1 && this.rand() < 0.12 * dt && this.puffs.length < 40) {
      // Idling or pulling gently: the faintest haze off the exhaust.
      this.puffs.push({ s: this.pos - 14.5, up: 0, side: 0, r: 0.6, life: 0.6, vu: 0.08 + this.rand() * 0.05, vs: 0.02, wisp: true })
    }
    let live = 0
    for (const p of this.puffs) {
      // Left in the air as the train runs on (so it streams back), rising, spreading, thinning.
      p.up += p.vu * dt
      p.vu *= 0.985
      p.side += p.vs * dt
      p.s -= 0.06 * dt
      p.r = Math.min(3.4, p.r + 0.035 * dt)
      p.life -= 0.011 * dt
      if (p.life > 0) this.puffs[live++] = p
    }
    this.puffs.length = live
  }

  /** From above: cars on the roads in view, held at the barriers while a train's near. */
  private moveTraffic(dt: number): void {
    const top = Math.floor(this.pos / 3) + this.noseY + 4
    const bottom = top - this.H - 8
    const seen = new Set<number>()
    for (let z = Math.floor((bottom * 3) / ZONE); z <= Math.floor((top * 3) / ZONE); z++) {
      if (!crosses(zoneOf(z))) continue
      const vc = Math.floor((z * ZONE + CROSS) / 3)
      if (vc < bottom || vc > top) continue
      seen.add(z)
      let cars = this.roads.get(z)
      if (!cars) {
        cars = []
        for (let i = 0; i < 4; i++)
          cars.push({ x: this.rand() * this.W, dir: i % 2 === 0 ? 1 : -1, v: 0.25 + this.rand() * 0.2, color: CAR_COLORS[Math.floor(this.rand() * CAR_COLORS.length)]! })
        this.roads.set(z, cars)
      }
      const shut = this.gateShut(vc)
      const left = this.tx - 5
      const right = this.tx + 11
      for (const c of cars) {
        let nx = c.x + c.dir * c.v * dt
        // Wait at the barrier (a car already over the line carries on).
        if (shut && c.dir > 0 && c.x + 1 < left && nx + 1 >= left) nx = left - 1.01
        if (shut && c.dir < 0 && c.x > right && nx <= right) nx = right + 0.01
        // A car's length behind the one ahead in its lane.
        for (const o of cars) if (o !== c && o.dir === c.dir && (o.x - nx) * c.dir > 0 && (o.x - nx) * c.dir < 3.2) nx = c.x
        c.x = nx
        if (c.x > this.W + 2 || c.x < -4) {
          c.x = c.dir > 0 ? -3 - this.rand() * 24 : this.W + 2 + this.rand() * 24
          c.color = CAR_COLORS[Math.floor(this.rand() * CAR_COLORS.length)]!
        }
      }
    }
    for (const z of this.roads.keys()) if (!seen.has(z)) this.roads.delete(z)
  }

  /** Whether a crossing's barriers are down (a train near, or on it), by the road's row from above. */
  private gateShut(vc: number): boolean {
    const nose = this.pos / 3
    let back = (this.pos - TRAIN) / 3
    for (const c of this.comps) back = Math.min(back, (this.pos + c.off - UNIT) / 3)
    return vc >= back - 3 && vc <= nose + 30
  }

  /** A signal's aspect: red where it holds the train, and behind it (its block occupied); else green. */
  private red(sg: number): boolean {
    return sg === this.held || sg < this.pos - 2
  }

  /** This frame's colours: day to night, then smoke or a storm over them. */
  private palette(d: Dials): Pal {
    const kn = q(d.night, 8)
    const ks = q(this.kSmoke, 6)
    const kb = q(this.kStorm, 6)
    const P = {} as Pal
    for (const key of Object.keys(DAY) as (keyof Pal)[]) P[key] = mix(DAY[key], NIGHT[key], kn)
    if (ks > 0) {
      const o = OVERCAST
      P.skyTop = mix(P.skyTop, mix(o.day[0], o.night[0], kn), ks)
      P.skyHz = mix(P.skyHz, mix(o.day[1], o.night[1], kn), ks)
      P.cloud = mix(P.cloud, mix(o.day[2], o.night[2], kn), ks)
      P.cloudShade = mix(P.cloudShade, mix(o.day[3], o.night[3], kn), ks)
      for (const key of LAND) P[key] = grey(P[key], 0.5 * ks)
    }
    if (kb > 0) {
      const s = STORM
      P.skyTop = mix(P.skyTop, mix(s.day[0], s.night[0], kn), kb)
      P.skyHz = mix(P.skyHz, mix(s.day[1], s.night[1], kn), kb)
      P.cloud = mix(P.cloud, mix(s.day[2], s.night[2], kn), kb)
      P.cloudShade = mix(P.cloudShade, mix(s.day[3], s.night[3], kn), kb)
      const cast = mix(STORM_CAST.day, STORM_CAST.night, kn)
      for (const key of LAND) P[key] = mix(P[key], cast, 0.42 * kb)
      for (const key of BODY) P[key] = mix(P[key], cast, 0.18 * kb)
      // In the gloom the lights are on.
      P.glass = mix(P.glass, NIGHT.glass, 0.75 * kb)
      P.sideGlass = mix(P.sideGlass, NIGHT.sideGlass, 0.75 * kb)
      P.houseWin = mix(P.houseWin, NIGHT.houseWin, 0.6 * kb)
    }
    return P
  }

  /** How strongly the lights show (the headlight's beam, lamps' glow): by night, or in a storm. */
  private lights(d: Dials): number {
    return q(Math.max(d.night, this.kStorm * 0.8), 6)
  }

  paint(px: Painter, d: Dials): void {
    if (px.w === 0 || px.h === 0) return
    this.layout(d)
    if (this.solid.length !== px.w * px.h) this.resize(d)
    this.solid.fill(0)
    const P = this.palette(d)
    if (this.tall) this.paintAbove(px, d, P)
    else this.paintSide(px, d, P)
  }

  // ── The band: side-on ──────────────────────────────────────────────────

  private paintSide(px: Painter, d: Dials, P: Pal): void {
    const W = px.w
    const H = px.h
    const B = H - 1
    const nose = this.pos
    const nx = this.noseX
    const yRoof = B - 4
    const yWin = B - 3
    const yLow = B - 2
    const yBog = B - 1
    /** The far fields' row: the mid ground everything distant stands on. */
    const yHz = B - 5
    const t = d.t
    const kn = q(d.night, 8)
    const light = this.lights(d)
    const buf = px.px
    /** A layer's coordinate at column x (f: how fast it slides past): where its world sits under that column. */
    const at = (f: number, x: number) => Math.floor(nose * f + x - nx + 1)

    // The sky, a stepped gradient down to the horizon.
    const sky = new Int32Array(H)
    for (let y = 0; y < H; y++) {
      sky[y] = mix(P.skyTop, P.skyHz, q(y / Math.max(1, yHz), 6))
      buf.fill(sky[y]!, y * W, y * W + W)
    }
    // Clouds: two drifting banks, shaded along their undersides; thicker under smoke or a storm.
    for (let x = 0; x < W; x++) {
      for (let layer = 0; layer < 2; layer++) {
        const u = (x + nose * F_CLOUD * (layer + 1) + t * 0.015 * (layer + 1)) * (layer ? 0.06 : 0.04)
        const th = (noise1(u, 31 + layer) - 0.56) * 7 + this.kSmoke * 1.2 + this.kStorm * 2
        if (th <= 0) continue
        const cy = Math.max(0, yHz - 4 + layer)
        const top = Math.round(cy - th * 0.5)
        const bot = Math.min(yHz - 1, Math.round(cy + th * 0.5))
        for (let y = Math.max(0, top); y <= bot; y++) buf[y * W + x] = y === bot && bot > top ? P.cloudShade : P.cloud
      }
    }
    // Hills: a hazy far ridge and a nearer, greener one.
    for (let x = 0; x < W; x++) {
      const far = Math.round(yHz - 0.7 - 1.7 * noise1((x + nose * F_HILLFAR) * 0.02, 41))
      const near = Math.round(yHz - 0.2 - 1.1 * noise1((x + nose * F_HILL) * 0.035, 43))
      for (let y = Math.max(0, far); y < yHz; y++) buf[y * W + x] = y >= near ? P.hill : P.hillFar
    }
    // The moon (by night), low over the hills in the band.
    if (kn > 0) {
      const [mx, my] = moonPixel(d.columns, d.rows)
      const r = moonRadius(false)
      for (let y = Math.max(0, Math.floor(my - r)); y <= Math.min(yHz - 1, Math.ceil(my + r)); y++)
        for (let x = Math.max(0, Math.floor(mx - r - 1)); x <= Math.min(W - 1, Math.ceil(mx + r + 1)); x++) {
          const k = moonCover(x + 0.5, y + 0.5, mx, my, r)
          if (k > 0) buf[y * W + x] = mix(buf[y * W + x]!, MOON, q(k * kn, 4))
        }
    }
    // Stars, in what's left of the sky.
    if (kn > 0.3) {
      const n = Math.round(W * 0.06 * kn)
      for (let i = 0; i < n; i++) {
        const x = Math.floor(hash1(i * 977 + 3) * px.dw)
        const y = Math.floor(hash1(i * 977 + 5) * Math.max(1, yHz - 1) * 2)
        const cell = (y >> 1) * W + (x & ~1)
        if (buf[cell] !== sky[y >> 1] || buf[cell + 1] !== sky[y >> 1]) continue
        const twinkle = hash1(i * 31 + (t >> 4)) < 0.15
        px.dot(x, y, twinkle || hash1(i * 977 + 7) < 0.4 ? STAR_DIM : STAR)
      }
    }

    // The far fields and what stands on them: trees, houses, a church; a river; woods.
    if (yHz >= 0) {
      for (let x = 0; x < W; x++) {
        const u = at(F_MID, x)
        const S = u / F_MID
        const z = Math.floor(S / ZONE)
        const zone = zoneOf(z)
        const local = S - z * ZONE
        let ground = this.field(Math.floor(u / 23), P)
        if (zone === WOODS) ground = P.floor
        if (zone === RIVER && local > WATER0 - 30 && local < WATER1 + 30) ground = P.water
        if (crosses(zone) && Math.abs(local - CROSS) < ROAD / F_MID) ground = P.road
        buf[yHz * W + x] = ground
        this.farThings(px, x, u, yHz, P, kn)
      }
    }
    // The nearer fields (seen past the train's ends), and the station's far platform.
    if (yRoof >= 0) {
      for (let x = 0; x < W; x++) {
        const u = at(F_FIELD, x)
        const S = u / F_FIELD
        const z = Math.floor(S / ZONE)
        const zone = zoneOf(z)
        const local = S - z * ZONE
        let c = this.field(Math.floor(u / 31) + 977, P)
        if (zone === WOODS) c = hash1(Math.floor(u / 3) * 13) < 0.6 ? P.tree : P.treeShade
        else if (zone === RIVER && local > WATER0 && local < WATER1) c = hash1(Math.floor(u / 2) + (t >> 3) * 7) < 0.12 ? P.waterHi : P.water
        else if (zone === RIVER && local > WATER0 - 14 && local < WATER1 + 14) c = P.reed
        else if (crosses(zone) && Math.abs(local - CROSS) < ROAD) c = P.road
        const Sf = at(F_FARPLAT, x) / F_FARPLAT
        const zf = Math.floor(Sf / ZONE)
        if (zoneOf(zf) === STATION && Sf - zf * ZONE > PLAT0 && Sf - zf * ZONE < PLAT1) c = P.platform
        buf[yRoof * W + x] = c
      }
    }
    // The station's building and the canopy over the far platform (behind both tracks).
    this.stationBehind(px, d, P, yHz, at)
    // The far track's rail, and the verge between the tracks; a road crossing them; the bridge's deck.
    for (let x = 0; x < W; x++) {
      const S = at(F_FAR, x) / F_FAR
      const z = Math.floor(S / ZONE)
      const zone = zoneOf(z)
      const local = S - z * ZONE
      const road = crosses(zone) && Math.abs(local - CROSS) < ROAD
      const bridge = zone === RIVER && local > BRIDGE0 && local < BRIDGE1
      if (yWin >= 0) buf[yWin * W + x] = Math.floor(S) % JOINT === 0 ? (road ? P.road : bridge ? P.steel : P.ballastFar) : P.railFar
      if (yLow >= 0) buf[yLow * W + x] = road ? P.road : bridge ? P.steel : hash1(Math.floor(S) * 5 + 3) < 0.3 ? P.ballastFar : P.verge
    }
    // The near track: ballast and the sleepers' ends (a blur at speed; the bridge's deck over the river), and the rail, its joints going by.
    const sleeper = mix(P.sleeper, P.ballast, q((this.v - 0.6) / 0.8, 3))
    for (let x = 0; x < W; x++) {
      const S = nose + x - nx + 1
      const Si = Math.floor(S)
      const z = Math.floor(S / ZONE)
      const zone = zoneOf(z)
      const local = S - z * ZONE
      const road = crosses(zone) && Math.abs(local - CROSS) < ROAD
      const bridge = zone === RIVER && local > BRIDGE0 && local < BRIDGE1
      if (yBog >= 0) buf[yBog * W + x] = road ? P.road : bridge ? P.steel : Si % 3 === 0 ? sleeper : hash1(Si * 7 + 11) < 0.35 ? P.ballast2 : P.ballast
      buf[B * W + x] = Si % JOINT === 0 && !road ? (bridge ? P.steel : P.ballast) : P.rail
    }

    // The companions on the far track, then the train itself.
    for (const c of this.comps) {
      const front = nx - 1 + Math.round(c.off)
      const livery = mix(LIVERY[c.livery]!, NIGHT_SHADE, 0.55 * kn)
      for (let b = 0; b < UNIT; b++) {
        const x = front - b
        if (x < 0 || x >= W) continue
        for (let r = 0; r < 4; r++) {
          const y = yRoof - 3 + r
          if (y < 0) continue
          const c2 = this.unitSide(b, r, livery, P)
          if (c2 < 0) continue
          buf[y * W + x] = c2
          this.solid[y * W + x] = 1
        }
      }
    }
    for (let b = 0; b < TRAIN; b++) {
      const x = nx - 1 - b
      if (x < 0) break
      if (x >= W) continue
      for (let r = 0; r < 4; r++) {
        const y = yRoof + r
        if (y < 0) continue
        const c = this.trainSide(b, r, P)
        if (c < 0) continue
        buf[y * W + x] = c
        this.solid[y * W + x] = 1
      }
    }

    // In front of the train: the platform and its lamps, a crossing's lights, a bridge's truss, the signals, the poles.
    this.inFront(px, d, P, at, light)

    // The headlight's beam on the line ahead (by night, in a storm).
    if (light > 0) {
      const len = Math.min(56, W - nx)
      for (let dx = 0; dx < len; dx++) {
        const x = nx + dx
        const k = Math.pow(1 - dx / len, 1.6)
        for (let y = Math.max(0, yWin); y <= B; y++) {
          const spread = y >= yBog ? 1 : y === yLow ? 0.55 : 0.25
          const a = q(k * spread * 0.75 * light, 5)
          if (a > 0) buf[y * W + x] = mix(buf[y * W + x]!, P.beam, a)
        }
      }
    }
    this.birds(px, d, P)
    this.smokeSide(px, P, yRoof)
    this.rain(px, d, P)
  }

  /** A field's colour along the band (each its own crop). */
  private field(k: number, P: Pal): number {
    const h = hash1(k * 4523 + 17)
    return h < 0.34 ? P.grass : h < 0.58 ? P.grass2 : h < 0.74 ? P.wheat : h < 0.86 ? P.plough : h < 0.93 ? P.rape : P.grass
  }

  /** What stands on the far fields at column x: trees, poplars, houses, barns and a church, by the stretch. */
  private farThings(px: Painter, x: number, u: number, base: number, P: Pal, kn: number): void {
    const SLOT = 7
    const j = Math.floor(u / SLOT)
    const Sj = (j * SLOT + SLOT / 2) / F_MID
    const zj = Math.floor(Sj / ZONE)
    const zone = zoneOf(zj)
    const local = Sj - zj * ZONE
    const h = hash1(j * 6151 + 29)
    const h2 = hash1(j * 6151 + 31)
    const buf = px.px
    const W = px.w
    // (Hazed a little toward the sky: they're far off, behind the train.)
    const set = (dy: number, c: number, keep = false) => {
      const y = base - dy
      if (y < 0) return
      if (keep) px.set(x, y, c, true)
      else buf[y * W + x] = mix(c, P.skyHz, 0.18)
    }
    const wet = zone === RIVER && local > WATER0 - 60 && local < WATER1 + 60
    // Chances of a tree, a poplar, a house, a barn in a slot, by the stretch.
    const p =
      zone === WOODS ? [0.9, 0.06, 0, 0] : zone === VILLAGE || zone === STATION ? [0.16, 0.04, 0.3, 0.03] : zone === RIVER ? [0.3, 0.1, 0.03, 0] : [0.15, 0.05, 0.05, 0.05]
    if (wet) p[2] = p[3] = 0
    let kind = 0
    if (h < p[0]!) kind = 1
    else if (h < p[0]! + p[1]!) kind = 2
    else if (h < p[0]! + p[1]! + p[2]!) kind = 3
    else if (h < p[0]! + p[1]! + p[2]! + p[3]!) kind = 4
    // A village has its church.
    if (zone === VILLAGE && Math.abs(local - (CROSS - 120)) < SLOT / F_MID / 2) kind = 5
    if (crosses(zone) && Math.abs(local - CROSS) < 20 / F_MID) kind = 0
    if (kind === 0) return
    const c = u - j * SLOT - Math.floor(h2 * 3)
    if (kind === 1) {
      // A tree: a round crown, lit up-left, shaded down-right.
      const big = (zone === WOODS && h2 > 0.3) || h2 > 0.8
      const w = big ? 4 : 3
      if (c < 0 || c >= w) return
      const tall = big ? 3 : 2
      for (let dy = 0; dy < tall; dy++) {
        if (dy === tall - 1 && (c === 0 || c === w - 1)) continue
        set(dy, dy === tall - 1 || c === 0 ? P.treeLit : c === w - 1 || dy === 0 ? P.treeShade : P.tree)
      }
    } else if (kind === 2) {
      // A poplar: tall and thin.
      if (c !== 1) return
      for (let dy = 0; dy < 4; dy++) set(dy, dy === 3 ? P.treeLit : P.tree)
    } else if (kind === 3) {
      // A house: a window (lit by night) under a pitched roof.
      if (c < 0 || c >= 4) return
      const roof = h2 > 0.6 ? P.slate : P.roof
      set(0, c === 1 ? P.houseWin : P.wall, c === 1 && kn > 0.3)
      set(1, roof)
      if (c >= 1 && c <= 2) set(2, roof)
    } else if (kind === 4) {
      // A barn.
      if (c < 0 || c >= 5) return
      set(0, P.brick)
      set(1, P.roofDark)
      if (c >= 1 && c <= 3) set(2, P.roofDark)
    } else {
      // The church: a tower and spire, and its nave.
      if (c < 0 || c >= 6) return
      if (c <= 1) {
        for (let dy = 0; dy < 4; dy++) set(dy, dy === 2 && c === 0 && kn > 0.3 ? P.houseWin : P.wall, dy === 2 && c === 0 && kn > 0.3)
        set(4, P.slate)
        if (c === 0) set(5, P.slate)
      } else {
        set(0, c === 3 ? P.houseWin : P.wall, c === 3 && kn > 0.3)
        set(1, P.slate)
        if (c >= 3 && c <= 4) set(2, P.slate)
      }
    }
  }

  /** The station's building and the canopy over the far platform, behind both tracks. */
  private stationBehind(px: Painter, d: Dials, P: Pal, yHz: number, at: (f: number, x: number) => number): void {
    const W = px.w
    const buf = px.px
    const kn = q(d.night, 8)
    for (let x = 0; x < W; x++) {
      // The canopy, its valance catching the light; lamps under it by night.
      const S = at(F_FARPLAT, x) / F_FARPLAT
      const z = Math.floor(S / ZONE)
      if (zoneOf(z) === STATION) {
        const local = S - z * ZONE
        if (local > CANOPY0 && local < CANOPY1) {
          if (yHz - 2 >= 0) buf[(yHz - 2) * W + x] = P.canopy
          if (yHz - 1 >= 0) buf[(yHz - 1) * W + x] = P.valance
          if (yHz >= 0) {
            if (Math.floor(local) % 30 === 0) buf[yHz * W + x] = P.post
            else if (kn > 0.3 && Math.floor(local) % 30 === 15) px.set(x, yHz, P.spill, true)
          }
        }
      }
      // The building, a little further back: brick, its windows, a slate roof and a chimney.
      const Sb = at(F_STATION, x) / F_STATION
      const zb = Math.floor(Sb / ZONE)
      if (zoneOf(zb) !== STATION) continue
      const lb = Sb - zb * ZONE
      const w0 = 420
      if (lb < w0 || lb >= w0 + 22 / F_STATION) continue
      const c = Math.floor((lb - w0) * F_STATION)
      for (let dy = 0; dy < 3; dy++) {
        const y = yHz - dy
        if (y < 0) continue
        const win = dy < 2 && c % 4 === 2
        if (win && kn > 0.3) px.set(x, y, P.houseWin, true)
        else buf[y * W + x] = win ? P.houseWin : P.brick
      }
      if (yHz - 3 >= 0) buf[(yHz - 3) * W + x] = P.slate
      if (yHz - 4 >= 0 && c >= 16 && c <= 17) buf[(yHz - 4) * W + x] = P.brick
    }
  }

  /** The platform and its lamps, a crossing's lights, a bridge's truss, the signals and the poles: all nearer than the train. */
  private inFront(px: Painter, d: Dials, P: Pal, at: (f: number, x: number) => number, light: number): void {
    const W = px.w
    const H = px.h
    const B = H - 1
    const buf = px.px
    const nose = this.pos
    const nx = this.noseX
    const t = d.t
    for (let x = 0; x < W; x++) {
      const S = nose + x - nx + 1
      const z = Math.floor(S / ZONE)
      const zone = zoneOf(z)
      const local = S - z * ZONE
      if (zone === STATION && local > PLAT0 && local < PLAT1) {
        // The near platform hides the wheels; lamps along it.
        if (B - 1 >= 0) buf[(B - 1) * W + x] = P.platform
        buf[B * W + x] = P.platformFace
        if (Math.floor(local) % 48 === 24 && local > PLAT0 + 20 && local < PLAT1 - 20) {
          for (let y = Math.max(0, B - 5); y <= B - 2; y++) buf[y * W + x] = P.post
          if (B - 6 >= 0) px.set(x, B - 6, mix(P.post, P.lamp, Math.max(0.35, light)), true)
        }
      }
      if (crosses(zone) && Math.floor(local) === CROSS + 8) {
        // The crossing's lights, flashing in turn while a train's near.
        const c = S - 8
        const near = c >= nose - TRAIN - 10 && c <= nose + 260
        for (let y = Math.max(0, B - 5); y <= B; y++) buf[y * W + x] = P.post
        const on = (t >> 3) % 2 === 0
        if (B - 6 >= 0) {
          px.set(x, B - 6, near && on ? RED : RED_OFF, near && on)
          px.set(x + 1, B - 6, near && !on ? RED : RED_OFF, near && !on)
        }
      }
      if (zone === RIVER || zoneOf(z + 1) === RIVER || zoneOf(z - 1) === RIVER) {
        // A Warren truss: top and bottom chords, diagonals zigzagging between.
        const ut = at(F_TRUSS, x)
        const St = ut / F_TRUSS
        const zt = Math.floor(St / ZONE)
        const lt = St - zt * ZONE
        if (zoneOf(zt) === RIVER && lt > BRIDGE0 && lt < BRIDGE1) {
          const top = Math.max(0, B - 6)
          const p = ((ut % 16) + 16) % 16
          const yd = top + Math.round((B - top) * (p < 8 ? p / 8 : (16 - p) / 8))
          buf[top * W + x] = P.steel
          buf[B * W + x] = P.steel
          if (yd >= 0 && yd <= B) buf[yd * W + x] = P.steel
          if (p === 0) for (let y = top; y <= B; y++) buf[y * W + x] = P.steel
        }
      }
    }
    // Signals: red where one holds the train, and behind it.
    const sigs = [...this.extras]
    for (let k = Math.floor((nose - nx - SIGNAL0) / SIGNAL); k * SIGNAL + SIGNAL0 < nose + (W - nx) + 2; k++) sigs.push(k * SIGNAL + SIGNAL0)
    for (const sg of sigs) {
      const x = Math.round(nx - 1 + (sg - nose))
      if (x < 0 || x >= W) continue
      for (let y = Math.max(0, B - 5); y <= B; y++) buf[y * W + x] = P.post
      if (B - 6 >= 0) px.set(x, B - 6, this.red(sg) ? RED : GREEN, true)
    }
    // Telegraph poles, nearest of all: at speed they smear.
    const blur = Math.max(1, this.v * F_POLE * 0.7)
    for (let x = 0; x < W; x++) {
      const u = nose * F_POLE + x - nx + 1
      const p = ((u % POLE) + POLE) % POLE
      if (p >= blur) continue
      const S = u / F_POLE
      const z = Math.floor(S / ZONE)
      const zone = zoneOf(z)
      const local = S - z * ZONE
      if ((zone === STATION && local > PLAT0 - 40 && local < PLAT1 + 40) || (zone === RIVER && local > BRIDGE0 - 20 && local < BRIDGE1 + 20)) continue
      const a = q(1 / blur, 4)
      for (let y = Math.max(0, B - 8); y <= B; y++) buf[y * W + x] = mix(buf[y * W + x]!, P.pole, a)
      if (B - 8 >= 0 && blur < 2) {
        if (x > 0) buf[(B - 8) * W + x - 1] = P.pole
        if (x + 1 < W) buf[(B - 8) * W + x + 1] = P.pole
      }
    }
  }

  /** The loco or a carriage, side-on: `b` pixels back from the nose, row `r` (0 roof, 1 windows, 2 body, 3 bogies). */
  private trainSide(b: number, r: number, P: Pal): number {
    if (b < LOCO) {
      if (r === 0) return b < 4 ? -1 : b === 14 || b === 15 ? P.grille : P.carRoof
      if (r === 1) return b < 2 ? -1 : b < 4 ? P.glass : b < 6 ? P.yellow : b < 8 ? P.glass : b >= 12 && b < 22 && (b & 2) === 0 ? P.locoVent : b >= LOCO - 2 ? P.yellow : P.loco
      if (r === 2) return b < 2 ? P.lamp : b < 4 ? P.yellow : b >= LOCO - 2 ? P.yellow : P.loco
      return b < 4 || b >= 30 ? -1 : b < 10 || b >= 24 ? P.bogie : P.grille
    }
    const rb = b - LOCO - GAP
    if (rb < 0) return r === 2 ? P.bogie : -1
    if (Math.floor(rb / (CAR + GAP)) >= CARS) return -1
    const cb = rb % (CAR + GAP)
    if (cb >= CAR) return r === 2 ? P.bogie : -1
    return this.carSide(cb, r, P, P.crimson)
  }

  /** A carriage side-on, `cb` from its front: a window band (cream on ours) over its colour. */
  private carSide(cb: number, r: number, P: Pal, body: number, band = P.cream): number {
    if (r === 0) return P.carRoof
    if (r === 1) {
      if (cb < 2 || cb >= CAR - 2) return band
      if (cb < 4 || cb >= CAR - 4) return mix(band, P.vent, 0.35)
      return (cb & 2) === 0 ? P.glass : band
    }
    if (r === 2) return body
    return (cb >= 2 && cb < 8) || (cb >= CAR - 8 && cb < CAR - 2) ? P.bogie : P.shadow
  }

  /** A companion side-on: a driving car (its cab at the front) and a trailer, in its livery. */
  private unitSide(b: number, r: number, livery: number, P: Pal): number {
    if (b < CAR) {
      if (r === 0) return b < 4 ? -1 : P.carRoof
      if (r === 1) return b < 2 ? -1 : b < 4 ? P.glass : b < 8 ? livery : (b & 2) === 0 ? P.glass : mix(livery, 0xffffff, 0.35)
      if (r === 2) return b < 2 ? P.lamp : b < 4 ? P.yellow : livery
      return (b >= 4 && b < 10) || (b >= CAR - 8 && b < CAR - 2) ? P.bogie : P.shadow
    }
    const cb = b - CAR - GAP
    if (cb < 0) return r === 2 ? P.bogie : -1
    return this.carSide(cb, r, P, livery, mix(livery, 0xffffff, 0.35))
  }

  /** The flock: each bird a 'v' of braille dots, its wings beating out of step with the others'. */
  private birds(px: Painter, d: Dials, P: Pal): void {
    const f = this.flock
    if (!f) return
    const dir = f.vx > 0 ? 1 : -1
    for (let k = 0; k < f.n; k++) {
      const bx = Math.round(f.x - dir * (k * 4 + hash1(k * 7 + 1) * 2))
      const by = Math.round(f.y + (k % 2) * 2 + hash1(k * 7 + 2) * 1.5)
      const up = (Math.floor((d.t + k * 5 + f.ph) / 3) & 1) === 1
      for (const [dx, dy] of [[-1, up ? -1 : 0], [0, 0], [1, up ? -1 : 0]] as const) {
        const x = bx + dx
        const y = by + dy
        if (x < 0 || y < 0 || x >= px.dw || y >= px.dh) continue
        const c = ((y >> 2) * 2) * px.w + (x & ~1)
        if (this.solid[c] || this.solid[c + 1]) continue
        px.dot(x, y, P.bird)
      }
    }
  }

  /** Smoke from the exhaust, side-on: dark puffs streaming back and up, thinning into the sky. */
  private smokeSide(px: Painter, P: Pal, yRoof: number): void {
    const W = px.w
    const buf = px.px
    for (const p of this.puffs) {
      const cx = this.noseX - 1 + (p.s - this.pos)
      const cy = yRoof - 0.5 - p.up
      const r = p.r
      const ry = r * 0.5 + 0.3
      const a = q(p.life * (p.wisp ? 0.4 : 0.95), 4)
      if (a <= 0) continue
      for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(px.h - 1, Math.ceil(cy + ry)); y++)
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) {
          const dx = (x + 0.5 - cx) / r
          const dy = (y + 0.5 - cy) / ry
          if (dx * dx + dy * dy > 1) continue
          buf[y * W + x] = mix(buf[y * W + x]!, p.wisp ? P.haze : P.soot, a)
        }
    }
  }

  /** Rain driving past (a storm): short slanting streaks, slanting more the faster it runs; past the trains, not over them. */
  private rain(px: Painter, d: Dials, P: Pal): void {
    const kb = this.kStorm
    if (kb < 0.05) return
    const dw = px.dw
    const dh = px.dh
    const W = px.w
    const n = Math.round(dw * dh * 0.012 * kb)
    const slant = this.tall ? 0.3 : 0.35 + this.v * 0.35
    const fall = this.tall ? 2.2 : 1.8
    for (let i = 0; i < n; i++) {
      const sp = 0.8 + hash1(i * 7 + 3) * 0.5
      const y = (((hash1(i * 7 + 1) * dh + d.t * fall * sp) % dh) + dh) % dh
      const x = (((hash1(i * 7 + 2) * dw - d.t * slant * fall * sp - (this.tall ? 0 : this.pos * 0.6)) % dw) + dw) % dw
      for (let k = 0; k < 2; k++) {
        const xx = Math.floor(x + k * slant) % dw
        const yy = Math.floor(y - k)
        if (yy < 0) continue
        // (A dot turns its whole cell to braille: keep it off a train's cells.)
        const c = (yy >> 2) * 2 * W + (xx & ~1)
        if (this.solid[c] || this.solid[c + 1] || this.solid[c + W] || this.solid[c + W + 1]) continue
        px.dot(xx, yy, P.rain)
      }
    }
  }

  // ── The spine: from above ──────────────────────────────────────────────

  private paintAbove(px: Painter, d: Dials, P: Pal): void {
    const W = px.w
    const H = px.h
    const buf = px.px
    const tx = this.tx
    const ny = this.noseY
    const av = Math.floor(this.pos / 3)
    const kn = q(d.night, 8)
    const light = this.lights(d)
    const t = d.t
    // Sleepers blur into the ballast at speed (rather than strobe).
    const sleeper = mix(P.sleeper, P.ballast, q((this.v / 3 - 0.3) / 0.5, 4))
    const rowV = this.rowV
    for (let y = 0; y < H; y++) rowV[y] = av + ny - y

    // The ground, a row at a time: the trackbed, platforms, roads, and the countryside.
    for (let y = 0; y < H; y++) {
      const v = rowV[y]!
      const S = v * 3
      const z = Math.floor(S / ZONE)
      const zone = zoneOf(z)
      const local = S - z * ZONE
      const road = crosses(zone) && Math.abs(local - CROSS) < ROAD
      const bridge = zone === RIVER && local > BRIDGE0 && local < BRIDGE1
      const plat = zone === STATION && local > PLAT0 && local < PLAT1
      const canopy = zone === STATION && local > CANOPY0 && local < CANOPY1
      const row = y * W
      for (let x = 0; x < W; x++) {
        let c: number
        const dx = x - tx
        if (dx >= -3 && dx <= 9) {
          // Two tracks: sleepers and rails on ballast (a bridge's deck over the river, a road across).
          const rail = dx === -2 || dx === 1 || dx === 5 || dx === 8
          if (road) c = rail ? P.rail : P.road
          else if (rail) c = v % 8 === 0 ? mix(P.rail, P.ballast, 0.5) : P.rail
          else if (dx !== 3 && (v & 1) === 0) c = bridge ? mix(sleeper, P.steel, 0.5) : sleeper
          else c = bridge ? P.steel : hash(x, v, 5) < 0.3 ? P.ballast2 : P.ballast
          if (bridge && (dx === -3 || dx === 9)) c = P.post
        } else if (plat && ((dx >= -6 && dx <= -4) || (dx >= 10 && dx <= 12))) {
          // The platforms, their edges marked; a canopy over the middle; lamps by night.
          c = dx === -4 || dx === 10 ? P.platformEdge : P.platform
          if (canopy && dx !== -4 && dx !== 10) c = (v & 3) === 0 ? mix(P.canopy, P.valance, 0.25) : P.canopy
          if (kn > 0.3 && (dx === -5 || dx === 11) && v % 6 === 0) c = P.spill
        } else if (road) {
          c = P.road
          if (kn > 0.3 && Math.floor(local - CROSS + ROAD) === 0 && x % 10 === 3) c = P.spill
        } else c = this.groundAbove(x, v, zone, local, P, t)
        buf[row + x] = c
      }
    }
    this.treesAbove(px, P)
    this.housesAbove(px, P, kn)
    // Signals beside the line.
    const sigs = [...this.extras]
    const topS = (av + ny + 2) * 3
    const botS = (av + ny - H - 2) * 3
    for (let k = Math.floor((botS - SIGNAL0) / SIGNAL); k * SIGNAL + SIGNAL0 <= topS; k++) sigs.push(k * SIGNAL + SIGNAL0)
    for (const sg of sigs) {
      const y = ny - (Math.floor(sg / 3) - av)
      if (y < 0 || y >= H) continue
      px.set(tx - 4, y, this.red(sg) ? RED : GREEN, true)
      px.set(tx - 4, y + 1, P.post)
    }
    // Level crossings: the barriers down while a train's near, the cars waiting.
    for (const [z, cars] of this.roads) {
      const vc = Math.floor((z * ZONE + CROSS) / 3)
      const y = ny - (vc - av)
      if (this.gateShut(vc))
        for (const yy of [y - 1, y, y + 1]) {
          if (yy < 0 || yy >= H) continue
          px.set(tx - 4, yy, (yy & 1) === 0 ? 0xe03020 : 0xf0f0f0, true)
          px.set(tx + 10, yy, (yy & 1) === 1 ? 0xe03020 : 0xf0f0f0, true)
        }
      for (const c of cars) {
        const yy = c.dir > 0 ? y : y - 1
        if (yy < 0 || yy >= H) continue
        const x0 = Math.round(c.x)
        const body = mix(c.color, NIGHT_SHADE, 0.6 * kn)
        // Headlights in front, tail lights behind, by night.
        px.set(x0, yy, c.dir > 0 ? mix(body, 0xff3020, 0.6 * light) : mix(body, 0xfff6d8, 0.7 * light), true)
        px.set(x0 + 1, yy, c.dir > 0 ? mix(body, 0xfff6d8, 0.7 * light) : mix(body, 0xff3020, 0.6 * light), true)
      }
    }
    // The companions on the right-hand track, then the train.
    for (const c of this.comps) {
      const top = ny - Math.round(c.off / 3)
      const livery = mix(LIVERY[c.livery]!, NIGHT_SHADE, 0.55 * kn)
      for (let r = 0; r < A_UNIT; r++) {
        const y = top + r
        if (y < 0 || y >= H) continue
        for (let i = 0; i < 4; i++) {
          const c2 = this.unitAbove(r, i, livery, P)
          if (c2 < 0) continue
          buf[y * W + tx + 5 + i] = c2
          this.solid[y * W + tx + 5 + i] = 1
        }
        if (kn > 0.3 && r !== A_CAR) this.spill(px, P, tx + 4, tx + 9, y, r > A_CAR ? r - A_CAR - A_GAP : r, kn)
      }
    }
    const len = A_LOCO + CARS * (A_GAP + A_CAR)
    for (let r = 0; r < len; r++) {
      const y = ny + r
      if (y >= H) break
      for (let i = 0; i < 4; i++) {
        const c = this.trainAbove(r, i, P)
        if (c < 0) continue
        buf[y * W + tx - 2 + i] = c
        this.solid[y * W + tx - 2 + i] = 1
      }
      if (kn > 0.3 && r >= A_LOCO + A_GAP) this.spill(px, P, tx - 3, tx + 2, y, (r - A_LOCO - A_GAP) % (A_CAR + A_GAP), kn)
    }
    // A footbridge across the platforms and the tracks, over the trains.
    const foot = Math.floor((PLAT0 + 90) / 3)
    for (let y = 0; y < H; y++) {
      const S = rowV[y]! * 3
      const z = Math.floor(S / ZONE)
      if (zoneOf(z) !== STATION || Math.floor((S - z * ZONE) / 3) !== foot) continue
      for (let x = Math.max(0, tx - 6); x <= Math.min(W - 1, tx + 12); x++) buf[y * W + x] = P.slate
    }
    // The headlight's beam up the line (by night, in a storm).
    if (light > 0) {
      for (let dy = 1; dy <= 22; dy++) {
        const y = ny - dy
        if (y < 0) break
        const half = 1 + dy * 0.22
        const k = Math.pow(1 - dy / 23, 1.6) * 0.45 * light
        for (let x = Math.floor(tx - 0.5 - half); x <= Math.ceil(tx - 0.5 + half); x++) {
          if (x < 0 || x >= W) continue
          const a = q(k * clamp(half + 0.5 - Math.abs(x + 0.5 - tx)), 5)
          if (a > 0) buf[y * W + x] = mix(buf[y * W + x]!, P.beam, a)
        }
      }
    }
    this.smokeAbove(px, P)
    this.rain(px, d, P)
  }

  /** A pixel of the countryside from above: a river and its reeds, woods, gardens, or a patchwork of hedged fields. */
  private groundAbove(x: number, v: number, zone: number, local: number, P: Pal, t: number): number {
    if (zone === RIVER) {
      const l = local + 9 * Math.sin(x * 0.13 + v * 0.002) + 4 * Math.sin(x * 0.31 + 1.7)
      if (l > WATER0 && l < WATER1) return hash(x, v + (t >> 3), 9) < 0.06 ? P.waterHi : P.water
      if (l > WATER0 - 8 && l < WATER1 + 8) return hash(x, v, 10) < 0.5 ? P.reed : P.grass2
    }
    if (zone === WOODS) return hash(x, v, 11) < 0.3 ? P.treeShade : P.floor
    if ((zone === VILLAGE || zone === STATION) && Math.abs(x - this.tx - 3) > 12) {
      // Gardens, some hedged, some not; a vegetable patch here and there.
      const gv = Math.floor(v / 4)
      const ox = Math.floor(hash(gv, 0, 41) * 6)
      const gx = Math.floor((x + ox) / 6)
      if (((x + ox) % 6 === 0 && hash(gx, gv, 42) < 0.55) || (v % 4 === 0 && hash(gx, gv, 43) < 0.45)) return P.hedge
      const k = hash(gx, gv, 12)
      return k < 0.4 ? P.grass : k < 0.78 ? P.grass2 : k < 0.9 ? ((v & 1) === 0 ? P.plough : P.plough2) : P.wheat2
    }
    const side = x < this.tx ? 0 : 1
    const FH = 24
    const vv = v + side * 11
    const fr = Math.floor(vv / FH)
    const lo = side === 0 ? 0 : this.tx + 13
    const hi = side === 0 ? this.tx - 7 : this.W - 1
    const xs = lo + Math.round((hi - lo) * (0.25 + 0.5 * hash(fr, side, 13)))
    if (vv - fr * FH === 0 || x === xs) return hash(x, v, 14) < 0.12 ? P.grass2 : P.hedge
    const kind = hash(fr * 2 + (x < xs ? 0 : 1), side, 15)
    if (kind < 0.3) return hash(x, v, 16) < 0.15 ? P.grass2 : P.grass
    if (kind < 0.45) return hash(x, v, 17) < 0.02 ? P.sheep : P.grass2
    if (kind < 0.65) return (x & 1) === 0 ? P.wheat : P.wheat2
    if (kind < 0.84) return (v & 1) === 0 ? P.plough : P.plough2
    if (kind < 0.9) return hash(x, v, 18) < 0.12 ? P.wheat : P.rape
    return P.grass
  }

  /** Trees from above: crowns lit up-left, a shadow cast down-right; dense in the woods. */
  private treesAbove(px: Painter, P: Pal): void {
    const W = px.w
    const H = px.h
    const buf = px.px
    const cv = this.canopy
    cv.fill(0)
    const GX = 6
    const GV = 5
    const av = this.rowV[this.noseY]!
    for (let gv = Math.floor(this.rowV[H - 1]! / GV) - 1; gv <= Math.floor(this.rowV[0]! / GV) + 1; gv++) {
      for (let gx = -1; gx <= Math.floor(W / GX) + 1; gx++) {
        const cx = gx * GX + 1 + hash(gx, gv, 22) * 4
        const cvv = gv * GV + 1 + hash(gx, gv, 23) * 3
        const S = cvv * 3
        const z = Math.floor(S / ZONE)
        const zone = zoneOf(z)
        const local = S - z * ZONE
        const p = zone === WOODS ? 0.97 : zone === RIVER ? 0.3 : zone === VILLAGE ? 0.22 : zone === STATION ? 0.08 : 0.13
        if (hash(gx, gv, 21) >= p) continue
        // Clear of the line and its platforms, the roads and the water.
        if (Math.abs(cx - this.tx - 3) < 11) continue
        if (crosses(zone) && Math.abs(local - CROSS) < 12) continue
        if (zone === RIVER && local > WATER0 - 30 && local < WATER1 + 30) continue
        const rx = zone === WOODS ? 2.3 : 1.4 + hash(gx, gv, 24) * 0.8
        const ry = rx * 0.55
        const y0 = this.noseY - (cvv - av)
        for (let y = Math.floor(y0 - ry - 1); y <= Math.ceil(y0 + ry + 1); y++) {
          if (y < 0 || y >= H) continue
          for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
            if (x < 0 || x >= W) continue
            const ex = (x + 0.5 - cx) / rx
            const ey = (y + 0.5 - y0) / ry
            const i = y * W + x
            if (ex * ex + ey * ey <= 1) cv[i] = ex + ey < -0.5 ? 3 : 2
            else {
              const sx = (x - 0.5 - cx) / rx
              const sy = (y - 0.5 - y0) / ry
              if (sx * sx + sy * sy <= 1 && cv[i] === 0) cv[i] = 1
            }
          }
        }
      }
    }
    for (let i = 0; i < W * H; i++) {
      const k = cv[i]!
      if (k) buf[i] = k === 3 ? P.treeLit : k === 2 ? P.tree : mix(buf[i]!, P.treeShade, 0.6)
    }
  }

  /** Houses from above, in villages and round a station: a pitched roof in a garden; a window lit by night. */
  private housesAbove(px: Painter, P: Pal, kn: number): void {
    const W = px.w
    const H = px.h
    const buf = px.px
    const GX = 5
    const GV = 4
    const av = this.rowV[this.noseY]!
    for (let gv = Math.floor(this.rowV[H - 1]! / GV) - 1; gv <= Math.floor(this.rowV[0]! / GV) + 1; gv++) {
      const S = gv * GV * 3
      const z = Math.floor(S / ZONE)
      const zone = zoneOf(z)
      if (zone !== VILLAGE && zone !== STATION) continue
      if (crosses(zone) && Math.abs(S - z * ZONE - CROSS) < 12) continue
      const y0 = this.noseY - (gv * GV + 2 - av)
      for (let gx = 0; gx <= Math.floor(W / GX); gx++) {
        const x0 = gx * GX + 1
        if (Math.abs(x0 + 1 - this.tx - 3) < 13) continue
        if (hash(gx, gv, 31) > (zone === STATION ? 0.6 : 0.45)) continue
        const slate = hash(gx, gv, 32) < 0.35
        const lit = slate ? mix(P.slate, P.wall, 0.25) : P.roof
        const ridge = slate ? P.slate : mix(P.roof, P.roofDark, 0.5)
        const dark = slate ? mix(P.slate, 0, 0.3) : P.roofDark
        for (let dy = 0; dy < 2; dy++) {
          const y = y0 + dy
          if (y < 0 || y >= H) continue
          for (let i = 0; i < 3; i++) if (x0 + i < W) buf[y * W + x0 + i] = i === 0 ? lit : i === 1 ? ridge : dark
        }
        if (kn > 0.3 && hash(gx, gv, 33) < 0.6 && y0 + 1 >= 0 && y0 + 1 < H && x0 + 3 < W) px.set(x0 + 3, y0 + 1, P.houseWin, true)
      }
    }
  }

  /** The loco or a carriage from above: row `r` back from the nose, column `i` (0..3) across. */
  private trainAbove(r: number, i: number, P: Pal): number {
    const edge = i === 0 || i === 3
    if (r < A_LOCO) {
      if (r === 0) return edge ? P.lamp : P.yellow
      if (r === 1) return P.yellow
      if (r === 2) return P.glass
      if (edge) return r === 3 ? P.glass : P.loco
      if (r === 7 && i === 1) return P.grille
      return r === 5 || r === 6 || r === 8 || r === 9 ? P.vent : P.carRoof
    }
    const rr = r - A_LOCO - A_GAP
    if (rr < 0) return i === 1 || i === 2 ? P.bogie : -1
    const cr = rr % (A_CAR + A_GAP)
    if (cr >= A_CAR) return i === 1 || i === 2 ? P.bogie : -1
    if (edge) return cr === 0 || cr === A_CAR - 1 ? P.cream : (cr & 1) === 1 ? P.sideGlass : P.cream
    return cr === 3 || cr === 6 ? P.vent : P.carRoof
  }

  /** A companion from above: its cab, then the trailer, its livery along the sides. */
  private unitAbove(r: number, i: number, livery: number, P: Pal): number {
    const edge = i === 0 || i === 3
    if (r === A_CAR) return i === 1 || i === 2 ? P.bogie : -1
    const cr = r < A_CAR ? r : r - A_CAR - A_GAP
    if (r < A_CAR && cr === 0) return edge ? P.lamp : P.yellow
    if (r < A_CAR && cr === 1) return P.glass
    if (edge) return cr === 0 || cr === A_CAR - 1 ? livery : (cr & 1) === 1 ? mix(livery, P.sideGlass, 0.7) : livery
    return cr === 3 || cr === 6 ? P.vent : P.carRoof
  }

  /** Window light spilling onto the ground beside a carriage, by night. */
  private spill(px: Painter, P: Pal, xl: number, xr: number, y: number, cr: number, kn: number): void {
    if (cr <= 0 || cr >= A_CAR - 1 || (cr & 1) === 0) return
    const buf = px.px
    const W = px.w
    const a = q(0.45 * kn, 4)
    if (xl >= 0 && xl < W && !this.solid[y * W + xl]) buf[y * W + xl] = mix(buf[y * W + xl]!, P.spill, a)
    if (xr >= 0 && xr < W && !this.solid[y * W + xr]) buf[y * W + xr] = mix(buf[y * W + xr]!, P.spill, a)
  }

  /** Smoke from above: dark puffs left behind the loco, drifting on the wind, swelling as they rise. */
  private smokeAbove(px: Painter, P: Pal): void {
    const W = px.w
    const H = px.h
    const buf = px.px
    for (const p of this.puffs) {
      const cx = this.tx - 0.5 + p.side * 2
      const cy = this.noseY + (this.pos - p.s) / 3
      const r = p.r * (0.8 + p.up * 0.12)
      const ry = r * 0.55
      const a = q(p.life * (p.wisp ? 0.4 : 0.95), 4)
      if (a <= 0) continue
      for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(H - 1, Math.ceil(cy + ry)); y++)
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) {
          const dx = (x + 0.5 - cx) / r
          const dy = (y + 0.5 - cy) / ry
          if (dx * dx + dy * dy > 1) continue
          buf[y * W + x] = mix(buf[y * W + x]!, p.wisp ? P.haze : P.soot, a)
        }
    }
  }
}

export const trainScene = defineScene({
  name: 'train',
  blurb: 'a train through the countryside, faster with the work',
  night: true,
  aliases: ['rail', 'railway'],
  make: seed => new Train(seed),
})
