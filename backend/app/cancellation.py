"""Per-run cancellation, including closing an in-flight HTTP connection."""

import asyncio
from contextlib import contextmanager
from contextvars import ContextVar

import httpx


class AnalysisCancelled(Exception):
    pass


_check = ContextVar("analysis_cancellation_check", default=None)


@contextmanager
def cancellation_scope(check):
    token = _check.set(check)
    try:
        check()
        yield
    finally:
        _check.reset(token)


def check_cancelled():
    callback = _check.get()
    if callback:
        callback()


def post_response(url, **kwargs):
    check_cancelled()
    if _check.get() is None:
        return httpx.post(url, **kwargs)

    async def send():
        async with httpx.AsyncClient() as client:
            task = asyncio.create_task(client.post(url, **kwargs))
            try:
                while not task.done():
                    await asyncio.wait({task}, timeout=0.25)
                    check_cancelled()
                check_cancelled()
                return await task
            finally:
                if not task.done():
                    task.cancel()
                await asyncio.gather(task, return_exceptions=True)

    return asyncio.run(send())
