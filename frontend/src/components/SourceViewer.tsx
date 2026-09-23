import { useEffect, useRef, useState } from 'react'
import { Check, Download, PencilLine } from 'lucide-react'
import { api } from '../api'
import type { Document, Segment } from '../types'
import { useWorkspace } from '../context'
import { Badge, Modal, Spinner } from './UI'

export default function SourceViewer({
  id,
  highlight,
  close,
}: {
  id: string
  highlight?: string
  close: () => void
}) {
  const { project, reload, notify } = useWorkspace()
  const [document, setDocument] = useState<Document | null>(null),
    [error, setError] = useState(''),
    [editing, setEditing] = useState<string | null>(null),
    [busy, setBusy] = useState(false)
  const selectedRef = useRef<HTMLDivElement>(null)
  async function load() {
    try {
      setDocument(await api<Document>(`/documents/${id}`))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    void load()
  }, [id])
  useEffect(() => {
    if (document && highlight)
      selectedRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [document?.id, highlight])
  async function save(segment: Segment, department: string, is_function: boolean) {
    setBusy(true)
    try {
      await api(`/documents/${id}/segments/${segment.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ department, is_function }),
      })
      await load()
      await reload()
      setEditing(null)
      notify('Разметка сохранена. Запустите анализ заново, чтобы учесть изменения.')
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal drawer title="Исходный документ" close={close}>
      {error ? (
        <div className="modal-body error-box">{error}</div>
      ) : !document ? (
        <div className="modal-body">
          <Spinner />
          Открываем источник…
        </div>
      ) : (
        <>
          <div className="source-viewer-head">
            <Badge type={document.phase}>
              {document.phase === 'before' ? 'До реорганизации' : 'После реорганизации'}
            </Badge>
            <h2>{document.name}</h2>
            <div>
              <span>{document.function_count} функций распознано</span>
              <a className="text-button" href={`/api/documents/${id}/download`}>
                <Download size={14} />
                Скачать оригинал
              </a>
            </div>
            {document.warnings.map((w) => (
              <p className="source-warning" key={w}>
                {w}
              </p>
            ))}
          </div>
          <div className="source-content">
            {document.segments?.map((segment) => (
              <div
                className={`source-paragraph ${highlight === segment.id ? 'highlighted' : ''} ${segment.is_function ? 'is-function' : ''}`}
                key={segment.id}
                ref={highlight === segment.id ? selectedRef : undefined}
              >
                <div className="paragraph-meta">
                  <span>{segment.locator}</span>
                  <button
                    className="icon-button"
                    disabled={project.status === 'running'}
                    onClick={() => setEditing(editing === segment.id ? null : segment.id)}
                    title="Изменить разметку фрагмента"
                    aria-label={`Изменить ${segment.locator}`}
                  >
                    <PencilLine size={14} />
                  </button>
                </div>
                <p>{segment.text}</p>
                {segment.is_section_heading && !segment.is_function && (
                  <small className="paragraph-department">
                    Заголовок раздела · контекст для вложенных пунктов
                  </small>
                )}
                {segment.is_function && (
                  <small className="paragraph-department">
                    <Check size={12} />
                    {segment.department}
                    {segment.manual ? ' · проверено вручную' : ''}
                  </small>
                )}
                {editing === segment.id && (
                  <SegmentEditor
                    segment={segment}
                    busy={busy}
                    save={save}
                    cancel={() => setEditing(null)}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="drawer-footer">
            Цитаты сохранены без перефразирования. Разметку функций можно уточнить вручную.
          </div>
        </>
      )}
    </Modal>
  )
}
function SegmentEditor({
  segment,
  busy,
  save,
  cancel,
}: {
  segment: Segment
  busy: boolean
  save: (s: Segment, d: string, f: boolean) => void
  cancel: () => void
}) {
  const [department, setDepartment] = useState(segment.department),
    [isFunction, setIsFunction] = useState(segment.is_function)
  return (
    <form
      className="segment-editor"
      onSubmit={(e) => {
        e.preventDefault()
        save(segment, department, isFunction)
      }}
    >
      <label>
        Подразделение
        <input
          required
          maxLength={180}
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={isFunction}
          onChange={(e) => setIsFunction(e.target.checked)}
        />
        Фрагмент описывает функцию
      </label>
      <div>
        <button className="button primary small" disabled={busy || !department.trim()}>
          {busy ? <Spinner /> : 'Сохранить'}
        </button>
        <button className="button secondary small" type="button" onClick={cancel}>
          Отмена
        </button>
      </div>
    </form>
  )
}
