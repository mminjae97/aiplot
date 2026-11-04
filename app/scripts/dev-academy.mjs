// npm run dev:academy: `npm run dev` on its own data dir holding the sample work
// (server/scripts/seed_academy.py), seeded the first time, when the dir has no database yet.
//
// Data dir: %LOCALAPPDATA%\Aiplot-dev\academy, or AIPLOT_DEV_ACADEMY_DIR if set.
// --seed-only: seed if needed, then stop without starting the app (used to test the seeding).
// Needs uv on PATH (the seed runs in server/ with `uv run`).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const serverDir = resolve(appDir, '..', 'server')
const localAppData = process.env.LOCALAPPDATA
const override = process.env.AIPLOT_DEV_ACADEMY_DIR

function fail(message) {
  console.error(`dev:academy: ${message}`)
  process.exit(1)
}

if (!override && !localAppData) fail('LOCALAPPDATA is not set (Windows only)')
const dataDir = resolve(override || join(localAppData, 'Aiplot-dev', 'academy'))
const dbPath = join(dataDir, 'data', 'aiplot.db')

if (!existsSync(dbPath)) {
  console.log(`dev:academy: seeding the sample work into ${dataDir}`)
  const seed = spawnSync('uv', ['run', 'python', 'scripts/seed_academy.py', dataDir], {
    cwd: serverDir,
    stdio: 'inherit',
  })
  if (seed.error) {
    fail(
      seed.error.code === 'ENOENT'
        ? 'uv was not found on PATH; install uv (https://docs.astral.sh/uv/) and try again'
        : `could not run uv: ${seed.error.message}`,
    )
  }
  if (seed.status !== 0) {
    // The database did not exist before: remove what the failed seed left, so the next run
    // seeds again instead of opening an empty library.
    for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true })
    fail(`seeding failed (exit ${String(seed.status)}); see the output above`)
  }
}

if (process.argv.includes('--seed-only')) process.exit(0)

// What `npm run dev` runs (electron-vite dev), by its JS entry so no shell is needed.
const electronVite = join(appDir, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const child = spawn(process.execPath, [electronVite, 'dev'], {
  cwd: appDir,
  stdio: 'inherit',
  env: { ...process.env, AIPLOT_DATA_DIR: dataDir },
})
child.on('error', (error) => {
  fail(`could not start electron-vite: ${error.message}`)
})
child.on('exit', (code) => {
  process.exit(code ?? 1)
})
