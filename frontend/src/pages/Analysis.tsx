import { ArrowLeft, ArrowRight, FileText, Play, RefreshCw, Sparkles } from 'lucide-react'
import { useWorkspace } from '../context'
import { PageTitle, Spinner } from '../components/UI'
import { canAnalyze } from '../workflow'

export default function Analysis({
  busy,
  start,
  refreshHealth,
}: {
  busy: boolean
  start: () => Promise<void>
  refreshHealth: () => Promise<void>
}) {
  const { project, health, navigate, openDocument } = useWorkspace()
  const running = project.status === 'running'
  const complete = project.status === 'completed' && !!project.result
  const failed = project.status === 'failed'
  const progress = Math.max(0, Math.min(100, project.progress))
  return (
    <div className="analysis-workspace">
      <PageTitle
        title={
          running
            ? 'Сравниваем документы'
            : failed
              ? 'Анализ не завершён'
              : complete
                ? 'Анализ завершён'
                : 'Всё готово к анализу'
        }
        description={
          running
            ? 'Можно оставить страницу открытой. Результаты появятся автоматически.'
            : 'GPT-5 сопоставит обязанности по смыслу и найдёт изменения, потери и дублирование.'
        }
      />
      <section className="analysis-card">
        <div className="analysis-pair">
          {(['before', 'after'] as const).map((phase) => (
            <div key={phase}>
              <span className="eyebrow">
                {phase === 'before' ? 'ДО РЕОРГАНИЗАЦИИ' : 'ПОСЛЕ РЕОРГАНИЗАЦИИ'}
              </span>
              {project.documents
                .filter((d) => d.phase === phase)
                .map((d) => (
                  <button
                    className="analysis-document"
                    key={d.id}
                    onClick={() => openDocument(d.id)}
                  >
                    <FileText size={22} />
                    <strong>{d.name}</strong>
                  </button>
                ))}
            </div>
          ))}
        </div>
        {running ? (
          <div className="analysis-live" role="status">
            <div className="analysis-live-heading">
              <span>
                <Spinner />
                {project.stage || 'Подготовка анализа'}
              </span>
              <strong>{progress}%</strong>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-label="Прогресс анализа"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
            <p>Большие документы обрабатываются по частям. Это может занять несколько минут.</p>
          </div>
        ) : (
          <>
            {failed && (
              <div className="error-box" role="alert">
                <strong>Не удалось получить новый результат</strong>
                <p>{project.error || 'Проверьте соединение и повторите попытку.'}</p>
                {project.result && <p>Результат предыдущего запуска не используется.</p>}
              </div>
            )}
            {!health?.gpt_configured && (
              <div className="setup-notice" role="status">
                <strong>Нужен API-ключ OpenAI</strong>
                <p>
                  Добавьте <code>OPENAI_API_KEY</code> в <code>backend/.env</code> и перезапустите
                  сервер. Для Docker используйте корневой <code>.env</code>.
                </p>
                <button className="text-button" onClick={() => void refreshHealth()}>
                  <RefreshCw size={15} />
                  Проверить подключение
                </button>
              </div>
            )}
            <div className="analysis-explanation">
              <Sparkles size={20} />
              <p>
                Текст двух документов будет отправлен в OpenAI. Анализ использует ваши API-кредиты.
                Чем больше документы, тем дольше обработка и выше расход.
              </p>
            </div>
            <div className="analysis-actions">
              <button className="text-button" disabled={busy} onClick={() => navigate('documents')}>
                <ArrowLeft size={16} />К документам
              </button>
              <div>
                {complete && (
                  <button className="button secondary" onClick={() => navigate('results')}>
                    Открыть результаты
                    <ArrowRight size={16} />
                  </button>
                )}
                <button
                  className="button primary"
                  disabled={busy || !health?.gpt_configured || !canAnalyze(project)}
                  onClick={() => void start()}
                >
                  {busy ? <Spinner /> : <Play size={16} />}{' '}
                  {complete || failed ? 'Повторить анализ' : 'Начать анализ'}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
      <p className="analysis-note">
        Выводы нужно проверить по источникам. Решение всегда остаётся за вами.
      </p>
    </div>
  )
}
