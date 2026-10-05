// REVISION: flow-v14-pi
//
// The slice of pi's extension API this adapter uses, declared structurally
// so the mod needs no npm dependency on `@earendil-works/pi-coding-agent`.
// Mirrors packages/coding-agent/src/core/extensions/types.ts and
// packages/tui/src/tui.ts in badlogic/pi-mono.

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

export interface PiContext {
  ui: PiUi
  mode: 'tui' | 'rpc' | 'json' | 'print'
  hasUI: boolean
  thinkingLevel?: PiThinkingLevel
  getContextUsage(): { tokens: number | null; contextWindow: number; percent: number | null } | undefined
}

type AssistantMessageEvent = { type: string; delta?: string }

export interface PiEvents {
  session_start: { type: 'session_start' }
  session_shutdown: { type: 'session_shutdown' }
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
}
