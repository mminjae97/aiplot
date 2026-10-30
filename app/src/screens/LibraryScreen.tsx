import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { strings } from '../strings'

// Minimal list until the bookshelf (S0, §12) lands in the next change.
export function LibraryScreen() {
  const works = useQuery({ queryKey: ['works'], queryFn: api.listWorks })
  return (
    <main>
      <h1>{strings.app.name}</h1>
      {works.isError && (
        <p role="alert">
          {strings.library.loadFailed}{' '}
          <button
            type="button"
            onClick={() => {
              void works.refetch()
            }}
          >
            {strings.library.retry}
          </button>
        </p>
      )}
      {works.data?.works.length === 0 && <p>{strings.library.empty}</p>}
      {works.data && works.data.works.length > 0 && (
        <ul>
          {works.data.works.map((work) => (
            <li key={work.id}>{work.title}</li>
          ))}
        </ul>
      )}
    </main>
  )
}
