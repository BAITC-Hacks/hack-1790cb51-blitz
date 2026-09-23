"""Small persistent store. Every operation uses its own transactional connection."""

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


def uid() -> str:
    return uuid4().hex


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def pack(value) -> str:
    return json.dumps(value, ensure_ascii=False)


@contextmanager
def db():
    path = Path(os.getenv("DATABASE_PATH", "data/atlas.sqlite3"))
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize():
    with db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, organization TEXT NOT NULL,
            created_at TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0,
            revision INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft',
            progress INTEGER NOT NULL DEFAULT 0, stage TEXT NOT NULL DEFAULT '',
            error TEXT, result TEXT, analysis_token TEXT
        );
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            name TEXT NOT NULL, phase TEXT NOT NULL, size INTEGER NOT NULL,
            created_at TEXT NOT NULL, segments TEXT NOT NULL, warnings TEXT NOT NULL,
            content BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL, revision INTEGER NOT NULL, result TEXT NOT NULL
        );
        """)
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(projects)")}
        if "analysis_token" not in columns:
            conn.execute("ALTER TABLE projects ADD COLUMN analysis_token TEXT")
        conn.execute(
            "UPDATE projects SET status='failed', analysis_token=NULL, error='Анализ прерван перезапуском сервера. Запустите его снова.' WHERE status='running'"
        )


def document_dict(row, detail=False):
    data = dict(row)
    data.pop("content", None)
    segments = json.loads(data.pop("segments"))
    data["warnings"] = json.loads(data["warnings"])
    data["function_count"] = sum(s["is_function"] for s in segments)
    data["departments"] = sorted({s["department"] for s in segments if s["is_function"]})
    if detail:
        data["segments"] = segments
    return data


def project_dict(row):
    data = dict(row)
    data["is_demo"] = bool(data["is_demo"])
    data["result"] = json.loads(data["result"]) if data["result"] else None
    return data
