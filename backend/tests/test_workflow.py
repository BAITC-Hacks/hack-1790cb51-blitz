import io
import zipfile

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook
from pypdf import PdfWriter

from app import ai
from app.main import app
from app.parser import extract


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "test.sqlite3"))
    monkeypatch.setenv("SEED_DEMO", "false")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with TestClient(app) as c:
        yield c


def test_demo_end_to_end_and_sources(client, mock_gpt):
    project = client.post("/api/projects/demo").json()
    assert project["status"] == "draft" and project["result"] is None
    assert client.post(f"/api/projects/{project['id']}/analyze", json={}).status_code == 202
    project = client.get(f"/api/projects/{project['id']}").json()
    assert project["status"] == "completed"
    result = project["result"]
    assert result["engine"] == "GPT · gpt-5"
    assert result["usage"] == {"input_tokens": 100, "output_tokens": 100, "total_tokens": 200}
    assert result["stats"]["lost"] == 2
    assert result["stats"]["duplications"] == 2
    assert result["stats"]["conflicts"] == 1
    assert any(d["status"] == "reorganized" for d in result["departments"])
    for finding in result["findings"]:
        for source in finding["sources"]:
            doc = client.get(f"/api/documents/{source['document_id']}").json()
            assert source["text"] in [s["text"] for s in doc["segments"]]
    finding = result["findings"][0]
    response = client.patch(
        f"/api/projects/{project['id']}/findings/{finding['id']}",
        json={"status": "confirmed", "note": "Проверено по источнику"},
    )
    assert response.status_code == 200
    for format in ("html", "md", "csv"):
        export = client.get(f"/api/projects/{project['id']}/export?format={format}")
        assert export.status_code == 200 and len(export.content) > 100
    saved = client.get(f"/api/projects/{project['id']}").json()
    assert saved["result"]["findings"][0]["note"] == "Проверено по источнику"
    assert saved["runs"]


def test_upload_analyze_edit_invalidates(client, mock_gpt):
    project = client.post("/api/projects", json={"name": "Контрольный проект"}).json()
    path = f"/api/projects/{project['id']}"
    assert client.post(path + "/analyze", json={}).status_code == 422
    content = "Подразделение: Отдел закупок\n1. Ведение реестра договоров с поставщиками.".encode()
    documents = []
    for phase in ("before", "after"):
        upload = client.post(
            path + "/documents",
            data={"phase": phase},
            files={"file": ("Отдел.txt", content, "text/plain")},
        )
        assert upload.status_code == 201
        documents.append(upload.json())
    for removed_mode in ("local", "auto"):
        assert client.post(path + "/analyze", json={"mode": removed_mode}).status_code == 422
    assert client.post(path + "/analyze", json={}).status_code == 202
    result = client.get(path).json()["result"]
    assert result["stats"]["retained"] == 1
    assert result["stats"]["lost"] == 0
    document = client.get(f"/api/documents/{documents[0]['id']}").json()
    segment = document["segments"][-1]
    edited = client.patch(
        f"/api/documents/{document['id']}/segments/{segment['id']}",
        json={"department": "Дирекция закупок", "is_function": True},
    )
    assert edited.status_code == 200
    assert client.get(path).json()["result"] is None
    assert client.get(path).json()["runs"]
    assert client.get(f"/api/documents/{document['id']}/download").content == content
    assert client.delete(f"/api/documents/{document['id']}").status_code == 204


def test_errors_and_gpt_configuration(client):
    assert client.get("/api/projects/absent").status_code == 404
    assert client.post("/api/projects", json={"name": " "}).status_code == 422
    project = client.post("/api/projects", json={"name": "Тест"}).json()
    path = f"/api/projects/{project['id']}"
    assert client.post(path + "/analyze", json={"mode": "gpt"}).status_code == 422
    assert (
        client.post(
            path + "/documents",
            data={"phase": "before"},
            files={"file": ("bad.exe", b"bad")},
        ).status_code
        == 422
    )
    assert client.get(path + "/export").status_code == 409
    assert client.get("/api/health").json()["gpt_configured"] is False


def test_failed_gpt_run_keeps_previous_result_without_fallback(client, mock_gpt, monkeypatch):
    project = client.post("/api/projects/demo").json()
    path = f"/api/projects/{project['id']}"
    client.post(path + "/analyze", json={})
    previous = client.get(path).json()["result"]

    def rejected(*args):
        raise ValueError("OpenAI недоступен")

    monkeypatch.setattr(ai, "request", rejected)
    assert client.post(path + "/analyze", json={}).status_code == 202
    failed = client.get(path).json()
    assert failed["status"] == "failed"
    assert failed["result"]["id"] == previous["id"]
    assert failed["result"]["engine"] == "GPT · gpt-5"
    assert len(failed["runs"]) == 1


def test_docx_exact_paragraph_and_table():
    buffer = io.BytesIO()
    xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Подразделение: Отдел закупок</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>1. Ведение реестра договоров.</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", xml)
    segments, _ = extract("test.docx", buffer.getvalue())
    assert segments[1]["is_function"]
    assert segments[1]["text"] == "1. Ведение реестра договоров."
    assert "Абзац 2" in segments[1]["locator"]


def test_excel_rows():
    book = Workbook()
    book.active.title = "Функции"
    book.active.append(["Отдел закупок", "Ведение реестра договоров."])
    buffer = io.BytesIO()
    book.save(buffer)
    segments, _ = extract("test.xlsx", buffer.getvalue())
    assert segments[-1]["department"] == "Отдел закупок"
    assert segments[-1]["locator"] == "Функции, строка 1"
    assert segments[-1]["is_function"]


def test_scan_rejected():
    writer = PdfWriter()
    writer.add_blank_page(width=600, height=800)
    buffer = io.BytesIO()
    writer.write(buffer)
    with pytest.raises(ValueError, match="OCR"):
        extract("scan.pdf", buffer.getvalue())


def test_negation_is_not_retained():
    from app.analysis import similarity

    assert (
        similarity(
            "Отдел осуществляет контроль закупок",
            "Отдел не осуществляет контроль закупок",
        )
        < 0.62
    )


def test_ai_rejects_invented_citations(monkeypatch):
    fake = ai.Comparison(
        matches=[ai.Match(before_id="old", after_ids=["invented"], reason="same")],
        risks=[],
    )
    monkeypatch.setattr(ai, "request", lambda *a: (fake, {}))
    with pytest.raises(ValueError, match="неизвестную"):
        ai.compare([{"id": "old", "text": "before"}], [{"id": "new", "text": "after"}])


def test_ai_rejects_invented_department_id(monkeypatch):
    fake = ai.Extraction(
        segments=[
            ai.Classification(
                segment_id="1",
                department_source_id="invented",
                is_function=True,
            )
        ]
    )
    monkeypatch.setattr(ai, "request", lambda *a: (fake, {}))
    with pytest.raises(ValueError, match="после повторной проверки"):
        ai.extract_functions(
            {
                "name": "test.txt",
                "segments": [{"id": "1", "text": "Ведение реестра договоров"}],
            }
        )
