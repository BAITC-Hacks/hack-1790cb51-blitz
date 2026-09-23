"""Numbered headings remain cited context, not duplicate responsibilities."""

import io
import zipfile
from copy import deepcopy
from xml.sax.saxutils import escape

import pytest
from openpyxl import Workbook

from app import ai
from app.parser import extract

PARENT = (
    "2.3. Для достижения целей внутренний аудит решает поставленные перед ним "
    "в Обществе задачи по следующим основным направлениям:"
)
CHILD = "2.3.1. Оценка эффективности системы внутреннего контроля (далее СВК):"
DUTY = "2.3.1.1. Проверка полноты контрольных процедур и подготовка рекомендаций."
SIBLING = "2.3.2. Оценка эффективности управления рисками:"
LINES = [PARENT, CHILD, DUTY, SIBLING, "2.3.2.1. Анализ существенных рисков."]


def encoded(extension, lines):
    stream = io.BytesIO()
    if extension == "docx":
        body = "".join(f"<w:p><w:r><w:t>{escape(line)}</w:t></w:r></w:p>" for line in lines)
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr(
                "word/document.xml",
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                f"<w:body>{body}</w:body></w:document>",
            )
    elif extension == "xlsx":
        book = Workbook()
        for line in lines:
            book.active.append([line])
        book.save(stream)
        book.close()
    else:
        return "\n".join(lines).encode()
    return stream.getvalue()


@pytest.mark.parametrize("extension", ["txt", "docx", "xlsx", "csv"])
def test_exact_headings_keep_hierarchy_and_source(extension):
    segments, _ = extract(f"audit.{extension}", encoded(extension, LINES))
    assert [s["is_function"] for s in segments] == [False, False, True, False, True]
    assert segments[2]["text"] == DUTY
    assert segments[2]["locator"].startswith("Пункт 2.3.1.1 · ")
    assert [s["text"] for s in segments[2]["section_path"]] == [PARENT, CHILD]
    assert [s["text"] for s in segments[4]["section_path"]] == [PARENT, SIBLING]


def test_pdf_text_lines_use_the_same_hierarchy(monkeypatch):
    class Page:
        def extract_text(self):
            return "\n".join(LINES)

    class Reader:
        is_encrypted = False
        pages = [Page()]

    monkeypatch.setattr("app.parser.PdfReader", lambda data: Reader())
    segments, _ = extract("audit.pdf", b"mocked PDF text layer")
    assert [s["text"] for s in segments[2]["section_path"]] == [PARENT, CHILD]
    assert segments[2]["locator"] == "Пункт 2.3.1.1 · Стр. 1, строка 3"


def test_bullets_and_numbered_functions_keep_context_without_leaking_sections():
    segments, _ = extract(
        "audit.txt",
        "\n".join(
            [
                PARENT,
                CHILD,
                "— Проверка полноты контрольных процедур.",
                "2.4. Подготовка ежегодного отчёта.",
                "2.4.1. Согласование отчёта с советом.",
                "Подразделение: Отдел закупок",
                "1. Ведение реестра договоров.",
            ]
        ).encode(),
    )
    assert len(segments[2]["section_path"]) == 2
    assert segments[3]["is_function"] and segments[3]["section_path"] == []
    assert segments[4]["is_function"]  # A parent duty is not silently discarded.
    assert segments[-1]["section_path"] == []


def test_gpt_chunks_receive_parent_context_and_cannot_promote_headers(monkeypatch):
    segments, _ = extract("audit.txt", encoded("txt", LINES))
    for segment in segments:  # Simulate an older stored upload.
        segment.pop("section_path")
        segment.pop("is_section_heading")
    monkeypatch.setattr(ai, "EXTRACTION_BATCH_SIZE", 1)
    seen = []

    def respond(schema, instruction, payload):
        seen.extend(payload["segments"])
        return schema.model_validate(
            {
                "segments": [
                    {"segment_id": s["id"], "department_source_id": "filename", "is_function": True}
                    for s in payload["segments"]
                ]
            }
        ), {}

    monkeypatch.setattr(ai, "request", respond)
    ai.extract_functions({"name": "audit.txt", "segments": segments})
    assert [s["is_function"] for s in segments] == [False, False, True, False, True]
    assert [s["text"] for s in seen[2]["section_path"]] == [PARENT, CHILD]
    assert [s["id"] for s in seen] == ["1", "2", "3", "4", "5"]


def test_manual_heading_override_and_context_survive_extraction(mock_gpt):
    segments, _ = extract("audit.txt", encoded("txt", LINES))
    segments[1].update(manual=True, is_function=True)
    ai.extract_functions({"name": "audit.txt", "segments": segments})
    assert segments[1]["is_function"] is True
    assert segments[1]["is_section_heading"] is True


def test_comparison_receives_context_but_keeps_verbatim_function(monkeypatch):
    segments, _ = extract("audit.txt", encoded("txt", LINES))
    source = {**segments[2], "id": "before:3"}
    target = {**deepcopy(source), "id": "after:3"}

    def respond(schema, instruction, payload):
        assert payload["before"][0]["text"] == DUTY
        assert [s["text"] for s in payload["after"][0]["section_path"]] == [PARENT, CHILD]
        return ai.Comparison(
            matches=[ai.Match(before_id="before:3", after_ids=["after:3"], reason="Сохранена")],
            risks=[],
        ), {}

    monkeypatch.setattr(ai, "request", respond)
    result, _ = ai.compare([source], [target])
    assert result.matches[0].after_ids == ["after:3"]
