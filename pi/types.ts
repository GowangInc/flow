// REVISION: flow-v120-per-session
//
// The slice of pi's extension API this adapter uses, declared structurally
// so the mod needs no npm dependency on `@earendil-works/pi-coding-agent`.
// Mirrors packages/coding-agent/src/core/extensions/types.ts,
// packages/coding-agent/src/core/session-manager.ts and
// packages/tui/src/tui.ts in badlogic/pi-mono (now earendil-works/pi). The
// session's entries and `appendEntry` are optional: an older pi without them
// keeps one set of settings for every session, as before.

export type PiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface PiComponent {
  render(width: number): string[]
  invalidate(): void
  dispose?(): void
}

export interface PiTui {
  requestRender(): void
}

export interface PiUi {
  setWidget(
    key: string,
    content: ((tui: PiTui, theme: unknown) => PiComponent) | undefined,
    options?: { placement?: 'aboveEditor' | 'belowEditor' },
  ): void
  notify(message: string, type?: 'info' | 'warning' | 'error'): void
}

/** One entry of a session (a message, a model change, an extension's own `custom` entry...). */
export interface PiSessionEntry {
  type: string
  id: string
  /** A `custom` entry's kind, as `appendEntry` named it. */
  customType?: string
  data?: unknown
}

/** The session as an extension reads it (pi's ReadonlySessionManager, in part). */
export interface PiSessionManager {
  getSessionId(): string
  /** The entries on the current branch, root first (a fork's include its parent's, up to the fork). */
  getBranch(): PiSessionEntry[]
}

export interface PiContext {
  ui: PiUi
  mode: 'tui' | 'rpc' | 'json' | 'print'
  hasUI: boolean
  thinkingLevel?: PiThinkingLevel
  getContextUsage(): { tokens: number | null; contextWindow: number; percent: number | null } | undefined
  sessionManager?: PiSessionManager
}

type AssistantMessageEvent = { type: string; delta?: string }

export interface PiEvents {
  /** A session is up: pi started, reloaded, or moved to a new, resumed or forked one. */
  session_start: { type: 'session_start'; reason?: 'startup' | 'reload' | 'new' | 'resume' | 'fork' }
  session_shutdown: { type: 'session_shutdown' }
  /** `/tree` moved the session to another branch. */
  session_tree: { type: 'session_tree' }
  agent_start: { type: 'agent_start' }
  agent_end: { type: 'agent_end' }
  turn_start: { type: 'turn_start'; turnIndex: number }
  message_update: { type: 'message_update'; assistantMessageEvent: AssistantMessageEvent }
  tool_call: { type: 'tool_call'; toolCallId: string; toolName: string; input: Record<string, unknown> }
  tool_result: { type: 'tool_result'; toolCallId: string; toolName: string; isError: boolean }
  session_compact: { type: 'session_compact' }
}

export interface PiApi {
  on<K extends keyof PiEvents>(event: K, handler: (event: PiEvents[K], ctx: PiContext) => unknown): void
  registerCommand(
    name: string,
    options: { description?: string; handler: (args: string, ctx: PiContext) => Promise<void> },
  ): void
  /** Keeps data in the session (never sent to the model): a `custom` entry read back from `getBranch()`. */
  appendEntry?<T = unknown>(customType: string, data?: T): void
}
