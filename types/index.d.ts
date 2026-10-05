// REVISION: flow-v59-agents-md

/** The balloon's altitude in world rows, kept across the reload a setting change causes. */
export type BalloonAltitude = number

declare module 'claude-code' {
  interface PluginState {
    flow: {
      altitude: BalloonAltitude
    }
  }
}
