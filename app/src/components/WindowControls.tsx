import { useEffect, useState } from 'react'
import { strings } from '../strings'

/** Minimize, maximize/restore and close, drawn for the paper top bar (§12). Like native caption
 * buttons they are not Tab stops (keyboard: Alt+F4, Win+arrows), so a stray Enter never closes
 * the app. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let live = true
    void window.aiplot.window.isMaximized().then((value) => {
      if (live) setMaximized(value)
    })
    const unsubscribe = window.aiplot.window.onMaximizedChange(setMaximized)
    return () => {
      live = false
      unsubscribe()
    }
  }, [])

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
        aria-label={maximized ? strings.window.restore : strings.window.maximize}
        title={maximized ? strings.window.restore : strings.window.maximize}
        onClick={() => {
          void window.aiplot.window.toggleMaximize()
        }}
      >
        {maximized ? (
          <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 2.5V0.5h7v7h-2" />
            <rect x="0.5" y="2.5" width="7" height="7" />
          </svg>
        ) : (
          <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        )}
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
