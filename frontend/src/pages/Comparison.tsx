import { useMemo, useState } from 'react'
import { ArrowRight, Filter, Search, Sparkles, ShieldAlert } from 'lucide-react'
import { useWorkspace } from '../context'
import {
  Badge,
  Empty,
  Modal,
  PageTitle,
  SectionContext,
  SourceButton,
  statusLabels,
  kindLabels,
} from '../components/UI'
import FindingReview from '../components/FindingReview'
import { linkFindings } from '../findingLinks'
import type { Finding, Mapping } from '../types'

export default function Comparison() {
  const { project, openSource, search, setSearch, navigate } = useWorkspace()
  const [status, setStatus] = useState('all'),
    [review, setReview] = useState('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const rows = project.result?.mapping || []
  const findings = project.result?.findings || []
  const { byRow, unlinked } = useMemo(() => linkFindings(rows, findings), [rows, findings])
  const active = findings.find((f) => f.id === selected)
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (status === 'all' || r.status === status) &&
          (review === 'all' ||
            (byRow.get(r.id) || []).some((f) => review === 'any' || f.status === review)) &&
          JSON.stringify([r, byRow.get(r.id)])
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [rows, status, review, search, byRow],
  )
  const current = Math.min(page, Math.max(0, Math.ceil(filtered.length / 12) - 1))
  if (!project.result)
    return (
      <Empty
        title="Сопоставление появится после анализа"
        text="Загрузите оба комплекта и нажмите «Запустить анализ»."
        action={
          <button className="button primary" onClick={() => navigate('documents')}>
            К документам
            <ArrowRight size={16} />
          </button>
        }
      />
    )
  function findingButton(finding: Finding) {
    return (
      <button
        key={finding.id}
        className={`linked-finding ${finding.status}`}
        onClick={() => setSelected(finding.id)}
        aria-label={`${kindLabels[finding.kind]}: ${finding.title}`}
      >
        <span>
          <ShieldAlert size={15} />
          {kindLabels[finding.kind]}
        </span>
        <strong>{finding.title}</strong>
        <small>{statusLabels[finding.status]} · Открыть</small>
      </button>
    )
  }
  function rowContent(row: Mapping) {
    return (
      <tr key={row.id}>
        <td>
          {row.before ? (
            <>
              <div className="department-label">{row.before.department}</div>
              <p className="function-text">{row.before.text}</p>
              <SectionContext source={row.before} />
              <SourceButton source={row.before} onOpen={openSource} compact />
            </>
          ) : (
            <span className="muted">Нет в исходном комплекте</span>
          )}
        </td>
        <td>
          {row.after.length ? (
            row.after.map((a) => (
              <div className="matched-function" key={a.source.id}>
                <div className="department-label">{a.source.department}</div>
                <p className="function-text">{a.source.text}</p>
                <SectionContext source={a.source} />
                <div className="match-source">
                  <SourceButton source={a.source} onOpen={openSource} compact />
                  {row.before && (
                    <span
                      className="similarity"
                      title={
                        a.method === 'llm'
                          ? 'Смысловое соответствие определено GPT'
                          : 'Сходство текстов в историческом результате'
                      }
                    >
                      {a.method === 'llm' ? (
                        <>
                          <Sparkles size={12} />
                          GPT
                        </>
                      ) : (
                        `${a.score}% сходство`
                      )}
                    </span>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="missing-function">
              <span>Преемник не найден</span>
              <small>Проверьте полноту документов «после»</small>
              {row.nearest && (
                <details>
                  <summary>Ближайший фрагмент · {row.nearest.score}%</summary>
                  <p>{row.nearest.source.text}</p>
                  <SourceButton source={row.nearest.source} onOpen={openSource} compact />
                </details>
              )}
            </div>
          )}
        </td>
        <td>
          <Badge type={row.status}>{statusLabels[row.status]}</Badge>
          {row.reason && (
            <details className="match-reason">
              <summary>Почему?</summary>
              <p>{row.reason}</p>
            </details>
          )}
          <div className="row-findings">
            {(byRow.get(row.id) || []).map(findingButton)}
            {!byRow.get(row.id)?.length && <small className="muted">Замечаний не выявлено</small>}
          </div>
        </td>
      </tr>
    )
  }
  return (
    <>
      <PageTitle
        secondary
        title="Функции и замечания"
        description="Сравните пункты до и после. Замечания рядом с функцией открывают обоснование и решение проверяющего."
      >
        <span className="reviewed-counter">
          {findings.filter((f) => f.status !== 'pending').length} из {findings.length} замечаний
          проверено
        </span>
      </PageTitle>
      <div className="filter-tabs">
        {(['all', 'retained', 'transferred', 'lost', 'new'] as const).map((s) => (
          <button
            className={status === s ? 'active' : ''}
            key={s}
            onClick={() => {
              setStatus(s)
              setPage(0)
            }}
          >
            {s === 'all' ? 'Все функции' : statusLabels[s]}
            <span>{s === 'all' ? rows.length : rows.filter((r) => r.status === s).length}</span>
          </button>
        ))}
      </div>
      <section className="panel">
        <div className="table-toolbar">
          <label className="search-field">
            <Search size={17} />
            <input
              placeholder="Найти функцию или замечание"
              aria-label="Поиск функций"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(0)
              }}
            />
          </label>
          <label className="select-field">
            <Filter size={15} />
            <select
              aria-label="Фильтр замечаний"
              value={review}
              onChange={(e) => {
                setReview(e.target.value)
                setPage(0)
              }}
            >
              <option value="all">Все функции</option>
              <option value="any">С замечаниями</option>
              <option value="pending">На проверке</option>
              <option value="confirmed">Подтверждённые замечания</option>
              <option value="dismissed">Отклонённые замечания</option>
            </select>
          </label>
        </div>
        <div className="table-scroll">
          <table className="comparison-table">
            <thead>
              <tr>
                <th>
                  <span className="phase-small">01</span>До реорганизации
                </th>
                <th>
                  <span className="phase-small green">02</span>После реорганизации
                </th>
                <th>Результат и замечания</th>
              </tr>
            </thead>
            <tbody>{filtered.slice(current * 12, current * 12 + 12).map(rowContent)}</tbody>
          </table>
        </div>
        {!filtered.length && (
          <Empty
            title="Ничего не найдено"
            text="Измените запрос или сбросьте фильтры."
            action={
              <button
                className="button secondary"
                onClick={() => {
                  setSearch('')
                  setReview('all')
                  setStatus('all')
                }}
              >
                Сбросить фильтры
              </button>
            }
          />
        )}
        <div className="table-footer">
          <span>
            {filtered.length
              ? `${current * 12 + 1}–${Math.min(current * 12 + 12, filtered.length)}`
              : '0'}{' '}
            из {filtered.length} функций
          </span>
          <div>
            <button
              className="button small secondary"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              Назад
            </button>
            <button
              className="button small secondary"
              disabled={(current + 1) * 12 >= filtered.length}
              onClick={() => setPage(current + 1)}
            >
              Далее
            </button>
          </div>
        </div>
      </section>
      {!!unlinked.length && (
        <section className="panel unlinked-findings">
          <h3>Другие замечания по документам</h3>
          <p>Эти замечания не связаны со строками сопоставления и требуют отдельной проверки.</p>
          <div>{unlinked.map(findingButton)}</div>
        </section>
      )}
      <p className="footnote">
        GPT-5.6 сопоставляет обязанности по смыслу. Проценты ближайших фрагментов — только сходство
        текста, не уверенность модели. Проверяйте исходные пункты перед принятием решения.
      </p>
      {active && (
        <Modal drawer title="Проверка замечания" close={() => setSelected(null)}>
          <FindingReview key={active.id} active={active} />
        </Modal>
      )}
    </>
  )
}
