import { useEffect, useRef, type ReactNode } from 'react'
import { ArrowRight, Check, ChevronRight, Download, FileText, LoaderCircle, X } from 'lucide-react'
import type { Source, View } from '../types'

export const labels: Record<View, string> = {
  overview: 'Обзор анализа',
  documents: 'Документы',
  comparison: 'Сопоставление функций',
  structure: 'Структура организации',
  findings: 'Риски и замечания',
  report: 'Заключение',
  settings: 'Настройки и методология',
}
export const statusLabels = {
  retained: 'Сохранена',
  transferred: 'Передана',
  lost: 'Не найдена',
  new: 'Новая',
  reorganized: 'Преобразовано',
  removed: 'Нет преемника',
  created: 'Создано',
  pending: 'На проверке',
  confirmed: 'Подтверждено',
  dismissed: 'Отклонено',
  completed: 'Анализ завершён',
  draft: 'Черновик',
  running: 'Анализируем',
  failed: 'Ошибка анализа',
}
export const kindLabels = {
  loss: 'Потеря функции',
  duplication: 'Дублирование',
  conflict: 'Конфликт интересов',
}
export function Badge({ type, children }: { type?: string; children: ReactNode }) {
  return (
    <span className={`badge ${type || ''}`}>
      <span className="badge-dot" />
      {children}
    </span>
  )
}
export function Spinner() {
  return <LoaderCircle size={18} className="spin" aria-label="Загрузка" />
}
export function Empty({
  title,
  text,
  action,
}: {
  title: string
  text: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <FileText size={30} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  )
}
export function PageTitle({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </div>
  )
}
export function SourceButton({
  source,
  onOpen,
  compact = false,
}: {
  source: Source
  onOpen: (source: Source) => void
  compact?: boolean
}) {
  return (
    <button
      className={`source-link ${compact ? 'compact' : ''}`}
      onClick={() => onOpen(source)}
      title={`Открыть ${source.document_name}: ${source.locator}`}
    >
      <FileText size={14} />
      <span>
        {compact ? source.locator.split(' · ')[0] : source.document_name}
        <small>{!compact && source.locator}</small>
      </span>
      <ChevronRight size={14} />
    </button>
  )
}
export function Modal({
  title,
  children,
  close,
  drawer = false,
}: {
  title: string
  children: ReactNode
  close: () => void
  drawer?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className={drawer ? 'modal drawer' : 'modal'}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
      aria-label={title}
    >
      <div className="modal-inner">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" onClick={close} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
export function ExportMenu({ projectId }: { projectId: string }) {
  return (
    <details className="export-menu">
      <summary className="button secondary">
        <Download size={16} />
        Экспорт
        <ChevronRight size={14} />
      </summary>
      <div className="dropdown">
        <a href={`/api/projects/${projectId}/export?format=html`}>
          <FileText size={16} />
          Отчёт HTML / печать
        </a>
        <a href={`/api/projects/${projectId}/export?format=md`}>
          <FileText size={16} />
          Заключение Markdown
        </a>
        <a href={`/api/projects/${projectId}/export?format=csv`}>
          <Download size={16} />
          Таблица CSV
        </a>
      </div>
    </details>
  )
}
export function SectionHead({
  title,
  subtitle,
  action,
  onAction,
}: {
  title: string
  subtitle?: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && (
        <button className="text-button" onClick={onAction}>
          {action}
          <ArrowRight size={15} />
        </button>
      )}
    </div>
  )
}
export function Steps({ current }: { current: number }) {
  return (
    <div className="steps">
      {['Загрузите документы', 'Запустите анализ', 'Проверьте выводы'].map((s, i) => (
        <div className={i < current ? 'done' : i === current ? 'current' : ''} key={s}>
          <span>{i < current ? <Check size={13} /> : i + 1}</span>
          {s}
          {i < 2 && <ChevronRight size={15} />}
        </div>
      ))}
    </div>
  )
}
