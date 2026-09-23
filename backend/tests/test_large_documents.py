"""Large-input regression tests. All provider calls are mocked, never paid."""

from copy import deepcopy
from itertools import combinations, product

import pytest

from app import ai
from app.parser import extract


def test_extraction_over_450_with_large_catalog_and_heading_context(mock_gpt, monkeypatch):
    text = "\n".join(
        f"Подразделение: Отдел направления {unit}\n"
        + "\n".join(f"{i}. Ведение реестра направления {unit}, задача {i}." for i in range(1, 7))
        for unit in range(241)
    )
    segments, warnings = extract("large.txt", text.encode())
    expected_departments = [s["department"] for s in segments]
    segments[-1].update(manual=True, department="Ручное подразделение", is_function=False)
    expected_departments[-1] = "Ручное подразделение"
    original = ai.request
    seen, sizes, updates = [], [], []

    def respond(schema, instruction, payload):
        seen.extend(s["id"] for s in payload["segments"])
        sizes.append(len(payload["segments"]))
        properties = schema.model_json_schema()["$defs"]["SourceClassification"]["properties"]
        assert sum(len(p.get("enum", [p.get("const")])) for p in properties.values()) < 1000
        assert len(payload["departments"]) <= ai.EXTRACTION_BATCH_SIZE + 1
        if len(sizes) > 1:
            previous = payload["preceding_department_source_id"]
            assert previous in {d["id"] for d in payload["departments"]}
        return original(schema, instruction, payload)

    monkeypatch.setattr(ai, "request", respond)
    usage = ai.extract_functions(
        {"name": "large.txt", "segments": segments, "warnings": warnings},
        progress=lambda done, total: updates.append((done, total)),
    )
    assert len(segments) == 1687
    assert seen == [s["id"] for s in segments]
    assert max(sizes) <= ai.EXTRACTION_BATCH_SIZE and len(sizes) > 1
    assert [s["department"] for s in segments] == expected_departments
    assert not segments[-1]["is_function"]
    assert usage == {"input_tokens": 10 * len(sizes), "output_tokens": 10 * len(sizes)}
    assert updates[-1] == (len(sizes), len(sizes))


def test_failed_extraction_does_not_apply_partial_classification(mock_gpt, monkeypatch):
    monkeypatch.setattr(ai, "EXTRACTION_BATCH_SIZE", 2)
    segments, warnings = extract(
        "company.txt",
        (
            "Подразделение: Отдел контроля\n"
            + "\n".join(f"{i}. Ведение реестра." for i in range(3))
        ).encode(),
    )
    document = {"name": "company.txt", "segments": segments, "warnings": warnings}
    original_document = deepcopy(document)
    original = ai.request
    calls = []

    def respond(*args):
        calls.append(1)
        if len(calls) == 2:
            raise ValueError("Контрольная ошибка провайдера")
        return original(*args)

    monkeypatch.setattr(ai, "request", respond)
    with pytest.raises(ValueError, match="часть 2/2"):
        ai.extract_functions(document)
    assert document == original_document


def test_utf8_batch_budget_keeps_all_text_and_rejects_huge_single_fragment(monkeypatch):
    monkeypatch.setattr(ai, "BATCH_BYTES", 48_000)
    items = [{"id": str(i), "text": "Я" * 15_000} for i in range(5)]
    parts = ai.batches(items, 120)
    assert len(parts) == 5
    assert [s for part in parts for s in part] == items
    with pytest.raises(ValueError, match="отдельный абзац"):
        ai.batches([{"id": "huge", "text": "Я" * ai.SINGLE_ITEM_BYTES}], 120)


def test_all_cross_part_matches_and_risks_are_checked_and_merged(monkeypatch):
    monkeypatch.setattr(ai, "BEFORE_BATCH_SIZE", 2)
    monkeypatch.setattr(ai, "AFTER_BATCH_SIZE", 2)
    before = [{"id": f"b{i}", "text": f"old {i}"} for i in range(5)]
    after = [{"id": f"a{i}", "text": f"new {i}"} for i in range(6)]
    targets = {"b0": ["a4", "a5"], "b1": ["a0"], "b2": ["a3"], "b3": [], "b4": ["a1"]}
    compared, checked_risks, calls, updates = set(), set(), [], []

    def respond(schema, instruction, payload):
        left = [s["id"] for s in payload["before"]]
        right = [s["id"] for s in payload["after"]]
        compared.update(product(left, right))
        calls.append(payload)
        risks = []
        if "Верни risks пустым" not in instruction:
            checked_risks.update(frozenset(pair) for pair in combinations(right, 2))
            for kind, ids in [("duplication", ["a0", "a5"]), ("conflict", ["a2", "a3"])]:
                if set(ids).issubset(right):
                    for severity, sources in [("medium", ids), ("high", list(reversed(ids)))]:
                        risks.append(
                            ai.Risk(
                                kind=kind,
                                severity=severity,
                                title="Test risk",
                                description="Test",
                                source_ids=sources,
                                recommendation="Check",
                            )
                        )
        return ai.Comparison(
            matches=[
                ai.Match(
                    before_id=id,
                    after_ids=[i for i in targets[id] if i in right],
                    reason="Есть соответствие"
                    if any(i in right for i in targets[id])
                    else "Нет в этой части",
                )
                for id in left
            ],
            risks=risks,
        ), {"input_tokens": 10, "output_tokens": 5}

    monkeypatch.setattr(ai, "request", respond)
    result, usage = ai.compare(before, after, progress=lambda value, stage: updates.append(value))
    assert compared == set(product([s["id"] for s in before], [s["id"] for s in after]))
    assert checked_risks == {frozenset(pair) for pair in combinations([s["id"] for s in after], 2)}
    assert len(calls) == 3 * 3 + 3
    assert {m.before_id: m.after_ids for m in result.matches} == targets
    assert result.matches[0].reason == "Есть соответствие"
    assert "всех частей" in result.matches[3].reason
    assert len(result.risks) == 2
    assert all(r.severity == "high" for r in result.risks)
    assert usage == {"input_tokens": 120, "output_tokens": 60}
    assert updates == sorted(updates) and updates[-1] == 80


@pytest.mark.parametrize(
    "error", ["missing_match", "duplicate_match", "other_part_id", "invalid_risk"]
)
def test_bad_comparison_part_is_rejected(monkeypatch, error):
    monkeypatch.setattr(ai, "AFTER_BATCH_SIZE", 1)

    def respond(*args):
        matches = [ai.Match(before_id="b", after_ids=[], reason="Test")]
        risks = []
        if error == "missing_match":
            matches = []
        elif error == "duplicate_match":
            matches *= 2
        elif error == "other_part_id":
            matches[0].after_ids = ["a1"]  # Exists globally, absent in this request.
        else:
            risks = [
                ai.Risk(
                    kind="conflict",
                    severity="high",
                    title="Test",
                    description="Test",
                    source_ids=["a0", "a0"],
                    recommendation="Check",
                )
            ]
        return ai.Comparison(matches=matches, risks=risks), {}

    monkeypatch.setattr(ai, "request", respond)
    with pytest.raises(ValueError, match="запрос 1/3"):
        ai.compare([{"id": "b", "text": "old"}], [{"id": f"a{i}", "text": "new"} for i in range(2)])
