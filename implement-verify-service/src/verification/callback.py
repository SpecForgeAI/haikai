"""Safe outbound callback (anti-SSRF) for the bug-investigation result.

The callbackUrl is supplied by the caller (Gary's frontend). Without guards
the worker would POST to any address — including cloud metadata
(169.254.169.254), loopback, or RFC-1918 hosts. This module validates the URL
before sending, disables redirects, and signs the body so the receiver can
verify the call came from us.

Env:
  SX_CALLBACK_ALLOW_INSECURE=1   allow http:// (default: https only)
  SX_CALLBACK_ALLOW_PRIVATE=1    allow private/loopback hosts (dev only)
  SX_CALLBACK_ALLOWED_HOSTS      comma-separated host allowlist (e.g. "127.0.0.1,haikai.internal")
                                 — a server-set exemption for a TRUSTED, co-located peer.
                                 An allowlisted host bypasses BOTH the https-only and the
                                 private/loopback checks (the co-located Haikai is reachable
                                 only at http://127.0.0.1:<port>). This is deliberately scoped
                                 to named hosts so it does NOT re-open general SSRF the way the
                                 blunt SX_CALLBACK_ALLOW_PRIVATE=1 does (S1).
  SX_CALLBACK_SIGNING_SECRET     if set, adds X-SX-Signature: sha256=<hmac(body)>
  SX_CALLBACK_SERVICE_TOKEN      if set, adds X-Service-Token: <token>. The
                                 co-located Haikai gateway's inbound
                                 build-results door REQUIRES it (its
                                 BUILD_RESULTS_SERVICE_TOKEN is fail-closed —
                                 an empty/missing token is a 401). Set the
                                 SAME value on both sides.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import logging
import os
import socket
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


class CallbackRejected(ValueError):
    """The callback URL failed validation (would be unsafe to call)."""


def _host_is_private(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        # Unresolvable host — treat as unsafe (can't prove it's public).
        return True
    for info in infos:
        ip = info[4][0]
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return True
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved or addr.is_multicast:
            return True
    return False


def _allowed_hosts() -> set[str]:
    """Server-set allowlist of trusted callback hosts (S1). Comma-separated; the
    co-located Haikai goes here so its loopback callback is deliverable without a
    blanket SSRF disable."""
    raw = os.environ.get("SX_CALLBACK_ALLOWED_HOSTS", "")
    return {h.strip() for h in raw.split(",") if h.strip()}


def validate_callback_url(url: str) -> None:
    """Raise CallbackRejected if the URL is missing, wrong scheme, or resolves
    to a private/loopback/metadata host.

    A host on SX_CALLBACK_ALLOWED_HOSTS (a server-set, trusted-peer allowlist) is
    exempt from BOTH the https-only and the private-host checks — that is how the
    co-located Haikai (http://127.0.0.1:<port>) becomes reachable without flipping
    the blunt SX_CALLBACK_ALLOW_PRIVATE=1 that would re-open general SSRF (S1)."""
    parsed = urlparse(url or "")
    if not parsed.hostname:
        raise CallbackRejected("no host in callbackUrl")

    # Trusted co-located peer: scoped exemption, NOT a global SSRF disable.
    if parsed.hostname in _allowed_hosts():
        return

    allow_insecure = os.environ.get("SX_CALLBACK_ALLOW_INSECURE") == "1"
    allow_private = os.environ.get("SX_CALLBACK_ALLOW_PRIVATE") == "1"
    schemes = {"https", "http"} if allow_insecure else {"https"}
    if parsed.scheme not in schemes:
        raise CallbackRejected(f"scheme '{parsed.scheme}' not allowed (need {sorted(schemes)})")
    if not allow_private and _host_is_private(parsed.hostname):
        raise CallbackRejected(f"host '{parsed.hostname}' resolves to a private/loopback/metadata address")


def _retry_delays() -> list[float]:
    """Backoff schedule for RETRYABLE callback failures (5xx / network).
    ``SX_CALLBACK_RETRY_DELAYS`` (comma-separated seconds) overrides; empty
    string disables retries. Default: 10, 30, 60 (4 attempts, ~100s total —
    enough to ride out a gateway/AMS restart blip without stalling the worker
    for long)."""
    raw = os.environ.get("SX_CALLBACK_RETRY_DELAYS")
    if raw is None:
        return [10.0, 30.0, 60.0]
    out: list[float] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(float(part))
        except ValueError:
            logger.warning("SX_CALLBACK_RETRY_DELAYS entry %r not numeric; ignored", part)
    return out


def post_callback(callback_url: str, payload: dict, timeout: int = 30,
                  sleep=None) -> bool:
    """Validate, sign, and POST — with bounded retries on RETRYABLE failures
    (2026-08-15). A single transient 502 used to permanently strand the run
    consumer at 'dispatching': the job's terminal state was durable in the db
    but the one-and-only delivery attempt had already been spent. 5xx and
    network errors now retry on a short backoff; 4xx do NOT (an auth/contract
    problem will not heal by retrying). Best-effort overall: returns False
    (never raises) after exhaustion — the result stays durable + pollable."""
    import time as _time
    import requests

    sleep = sleep or _time.sleep

    try:
        validate_callback_url(callback_url)
    except CallbackRejected as exc:
        logger.warning(f"callback rejected ({callback_url}): {exc}")
        return False

    body = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"}
    secret = os.environ.get("SX_CALLBACK_SIGNING_SECRET")
    if secret:
        headers["X-SX-Signature"] = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    # Inbound auth for the Haikai gateway's build-results door (2026-07-28):
    # the door fail-closes without a matching token, so the first callback
    # ever delivered live came back 401 until this rode along.
    service_token = os.environ.get("SX_CALLBACK_SERVICE_TOKEN")
    if service_token:
        headers["X-Service-Token"] = service_token

    delays = _retry_delays()
    attempts = len(delays) + 1
    for attempt in range(1, attempts + 1):
        try:
            resp = requests.post(callback_url, data=body, headers=headers,
                                 timeout=timeout, allow_redirects=False)
            if 200 <= resp.status_code < 300:
                if attempt > 1:
                    logger.info(f"callback {callback_url} delivered on attempt {attempt}")
                return True
            retryable = resp.status_code >= 500
            logger.warning(
                f"callback {callback_url} returned {resp.status_code} "
                f"(attempt {attempt}/{attempts}"
                + (", will retry" if retryable and attempt <= len(delays) else ", giving up")
                + ")")
            if not retryable:
                return False
        except Exception as exc:
            logger.warning(
                f"callback to {callback_url} failed: {exc} "
                f"(attempt {attempt}/{attempts}"
                + (", will retry" if attempt <= len(delays) else ", giving up")
                + ")")
        if attempt <= len(delays):
            sleep(delays[attempt - 1])
    return False
