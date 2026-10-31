import { send } from './client'

/** One server-sent event of a job stream (§16): `id:` per event, the name is the type. */
export type JobEvent = { id: number | null; type: string; data: unknown }

/** Parses SSE text fed in chunks; comments (the 15 s keep-alive) and blank data are skipped. */
export class SseParser {
  private buffer = ''
  private id: number | null = null
  private type = 'message'
  private data: string[] = []

  constructor(private readonly onEvent: (event: JobEvent) => void) {}

  feed(chunk: string): void {
    let text = this.buffer + chunk
    // A trailing \r may be the first half of \r\n: wait for the next chunk.
    const held = text.endsWith('\r') ? '\r' : ''
    if (held) text = text.slice(0, -1)
    const lines = text.split(/\r\n|\r|\n/)
    // The last piece may be half a line.
    this.buffer = (lines.pop() ?? '') + held
    for (const line of lines) this.line(line)
  }

  private line(line: string): void {
    if (line === '') {
      this.dispatch()
      return
    }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') this.type = value
    else if (field === 'data') this.data.push(value)
    else if (field === 'id' && /^\d+$/.test(value)) this.id = Number(value)
  }

  private dispatch(): void {
    if (this.data.length > 0) {
      const text = this.data.join('\n')
      let data: unknown = text
      try {
        data = JSON.parse(text)
      } catch {
        // Plain text stays text.
      }
      this.onEvent({ id: this.id, type: this.type, data })
    }
    this.type = 'message'
    this.data = []
  }
}

/** Events that end a job's stream (§16). */
export const FINAL_EVENTS = new Set(['done', 'error', 'cancelled'])

/** Reads an SSE response to its end (or until signal aborts), handing each event over.
 * Resolves with the id of the last event seen. */
export async function readEvents(
  path: string,
  init: RequestInit,
  onEvent: (event: JobEvent) => void,
  after: number | null = null,
): Promise<number | null> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'text/event-stream')
  const response = await send(path, { ...init, headers })
  let last = after
  const parser = new SseParser((event) => {
    if (event.id !== null) last = event.id
    onEvent(event)
  })
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader()
  if (!reader) return last
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parser.feed(value)
  }
  // An event cut off by the stream's end is dropped (SSE), never half applied.
  return last
}

/** Reads GET /jobs/{jobId}/events until the job ends, the stream drops or signal aborts.
 * Resolves with the id of the last event seen, to resume from (`?after=`). */
export function streamJob(
  jobId: string,
  onEvent: (event: JobEvent) => void,
  options: { after?: number | null; signal?: AbortSignal } = {},
): Promise<number | null> {
  const query = options.after == null ? '' : `?after=${String(options.after)}`
  return readEvents(
    `/jobs/${encodeURIComponent(jobId)}/events${query}`,
    { signal: options.signal },
    onEvent,
    options.after ?? null,
  )
}
