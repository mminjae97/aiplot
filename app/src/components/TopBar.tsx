import { strings } from '../strings'

type Props = {
  onBack?: () => void
  title?: string
}

/** Common top bar (§12): app name in the library; "← 서재" and the work title inside a book. */
export function TopBar({ onBack, title }: Props) {
  return (
    <header className="top-bar">
      {onBack ? (
        <button type="button" className="top-bar-back" onClick={onBack}>
          {strings.contents.back}
        </button>
      ) : (
        <h1>{strings.app.name}</h1>
      )}
      {title !== undefined && <h1 className="top-bar-title">{title}</h1>}
    </header>
  )
}
