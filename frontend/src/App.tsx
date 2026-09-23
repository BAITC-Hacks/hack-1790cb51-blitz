import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FileStack,
  FileText,
  FolderKanban,
  GitCompareArrows,
  History,
  LayoutDashboard,
  Menu,
  Network,
  Play,
  Plus,
  Settings2,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react'
import { api, date } from './api'
import { WorkspaceContext } from './context'
import type { Health, Project, ProjectList, Result, Source, View } from './types'
import { Badge, Empty, Modal, Spinner, labels, statusLabels } from './components/UI'
import SourceViewer from './components/SourceViewer'
import Overview from './pages/Overview'
import Documents from './pages/Documents'
import Comparison from './pages/Comparison'
import Structure from './pages/Structure'
import Findings from './pages/Findings'
import Report from './pages/Report'
import Settings from './pages/Settings'

const nav = [
  { id: 'documents', icon: FileStack },
  { id: 'overview', icon: LayoutDashboard },
  { id: 'comparison', icon: GitCompareArrows },
  { id: 'structure', icon: Network },
  { id: 'findings', icon: ShieldAlert },
  { id: 'report', icon: FileText },
] as const
const pages = {
  overview: Overview,
  documents: Documents,
  comparison: Comparison,
  structure: Structure,
  findings: Findings,
  report: Report,
  settings: Settings,
}
function readView(): View {
  const hash = window.location.hash.slice(1)
  return hash in labels ? (hash as View) : 'documents'
}

export default function App() {
  const [findingId, setFindingId] = useState<string | null>(null)
  const [view, setView] = useState<View>(readView),
    [projects, setProjects] = useState<ProjectList[]>([]),
    [project, setProject] = useState<Project | null>(null)
  const [projectId, setProjectId] = useState(localStorage.getItem('atlas-project') || ''),
    [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(''),
    [mobileOpen, setMobileOpen] = useState(false)
  const [modal, setModal] = useState<'new' | 'projects' | 'history' | 'help' | 'analyze' | null>(
      null,
    ),
    [source, setSource] = useState<{ id: string; highlight?: string } | null>(null)
  const [toasts, setToasts] = useState<{ id: number; text: string; error: boolean }[]>([]),
    [busy, setBusy] = useState(false)
  const [historyResult, setHistoryResult] = useState<Result | null>(null)
  const activeId = useRef(projectId)
  activeId.current = projectId
  const notify = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random()
    setToasts((items) => [...items, { id, text, error }])
    window.setTimeout(
      () => setToasts((items) => items.filter((t) => t.id !== id)),
      error ? 12000 : 5500,
    )
  }, [])
  const navigate = useCallback((next: View) => {
    window.location.hash = next
    setView(next)
    setMobileOpen(false)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [])
  const reload = useCallback(async () => {
    if (!projectId) return
    const [detail, list] = await Promise.all([
      api<Project>(`/projects/${projectId}`),
      api<ProjectList[]>('/projects'),
    ])
    if (activeId.current === projectId) {
      setProject(detail)
      setProjects(list)
      setError('')
    }
  }, [projectId])
  async function initialize() {
    setLoading(true)
    setError('')
    try {
      const [list, status] = await Promise.all([
        api<ProjectList[]>('/projects'),
        api<Health>('/health'),
      ])
      setProjects(list)
      setHealth(status)
      if (!list.some((p) => p.id === activeId.current)) setProjectId(list[0]?.id || '')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void initialize()
    const onHash = () => setView(readView())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    if (projectId) {
      localStorage.setItem('atlas-project', projectId)
      setProject(null)
      setSource(null)
      void reload().catch((e) => setError(e.message))
    }
  }, [projectId, reload])
  useEffect(() => {
    if (project?.status !== 'running') return
    const interval = window.setInterval(() => {
      void reload().catch((e) => setError(e.message))
    }, 1500)
    return () => window.clearInterval(interval)
  }, [project?.status, reload])
  const openSource = useCallback(
    (s: Source) => setSource({ id: s.document_id, highlight: s.id.split(':').pop() }),
    [],
  )
  async function create(name: string, organization: string) {
    setBusy(true)
    try {
      const p = await api<Project>('/projects', {
        method: 'POST',
        body: JSON.stringify({ name, organization }),
      })
      setProjects(await api<ProjectList[]>('/projects'))
      setProjectId(p.id)
      setModal(null)
      navigate('documents')
      notify('Проект создан. Добавьте исходные документы.')
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      setBusy(false)
    }
  }
  async function createDemo() {
    setBusy(true)
    try {
      const p = await api<Project>('/projects/demo', { method: 'POST' })
      setProjects(await api<ProjectList[]>('/projects'))
      setProjectId(p.id)
      navigate('overview')
      setModal(null)
      notify('Демонстрационные документы готовы. Нажмите «Запустить анализ» для GPT-5.')
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      setBusy(false)
    }
  }
  async function startAnalysis() {
    if (!project) return
    setBusy(true)
    try {
      await api(`/projects/${project.id}/analyze`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'gpt' }),
      })
      setModal(null)
      await reload()
      notify('Анализ запущен. Можно оставаться на любой странице проекта.')
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      setBusy(false)
    }
  }
  async function showHistory(id: string) {
    try {
      setHistoryResult(await api<Result>(`/projects/${projectId}/runs/${id}`))
    } catch (e) {
      notify((e as Error).message, true)
    }
  }
  const Page = pages[view]
  const pending = project?.result?.findings.filter((f) => f.status === 'pending').length || 0
  const pairReady = ['before', 'after'].every(
    (phase) => project?.documents.filter((d) => d.phase === phase).length === 1,
  )
  return (
    <div className="app-shell">
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
      {mobileOpen && (
        <button
          className="sidebar-overlay"
          onClick={() => setMobileOpen(false)}
          aria-label="Закрыть меню"
        />
      )}
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <button className="brand" onClick={() => navigate('overview')} aria-label="ATLAS — главная">
          <span className="brand-symbol">
            <Network size={25} />
          </span>
          <span>
            atlas<span className="brand-period">.</span>
            <small>СРАВНЕНИЕ ФУНКЦИЙ</small>
          </span>
        </button>
        <div className="nav-heading">ПРОЕКТ</div>
        <nav aria-label="Главная навигация">
          {nav.map(({ id, icon: Icon }) => (
            <button
              className={`nav-item ${view === id ? 'active' : ''}`}
              key={id}
              onClick={() => navigate(id)}
              aria-current={view === id ? 'page' : undefined}
            >
              <Icon size={19} />
              <span>{labels[id]}</span>
              {id === 'findings' && pending > 0 && <span className="nav-count">{pending}</span>}
              {id === 'documents' && project && (
                <span className="nav-count neutral">{project.documents.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${view === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            <Settings2 size={19} />
            <span>Настройки</span>
          </button>
          <button className="nav-item" onClick={() => setModal('help')}>
            <CircleHelp size={19} />
            <span>Как пользоваться</span>
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <main id="main-content" tabIndex={-1}>
          <div className="project-bar">
            <div className="project-selector">
              <button
                className="icon-button mobile-menu"
                onClick={() => setMobileOpen(!mobileOpen)}
                aria-label={mobileOpen ? 'Закрыть меню' : 'Открыть меню'}
                aria-expanded={mobileOpen}
              >
                <Menu size={20} />
              </button>
              <button className="project-title" onClick={() => setModal('projects')}>
                {project?.name || 'Ваши проекты'}
                <ChevronDown size={15} />
              </button>
              {project?.is_demo && <span className="demo-label">ДЕМО</span>}
            </div>
            <div className="project-actions">
              {!!project?.runs.length && (
                <button
                  className="button secondary icon-mobile"
                  onClick={() => {
                    setModal('history')
                    setHistoryResult(null)
                  }}
                  aria-label="История анализа"
                >
                  <History size={16} />
                  <span>История</span>
                </button>
              )}
              {view !== 'documents' && view !== 'overview' && (
                <button
                  className="button secondary"
                  disabled={!project || project.status === 'running'}
                  onClick={() => navigate('documents')}
                >
                  {project?.status === 'running' ? <Spinner /> : <Sparkles size={16} />}
                  <span>{project?.status === 'running' ? 'Анализируем…' : 'К документам'}</span>
                </button>
              )}
            </div>
          </div>
          {project?.status === 'running' && (
            <div className="analysis-progress" role="status">
              <div>
                <Spinner />
                <strong>{project.stage}</strong>
                <span>{project.progress}%</span>
              </div>
              <div className="progress-track">
                <span style={{ width: `${project.progress}%` }} />
              </div>
              <small>
                Извлечение и сопоставление могут занять несколько минут. Результат сохранится
                автоматически.
              </small>
            </div>
          )}
          {project?.status === 'failed' && (
            <div className="error-box" role="alert">
              <strong>Анализ не завершён</strong>
              <p>{project.error}</p>
              {project.result && <p>Ниже показан предыдущий успешный результат.</p>}
              {view !== 'documents' && (
                <button className="text-button" onClick={() => navigate('documents')}>
                  Проверить документы
                  <ArrowRight size={15} />
                </button>
              )}
            </div>
          )}
          {error ? (
            <div className="error-box">
              <h2>Не удалось загрузить рабочее пространство</h2>
              <p>{error}</p>
              <button
                className="button secondary"
                onClick={() => {
                  void initialize()
                  void reload()
                    .then(() => setError(''))
                    .catch(() => {})
                }}
              >
                Повторить
              </button>
            </div>
          ) : loading || (!project && projectId) ? (
            <div className="page-loading">
              <Spinner />
              <span>Загружаем рабочее пространство…</span>
            </div>
          ) : !project ? (
            <Empty
              title="Создайте первый проект"
              text="Начните собственный анализ или исследуйте демонстрационный комплект."
              action={
                <>
                  <button className="button primary" onClick={() => setModal('new')}>
                    <Plus size={17} />
                    Новый проект
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void createDemo()}
                  >
                    Открыть демо
                  </button>
                </>
              }
            />
          ) : (
            <WorkspaceContext.Provider
              value={{
                project,
                health,
                reload,
                navigate,
                openSource,
                openDocument: (id) => setSource({ id }),
                openAnalysis: () => setModal('analyze'),
                openFinding: (id) => {
                  setFindingId(id)
                  navigate('findings')
                },
                findingId,
                notify,
                search,
                setSearch,
              }}
            >
              <div className="page-content" key={`${project.id}-${view}`}>
                <Page />
              </div>
              {source && (
                <SourceViewer
                  id={source.id}
                  highlight={source.highlight}
                  close={() => setSource(null)}
                />
              )}
            </WorkspaceContext.Provider>
          )}
          <footer className="app-footer">
            <span>
              <span className="online-dot" />
              ATLAS · HackAlem AI
            </span>
            <button onClick={() => navigate('settings')}>
              <span className={`engine-dot ${health?.gpt_configured ? 'gpt' : ''}`} />
              {health?.gpt_configured ? 'GPT-5 · ключ настроен' : 'GPT-5 · нужен API-ключ'}
            </button>
          </footer>
        </main>
      </div>
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
      {modal === 'new' && (
        <Modal title="Новый проект анализа" close={() => setModal(null)}>
          <NewProjectForm busy={busy} create={create} />
        </Modal>
      )}
      {modal === 'projects' && (
        <Modal title="Проекты" close={() => setModal(null)}>
          <div className="modal-body">
            <p className="muted">
              Один проект — два документа для сравнения и история результатов.
            </p>
            <div className="project-list">
              {projects.map((p) => (
                <button
                  className={projectId === p.id ? 'selected' : ''}
                  key={p.id}
                  onClick={() => {
                    setProjectId(p.id)
                    setModal(null)
                    navigate('overview')
                  }}
                >
                  <span className="workspace-icon">
                    <FolderKanban size={20} />
                  </span>
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {p.document_count} документов · {statusLabels[p.status]}
                      {p.is_demo ? ' · Демо' : ''}
                    </small>
                  </span>
                  {projectId === p.id && <Check size={18} />}
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button
                className="button secondary"
                onClick={() => void createDemo()}
                disabled={busy}
              >
                {busy ? <Spinner /> : <Play size={15} />}Демо-проект
              </button>
              <button className="button primary" onClick={() => setModal('new')}>
                <Plus size={17} />
                Новый проект
              </button>
            </div>
          </div>
        </Modal>
      )}
      {modal === 'analyze' && project && (
        <Modal title="Запуск анализа" close={() => setModal(null)}>
          <div className="modal-body">
            <p>
              Сравним обязанности и подразделения в двух документах. Результаты появятся в разделе
              «Обзор».
            </p>
            <dl className="analysis-files">
              {(['before', 'after'] as const).map((phase) => (
                <div key={phase}>
                  <dt>{phase === 'before' ? 'До' : 'После'}</dt>
                  <dd>
                    {project.documents
                      .filter((d) => d.phase === phase)
                      .map((d) => d.name)
                      .join(', ') || 'Файл не выбран'}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="info-strip">
              Извлечённый текст будет отправлен в OpenAI. Используются API-кредиты проекта. Большие
              документы обрабатываются по частям: анализ займёт больше времени и потребует больше
              кредитов, в том числе на проверку связей между частями.
            </div>
            {!health?.gpt_configured && (
              <p className="form-error">
                Добавьте OPENAI_API_KEY в backend/.env и перезапустите сервер. Анализ выполняется
                только через GPT-5.
              </p>
            )}
            <div className="modal-actions">
              <button className="button secondary" onClick={() => setModal(null)}>
                Отмена
              </button>
              <button
                className="button primary"
                onClick={() => void startAnalysis()}
                disabled={
                  busy || !health?.gpt_configured || !pairReady || project.status === 'running'
                }
              >
                {busy ? <Spinner /> : <Play size={16} />}Начать анализ
              </button>
            </div>
            {!pairReady && (
              <p className="form-error">Для запуска нужен ровно один файл «до» и один «после».</p>
            )}
          </div>
        </Modal>
      )}
      {modal === 'history' && (
        <Modal title="История анализа" close={() => setModal(null)}>
          <div className="modal-body">
            {project?.runs.map((run, i) => (
              <button className="history-row" key={run.id} onClick={() => void showHistory(run.id)}>
                <History size={18} />
                <span>
                  <strong>Анализ от {date(run.created_at)}</strong>
                  <small>
                    Редакция документов {run.revision}
                    {i === 0 ? ' · последний запуск' : ''}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
            {historyResult && (
              <div className="history-detail">
                <Badge type="completed">{historyResult.engine}</Badge>
                <p>{historyResult.summary}</p>
                <small>
                  {historyResult.findings.filter((f) => f.status !== 'pending').length} замечаний
                  проверено · {historyResult.document_count} документов
                </small>
              </div>
            )}
          </div>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal title="Как работать с ATLAS" close={() => setModal(null)}>
          <div className="modal-body help-content">
            <span className="help-symbol">
              <BookOpen size={30} />
            </span>
            <h3>От двух документов к заключению</h3>
            {[
              {
                n: '1',
                title: 'Добавьте документы',
                text: 'Загрузите один файл «до» и один «после». В каждом может быть несколько подразделений. Нажмите «Проверить текст», чтобы увидеть распознанные функции.',
              },
              {
                n: '2',
                title: 'Запустите анализ',
                text: 'GPT-5 сопоставит обязанности по смыслу. Нужны API-ключ OpenAI, доступ к модели и баланс API-проекта.',
              },
              {
                n: '3',
                title: 'Проверьте источники',
                text: 'Откройте замечание и нажмите на ссылку документа. Нужный фрагмент будет выделен в боковой панели.',
              },
              {
                n: '4',
                title: 'Зафиксируйте решение',
                text: 'Подтвердите или отклоните замечания, добавьте комментарии и экспортируйте заключение.',
              },
            ].map((s) => (
              <div className="help-step" key={s.n}>
                <span>{s.n}</span>
                <div>
                  <h4>{s.title}</h4>
                  <p>{s.text}</p>
                </div>
              </div>
            ))}
            <button
              className="button primary"
              onClick={() => {
                setModal(null)
                navigate('documents')
              }}
            >
              К документам
              <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
function NewProjectForm({
  busy,
  create,
}: {
  busy: boolean
  create: (name: string, organization: string) => void
}) {
  const [name, setName] = useState(''),
    [organization, setOrganization] = useState('')
  return (
    <form
      className="modal-body"
      onSubmit={(e) => {
        e.preventDefault()
        create(name, organization)
      }}
    >
      <p className="muted">Отдельное рабочее пространство для одного сценария реорганизации.</p>
      <label className="form-label">
        Название проекта
        <input
          autoFocus
          required
          maxLength={120}
          placeholder="Например, реорганизация IT-департамента"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="form-label">
        Организация <span className="muted">· необязательно</span>
        <input
          maxLength={120}
          placeholder="Название вашей организации"
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
        />
      </label>
      <div className="modal-actions">
        <button className="button primary" disabled={busy || !name.trim()}>
          {busy ? <Spinner /> : <Plus size={17} />}Создать проект
        </button>
      </div>
    </form>
  )
}
