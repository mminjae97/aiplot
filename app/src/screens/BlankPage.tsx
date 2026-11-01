import type { PlanningScreen } from '../stores/navigation'
import { strings } from '../strings'

type Props = { screen: Extract<PlanningScreen, { name: 'direction' | 'writing' | 'reading' }> }

/** A section's page before its step builds it (§20): blank paper, its post-it already in the
 * book. Named for screen readers only. */
export function BlankPage({ screen }: Props) {
  return (
    <article className="spread" aria-label={strings.book.notes[screen.name]}>
      <section className="page page-left" />
      <section className="page page-right" />
    </article>
  )
}
