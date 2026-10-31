import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { type MenuPoint, bookButtonId } from '../components/BookItem'
import { BookMenu, type BookAction } from '../components/BookMenu'
import { BookShelf } from '../components/BookShelf'
import { DecorateDialog } from '../components/DecorateDialog'
import { DeleteBookDialog } from '../components/DeleteBookDialog'
import { NewBookDialog } from '../components/NewBookDialog'
import { RenameDialog } from '../components/RenameDialog'
import { TopBar } from '../components/TopBar'
import { useNavigation } from '../stores/navigation'
import { strings } from '../strings'
import type { Work } from '../types'

const NEW_BOOK = 'new'

/** S0 library (§12): books on wooden shelves, newest first, "+" book last. */
export function LibraryScreen() {
  const works = useQuery({ queryKey: ['works'], queryFn: api.listWorks })
  const highlight = useNavigation((store) => store.highlight)
  const open = useNavigation((store) => store.open)
  const [creating, setCreating] = useState(false)
  const [menu, setMenu] = useState<{ workId: string; at: MenuPoint } | null>(null)
  // The book dialog a menu item opened.
  const [dialog, setDialog] = useState<{ action: BookAction; workId: string } | null>(null)
  const close = useCallback(() => {
    setCreating(false)
  }, [])
  // The book focus goes back to once its menu or dialog closes; NEW_BOOK after a delete.
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
  const openDialog = useCallback((action: BookAction, workId: string) => {
    returnTo.current = workId
    setDialog({ action, workId })
  }, [])
  const closeDialog = useCallback(() => {
    setDialog(null)
  }, [])
  const deleted = useCallback(() => {
    returnTo.current = NEW_BOOK
    setDialog(null)
  }, [])
  const openWork = useCallback(
    (work: Work) => {
      open({ name: 'contents', workId: work.id })
    },
    [open],
  )

  // Looked up by id so a refetch never leaves a stale copy open.
  const menuWork = works.data?.works.find((w) => w.id === menu?.workId)
  const dialogWork = works.data?.works.find((w) => w.id === dialog?.workId)
  // A dialog whose book is gone (deleted) is closed, and the shelf usable again.
  const shown = dialogWork ? dialog : null

  useEffect(() => {
    // After the commit that drops inert: an inert book cannot take focus.
    if (menu !== null || shown !== null || returnTo.current === null) return
    const book =
      returnTo.current === NEW_BOOK
        ? document.querySelector<HTMLElement>('.book-new')
        : document.getElementById(bookButtonId(returnTo.current))
    book?.focus()
    returnTo.current = null
  }, [menu, shown])

  return (
    <>
      <div className="screen">
        {/* The top bar is the title bar: it stays usable while a dialog is open. */}
        <TopBar />
        {/* inert keeps keyboard focus inside the dialog while it is open. */}
        <main className="library" inert={creating || shown !== null}>
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
          onAction={(action) => {
            openDialog(action, menuWork.id)
          }}
          onClose={closeMenu}
        />
      )}
      {dialogWork && shown?.action === 'decorate' && (
        <DecorateDialog work={dialogWork} onClose={closeDialog} />
      )}
      {dialogWork && shown?.action === 'rename' && (
        <RenameDialog work={dialogWork} onClose={closeDialog} />
      )}
      {dialogWork && shown?.action === 'delete' && (
        <DeleteBookDialog work={dialogWork} onClose={closeDialog} onDeleted={deleted} />
      )}
    </>
  )
}
