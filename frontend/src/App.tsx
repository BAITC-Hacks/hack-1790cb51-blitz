import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, CircleHelp, Network, Plus, X } from 'lucide-react'
import { api, ApiError } from './api'
import { WorkspaceContext } from './context'
import type { Health, Project, Source, View } from './types'
import { Modal, Spinner } from './components/UI'
import SourceViewer from './components/SourceViewer'
import Documents from './pages/Documents'
import Analysis from './pages/Analysis'
import Results from './pages/Results'
import { canAnalyze, readRoute, resolveStep, routeHash, type Route } from './workflow'

// Share initialization across StrictMode mounts so opening the app creates one workspace.
let boot: Promise<{ project: Project; health: Health }> | undefined
async function createComparison() {
  const created = await api<Project>('/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'Сравнение документов', organization: '' }),
  })
  localStorage.setItem('atlas-comparison', created.id)
  return api<Project>(`/projects/${created.id}`)
}
async function restoreComparison() {
  const id = localStorage.getItem('atlas-comparison') || localStorage.getItem('atlas-project')
  if (id) {
    try {
      const project = await api<Project>(`/projects/${id}`)
      localStorage.setItem('atlas-comparison', id)
      return project
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error
    }
  }
  return createComparison()
}

export default function App() {
  const [project, setProject] = useState<Project | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [route, setRoute] = useState<Route>(() => readRoute(window.location.hash))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [documentBusy, setDocumentBusy] = useState(false)
  const [confirmNew, setConfirmNew] = useState(false)
  const [source, setSource] = useState<{ id: string; highlight?: string } | null>(null)
  const [search, setSearch] = useState('')
  const [toasts, setToasts] = useState<{ id: number; text: string; error: boolean }[]>([])
  const activeId = useRef('')
  const mutation = useRef(false)
  const previousStatus = useRef<Project['status'] | undefined>(undefined)
  const step = project ? resolveStep(route.step, project) : 'documents'
  const notify = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random()
    setToasts((items) => [...items, { id, text, error }])
    window.setTimeout(
      () => setToasts((items) => items.filter((t) => t.id !== id)),
      error ? 12000 : 5500,
    )
  }, [])
  const navigate = useCallback((next: View) => {
    const nextRoute = readRoute('#' + next)
    setRoute(nextRoute)
    window.location.hash = routeHash(nextRoute)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [])
  const reload = useCallback(async () => {
    const id = activeId.current
    if (!id) return
    const detail = await api<Project>(`/projects/${id}`)
    if (activeId.current === id) {
      setProject(detail)
      setError('')
    }
  }, [])
  async function initialize() {
    setLoading(true)
    setError('')
    try {
      boot ??= Promise.all([restoreComparison(), api<Health>('/health')]).then(
        ([project, health]) => ({ project, health }),
      )
      const initial = await boot
      activeId.current = initial.project.id
      setProject(initial.project)
      setHealth(initial.health)
    } catch (error) {
      boot = undefined
      setError((error as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void initialize()
    const onHash = () => setRoute(readRoute(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    if (!project) return
    if (project.status === 'running') navigate('analysis')
    else if (previousStatus.current === 'running' && project.status === 'completed')
      navigate('results')
    previousStatus.current = project.status
  }, [project?.status, navigate])
  useEffect(() => {
    if (project?.status !== 'running') return
    let pending = false
    const interval = window.setInterval(async () => {
      if (pending) return
      pending = true
      try {
        await reload()
      } catch (e) {
        setError((e as Error).message)
      } finally {
        pending = false
      }
    }, 1500)
    return () => window.clearInterval(interval)
  }, [project?.status, reload])
  async function startAnalysis() {
    if (!project || !canAnalyze(project) || mutation.current || project.status === 'running') return
    mutation.current = true
    setBusy(true)
    try {
      await api(`/projects/${project.id}/analyze`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'gpt' }),
      })
      previousStatus.current = 'running'
      setProject((current) =>
        current
          ? { ...current, status: 'running', progress: 1, stage: 'Подготовка анализа', error: null }
          : current,
      )
      navigate('analysis')
      await reload()
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      mutation.current = false
      setBusy(false)
    }
  }
  async function newComparison() {
    if (mutation.current || project?.status === 'running') return
    mutation.current = true
    setBusy(true)
    try {
      const created = await createComparison()
      activeId.current = created.id
      previousStatus.current = undefined
      setProject(created)
      setSource(null)
      setSearch('')
      setError('')
      setConfirmNew(false)
      navigate('documents')
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      mutation.current = false
      setBusy(false)
    }
  }
  const openSource = useCallback(
    (s: Source) => setSource({ id: s.document_id, highlight: s.id.split(':').pop() }),
    [],
  )
  const steps = [
    { id: 'documents', label: 'Загрузка документов', short: 'Документы', hint: 'Файлы до и после' },
    { id: 'analysis', label: 'Анализ', short: 'Анализ', hint: 'Сравнение по смыслу' },
    { id: 'results', label: 'Результаты', short: 'Результаты', hint: 'Выводы и источники' },
  ] as const
  const current = steps.findIndex((s) => s.id === step)
  const running = project?.status === 'running'
  return (
    <div className="workflow-app">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
      >
        Перейти к содержимому
      </a>
      <header className="workflow-header">
        <button
          className="workflow-brand"
          disabled={busy || documentBusy}
          onClick={() => navigate(running ? 'analysis' : 'documents')}
          aria-label="ATLAS — к документам"
        >
          <Network size={27} />
          <span>
            atlas<span>.</span>
          </span>
        </button>
        <span className="workflow-tagline">Сравнение документов до и после</span>
        <button
          className="button secondary"
          disabled={busy || documentBusy || loading || running || !project?.documents.length}
          onClick={() => setConfirmNew(true)}
        >
          <Plus size={17} />
          <span>Новое сравнение</span>
        </button>
      </header>
      <main id="main-content" className={`workflow-main step-${step}`} tabIndex={-1}>
        <nav className="workflow-steps" aria-label="Этапы сравнения">
          {steps.map((item, index) => (
            <button
              key={item.id}
              className={`${step === item.id ? 'active' : ''} ${index < current ? 'done' : ''}`}
              aria-current={step === item.id ? 'step' : undefined}
              disabled={
                loading ||
                busy ||
                documentBusy ||
                !project ||
                (running && item.id !== 'analysis') ||
                (item.id === 'analysis' && !canAnalyze(project)) ||
                (item.id === 'results' && (project.status !== 'completed' || !project.result))
              }
              onClick={() => navigate(item.id)}
            >
              <span className="workflow-step-number">
                {index < current ? <Check size={18} /> : index + 1}
              </span>
              <span>
                <strong className="step-long-label">{item.label}</strong>
                <strong className="step-short-label">{item.short}</strong>
                <small>{item.hint}</small>
              </span>
            </button>
          ))}
        </nav>
        {error && (
          <div className="error-box" role="alert">
            <strong>Не удалось обновить данные</strong>
            <p>{error}</p>
            <button
              className="button secondary"
              onClick={() =>
                void (project ? reload().catch((e) => setError(e.message)) : initialize())
              }
            >
              Повторить
            </button>
          </div>
        )}
        {loading ? (
          <div className="page-loading">
            <Spinner />
            <span>Открываем сравнение…</span>
          </div>
        ) : (
          project && (
            <WorkspaceContext.Provider
              value={{
                project,
                health,
                reload,
                navigate,
                openSource,
                openDocument: (id) => setSource({ id }),
                openAnalysis: () => navigate('analysis'),
                notify,
                search,
                setSearch,
                setDocumentBusy,
              }}
            >
              <div className="page-content" key={`${project.id}-${step}`}>
                {step === 'documents' ? (
                  <Documents />
                ) : step === 'analysis' ? (
                  <Analysis
                    busy={busy}
                    start={startAnalysis}
                    refreshHealth={async () => {
                      try {
                        setHealth(await api<Health>('/health'))
                      } catch (e) {
                        notify((e as Error).message, true)
                      }
                    }}
                  />
                ) : (
                  <Results section={route.section} />
                )}
              </div>
              {source && (
                <SourceViewer
                  key={source.id}
                  id={source.id}
                  highlight={source.highlight}
                  close={() => setSource(null)}
                />
              )}
            </WorkspaceContext.Provider>
          )
        )}
      </main>
      <footer className="workflow-footer">
        <span>ATLAS · HackAlem AI</span>
        <span>Смысловой анализ · GPT-5</span>
      </footer>
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.error ? 'error' : ''}`}>
            {t.error ? <CircleHelp size={18} /> : <Check size={18} />}
            <span>{t.text}</span>
            <button
              className="icon-button"
              onClick={() => setToasts((items) => items.filter((i) => i.id !== t.id))}
              aria-label="Скрыть уведомление"
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
      {confirmNew && (
        <Modal
          title="Начать новое сравнение?"
          close={() => {
            if (!busy) setConfirmNew(false)
          }}
        >
          <div className="modal-body">
            <p>
              Откроется пустая пара документов. Сохраните нужный отчёт перед началом: переключения
              между сравнениями в интерфейсе нет.
            </p>
            <div className="modal-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setConfirmNew(false)}
              >
                Остаться
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void newComparison()}
              >
                {busy ? <Spinner /> : <Plus size={16} />}Начать новое
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
