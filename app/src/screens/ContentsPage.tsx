import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { CardDrawer, type DrawerRequest } from '../components/CardDrawer'
import { TopBar } from '../components/TopBar'
import { useNavigation } from '../stores/navigation'
import { strings } from '../strings'

const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

type Props = { workId: string }

// Until the world book, dex, map and story screens exist (step 1 units 11-13), the planning
// items open the card drawer directly.
const ITEM_TYPES = ['world', 'character', 'region'] as const

function StoryChooser({ workId, onPick }: { workId: string; onPick: (r: DrawerRequest) => void }) {
  const mains = useQuery({
    queryKey: ['cards', workId, 'main_story'],
    queryFn: () => api.listCards(workId, { type: 'main_story' }),
  })
  const parts = useQuery({
    queryKey: ['cards', workId, 'part'],
    queryFn: () => api.listCards(workId, { type: 'part' }),
  })
  const main = mains.data?.cards[0]
  const lastPart = parts.data?.cards.at(-1)
  return (
    <div className="story-chooser" role="group" aria-label={strings.drawer.temporary.story}>
      <button
        type="button"
        className="paper-button"
        onClick={() => {
          onPick({ workId, type: 'main_story', card_id: main?.id ?? null })
        }}
      >
        {strings.drawer.temporary.mainStory}
      </button>
      <button
        type="button"
        className="paper-button"
        onClick={() => {
          onPick({ workId, type: 'part' })
        }}
      >
        {strings.drawer.temporary.newPart}
      </button>
      <button
        type="button"
        className="paper-button"
        disabled={!lastPart}
        title={lastPart ? undefined : strings.drawer.temporary.noPart}
        onClick={() => {
          if (lastPart) onPick({ workId, type: 'episode', part_id: lastPart.id })
        }}
      >
        {strings.drawer.temporary.newEpisode}
      </button>
    </div>
  )
}

/** S1 contents, minimal (§12; the full page arrives in step 9): the opened book's spread. */
export function ContentsPage({ workId }: Props) {
  const work = useQuery({ queryKey: ['works', workId], queryFn: () => api.getWork(workId) })
  const open = useNavigation((store) => store.open)
  const [drawer, setDrawer] = useState<DrawerRequest | null>(null)
  const [choosingStory, setChoosingStory] = useState(false)
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
                            aria-expanded={index === 3 ? choosingStory : undefined}
                            onClick={() => {
                              const type = ITEM_TYPES[index]
                              if (type) setDrawer({ workId, type })
                              else setChoosingStory((v) => !v)
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
            {choosingStory && planning && (
              <StoryChooser
                workId={workId}
                onPick={(request) => {
                  setChoosingStory(false)
                  setDrawer(request)
                }}
              />
            )}
          </section>
        </article>
      </main>
      {drawer && (
        <CardDrawer
          request={drawer}
          onClose={() => {
            setDrawer(null)
          }}
        />
      )}
    </>
  )
}
