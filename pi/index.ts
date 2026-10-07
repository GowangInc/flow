// REVISION: flow-v124-tool-spark
//
// Flow for pi (badlogic/pi-mono), by Rob Macrae: the same ambient
// scenes as the Claude Code mod, in a widget above pi's editor. pi's events
// drive the same activity model, and the shared cell grid is drawn as 24-bit
// ANSI lines, stepped ~14 fps while busy and 8 fps when calm.
//
//   agent_start / agent_end       a turn lifts it, then it settles to idle
//   turn_start                    a model step; ctx.thinkingLevel sets the floor
//   message_update (deltas)       streamed text/thinking keeps it going
//   tool_call                     edits push it, commands spark, reads and other tools flicker
//   tool_result (isError, bash)   a failed command shows as smoke
//   session_compact               so does a compaction
//   ctx.getContextUsage()         a nearly-full context shows as blue
//
// `/flow` takes the same arguments
// as in Claude Code, day and night following the local clock unless pinned.
// As there, each session keeps its own settings: `/flow` changes the session
// it runs in, kept in the session itself (a `flow` entry, never sent to the
// model), so resuming or forking it brings them back. ~/.pi/agent/flow.json
// holds the defaults new sessions start with (read from the old vista.json
// or ascii-fire.json until that exists), read afresh before `/flow` compares
// with it (another pi session may have saved); `/flow save` writes it. An
// older pi without session entries keeps one set for every session, in that
// file, as before (session.ts). pi has no built-in subagents, so they never add to the scene here,
// and no side panes, so there is no spine.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { Activity } from '../hooks/activity'
import { FRAME_MS, SceneDriver } from '../hooks/scene'
import { changedText, changesFor, helpText, parseFlowArgs, readConfig, statusText, storedValue, type FlowConfig } from '../hooks/settings'
import { gridToAnsi } from './ansi'
import { COMMAND_TOOLS, effortOf, FLOW_ENTRY, piLinesWritten, READ_TOOLS } from './mapping'
import { PiSettings, type SessionEntries } from './session'
import type { PiApi, PiComponent, PiContext, PiTui } from './types'

const KEY = 'flow'
const ROWS = 5
const CONTEXT_EVERY_MS = 5000
/** How often flow.json is read afresh while the scene runs: another session's save shows here as this one's own. */
const DEFAULTS_EVERY_MS = 30_000
const SETTINGS = join(homedir(), '.pi', 'agent', 'flow.json')
/** Where the settings lived before, newest first: as vista, then as ascii-fire. */
const OLD_SETTINGS = [join(homedir(), '.pi', 'agent', 'vista.json'), join(homedir(), '.pi', 'agent', 'ascii-fire.json')]

async function loadSettings(): Promise<FlowConfig> {
  for (const file of [SETTINGS, ...OLD_SETTINGS]) {
    try {
      return readConfig(JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>)
    } catch {
      // Not there (or unreadable): try the next, then the defaults.
    }
  }
  return readConfig(undefined)
}

/**
 * Write just these changes into the settings file, over what is there now:
 * another pi session's changes to other settings survive.
 */
async function saveSettings(changes: Partial<FlowConfig>): Promise<void> {
  // The settings so far: flow.json, or before the first save since a
  // rename, an old file (else its settings would be dropped).
  let stored: Record<string, unknown> = {}
  for (const file of [SETTINGS, ...OLD_SETTINGS]) {
    try {
      stored = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
      break
    } catch {
      // Not there (or unreadable): try the next, else start afresh.
    }
  }
  for (const [k, v] of Object.entries(changes) as [keyof FlowConfig, FlowConfig[keyof FlowConfig]][]) {
    stored[k] = storedValue(k, v)
  }
  await mkdir(dirname(SETTINGS), { recursive: true })
  await writeFile(SETTINGS, JSON.stringify(stored, null, 2) + '\n')
}

export default function flow(pi: PiApi) {
  const activity = new Activity()
  const driver = new SceneDriver(readConfig(undefined), activity)
  const cfg = driver.cfg
  /** The defaults (flow.json) and this session's own settings over them. */
  const settings = new PiSettings(cfg, { load: loadSettings, save: saveSettings })

  /** The session's entries, where this pi keeps them: else every session shares flow.json, as before. */
  const entriesOf = (ctx: PiContext): SessionEntries | undefined => {
    const manager = ctx.sessionManager
    if (typeof pi.appendEntry !== 'function' || !manager) return undefined
    return { branch: () => manager.getBranch(), keep: data => pi.appendEntry?.(FLOW_ENTRY, data) }
  }
  /** A read of flow.json under way (from the frame loop). */
  let refreshing = false

  let ctxRef: PiContext | undefined
  let tui: PiTui | undefined
  let width = 0
  let lines: string[] = []
  let isMounted = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let sinceContext = 0
  let sinceDefaults = 0

  /** Read the local clock (pi runs on this machine, so its time is the person's). */
  const readClock = () => {
    const d = new Date()
    driver.clock = { hour: d.getHours(), minute: d.getMinutes() }
  }

  /** Point the current scene at this frame's dials and size. */
  const dial = () => {
    const f = driver.dial()
    if (width > 0) f.ensure(width, ROWS)
    return f
  }

  const widget = (t: PiTui): PiComponent => {
    tui = t
    return {
      render(w: number) {
        if (w !== width) {
          width = w
          lines = gridToAnsi(dial().grid())
        }
        return lines
      },
      invalidate() {
        width = 0 // re-lay the next render at whatever width it brings
      },
      dispose() {
        tui = undefined
      },
    }
  }

  /** Show or hide the widget to match `isShown()` (dark idle gives the rows back). */
  const sync = (ctx: PiContext) => {
    const shown = driver.isShown()
    if (shown === isMounted) return
    isMounted = shown
    ctx.ui.setWidget(KEY, shown ? widget : undefined, { placement: 'aboveEditor' })
  }

  const frame = (elapsed: number) => {
    activity.tick(elapsed / FRAME_MS)
    const ctx = ctxRef
    if (ctx) {
      sinceContext += elapsed
      if (sinceContext >= CONTEXT_EVERY_MS) {
        sinceContext = 0
        const usage = ctx.getContextUsage()
        if (usage?.percent != null) activity.contextPercent = usage.percent
        readClock()
      }
      sinceDefaults += elapsed
      if (sinceDefaults >= DEFAULTS_EVERY_MS && !refreshing) {
        sinceDefaults = 0
        refreshing = true
        void settings.refresh(entriesOf(ctx)).finally(() => {
          refreshing = false
        })
      }
      sync(ctx)
    }
    const f = dial()
    if (isMounted && width > 0 && tui) {
      f.step()
      // pi has no player: a scene's events (for Claude Code's soundscape) are taken and dropped each frame.
      if (f.sounds) f.sounds.length = 0
      lines = gridToAnsi(f.grid())
      tui.requestRender()
    }
    const pace = driver.pace()
    timer = setTimeout(() => frame(pace), pace)
  }

  const stop = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
  }

  pi.on('session_start', async (_e, ctx) => {
    if (ctx.mode !== 'tui' || !ctx.hasUI) return
    ctxRef = ctx
    // A new session starts on the defaults; a resumed, forked or reloaded one on its own over them.
    await settings.open(entriesOf(ctx))
    width = 0
    readClock()
    stop()
    isMounted = false
    sync(ctx)
    frame(FRAME_MS)
  })

  // `/tree` to another branch: the settings that branch kept.
  pi.on('session_tree', async (_e, ctx) => {
    const entries = entriesOf(ctx)
    if (!ctxRef || !entries) return
    await settings.open(entries)
    width = 0
    sync(ctx)
  })

  pi.on('session_shutdown', (_e, ctx) => {
    stop()
    if (isMounted && ctx.hasUI) ctx.ui.setWidget(KEY, undefined)
    isMounted = false
    ctxRef = undefined
  })

  pi.on('agent_start', () => activity.turnStarted())
  pi.on('agent_end', () => activity.turnEnded())
  pi.on('turn_start', (_e, ctx) => activity.modelStep(effortOf(ctx.thinkingLevel)))

  pi.on('message_update', e => {
    const m = e.assistantMessageEvent
    if (m.type === 'text_delta' && m.delta) activity.streamed(m.delta.length, 'text')
    else if (m.type === 'thinking_delta' && m.delta) activity.streamed(m.delta.length, 'thinking')
  })

  pi.on('tool_call', e => {
    const lines = piLinesWritten(e.toolName, e.input)
    if (lines !== undefined) activity.edited(lines)
    else if (COMMAND_TOOLS.has(e.toolName)) activity.ranCommand()
    else if (READ_TOOLS.has(e.toolName)) activity.read()
    else activity.usedTool() // an extension's tool: work too
    activity.toolsInFlight++
  })

  pi.on('tool_result', e => {
    activity.toolsInFlight = Math.max(0, activity.toolsInFlight - 1)
    if (COMMAND_TOOLS.has(e.toolName) && e.isError) activity.failed()
  })

  pi.on('session_compact', () => activity.compacted())

  /** pi shows a reply bare, so it says whose it is (Claude Code adds the name itself). */
  const say = (text: string) => `flow: ${text}`

  const handler = async (args: string, ctx: PiContext) => {
    const cmd = parseFlowArgs(args)
    readClock()
    const entries = entriesOf(ctx)
    // flow.json as it is now: what follows compares with it.
    await settings.refresh(entries)
    if (cmd.kind === 'show') {
      // (Without session entries every session shares one set: none is "just this session".)
      const defaults = entries ? settings.defaults : undefined
      ctx.ui.notify(say(statusText(cfg, driver.level(), driver.tint(), driver.clock, defaults)))
      return
    }
    if (cmd.kind === 'help') {
      ctx.ui.notify(say(helpText("pi's", false)))
      return
    }
    if (cmd.kind === 'error') {
      ctx.ui.notify(say(cmd.text.replace(/^! /, '')), 'warning')
      return
    }
    if (cmd.kind === 'layout') {
      ctx.ui.notify('flow: pi has no side panes, so the scene stays in the band above the editor', 'warning')
      return
    }
    if (cmd.kind === 'save') {
      const { text, saved } = await settings.save(entries)
      ctx.ui.notify(say(text), saved ? 'info' : 'warning')
      return
    }
    let text: string
    if (cmd.kind === 'reset') text = settings.reset(entries)
    else {
      const note = await settings.change(changesFor(cmd, cfg) ?? {}, entries)
      text = `${changedText(cmd, cfg, "pi's", driver.clock)}${note}`
    }
    width = 0 // redraw at once in the new look
    sync(ctx)
    ctx.ui.notify(say(text))
  }
  pi.registerCommand('flow', {
    description:
      'Ambient scenes above the editor: /flow [<scene> | next | day | night | clock | auto | 1-10 | off | save | reset | help]',
    handler,
  })
}
