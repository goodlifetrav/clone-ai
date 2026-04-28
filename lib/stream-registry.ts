/**
 * Server-side EventEmitter registry for real-time clone streaming.
 *
 * Since Next.js runs as a single persistent Node.js process (standalone mode),
 * a globalThis variable survives across requests in the same process. This lets
 * the /api/clone route push HTML chunks to the /api/projects/[id]/stream route
 * without any external infrastructure.
 *
 * Each entry is keyed by project ID and lives only while generation is running.
 */
import { EventEmitter } from 'events'

export type StreamEntry = {
  emitter: EventEmitter
  /** Latest accumulated HTML — sent immediately to late subscribers */
  latestHtml: string
}

declare global {
  // eslint-disable-next-line no-var
  var __cloneStreamRegistry: Map<string, StreamEntry> | undefined
}

if (!globalThis.__cloneStreamRegistry) {
  globalThis.__cloneStreamRegistry = new Map()
}

export const streamRegistry = globalThis.__cloneStreamRegistry

export function createEntry(projectId: string): StreamEntry {
  const emitter = new EventEmitter()
  emitter.setMaxListeners(30)
  const entry: StreamEntry = { emitter, latestHtml: '' }
  streamRegistry.set(projectId, entry)
  return entry
}

export function removeEntry(projectId: string) {
  streamRegistry.delete(projectId)
}
