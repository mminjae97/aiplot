import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type KeyboardEvent, useRef, useState } from 'react'
import { api } from '../api/client'
import { CardDrawer, type DrawerRequest } from '../components/CardDrawer'
import { DeleteCardDialog, UndoToast } from '../components/CardDelete'
import { TopBar } from '../components/TopBar'
import { useNavigation } from '../stores/navigation'
import { strings } from '../strings'
import type { Card, WorldCard } from '../types'

type Category = 'rule' | 'faction' | 'history' | 'culture' | 'other'
// Bookmark order (§8 S1-0); the glossary comes last.
const CATEGORIES: Category[] = ['rule', 'faction', 'history', 'culture', 'other']
type Tab = Category | 'terms'
const TABS: Tab[] = [...CATEGORIES, 'terms']

type Props = { workId: string }

function isWorld(card: Card): card is WorldCard {
  return card.type === 'world'
}

/** S1-0 world book (§8): an open encyclopedia. Category bookmarks and an index with page
 * numbers on the left, the chosen entry on the right; 용어집 lists every term in 가나다 order. */
export function WorldBookScreen({ workId }: Props) {
  const queryClient = useQueryClient()
  const open = useNavigation((store) => store.open)
  const [tab, setTab] = useState<Tab>('rule')
  const [selected, setSelected] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<DrawerRequest | null>(null)
  const [deleting, setDeleting] = useState<Card | null>(null)
  const [undo, setUndo] = useState<{ card: Card; until: string } | null>(null)

  const work = useQuery({ queryKey: ['works', workId], queryFn: () => api.getWork(workId) })
  const worlds = useQuery({
    queryKey: ['cards', workId, 'world'],
    queryFn: () => api.listCards(workId, { type: 'world' }),
  })
  const all = useQuery({
    queryKey: ['cards', workId, 'all'],
    queryFn: () => api.listCards(workId),
  })
  const links = useQuery({
    queryKey: ['relations', workId, 'world'],
    queryFn: () => api.relations(workId, 'world'),
  })

  const tabRefs = useRef(new Map<Tab, HTMLButtonElement>())
  // Read-only until the work says otherwise: a locked book never offers edits while loading.
  const locked = (work.data?.locked_stage ?? 1) >= 1
  const entries = (worlds.data?.cards ?? []).filter(isWorld)
  // One book: entries by bookmark, then as made; the page is the place in that order.
  const ordered = CATEGORIES.flatMap((category) =>
    entries.filter((card) => (card.data.category ?? 'other') === category),
  )
  const pageOf = new Map(ordered.map((card, index) => [card.id, index + 1]))
  const entry = ordered.find((card) => card.id === selected) ?? null
  const names = new Map((all.data?.cards ?? []).map((card) => [card.id, card]))
  const terms = ordered
    .flatMap((card) => card.data.terms.map((term) => ({ ...term, card })))
    .sort((a, b) => a.term.localeCompare(b.term, 'ko'))

  const show = (card: WorldCard) => {
    setSelected(card.id)
    setTab(card.data.category ?? 'other')
  }

  const back = () => {
    open({ name: 'contents', workId })
  }

  // Tab pattern: one Tab stop, arrows/Home/End move and open the bookmark.
  const onTabKey = (event: KeyboardEvent, key: Tab) => {
    const at = TABS.indexOf(key)
    const to =
      event.key === 'ArrowRight'
        ? TABS[(at + 1) % TABS.length]
        : event.key === 'ArrowLeft'
          ? TABS[(at - 1 + TABS.length) % TABS.length]
          : event.key === 'Home'
            ? TABS[0]
            : event.key === 'End'
              ? TABS[TABS.length - 1]
              : undefined
    if (to === undefined) return
    event.preventDefault()
    setTab(to)
    tabRefs.current.get(to)?.focus()
  }

  const related = entry
    ? (links.data?.relations ?? [])
        .filter((link) => link.from_id === entry.id)
        .map((link) => names.get(link.to_id))
        .filter((card): card is Card => card !== undefined)
    : []

  return (
    <>
      <TopBar
        onBack={back}
        backLabel={strings.contents.toContents}
        backDisabled={drawer !== null || deleting !== null}
        title={work.data?.title}
      />
      <main className="desk" inert={drawer !== null || deleting !== null}>
        <article className="spread world-book">
          <section className="page page-left" aria-label={strings.worldBook.title}>
            <div className="world-tabs" role="tablist" aria-label={strings.worldBook.tabs}>
              {TABS.map((key) => (
                <button
                  key={key}
                  ref={(node) => {
                    if (node) tabRefs.current.set(key, node)
                    else tabRefs.current.delete(key)
                  }}
                  id={`world-tab-${key}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  aria-controls="world-index"
                  tabIndex={tab === key ? 0 : -1}
                  className="world-tab"
                  onClick={() => {
                    setTab(key)
                  }}
                  onKeyDown={(event) => {
                    onTabKey(event, key)
                  }}
                >
                  {key === 'terms' ? strings.worldBook.terms : strings.drawer.category[key]}
                </button>
              ))}
            </div>
            <div
              id="world-index"
              className="world-index"
              role="tabpanel"
              aria-labelledby={`world-tab-${tab}`}
            >
              <h2>{tab === 'terms' ? strings.worldBook.terms : strings.drawer.category[tab]}</h2>
              {worlds.isError && (
                <p className="chat-error" role="alert">
                  {strings.worldBook.loadFailed}
                </p>
              )}
              {tab === 'terms' ? (
                terms.length === 0 ? (
                  <p className="notes-empty">{strings.worldBook.noTerms}</p>
                ) : (
                  <ol className="world-entries">
                    {terms.map((term, index) => (
                      <li key={`${term.card.id}:${String(index)}`}>
                        <button
                          type="button"
                          className="world-entry"
                          onClick={() => {
                            show(term.card)
                          }}
                        >
                          <span>{term.term}</span>
                          <span className="leader" aria-hidden="true" />
                          <span className="status">{term.card.name}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )
              ) : (
                <>
                  {ordered.filter((card) => (card.data.category ?? 'other') === tab).length ===
                  0 ? (
                    <p className="notes-empty">{strings.worldBook.empty}</p>
                  ) : (
                    <ol className="world-entries">
                      {ordered
                        .filter((card) => (card.data.category ?? 'other') === tab)
                        .map((card) => (
                          <li key={card.id}>
                            <button
                              type="button"
                              className="world-entry"
                              aria-current={card.id === selected || undefined}
                              data-incomplete={card.status === 'incomplete' || undefined}
                              onClick={() => {
                                setSelected(card.id)
                              }}
                            >
                              <span>{card.name ?? strings.drawer.untitled}</span>
                              <span className="leader" aria-hidden="true" />
                              <span className="status">
                                {strings.worldBook.page(pageOf.get(card.id) ?? 0)}
                              </span>
                            </button>
                          </li>
                        ))}
                    </ol>
                  )}
                  {!locked && (
                    <button
                      type="button"
                      className="paper-button world-new"
                      onClick={() => {
                        setDrawer({ workId, type: 'world', category: tab })
                      }}
                    >
                      {strings.worldBook.newEntry}
                    </button>
                  )}
                </>
              )}
              {locked && work.data && <p className="notes-empty">{strings.worldBook.locked}</p>}
            </div>
          </section>
          <section className="page page-right world-entry-page" aria-live="polite">
            {entry === null ? (
              <p className="notes-empty">{strings.worldBook.pick}</p>
            ) : (
              <>
                <p className="drawer-kind">
                  {strings.drawer.category[entry.data.category ?? 'other']} ·{' '}
                  {strings.worldBook.page(pageOf.get(entry.id) ?? 0)}
                </p>
                <h2 className="world-entry-title">{entry.name ?? strings.drawer.untitled}</h2>
                {entry.data.summary && <p className="world-summary">{entry.data.summary}</p>}
                {entry.data.details && (
                  <>
                    <h3>{strings.worldBook.details}</h3>
                    <p>{entry.data.details}</p>
                  </>
                )}
                {entry.data.rules.length > 0 && (
                  <>
                    <h3>{strings.worldBook.rules}</h3>
                    <ol className="type-rules">
                      {entry.data.rules.map((rule, index) => (
                        <li key={index}>
                          <p>{rule.rule}</p>
                          {rule.exception && (
                            <p className="type-exception">
                              <span>{strings.worldBook.exception}</span> {rule.exception}
                            </p>
                          )}
                        </li>
                      ))}
                    </ol>
                  </>
                )}
                {entry.data.terms.length > 0 && (
                  <>
                    <h3>{strings.worldBook.termsHeading}</h3>
                    <dl className="type-terms">
                      {entry.data.terms.map((term, index) => (
                        <div key={index}>
                          <dt>{term.term}</dt>
                          <dd>{term.meaning}</dd>
                        </div>
                      ))}
                    </dl>
                  </>
                )}
                <h3>{strings.worldBook.related}</h3>
                {related.length === 0 ? (
                  <p className="notes-empty">{strings.worldBook.noRelated}</p>
                ) : (
                  <ul className="world-related">
                    {related.map((card) => (
                      <li key={card.id}>
                        {isWorld(card) ? (
                          <button
                            type="button"
                            className="world-link"
                            onClick={() => {
                              show(card)
                            }}
                          >
                            {card.name}
                          </button>
                        ) : card.type === 'character' ? (
                          <button
                            type="button"
                            className="world-link"
                            onClick={() => {
                              open({ name: 'characters', workId, cardId: card.id })
                            }}
                          >
                            {card.name}
                          </button>
                        ) : (
                          // The region map (step 1 unit 12) becomes a link once it exists.
                          <span>{card.name}</span>
                        )}
                        <span className="chat-mention-kind"> {strings.drawer.kind[card.type]}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="world-actions">
                  <button
                    type="button"
                    className="paper-button"
                    disabled={locked}
                    onClick={() => {
                      setDrawer({ workId, type: 'world', card_id: entry.id })
                    }}
                  >
                    {strings.worldBook.editSource}
                  </button>
                  <button
                    type="button"
                    className="paper-button"
                    data-danger
                    disabled={locked}
                    onClick={() => {
                      setDeleting(entry)
                    }}
                  >
                    {strings.worldBook.delete}
                  </button>
                </div>
              </>
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
          onSaved={(card) => {
            // After save the book opens the saved entry, where its category put it (§8).
            void queryClient.invalidateQueries({ queryKey: ['relations', workId] })
            if (isWorld(card)) show(card)
            else setSelected(card.id)
          }}
        />
      )}
      {deleting && (
        <DeleteCardDialog
          card={deleting}
          onCancel={() => {
            setDeleting(null)
          }}
          onDeleted={(until) => {
            setUndo({ card: deleting, until })
            setDeleting(null)
            setSelected(null)
          }}
        />
      )}
      {undo && (
        <UndoToast
          card={undo.card}
          until={undo.until}
          onDone={() => {
            setUndo(null)
          }}
          onRestored={(card) => {
            setUndo(null)
            if (isWorld(card)) show(card)
          }}
        />
      )}
    </>
  )
}
