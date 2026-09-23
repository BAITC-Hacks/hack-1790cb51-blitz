"""Extraction preserves exact paragraphs, worksheet rows and PDF page locators."""

import csv
import io
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from openpyxl import load_workbook
from pypdf import PdfReader

MAX_BYTES = 10 * 1024 * 1024
ALLOWED = {".docx", ".pdf", ".xlsx", ".txt", ".csv"}
DEPARTMENT = re.compile(
    r"^(?:департамент|отдел|управление|служба|дирекция|центр|комитет|бюро)\b", re.I
)
ACTION = re.compile(
    r"\b(контрол|организ|обеспеч|провед|провод|управлен|разработ|согласован|согласовы|утвержд|подготов|формир|ведени|ведение|осуществ|анализ|мониторинг|планирован|оценк|учет|учёт|сопровожд|провер|заключен|закуп|хранени|регистрац|координац|аудит|отчет|отчёт)",
    re.I,
)
NUMBER = re.compile(r"^\s*((?:\d+\.)*\d+)[.)]?\s+(.+)")
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def annotate_sections(segments):
    """Keep exact source text; attach numbered heading ancestry, not extra functions."""
    stack = []
    for index, segment in enumerate(segments):
        match = NUMBER.match(segment["text"])
        number = match.group(1) if match else None
        body = match.group(2) if match else segment["text"]
        if segment.get("is_department"):
            stack = []
        if number:
            while stack and not number.startswith(stack[-1][0] + "."):
                stack.pop()
        following = segments[index + 1] if index + 1 < len(segments) else None
        next_number = NUMBER.match(following["text"]) if following else None
        has_children = bool(
            number and next_number and next_number.group(1).startswith(number + ".")
        )
        # A colon introduces a list, even when its children are bullets rather than numbers.
        # Numbering alone must not discard a complete responsibility with subclauses.
        is_heading = bool(
            number
            and not segment.get("is_department")
            and (body.endswith(":") or (has_children and not ACTION.search(body)))
        )
        segment["is_section_heading"] = is_heading
        segment["section_path"] = [{"id": s["id"], "text": s["text"]} for _, s in stack]
        if is_heading:
            stack.append((number, segment))


def safe_zip(data):
    archive = zipfile.ZipFile(io.BytesIO(data))
    if sum(item.file_size for item in archive.infolist()) > 60 * 1024 * 1024:
        archive.close()
        raise ValueError("Слишком большой распакованный документ. Разделите файл на части.")
    return archive


def extract(name: str, data: bytes) -> tuple[list[dict], list[str]]:
    extension = Path(name).suffix.lower()
    if extension not in ALLOWED:
        raise ValueError(
            "Поддерживаются DOCX, PDF, XLSX, TXT и CSV. Старые DOC/XLS сохраните в новом формате."
        )
    if not data or len(data) > MAX_BYTES:
        raise ValueError("Файл должен быть непустым и не превышать 10 МБ.")
    lines, warnings = [], []
    try:
        if extension == ".docx":
            with safe_zip(data) as archive:
                root = ET.fromstring(archive.read("word/document.xml"))
            for i, p in enumerate(root.findall(".//w:body//w:p", NS), 1):
                value = "".join(t.text or "" for t in p.findall(".//w:t", NS))
                lines.append((value, f"Абзац {i}"))
        elif extension == ".pdf":
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                raise ValueError("PDF защищён паролем. Загрузите незашифрованную копию.")
            if len(reader.pages) > 150:
                raise ValueError("Допускается до 150 страниц в одном PDF.")
            for page_number, page in enumerate(reader.pages, 1):
                for line_number, value in enumerate((page.extract_text() or "").splitlines(), 1):
                    lines.append((value, f"Стр. {page_number}, строка {line_number}"))
            warnings.append(
                "PDF: проверьте разбиение строк в источнике. Сканированные страницы без текста требуют OCR."
            )
        elif extension in {".xlsx", ".csv"}:
            if extension == ".xlsx":
                with safe_zip(data):
                    pass
                book = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
                sheets = [(sheet.title, sheet.iter_rows(values_only=True)) for sheet in book]
            else:
                decoded = data.decode("utf-8-sig")
                delimiter = ";" if decoded.count(";") > decoded.count(",") else ","
                sheets = [("CSV", csv.reader(io.StringIO(decoded), delimiter=delimiter))]
            for sheet_name, rows in sheets:
                for index, row in enumerate(rows, 1):
                    cells = [str(v).strip() for v in row if v is not None and str(v).strip()]
                    if len(cells) >= 2 and DEPARTMENT.match(cells[0]):
                        lines.append(
                            (
                                "Подразделение: " + cells[0],
                                f"{sheet_name}, строка {index}",
                            )
                        )
                        lines.append((" — ".join(cells[1:]), f"{sheet_name}, строка {index}"))
                    else:
                        lines.append((" — ".join(cells), f"{sheet_name}, строка {index}"))
                    if len(lines) > 4000:
                        raise ValueError("Слишком много строк. Загрузите до 4000 непустых строк.")
            if extension == ".xlsx":
                book.close()
        else:
            lines = [
                (v, f"Строка {i}") for i, v in enumerate(data.decode("utf-8-sig").splitlines(), 1)
            ]
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(
            "Не удалось прочитать файл. Проверьте формат, целостность и кодировку UTF-8."
        ) from exc
    if len(lines) > 4000 or sum(len(v) for v, _ in lines) > 600_000:
        raise ValueError(
            "Документ слишком большой для прототипа. Разделите его на несколько файлов."
        )
    department = Path(name).stem
    explicit_department = False
    segments = []
    for text, locator in lines:
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            continue
        number = NUMBER.match(text)
        body = number.group(2) if number else text
        heading = re.sub(
            r"^(?:подразделение|положение о подразделении|положение о)\s*[:—–-]?\s*",
            "",
            body,
            flags=re.I,
        )
        is_heading = (
            (body.lower().startswith("подразделение:") or bool(DEPARTMENT.match(heading)))
            and len(heading) < 180
            and not ACTION.search(heading.split(" ", 1)[-1] if " " in heading else "")
        )
        # Department names such as «Департамент управления рисками» also contain action stems.
        if body.lower().startswith("подразделение:"):
            is_heading = True
        if is_heading:
            department = heading.rstrip(".:")
            explicit_department = True
        is_function = not is_heading and len(body) >= 16 and bool(ACTION.search(body))
        if body.lower().startswith(
            (
                "положение",
                "приложение",
                "утвержден",
                "утверждён",
                "организационная структура",
            )
        ):
            is_function = False
        segments.append(
            {
                "id": str(len(segments) + 1),
                "text": text,
                "locator": f"Пункт {number.group(1)} · {locator}" if number else locator,
                "department": department,
                "is_function": is_function,
                "is_department": is_heading,
            }
        )
    annotate_sections(segments)
    for segment in segments:
        if segment["is_section_heading"]:
            segment["is_function"] = False
    if not segments:
        raise ValueError(
            "Текст не найден. Для скана сначала выполните OCR и сохраните PDF с текстовым слоем."
        )
    if not explicit_department:
        warnings.append(
            "Название подразделения взято из имени файла. Его можно уточнить в просмотре документа."
        )
    if not any(s["is_function"] for s in segments):
        warnings.append(
            "Функции не распознаны автоматически. Откройте документ и отметьте нужные фрагменты как функции."
        )
    return segments, warnings
