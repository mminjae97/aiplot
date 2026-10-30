import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { api } from '../api/client'
import { BookShelf } from '../components/BookShelf'
import { NewBookDialog } from '../components/NewBookDialog'
import { TopBar } from '../components/TopBar'
import { useNavigation } from '../stores/navigation'
import { strings } from '../strings'
import type { Work } from '../types'

/** S0 library (§12): books on wooden shelves, newest first, "+" book last. */
export function LibraryScreen() {
  const works = useQuery({ queryKey: ['works'], queryFn: api.listWorks })
  const highlight = useNavigation((store) => store.highlight)
  const open = useNavigation((store) => store.open)
  const [creating, setCreating] = useState(false)
  const close = useCallback(() => {
    setCreating(false)
  }, [])
  const openWork = useCallback(
    (work: Work) => {
      open({ name: 'contents', workId: work.id })
    },
    [open],
  )

  return (
    <>
      <TopBar />
      <main className="library">
        {works.isError && (
          <p className="library-alert" role="alert">
            {strings.library.loadFailed}{' '}
            <button
              type="button"
              className="paper-button"
              onClick={() => {
                void works.refetch()
              }}
            >
              {strings.library.retry}
            </button>
          </p>
        )}
        {works.data && (
          <BookShelf
            works={works.data.works}
            highlight={highlight}
            onOpen={openWork}
            onNew={() => {
              setCreating(true)
            }}
          />
        )}
      </main>
      {creating && <NewBookDialog onClose={close} onCreated={openWork} />}
    </>
  )
}
