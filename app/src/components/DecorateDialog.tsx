import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ChangeEvent, type SubmitEvent, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { coverKey, useCoverImage } from '../api/covers'
import { strings } from '../strings'
import type { Cover, Work } from '../types'
import { BookFront, bookStyle } from './BookFront'
import { PRESETS, colorOf } from './bookColor'
import { CoverImageError, cropCover } from './cropCover'

type Props = {
  work: Work
  onClose: () => void
}

type Mode = 'color' | 'illustration'

type ChoiceProps = {
  work: Work
  cover: Cover
  index: number
  checked: boolean
  confirming: boolean
  removing: boolean
  onPick: () => void
  onRemove: () => void
  onConfirm: () => void
  onKeep: () => void
}

function IllustrationChoice(props: ChoiceProps) {
  const { work, cover, index, checked, confirming, removing } = props
  const image = useCoverImage(work.id, cover.id)
  const keep = useRef<HTMLButtonElement>(null)
  const remove = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(confirming)
  useEffect(() => {
    // The pressed button is swapped out: focus the safe choice, then back to 지우기 — only if
    // focus fell out with it, not when it moved on to another illustration's confirmation.
    const lost = document.activeElement === null || document.activeElement === document.body
    if (confirming) keep.current?.focus()
    else if (wasConfirming.current && lost) remove.current?.focus()
    wasConfirming.current = confirming
  }, [confirming])
  const label = strings.decorate.illustration(index + 1)
  return (
    <li className="decorate-illustration" data-checked={checked || undefined}>
      <label>
        <input
          type="radio"
          name="decorate-illustration"
          checked={checked}
          aria-label={label}
          onChange={props.onPick}
        />
        <span className="decorate-thumb" style={bookStyle(colorOf(work))}>
          {image && <img src={image} alt="" />}
        </span>
      </label>
      {confirming ? (
        <div className="decorate-confirm" role="group" aria-label={label}>
          <p>{strings.decorate.removeConfirm}</p>
          <button ref={keep} type="button" className="paper-button" onClick={props.onKeep}>
            {strings.decorate.removeNo}
          </button>
          <button
            type="button"
            className="paper-button"
            data-danger
            disabled={removing}
            aria-busy={removing}
            onClick={props.onConfirm}
          >
            {removing && <span className="spinner" aria-hidden="true" />}
            {strings.decorate.removeYes}
          </button>
        </div>
      ) : (
        <button
          ref={remove}
          type="button"
          className="decorate-remove"
          aria-label={`${label} ${strings.decorate.remove}`}
          onClick={props.onRemove}
        >
          {strings.decorate.remove}
        </button>
      )}
    </li>
  )
}

/** 책 꾸미기 (§12 S0): book colour (presets or any colour) and cover = colour | illustration.
 * Uploads and removals happen at once; colour and cover choice apply on 저장. */
export function DecorateDialog({ work, onClose }: Props) {
  const queryClient = useQueryClient()
  const first = useRef<HTMLInputElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const uploadButton = useRef<HTMLButtonElement>(null)
  // null keeps the default colour, stable per work id.
  const [color, setColor] = useState(work.color)
  const [mode, setMode] = useState<Mode>(work.cover_id ? 'illustration' : 'color')
  const [picked, setPicked] = useState(work.cover_id)
  const [confirming, setConfirming] = useState<string | null>(null)
  const covers = useQuery({
    queryKey: ['covers', work.id],
    queryFn: () => api.listCovers(work.id),
  })
  const shown = colorOf({ id: work.id, color })
  const preview = useCoverImage(work.id, mode === 'illustration' ? picked : null)

  const upload = useMutation({
    mutationFn: async (picture: File) => api.uploadCover(work.id, await cropCover(picture)),
    onSuccess: async (cover) => {
      setPicked(cover.id)
      setMode('illustration')
      await queryClient.invalidateQueries({ queryKey: ['covers', work.id] })
    },
  })
  const remove = useMutation({
    mutationFn: (coverId: string) => api.deleteCover(work.id, coverId),
    onSuccess: async (_, coverId) => {
      setConfirming(null)
      if (picked === coverId) setPicked(null)
      queryClient.removeQueries({ queryKey: coverKey(work.id, coverId) })
      // Removing the cover in use turns the book back to cloth on the shelf too.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['covers', work.id] }),
        queryClient.invalidateQueries({ queryKey: ['works'] }),
      ])
      // Its item is gone; keep focus inside the dialog.
      uploadButton.current?.focus()
    },
  })
  const save = useMutation({
    mutationFn: () =>
      api.updateWork(work.id, { color, cover_id: mode === 'illustration' ? picked : null }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['works'] }),
  })

  useEffect(() => {
    // The library gives focus back to the book once the dialog is gone.
    first.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const picture = event.target.files?.[0]
    // The same file can be chosen again after an error.
    event.target.value = ''
    if (picture) upload.mutate(picture)
  }
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (save.isPending) return
    save.mutate(undefined, { onSuccess: onClose })
  }

  const list = covers.data?.covers ?? []
  const needsPick = mode === 'illustration' && picked === null
  const error = upload.isError
    ? upload.error instanceof CoverImageError
      ? strings.decorate.notImage
      : strings.decorate.uploadFailed
    : remove.isError
      ? strings.decorate.removeFailed
      : save.isError
        ? strings.decorate.saveFailed
        : null

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
        className="decorate"
        role="dialog"
        aria-modal="true"
        aria-labelledby="decorate-title"
        onSubmit={submit}
      >
        <h2 id="decorate-title">{strings.decorate.title}</h2>
        <div className="decorate-body">
          <div className="decorate-preview" style={bookStyle(shown)} aria-hidden="true">
            <BookFront title={work.title} stage={strings.stage[work.stage]} image={preview} />
          </div>
          <div className="decorate-controls">
            <fieldset className="decorate-modes">
              <legend>{strings.decorate.cover}</legend>
              {(['color', 'illustration'] as const).map((value, index) => (
                <label key={value}>
                  <input
                    ref={index === 0 ? first : undefined}
                    type="radio"
                    name="decorate-mode"
                    checked={mode === value}
                    onChange={() => {
                      setMode(value)
                    }}
                  />
                  {value === 'color'
                    ? strings.decorate.coverColor
                    : strings.decorate.coverIllustration}
                </label>
              ))}
            </fieldset>

            <fieldset>
              <legend>{strings.decorate.color}</legend>
              <div className="decorate-swatches">
                {PRESETS.map((preset) => (
                  <label key={preset.color} className="decorate-swatch" title={preset.name}>
                    <input
                      type="radio"
                      name="decorate-color"
                      aria-label={preset.name}
                      checked={shown === preset.color}
                      onChange={() => {
                        setColor(preset.color)
                      }}
                    />
                    <span style={{ background: preset.color }} />
                  </label>
                ))}
                <label className="decorate-custom">
                  <input
                    type="color"
                    value={shown}
                    onChange={(event) => {
                      setColor(event.target.value.toLowerCase())
                    }}
                  />
                  {strings.decorate.custom}
                </label>
              </div>
              <p className="decorate-note">{strings.decorate.colorNote}</p>
            </fieldset>

            {mode === 'illustration' && (
              <fieldset>
                <legend>{strings.decorate.illustrations}</legend>
                {list.length === 0 && covers.isSuccess && (
                  <p className="decorate-note">{strings.decorate.noIllustrations}</p>
                )}
                <ul className="decorate-illustrations">
                  {list.map((cover, index) => (
                    <IllustrationChoice
                      key={cover.id}
                      work={work}
                      cover={cover}
                      index={index}
                      checked={picked === cover.id}
                      confirming={confirming === cover.id}
                      removing={remove.isPending && remove.variables === cover.id}
                      onPick={() => {
                        setPicked(cover.id)
                      }}
                      onRemove={() => {
                        remove.reset()
                        setConfirming(cover.id)
                      }}
                      onConfirm={() => {
                        remove.mutate(cover.id)
                      }}
                      onKeep={() => {
                        setConfirming(null)
                      }}
                    />
                  ))}
                </ul>
                <input
                  ref={file}
                  type="file"
                  accept="image/*"
                  hidden
                  aria-label={strings.decorate.upload}
                  onChange={choose}
                />
                <button
                  ref={uploadButton}
                  type="button"
                  className="paper-button"
                  disabled={upload.isPending}
                  aria-busy={upload.isPending}
                  onClick={() => {
                    upload.reset()
                    file.current?.click()
                  }}
                >
                  {upload.isPending && <span className="spinner" aria-hidden="true" />}
                  {strings.decorate.upload}
                </button>
                <p className="decorate-note">{strings.decorate.illustrationNote}</p>
              </fieldset>
            )}
          </div>
        </div>
        <p className="decorate-error" role="alert">
          {error ?? (needsPick && list.length > 0 ? strings.decorate.pickIllustration : null)}
        </p>
        <div className="decorate-actions">
          <button type="button" className="paper-button" onClick={onClose}>
            {strings.decorate.cancel}
          </button>
          <button
            type="submit"
            className="paper-button"
            data-primary
            disabled={needsPick || save.isPending}
            aria-busy={save.isPending}
          >
            {save.isPending && <span className="spinner" aria-hidden="true" />}
            {strings.decorate.save}
          </button>
        </div>
      </form>
    </div>
  )
}
