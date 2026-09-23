import asyncio

import httpx
import pytest
from fastapi import BackgroundTasks

from app import ai, main
from app.cancellation import AnalysisCancelled, cancellation_scope, post_response
from app.storage import db
from sample_pair import create_pair


def queue(project_id):
    return main.start_analysis(project_id, main.AnalyzeInput(), BackgroundTasks())["analysis_token"]


def cancel(client, project_id, token):
    return client.post(f"/api/projects/{project_id}/analyze/cancel", json={"analysis_token": token})


def test_cancel_during_extraction_preserves_documents_and_previous_result(
    client, mock_gpt, monkeypatch
):
    project = create_pair(client)
    path = f"/api/projects/{project['id']}"
    client.post(path + "/analyze", json={})
    original = client.get(path).json()
    token = queue(project["id"])
    respond = ai.request
    calls = []

    def interrupted(*args):
        calls.append(1)
        assert cancel(client, project["id"], token).json() == {"status": "cancelled"}
        return respond(*args)  # A late provider response must be ignored.

    monkeypatch.setattr(ai, "request", interrupted)
    main.run_analysis(project["id"], token)
    cancelled = client.get(path).json()
    assert cancelled["status"] == "cancelled" and cancelled["analysis_token"] is None
    assert cancelled["result"] == original["result"]
    assert cancelled["documents"] == original["documents"]
    assert cancelled["runs"] == original["runs"]
    assert len(calls) == 1
    assert cancel(client, project["id"], token).json() == {"status": "cancelled"}
    monkeypatch.setattr(ai, "request", respond)
    new_token = queue(project["id"])
    assert new_token != token
    main.run_analysis(project["id"], new_token)
    assert client.get(path).json()["status"] == "completed"


@pytest.mark.parametrize("provider_error", [False, True])
def test_cancel_before_save_and_restart_rejects_old_success_or_error(
    client, mock_gpt, monkeypatch, provider_error
):
    project = create_pair(client)
    path = f"/api/projects/{project['id']}"
    token = queue(project["id"])
    analyze = main.analyze
    next_token = []

    def late_result(*args):
        result = analyze(*args)
        assert cancel(client, project["id"], token).status_code == 200
        next_token.append(queue(project["id"]))
        if provider_error:
            raise ValueError("Late request failure")
        return result

    monkeypatch.setattr(main, "analyze", late_result)
    main.run_analysis(project["id"], token)
    current = client.get(path).json()
    assert current["status"] == "running"
    assert current["analysis_token"] == next_token[0]
    assert current["error"] is None and current["result"] is None and current["runs"] == []
    assert cancel(client, project["id"], token).status_code == 409
    monkeypatch.setattr(main, "analyze", analyze)
    main.run_analysis(project["id"], next_token[0])
    assert client.get(path).json()["status"] == "completed"


def test_cancel_before_worker_starts_and_edit_documents(client, mock_gpt, monkeypatch):
    project = create_pair(client)
    token = queue(project["id"])
    assert cancel(client, project["id"], token).status_code == 200

    def unexpected(*args):
        raise AssertionError("Cancelled run must never contact provider")

    monkeypatch.setattr(ai, "request", unexpected)
    main.run_analysis(project["id"], token)
    doc = project["documents"][0]
    assert client.delete(f"/api/documents/{doc['id']}").status_code == 204
    main.run_analysis(project["id"], token)
    assert client.get(f"/api/projects/{project['id']}").json()["status"] == "draft"
    assert cancel(client, "missing", token).status_code == 404


def test_cancel_completed_run_is_noop(client, mock_gpt):
    project = create_pair(client)
    token = queue(project["id"])
    main.run_analysis(project["id"], token)
    assert cancel(client, project["id"], token).json() == {"status": "completed"}


def test_cancellation_closes_inflight_http_and_resets_context(monkeypatch):
    events = []

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            events.append("closed")

        async def post(self, *args, **kwargs):
            events.append("started")
            try:
                await asyncio.Event().wait()
            finally:
                events.append("request-stopped")

    def check():
        if "started" in events:
            raise AnalysisCancelled()

    monkeypatch.setattr(httpx, "AsyncClient", Client)
    with pytest.raises(AnalysisCancelled), cancellation_scope(check):
        post_response("https://example.invalid", json={})
    assert events == ["started", "request-stopped", "closed"]
    monkeypatch.setattr(httpx, "post", lambda *a, **k: "outside-scope")
    assert post_response("https://example.invalid") == "outside-scope"


def test_cancellable_transport_returns_response_and_propagates_errors(monkeypatch):
    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url, **kwargs):
            if kwargs.get("fail"):
                raise httpx.ConnectError("test")
            return httpx.Response(200, json={"status": "completed"})

    monkeypatch.setattr(httpx, "AsyncClient", Client)
    with cancellation_scope(lambda: None):
        assert post_response("https://example.invalid").status_code == 200
        with pytest.raises(httpx.ConnectError):
            post_response("https://example.invalid", fail=True)


def test_migration_preserves_existing_project_schema(tmp_path, monkeypatch):
    from app.storage import initialize

    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "old.sqlite3"))
    with db() as conn:
        conn.execute("CREATE TABLE projects (id TEXT PRIMARY KEY, status TEXT, error TEXT)")
        conn.execute("INSERT INTO projects VALUES ('old', 'completed', NULL)")
    initialize()
    with db() as conn:
        row = conn.execute("SELECT * FROM projects").fetchone()
        assert row["status"] == "completed" and row["analysis_token"] is None
