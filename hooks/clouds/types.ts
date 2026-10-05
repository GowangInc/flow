// REVISION: flow-v42-renderer-polish
//
// The balloon's clouds are drawn by a painter (layered.ts), asked cell by
// cell for the world rows the clouds live in. Painters are pure and
// deterministic in (x, y): the world scrolls past the balloon, so a cell must
// look the same every time it is asked about the same place (animate with
// `t` slowly, if at all).

/** One cell of cloud: a glyph, its color, and optionally its background. */
export type CloudCell = {
  /** A printable, width-1 BMP code point (blocks, shades, braille, box drawing). */
  glyph: number
  /** 0xRRGGBB. */
  fg: number
  /** 0xRRGGBB; absent, the sky's own color for this row shows behind the glyph. */
  bg?: number
}

export type CloudContext = {
  /** World column, already shifted by the cloud drift: one speed for the whole band, so clouds stay upright. */
  x: number
  /** World row: 0 at the ground, up to the top of the cloud band (CLOUDS_TO). */
  y: number
  /** The sky's background color at this row (0xRRGGBB). */
  sky: number
  /** Frame counter (~14 per second while it burns). */
  t: number
}

export interface CloudPainter {
  /** The painter's name. */
  readonly name: string
  /** One line describing the look. */
  readonly description: string
  /** The cell at a world position, or undefined for open sky. */
  cell(c: CloudContext): CloudCell | undefined
}
