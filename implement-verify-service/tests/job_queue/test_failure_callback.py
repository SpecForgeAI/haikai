"""Failure-path build-results callback (2026-07-28).

A job that died BEFORE the pipeline could emit its own build-results (the
live case: the credential gate raised in _resolve_request_context 2ms after
POST /api/v2/jobs/orchestrations returned 200) previously failed SILENTLY
toward the caller — the gateway's run-item stayed 'submitted' forever and
the execution rail's Start stayed locked. `_emit_failure_callback` delivers
outcome 'error' (which the gateway's build-results door routes to halt),
best-effort, never raising.
"""
from __future__ import annotations

import types

from src.job_queue.tasks import _emit_failure_callback


def test_posts_error_outcome_from_raw_payload_when_request_is_none(monkeypatch):
    # request=None is the earliest failure shape (the OrchestrationRequest
    # parse itself, or anything before it) — fields come from the raw payload.
    posted: dict = {}

    def fake_post(url, payload):
        posted["url"] = url
        posted["payload"] = payload
        return True

    monkeypatch.setattr("src.job_queue.tasks._post_callback", fake_post)
    job = types.SimpleNamespace(
        request_payload={
            "company": "acme",
            "project": "proj",
            "callback_url": "http://gw/api/implementation/build-results",
        }
    )

    _emit_failure_callback(job, "job-1", None, "Credentials not configured: boom")

    assert posted["url"] == "http://gw/api/implementation/build-results"
    assert posted["payload"]["outcome"] == "error"
    assert posted["payload"]["job_id"] == "job-1"
    assert posted["payload"]["company"] == "acme"
    assert posted["payload"]["project"] == "proj"
    assert "Credentials not configured" in posted["payload"]["errors"][0]


def test_prefers_resolved_request_fields(monkeypatch):
    posted: dict = {}

    def fake_post(url, payload):
        posted["url"] = url
        posted["payload"] = payload
        return True

    monkeypatch.setattr("src.job_queue.tasks._post_callback", fake_post)
    job = types.SimpleNamespace(request_payload={})
    request = types.SimpleNamespace(
        callback_url="http://gw/cb", company="acme", project="proj"
    )

    _emit_failure_callback(job, "job-2", request, "boom")

    assert posted["url"] == "http://gw/cb"
    assert posted["payload"]["company"] == "acme"


def test_no_callback_url_is_a_noop(monkeypatch):
    called: list = []
    monkeypatch.setattr(
        "src.job_queue.tasks._post_callback", lambda *a: called.append(a)
    )
    job = types.SimpleNamespace(request_payload={"company": "acme"})

    _emit_failure_callback(job, "job-3", None, "boom")

    assert called == []


def test_delivery_errors_never_propagate(monkeypatch):
    # The job failure itself must reach the job runner unchanged — a callback
    # transport error is logged, not raised.
    def explode(url, payload):
        raise RuntimeError("network down")

    monkeypatch.setattr("src.job_queue.tasks._post_callback", explode)
    job = types.SimpleNamespace(request_payload={"callback_url": "http://gw/cb"})

    _emit_failure_callback(job, "job-4", None, "boom")
