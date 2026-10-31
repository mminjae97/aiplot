import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { TopBar } from '../components/TopBar'
import { useNavigation } from '../stores/navigation'
import { strings } from '../strings'

const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

type Props = { workId: string }

// The planning items' screens, in the contents' order (§12).
const ITEM_SCREENS = ['world', 'characters', 'regions', 'story'] as const

/** S1 contents, minimal (§12; the full page arrives in step 9): the opened book's spread. */
export function ContentsPage({ workId }: Props) {
  const work = useQuery({ queryKey: ['works', workId], queryFn: () => api.getWork(workId) })
  const open = useNavigation((store) => store.open)
  const back = () => {
    open({ name: 'library' })
  }

  if (!work.data) {
    return (
      <>
        <TopBar onBack={back} />
        <main className="desk">
          {work.isError && (
            <p className="library-alert" role="alert">
              {strings.contents.loadFailed}
            </p>
          )}
        </main>
      </>
    )
  }

  const { title, stage, updated_at, locked_stage } = work.data
  const planning = stage === 1 && locked_stage === 0
  return (
    <>
      <TopBar onBack={back} title={title} />
      <main className="desk">
        <article className="spread">
          <section className="page page-left">
            <h2 className="work-title">{title}</h2>
            <p className="work-stage">{strings.library.stageOf(strings.stage[stage])}</p>
            <p className="work-meta">
              {strings.library.modified(dateFormat.format(new Date(updated_at)))}
            </p>
          </section>
          <section className="page page-right" aria-labelledby="contents-heading">
            <h2 id="contents-heading" className="contents-heading">
              {strings.contents.heading}
            </h2>
            {strings.contents.groups.map((group) => {
              const later = group.stage > stage
              return (
                <div className="contents-group" key={group.stage} data-later={later || undefined}>
                  <h3>{strings.stage[group.stage]}</h3>
                  <ol>
                    {group.items.map((item, index) => (
                      <li key={item}>
                        {planning && group.stage === 1 ? (
                          <button
                            type="button"
                            className="contents-item"
                            onClick={() => {
                              const name = ITEM_SCREENS[index]
                              if (name) open({ name, workId })
                            }}
                          >
                            {item}
                          </button>
                        ) : (
                          <span>{item}</span>
                        )}
                        <span className="leader" aria-hidden="true" />
                        <span className="status">
                          {later ? strings.contents.laterStage : strings.contents.notStarted}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )
            })}
          </section>
        </article>
      </main>
    </>
  )
}
