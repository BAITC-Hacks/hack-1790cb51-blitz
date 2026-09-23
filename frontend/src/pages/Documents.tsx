import { useEffect, useRef, useState, type DragEvent } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  Download,
  FileText,
  RefreshCw,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import { api, bytes } from '../api'
import { useWorkspace } from '../context'
import type { Document, Phase } from '../types'
import { Modal, PageTitle, Spinner } from '../components/UI'

export default function Documents() {
  const { project, reload, notify, openDocument, openAnalysis, navigate, setDocumentBusy } =
    useWorkspace()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setDocumentBusy(busy)
    return () => setDocumentBusy(false)
  }, [busy, setDocumentBusy])
  const inFlight = useRef(false)
  const [uploadMessage, setUploadMessage] = useState('')
  const [dragging, setDragging] = useState<Phase | null>(null)
  const [errors, setErrors] = useState<Partial<Record<Phase, string>>>({})
  const [deleting, setDeleting] = useState<Document | null>(null)
  const [replacement, setReplacement] = useState<{ file: File; document: Document } | null>(null)
  const beforeRef = useRef<HTMLInputElement>(null)
  const afterRef = useRef<HTMLInputElement>(null)
  const disabled = busy || project.status === 'running'
  const phases = ['before', 'after'] as const
  const ready = phases.every(
    (phase) => project.documents.filter((d) => d.phase === phase).length === 1,
  )
  const legacy = phases.some(
    (phase) => project.documents.filter((d) => d.phase === phase).length > 1,
  )
  const errorFor = (phase: Phase, message: string) =>
    setErrors((items) => ({ ...items, [phase]: message }))

  async function upload(file: File, phase: Phase, replaceId?: string) {
    if (inFlight.current || project.status === 'running') return
    inFlight.current = true
    setBusy(true)
    errorFor(phase, '')
    setUploadMessage(`Загружаем ${file.name}…`)
    const body = new FormData()
    body.append('file', file)
    body.append('phase', phase)
    if (replaceId) body.append('replace_document_id', replaceId)
    try {
      await api(`/projects/${project.id}/documents`, { method: 'POST', body })
      setReplacement(null)
      await reload()
      notify(replaceId ? 'Файл заменён. Для новых данных запустите анализ.' : 'Файл загружен')
    } catch (error) {
      errorFor(phase, (error as Error).message)
      setReplacement(null)
    } finally {
      inFlight.current = false
      setBusy(false)
      setUploadMessage('')
    }
  }

  function select(files: FileList | File[] | null, phase: Phase) {
    if (!files?.length || disabled || inFlight.current) return
    if (files.length !== 1) {
      errorFor(phase, 'Выберите только один файл. Ничего не загружено.')
      return
    }
    const documents = project.documents.filter((d) => d.phase === phase)
    if (documents.length > 1) {
      errorFor(phase, 'Сначала оставьте в этом блоке один файл. Старые документы доступны ниже.')
      return
    }
    const file = files[0]
    if (!/\.(docx|pdf|xlsx|txt|csv)$/i.test(file.name)) {
      errorFor(phase, 'Поддерживаются DOCX, PDF, XLSX, TXT и CSV.')
      return
    }
    if (!file.size || file.size > 10 * 1024 * 1024) {
      errorFor(phase, 'Файл должен быть непустым и не превышать 10 МБ.')
      return
    }
    errorFor(phase, '')
    if (documents.length) setReplacement({ file, document: documents[0] })
    else void upload(file, phase)
  }

  async function remove() {
    if (!deleting || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      await api(`/documents/${deleting.id}`, { method: 'DELETE' })
      errorFor(deleting.phase, '')
      setDeleting(null)
      await reload()
      notify('Файл удалён из проекта')
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  function drop(e: DragEvent, phase: Phase) {
    e.preventDefault()
    setDragging(null)
    select(e.dataTransfer.files, phase)
  }

  return (
    <div className="documents-workspace">
      <PageTitle
        title="Сравните два документа"
        description="Узнайте, какие обязанности сохранились, изменились или остались без преемника."
      />
      <div className="upload-guide">
        <span>
          <FileText size={16} /> Две версии документа
        </span>
        <ArrowRight size={15} aria-hidden="true" />
        <span>Сравнение по смыслу</span>
        <ArrowRight size={15} aria-hidden="true" />
        <span>Выводы с источниками</span>
      </div>
      <div className="upload-grid">
        {phases.map((phase) => {
          const documents = project.documents.filter((d) => d.phase === phase)
          const label = phase === 'before' ? 'До' : 'После'
          const inputRef = phase === 'before' ? beforeRef : afterRef
          return (
            <section
              className={`upload-card document-slot slot-${phase} ${dragging === phase ? 'dragging' : ''}`}
              key={phase}
              aria-labelledby={`slot-${phase}`}
              aria-busy={busy}
              onDragOver={(e) => {
                e.preventDefault()
                if (!disabled && documents.length <= 1) setDragging(phase)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(null)
              }}
              onDrop={(e) => drop(e, phase)}
            >
              <div className="slot-heading">
                <div>
                  <span className="slot-version">
                    {phase === 'before' ? '01 / ИСХОДНАЯ ВЕРСИЯ' : '02 / НОВАЯ ВЕРСИЯ'}
                  </span>
                  <h2 id={`slot-${phase}`}>{label} реорганизации</h2>
                  <p>
                    {phase === 'before'
                      ? 'Исходные обязанности и подразделения'
                      : 'Обязанности и подразделения после изменений'}
                  </p>
                </div>
                {documents.length === 1 && <CheckCircle2 size={20} aria-label="Файл загружен" />}
              </div>
              {documents.length > 1 && (
                <p className="slot-warning">
                  В старом проекте здесь {documents.length} файла. Скачайте нужные копии и оставьте
                  один для анализа.
                </p>
              )}
              {documents.length ? (
                documents.map((document) => (
                  <div className="slot-file" key={document.id}>
                    <button className="slot-file-name" onClick={() => openDocument(document.id)}>
                      <FileText size={24} />
                      <span>
                        <strong>{document.name}</strong>
                        <small>
                          {document.name.split('.').pop()?.toUpperCase()} · {bytes(document.size)}
                        </small>
                      </span>
                    </button>
                    <p className="slot-file-meta">
                      Распознано функций: {document.function_count} · подразделений:{' '}
                      {document.departments.length}
                    </p>
                    {document.warnings.length > 0 && (
                      <details className="slot-warnings">
                        <summary>Что проверить в документе ({document.warnings.length})</summary>
                        <ul>
                          {document.warnings.map((warning, index) => (
                            <li key={index}>{warning}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <div className="slot-actions">
                      <button
                        className="button secondary"
                        onClick={() => openDocument(document.id)}
                      >
                        Проверить текст
                      </button>
                      {documents.length === 1 && (
                        <button
                          className="text-button"
                          disabled={disabled}
                          onClick={() => inputRef.current?.click()}
                        >
                          <RefreshCw size={15} />
                          Заменить файл
                        </button>
                      )}
                      <a
                        className="icon-button"
                        href={`/api/documents/${document.id}/download`}
                        aria-label={`Скачать ${document.name}`}
                        title="Скачать оригинал"
                      >
                        <Download size={17} />
                      </a>
                      <button
                        className="icon-button danger"
                        disabled={disabled}
                        onClick={() => setDeleting(document)}
                        aria-label={`Удалить ${document.name}`}
                        title="Удалить из проекта"
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <button
                  className="dropzone"
                  disabled={disabled}
                  onClick={() => inputRef.current?.click()}
                  aria-label={`Выбрать файл ${label.toLowerCase()}`}
                >
                  <UploadCloud size={28} />
                  <strong>Выбрать файл</strong>
                  <span>или перетащить сюда</span>
                  <small>Один документ · до 10 МБ</small>
                </button>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".docx,.pdf,.xlsx,.txt,.csv"
                hidden
                disabled={disabled || documents.length > 1}
                onChange={(e) => {
                  select(e.target.files, phase)
                  e.currentTarget.value = ''
                }}
                aria-label={`Загрузить файл ${label.toLowerCase()}`}
              />
              {errors[phase] && (
                <p className="slot-error" role="alert">
                  {errors[phase]}
                </p>
              )}
            </section>
          )
        })}
      </div>
      <p className="document-formats">
        DOCX, PDF с текстом, XLSX, TXT или CSV. PDF-сканы и файлы с паролем не поддерживаются.
      </p>
      {busy && (
        <p className="inline-progress" role="status">
          <Spinner />
          {uploadMessage || 'Сохраняем изменения…'}
        </p>
      )}
      <section className="next-action" aria-label="Следующий шаг">
        <div>
          <h2>
            {project.status === 'running'
              ? 'Анализ выполняется'
              : legacy
                ? 'Оставьте по одному файлу'
                : ready
                  ? 'Документы загружены'
                  : 'Добавьте оба документа'}
          </h2>
          <p>
            {project.status === 'running'
              ? 'Результаты появятся автоматически.'
              : legacy
                ? 'Старые файлы сохранены. Удалите лишние или начните новое сравнение.'
                : !ready
                  ? 'После загрузки двух файлов станет доступен анализ.'
                  : project.result
                    ? 'Откройте результаты или запустите анализ повторно.'
                    : 'Проверьте текст, затем запустите сравнение функций.'}
          </p>
        </div>
        <div className="next-action-buttons">
          {project.result && (
            <button className="button secondary" onClick={() => navigate('results')}>
              Результаты
              <ArrowRight size={16} />
            </button>
          )}
          <button className="button primary" disabled={!ready || disabled} onClick={openAnalysis}>
            Перейти к анализу
            <ArrowRight size={16} />
          </button>
        </div>
      </section>
      <details className="document-help">
        <summary>Какие документы подходят?</summary>
        <p>
          Положение, инструкция или таблица с функциями. В одном файле могут быть несколько
          подразделений — укажите их названия перед соответствующими обязанностями.
        </p>
      </details>
      {replacement && (
        <Modal
          title="Заменить файл?"
          close={() => {
            if (!busy) setReplacement(null)
          }}
        >
          <div className="modal-body">
            <p>
              «{replacement.document.name}» будет заменён на «{replacement.file.name}».
            </p>
            <p>
              Анализ потребуется запустить заново. Сохраните нужный отчёт перед заменой. Если новый
              файл не прочитается, прежний сохранится.
            </p>
            <div className="modal-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setReplacement(null)}
              >
                Отмена
              </button>
              <button
                className="button primary"
                disabled={disabled}
                onClick={() =>
                  void upload(replacement.file, replacement.document.phase, replacement.document.id)
                }
              >
                {busy ? <Spinner /> : <RefreshCw size={16} />}Заменить
              </button>
            </div>
          </div>
        </Modal>
      )}
      {deleting && (
        <Modal
          title="Удалить файл из проекта?"
          close={() => {
            if (!busy) setDeleting(null)
          }}
        >
          <div className="modal-body">
            <p>
              «{deleting.name}» будет удалён из проекта. Оригинал на компьютере не изменится.
              Текущий результат потребуется рассчитать заново.
            </p>
            <div className="modal-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setDeleting(null)}
              >
                Отмена
              </button>
              <button
                className="button danger-button"
                disabled={disabled}
                onClick={() => void remove()}
              >
                {busy ? <Spinner /> : <Trash2 size={16} />}Удалить
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
