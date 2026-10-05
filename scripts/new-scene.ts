// REVISION: flow-v81-scene-tools
//
// Starts a new scene: writes hooks/<name>.ts from a template that already
// moves with the level, shows the tints and (with --night) has a night,
// lists it in SCENES and in plugin.json. Not part of the mod (Node).
//
//   npm run new-scene -- aurora --blurb "curtains of light that ripple faster with the work" --night
//
// Then: `npm run preview -- aurora`, edit hooks/aurora.ts, `npm run check`.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { STYLES } from '../hooks/styles'

const args = process.argv.slice(2)
const name = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--blurb')
const blurbAt = args.indexOf('--blurb')
const blurb = blurbAt >= 0 ? args[blurbAt + 1] : undefined
const night = args.includes('--night')

function fail(why: string): never {
  console.error(`new-scene: ${why}`)
  console.error('usage: npm run new-scene -- <name> --blurb "what it shows" [--night]')
  process.exit(1)
}

if (!name) fail('give the scene a name')
if (!/^[a-z][a-z0-9]*$/.test(name)) fail(`"${name}": use lowercase letters and digits, starting with a letter`)
if ((STYLES as readonly string[]).includes(name)) fail(`there is already a scene called "${name}"`)
const hooks = join(import.meta.dirname, '..', 'hooks')
const file = join(hooks, `${name}.ts`)
if (existsSync(file)) fail(`hooks/${name}.ts already exists`)

const Class = name[0]!.toUpperCase() + name.slice(1)
const defName = `${name}Scene`

writeFileSync(
  file,
  `// REVISION: flow-v1-${name}
//
// ${Class} (the \`${name}\` scene): ${blurb ?? 'TODO: what it shows, and how it changes with the level'}.
// Painted as pixels (2 × 2 a cell) by PixelScene, which eases the level${night ? ' and\n// the night' : ''}, folds the pixels into glyphs and blanks it all at level 0.

import { CLEAR, PixelScene, type Dials, type Painter } from './pixel-scene'
import { defineScene } from './scene-def'
import { hash, mix } from './pixels'
${night ? "import { NIGHT_HORIZON, NIGHT_ZENITH, STAR } from './night'\n" : ''}
/** The colors, by day${night ? ' (night comes from night.ts, shared by every scene)' : ''}. */
const C = {
  low: 0x0b3d2e,
  high: 0x58f0a8,
  smoke: 0x6a7480,
  blue: 0x2a7bff,
}

export class ${Class} extends PixelScene {
  paint(px: Painter, d: Dials): void {
    // A band of light whose height and speed follow the level (1 calm, 10 the busiest).
    const busy = d.level / 10
    const tinted = d.tint === 'smoke' ? C.smoke : d.tint === 'blue' ? C.blue : C.high
    for (let x = 0; x < px.w; x++) {
      const wave = Math.sin(x * 0.15 + d.t * (0.02 + busy * 0.2)) * 0.5 + 0.5
      const top = px.h * (1 - (0.2 + 0.7 * busy) * wave)
      for (let y = Math.floor(top); y < px.h; y++) {
        // Quantized to 8 steps: Raster paints at most 1024 color pairs a frame.
        const k = Math.round(((y - top) / Math.max(1, px.h - top)) * 8) / 8
        px.set(x, y, mix(tinted, C.low, k))
      }
    }
${night ? `    // At night: a dark sky behind it, and stars as braille dots.
    if (d.night > 0) {
      for (let y = 0; y < px.h; y++)
        for (let x = 0; x < px.w; x++)
          if (px.get(x, y) === CLEAR) px.set(x, y, mix(NIGHT_ZENITH, NIGHT_HORIZON, y / px.h))
      for (let i = 0; i < px.dw * px.dh * 0.004 * d.night; i++)
        px.dot(hash(i, 1) * px.dw, hash(i, 2) * px.dh * 0.5, STAR)
    }
` : ''}  }
}

export const ${defName} = defineScene({
  name: '${name}',
  blurb: '${(blurb ?? `TODO: a few words on what ${name} shows`).replace(/'/g, "\\'")}',${night ? '\n  night: true,' : ''}
  make: seed => new ${Class}(seed),
})
`,
)

// List it in SCENES: an import beside the others, an entry at the end.
const stylesPath = join(hooks, 'styles.ts')
let styles = readFileSync(stylesPath, 'utf8')
const imports = [...styles.matchAll(/^import \{ [^}]*Scene[^}]* \} from '\.\/[a-z-]+'\n/gm)]
const last = imports.at(-1)!
const at = last.index + last[0].length
styles = `${styles.slice(0, at)}import { ${defName} } from './${name}'\n${styles.slice(at)}`
styles = styles.replace(/(export const SCENES = \[\n(?:  \w+,\n)+)(\] as const)/, `$1  ${defName},\n$2`)
writeFileSync(stylesPath, styles)

console.log(`new-scene: wrote hooks/${name}.ts and listed it in SCENES`)
// The registry changed on disk: sync plugin.json in a fresh process so it sees it.
execFileSync('npx', ['tsx', join(import.meta.dirname, 'sync-manifest.ts')], { stdio: 'inherit' })
console.log(`
next:
  npm run preview -- ${name}     see it at levels 1, 5 and 10, band and spine${night ? ', day and night' : ''}, each tint
  npm run check -- ${name}       colour pairs and timing
  claude --plugin-dir .         then /flow ${name}
  README.md                     add a row to the scenes table`)
