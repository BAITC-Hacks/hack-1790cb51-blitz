"""Offline provider responses for API workflow tests; never call paid APIs."""

import re
from collections import defaultdict

import httpx
import pytest

from app import ai


@pytest.fixture(autouse=True)
def block_network(monkeypatch):
    def blocked(*args, **kwargs):
        raise AssertionError("Tests must mock OpenAI requests")

    monkeypatch.setattr(httpx, "post", blocked)


@pytest.fixture
def mock_gpt(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-not-real")

    def respond(schema, instruction, payload):
        if "segments" in payload:
            department = payload.get("preceding_department_source_id") or next(
                (d["id"] for d in payload["departments"] if d["id"] != "filename"), "filename"
            )
            department_ids = {d["id"] for d in payload["departments"]}
            segments = []
            for segment in payload["segments"]:
                if segment["id"] in department_ids:
                    department = segment["id"]
                segments.append(
                    {
                        "segment_id": segment["id"],
                        "department_source_id": department,
                        "is_function": bool(re.match(r"\d+\.", segment["text"])),
                    }
                )
            return schema.model_validate({"segments": segments}), {
                "input_tokens": 10,
                "output_tokens": 10,
            }

        def body(s):
            return re.sub(r"^\d+\.\s*", "", s["text"])

        groups = defaultdict(list)
        for s in payload["after"]:
            groups[body(s)].append(s["id"])
        matches = [
            ai.Match(
                before_id=s["id"], after_ids=groups[body(s)], reason="Контрольный ответ провайдера"
            )
            for s in payload["before"]
        ]
        risks = [
            ai.Risk(
                kind="duplication",
                severity="medium",
                title="Контрольное пересечение",
                description="Контрольный ответ",
                source_ids=ids,
                recommendation="Проверить роли",
            )
            for ids in groups.values()
            if len(ids) > 1
        ]
        procurement = [
            s["id"]
            for s in payload["after"]
            if s["department"] == "Департамент снабжения"
            and (
                body(s).startswith("Проведение закупочных")
                or body(s).startswith("Независимый аудит")
            )
        ]
        if len(procurement) == 2:
            risks.append(
                ai.Risk(
                    kind="conflict",
                    severity="high",
                    title="Контрольный конфликт",
                    description="Контрольный ответ",
                    source_ids=procurement,
                    recommendation="Проверить контроль",
                )
            )
        return ai.Comparison(matches=matches, risks=risks), {
            "input_tokens": 10,
            "output_tokens": 10,
        }

    monkeypatch.setattr(ai, "request", respond)
