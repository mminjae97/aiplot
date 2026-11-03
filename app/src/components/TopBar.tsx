import logo from '../assets/logo.png'
import { strings } from '../strings'
import { SetupChip } from './SetupChip'
import { WindowControls } from './WindowControls'

type Props = {
  onBack?: () => void
  /** A drawer or dialog is open: leaving would drop it unasked. */
  backDisabled?: boolean
  title?: string
  /** The work title leads to the book's contents (§12); undefined there already. */
  onTitle?: () => void
  // Only once the server is up: the chip reads the setup job.
  showSetup?: boolean
}

/** Common top bar (§12) and the window's title bar (the window is always maximized: nothing
 * to drag), window buttons at the right. Logo + app name in the library; "← 서재" and the work title
 * inside a book; the title opens the contents. */
export function TopBar({
  onBack,
  backDisabled,
  title,
  onTitle,
  showSetup = true,
}: Props) {
  return (
    <header className="top-bar">
      {onBack ? (
        <button type="button" className="top-bar-back" disabled={backDisabled} onClick={onBack}>
          {strings.contents.back}
        </button>
      ) : (
        <h1 className="top-bar-brand">
          <img src={logo} alt="" width={24} height={24} />
          {strings.app.name}
        </h1>
      )}
      {title !== undefined && (
        <h1 className="top-bar-title">
          {onTitle ? (
            <button
              type="button"
              className="top-bar-title-link"
              title={strings.book.toContents}
              disabled={backDisabled}
              onClick={onTitle}
            >
              {title}
            </button>
          ) : (
            title
          )}
        </h1>
      )}
      {showSetup && <SetupChip />}
      <WindowControls />
    </header>
  )
}
