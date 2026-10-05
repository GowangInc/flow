// REVISION: flow-v66-desktop
//
// Flow on Claude desktop, which has no Raster: a `Client` surface module that
// runs the scene on the desktop's own frame clock and draws each row as runs
// of colored Text (foreground and background, so quadrant glyphs keep their
// two colors). The hooks module only hands it the dials (scene, level,
// company, tint, night) as props when they change; every frame is stepped
// and drawn here, with no traffic back.

import type { ClientModule, ClientSurface, RenderElement } from 'claude-code'

import { DEFAULT_COLOR, type Cells } from './cells'
import { makeScene, type Scene, type SceneName, type Tint } from './styles'

export type DesktopProps = {
  style: SceneName
  strength: number
  coverageBoost: number
  tint: Tint
  night: boolean
}

const FRAME_MS = 70 // ~14 fps while busy
const CALM_MS = 125 // a low glow or off: 8 fps
const SPACE = 0x20
const FULL = 0x2588
/**
 * A drawn tree must stay under 100,000 characters serialized (or the instance
 * unmounts). Each run costs its text plus about this much for the element
 * and its two colors (measured: ~90); past the budget, colors are coarsened
 * so runs merge, and past that the scene is laid out in fewer rows.
 */
const RUN_COST = 100
const BUDGET = 85_000
/** Successively coarser colors, each dropping more low bits per channel. */
const MASKS = [0xffffff, 0xfcfcfc, 0xf8f8f8]

/** One instance's scenes (one per style, so a switch resumes), kept off `state`. */
type Instance = {
  scenes: Map<SceneName, Scene>
  props: DesktopProps
  ticks: number
  since: number
  /** The most rows the scene is laid out in: fewer than the region when a frame would be too big. */
  rowCap: number
  /** The scene and region size the cap was found for. */
  size: string
}
const instances = new WeakMap<object, Instance>()

/** Point the instance's scene at its dials and lay it out at the region's size. */
function dial(inst: Instance, columns: number, rows: number): Scene {
  const { props } = inst
  let s = inst.scenes.get(props.style)
  if (!s) inst.scenes.set(props.style, (s = makeScene(props.style)))
  s.strength = props.strength
  s.coverageBoost = props.coverageBoost
  s.tint = props.tint
  s.night = props.night
  s.ensure(Math.max(1, columns), Math.max(2, Math.min(rows, inst.rowCap)))
  return s
}

const hex = (rgb: number) => `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`

export type Run = { text: string; color?: string; backgroundColor?: string }

/**
 * One row of the grid as runs of same-colored text. A full block is drawn as
 * a space on its color (a background fills the line's whole height where a
 * glyph may not), and a space's foreground doesn't split a run.
 */
export function rowRuns(grid: Cells, row: number, mask = 0xffffff): Run[] {
  const runs: Run[] = []
  let text = ''
  let fg = -1
  let bg = -1
  const flush = () => {
    if (!text) return
    const run: Run = { text }
    if (fg >= 0) run.color = hex(fg)
    if (bg >= 0) run.backgroundColor = hex(bg)
    runs.push(run)
    text = ''
  }
  for (let x = 0; x < grid.columns; x++) {
    const i = row * grid.columns + x
    let cp = grid.codePoint(i)
    let f = grid.foreground(i)
    let b = grid.background(i)
    if (cp === FULL) {
      cp = SPACE
      b = f
    }
    if (cp === SPACE) f = DEFAULT_COLOR
    const cf = f === DEFAULT_COLOR ? -1 : f & mask
    const cb = b === DEFAULT_COLOR ? -1 : b & mask
    if (cf !== fg || cb !== bg) {
      flush()
      fg = cf
      bg = cb
    }
    text += String.fromCodePoint(cp)
  }
  flush()
  return runs
}

/**
 * Every row's runs, coarsened until the whole frame fits the budget. Still
 * too big at the coarsest, it keeps the bottom rows that fit (the scene's
 * ground) and says how many rows would fit next time.
 */
export function frameRuns(grid: Cells): { rows: Run[][]; fitRows: number } {
  let rows: Run[][] = []
  let cost = 0
  for (const mask of MASKS) {
    rows = []
    cost = 0
    for (let r = 0; r < grid.rows; r++) {
      const runs = rowRuns(grid, r, mask)
      for (const run of runs) cost += run.text.length + RUN_COST
      rows.push(runs)
    }
    if (cost <= BUDGET) return { rows, fitRows: grid.rows }
  }
  const fit: Run[][] = []
  let kept = 0
  for (let r = rows.length - 1; r >= 0; r--) {
    const rowCost = rows[r]!.reduce((n, run) => n + run.text.length + RUN_COST, 0)
    if (kept + rowCost > BUDGET) break
    kept += rowCost
    fit.unshift(rows[r]!)
  }
  return { rows: fit, fitRows: Math.max(2, Math.floor((grid.rows * BUDGET * 0.9) / cost)) }
}

const DesktopScene: ClientModule<DesktopProps, number> = (props, surface: ClientSurface<number>) => {
  const { Box, Text } = surface.elements
  let inst = instances.get(surface)
  if (!inst) {
    inst = { scenes: new Map(), props, ticks: 0, since: 0, rowCap: Infinity, size: '' }
    instances.set(surface, inst)
    const self = inst
    surface.every(FRAME_MS, () => {
      self.since += FRAME_MS
      const calm = self.props.strength <= 1 && self.props.tint === 'normal'
      if (calm && self.since < CALM_MS) return
      self.since = 0
      if (surface.columns < 1 || surface.rows < 1) return
      dial(self, surface.columns, surface.rows).step()
      surface.setState(++self.ticks)
    })
  }
  // A new scene or region gets the full height again (re-capped if it must be).
  const size = `${props.style} ${surface.columns}x${surface.rows}`
  if (size !== inst.size) {
    inst.size = size
    inst.rowCap = Infinity
  }
  inst.props = props
  if (surface.columns < 1 || surface.rows < 1) return <Box />

  const grid = dial(inst, surface.columns, surface.rows).grid()
  const frame = frameRuns(grid)
  if (frame.fitRows < grid.rows) inst.rowCap = frame.fitRows
  const rows: RenderElement[] = []
  for (const [r, runs] of frame.rows.entries()) {
    rows.push(
      <Box key={`r${r}`} flexDirection="row">
        {runs.map(run => (
          <Text color={run.color} backgroundColor={run.backgroundColor}>
            {run.text}
          </Text>
        ))}
      </Box>,
    )
  }
  // Fewer rows than the region (a capped tall pane): the scene sits at the bottom.
  return (
    <Box flexDirection="column" justifyContent="flex-end" height={surface.rows}>
      {rows}
    </Box>
  )
}

export default DesktopScene
