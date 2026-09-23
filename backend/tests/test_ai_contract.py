import httpx
import pytest

from app import ai
from app.analysis import analyze
from app.parser import extract


def test_responses_api_strict_contract(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-not-real")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-5-mini")

    def post(url, **kwargs):
        assert url == "https://api.openai.com/v1/responses"
        body = kwargs["json"]
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
        lambda before, after: (
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
    result = analyze(docs, use_llm=True)
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
        lambda before, after: (
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
    result = analyze(docs, use_llm=True)
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


def test_department_without_functions_has_a_source():
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
