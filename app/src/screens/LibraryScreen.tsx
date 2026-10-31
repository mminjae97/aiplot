import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { type MenuPoint, bookButtonId } from '../components/BookItem'
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
  // The book focus goes back to once its menu or 책 꾸미기 closes.
  const returnTo = useRef<string | null>(null)
  const menuFor = useRef<string | null>(null)
  const openMenu = useCallback((work: Work, at: MenuPoint) => {
    returnTo.current = null
    menuFor.current = work.id
    setMenu({ workId: work.id, at })
  }, [])
  const closeMenu = useCallback((refocus: boolean) => {
    if (refocus) returnTo.current = menuFor.current
    setMenu(null)
  }, [])
  const openDecorate = useCallback((workId: string) => {
    returnTo.current = workId
    setDecorating(workId)
  }, [])
  const closeDecorate = useCallback(() => {
    setDecorating(null)
  }, [])
  useEffect(() => {
    // After the commit that drops inert: an inert book cannot take focus.
    if (menu !== null || decorating !== null || returnTo.current === null) return
    document.getElementById(bookButtonId(returnTo.current))?.focus()
    returnTo.current = null
  }, [menu, decorating])
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
            openDecorate(menuWork.id)
          }}
          onClose={closeMenu}
        />
      )}
      {decoratingWork && <DecorateDialog work={decoratingWork} onClose={closeDecorate} />}
    </>
  )
}
