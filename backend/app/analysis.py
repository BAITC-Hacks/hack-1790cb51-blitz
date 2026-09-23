"""Explainable candidate matching; scores are similarity, never probabilities."""
import re
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from itertools import combinations

from . import ai
from .storage import now, uid

STOP = {"и", "в", "на", "по", "за", "с", "к", "из", "для", "о", "об", "а", "до", "от", "при", "или", "также", "осуществление", "обеспечение", "организация", "проведение", "подразделения", "компании", "деятельности"}
SYNONYMS = {"мониторинг": "контрол", "контроль": "контрол", "контроля": "контрол", "проверка": "провер", "проверки": "провер", "закупок": "закуп", "закупки": "закуп", "закупочных": "закуп", "контрактов": "договор", "контракты": "договор", "договорами": "договор", "договоров": "договор", "отчетности": "отчет", "отчетов": "отчет", "подготовка": "формир", "формирование": "формир"}


def tokens(text):
    words = re.findall(r"[а-яa-z]{3,}", text.lower().replace("ё", "е"))
    return {SYNONYMS.get(w, w[:7] if len(w) > 7 else w[:5] if len(w) > 5 else w) for w in words if w not in STOP}


def similarity(a, b):
    left, right = tokens(a), tokens(b)
    if not left or not right:
        return 0.0
    overlap = len(left & right) / len(left | right)
    lexical = SequenceMatcher(None, " ".join(sorted(left)), " ".join(sorted(right))).ratio()
    score = .8 * overlap + .2 * lexical
    # Negated responsibilities must never look like retained functions.
    if bool(re.search(r"\bне\b", a.lower())) != bool(re.search(r"\bне\b", b.lower())):
        score *= .3
    return round(score, 3)


def collect(documents, phase):
    return [{"id": f"{d['id']}:{s['id']}", "document_id": d["id"], "document_name": d["name"], "phase": phase, **s}
            | {"id": f"{d['id']}:{s['id']}"}
            for d in documents if d["phase"] == phase for s in d["segments"] if s["is_function"]]


def analyze(documents, progress=lambda value, stage: None, use_llm=False):
    before, after = collect(documents, "before"), collect(documents, "after")
    if not before or not after:
        raise ValueError("В каждом комплекте нужна хотя бы одна распознанная функция. Уточните разметку документов.")
    if len(before) + len(after) > 600:
        raise ValueError("Прототип поддерживает до 600 функций за один анализ. Разделите проект.")
    progress(30, "Сопоставление функций")
    ai_result, usage = ai.compare(before, after) if use_llm else (None, {})
    links = {m.before_id: m.after_ids for m in ai_result.matches} if ai_result else {}
    reasons = {m.before_id: m.reason for m in ai_result.matches} if ai_result else {}
    engine = f"GPT · {ai.model_name()}" if ai_result else "Локальный алгоритм"
    warnings = [] if use_llm else ["Анализ выполнен без GPT: используется лексическое сопоставление. Семантически разные формулировки требуют ручной проверки."]
    rows, findings, used = [], [], set()

    def finding(kind, severity, title, description, sources, recommendation, score=None):
        findings.append({"id": uid(), "kind": kind, "severity": severity, "title": title, "description": description,
                         "sources": sources, "recommendation": recommendation, "score": score, "status": "pending", "note": ""})

    for old in before:
        candidates = sorted([(new, similarity(old["text"], new["text"])) for new in after], key=lambda pair: pair[1], reverse=True)
        matches = [(new, score) for new, score in candidates if (new["id"] in links.get(old["id"], []) if ai_result else score >= .62)]
        best = candidates[0] if candidates else (None, 0)
        status = "lost" if not matches else "retained" if any(new["department"].lower() == old["department"].lower() for new, _ in matches) else "transferred"
        matched = [{"source": new, "score": round(score * 100), "method": "llm" if new["id"] in links.get(old["id"], []) else "lexical"} for new, score in matches]
        used.update(new["id"] for new, _ in matches)
        rows.append({"id": uid(), "before": old, "after": matched, "status": status, "reason": reasons.get(old["id"], "Сопоставление по сходству нормализованных формулировок."), "nearest": {"source": best[0], "score": round(best[1] * 100)} if not matches and best[0] else None})
        if not matches:
            finding("loss", "high", "Не найден преемник функции", f"Функция подразделения «{old['department']}» не сопоставлена с комплектом «после». Это кандидат на потерю, а не доказательство отсутствия функции.", [old], "Проверьте полноту комплекта «после» и закрепите функцию за ответственным подразделением.", round(best[1] * 100))
    for new in after:
        if new["id"] not in used:
            rows.append({"id": uid(), "before": None, "after": [{"source": new, "score": 100, "method": "lexical"}], "status": "new", "nearest": None})

    progress(65, "Поиск пересечений и конфликтов")
    for a, b in combinations(after, 2) if not ai_result else []:
        score = similarity(a["text"], b["text"])
        if a["department"] != b["department"] and score >= .72:
            finding("duplication", "medium", "Пересечение зон ответственности", f"Похожие функции закреплены за «{a['department']}» и «{b['department']}». Совместное участие может быть обоснованным — проверьте разделение ролей.", [a, b], "Определите владельца функции и разделите исполнение, согласование и контроль.", round(score * 100))
        procurement = r"закуп|договор|поставщик"
        execution = r"проведен|провод|заключен|выбор поставщик"
        oversight = r"аудит|независим|проверка.*закуп|контроль.*закуп"
        if a["department"] == b["department"] and all(re.search(procurement, s["text"], re.I) for s in (a, b)):
            if (re.search(execution, a["text"], re.I) and re.search(oversight, b["text"], re.I)) or (re.search(execution, b["text"], re.I) and re.search(oversight, a["text"], re.I)):
                finding("conflict", "high", "Исполнение и контроль в одном подразделении", f"В «{a['department']}» обнаружены функции исполнения и независимого контроля закупок. Это индикатор для проверки разграничения полномочий.", [a, b], "Рассмотрите передачу независимого контроля другому подразделению. Проверьте регламенты и матрицу полномочий.")

    if ai_result:
        source_map = {s["id"]: s for s in after}
        for risk in ai_result.risks:
            finding(risk.kind, risk.severity, risk.title, risk.description, [source_map[i] for i in dict.fromkeys(risk.source_ids)], risk.recommendation)
    progress(85, "Формирование заключения")
    old_depts = sorted({f["department"] for f in before})
    new_depts = sorted({f["department"] for f in after})
    departments = []
    for department in old_depts:
        transferred = Counter(new["source"]["department"] for row in rows if row["before"] and row["before"]["department"] == department for new in row["after"])
        targets = list(transferred)
        status = "retained" if department in new_depts else "reorganized" if targets else "removed"
        departments.append({"name": department, "status": status, "targets": targets, "before_count": sum(f["department"] == department for f in before), "after_count": sum(f["department"] in targets for f in after)})
    for department in new_depts:
        if department not in old_depts and not any(department in d["targets"] for d in departments):
            departments.append({"name": department, "status": "created", "targets": [department], "before_count": 0, "after_count": sum(f["department"] == department for f in after)})
    counts = Counter(row["status"] for row in rows)
    stats = {"before_functions": len(before), "after_functions": len(after), "before_departments": len(old_depts), "after_departments": len(new_depts),
             "retained": counts["retained"], "transferred": counts["transferred"], "lost": counts["lost"], "new": counts["new"],
             "coverage": round(100 * (len(before) - counts["lost"]) / len(before)), "risks": len(findings),
             "high_risks": sum(f["severity"] == "high" for f in findings), "duplications": sum(f["kind"] == "duplication" for f in findings), "conflicts": sum(f["kind"] == "conflict" for f in findings)}
    return {"id": uid(), "created_at": now(), "engine": engine, "warnings": warnings, "usage": usage,
            "stats": stats, "mapping": rows, "departments": departments, "findings": findings,
            "summary": f"Сопоставлено {len(before)} функций до и {len(after)} после реорганизации. Для {stats['coverage']}% исходных функций найдены кандидаты-преемники. Требуют проверки: {stats['lost']} возможных потерь, {stats['duplications']} пересечений и {stats['conflicts']} потенциальных конфликтов.",
            "methodology": "Сопоставление по нормализованным словам, словарю синонимов и сходству формулировок. Порог соответствия 62%, пересечения 72%. Проценты показывают сходство текстов, а не вероятность правильности вывода. Преобразования подразделений выведены из переноса функций. Выводы требуют проверки сотрудником."}
