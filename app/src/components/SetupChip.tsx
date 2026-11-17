import { useState } from 'react'
import { useJobLive, useSetupJob } from '../api/setup'
import { useNavigation } from '../stores/navigation'
import { strings } from '../strings'
import { percentOf } from './setupText'

/** The top bar's way to the first-run screen (§12 S0-1): llama failing while a book was open,
 * or a setup download running in the background (§5) with its progress. */
export function SetupChip() {
  const jobId = useSetupJob((store) => store.jobId)
  const seen = useSetupJob((store) => store.seen)
  const live = useJobLive(jobId)
  const screen = useNavigation((store) => store.screen)
  const open = useNavigation((store) => store.open)
  const pending = useNavigation((store) => store.setupPending)
  const drawerOpen = useNavigation((store) => store.drawerOpen)
  const editHeld = useNavigation((store) => store.editHeld)
  const held = drawerOpen || editHeld
  const [explained, setExplained] = useState(false)
  // The words go with the drawer or edit they were about.
  if (explained && !held) setExplained(false)
  if (screen.name === 'setup') return null
  // Leaving the book now would drop the drawer's draft (§8) or a beat's edits (§10): either
  // chip says why it waits.
  const go = () => {
    if (held) setExplained(true)
    else open({ name: 'setup' })
  }
  const chip = (text: string, failed: boolean) => (
    <>
      <button
        type="button"
        className="setup-chip"
        data-failed={failed || undefined}
        aria-disabled={held || undefined}
        onClick={go}
      >
        {text}
      </button>
      <span className="setup-chip-note" role="status">
        {explained && held
          ? drawerOpen
            ? strings.setup.chipAfterDrawer
            : strings.setup.chipAfterEdit
          : ''}
      </span>
    </>
  )
  if (pending) return chip(strings.setup.chipLlamaFailed, true)
  if (live === null) return null
  // A failure stays up until S0-1 has shown why.
  const failed = live.final?.type === 'error' && seen !== jobId
  if (live.final !== null && !failed) return null
  const progress = live.progress
  const text = failed
    ? strings.setup.chipFailed
    : live.paused
      ? strings.setup.chipPaused
      : strings.setup.chip(progress ? percentOf(progress.done, progress.total) : 0)
  return chip(text, failed)
}
