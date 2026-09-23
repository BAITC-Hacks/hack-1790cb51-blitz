import { CheckCheck, FileCheck2, Printer, ShieldCheck } from 'lucide-react'
import { useWorkspace } from '../context'
import { date } from '../api'
import {
  Badge,
  Empty,
  ExportMenu,
  PageTitle,
  SourceButton,
  kindLabels,
  statusLabels,
} from '../components/UI'

export default function Report() {
  const { project, openSource, navigate } = useWorkspace(),
    result = project.result
  if (!result)
    return (
      <Empty
        title="Заключение ещё не сформировано"
        text="Оно появится автоматически после завершения анализа."
      />
    )
  const reviewed = result.findings.filter((f) => f.status !== 'pending').length
  return (
    <>
      <PageTitle
        title="Аналитическое заключение"
        description="Готовый отчёт с источниками, рекомендациями и решениями проверяющего."
      >
        <button className="button secondary" onClick={() => window.print()}>
          <Printer size={16} />
          Печать / PDF
        </button>
        <ExportMenu projectId={project.id} />
      </PageTitle>
      <div className="report-layout">
        <article className="report-paper">
          <div className="report-brand">
            <span>
              ATLAS<span className="brand-star">✳</span>
            </span>
            <small>HACKALEM AI · АНАЛИТИКА СТРУКТУРЫ</small>
          </div>
          <div className="report-kicker">
            АНАЛИТИЧЕСКОЕ ЗАКЛЮЧЕНИЕ / {result.created_at.slice(0, 4)}
          </div>
          <h1>{project.name}</h1>
          <p className="report-org">{project.organization}</p>
          <div className="report-meta">
            <span>
              Дата анализа<b>{date(result.created_at)}</b>
            </span>
            <span>
              Метод анализа<b>{result.engine}</b>
            </span>
            <span>
              Исходные данные<b>{result.document_count} документов</b>
            </span>
          </div>
          <section>
            <h2>
              <span>01</span>Краткое заключение
            </h2>
            <p className="report-lead">{result.summary}</p>
            <div className="report-stats">
              <div>
                <b>{result.stats.coverage}%</b>
                <span>преемственность</span>
              </div>
              <div>
                <b>{result.stats.lost}</b>
                <span>возможные потери</span>
              </div>
              <div>
                <b>{result.stats.duplications}</b>
                <span>пересечения</span>
              </div>
              <div>
                <b>{result.stats.conflicts}</b>
                <span>конфликты</span>
              </div>
            </div>
            <p>
              Выводы носят рекомендательный характер. Для подтверждения потери функции необходимо
              проверить полноту предоставленных документов и решения о распределении полномочий.
            </p>
          </section>
          <section>
            <h2>
              <span>02</span>Изменения подразделений
            </h2>
            {result.departments.map((d) => (
              <div className="report-department" key={d.name}>
                <strong>{d.name}</strong>{' '}
                <Badge type={d.status}>
                  {d.status === 'retained'
                    ? 'Сохранено'
                    : d.status === 'created'
                      ? 'Новое название'
                      : statusLabels[d.status]}
                </Badge>
                <p>
                  {d.targets.length
                    ? `Преемники по функциям: ${d.targets.join(', ')}.`
                    : 'Функциональный преемник в документах не найден.'}
                </p>
                {d.sources?.map((source) => (
                  <SourceButton key={source.id} source={source} onOpen={openSource} />
                ))}
              </div>
            ))}
          </section>
          <section>
            <h2>
              <span>03</span>Выявленные отклонения
            </h2>
            {result.findings.length ? (
              result.findings.map((f, i) => (
                <div className="report-finding" key={f.id}>
                  <div className="report-finding-top">
                    <small>
                      {String(i + 1).padStart(2, '0')} / {kindLabels[f.kind]}
                    </small>
                    <Badge type={f.status}>{statusLabels[f.status]}</Badge>
                  </div>
                  <h3>{f.title}</h3>
                  <p>{f.description}</p>
                  {f.sources.map((s) => (
                    <div className="report-source" key={s.id}>
                      <blockquote>{s.text}</blockquote>
                      <SourceButton source={s} onOpen={openSource} />
                    </div>
                  ))}
                  <p>
                    <b>Рекомендация.</b> {f.recommendation}
                  </p>
                  {f.note && (
                    <p>
                      <b>Комментарий проверяющего.</b> {f.note}
                    </p>
                  )}
                </div>
              ))
            ) : (
              <p>Алгоритм не обнаружил отклонений в предоставленном комплекте.</p>
            )}
          </section>
          <section>
            <h2>
              <span>04</span>Методология и ограничения
            </h2>
            <p>{result.methodology}</p>
            {result.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
            <p>
              Документ сформирован по предоставленным источникам. Проверка соответствия
              законодательству и бенчмаркинг других операторов в этот анализ не входят.
            </p>
          </section>
          <footer>
            ATLAS · HackAlem AI
            <span>
              Редакция {result.revision} · {result.id.slice(0, 8)}
            </span>
          </footer>
        </article>
        <aside className="report-aside">
          <div className="panel">
            <FileCheck2 size={26} />
            <h3>Готовность заключения</h3>
            <div className="review-meter">
              <span
                style={{
                  width: `${result.findings.length ? (reviewed / result.findings.length) * 100 : 100}%`,
                }}
              />
            </div>
            <p>
              <b>
                {reviewed} из {result.findings.length}
              </b>{' '}
              замечаний проверено
            </p>
            <button className="button secondary" onClick={() => navigate('findings')}>
              <CheckCheck size={16} />
              Проверить замечания
            </button>
          </div>
          <div className="report-tip">
            <ShieldCheck size={22} />
            <h3>Прозрачность выводов</h3>
            <p>
              У каждого существенного вывода есть цитата и ссылка на исходный документ. Статус
              проверки сохраняется в отчёте.
            </p>
          </div>
        </aside>
      </div>
    </>
  )
}
