import csv
import io
from html import escape

STATUS = {
    "pending": "На проверке",
    "confirmed": "Подтверждено",
    "dismissed": "Отклонено",
}
MAPPING = {
    "retained": "Сохранена",
    "transferred": "Передана",
    "lost": "Не найдена",
    "new": "Новая",
}


def export_report(project, format):
    result = project["result"]
    if format == "csv":
        buffer = io.StringIO()
        writer = csv.writer(buffer, delimiter=";")

        def safe(value):
            text = str(value)
            return "'" + text if text.startswith(("=", "+", "-", "@", "\t", "\r", "\n")) else text

        writer.writerow(
            [
                "Функция до",
                "Подразделение до",
                "Функция после",
                "Подразделение после",
                "Статус",
                "Источник до",
                "Источники после",
            ]
        )
        for row in result["mapping"]:
            old = row["before"] or {}
            writer.writerow(
                [
                    safe(v)
                    for v in [
                        old.get("text", ""),
                        old.get("department", ""),
                        " | ".join(a["source"]["text"] for a in row["after"]),
                        " | ".join(a["source"]["department"] for a in row["after"]),
                        MAPPING[row["status"]],
                        old.get("document_name", "") + " · " + old.get("locator", ""),
                        " | ".join(
                            a["source"]["document_name"] + " · " + a["source"]["locator"]
                            for a in row["after"]
                        ),
                    ]
                ]
            )
        return "\ufeff" + buffer.getvalue(), "text/csv; charset=utf-8"
    parts = [
        ("h1", "Аналитическое заключение"),
        ("h2", project["name"]),
        ("p", project["organization"]),
        (
            "p",
            f"Сформировано: {result['created_at'][:10]} · {result['engine']} · Редакция {result['revision']}",
        ),
        ("h2", "Результат сравнения"),
        ("p", result["summary"]),
        (
            "p",
            "Результаты носят рекомендательный характер. Отсутствие сопоставления не доказывает утрату функции. Проверка ответственным сотрудником обязательна.",
        ),
    ]
    parts.append(("h2", "Замечания и рекомендации"))
    for index, finding in enumerate(result["findings"], 1):
        parts.extend(
            [
                ("h3", f"{index}. {finding['title']} · {STATUS[finding['status']]}"),
                ("p", finding["description"]),
                ("p", "Рекомендация: " + finding["recommendation"]),
            ]
        )
        for source in finding["sources"]:
            parts.append(
                (
                    "blockquote",
                    f"{source['document_name']} · {source['locator']}\n{source['text']}",
                )
            )
        if finding["note"]:
            parts.append(("p", "Комментарий проверяющего: " + finding["note"]))
    parts.append(("h2", "Сопоставление функций"))
    for row in result["mapping"]:
        parts.append(("h3", MAPPING[row["status"]]))
        if row["before"]:
            source = row["before"]
            parts.append(
                (
                    "p",
                    f"До: {source['department']} · {source['text']} ({source['document_name']}, {source['locator']})",
                )
            )
        for item in row["after"]:
            source = item["source"]
            parts.append(
                (
                    "p",
                    f"После: {source['department']} · {source['text']} ({source['document_name']}, {source['locator']})",
                )
            )
    parts.extend([("h2", "Метод и ограничения"), ("p", result["methodology"])])
    parts.extend(("p", warning) for warning in result["warnings"])
    if format == "md":
        markers = {"h1": "# ", "h2": "## ", "h3": "### ", "blockquote": "> ", "p": ""}
        return "\n\n".join(
            markers[tag] + text for tag, text in parts
        ), "text/markdown; charset=utf-8"
    content = "\n".join(f"<{tag}>{escape(text)}</{tag}>" for tag, text in parts)
    return (
        '<!doctype html><html lang="ru"><meta charset="utf-8"><title>ATLAS — заключение</title><style>body{font:16px/1.65 system-ui,sans-serif;color:#182b27;max-width:850px;margin:60px auto;padding:0 24px}h1{font-size:36px}h2{margin-top:40px}h3{margin-top:28px}blockquote{margin:16px 0;padding:14px 20px;background:#f3f6f4;white-space:pre-line}p{overflow-wrap:anywhere}@media print{body{margin:0;font-size:11pt}h2,h3{break-after:avoid}blockquote{break-inside:avoid}} </style><body>'
        + content
        + "</body></html>",
        "text/html; charset=utf-8",
    )
