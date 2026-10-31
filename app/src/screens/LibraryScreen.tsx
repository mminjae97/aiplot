import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { api } from '../api/client'
import type { MenuPoint } from '../components/BookItem'
import { BookMenu } from '../components/BookMenu'
import { BookShelf } from '../components/BookShelf'
import { DecorateDialog } from '../components/DecorateDialog'
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
  const [menu, setMenu] = useState<{ workId: string; at: MenuPoint } | null>(null)
  const [decorating, setDecorating] = useState<string | null>(null)
  const close = useCallback(() => {
    setCreating(false)
  }, [])
  const closeMenu = useCallback(() => {
    setMenu(null)
  }, [])
  const closeDecorate = useCallback(() => {
    setDecorating(null)
  }, [])
  const openMenu = useCallback((work: Work, at: MenuPoint) => {
    setMenu({ workId: work.id, at })
  }, [])
  const openWork = useCallback(
    (work: Work) => {
      open({ name: 'contents', workId: work.id })
    },
    [open],
  )

  // Looked up by id so a refetch never leaves a stale copy open.
  const menuWork = works.data?.works.find((w) => w.id === menu?.workId)
  const decoratingWork = works.data?.works.find((w) => w.id === decorating)

  return (
    <>
      <div className="screen">
        {/* The top bar is the title bar: it stays usable while a dialog is open. */}
        <TopBar />
        {/* inert keeps keyboard focus inside the dialog while it is open. */}
        <main className="library" inert={creating || decorating !== null}>
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
              onMenu={openMenu}
              onNew={() => {
                setCreating(true)
              }}
            />
          )}
        </main>
      </div>
      {creating && <NewBookDialog onClose={close} onCreated={openWork} />}
      {menuWork && menu && (
        <BookMenu
          title={menuWork.title}
          at={menu.at}
          onDecorate={() => {
            setDecorating(menuWork.id)
          }}
          onClose={closeMenu}
        />
      )}
      {decoratingWork && <DecorateDialog work={decoratingWork} onClose={closeDecorate} />}
    </>
  )
}
