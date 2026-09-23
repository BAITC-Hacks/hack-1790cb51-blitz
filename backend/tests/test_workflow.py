import io
import zipfile

import pytest
from openpyxl import Workbook
from pypdf import PdfWriter

from app import ai
from app.parser import extract
from app.storage import db
from sample_pair import create_pair


def test_pair_end_to_end_and_sources(client, mock_gpt):
    project = create_pair(client)
    assert project["status"] == "draft" and project["result"] is None
    assert client.post(f"/api/projects/{project['id']}/analyze", json={}).status_code == 202
    project = client.get(f"/api/projects/{project['id']}").json()
    assert project["status"] == "completed"
    result = project["result"]
    assert result["engine"] == "GPT · gpt-5.6-sol"
    assert result["usage"] == {"input_tokens": 30, "output_tokens": 30, "total_tokens": 60}
    assert len(project["documents"]) == 2
    assert result["stats"]["before_functions"] == 17
    assert result["stats"]["after_functions"] == 18
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
        assert "Изменения подразделений" not in export.text
        assert "Метод и ограничения" not in export.text
        assert "Методология и ограничения" not in export.text
    saved = client.get(f"/api/projects/{project['id']}").json()
    assert saved["result"]["findings"][0]["note"] == "Проверено по источнику"
    assert saved["runs"]


def test_numbered_heading_context_is_saved_in_sources(client, mock_gpt):
    from test_section_headings import CHILD, DUTY, LINES, PARENT

    project = client.post("/api/projects", json={"name": "Вложенные пункты"}).json()
    path = f"/api/projects/{project['id']}"
    for phase in ("before", "after"):
        response = client.post(
            path + "/documents",
            data={"phase": phase},
            files={"file": (f"{phase}.txt", "\n".join(LINES).encode())},
        )
        assert response.status_code == 201
    assert client.post(path + "/analyze", json={}).status_code == 202
    result = client.get(path).json()["result"]
    assert result["stats"]["before_functions"] == 2
    assert result["stats"]["after_functions"] == 2
    source = result["mapping"][0]["before"]
    assert source["text"] == DUTY
    assert [s["text"] for s in source["section_path"]] == [PARENT, CHILD]
    saved = client.get(f"/api/documents/{source['document_id']}").json()
    assert saved["segments"][1]["is_section_heading"] is True
    assert saved["segments"][1]["is_function"] is False


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


def test_large_files_end_to_end_without_old_gpt_limits(client, mock_gpt, monkeypatch):
    project = client.post("/api/projects", json={"name": "Большая организация"}).json()
    path = f"/api/projects/{project['id']}"
    lines = [
        f"{i}. Ведение реестра направления {i}. "
        + "Подготовка сведений для ответственных сотрудников. " * 6
        for i in range(1, 641)
    ]
    content = ("Подразделение: Отдел контроля\n" + "\n".join(lines)).encode()
    assert len(content.decode()) > 160_000
    for phase in ("before", "after"):
        uploaded = client.post(
            path + "/documents", data={"phase": phase}, files={"file": (f"{phase}.txt", content)}
        )
        assert uploaded.status_code == 201

    original = ai.request
    calls = []

    def respond(schema, instruction, payload):
        calls.append(len(payload.get("segments", [])))
        return original(schema, instruction, payload)

    monkeypatch.setattr(ai, "request", respond)
    assert client.post(path + "/analyze", json={}).status_code == 202
    saved = client.get(path).json()
    assert saved["status"] == "completed", saved.get("error")
    result = saved["result"]
    assert result["stats"]["before_functions"] == 640
    assert result["stats"]["after_functions"] == 640
    assert result["stats"]["retained"] == 640
    assert result["stats"]["lost"] == 0
    assert result["usage"] == {
        "input_tokens": len(calls) * 10,
        "output_tokens": len(calls) * 10,
        "total_tokens": len(calls) * 20,
    }
    assert sum(calls) == 2 * 641
    assert len(saved["runs"]) == 1 and len(result["mapping"]) == 640
    for document in saved["documents"]:
        assert client.get(f"/api/documents/{document['id']}/download").content == content


def test_late_batch_failure_does_not_save_partial_result(client, mock_gpt, monkeypatch):
    project = create_pair(client)
    path = f"/api/projects/{project['id']}"
    client.post(path + "/analyze", json={})
    previous = client.get(path).json()
    monkeypatch.setattr(ai, "BEFORE_BATCH_SIZE", 5)
    original = ai.request
    calls = []

    def respond(schema, instruction, payload):
        if "before" in payload:
            calls.append(1)
            if len(calls) == 2:
                raise ValueError("Контрольная ошибка части")
        return original(schema, instruction, payload)

    monkeypatch.setattr(ai, "request", respond)
    assert client.post(path + "/analyze", json={}).status_code == 202
    failed = client.get(path).json()
    assert failed["status"] == "failed"
    assert "запрос 2/4" in failed["error"]
    assert failed["result"] == previous["result"]
    assert len(failed["runs"]) == len(previous["runs"])


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


def test_single_slot_upload_and_atomic_replacement(client, mock_gpt):
    project = create_pair(client)
    path = f"/api/projects/{project['id']}"
    client.post(path + "/analyze", json={})
    original = client.get(path).json()
    before = next(d for d in original["documents"] if d["phase"] == "before")
    original_bytes = client.get(f"/api/documents/{before['id']}/download").content
    content = "Подразделение: Отдел закупок\n1. Ведение реестра договоров.".encode()
    duplicate = client.post(
        path + "/documents", data={"phase": "before"}, files={"file": ("new.txt", content)}
    )
    assert duplicate.status_code == 409
    # A broken replacement must leave both the original and its analysis intact.
    invalid = client.post(
        path + "/documents",
        data={"phase": "before", "replace_document_id": before["id"]},
        files={"file": ("broken.pdf", b"not a pdf")},
    )
    assert invalid.status_code == 422
    unchanged = client.get(path).json()
    assert unchanged["revision"] == original["revision"]
    assert unchanged["result"]["id"] == original["result"]["id"]
    assert client.get(f"/api/documents/{before['id']}/download").content == original_bytes
    # A stale ID or an ID from the other side must never overwrite the selected slot.
    after = next(d for d in original["documents"] if d["phase"] == "after")
    for invalid_id in ("missing", after["id"]):
        response = client.post(
            path + "/documents",
            data={"phase": "before", "replace_document_id": invalid_id},
            files={"file": ("new.txt", content)},
        )
        assert response.status_code == 409
    replaced = client.post(
        path + "/documents",
        data={"phase": "before", "replace_document_id": before["id"]},
        files={"file": ("new.txt", content)},
    )
    assert replaced.status_code == 201
    assert replaced.json()["id"] != before["id"]
    saved = client.get(path).json()
    assert len(saved["documents"]) == 2
    assert saved["result"] is None and len(saved["runs"]) == 1
    assert saved["revision"] == original["revision"] + 1
    assert client.get(f"/api/documents/{after['id']}/download").status_code == 200
    assert client.get(f"/api/documents/{replaced.json()['id']}/download").content == content
    # Two tabs replacing the same file cannot overwrite the first successful replacement.
    stale = client.post(
        path + "/documents",
        data={"phase": "before", "replace_document_id": before["id"]},
        files={"file": ("stale.txt", content)},
    )
    assert stale.status_code == 409


def test_legacy_documents_preserved_and_analysis_requires_pair(client, mock_gpt):
    project = create_pair(client)
    path = f"/api/projects/{project['id']}"
    with db() as conn:
        conn.execute(
            "INSERT INTO documents SELECT 'legacy',project_id,name,phase,size,created_at,segments,warnings,content "
            "FROM documents WHERE project_id=? AND phase='before'",
            (project["id"],),
        )
    assert client.post(path + "/analyze", json={}).status_code == 422
    assert len(client.get(path).json()["documents"]) == 3
    assert client.get("/api/documents/legacy/download").status_code == 200
    assert client.delete("/api/documents/legacy").status_code == 204
    assert client.post(path + "/analyze", json={}).status_code == 202


def test_clean_start_without_examples(client):
    assert client.get("/api/projects").json() == []
    assert client.get("/api/examples").status_code == 404
    assert client.post("/api/projects/demo").status_code == 405


def test_failed_gpt_run_keeps_previous_result_without_fallback(client, mock_gpt, monkeypatch):
    project = create_pair(client)
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
    assert failed["result"]["engine"] == "GPT · gpt-5.6-sol"
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
