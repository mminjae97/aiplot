import logo from '../assets/logo.png'
import { strings } from '../strings'
import { WindowControls } from './WindowControls'

type Props = {
  onBack?: () => void
  title?: string
}

/** Common top bar (§12) and the window's title bar: drag to move, double-click to maximize,
 * window buttons at the right. Logo + app name in the library; "← 서재" and the work title
 * inside a book. */
export function TopBar({ onBack, title }: Props) {
  return (
    <header className="top-bar">
      {onBack ? (
        <button type="button" className="top-bar-back" onClick={onBack}>
          {strings.contents.back}
        </button>
      ) : (
        <h1 className="top-bar-brand">
          <img src={logo} alt="" width={24} height={24} />
          {strings.app.name}
        </h1>
      )}
      {title !== undefined && <h1 className="top-bar-title">{title}</h1>}
      <WindowControls />
    </header>
  )
}
