import logo from '../assets/logo.png'
import { strings } from '../strings'
import { SetupChip } from './SetupChip'
import { WindowControls } from './WindowControls'

type Props = {
  onBack?: () => void
  /** The back button's words: "← 서재" from a book's contents, "← 목차" further in. */
  backLabel?: string
  /** A drawer or dialog is open: leaving would drop it unasked. */
  backDisabled?: boolean
  title?: string
  // Only once the server is up: the chip reads the setup job.
  showSetup?: boolean
}

/** Common top bar (§12) and the window's title bar (the window is always maximized: nothing
 * to drag), window buttons at the right. Logo + app name in the library; "← 서재" and the work title
 * inside a book. */
export function TopBar({ onBack, backLabel, backDisabled, title, showSetup = true }: Props) {
  return (
    <header className="top-bar">
      {onBack ? (
        <button type="button" className="top-bar-back" disabled={backDisabled} onClick={onBack}>
          {backLabel ?? strings.contents.back}
        </button>
      ) : (
        <h1 className="top-bar-brand">
          <img src={logo} alt="" width={24} height={24} />
          {strings.app.name}
        </h1>
      )}
      {title !== undefined && <h1 className="top-bar-title">{title}</h1>}
      {showSetup && <SetupChip />}
      <WindowControls />
    </header>
  )
}
