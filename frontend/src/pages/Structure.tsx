import { useState } from 'react'
import { ArrowRight, Building2, GitBranch, Search } from 'lucide-react'
import { useWorkspace } from '../context'
import { Badge, Empty, PageTitle, SourceButton } from '../components/UI'

export default function Structure() {
  const { project, navigate, openSource } = useWorkspace()
  const [selected, setSelected] = useState<string | null>(null),
    [query, setQuery] = useState('')
  const result = project.result
  if (!result)
    return (
      <Empty
        title="Структура ещё не сопоставлена"
        text="Запустите анализ, чтобы увидеть подразделения и движение функций."
      />
    )
  const before = result.before_departments || [
    ...new Set(result.mapping.flatMap((r) => (r.before ? [r.before.department] : []))),
  ]
  const after = result.after_departments || [
    ...new Set(result.mapping.flatMap((r) => r.after.map((a) => a.source.department))),
  ]
  const selectedRows = result.mapping.filter(
    (r) =>
      r.before?.department === selected || r.after.some((a) => a.source.department === selected),
  )
  const targets = selected
    ? new Set(
        selectedRows.flatMap((r) => [
          r.before?.department,
          ...r.after.map((a) => a.source.department),
        ]),
      )
    : null
  return (
    <>
      <PageTitle
        title="Структура организации"
        description="Выберите подразделение, чтобы увидеть его связи и переданные функции."
      />
      <div className="structure-banner">
        <GitBranch size={21} />
        <p>
          <b>
            {before.length} подразделения до → {after.length} после
          </b>
          <span>
            Связи построены по сопоставленным функциям. Это карта преемственности, а не утверждённая
            иерархия.
          </span>
        </p>
        <button className="text-button" onClick={() => navigate('comparison')}>
          Таблица функций
          <ArrowRight size={16} />
        </button>
      </div>
      <label className="search-field standalone">
        <Search size={17} />
        <input
          aria-label="Поиск подразделений"
          placeholder="Найти подразделение"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="structure-grid">
        {[
          { phase: 'before', title: 'До реорганизации', items: before },
          { phase: 'after', title: 'После реорганизации', items: after },
        ].map((column) => (
          <section className="structure-column" key={column.phase}>
            <div className="structure-head">
              <span className={`phase-circle ${column.phase}`}>
                {column.phase === 'before' ? '01' : '02'}
              </span>
              <h2>{column.title}</h2>
              <span className="counter">{column.items.length}</span>
            </div>
            <div className="org-root">
              <Building2 size={18} />
              {project.organization.split(' · ')[0] || 'Организация'}
            </div>
            <div className="org-children">
              {column.items
                .filter((d) => d.toLowerCase().includes(query.toLowerCase()))
                .map((dept) => {
                  const count =
                    column.phase === 'before'
                      ? result.mapping.filter((r) => r.before?.department === dept).length
                      : new Set(
                          result.mapping.flatMap((r) =>
                            r.after
                              .filter((a) => a.source.department === dept)
                              .map((a) => a.source.id),
                          ),
                        ).size
                  const state =
                    column.phase === 'before'
                      ? after.includes(dept)
                        ? 'retained'
                        : 'transferred'
                      : before.includes(dept)
                        ? 'retained'
                        : 'new'
                  return (
                    <button
                      className={`org-node ${selected === dept ? 'selected' : ''} ${targets && !targets.has(dept) ? 'dimmed' : ''}`}
                      key={dept}
                      onClick={() => setSelected(selected === dept ? null : dept)}
                    >
                      <span className="org-icon">
                        <Building2 size={18} />
                      </span>
                      <span>
                        <strong>{dept}</strong>
                        <small>{count} функций</small>
                      </span>
                      <Badge type={state}>
                        {state === 'retained'
                          ? 'Сохранено'
                          : state === 'new'
                            ? 'Новое'
                            : 'Преобразовано'}
                      </Badge>
                    </button>
                  )
                })}
            </div>
          </section>
        ))}
      </div>
      {selected && (
        <section className="panel selected-department">
          <div className="section-head">
            <div>
              <h2>{selected}</h2>
              <p>Подтверждающие фрагменты и переходы функций</p>
            </div>
            <button className="text-button" onClick={() => setSelected(null)}>
              Снять выделение
            </button>
          </div>
          {!selectedRows.length && (
            <div className="structure-function">
              <p>
                Подразделение есть в структуре, но функции не распознаны. Проверьте полноту
                положения.
              </p>
              {result.departments
                .find((d) => d.name === selected)
                ?.sources?.map((s) => (
                  <SourceButton key={s.id} source={s} onOpen={openSource} />
                ))}
            </div>
          )}
          {selectedRows.map((row) => (
            <div className="structure-function" key={row.id}>
              <p>{row.before?.text || row.after[0]?.source.text}</p>
              <div>
                {row.before && <SourceButton source={row.before} onOpen={openSource} compact />}
                <ArrowRight size={16} />
                {row.after.length ? (
                  row.after.map((a) => (
                    <SourceButton key={a.source.id} source={a.source} onOpen={openSource} compact />
                  ))
                ) : (
                  <Badge type="lost">Преемник не найден</Badge>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  )
}
