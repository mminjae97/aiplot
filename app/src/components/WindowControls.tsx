import { strings } from '../strings'

/** Minimize and close, drawn for the paper top bar (§12); the window is always maximized, so
 * there is no maximize/restore button. Like native caption buttons they are not Tab stops
 * (keyboard: Alt+F4), so a stray Enter never closes the app. */
export function WindowControls() {
  return (
    <div className="window-controls">
      <button
        type="button"
        tabIndex={-1}
        aria-label={strings.window.minimize}
        title={strings.window.minimize}
        onClick={() => {
          void window.aiplot.window.minimize()
        }}
      >
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5.5h10" />
        </svg>
      </button>
      <button
        type="button"
        tabIndex={-1}
        className="window-close"
        aria-label={strings.window.close}
        title={strings.window.close}
        onClick={() => {
          void window.aiplot.window.close()
        }}
      >
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </svg>
      </button>
    </div>
  )
}
