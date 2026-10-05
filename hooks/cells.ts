// REVISION: flow-v75-tall-by-rows
//
// Shared by the styles: a small PRNG and the cell grid every harness draws
// from (packed for Claude Code's Raster, rendered as ANSI lines for pi).

/** xorshift32: only the flicker depends on it. */
export class Rng {
  private s: number

  constructor(seed = Date.now()) {
    this.s = (seed | 1) >>> 0 || 0x9e3779b9
  }

  int(): number {
    let x = this.s
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.s = x >>> 0
    return this.s
  }

  /** A float in [0, 1). */
  f(): number {
    return this.int() / 0x1_0000_0000
  }
}

/**
 * Whether a region gets a scene's tall layout (the spine's, a pane's) rather
 * than its band layout. By rows, not by shape: the band layouts are made for
 * the 5-row band, and a pane wider than it is tall (a desktop pane dragged
 * wide) is still far too tall for them.
 */
export function isTall(columns: number, rows: number): boolean {
  return rows > 8 || rows > columns
}

/** The terminal's own color (Raster's bit-24 marker): transparent. */
export const DEFAULT_COLOR = 0x01000000
const SPACE = 0x20

const B64 = new TextEncoder().encode('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/')
const PAD = 0x3d // '='
const ascii = new TextDecoder()

/** Standard padded base64: native where the runtime has it, else a table. */
function toBase64(bytes: Uint8Array): string {
  const anyBytes = bytes as Uint8Array & { toBase64?: () => string }
  if (typeof anyBytes.toBase64 === 'function') return anyBytes.toBase64()
  const n = bytes.length
  const out = new Uint8Array(Math.ceil(n / 3) * 4)
  let o = 0
  let i = 0
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out[o++] = B64[v >> 18]!
    out[o++] = B64[(v >> 12) & 63]!
    out[o++] = B64[(v >> 6) & 63]!
    out[o++] = B64[v & 63]!
  }
  if (i < n) {
    const v = (bytes[i]! << 16) | ((i + 1 < n ? bytes[i + 1]! : 0) << 8)
    out[o++] = B64[v >> 18]!
    out[o++] = B64[(v >> 12) & 63]!
    out[o++] = i + 1 < n ? B64[(v >> 6) & 63]! : PAD
    out[o++] = PAD
  }
  return ascii.decode(out)
}

/** A columns × rows grid of Raster cells, packed as RasterProps wants. */
export class Cells {
  readonly words: Uint32Array

  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    this.words = new Uint32Array(columns * rows * 3)
  }

  set(i: number, codePoint: number, fg: number, bg: number = DEFAULT_COLOR): void {
    this.words[i * 3] = codePoint
    this.words[i * 3 + 1] = fg
    this.words[i * 3 + 2] = bg
  }

  blank(i: number): void {
    this.set(i, SPACE, DEFAULT_COLOR, DEFAULT_COLOR)
  }

  codePoint(i: number): number {
    return this.words[i * 3]!
  }

  foreground(i: number): number {
    return this.words[i * 3 + 1]!
  }

  background(i: number): number {
    return this.words[i * 3 + 2]!
  }

  /**
   * The one color a cell mostly shows, to paint something in front of it
   * with: a full block shows its foreground, anything else its background.
   */
  behind(i: number): number {
    return this.codePoint(i) === 0x2588 ? this.foreground(i) : this.background(i)
  }

  encode(): string {
    return toBase64(new Uint8Array(this.words.buffer))
  }
}
