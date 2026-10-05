// REVISION: flow-v84-desktop-shades
//
// A scene's frame as one SVG for Claude desktop, which has no Raster: the
// cell grid is rasterized to a small RGBA image, 2 × 4 pixels a cell (each
// quadrant, braille dot and eighth of a block lands on its own pixels), and
// wrapped as a PNG in an <image> the desktop scales up with square pixels.
// The desktop draws an Svg's markup as an image, so a frame is one string,
// at most 131,072 characters: a frame that would be bigger is drawn at
// 2 × 2 a cell, then 1 × 2, then 1 × 1, then one pixel for every few cells.
// Pure: no engine imports, unit-tested directly.

import { Cells, DEFAULT_COLOR } from './cells'
import { BRAILLE, mix, QUAD } from './pixels'

/** The Svg element's limit on its markup. */
export const SVG_LIMIT = 131_072

/** A frame's pixels: RGBA, row by row. */
export type Pixels = { width: number; height: number; rgba: Uint8Array }

const QUAD_MASK = new Map<number, number>()
QUAD.forEach((cp, mask) => QUAD_MASK.set(cp, mask))

/**
 * How strongly a shade glyph shows its foreground over its background. A
 * terminal draws ░▒▓ as a fine texture that reads, a step back, as a dimmer
 * color; at 2 × 4 pixels a cell a dither of them reads as noise instead, so
 * desktop fills the whole cell, blended.
 */
const SHADE = new Map<number, number>([
  [0x2591, 0.3], // ░
  [0x2592, 0.55], // ▒
  [0x2593, 0.8], // ▓
])

/**
 * The scenes' line and symbol glyphs, drawn as small shapes in the cell's
 * 2 × 4 pixels (bit x + 2y, rows top to bottom).
 */
const SHAPES = new Map<number, number>([
  [0x2500, 0b00110000], // ─ a line through the middle
  [0x2502, 0b01010101], // │ a line down the cell
  [0x2571, 0b01011010], // ╱ bottom left to top right
  [0x2572, 0b10100101], // ╲ top left to bottom right
  [0x00b7, 0b00000100], // · a star: one pixel
  [0x002a, 0b00111100], // * a bright star
  [0x25cf, 0b00111100], // ● a light
  [0x2663, 0b01111111], // ♣ a tree: crown and trunk
  [0x2302, 0b11111100], // ⌂ a house
  [0x007e, 0b00100100], // ~ a ripple
  [0x0076, 0b00001100], // v a bird, wings down
  [0x005e, 0b00110000], // ^ a bird, wings up
])

/**
 * Which of a cell's 8 pixels (bit x + 2y) a glyph's foreground covers, or -1
 * for a glyph with no block shape (text, symbols): drawn as a soft dot.
 */
export function coverage(cp: number): number {
  if (cp === 0x20 || cp === 0xa0) return 0
  if (cp === 0x2588) return 0xff
  const q = QUAD_MASK.get(cp)
  if (q !== undefined) {
    // Quadrants: bit 1 upper left, 2 upper right, 4 lower left, 8 lower right.
    let m = 0
    if (q & 1) m |= 0b0101
    if (q & 2) m |= 0b1010
    if (q & 4) m |= 0b0101 << 4
    if (q & 8) m |= 0b1010 << 4
    return m
  }
  if (cp > 0x2580 && cp < 0x2588) {
    // ▁ … ▇: the bottom k/8, to the nearest pixel row.
    const rows = Math.round((cp - 0x2580) / 2)
    return rows <= 0 ? 0 : (0xff << ((4 - rows) * 2)) & 0xff
  }
  if (cp > 0x2588 && cp < 0x2590) {
    // ▉ … ▏: the left (8-k)/8.
    const columns = Math.round((0x2590 - cp) / 4)
    return columns >= 2 ? 0xff : columns === 1 ? 0b01010101 : 0
  }
  const shape = SHAPES.get(cp)
  if (shape !== undefined) return shape
  if (cp >= 0x2800 && cp <= 0x28ff) {
    const dots = cp - 0x2800
    let m = 0
    for (let x = 0; x < 2; x++) for (let y = 0; y < 4; y++) if (dots & BRAILLE[x]![y]!) m |= 1 << (x + 2 * y)
    return m
  }
  return -1
}

/**
 * The grid as pixels, `sx` × `sy` a cell (2 × 4, 2 × 2, 1 × 2 or 1 × 1). At
 * the smaller sizes a pixel blends the 2 × 4 pixels it covers, so a sparse
 * glyph (░, a braille dot) dims rather than drops out; the terminal's own
 * color is transparent.
 */
export function gridPixels(grid: Cells, sx = 2, sy = 4): Pixels {
  const width = grid.columns * sx
  const height = grid.rows * sy
  const rgba = new Uint8Array(width * height * 4)
  const put = (px: number, py: number, color: number, alpha = 255) => {
    if (color === DEFAULT_COLOR) return
    const o = (py * width + px) * 4
    rgba[o] = (color >> 16) & 255
    rgba[o + 1] = (color >> 8) & 255
    rgba[o + 2] = color & 255
    rgba[o + 3] = alpha
  }
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.columns; c++) {
      const i = r * grid.columns + c
      const fg = grid.foreground(i)
      const bg = grid.background(i)
      const cp = grid.codePoint(i)
      const shade = SHADE.get(cp)
      if (shade !== undefined) {
        // A shade: the whole cell, its foreground blended over its background.
        const color = bg === DEFAULT_COLOR ? fg : mix(bg, fg, shade)
        const alpha = bg === DEFAULT_COLOR ? Math.round(255 * shade) : 255
        for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) put(c * sx + x, r * sy + y, color, alpha)
        continue
      }
      const m = coverage(cp)
      for (let y = 0; y < sy; y++) {
        for (let x = 0; x < sx; x++) {
          const px = c * sx + x
          const py = r * sy + y
          // The 2 × 4 pixels this one covers.
          const x0 = (x * 2) / sx
          const x1 = ((x + 1) * 2) / sx
          const y0 = (y * 4) / sy
          const y1 = ((y + 1) * 4) / sy
          if (m >= 0) {
            let lit = 0
            for (let by = y0; by < y1; by++) for (let bx = x0; bx < x1; bx++) if (m & (1 << (bx + 2 * by))) lit++
            const f = lit / ((x1 - x0) * (y1 - y0))
            if (f === 0) put(px, py, bg)
            else if (f === 1 || bg === fg) put(px, py, fg)
            else if (bg === DEFAULT_COLOR) put(px, py, fg, Math.round(255 * f))
            else if (fg === DEFAULT_COLOR) put(px, py, bg, Math.round(255 * (1 - f)))
            else put(px, py, mix(bg, fg, f))
          } else {
            // A glyph with no block shape: a soft dot in the middle rows.
            put(px, py, bg)
            if (y0 < 3 && y1 > 1) put(px, py, fg, bg === DEFAULT_COLOR ? 190 : 255)
          }
        }
      }
    }
  }
  return { width, height, rgba }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff
  for (let i = from; i < to; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 255]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * The pixels as a PNG: RGBA, no filter, deflate's stored blocks (the mod
 * environment has no compression). Small scenes make small files anyway.
 */
export function encodePng({ width, height, rgba }: Pixels): Uint8Array {
  const rowBytes = width * 4 + 1
  const raw = rowBytes * height
  const blocks = Math.max(1, Math.ceil(raw / 65535))
  const idat = 2 + raw + blocks * 5 + 4
  const out = new Uint8Array(8 + 25 + 12 + idat + 12)
  const view = new DataView(out.buffer)
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  let o = 8
  const chunk = (type: string, length: number, fill: () => void) => {
    view.setUint32(o, length)
    const start = o + 4
    for (let k = 0; k < 4; k++) out[start + k] = type.charCodeAt(k)
    o = start + 4
    fill()
    view.setUint32(o, crc32(out, start, o))
    o += 4
  }
  chunk('IHDR', 13, () => {
    view.setUint32(o, width)
    view.setUint32(o + 4, height)
    out.set([8, 6, 0, 0, 0], o + 8) // 8 bits, RGBA, deflate, no filter, no interlace
    o += 13
  })
  chunk('IDAT', idat, () => {
    out[o++] = 0x78 // zlib: deflate, 32K window
    out[o++] = 0x01
    let a = 1
    let b = 0
    let left = raw
    let src = 0 // position in the filtered stream (a 0 filter byte before each row)
    while (left > 0) {
      const n = Math.min(65535, left)
      left -= n
      out[o++] = left === 0 ? 1 : 0
      out[o++] = n & 255
      out[o++] = n >> 8
      out[o++] = ~n & 255
      out[o++] = (~n >> 8) & 255
      for (let k = 0; k < n; k++, src++) {
        const row = Math.floor(src / rowBytes)
        const col = src - row * rowBytes
        const byte = col === 0 ? 0 : rgba[row * width * 4 + col - 1]!
        out[o++] = byte
        a = (a + byte) % 65521
        b = (b + a) % 65521
      }
    }
    view.setUint32(o, ((b << 16) | a) >>> 0)
    o += 4
  })
  chunk('IEND', 0, () => {})
  return out
}

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** The SVG for one frame, `width` × `height` CSS pixels when given (else the image's own). */
function wrap(png: string, p: Pixels): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${p.width} ${p.height}" preserveAspectRatio="none">` +
    `<image width="${p.width}" height="${p.height}" preserveAspectRatio="none" image-rendering="pixelated" ` +
    `style="image-rendering:pixelated" href="data:image/png;base64,${png}"/></svg>`
  )
}

/** The size of a frame's SVG for an image this big: base64 is 4/3 of the bytes, and a stored PNG is the pixels plus a little. */
function estimate(width: number, height: number): number {
  return Math.ceil(((width * 4 + 1) * height * 4) / 3) + 600
}

/** Every `k`th cell each way: a grid small enough for one pixel a cell. */
function thin(grid: Cells, k: number): Cells {
  const columns = Math.ceil(grid.columns / k)
  const rows = Math.ceil(grid.rows / k)
  const out = new Cells(columns, rows)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const i = r * k * grid.columns + c * k
      out.set(r * columns + c, grid.codePoint(i), grid.foreground(i), grid.background(i))
    }
  }
  return out
}

/** The frame as SVG markup inside the limit: 2 × 4 pixels a cell, fewer when that would be too big. */
export function frameSvg(grid: Cells): string {
  for (const [sx, sy] of [
    [2, 4],
    [2, 2],
    [1, 2],
    [1, 1],
  ] as const) {
    if (estimate(grid.columns * sx, grid.rows * sy) > SVG_LIMIT) continue
    const p = gridPixels(grid, sx, sy)
    const svg = wrap(base64(encodePng(p)), p)
    if (svg.length <= SVG_LIMIT) return svg
  }
  // Bigger still: one pixel for every k × k cells (the desktop scales it to the site's size).
  let k = 2
  while (estimate(Math.ceil(grid.columns / k), Math.ceil(grid.rows / k)) > SVG_LIMIT) k++
  const p = gridPixels(thin(grid, k), 1, 1)
  return wrap(base64(encodePng(p)), p)
}
