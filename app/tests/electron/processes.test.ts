// @vitest-environment node
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ServerState } from '../../src/api/bridge'
import {
  pickPort,
  READY_LINE,
  ServerSupervisor,
  type SupervisorOptions,
} from '../../electron/processes'

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly kill = vi.fn(() => {
    this.exit(1)
    return true
  })

  constructor(readonly env: NodeJS.ProcessEnv) {
    super()
  }

  ready(port: string | undefined = this.env.AIPLOT_PORT): void {
    this.stdout.write(`some log line\n${READY_LINE} ${String(port)}\n`)
  }

  exit(code: number): void {
    if (this.exitCode !== null) return
    this.exitCode = code
    this.emit('exit', code)
  }
}

function setup(overrides: Partial<SupervisorOptions> = {}) {
  const children: FakeChild[] = []
  const states: ServerState[] = []
  let nextPort = 9100
  let healthy = true
  const fetch = vi.fn(() =>
    healthy ? Promise.resolve(new Response('{}')) : Promise.reject(new Error('down')),
  )
  const supervisor = new ServerSupervisor({
    command: { executable: 'server.exe', args: ['-m', 'aiplot.main'], cwd: 'C:/server' },
    dataDir: 'C:/data',
    env: { PATH: 'x' },
    onState: (state) => states.push(state),
    spawn: (_executable, _args, options) => {
      const child = new FakeChild(options.env ?? {})
      children.push(child)
      return child as unknown as ChildProcess
    },
    fetch,
    exists: () => true,
    pickPort: () => Promise.resolve(nextPort++),
    readyTimeoutMs: 200,
    pollMs: 5,
    healthTimeoutMs: 50,
    ...overrides,
  })
  return {
    supervisor,
    children,
    states,
    fetch,
    setHealthy: (value: boolean) => {
      healthy = value
    },
    last: () => states.at(-1),
  }
}

const running: ServerSupervisor[] = []
afterEach(() => {
  for (const supervisor of running.splice(0)) supervisor.stop()
})

function started(s: ReturnType<typeof setup>) {
  running.push(s.supervisor)
  s.supervisor.start()
  return s
}

describe('ServerSupervisor', () => {
  test('passes a fresh port, token and the parent pid, then waits for the ready line', async () => {
    const s = started(setup())
    await vi.waitFor(() => {
      expect(s.children).toHaveLength(1)
    })
    const env = s.children[0]?.env ?? {}
    expect(env.AIPLOT_PORT).toBe('9100')
    expect(env.AIPLOT_TOKEN).toMatch(/^[0-9a-f]{64}$/)
    expect(env.AIPLOT_PARENT_PID).toBe(String(process.pid))
    expect(env.AIPLOT_DATA_DIR).toBe('C:/data')
    expect(env.PATH).toBe('x')
    expect(s.last()).toEqual({ status: 'starting', restarts: 0 })
    // Whatever answers on the port is not trusted before our child announces itself.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(s.fetch).not.toHaveBeenCalled()
    s.children[0]?.ready()
    await vi.waitFor(() => {
      expect(s.last()).toEqual({
        status: 'ready',
        baseUrl: 'http://127.0.0.1:9100',
        token: env.AIPLOT_TOKEN,
        restarts: 0,
      })
    })
  })

  test('ignores a ready line for another port', async () => {
    const s = started(setup())
    await vi.waitFor(() => {
      expect(s.children).toHaveLength(1)
    })
    s.children[0]?.ready('9999')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(s.last()?.status).toBe('starting')
    expect(s.fetch).not.toHaveBeenCalled()
  })

  test('restarts a crashed server on a new port and token, three times at most', async () => {
    const s = started(setup())
    for (let n = 1; n <= 4; n++) {
      await vi.waitFor(() => {
        expect(s.children).toHaveLength(n)
      })
      s.children[n - 1]?.exit(1)
    }
    await vi.waitFor(() => {
      expect(s.last()).toEqual({ status: 'error', reason: 'failed', restarts: 3 })
    })
    const ports = s.children.map((c) => c.env.AIPLOT_PORT)
    const tokens = new Set(s.children.map((c) => c.env.AIPLOT_TOKEN))
    expect(ports).toEqual(['9100', '9101', '9102', '9103'])
    expect(tokens.size).toBe(4)
  })

  test('retry resets the restart budget', async () => {
    const s = started(setup({ maxRestarts: 0 }))
    await vi.waitFor(() => {
      expect(s.children).toHaveLength(1)
    })
    s.children[0]?.exit(1)
    await vi.waitFor(() => {
      expect(s.last()?.status).toBe('error')
    })
    s.supervisor.retry()
    await vi.waitFor(() => {
      expect(s.children).toHaveLength(2)
    })
    s.children[1]?.ready()
    await vi.waitFor(() => {
      expect(s.last()?.status).toBe('ready')
    })
  })

  test('kills and restarts a server that stops answering health checks', async () => {
    const s = started(setup())
    await vi.waitFor(() => {
      expect(s.children).toHaveLength(1)
    })
    s.children[0]?.ready()
    await vi.waitFor(() => {
      expect(s.last()?.status).toBe('ready')
    })
    s.setHealthy(false)
    await vi.waitFor(() => {
      expect(s.children).toHaveLength(2)
    })
    expect(s.children[0]?.kill).toHaveBeenCalled()
    expect(s.last()).toEqual({ status: 'starting', restarts: 1 })
  })

  test('fewer than three failed health checks in a row are not a failure', async () => {
    // Ready check passes, then every poll cycle is fail, fail, ok.
    let calls = 0
    const fetch = vi.fn(() => {
      calls += 1
      return calls === 1 || calls % 3 === 1
        ? Promise.resolve(new Response('{}'))
        : Promise.reject(new Error('slow'))
    })
    const s = started(setup({ fetch }))
    await vi.waitFor(() => {
      expect(s.children).toHaveLength(1)
    })
    s.children[0]?.ready()
    await vi.waitFor(() => {
      expect(calls).toBeGreaterThan(12)
    })
    expect(s.children).toHaveLength(1)
    expect(s.last()?.status).toBe('ready')
  })

  test('restarts a server that never becomes ready', async () => {
    const s = started(setup({ readyTimeoutMs: 20 }))
    await vi.waitFor(() => {
      expect(s.children).toHaveLength(2)
    })
    expect(s.children[0]?.kill).toHaveBeenCalled()
  })

  test('reports a missing executable without starting or restarting', () => {
    const s = started(setup({ exists: () => false }))
    expect(s.children).toHaveLength(0)
    expect(s.last()).toEqual({ status: 'error', reason: 'missing', restarts: 0 })
  })

  test('stop leaves the child to shut itself down and ignores its exit', async () => {
    const s = started(setup())
    await vi.waitFor(() => {
      expect(s.children).toHaveLength(1)
    })
    s.supervisor.stop()
    s.children[0]?.exit(0)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(s.children[0]?.kill).not.toHaveBeenCalled()
    expect(s.children).toHaveLength(1)
  })
})

test('pickPort returns a usable local port', async () => {
  const port = await pickPort()
  expect(port).toBeGreaterThan(0)
  expect(port).toBeLessThan(65536)
})
