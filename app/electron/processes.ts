import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { createInterface } from 'node:readline'
import type { ServerState } from '../src/api/bridge'

// Printed by server/aiplot/main.py once its socket is bound, followed by the port.
export const READY_LINE = 'AIPLOT_READY'

export interface ServerCommand {
  executable: string
  args: string[]
  cwd: string
}

export interface SupervisorOptions {
  command: ServerCommand
  dataDir: string
  onState: (state: ServerState) => void
  env?: NodeJS.ProcessEnv
  spawn?: (executable: string, args: string[], options: SpawnOptions) => ChildProcess
  fetch?: typeof fetch
  exists?: (path: string) => boolean
  pickPort?: () => Promise<number>
  readyTimeoutMs?: number
  pollMs?: number
  healthTimeoutMs?: number
  maxRestarts?: number
}

// A port the OS reports free right now; a squatter that takes it first never gets trusted,
// because readiness needs our child's own ready line.
export function pickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      probe.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('no port assigned'))
      })
    })
  })
}

/**
 * Runs the local server (§13): fresh port and token per start, ready only after the child's
 * ready line and a /health 200, health checks while running (unresponsive = 3 failures in a
 * row), restart at most maxRestarts times per session; retry() resets that budget.
 */
export class ServerSupervisor {
  private readonly options: Required<Omit<SupervisorOptions, 'env'>> & { env: NodeJS.ProcessEnv }
  private child: ChildProcess | null = null
  // Bumped whenever the current launch is abandoned, so a launch still awaiting its port
  // never spawns a second server.
  private generation = 0
  private restarts = 0
  private stopped = false
  private timers: NodeJS.Timeout[] = []
  private state: ServerState = { status: 'starting', restarts: 0 }

  constructor(options: SupervisorOptions) {
    this.options = {
      env: process.env,
      spawn: nodeSpawn,
      fetch: globalThis.fetch.bind(globalThis),
      exists: existsSync,
      pickPort,
      readyTimeoutMs: 60_000,
      pollMs: 5_000,
      healthTimeoutMs: 3_000,
      maxRestarts: 3,
      ...options,
    }
  }

  get current(): ServerState {
    return this.state
  }

  start(): void {
    this.stopped = false
    if (!this.options.exists(this.options.command.executable)) {
      console.error(`server executable not found: ${this.options.command.executable}`)
      this.setState({ status: 'error', reason: 'missing', restarts: this.restarts })
      return
    }
    void this.launch()
  }

  /** Only from the error state ("다시 시도"); a repeated click while starting is ignored. */
  retry(): void {
    if (this.state.status !== 'error') return
    this.restarts = 0
    this.halt()
    this.start()
  }

  /** App quit: the server sees its parent end and shuts down gracefully (AIPLOT_PARENT_PID). */
  stop(): void {
    this.stopped = true
    this.generation += 1
    this.clearTimers()
    this.child = null
  }

  private async launch(): Promise<void> {
    const generation = this.generation
    this.setState({ status: 'starting', restarts: this.restarts })
    let port: number
    try {
      port = await this.options.pickPort()
    } catch (err) {
      if (generation !== this.generation) return
      console.error('no free port for the server', err)
      this.fail()
      return
    }
    if (generation !== this.generation) return
    const token = randomBytes(32).toString('hex')
    const { executable, args, cwd } = this.options.command
    const child = this.options.spawn(executable, args, {
      cwd,
      env: {
        ...this.options.env,
        AIPLOT_PORT: String(port),
        AIPLOT_TOKEN: token,
        AIPLOT_PARENT_PID: String(process.pid),
        AIPLOT_DATA_DIR: this.options.dataDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    const baseUrl = `http://127.0.0.1:${String(port)}`
    // Unread pipes would fill up and block the server; its own logs go to files.
    child.stderr?.resume()
    let announced = false
    if (child.stdout) {
      createInterface({ input: child.stdout }).on('line', (line) => {
        if (announced || this.child !== child || line.trim() !== `${READY_LINE} ${String(port)}`) {
          return
        }
        announced = true
        void this.confirmReady(child, baseUrl, token)
      })
    }
    child.once('error', (err) => {
      console.error('server failed to start', err)
      if (this.child === child) this.fail()
    })
    child.once('exit', (code) => {
      if (this.child !== child || this.stopped) return
      console.error(`server exited with code ${String(code)}`)
      this.fail()
    })
    this.later(this.options.readyTimeoutMs, () => {
      if (this.child === child && this.state.status === 'starting') {
        console.error('server did not become ready in time')
        this.fail()
      }
    })
  }

  private async confirmReady(child: ChildProcess, baseUrl: string, token: string): Promise<void> {
    const healthy = await this.healthy(baseUrl, token)
    if (this.child !== child) return
    if (!healthy) {
      this.fail()
      return
    }
    this.clearTimers()
    this.setState({ status: 'ready', baseUrl, token, restarts: this.restarts })
    this.watch(child, baseUrl, token)
  }

  private watch(child: ChildProcess, baseUrl: string, token: string): void {
    let failures = 0
    const tick = async (): Promise<void> => {
      if (this.child !== child) return
      failures = (await this.healthy(baseUrl, token)) ? 0 : failures + 1
      if (this.child !== child) return
      if (failures >= 3) {
        console.error('server unresponsive')
        this.fail()
        return
      }
      this.later(this.options.pollMs, () => void tick())
    }
    this.later(this.options.pollMs, () => void tick())
  }

  private async healthy(baseUrl: string, token: string): Promise<boolean> {
    try {
      const response = await this.options.fetch(`${baseUrl}/api/v1/health`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(this.options.healthTimeoutMs),
      })
      return response.ok
    } catch {
      return false
    }
  }

  private fail(): void {
    this.halt()
    if (this.stopped) return
    if (this.restarts >= this.options.maxRestarts) {
      this.setState({ status: 'error', reason: 'failed', restarts: this.restarts })
      return
    }
    this.restarts += 1
    void this.launch()
  }

  // Stops the current child (if any) without counting it as a failure.
  private halt(): void {
    this.generation += 1
    this.clearTimers()
    const child = this.child
    this.child = null
    if (child && child.exitCode === null && child.signalCode === null) child.kill()
  }

  private later(ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.timers = this.timers.filter((t) => t !== timer)
      run()
    }, ms)
    this.timers.push(timer)
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
  }

  private setState(state: ServerState): void {
    this.state = state
    this.options.onState(state)
  }
}
