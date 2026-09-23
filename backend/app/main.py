import io
import json
import logging
import os
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import quote

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from . import ai
from .analysis import analyze
from .parser import MAX_BYTES, extract
from .storage import db, document_dict, initialize, now, pack, project_dict, uid
from .report import export_report

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
load_dotenv(Path(__file__).resolve().parents[2] / ".env")
EXAMPLES = Path(__file__).resolve().parents[1] / "examples"
logger = logging.getLogger(__name__)


def get_project(conn, project_id):
    row = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Проект не найден")
    return project_dict(row)


def editable(conn, project_id):
    project = get_project(conn, project_id)
    if project["status"] == "running":
        raise HTTPException(409, "Дождитесь завершения анализа")
    return project


def invalidate(conn, project_id):
    conn.execute("UPDATE projects SET revision=revision+1, status='draft', result=NULL, error=NULL, progress=0 WHERE id=?", (project_id,))


def run_analysis(project_id, mode="local"):
    def progress(value, stage):
        with db() as conn:
            conn.execute("UPDATE projects SET progress=?,stage=? WHERE id=?", (value, stage, project_id))
    try:
        with db() as conn:
            project = get_project(conn, project_id)
            documents = [document_dict(row, True) for row in conn.execute("SELECT * FROM documents WHERE project_id=? ORDER BY created_at,id", (project_id,))]
        progress(10, "Чтение и проверка источников")
        usage = {"input_tokens": 0, "output_tokens": 0}
        if mode == "gpt":
            for index, document in enumerate(documents):
                progress(10 + int(18 * index / len(documents)), f"GPT: извлечение функций · {index + 1}/{len(documents)}")
                consumed = ai.extract_functions(document)
                for key in usage:
                    usage[key] += consumed.get(key, 0)
        result = analyze(documents, progress, use_llm=mode == "gpt")
        for key in usage:
            result["usage"][key] = result["usage"].get(key, 0) + usage[key]
        result["revision"] = project["revision"]
        result["document_count"] = len(documents)
        with db() as conn:
            for document in documents:
                conn.execute("UPDATE documents SET segments=? WHERE id=?", (pack(document["segments"]), document["id"]))
            conn.execute("UPDATE projects SET status='completed', progress=100,stage='Анализ завершён',error=NULL,result=? WHERE id=?", (pack(result), project_id))
            conn.execute("INSERT INTO runs VALUES (?,?,?,?,?)", (result["id"], project_id, result["created_at"], project["revision"], pack(result)))
    except Exception as exc:
        message = str(exc) if isinstance(exc, ValueError) else "Не удалось завершить анализ. Проверьте документы и повторите запуск."
        logger.warning("Analysis failed: %s", type(exc).__name__)
        with db() as conn:
            conn.execute("UPDATE projects SET status='failed',error=?,stage='' WHERE id=?", (message, project_id))


def create_demo():
    project_id = uid()
    with db() as conn:
        conn.execute("INSERT INTO projects (id,name,organization,created_at,is_demo,status) VALUES (?,?,?,?,1,'running')", (project_id, "Реорганизация операционного блока", "АО «Alem Telecom» · демонстрационные данные", now()))
        for phase in ("before", "after"):
            for path in sorted((EXAMPLES / phase).glob("*.txt")):
                content = path.read_bytes()
                segments, warnings = extract(path.name, content)
                department = next(s["department"] for s in segments if s["is_function"])
                filename = f"{department} — {'до' if phase == 'before' else 'после'}.txt"
                conn.execute("INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?)", (uid(), project_id, filename, phase, len(content), now(), pack(segments), pack(warnings), content))
    run_analysis(project_id)
    return project_id


@asynccontextmanager
async def lifespan(app):
    initialize()
    with db() as conn:
        empty = conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0] == 0
    if empty and os.getenv("SEED_DEMO", "true").lower() == "true":
        create_demo()
    yield


app = FastAPI(title="ATLAS · HackAlem AI", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health():
    return {"status": "ok", "gpt_configured": ai.configured(), "model": ai.model_name(), "version": "1.0.0"}


class ProjectInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    organization: str = Field(default="", max_length=120)


@app.get("/api/projects")
def list_projects():
    with db() as conn:
        projects = []
        for row in conn.execute("SELECT * FROM projects ORDER BY created_at DESC"):
            item = project_dict(row)
            result = item.pop("result")
            item["stats"] = result["stats"] if result else None
            item["document_count"] = conn.execute("SELECT COUNT(*) FROM documents WHERE project_id=?", (item["id"],)).fetchone()[0]
            projects.append(item)
        return projects


@app.post("/api/projects", status_code=201)
def add_project(payload: ProjectInput):
    if not payload.name.strip():
        raise HTTPException(422, "Введите название проекта")
    project_id = uid()
    with db() as conn:
        conn.execute("INSERT INTO projects (id,name,organization,created_at) VALUES (?,?,?,?)", (project_id, payload.name.strip(), payload.organization.strip(), now()))
        return get_project(conn, project_id)


@app.post("/api/projects/demo", status_code=201)
def demo():
    project_id = create_demo()
    with db() as conn:
        return get_project(conn, project_id)


@app.get("/api/projects/{project_id}")
def detail(project_id: str):
    with db() as conn:
        project = get_project(conn, project_id)
        project["documents"] = [document_dict(row) for row in conn.execute("SELECT * FROM documents WHERE project_id=? ORDER BY phase,created_at", (project_id,))]
        project["runs"] = [dict(row) for row in conn.execute("SELECT id,created_at,revision FROM runs WHERE project_id=? ORDER BY created_at DESC", (project_id,))]
        return project


@app.post("/api/projects/{project_id}/documents", status_code=201)
async def upload(project_id: str, phase: Literal["before", "after"] = Form(...), file: UploadFile = File(...)):
    content = await file.read(MAX_BYTES + 1)
    filename = Path((file.filename or "document").replace("\\", "/")).name[:200]
    try:
        segments, warnings = await run_in_threadpool(extract, filename, content)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        editable(conn, project_id)
        if conn.execute("SELECT COUNT(*) FROM documents WHERE project_id=?", (project_id,)).fetchone()[0] >= 40:
            raise HTTPException(422, "Допускается до 40 документов на проект")
        document_id = uid()
        conn.execute("INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?)", (document_id, project_id, filename, phase, len(content), now(), pack(segments), pack(warnings), content))
        invalidate(conn, project_id)
        return document_dict(conn.execute("SELECT * FROM documents WHERE id=?", (document_id,)).fetchone())


def get_document(conn, document_id):
    row = conn.execute("SELECT * FROM documents WHERE id=?", (document_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Документ не найден")
    return row


@app.get("/api/documents/{document_id}")
def document_detail(document_id: str):
    with db() as conn:
        return document_dict(get_document(conn, document_id), True)


@app.get("/api/documents/{document_id}/download")
def download(document_id: str):
    with db() as conn:
        row = get_document(conn, document_id)
        return Response(row["content"], media_type="application/octet-stream", headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(row['name'])}"})


@app.delete("/api/documents/{document_id}", status_code=204)
def remove_document(document_id: str):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = get_document(conn, document_id)
        editable(conn, row["project_id"])
        conn.execute("DELETE FROM documents WHERE id=?", (document_id,))
        invalidate(conn, row["project_id"])


class SegmentInput(BaseModel):
    department: str = Field(min_length=1, max_length=180)
    is_function: bool


@app.patch("/api/documents/{document_id}/segments/{segment_id}")
def edit_segment(document_id: str, segment_id: str, payload: SegmentInput):
    if not payload.department.strip():
        raise HTTPException(422, "Укажите подразделение")
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = get_document(conn, document_id)
        editable(conn, row["project_id"])
        segments = json.loads(row["segments"])
        segment = next((s for s in segments if s["id"] == segment_id), None)
        if segment is None:
            raise HTTPException(404, "Фрагмент не найден")
        segment.update(department=payload.department.strip(), is_function=payload.is_function, manual=True)
        conn.execute("UPDATE documents SET segments=? WHERE id=?", (pack(segments), document_id))
        invalidate(conn, row["project_id"])
        return segment


class AnalyzeInput(BaseModel):
    mode: Literal["local", "gpt", "auto"] = "auto"


@app.post("/api/projects/{project_id}/analyze", status_code=202)
def start_analysis(project_id: str, payload: AnalyzeInput, background_tasks: BackgroundTasks):
    mode = "gpt" if payload.mode == "auto" and ai.configured() else "local" if payload.mode == "auto" else payload.mode
    if mode == "gpt" and not ai.configured():
        raise HTTPException(422, "Добавьте OPENAI_API_KEY в backend/.env и перезапустите сервер")
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        editable(conn, project_id)
        phases = {r[0] for r in conn.execute("SELECT DISTINCT phase FROM documents WHERE project_id=?", (project_id,))}
        if phases != {"before", "after"}:
            raise HTTPException(422, "Загрузите хотя бы один документ в каждый комплект: «до» и «после»")
        conn.execute("UPDATE projects SET status='running',progress=1,stage='Подготовка анализа',error=NULL WHERE id=?", (project_id,))
    background_tasks.add_task(run_analysis, project_id, mode)
    return {"status": "running", "mode": mode}


class ReviewInput(BaseModel):
    status: Literal["pending", "confirmed", "dismissed"]
    note: str = Field(default="", max_length=3000)


@app.patch("/api/projects/{project_id}/findings/{finding_id}")
def review(project_id: str, finding_id: str, payload: ReviewInput):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        project = editable(conn, project_id)
        result = project["result"]
        if not result:
            raise HTTPException(409, "Сначала запустите анализ")
        finding = next((f for f in result["findings"] if f["id"] == finding_id), None)
        if finding is None:
            raise HTTPException(404, "Замечание не найдено")
        finding.update(payload.model_dump())
        conn.execute("UPDATE projects SET result=? WHERE id=?", (pack(result), project_id))
        conn.execute("UPDATE runs SET result=? WHERE id=?", (pack(result), result["id"]))
        return finding


@app.get("/api/projects/{project_id}/runs/{run_id}")
def history(project_id: str, run_id: str):
    with db() as conn:
        row = conn.execute("SELECT result FROM runs WHERE id=? AND project_id=?", (run_id, project_id)).fetchone()
        if not row:
            raise HTTPException(404, "Запуск не найден")
        return json.loads(row["result"])


@app.get("/api/projects/{project_id}/export")
def export(project_id: str, format: Literal["html", "md", "csv"] = "html"):
    with db() as conn:
        project = get_project(conn, project_id)
    if not project["result"]:
        raise HTTPException(409, "Сначала выполните анализ")
    content, media_type = export_report(project, format)
    return Response(content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="atlas-report.{format}"'})


@app.get("/api/examples")
def examples():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in EXAMPLES.glob("*/*.txt"):
            archive.write(path, str(path.relative_to(EXAMPLES)))
    return Response(buffer.getvalue(), media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="atlas-example-documents.zip"'})
