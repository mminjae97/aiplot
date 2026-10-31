import { strings } from '../strings'
import type { Completeness } from '../types'
import { inkOf } from './EpisodeTimeline'

type Props = {
  completeness: Completeness
  names: Map<string, string>
}

/** Completeness (§7, §8 S1-3): each milestone with the episodes that fulfil it, foreshadowing
 * not paid off yet, and cards with a required field missing. Missing things in orange words. */
export function CompletenessPanel({ completeness, names }: Props) {
  const unpaid = completeness.foreshadowing.filter((item) => item.payoff_episode_id === null)
  return (
    <aside className="completeness" aria-label={strings.story.completeness}>
      <h3>{strings.story.completeness}</h3>
      <section>
        <h4>{strings.story.milestones}</h4>
        <ol className="completeness-milestones">
          {completeness.milestones.map((milestone, index) => (
            <li key={milestone.id}>
              <span className="timeline-milestone-chip" style={{ background: inkOf(index) }}>
                {index + 1}
              </span>
              <span>{milestone.text}</span>
              {milestone.episodes.length === 0 ? (
                <span className="completeness-missing">{strings.story.noFulfilment}</span>
              ) : (
                <span className="completeness-by">
                  {milestone.episodes
                    .map((id) => names.get(id) ?? strings.drawer.untitled)
                    .join(', ')}
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h4>{strings.story.unpaidHeading}</h4>
        {unpaid.length === 0 ? (
          <p className="completeness-ok">{strings.story.allPaid}</p>
        ) : (
          <ul>
            {unpaid.map((item) => (
              <li key={item.id}>
                <span className="completeness-missing">{item.text}</span>
                <span className="completeness-by">
                  {' '}
                  {strings.story.plantedIn(
                    names.get(item.plant_episode_id) ?? strings.drawer.untitled,
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h4>{strings.story.incompleteHeading}</h4>
        {completeness.incomplete.length === 0 ? (
          <p className="completeness-ok">{strings.story.allComplete}</p>
        ) : (
          <ul>
            {completeness.incomplete.map((card) => (
              <li key={card.card_id}>
                <span className="completeness-missing">{card.name ?? strings.drawer.untitled}</span>
                <span className="completeness-by"> {strings.drawer.kind[card.type]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  )
}
