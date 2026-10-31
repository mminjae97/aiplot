import { useQuery } from '@tanstack/react-query'
import { api } from './client'

/** Images need the token, so the renderer fetches them; a data: URL needs no revoking and is
 * dropped with its query. */
async function dataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  // Chunks keep String.fromCharCode under the argument limit.
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return `data:${blob.type || 'image/webp'};base64,${btoa(binary)}`
}

export const coverKey = (workId: string, coverId: string) => ['cover', workId, coverId]

/** The cover illustration as an <img> source; null while loading, on error, or without one. */
export function useCoverImage(workId: string, coverId: string | null): string | null {
  const image = useQuery({
    queryKey: coverKey(workId, coverId ?? ''),
    queryFn: async () => dataUrl(await api.coverImage(workId, coverId ?? '')),
    enabled: coverId !== null,
    // A cover id names one file for good.
    staleTime: Infinity,
  })
  return coverId === null ? null : (image.data ?? null)
}
