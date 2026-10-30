import { DESK_MARGIN, SPREAD_RATIO, TOP_BAR_HEIGHT } from '../src/styles/metrics'

export interface Size {
  width: number
  height: number
}

/**
 * Smallest window, in outer (frame-included) pixels: half the display's work area wide, so a
 * window snapped to half the screen still fits, and tall enough that the open book there is as
 * wide as that width allows. The open book is never smaller than in a half-screen window.
 */
export function minimumWindowSize(workArea: Size, frame: Size): Size {
  const width = Math.floor(workArea.width / 2)
  const spreadWidth = width - frame.width - DESK_MARGIN * 2
  const contentHeight = TOP_BAR_HEIGHT + DESK_MARGIN * 2 + spreadWidth / SPREAD_RATIO
  const height = Math.min(Math.ceil(contentHeight + frame.height), workArea.height)
  return { width, height }
}
