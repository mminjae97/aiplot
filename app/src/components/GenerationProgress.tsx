import { strings } from '../strings'
import type { JobProgressEvent } from '../types'

type Props = {
  /** Null until the first progress event (or while the job waits its turn). */
  progress: JobProgressEvent | null
  queued: boolean
  stepLabel: string | null
  /** What to expect while there is no estimate yet. */
  usual: string
  onCancel: (() => void) | null
}

function remaining(seconds: number): string {
  const whole = Math.max(1, Math.round(seconds))
  return whole < 60
    ? strings.generation.etaSeconds(whole)
    : strings.generation.etaMinutes(Math.floor(whole / 60), whole % 60)
}

/** A wait over 10 s (§5): the step, progress, the time left and that it runs on its own, so
 * the reader can go elsewhere meanwhile. */
export function GenerationProgress({ progress, queued, stepLabel, usual, onCancel }: Props) {
  const eta = progress?.etaSec ?? null
  return (
    <div className="generation-progress" role="status">
      <p className="generation-step">{queued ? strings.generation.queued : stepLabel}</p>
      {/* No value = an indeterminate bar, until the first report. */}
      <progress
        max={progress?.total ?? 1}
        value={progress?.done ?? undefined}
        aria-label={strings.generation.progressLabel}
      />
      <p className="generation-note">
        {eta === null || queued ? usual : remaining(eta)} {strings.generation.background}
      </p>
      {onCancel && (
        <button type="button" className="paper-button" onClick={onCancel}>
          {strings.generation.cancel}
        </button>
      )}
    </div>
  )
}
