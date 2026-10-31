import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type SubmitEvent, useEffect, useState } from 'react'
import { ApiRequestError, api } from '../api/client'
import {
  type JobLive,
  needsSetup,
  useHealth,
  useJobLive,
  useSetupJob,
  useSetupStatus,
} from '../api/setup'
import { TopBar } from '../components/TopBar'
import { formatBytes, formatEta, percentOf, stepText } from '../components/setupText'
import { useNavigation } from '../stores/navigation'
import { strings } from '../strings'
import type { SetupItem, SetupStatus } from '../types'

function errorText(code: string): string {
  return strings.setup.errors[code] ?? strings.setup.failed
}

function itemStatus(item: SetupItem): string {
  if (item.status === 'installed') return strings.setup.installed
  if (item.status === 'partial') {
    return strings.setup.partial(percentOf(item.present_bytes, item.total_bytes))
  }
  return strings.setup.missing
}

function Files({ status }: { status: SetupStatus }) {
  return (
    <section className="setup-files" aria-labelledby="setup-files-title">
      <h2 id="setup-files-title">{strings.setup.filesTitle}</h2>
      <ul>
        {status.items.map((item) => (
          <li key={item.id} data-status={item.status}>
            <span className="setup-file-name">
              {item.id === 'llama' ? strings.setup.llama : strings.setup.model}
            </span>
            <span className="setup-file-size">{formatBytes(item.total_bytes)}</span>
            <span className="setup-file-status">
              {itemStatus(item)}
              {item.custom && ` · ${strings.setup.custom}`}
            </span>
            <span className="setup-file-path">{item.path}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

type ProgressProps = { jobId: string; live: JobLive; onBackground: () => void }

function Progress({ jobId, live, onBackground }: ProgressProps) {
  const control = useMutation({
    mutationFn: (action: 'pause' | 'resume' | 'cancel') =>
      action === 'pause'
        ? api.pauseJob(jobId)
        : action === 'resume'
          ? api.resumeJob(jobId)
          : api.cancelJob(jobId),
  })
  const progress = live.progress
  const percent = progress ? percentOf(progress.done, progress.total) : 0
  return (
    <section className="setup-progress" aria-live="polite">
      <p className="setup-step">
        {live.paused ? strings.setup.paused : stepText(progress?.step ?? null)}
      </p>
      <progress
        max={100}
        value={progress ? percent : undefined}
        aria-label={strings.setup.progressLabel}
      />
      <p className="setup-numbers">
        {progress && (
          <span>
            {percent}% ·{' '}
            {strings.setup.bytes(formatBytes(progress.done), formatBytes(progress.total))}
          </span>
        )}
        {!live.paused && (
          <span>
            {progress?.etaSec != null
              ? strings.setup.eta(formatEta(progress.etaSec))
              : strings.setup.etaUnknown}
          </span>
        )}
      </p>
      <div className="setup-actions">
        <button
          type="button"
          className="paper-button"
          disabled={control.isPending}
          onClick={() => {
            control.mutate(live.paused ? 'resume' : 'pause')
          }}
        >
          {live.paused ? strings.setup.continue : strings.setup.pause}
        </button>
        <button
          type="button"
          className="paper-button"
          disabled={control.isPending}
          onClick={() => {
            control.mutate('cancel')
          }}
        >
          {strings.setup.cancel}
        </button>
        <button type="button" className="paper-button" data-primary onClick={onBackground}>
          {strings.setup.background}
        </button>
      </div>
    </section>
  )
}

type PathsProps = { status: SetupStatus; onStarted: (jobId: string) => void; onBack: () => void }

function Paths({ status, onStarted, onBack }: PathsProps) {
  const current = (id: 'llama' | 'model') => {
    const item = status.items.find((i) => i.id === id)
    return item?.custom ? item.path : null
  }
  // null = the default location under the data dir.
  const [model, setModel] = useState(current('model'))
  const [llama, setLlama] = useState(current('llama'))
  const save = useMutation({
    mutationFn: () => api.setPaths({ model_path: model, llama_dir: llama }),
    onSuccess: (accepted) => {
      onStarted(accepted.jobId)
    },
  })
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!save.isPending) save.mutate()
  }
  const row = (
    id: string,
    label: string,
    value: string | null,
    set: (value: string | null) => void,
    pick: () => Promise<string | null>,
  ) => (
    <div className="setup-path">
      <label htmlFor={id}>{label}</label>
      <div className="setup-path-row">
        <input
          id={id}
          value={value ?? ''}
          placeholder={strings.setup.defaultPath}
          spellCheck={false}
          onChange={(event) => {
            set(event.target.value.trim() === '' ? null : event.target.value)
          }}
        />
        <button
          type="button"
          className="paper-button"
          onClick={() => {
            void pick().then((picked) => {
              if (picked !== null) set(picked)
            })
          }}
        >
          {strings.setup.browse}
        </button>
        <button
          type="button"
          className="paper-button"
          disabled={value === null}
          onClick={() => {
            set(null)
          }}
        >
          {strings.setup.useDefault}
        </button>
      </div>
    </div>
  )
  return (
    <form className="setup-paths" onSubmit={submit} aria-labelledby="setup-paths-title">
      <h2 id="setup-paths-title">{strings.setup.pathsTitle}</h2>
      {row('setup-model', strings.setup.modelPath, model, setModel, () =>
        window.aiplot.dialog.pickModel(),
      )}
      {row('setup-llama', strings.setup.llamaDir, llama, setLlama, () =>
        window.aiplot.dialog.pickFolder(),
      )}
      {save.isError && (
        <p className="setup-error" role="alert">
          {save.error instanceof ApiRequestError
            ? errorText(save.error.code)
            : strings.setup.failed}
        </p>
      )}
      <div className="setup-actions">
        <button type="button" className="paper-button" onClick={onBack}>
          {strings.setup.back}
        </button>
        <button
          type="submit"
          className="paper-button"
          data-primary
          disabled={save.isPending}
          aria-busy={save.isPending}
        >
          {save.isPending && <span className="spinner" aria-hidden="true" />}
          {strings.setup.check}
        </button>
      </div>
    </form>
  )
}

/** S0-1 first run (§12): what Aiplot can and can't do, then download llama.cpp + the base
 * model (resumable, verified) or point to files the user has. Skippable; downloads keep going
 * from the library. */
export function SetupScreen() {
  const queryClient = useQueryClient()
  const open = useNavigation((store) => store.open)
  const health = useHealth()
  const status = useSetupStatus()
  const jobId = useSetupJob((store) => store.jobId)
  const follow = useSetupJob((store) => store.follow)
  const acknowledge = useSetupJob((store) => store.acknowledge)
  const live = useJobLive(jobId)
  const [choosing, setChoosing] = useState(false)
  const toLibrary = () => {
    open({ name: 'library' })
  }
  const started = (id: string) => {
    setChoosing(false)
    follow(id)
    void queryClient.invalidateQueries({ queryKey: ['setup'] })
  }
  const download = useMutation({
    mutationFn: api.startDownload,
    onSuccess: (accepted) => {
      started(accepted.jobId)
    },
  })
  const retryLlama = useMutation({
    mutationFn: api.retryLlama,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['health'] }),
  })

  const running = live !== null && live.final === null && jobId !== null
  const state = health.data?.llama.state
  const missing = health.data ? needsSetup(health.data) && state !== 'error' : true
  const finalError = live?.final?.type === 'error' ? live.final : null
  const downloadError =
    download.error instanceof ApiRequestError ? errorText(download.error.code) : null
  const ended = live?.final != null

  useEffect(() => {
    // How the last job ended is shown here, so the top-bar chip can stop saying it.
    if (jobId !== null && ended) acknowledge(jobId)
  }, [jobId, ended, acknowledge])

  const later = (
    <button type="button" className="paper-button" onClick={toLibrary}>
      {strings.setup.later}
    </button>
  )
  const usePaths = (
    <button
      type="button"
      className="paper-button"
      onClick={() => {
        setChoosing(true)
      }}
    >
      {strings.setup.usePaths}
    </button>
  )

  let body
  if (running) {
    body = <Progress jobId={jobId} live={live} onBackground={toLibrary} />
  } else if (choosing && status.data) {
    body = (
      <Paths
        status={status.data}
        onStarted={started}
        onBack={() => {
          setChoosing(false)
        }}
      />
    )
  } else if (state === 'starting' || state === 'stopped') {
    body = (
      <section className="setup-status" role="status" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
        <p>{strings.setup.loading}</p>
        <p className="setup-note">{strings.setup.loadingNote}</p>
        {/* A wait over 10 s keeps a way out (§5); loading goes on without this screen. */}
        <div className="setup-actions">{later}</div>
      </section>
    )
  } else if (state === 'ready' || state === 'fake') {
    body = (
      <section className="setup-status" role="status">
        <p className="setup-done">{strings.setup.ready}</p>
        <p className="setup-note">{strings.setup.readyNote}</p>
        <div className="setup-actions">
          <button type="button" className="paper-button" data-primary onClick={toLibrary}>
            {strings.setup.start}
          </button>
        </div>
      </section>
    )
  } else if (state === 'error') {
    body = (
      <section className="setup-status">
        <p className="setup-error" role="alert">
          {strings.setup.llamaError} {health.data?.llama.message}
        </p>
        <div className="setup-actions">
          {later}
          {/* The files may be what fails: other ones can be picked from here too. */}
          {usePaths}
          <button
            type="button"
            className="paper-button"
            data-primary
            disabled={retryLlama.isPending}
            onClick={() => {
              retryLlama.mutate()
            }}
          >
            {strings.setup.retry}
          </button>
        </div>
      </section>
    )
  } else if (status.data && missing) {
    const partial = status.data.items.some((item) => item.status === 'partial')
    const short = status.data.remaining_bytes > status.data.free_bytes
    body = (
      <>
        <Files status={status.data} />
        <p className="setup-space" data-short={short || undefined}>
          {strings.setup.space(
            formatBytes(status.data.remaining_bytes),
            formatBytes(status.data.free_bytes),
          )}
        </p>
        {short && (
          <p className="setup-warning" role="alert">
            {strings.setup.noSpace}
          </p>
        )}
        {downloadError && (
          <p className="setup-error" role="alert">
            {downloadError}
          </p>
        )}
        {live?.final?.type === 'cancelled' && (
          <p className="setup-note">{strings.setup.cancelled}</p>
        )}
        <div className="setup-actions">
          {later}
          {usePaths}
          <button
            type="button"
            className="paper-button"
            data-primary
            disabled={short || download.isPending}
            aria-busy={download.isPending}
            onClick={() => {
              download.mutate()
            }}
          >
            {download.isPending && <span className="spinner" aria-hidden="true" />}
            {partial ? strings.setup.resume : strings.setup.download}
          </button>
        </div>
      </>
    )
  } else {
    body = (
      <section className="setup-status" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
        <div className="setup-actions">{later}</div>
      </section>
    )
  }

  return (
    <div className="screen">
      <TopBar />
      <main className="setup">
        <article className="setup-sheet">
          <h1>{strings.setup.title}</h1>
          <p className="setup-lead">{strings.setup.lead}</p>
          <div className="setup-about">
            <section aria-labelledby="setup-can">
              <h2 id="setup-can">{strings.setup.canTitle}</h2>
              <ul>
                {strings.setup.can.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="setup-limits">
              <h2 id="setup-limits">{strings.setup.limitsTitle}</h2>
              <ul>
                {strings.setup.limits.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          </div>
          {/* A download or path check that failed, whatever state the files are in now. */}
          {!running && finalError && (
            <p className="setup-error" role="alert">
              {errorText(finalError.code)}
            </p>
          )}
          {body}
        </article>
      </main>
    </div>
  )
}
