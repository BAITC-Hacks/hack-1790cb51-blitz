import { useRef, useState, type DragEvent } from 'react'
import { CheckCircle2, Download, FileText, Plus, Trash2, UploadCloud } from 'lucide-react'
import { api, bytes } from '../api'
import { useWorkspace } from '../context'
import type { Document, Phase } from '../types'
import { Badge, Empty, Modal, PageTitle, Spinner, Steps } from '../components/UI'

export default function Documents() {
  const { project, reload, notify, openDocument } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')
  const [dragging, setDragging] = useState<Phase | null>(null)
  const [deleting, setDeleting] = useState<Document | null>(null)
  const [filter, setFilter] = useState<'all' | Phase>('all')
  const beforeRef = useRef<HTMLInputElement>(null), afterRef = useRef<HTMLInputElement>(null)
  const disabled = busy || project.status === 'running'
  async function upload(files: FileList | File[] | null, phase: Phase) {
    if (!files || disabled) return
    setBusy(true)
    let count = 0
    for (const file of Array.from(files)) {
      setUploadMessage(`Загружаем ${file.name}`)
      const body = new FormData(); body.append('file', file); body.append('phase', phase)
      try { await api(`/projects/${project.id}/documents`, { method: 'POST', body }); count++ } catch (error) { notify(`${file.name}: ${(error as Error).message}`, true) }
    }
    await reload(); setBusy(false); setUploadMessage('')
    if (count) notify(`Загружено документов: ${count}. Комплект готов к проверке.`)
  }
  async function remove() {
    if (!deleting) return
    setBusy(true)
    try { await api(`/documents/${deleting.id}`, { method: 'DELETE' }); await reload(); setDeleting(null); notify('Документ удалён. Запустите анализ обновлённого комплекта.') } catch (e) { notify((e as Error).message, true) } finally { setBusy(false) }
  }
  function drop(e: DragEvent, phase: Phase) { e.preventDefault(); setDragging(null); void upload(e.dataTransfer.files, phase) }
  const documents = project.documents.filter(d => filter === 'all' || d.phase === filter)
  return <>
    <PageTitle title="Документы проекта" description="Два комплекта документов — одна полная картина изменений."><a className="button secondary" href="/api/examples"><Download size={16} />Пример комплекта</a></PageTitle>
    <Steps current={project.result ? 2 : project.documents.some(d=>d.phase==='before') && project.documents.some(d=>d.phase==='after') ? 1 : 0} />
    <div className="upload-grid">{(['before', 'after'] as Phase[]).map(phase => <div className={`upload-card ${dragging === phase ? 'dragging' : ''}`} key={phase} onDragOver={e=>{ e.preventDefault(); if (!disabled) setDragging(phase) }} onDragLeave={()=>setDragging(null)} onDrop={e=>drop(e,phase)}><div className="upload-card-top"><span className={`phase-circle ${phase}`}>{phase==='before'?'01':'02'}</span><div><h2>{phase==='before'?'До реорганизации':'После реорганизации'}</h2><p>{phase==='before'?'Действующая структура и функции':'Новая структура и распределение функций'}</p></div><Badge type={phase}>{project.documents.filter(d=>d.phase===phase).length} файлов</Badge></div><button className="dropzone" disabled={disabled} onClick={()=>(phase==='before'?beforeRef:afterRef).current?.click()}><UploadCloud size={28} /><strong>Перетащите документы сюда</strong><span>или <u>выберите на компьютере</u></span><small>DOCX, PDF, XLSX, TXT, CSV · до 10 МБ</small></button><input ref={phase==='before'?beforeRef:afterRef} type="file" multiple accept=".docx,.pdf,.xlsx,.txt,.csv" hidden onChange={e=>{ void upload(e.target.files, phase); e.currentTarget.value='' }} aria-label={`Загрузить документы ${phase==='before'?'до':'после'}`} /></div>)}</div>
    {busy && <div className="inline-progress" role="status"><Spinner />{uploadMessage || 'Сохраняем изменения…'}</div>}
    <div className="info-strip"><CheckCircle2 size={18} /><span>Текст и ссылки на пункты сохраняются автоматически. Проверьте распознанные функции в просмотре документа.</span></div>
    <section className="panel"><div className="table-toolbar"><h2>Библиотека документов <span className="counter">{project.documents.length}</span></h2><div className="segmented">{(['all','before','after'] as const).map(f=><button key={f} className={filter===f?'active':''} onClick={()=>setFilter(f)}>{f==='all'?'Все':f==='before'?'До':'После'}</button>)}</div></div>
    {!documents.length ? <Empty title="В этом комплекте пока нет документов" text="Добавьте положения о подразделениях, инструкции или таблицу функций." action={<button className="button secondary" onClick={()=>beforeRef.current?.click()} disabled={disabled}><Plus size={16} />Добавить документ</button>} /> : <div className="table-scroll"><table className="document-table"><thead><tr><th>Документ</th><th>Комплект</th><th>Функции</th><th>Статус</th><th><span className="sr-only">Действия</span></th></tr></thead><tbody>{documents.map(d=><tr key={d.id}><td><button className="document-name" onClick={()=>openDocument(d.id)}><span className="file-icon"><FileText size={20}/></span><span><strong>{d.name}</strong><small>{d.name.split('.').pop()?.toUpperCase()} · {bytes(d.size)}</small></span></button></td><td><Badge type={d.phase}>{d.phase==='before'?'До':'После'}</Badge></td><td>{d.function_count}</td><td><span className={`doc-status ${d.warnings.length?'warning':''}`}><span />{d.warnings.length?'Проверьте разметку':'Распознан'}</span></td><td><div className="row-actions"><a className="icon-button" href={`/api/documents/${d.id}/download`} aria-label={`Скачать ${d.name}`}><Download size={16}/></a><button className="icon-button danger" onClick={()=>setDeleting(d)} disabled={disabled} aria-label={`Удалить ${d.name}`}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table></div>}</section>
    {deleting && <Modal title="Удалить документ?" close={()=>setDeleting(null)}><div className="modal-body"><p>«{deleting.name}» будет удалён из проекта. Текущие результаты станут неактуальны; предыдущий запуск останется в истории.</p><div className="modal-actions"><button className="button secondary" onClick={()=>setDeleting(null)}>Отмена</button><button className="button danger-button" disabled={busy} onClick={()=>void remove()}>{busy?<Spinner/>:<Trash2 size={16}/>}Удалить документ</button></div></div></Modal>}
  </>
}
