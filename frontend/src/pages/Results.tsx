import { FileCheck2, GitCompareArrows } from 'lucide-react'
import { useWorkspace } from '../context'
import { ExportMenu, PageTitle } from '../components/UI'
import type { ResultSection } from '../workflow'
import Comparison from './Comparison'
import Report from './Report'

const sections = [
  { id: 'comparison', label: 'Функции и замечания', icon: GitCompareArrows },
  { id: 'report', label: 'Заключение', icon: FileCheck2 },
] as const
const contents = {
  comparison: Comparison,
  report: Report,
}
export default function Results({ section }: { section: ResultSection }) {
  const { project, navigate } = useWorkspace()
  const result = project.result
  if (!result) return null
  const Content = contents[section]
  return (
    <div className="results-workspace">
      <div className="results-intro">
        <PageTitle
          title="Результаты сравнения"
          description="Проверьте изменения по исходным документам и сохраните заключение."
        >
          <ExportMenu projectId={project.id} />
        </PageTitle>
        <div className="result-summary">
          <p>{result.summary}</p>
          <dl>
            <div>
              <dt>Функций до → после</dt>
              <dd>
                {result.stats.before_functions} <span>→</span> {result.stats.after_functions}
              </dd>
            </div>
            <div>
              <dt>Найден преемник</dt>
              <dd>{result.stats.coverage}%</dd>
            </div>
            <div>
              <dt>Замечаний на проверке</dt>
              <dd>{result.findings.filter((f) => f.status === 'pending').length}</dd>
            </div>
          </dl>
        </div>
        {!!result.warnings.length && (
          <details className="document-help">
            <summary>Ограничения анализа ({result.warnings.length})</summary>
            {result.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </details>
        )}
        <nav className="result-sections" aria-label="Разделы результатов">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => navigate(id)}
              className={section === id ? 'active' : ''}
              aria-current={section === id ? 'page' : undefined}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>
      </div>
      <section
        className="result-content"
        aria-label={sections.find((s) => s.id === section)?.label}
      >
        <Content key={section} />
      </section>
    </div>
  )
}
