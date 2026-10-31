// Every cover illustration is stored the same way (§16 covers): the centre of the picture
// cut to portrait 1:1.5 and encoded as WebP at twice the shelf size.

export const COVER_PIXELS = { width: 600, height: 900 }
const QUALITY = 0.9

export class CoverImageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CoverImageError'
  }
}

/** The centred 1:1.5 window inside a width × height picture. */
export function centreCrop(width: number, height: number) {
  const ratio = COVER_PIXELS.width / COVER_PIXELS.height
  const w = Math.min(width, height * ratio)
  const h = w / ratio
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h }
}

export async function cropCover(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new CoverImageError('not a readable image')
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = COVER_PIXELS.width
    canvas.height = COVER_PIXELS.height
    const context = canvas.getContext('2d')
    if (!context) throw new CoverImageError('no 2d canvas')
    const crop = centreCrop(bitmap.width, bitmap.height)
    context.imageSmoothingQuality = 'high'
    context.drawImage(
      bitmap,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', QUALITY)
    })
    if (blob?.type !== 'image/webp') throw new CoverImageError('WebP encoding failed')
    return blob
  } finally {
    bitmap.close()
  }
}
