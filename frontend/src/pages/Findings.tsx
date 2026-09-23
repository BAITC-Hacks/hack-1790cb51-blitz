import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Check,
  CheckCheck,
  CircleAlert,
  MessageSquare,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useWorkspace } from '../context'
import { api } from '../api'
import {
  Badge,
  Empty,
  PageTitle,
  SourceButton,
  Spinner,
  kindLabels,
  statusLabels,
} from '../components/UI'
import type { Finding } from '../types'

export default function Findings() {
  const { project, openSource, reload, notify, findingId } = useWorkspace()
  const [filter, setFilter] = useState('all'),
    [reviewFilter, setReviewFilter] = useState('all'),
    [selected, setSelected] = useState<string | null>(findingId)
  const [note, setNote] = useState(''),
    [busy, setBusy] = useState(false)
  const findings = project.result?.findings || []
  const filtered = findings.filter(
    (f) =>
      (filter === 'all' || f.kind === filter) &&
      (reviewFilter === 'all' || f.status === reviewFilter),
  )
  const active = filtered.find((f) => f.id === selected) || filtered[0]
  useEffect(() => setNote(active?.note || ''), [active?.id, active?.note])
  async function save(status: Finding['status']) {
    if (!active) return
    setBusy(true)
    try {
      await api(`/projects/${project.id}/findings/${active.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, note }),
      })
      await reload()
      notify('Решение и комментарий сохранены')
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      setBusy(false)
    }
  }
  if (!project.result)
    return (
      <Empty
        title="Замечания появятся после анализа"
        text="Мы проверим потери функций, дублирование и потенциальные конфликты интересов."
      />
    )
  return (
    <>
      <PageTitle
        secondary
        title="Риски и замечания"
        description="Проверьте основания каждого вывода и зафиксируйте своё решение."
      >
        <span className="reviewed-counter">
          <CheckCheck size={17} />
          {findings.filter((f) => f.status !== 'pending').length} из {findings.length} проверено
        </span>
      </PageTitle>
      <div className="filter-tabs">
        {(['all', 'loss', 'duplication', 'conflict'] as const).map((f) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {f === 'all' ? 'Все замечания' : kindLabels[f]}
            <span>
              {f === 'all' ? findings.length : findings.filter((item) => item.kind === f).length}
            </span>
          </button>
        ))}
      </div>
      <div className="findings-toolbar">
        <span>{filtered.length} замечаний</span>
        <select
          value={reviewFilter}
          onChange={(e) => setReviewFilter(e.target.value)}
          aria-label="Статус проверки"
        >
          <option value="all">Все статусы</option>
          <option value="pending">На проверке</option>
          <option value="confirmed">Подтверждено</option>
          <option value="dismissed">Отклонено</option>
        </select>
      </div>
      {!active ? (
        <Empty
          title="Замечаний с такими условиями нет"
          text={
            findings.length
              ? 'Выберите другой тип или статус проверки.'
              : 'Отклонения не обнаружены алгоритмом. Проверьте сопоставление функций и полноту документов.'
          }
        />
      ) : (
        <div className="findings-layout">
          <div className="findings-list">
            {filtered.map((f, i) => (
              <button
                className={`finding-card ${active.id === f.id ? 'selected' : ''}`}
                key={f.id}
                onClick={() => setSelected(f.id)}
              >
                <div className="finding-card-top">
                  <span className={`severity ${f.severity}`}>
                    <CircleAlert size={13} />
                    {f.severity === 'high'
                      ? 'Высокий'
                      : f.severity === 'medium'
                        ? 'Средний'
                        : 'Низкий'}{' '}
                    приоритет
                  </span>
                  <span className="finding-number">{String(i + 1).padStart(2, '0')}</span>
                </div>
                <h3>
                  {f.kind === 'loss' ? f.sources[0].text.replace(/^\d+[.)]\s*/, '') : f.title}
                </h3>
                <p>{f.sources[0].department}</p>
                <div className="finding-card-bottom">
                  <span>{kindLabels[f.kind]}</span>
                  <Badge type={f.status}>{statusLabels[f.status]}</Badge>
                </div>
              </button>
            ))}
          </div>
          <section className="panel finding-detail" key={active.id}>
            <div className="finding-detail-head">
              <span className="eyebrow">ОБОСНОВАНИЕ ЗАМЕЧАНИЯ</span>
              <h2>{active.title}</h2>
              <p>{active.description}</p>
            </div>
            <div className="evidence-section">
              <h3>
                <FileEvidence />
                Подтверждающие источники <span className="counter">{active.sources.length}</span>
              </h3>
              {active.sources.map((source, i) => (
                <div className="evidence-card" key={source.id}>
                  <div className="evidence-top">
                    <span>ИСТОЧНИК {i + 1}</span>
                    <Badge type={source.phase}>{source.phase === 'before' ? 'До' : 'После'}</Badge>
                  </div>
                  <blockquote>{source.text}</blockquote>
                  <p>{source.department}</p>
                  <SourceButton source={source} onOpen={openSource} />
                </div>
              ))}
            </div>
            <div className="recommendation">
              <div className="recommendation-icon">
                <ShieldCheck size={21} />
              </div>
              <div>
                <h3>Рекомендация</h3>
                <p>{active.recommendation}</p>
              </div>
            </div>
            <div className="review-section">
              <h3>
                <MessageSquare size={17} />
                Решение проверяющего
              </h3>
              <label htmlFor="review-note">
                Комментарий <span className="muted">· необязательно</span>
              </label>
              <textarea
                id="review-note"
                rows={3}
                maxLength={3000}
                placeholder="Добавьте контекст, ответственного или план действий…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="review-buttons">
                <button
                  className="button primary"
                  disabled={busy || project.status === 'running'}
                  onClick={() => void save('confirmed')}
                >
                  {busy ? <Spinner /> : <Check size={16} />}Подтвердить
                </button>
                <button
                  className="button secondary"
                  disabled={busy || project.status === 'running'}
                  onClick={() => void save('dismissed')}
                >
                  <X size={16} />
                  Отклонить
                </button>
                <button
                  className="icon-button"
                  disabled={busy || project.status === 'running'}
                  title="Вернуть на проверку и сохранить комментарий"
                  aria-label="Вернуть на проверку"
                  onClick={() => void save('pending')}
                >
                  <RotateCcw size={16} />
                </button>
              </div>
              <p className="footnote">Решение и комментарий попадут в итоговое заключение.</p>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
function FileEvidence() {
  return <ArrowRight size={17} />
}
