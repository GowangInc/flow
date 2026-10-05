// REVISION: flow-v35-pi-backgrounds
//
// The shared cell grid as terminal lines: runs of same-colored glyphs in
// 24-bit ANSI (foreground and background; a default color is left to the
// terminal), each line reset at its end (pi resets styling per line too).
// Every line is exactly `grid.columns` cells wide.

import { DEFAULT_COLOR, type Cells } from '../hooks/cells'

const RESET = '\x1b[0m'
const rgb = (c: number) => `${(c >> 16) & 255};${(c >> 8) & 255};${c & 255}`

export function gridToAnsi(grid: Cells): string[] {
  const lines: string[] = []
  for (let r = 0; r < grid.rows; r++) {
    let line = ''
    let fg = DEFAULT_COLOR
    let bg = DEFAULT_COLOR
    for (let x = 0; x < grid.columns; x++) {
      const i = r * grid.columns + x
      const f = grid.foreground(i)
      const b = grid.background(i)
      if (f !== fg || b !== bg) {
        // Going back to a terminal default needs a reset, then the other side again.
        if ((f === DEFAULT_COLOR && fg !== DEFAULT_COLOR) || (b === DEFAULT_COLOR && bg !== DEFAULT_COLOR)) {
          line += RESET
          fg = DEFAULT_COLOR
          bg = DEFAULT_COLOR
        }
        if (f !== fg) line += `\x1b[38;2;${rgb(f)}m`
        if (b !== bg) line += `\x1b[48;2;${rgb(b)}m`
        fg = f
        bg = b
      }
      line += String.fromCodePoint(grid.codePoint(i))
    }
    lines.push(fg === DEFAULT_COLOR && bg === DEFAULT_COLOR ? line : line + RESET)
  }
  return lines
}
