import { useJobLive, useSetupJob } from '../api/setup'
import { useNavigation } from '../stores/navigation'
import { strings } from '../strings'
import { percentOf } from './setupText'

/** A setup download running in the background (§5): its progress in the top bar, a click
 * away from the first-run screen. */
export function SetupChip() {
  const jobId = useSetupJob((store) => store.jobId)
  const live = useJobLive(jobId)
  const screen = useNavigation((store) => store.screen)
  const open = useNavigation((store) => store.open)
  if (live === null || screen.name === 'setup') return null
  const failed = live.final?.type === 'error'
  if (live.final !== null && !failed) return null
  const progress = live.progress
  const text = failed
    ? strings.setup.chipFailed
    : live.paused
      ? strings.setup.chipPaused
      : strings.setup.chip(progress ? percentOf(progress.done, progress.total) : 0)
  return (
    <button
      type="button"
      className="setup-chip"
      data-failed={failed || undefined}
      onClick={() => {
        open({ name: 'setup' })
      }}
    >
      {text}
    </button>
  )
}
