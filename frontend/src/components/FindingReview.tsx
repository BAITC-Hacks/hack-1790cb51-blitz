import { useState } from 'react'
import { ArrowRight, Check, MessageSquare, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { useWorkspace } from '../context'
import { api } from '../api'
import { Badge, SectionContext, SourceButton, Spinner, statusLabels } from './UI'
import type { Finding } from '../types'

export default function FindingReview({ active }: { active: Finding }) {
  const { project, openSource, reload, notify } = useWorkspace()
  const [note, setNote] = useState(active.note || '')
  const [busy, setBusy] = useState(false)
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
  return (
    <section className="panel finding-detail" key={active.id}>
      <div className="finding-detail-head">
        <Badge type={active.status}>{statusLabels[active.status]}</Badge>
        <h2>{active.title}</h2>
        <p>{active.description}</p>
      </div>
      <div className="evidence-section">
        <h3>
          <ArrowRight size={17} />
          Подтверждающие источники <span className="counter">{active.sources.length}</span>
        </h3>
        {active.sources.map((source, i) => (
          <div className="evidence-card" key={source.document_id + source.id}>
            <div className="evidence-top">
              <span>ИСТОЧНИК {i + 1}</span>
              <Badge type={source.phase}>{source.phase === 'before' ? 'До' : 'После'}</Badge>
            </div>
            <blockquote>{source.text}</blockquote>
            <SectionContext source={source} />
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
  )
}
