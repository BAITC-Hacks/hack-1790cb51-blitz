import httpx
import pytest

from app import ai
from app.analysis import analyze
from app.parser import extract


def test_responses_api_strict_contract(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-not-real")
    monkeypatch.setenv("OPENAI_MODEL", "ignored-other-model")

    def post(url, **kwargs):
        assert url == "https://api.openai.com/v1/responses"
        body = kwargs["json"]
        assert body["model"] == "gpt-5.6-sol"
        assert body["reasoning"] == {"effort": "low"}
        assert body["store"] is False
        assert body["text"]["format"]["strict"] is True
        assert body["text"]["format"]["schema"]["additionalProperties"] is False
        return httpx.Response(
            200,
            json={
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "content": [
                            {
                                "type": "output_text",
                                "text": '{"matches": [], "risks": []}',
                            }
                        ],
                    }
                ],
                "usage": {"input_tokens": 100, "output_tokens": 20},
            },
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx, "post", post)
    result, usage = ai.request(ai.Comparison, "test", {})
    assert result.matches == [] and usage["input_tokens"] == 100


def test_ai_match_overrides_lexical_similarity(monkeypatch):
    old, _ = extract(
        "old.txt",
        "Подразделение: Отдел закупок\n1. Проведение закупочных процедур и выбор поставщиков.".encode(),
    )
    new, _ = extract(
        "new.txt",
        "Подразделение: Департамент снабжения\n1. Организация тендеров и определение контрагентов.".encode(),
    )
    docs = [
        {"id": "a", "name": "old.txt", "phase": "before", "segments": old},
        {"id": "b", "name": "new.txt", "phase": "after", "segments": new},
    ]
    monkeypatch.setattr(
        ai,
        "compare",
        lambda before, after, **kwargs: (
            ai.Comparison(
                matches=[
                    ai.Match(
                        before_id=before[0]["id"],
                        after_ids=[after[0]["id"]],
                        reason="Эквивалентные обязанности по организации закупок",
                    )
                ],
                risks=[],
            ),
            {"input_tokens": 123},
        ),
    )
    result = analyze(docs)
    assert result["stats"]["lost"] == 0
    assert result["mapping"][0]["status"] == "transferred"
    assert result["mapping"][0]["after"][0]["method"] == "llm"
    assert result["engine"].startswith("GPT")


def test_ai_explicit_no_match_is_not_overridden_by_local_algorithm(monkeypatch):
    segments, _ = extract(
        "same.txt",
        "Подразделение: Отдел закупок\n1. Ведение реестра договоров.".encode(),
    )
    docs = [
        {"id": phase, "name": "same.txt", "phase": phase, "segments": segments}
        for phase in ("before", "after")
    ]
    monkeypatch.setattr(
        ai,
        "compare",
        lambda before, after, **kwargs: (
            ai.Comparison(
                matches=[
                    ai.Match(
                        before_id=before[0]["id"],
                        after_ids=[],
                        reason="Different scope",
                    )
                ],
                risks=[],
            ),
            {},
        ),
    )
    result = analyze(docs)
    assert result["stats"]["lost"] == 1


@pytest.mark.parametrize("status", [401, 429, 500])
def test_api_errors_never_expose_key(monkeypatch, status):
    monkeypatch.setenv("OPENAI_API_KEY", "private-test-secret")
    monkeypatch.setattr(
        httpx,
        "post",
        lambda url, **kwargs: httpx.Response(
            status, text="private-test-secret", request=httpx.Request("POST", url)
        ),
    )
    with pytest.raises(ValueError) as error:
        ai.request(ai.Comparison, "test", {})
    assert "private-test-secret" not in str(error.value)


def test_incomplete_gpt_response_is_rejected(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test")
    monkeypatch.setattr(
        httpx,
        "post",
        lambda url, **kwargs: httpx.Response(
            200, json={"status": "incomplete"}, request=httpx.Request("POST", url)
        ),
    )
    with pytest.raises(ValueError, match="не завершила"):
        ai.request(ai.Comparison, "test", {})


def test_department_without_functions_has_a_source(mock_gpt):
    text = "Подразделение: Отдел закупок\n1. Ведение реестра договоров.\nПодразделение: Центр инноваций"
    segments, _ = extract("old.txt", text.encode())
    result = analyze(
        [
            {"id": phase, "name": "file.txt", "phase": phase, "segments": segments}
            for phase in ("before", "after")
        ]
    )
    assert result["stats"]["before_departments"] == 2
    unit = next(d for d in result["departments"] if d["name"] == "Центр инноваций")
    assert unit["status"] == "retained" and unit["sources"]


def test_department_names_are_source_owned_and_ids_constrained(monkeypatch):
    segments, warnings = extract(
        "company.txt",
        "Подразделение: Департамент управления рисками\n1. Оценка рисков компании.".encode(),
    )
    doc = {"name": "company.txt", "segments": segments, "warnings": warnings}

    def respond(schema, instruction, payload):
        properties = schema.model_json_schema()["$defs"]["SourceClassification"]["properties"]
        assert "department" not in properties
        assert properties["department_source_id"]["const"] == "1"
        assert properties["segment_id"]["enum"] == ["1", "2"]
        return schema.model_validate(
            {
                "segments": [
                    {
                        "segment_id": s["id"],
                        "department_source_id": "1",
                        "is_function": s["id"] == "2",
                    }
                    for s in segments
                ]
            }
        ), {}

    monkeypatch.setattr(ai, "request", respond)
    ai.extract_functions(doc)
    assert segments[1]["department"] == "Департамент управления рисками"
    assert segments[1]["department_source_id"] == "1"
    assert segments[0]["is_department"] is True


def test_extraction_repairs_missing_segments_and_counts_usage(monkeypatch):
    segments, warnings = extract(
        "company.txt", "Подразделение: Отдел закупок\n1. Ведение реестра договоров.".encode()
    )
    calls = []

    def respond(schema, instruction, payload):
        calls.append(instruction)
        items = segments[:1] if len(calls) == 1 else segments
        return schema.model_validate(
            {
                "segments": [
                    {
                        "segment_id": s["id"],
                        "department_source_id": "1",
                        "is_function": s["id"] == "2",
                    }
                    for s in items
                ]
            }
        ), {"input_tokens": 20, "output_tokens": 10}

    monkeypatch.setattr(ai, "request", respond)
    usage = ai.extract_functions(
        {"name": "company.txt", "segments": segments, "warnings": warnings}
    )
    assert len(calls) == 2
    assert usage == {"input_tokens": 40, "output_tokens": 20}


def test_extraction_preserves_manual_edits_and_filename_fallback(mock_gpt):
    segments, warnings = extract("company.txt", "1. Ведение реестра договоров.".encode())
    segments[0].update(manual=True, department="Ручное название", is_function=False)
    doc = {"name": "company.txt", "segments": segments, "warnings": warnings}
    ai.extract_functions(doc)
    assert segments[0]["department"] == "Ручное название"
    assert segments[0]["is_function"] is False
    assert any("Заголовок подразделения не найден" in warning for warning in warnings)


def test_extraction_rejects_duplicate_ids_after_bounded_retry(monkeypatch):
    segments, warnings = extract(
        "company.txt", "Подразделение: Отдел закупок\n1. Ведение реестра договоров.".encode()
    )
    item = ai.Classification(segment_id="1", department_source_id="1", is_function=False)
    monkeypatch.setattr(ai, "request", lambda *args: (ai.Extraction(segments=[item, item]), {}))
    with pytest.raises(ValueError, match="после повторной проверки"):
        ai.extract_functions({"name": "company.txt", "segments": segments, "warnings": warnings})


def test_catalog_does_not_depend_on_previous_model_classification(monkeypatch):
    segments, warnings = extract(
        "company.txt",
        "Подразделение: Финансовый департамент\n1. Формирование бюджета.\nПодразделение: Отдел закупок".encode(),
    )
    for segment in segments:
        segment["is_department"] = False
    doc = {"name": "company.txt", "segments": segments, "warnings": warnings}
    assert ai.department_catalog(doc) == {"1": "Финансовый департамент", "3": "Отдел закупок"}

    def respond(schema, instruction, payload):
        return schema.model_validate(
            {
                "segments": [
                    {"segment_id": s["id"], "department_source_id": "1", "is_function": True}
                    for s in segments
                ]
            }
        ), {}

    monkeypatch.setattr(ai, "request", respond)
    ai.extract_functions(doc)
    assert segments[2]["department"] == "Отдел закупок"
    assert segments[2]["is_department"] is True and segments[2]["is_function"] is False
    assert segments[1]["department"] == "Финансовый департамент"
