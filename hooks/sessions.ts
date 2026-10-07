// REVISION: flow-v121-fresh-defaults
//
// Each session's own settings: what `/flow` set in it, kept under the
// session's id over the defaults every session starts from (/config in
// Claude Code, ~/.pi/agent/flow.json in pi). A field the session never set
// follows the default. Pure: no engine imports; the adapters keep the
// records (Claude Code in its store, one key a session; pi in the session).
//
// The defaults can change under a running session (another session's
// `/flow save`, a /config change elsewhere) without it hearing: the adapters
// read them afresh before anything compares with them, and what the session
// shows that they no longer hold becomes its own (pinShown). So nothing done
// elsewhere changes a running session, a resume shows what it showed, and
// `/flow save` saves exactly what it shows.

import { readConfig, storedValue, type FlowConfig } from './settings'
import { styleNamed } from './styles'

/** A session's own settings: only the fields it set. */
export type Own = Partial<FlowConfig>

/** What is kept for a session: its own settings, and when it was last used (ms). */
export type SessionRecord = { own: Own; at: number }

/** A session's record lives in the store under `session:<id>`: one key each, so two sessions never write the same one. */
export const SESSION_PREFIX = 'session:'
export const sessionKey = (id: string) => `${SESSION_PREFIX}${id}`

/** The records kept: the most recently used this many... */
export const SESSIONS_KEPT = 100
/** ...each for this long unused (Claude Code keeps a transcript 30 days by default; this outlasts it). */
export const SESSION_KEPT_MS = 60 * 24 * 60 * 60 * 1000

/** Stored own settings, validated: only fields that read back as themselves survive. */
export function readOwn(raw: unknown): Own {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const full = readConfig(o)
  const out: Own = {}
  for (const k of Object.keys(full) as (keyof FlowConfig)[]) {
    // A scene under an old name (`colony`, now `avalon`) is still that scene.
    const same = k === 'style' && typeof o[k] === 'string' && styleNamed(o[k] as string) === full[k]
    if (o[k] !== undefined && (same || storedValue(k, full[k]) === o[k])) {
      ;(out as Record<string, unknown>)[k] = full[k]
    }
  }
  return out
}

/** Own settings as stored: each field spelled as its /config row spells it. */
export function storedOwn(own: Own): Record<string, string | number> {
  return Object.fromEntries((Object.keys(own) as (keyof FlowConfig)[]).map(k => [k, storedValue(k, own[k]!)]))
}

/** A stored record, validated (none: not a record). */
export function readRecord(raw: unknown): SessionRecord | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const at = typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0
  return { own: readOwn(o.own), at }
}

/** A record as stored. */
export function storedRecord(own: Own, at: number): { own: Record<string, string | number>; at: number } {
  return { own: storedOwn(own), at }
}

/** The settings a session shows: its own over the defaults. */
export function withOwn(defaults: FlowConfig, own: Own): FlowConfig {
  return { ...defaults, ...own }
}

/** The fields where `cfg` differs from `defaults`: what saving it as the default writes. */
export function differences(cfg: FlowConfig, defaults: FlowConfig): Own {
  const out: Own = {}
  for (const k of Object.keys(defaults) as (keyof FlowConfig)[]) {
    if (cfg[k] !== defaults[k]) (out as Record<string, unknown>)[k] = cfg[k]
  }
  return out
}

/**
 * The defaults as they are now (`fresh`), against what the session shows
 * (`cfg`): a field it shows that it never set itself, and that the defaults
 * no longer hold, changed under it. It becomes the session's own, so the
 * session goes on showing it and a resume brings it back. Answers the own
 * settings after, and whether any were added.
 */
export function pinShown(cfg: FlowConfig, own: Own, fresh: FlowConfig): { own: Own; pinned: boolean } {
  const out: Own = { ...own }
  let pinned = false
  for (const k of Object.keys(fresh) as (keyof FlowConfig)[]) {
    if (k in own || cfg[k] === fresh[k]) continue
    ;(out as Record<string, unknown>)[k] = cfg[k]
    pinned = true
  }
  return { own: out, pinned }
}

/**
 * The session's id moved on under a running load: a /clear (a new
 * conversation in the same place), a resume from inside the session, or a
 * fork. The session it moved to shows its own settings if it has a record;
 * one resumed without a record shows the defaults, as it would started
 * afresh; otherwise it carries this one's on (`carried`: keep them under the
 * new id).
 */
export function ownAfterSwitch(record: SessionRecord | undefined, own: Own, ended: string | undefined): { own: Own; carried: boolean } {
  if (record) return { own: record.own, carried: false }
  if (ended === 'resume') return { own: {}, carried: false }
  return { own: { ...own }, carried: Object.keys(own).length > 0 }
}

/** The records to drop: unused for too long, or past the most recently used SESSIONS_KEPT (never `keep`). */
export function staleSessions(records: readonly { key: string; at: number }[], now: number, keep?: string): string[] {
  const live = records.filter(r => r.key !== keep).sort((a, b) => b.at - a.at)
  const room = keep && records.some(r => r.key === keep) ? SESSIONS_KEPT - 1 : SESSIONS_KEPT
  return live.filter((r, i) => i >= room || now - r.at > SESSION_KEPT_MS).map(r => r.key)
}
