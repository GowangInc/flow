// REVISION: flow-v121-fresh-defaults
//
// pi's settings for one session, apart from pi and the disk so the shared
// tests cover them: the defaults new sessions start with (flow.json, through
// `file`) and this session's own over them, kept in the session as `flow`
// entries (through `entries`). An older pi without session entries shares
// one set in flow.json, as before. flow.json is read afresh before anything
// compares with it (`refresh`): another pi session may have saved since.
// Pure (no Node imports).

import { differences, type Own, pinShown, storedOwn, withOwn } from '../hooks/sessions'
import { ownHint, readConfig, resetText, savedText, type FlowConfig } from '../hooks/settings'
import { ownInSession } from './mapping'
import type { PiSessionEntry } from './types'

/** Where the defaults live (flow.json): read whole, and written a few fields at a time over what is there. */
export type DefaultsFile = {
  load(): Promise<FlowConfig>
  save(changes: Own): Promise<void>
}

/** The session's entries, and keeping the session's own settings in it (its latest entry counts). */
export type SessionEntries = {
  branch(): readonly PiSessionEntry[]
  keep(data: { own: Record<string, string | number> }): void
}

export class PiSettings {
  /** What new sessions start with, as last read. */
  defaults: FlowConfig = readConfig(undefined)
  /** The fields this session set itself (or kept, as the defaults changed under it). */
  own: Own = {}

  constructor(
    /** The settings shown: the scene driver's, changed in place. */
    readonly cfg: FlowConfig,
    readonly file: DefaultsFile,
  ) {}

  /** A session is up (new, resumed, forked, reloaded) or moved to another branch: the defaults, its own over them. */
  async open(session: SessionEntries | undefined): Promise<void> {
    this.defaults = await this.file.load()
    this.own = session ? ownInSession(session.branch()) : {}
    Object.assign(this.cfg, withOwn(this.defaults, this.own))
  }

  /**
   * flow.json read afresh: what this session shows that it no longer holds
   * changed under it, and becomes the session's own (sessions.ts: pinShown).
   */
  async refresh(session: SessionEntries | undefined): Promise<void> {
    const fresh = await this.file.load()
    if (session) {
      const { own, pinned } = pinShown(this.cfg, this.own, fresh)
      if (pinned) this.keep(session, own)
    }
    this.defaults = fresh
  }

  /** A `/flow` change, applied: this session's own (without session entries, flow.json's). Answers a note for the reply. */
  async change(changes: Own, session: SessionEntries | undefined): Promise<string> {
    const before = { ...this.cfg }
    Object.assign(this.cfg, changes)
    if (session) {
      this.keep(session, { ...this.own, ...changes })
      return ownHint(before, this.cfg, this.defaults)
    }
    try {
      await this.file.save(changes)
      this.defaults = { ...this.defaults, ...changes }
      return ''
    } catch {
      return '  (not saved)'
    }
  }

  /** `/flow save`: flow.json takes every setting the session shows that it doesn't hold, so new sessions start just so. */
  async save(session: SessionEntries | undefined): Promise<{ text: string; saved: boolean }> {
    const before = { ...this.defaults }
    const changes = differences(this.cfg, this.defaults)
    if (Object.keys(changes).length) {
      try {
        await this.file.save(changes)
      } catch {
        return { text: "not saved: flow.json couldn't be written", saved: false }
      }
      this.defaults = { ...this.defaults, ...changes }
    }
    if (session && Object.keys(this.own).length) this.keep(session, {})
    return { text: savedText(this.cfg, before, Object.keys(changes).length > 0), saved: true }
  }

  /** `/flow reset`: the session back on the defaults. */
  reset(session: SessionEntries | undefined): string {
    const before = { ...this.cfg }
    if (session && Object.keys(this.own).length) this.keep(session, {})
    Object.assign(this.cfg, this.defaults)
    return resetText(before, this.defaults)
  }

  private keep(session: SessionEntries, own: Own): void {
    this.own = own
    session.keep({ own: storedOwn(own) })
  }
}
