import {
  ArrowRight,
  Building2,
  CircleCheck,
  FileText,
  GitCompareArrows,
  ShieldAlert,
} from 'lucide-react'
import { useWorkspace } from '../context'
import { Empty, PageTitle, SectionHead, kindLabels } from '../components/UI'
import { date } from '../api'

export default function Overview() {
  const { project, health, navigate, openFinding, openAnalysis } = useWorkspace()
  const result = project.result
  if (!result) {
    const running = project.status === 'running'
    const failed = project.status === 'failed'
    const ready = ['before', 'after'].every(
      (phase) => project.documents.filter((d) => d.phase === phase).length === 1,
    )
    return (
      <>
        <PageTitle
          title="Обзор"
          description="Здесь появятся изменения функций и замечания для проверки."
        />
        <Empty
          title={
            running
              ? 'Готовим результаты'
              : failed
                ? 'Результат пока не получен'
                : ready
                  ? 'Документы готовы к сравнению'
                  : 'Начните с двух документов'
          }
          text={
            running
              ? 'Можно оставить эту страницу открытой. Данные обновятся автоматически.'
              : failed
                ? 'Причина остановки указана выше. Проверьте документы перед повторным запуском.'
                : ready
                  ? 'Запустите анализ, чтобы увидеть переходы функций и возможные риски.'
                  : 'Добавьте файл до реорганизации и файл после, затем запустите анализ.'
          }
          action={
            !running && (
              <button
                className="button primary"
                onClick={() =>
                  ready && !failed && health?.gpt_configured
                    ? openAnalysis()
                    : navigate('documents')
                }
              >
                {ready && !failed && health?.gpt_configured ? 'Запустить анализ' : 'К документам'}
                <ArrowRight size={16} />
              </button>
            )
          }
        />
      </>
    )
  }
  const { stats } = result
  const severityOrder = { high: 0, medium: 1, low: 2 }
  const pending = result.findings
    .filter((f) => f.status === 'pending')
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
  const metrics = [
    {
      label: 'Функций до → после',
      value: `${stats.before_functions} → ${stats.after_functions}`,
      note: 'Все распознанные обязанности',
      icon: FileText,
      view: 'comparison' as const,
    },
    {
      label: 'Найден преемник',
      value: `${stats.coverage}%`,
      note: `${stats.before_functions - stats.lost} из ${stats.before_functions} исходных функций`,
      icon: GitCompareArrows,
      view: 'comparison' as const,
    },
    {
      label: 'Осталось проверить',
      value: pending.length,
      note: `${pending.filter((f) => f.severity === 'high').length} с высоким приоритетом`,
      icon: ShieldAlert,
      view: 'findings' as const,
    },
    {
      label: 'Подразделений до → после',
      value: `${stats.before_departments} → ${stats.after_departments}`,
      note: 'Связи по переданным функциям',
      icon: Building2,
      view: 'structure' as const,
    },
  ]
  return (
    <>
      <PageTitle
        title="Обзор результатов"
        description={`Анализ от ${date(result.created_at)} · ${result.engine}`}
      />
      <div className="metrics-grid">
        {metrics.map(({ icon: Icon, ...metric }) => (
          <button className="metric-card" key={metric.label} onClick={() => navigate(metric.view)}>
            <div className="metric-top">
              <span>{metric.label}</span>
              <Icon size={18} />
            </div>
            <strong>{metric.value}</strong>
            <div className="metric-bottom">
              <span>{metric.note}</span>
              <ArrowRight size={15} />
            </div>
          </button>
        ))}
      </div>
      <div className="overview-columns">
        <section className="panel function-panel">
          <SectionHead
            title="Изменения функций"
            action="Открыть сравнение"
            onAction={() => navigate('comparison')}
          />
          <div className="distribution">
            {[
              { label: 'Остались в подразделении', n: stats.retained, c: 'retained' },
              { label: 'Переданы другому', n: stats.transferred, c: 'transferred' },
              { label: 'Преемник не найден', n: stats.lost, c: 'lost' },
            ].map((item) => (
              <div className="distribution-row" key={item.c}>
                <span className={`legend-dot ${item.c}`} />
                <span>{item.label}</span>
                <b>{item.n}</b>
                <div className="bar-track">
                  <div
                    className={item.c}
                    style={{
                      width: `${stats.before_functions ? (item.n / stats.before_functions) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="panel-foot">Новых функций после реорганизации: {stats.new}</div>
        </section>
        <section className="panel priorities">
          <SectionHead
            title="Требуют вашего решения"
            action="Все замечания"
            onAction={() => navigate('findings')}
          />
          {pending.length ? (
            pending.slice(0, 3).map((finding, i) => (
              <button
                className="priority-item"
                key={finding.id}
                onClick={() => openFinding(finding.id)}
              >
                <span className={`priority-index ${finding.severity}`}>{i + 1}</span>
                <span>
                  <span className="priority-label">{kindLabels[finding.kind]}</span>
                  <strong>
                    {finding.kind === 'loss'
                      ? finding.sources[0].text.replace(/^\d+[.)]\s*/, '')
                      : finding.title}
                  </strong>
                  <small>{finding.sources[0].department}</small>
                </span>
                <ArrowRight size={17} />
              </button>
            ))
          ) : (
            <div className="all-reviewed">
              <CircleCheck size={28} />
              <h3>
                {result.findings.length ? 'Все замечания проверены' : 'Замечаний не обнаружено'}
              </h3>
              <p>Проверьте сопоставление функций перед подготовкой заключения.</p>
            </div>
          )}
        </section>
      </div>
      <section className="next-action">
        <div>
          <h2>
            {pending.length ? 'Следующий шаг — проверить замечания' : 'Можно перейти к заключению'}
          </h2>
          <p>Сверьте выводы с источниками и сохраните своё решение.</p>
        </div>
        <button
          className="button primary"
          onClick={() => navigate(pending.length ? 'findings' : 'report')}
        >
          {pending.length ? 'Проверить замечания' : 'Открыть заключение'}
          <ArrowRight size={16} />
        </button>
      </section>
    </>
  )
}
